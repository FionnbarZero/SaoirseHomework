import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCompletedSpellingCorrections,
  completedSpellingSteps,
  inspectSpelling,
  inspectSpellingFindings,
  nextSpellingStep,
  spellingPracticeComplete,
  submitSpellingAnswer,
  type SpellingPhase,
} from '../src/spelling.ts'
import { writingReviewStatus } from '../src/writing.ts'
import type { SpellingProgress } from '../src/domain.ts'

test('spelling inspection recognizes only reviewed misspellings and groups repeated words', () => {
  const words = inspectSpelling('Teh freind saw teh wierd sign. An unknownword stayed unchanged.')
  assert.deepEqual(words.map((word) => [word.word, word.correctWord, word.occurrences]), [
    ['teh', 'the', 2],
    ['freind', 'friend', 1],
    ['wierd', 'weird', 1],
  ])
  assert.deepEqual(inspectSpelling('Teh met a freind.', { knownNames: ['Teh'], knownPlaces: [] })
    .map((word) => word.word), ['freind'])
})

test('reviewed misspellings become child-sentence plus three multiple-choice reviews', () => {
  const findings = inspectSpellingFindings('I saw my freind. Eddie cbouts a hambester and met a whitch.')
  assert.deepEqual(findings.map((finding) => finding.replacement), ['friend', 'bought', 'hamster', 'witch'])
  for (const finding of findings) {
    assert.equal(finding.category, 'Spelling')
    assert.equal(finding.practice.length, 3)
    for (const trial of [finding.correction, ...finding.practice]) {
      assert.equal(new Set(trial.choices).size, 3)
      assert.equal(trial.choices.filter((choice) => choice === trial.correctAnswer).length, 1)
    }
    assert.equal(finding.practice.every((trial) => trial.correctAnswer.includes(finding.replacement)), true)
  }
  assert.equal(new Set(findings.flatMap((finding) => finding.practice.map((trial) => trial.correctAnswer))).size, 12)
})

test('spelling adapter requires copy, hidden, and mixed phases in order', () => {
  const words = inspectSpelling('Teh freind arrived.')
  let progress: Record<string, SpellingProgress> = {}
  const sequence: Array<[string, SpellingPhase, number]> = []

  const first = nextSpellingStep(words, progress)
  assert.ok(first)
  const wrong = submitSpellingAnswer(words, progress, first, 'wrong')
  assert.equal(wrong.correct, false)
  assert.equal(wrong.progress[first.wordId].copyCompleted, 0)
  assert.equal(wrong.progress[first.wordId].incorrectAttempts, 1)
  progress = wrong.progress

  for (let step = nextSpellingStep(words, progress); step; step = nextSpellingStep(words, progress)) {
    const word = words.find((item) => item.id === step.wordId)
    assert.ok(word)
    sequence.push([word.word, step.phase, step.attempt])
    const result = submitSpellingAnswer(words, progress, step, word.correctWord)
    assert.equal(result.correct, true)
    progress = result.progress
  }

  assert.deepEqual(sequence.slice(0, 6), [
    ['teh', 'copy', 1], ['teh', 'copy', 2], ['teh', 'copy', 3],
    ['teh', 'hidden', 1], ['teh', 'hidden', 2], ['teh', 'hidden', 3],
  ])
  assert.deepEqual(sequence.slice(12), [
    ['teh', 'mixed', 1], ['freind', 'mixed', 1],
    ['teh', 'mixed', 2], ['freind', 'mixed', 2],
    ['teh', 'mixed', 3], ['freind', 'mixed', 3],
  ])
  assert.equal(completedSpellingSteps(words, progress), 18)
  assert.equal(spellingPracticeComplete(words, progress), true)
  assert.equal(applyCompletedSpellingCorrections('Teh freind thanked teh friend.', words, progress), 'The friend thanked the friend.')
})

test('writing completion remains fail-closed until spelling practice finishes', () => {
  const words = inspectSpelling('I recieve a letter.')
  assert.equal(writingReviewStatus([], {}, undefined, {}), 'spelling-pending')
  assert.equal(writingReviewStatus([], {}, [], {}), 'complete')
  assert.equal(writingReviewStatus([], {}, words, {}), 'spelling-pending')

  const complete = Object.fromEntries(words.map((word) => [word.id, {
    copyCompleted: 3,
    hiddenCompleted: 3,
    mixedCompleted: 3,
    incorrectAttempts: 2,
  }]))
  assert.equal(writingReviewStatus([], {}, words, complete), 'complete')
  assert.equal(writingReviewStatus([], {}, [], {}, 1), 'awaiting-review')
})
