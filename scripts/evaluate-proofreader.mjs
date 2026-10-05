import { createAiProofreader } from '../server/ai-proofreader.mjs'
import { createProofreader } from '../server/proofreader.mjs'
import { writingEvalCases } from '../tests/fixtures/writing-eval.mjs'

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

function editKey(edit) {
  return `${edit.start}:${edit.end}:${edit.replacement}`
}

for (const [index, item] of selected.entries()) {
  const localResult = await local.check(item.text)
  const result = await ai.check(item.text, 'assist', localResult.matches)
  if (!result.analyzed) throw new Error(`AI evaluation failed for ${item.id}: ${result.error ?? 'unknown error'}`)
  const predicted = result.matches.map((match) => ({
    start: match.offset,
    end: match.offset + match.length,
    replacement: match.replacements[0],
  }))
  const expectedKeys = new Set(item.edits.map(editKey))
  matchedEdits += predicted.filter((edit) => expectedKeys.has(editKey(edit))).length
  expectedEdits += item.edits.length
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
  if (corrected === item.expectedText) exactPassages += 1
  process.stdout.write(`\rEvaluated ${index + 1}/${selected.length}`)
}

const precision = proposedEdits ? matchedEdits / proposedEdits : 1
const recall = expectedEdits ? matchedEdits / expectedEdits : 1
const exactPassageRate = exactPassages / selected.length
const cleanFalsePositiveRate = cleanPassages ? cleanFalsePositives / cleanPassages : 0
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
}, null, 2))

if (precision < 0.98 || recall < 0.90 || cleanFalsePositiveRate > 0.02) {
  process.exitCode = 1
}
