import assert from 'node:assert/strict'
import test from 'node:test'
import { writingEvalCases, multiErrorWritingCases } from './fixtures/writing-eval.mjs'
import { inspectWritingFindings, applyCompletedCorrections } from '../src/writing.ts'

test('the proofreading evaluation corpus has broad labeled coverage and clean controls', () => {
  assert.equal(writingEvalCases.length >= 150, true)
  assert.equal(new Set(writingEvalCases.map((item) => item.id)).size, writingEvalCases.length)
  assert.equal(writingEvalCases.filter((item) => item.edits.length === 0).length >= 30, true)
  assert.equal(writingEvalCases.some((item) => item.text.includes('Aragog')), true)
  assert.ok(multiErrorWritingCases.length >= 18)
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

test('real local detection repairs every error in the multi-error corpus and passes a second check', () => {
  for (const item of multiErrorWritingCases) {
    const findings = inspectWritingFindings(item.text)
    const progress = Object.fromEntries(findings.map((finding) => [finding.id, { correctionComplete: true }]))
    const corrected = applyCompletedCorrections(item.text, findings, progress)
    assert.equal(corrected, item.expectedText, item.id)
    assert.equal(inspectWritingFindings(corrected).length, 0, `${item.id}: residual errors`)
    for (const finding of findings) {
      assert.equal(finding.practice.length, 3, `${item.id}: practice count`)
      assert.equal(finding.correction.correctAnswer, item.expectedText, `${item.id}: quiz leaves another error`)
    }
  }
})

test('frequency and name-list rules leave correct and ambiguous usage alone', () => {
  for (const text of ['She wears everyday clothes.', 'She walks to school every day.', 'She walks to school everyday clothes.', 'I walked with salt pepper and sugar.', 'Harry walks with Ann, Billy, and Mike.']) {
    assert.equal(inspectWritingFindings(text).filter((finding) => ['every-day-frequency', 'simple-list-commas'].includes(finding.ruleId)).length, 0, text)
  }
})
