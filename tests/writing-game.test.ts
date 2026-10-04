import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceFindingProgress,
  evaluateWritingChoice,
  inspectDraft,
  scoreWritingResponses,
  writingReviewStatus,
} from '../src/writing.ts'

test('an all-wrong round still records participation, feedback, and a zero-percent score', () => {
  const finding = inspectDraft('She play games.')[0]
  const trials = [finding.correction, ...finding.practice]
  let progress = { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }

  for (const trial of trials) {
    const wrongChoice = trial.choices.find((choice) => choice !== trial.correctAnswer)
    assert.ok(wrongChoice)
    const feedback = evaluateWritingChoice(trial, wrongChoice)
    assert.equal(feedback.correct, false)
    assert.equal(feedback.correctAnswer, trial.correctAnswer)
    assert.match(feedback.summary, /correct answer is/)
    assert.equal(feedback.explanation.length >= 35, true)
    progress = advanceFindingProgress(progress, feedback.correct, finding.practice.length)
  }

  assert.equal(progress.correctionComplete, true)
  assert.equal(progress.practiceCompleted, 5)
  assert.equal(progress.incorrectAttempts, 6)
  assert.equal(writingReviewStatus([finding], { [finding.id]: progress }, [], {}), 'complete')
  assert.deepEqual(scoreWritingResponses([finding], { [finding.id]: progress }), {
    correct: 0,
    total: 6,
    percent: 0,
    cumulativePercent: [0, 0, 0, 0, 0, 0],
  })
})

test('every generated answer set has exactly one reviewed correct choice', () => {
  const drafts = [
    'Yesterday I walk home.',
    'She play games.',
    'They plays games.',
    'I ate a apple.',
    'I read an book.',
    'This books fell.',
    'She helped themselves.',
    'today we begin.',
    'My friend and i left.',
    'We meet on MONDAY.',
    'dr. smith arrived.',
    'I dont know.',
    'After I finished my work I played outside.',
    'I packed socks shoes and books.',
    'Maya said, “Hello.',
    'The project is finished',
    'She has write three pages.',
    'Yesterday, she walked and plays outside.',
    'Either Maya nor Leo will present.',
    'Please come with I.',
    'Wow that was close!',
    'Thanks Mom.',
  ]

  for (const finding of drafts.flatMap((draft) => inspectDraft(draft))) {
    assert.equal(finding.practice.length, 5)
    for (const trial of [finding.correction, ...finding.practice]) {
      assert.equal(new Set(trial.choices).size, 3, `${trial.id} should have three unique choices`)
      assert.equal(trial.choices.filter((choice) => choice === trial.correctAnswer).length, 1)
      assert.equal(evaluateWritingChoice(trial, trial.correctAnswer).correct, true)
      for (const choice of trial.choices.filter((item) => item !== trial.correctAnswer)) {
        assert.equal(evaluateWritingChoice(trial, choice).correct, false)
      }
    }
  }
})
