import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProofreader,
  normalizeProofreadingMatches,
  proofreadingReviewItems,
} from '../server/proofreader.mjs'

test('proofreading matches are bounded to the submitted writing', () => {
  const text = 'A freind arrived.'
  assert.deepEqual(normalizeProofreadingMatches([
    {
      offset: 2,
      length: 6,
      message: 'Possible spelling mistake found.',
      replacements: [{ value: 'friend' }, { value: 'fiend' }],
      rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { name: 'Possible Typo' }, issueType: 'misspelling' },
    },
    { offset: 500, length: 2, replacements: [{ value: 'bad' }] },
  ], text), [{
    offset: 2,
    length: 6,
    message: 'Possible spelling mistake found.',
    shortMessage: '',
    replacements: ['friend', 'fiend'],
    ruleId: 'MORFOLOGIK_RULE_EN_US',
    category: 'Possible Typo',
    issueType: 'misspelling',
  }])
})

test('the proofreader uses only a loopback service and fails closed to offline rules', async () => {
  assert.throws(
    () => createProofreader({ endpoint: 'https://api.languagetool.org/v2/check' }),
    /must be a local HTTP service/,
  )
  const proofreader = createProofreader({
    fetchImpl: async () => { throw new Error('offline') },
    timeoutMs: 500,
  })
  assert.deepEqual(await proofreader.check('A freind arrived.'), {
    available: false,
    engine: 'reviewed offline rules',
    matches: [],
    error: 'offline',
  })
})

test('LanguageTool replacements are parent-review candidates, not trusted corrections', () => {
  const text = 'Noone knows. I went home. I ate dinner.'
  const items = proofreadingReviewItems(text, [
    {
      offset: 0,
      length: 5,
      message: 'Possible spelling mistake found.',
      replacements: ['None', 'No one'],
      ruleId: 'MORFOLOGIK_RULE_EN_US',
      category: 'Possible Typo',
      issueType: 'misspelling',
    },
    {
      offset: 13,
      length: 1,
      message: 'Several sentences begin with the same word.',
      replacements: ['Furthermore, I'],
      ruleId: 'ENGLISH_WORD_REPEAT_BEGINNING_RULE',
      category: 'Style',
      issueType: 'style',
    },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].source, 'languagetool')
  assert.deepEqual(items[0].alternatives, ['None', 'No one'])
  assert.equal(items[0].replacement, undefined)
  assert.equal(items[0].start, 0)
  assert.equal(items[0].end, 5)
})
