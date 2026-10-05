import assert from 'node:assert/strict'
import test from 'node:test'
import { writingEvalCases } from './fixtures/writing-eval.mjs'

test('the proofreading evaluation corpus has broad labeled coverage and clean controls', () => {
  assert.equal(writingEvalCases.length >= 150, true)
  assert.equal(new Set(writingEvalCases.map((item) => item.id)).size, writingEvalCases.length)
  assert.equal(writingEvalCases.filter((item) => item.edits.length === 0).length >= 30, true)
  assert.equal(writingEvalCases.some((item) => item.text.includes('Aragog')), true)
  for (const item of writingEvalCases) {
    assert.equal(typeof item.text, 'string')
    assert.equal(typeof item.expectedText, 'string')
    for (const edit of item.edits) {
      assert.equal(edit.start >= 0, true)
      assert.equal(edit.end >= edit.start, true)
      assert.equal(edit.end <= item.text.length, true)
      assert.notEqual(item.text.slice(edit.start, edit.end), edit.replacement)
    }
  }
})
