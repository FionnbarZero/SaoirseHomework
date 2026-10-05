import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiProofreader, normalizeAiFindings, normalizeIntentReviews } from '../server/ai-proofreader.mjs'
import { normalizeProofreadingMatches } from '../server/proofreader.mjs'
import { checkWriting } from '../server/writing-check.mjs'
import { atomicEdits } from '../src/writing-edits.ts'
import { inspectWritingFindings, applyCompletedCorrections } from '../src/writing.ts'
import { AI_PASS_TIMEOUT_MS, LOCAL_CHECK_TIMEOUT_MS, WRITING_CHECK_TIMEOUT_MS } from '../src/proofreading-limits.ts'

const edit = (original, replacement, extra = {}) => ({
  segment: 1, operation: 'replace', original, occurrence: 1, replacement,
  category: 'grammar', confidence: 'high', issue_code: 'test', message: 'Fix this part.',
  explanation: 'Use the form that fits this sentence.', disposition: 'verified', based_on_candidate_ids: [], ...extra,
})
const corrected = (text, findings) => applyCompletedCorrections(text, findings,
  Object.fromEntries(findings.map((finding) => [finding.id, { correctionComplete: true }])))

function aiWith(detector, verifier, requests = []) {
  return createAiProofreader({ apiKey: 'test', model: 'test', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    const result = request.text.format.name === 'child_writing_detection' ? detector : verifier
    return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) }
  } })
}

test('shared-context findings retain capitalization, agreement, and adjacent punctuation exactly once', () => {
  const text = 'she walk'
  const normalized = normalizeAiFindings([
    edit('she', 'She', { category: 'capitalization' }), edit('she walk', 'She walks'),
    edit('walk', '.', { operation: 'insert_after', category: 'punctuation' }),
  ], text)
  assert.equal(normalized.length, 3)
  const matches = normalized.map((finding) => ({
    offset: finding.start, length: finding.end - finding.start, replacements: [finding.replacement],
    ruleId: `AI_${finding.start}`, category: finding.category, source: 'ai', verification: 'verified',
  }))
  const findings = inspectWritingFindings(text, undefined, matches)
  assert.equal(corrected(text, findings), 'She walks.')
  assert.ok(findings.every((finding) => finding.correction.correctAnswer === 'She walks.'))
})

test('deletion edits survive AI normalization, persistence normalization, and quiz generation', () => {
  const text = 'She saw the the bird.'
  const [finding] = normalizeAiFindings([edit('the ', '', { occurrence: 2 })], text)
  assert.ok(finding)
  const matches = normalizeProofreadingMatches([{
    offset: finding.start, length: finding.end - finding.start, replacements: [''],
    source: 'ai', verification: 'verified', ruleId: 'AI_DUPLICATE_WORD', category: 'Grammar',
  }], text)
  assert.equal(matches.length, 1)
  assert.equal(corrected(text, inspectWritingFindings(text, undefined, matches)), 'She saw the bird.')
})

test('AI comma insertions and local whitespace replacements produce one correction', () => {
  const text = 'They built a raft went fishing and scared off criminals.'
  const matches = [{
    offset: text.indexOf(' went'), length: 0, replacements: [','],
    ruleId: 'AI_SERIES_COMMA', category: 'Punctuation', source: 'ai', verification: 'verified',
    message: 'Separate the actions with a comma.',
  }]
  const findings = inspectWritingFindings(text, undefined, matches)
  assert.equal(corrected(text, findings), 'They built a raft, went fishing, and scared off criminals.')
  assert.equal(findings.length, 2)
  assert.equal(findings[0].practice.length, 3)
  assert.ok(findings.every((finding) => !finding.correction.correctAnswer.includes(',,')))
})

test('AI semicolons suppress alternative local periods at the same clause boundary', () => {
  const text = "The guards let them come out they wouldn't give her the key."
  const findings = inspectWritingFindings(text, undefined, [{
    offset: text.indexOf(' they'), length: 0, replacements: [';'],
    ruleId: 'AI_RUN_ON', category: 'Punctuation', source: 'ai', verification: 'verified',
    message: 'Separate the clauses.',
  }])
  assert.equal(corrected(text, findings), "The guards let them come out; they wouldn't give her the key.")
})

test('AI word anchors never replace an inside and or he inside she', () => {
  const text = "She and he said, isn't an amazing that we won?"
  const normalized = normalizeAiFindings([edit('an', 'it'), edit('he', 'she')], text)
  assert.equal(normalized.find(f => f.original === 'an').anchorStart, text.indexOf('an amazing'))
  assert.equal(normalized.find(f => f.original === 'he').anchorStart, text.indexOf('he said'))
  assert.equal(normalizeAiFindings([edit('an', 'it')], 'She and he ran.').length, 0)
  assert.equal(normalizeAiFindings([edit('isn', 'is')], "It isn't ready.").length, 0)
})

test('contradictory corrections are both sent to review instead of selecting one silently', async () => {
  const candidates = [edit('walk', 'walks'), edit('walk', 'walked')]
  const result = await aiWith({ findings: candidates }, { findings: candidates }).check('She walk.', 'assist')
  assert.equal(result.matches.length, 0)
  assert.equal(result.reviewItems.length, 2)
  assert.equal(new Set(result.reviewItems.map((item) => item.id)).size, 2)
})

