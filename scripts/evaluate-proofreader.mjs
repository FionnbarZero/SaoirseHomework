import { createAiProofreader } from '../server/ai-proofreader.mjs'
import { createProofreader } from '../server/proofreader.mjs'
import { checkWriting } from '../server/writing-check.mjs'
import { writingEvalCases } from '../tests/fixtures/writing-eval.mjs'
import { atomicEdits } from '../src/writing-edits.ts'
import { inspectWritingFindings } from '../src/writing.ts'

try {
  process.loadEnvFile?.(new URL('../.env', import.meta.url))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

if (!process.env.OPENAI_API_KEY || !process.env.HOMEWORK_OPENAI_MODEL) {
  throw new Error('Set OPENAI_API_KEY and HOMEWORK_OPENAI_MODEL in .env before running the proofreading evaluation')
}

const ai = createAiProofreader()
const local = createProofreader()
const limit = Math.max(1, Math.min(
  writingEvalCases.length,
  Number(process.env.HOMEWORK_PROOFREADING_EVAL_LIMIT) || writingEvalCases.length,
))
const selected = writingEvalCases.slice(0, limit)
let expectedEdits = 0
let matchedEdits = 0
let proposedEdits = 0
let exactPassages = 0
let cleanPassages = 0
let cleanFalsePositives = 0
let multiErrorPassages = 0
let exactMultiErrorPassages = 0
let unresolvedPassages = 0

function editKey(edit, text) {
  let { start, end, replacement } = edit
  while (start < end && replacement && text[start] === replacement[0]) {
    start += 1
    replacement = replacement.slice(1)
  }
  while (start < end && replacement && text[end - 1] === replacement.at(-1)) {
    end -= 1
    replacement = replacement.slice(0, -1)
  }
  return `${start}:${end}:${replacement}`
}

for (const [index, item] of selected.entries()) {
  const result = await checkWriting(item.text, { proofreader: local, aiProofreader: ai, mode: 'assist' })
  if (!result.ai.analyzed || result.incomplete) throw new Error(`AI evaluation failed for ${item.id}: ${result.ai.error ?? 'incomplete check'}`)
  const findings = inspectWritingFindings(item.text, undefined, result.matches, { authoritative: result.authoritative })
  const predicted = findings.flatMap((finding) => [finding, ...(finding.additionalEdits ?? [])])
    .flatMap((edit) => atomicEdits(item.text.slice(edit.start, edit.end), edit.replacement, edit.start))
  const expected = item.edits.flatMap((edit) => atomicEdits(item.text.slice(edit.start, edit.end), edit.replacement, edit.start))
  const expectedKeys = new Set(expected.map((edit) => editKey(edit, item.text)))
  matchedEdits += predicted.filter((edit) => expectedKeys.has(editKey(edit, item.text))).length
  expectedEdits += expected.length
  proposedEdits += predicted.length
  if (item.edits.length === 0) {
    cleanPassages += 1
    if (predicted.length > 0) cleanFalsePositives += 1
  }
  const corrected = [...predicted]
    .sort((left, right) => right.start - left.start)
    .reduce((text, edit) => (
      `${text.slice(0, edit.start)}${edit.replacement}${text.slice(edit.end)}`
    ), item.text)
  const resolved = result.reviewItems.length === 0
  if (!resolved) unresolvedPassages += 1
  if (corrected === item.expectedText && resolved) exactPassages += 1
  if (item.edits.length > 1) {
    multiErrorPassages += 1
    if (corrected === item.expectedText && resolved && inspectWritingFindings(corrected).length === 0) exactMultiErrorPassages += 1
  }
  process.stdout.write(`\rEvaluated ${index + 1}/${selected.length}`)
}

const precision = proposedEdits ? matchedEdits / proposedEdits : 1
const recall = expectedEdits ? matchedEdits / expectedEdits : 1
const exactPassageRate = exactPassages / selected.length
const cleanFalsePositiveRate = cleanPassages ? cleanFalsePositives / cleanPassages : 0
const multiErrorPassageRate = multiErrorPassages ? exactMultiErrorPassages / multiErrorPassages : null
const fullCorpus = selected.length === writingEvalCases.length
process.stdout.write('\n')
console.log(JSON.stringify({
  cases: selected.length,
  expectedEdits,
  proposedEdits,
  matchedEdits,
  precision,
  recall,
  exactPassageRate,
  cleanFalsePositiveRate,
  multiErrorPassages,
  multiErrorPassageRate,
  unresolvedPassages,
  fullCorpus,
  releaseGateEvaluated: fullCorpus,
}, null, 2))

if (precision < 0.98 || recall < 0.90 || cleanFalsePositiveRate > 0.02 ||
    (multiErrorPassageRate !== null && multiErrorPassageRate < 0.90) ||
    (fullCorpus && multiErrorPassages === 0)) {
  process.exitCode = 1
}
