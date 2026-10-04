import assert from 'node:assert/strict'
import test from 'node:test'
import { createProofreader, normalizeProofreadingMatches } from '../server/proofreader.mjs'

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