test('omitted detector and local candidates remain reviewable; explicit rejection accounts for them', async () => {
  const text = 'She walk with a freind.'
  const local = [{ offset: 16, length: 6, replacements: ['friend'], ruleId: 'SPELLING', category: 'Spelling', message: 'Spelling.' }]
  const detector = { findings: [edit('walk', 'walks')] }
  const omitted = await aiWith(detector, { findings: [] }).check(text, 'assist', local)
  assert.equal(omitted.reviewItems.length, 2)
  const requests = []
  const reviewed = await aiWith(detector, { findings: [], rejected_candidate_ids: ['detector-0', 'lt-0-16-6-SPELLING'] }, requests)
    .check(text, 'assist', local, { knownNames: ['Freind'], knownPlaces: ['Hogsmeade'] })
  assert.equal(reviewed.reviewItems.length, 0)
  assert.deepEqual(JSON.parse(requests[1].input).known_names, ['Freind'])
  assert.deepEqual(JSON.parse(requests[1].input).known_places, [])
})

test('malformed anchors fail the check rather than becoming a false clean result', async () => {
  const result = await aiWith({ findings: [edit('invented', 'word')] }, { findings: [] }).check('She walk.', 'assist')
  assert.equal(result.analyzed, false)
  assert.match(result.error, /could not be located/)
})

test('more than sixty valid errors are retained', () => {
  const text = 'x '.repeat(70)
  const findings = normalizeAiFindings(Array.from({ length: 70 }, (_, index) => edit('x', 'X', { occurrence: index + 1 })), text)
  assert.equal(findings.length, 70)
})

test('meaning options retain deletion and punctuation adjacent to corrected words', () => {
  const text = 'she walk walk'
  const options = ['walks', 'walked', 'runs'].map((verb) => ({
    text: `She ${verb}.`, edits: [edit('she', 'She'), edit('walk', verb), edit(' walk', '', { occurrence: 2 }), edit('walk', '.', { operation: 'insert_after', occurrence: 2 })],
  }))
  const reviews = normalizeIntentReviews([{ segment: 1, uncertain_parts: [], options }], text)
  assert.equal(reviews.length, 1)
})

test('every atomic edit set reconstructs its declared replacement, including punctuation and Unicode', () => {
  for (const [before, after] of [['she walk', 'She walks.'], ['the the bird', 'the bird'], ['mike', 'Mike.'], ['Ron said hi', 'Ron said, “Hi.”'], ['Émilie likes 🐈', 'Émilie liked 🐈.'], ['', '.'], ['unnecessary', '']]) {
    const result = atomicEdits(before, after, 0).sort((a, b) => b.start - a.start || b.end - a.end)
      .reduce((value, item) => value.slice(0, item.start) + item.replacement + value.slice(item.end), before)
    assert.equal(result, after)
  }
})

test('the full request deadline covers all sequential server work', () => {
  assert.ok(WRITING_CHECK_TIMEOUT_MS > LOCAL_CHECK_TIMEOUT_MS + AI_PASS_TIMEOUT_MS * 3)
})

test('provider failure remains a blocking review item even if local rules find no errors', async () => {
  const result = await checkWriting('The dog ran home.', {
    mode: 'assist', proofreader: { check: async () => ({ available: true, matches: [], engine: 'Local' }) },
    aiProofreader: createAiProofreader({ apiKey: '', model: '' }),
  })
  assert.equal(result.incomplete, true)
  assert.equal(result.reviewItems[0].id, 'incomplete-proofreading')
})

test('reviewed LanguageTool grammar and punctuation rules enter child corrections without AI', async () => {
  const text = 'He ran and she followed.'
  const result = await checkWriting(text, {
    mode: 'off',
    proofreader: { check: async () => ({
      available: true,
      engine: 'LanguageTool',
      matches: [{
        offset: text.indexOf('and'),
        length: 'and'.length,
        replacements: [', and'],
        ruleId: 'COMMA_COMPOUND_SENTENCE',
        category: 'Punctuation',
        message: 'Use a comma before a coordinating conjunction joining two clauses.',
      }],
    }) },
    aiProofreader: createAiProofreader({ apiKey: '', model: '' }),
  })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].source, 'local')
  assert.equal(result.matches[0].verification, 'verified')
  assert.equal(result.reviewItems.length, 0)
  assert.ok(inspectWritingFindings(text, undefined, result.matches).some((finding) => finding.category === 'Punctuation'))
})

test('Shadow and Parent-review modes never expose child meaning choices', async () => {
  for (const mode of ['shadow', 'review']) {
    const ai = aiWith({ findings: [edit('walk', 'walks')] }, { findings: [edit('walk', 'walks')] })
    ai.interpret = async () => { assert.fail('Meaning review bypassed parent mode') }
    const result = await checkWriting('She walk.', {
      mode, proofreader: { check: async () => ({ available: true, matches: [], engine: 'Local' }) }, aiProofreader: ai,
    })
    assert.deepEqual(result.matches, [])
    assert.deepEqual(result.sentenceReviews, [])
  }
})
