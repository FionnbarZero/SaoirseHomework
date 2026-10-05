import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAiProofreader,
  normalizeAiFindings,
  normalizeAiMode,
  segmentWriting,
} from '../server/ai-proofreader.mjs'

function responseWith(findings) {
  return {
    ok: true,
    async json() {
      return {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({ findings }) }],
        }],
      }
    },
  }
}

test('AI findings must quote an exact occurrence from the submitted passage', () => {
  const text = 'She walk home. She walk slowly.'
  const segments = segmentWriting(text)
  const findings = normalizeAiFindings([
    {
      segment: 1,
      original: 'She walk',
      occurrence: 2,
      replacement: 'She walks',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'subject verb',
      message: 'The subject and verb do not agree.',
      explanation: 'A singular subject needs a matching present-tense verb.',
    },
    {
      segment: 1,
      original: 'words that are not present',
      occurrence: 1,
      replacement: 'replacement',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'invented',
      message: 'Bad location.',
      explanation: 'This must be discarded.',
    },
  ], text, segments)

  assert.equal(findings.length, 1)
  assert.equal(text.slice(findings[0].start, findings[0].end), 'She walk')
  assert.equal(findings[0].start, text.lastIndexOf('She walk'))
  assert.equal(findings[0].issueCode, 'subject-verb')
})

test('guided practice accepts only exact high-confidence findings and disables response storage', async () => {
  let request
  const proofreader = createAiProofreader({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) }
      return responseWith([
        {
          segment: 1,
          original: 'she walk',
          occurrence: 1,
          replacement: 'She walks',
          category: 'grammar',
          confidence: 'high',
          issue_code: 'subject-verb-agreement',
          message: 'The sentence needs a capital and a matching verb.',
          explanation: 'A sentence begins with a capital, and “she” needs “walks.”',
        },
        {
          segment: 1,
          original: 'home',
          occurrence: 1,
          replacement: 'home.',
          category: 'punctuation',
          confidence: 'medium',
          issue_code: 'possible-period',
          message: 'This may need an ending mark.',
          explanation: 'A complete sentence usually ends with punctuation.',
        },
      ])
    },
  })

  const result = await proofreader.check('she walk home', 'assist')

  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  assert.equal(request.body.model, 'test-model')
  assert.equal(request.body.store, false)
  assert.equal(request.body.text.format.type, 'json_schema')
  assert.equal(request.body.text.format.strict, true)
  assert.deepEqual(result.counts, { total: 2, practice: 1, review: 1, ignored: 0 })
  assert.equal(result.matches[0].offset, 0)
  assert.equal(result.matches[0].replacements[0], 'She walks')
  assert.equal(result.reviewItems[0].source, 'ai')
  assert.equal(result.reviewItems[0].confidence, 'medium')
})

test('shadow mode returns counts but does not expose findings', async () => {
  const proofreader = createAiProofreader({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async () => responseWith([{
      segment: 1,
      original: 'walk',
      occurrence: 1,
      replacement: 'walks',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'agreement',
      message: 'The verb does not agree.',
      explanation: 'Use a matching singular verb.',
    }]),
  })

  const result = await proofreader.check('She walk.', 'shadow')
  assert.equal(result.analyzed, true)
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.reviewItems, [])
  assert.deepEqual(result.counts, { total: 1, practice: 0, review: 0, ignored: 1 })
})

test('unconfigured AI and invalid modes fail closed without a network request', async () => {
  let called = false
  const proofreader = createAiProofreader({
    fetchImpl: async () => {
      called = true
      throw new Error('should not run')
    },
  })

  assert.equal(normalizeAiMode('anything'), 'off')
  const result = await proofreader.check('She walk.', 'review')
  assert.equal(result.available, false)
  assert.equal(result.analyzed, false)
  assert.equal(called, false)
  assert.match(result.error, /API key and model/)
})
