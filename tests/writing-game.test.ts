import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceFindingProgress,
  evaluateWritingChoice,
  inspectDraft,
  inspectWritingFindings,
  resolveWritingChoice,
  scoreWritingResponses,
  skipRemainingWritingTrials,
  writingReviewStatus,
} from '../src/writing.ts'

test('a wrong first attempt must be corrected but the correction does not change its score', () => {
  const finding = inspectDraft('She play games.')[0]
  const trials = [finding.correction, ...finding.practice]
  let progress = { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }

  for (const trial of trials) {
    const wrongChoice = trial.choices.find((choice) => choice !== trial.correctAnswer)
    assert.ok(wrongChoice)
    const firstAttempt = resolveWritingChoice(trial, wrongChoice)
    assert.equal(firstAttempt.firstAttemptCorrect, false)
    assert.equal(firstAttempt.resolved, false)
    assert.equal(firstAttempt.feedback.correctAnswer, trial.correctAnswer)
    assert.match(firstAttempt.feedback.summary, /Select that answer to continue/)
    assert.equal(firstAttempt.feedback.explanation.length >= 35, true)

    const correction = resolveWritingChoice(trial, trial.correctAnswer, firstAttempt)
    assert.equal(correction.resolved, true)
    assert.equal(correction.firstAttemptCorrect, false)
    assert.equal(correction.feedback.correct, true)
    assert.match(correction.feedback.summary, /Corrected/)
    progress = advanceFindingProgress(
      progress,
      correction.firstAttemptCorrect,
      finding.practice.length,
    )
  }

  assert.equal(progress.correctionComplete, true)
  assert.equal(progress.practiceCompleted, 3)
  assert.equal(progress.incorrectAttempts, 4)
  assert.equal(writingReviewStatus([finding], { [finding.id]: progress }, [], {}), 'complete')
  assert.deepEqual(scoreWritingResponses([finding], { [finding.id]: progress }), {
    correct: 0,
    total: 4,
    percent: 0,
    cumulativePercent: [0, 0, 0, 0],
  })
})

test('a correct first attempt resolves immediately and earns credit', () => {
  const finding = inspectDraft('She play games.')[0]
  const answer = resolveWritingChoice(finding.correction, finding.correction.correctAnswer)

  assert.equal(answer.resolved, true)
  assert.equal(answer.firstAttemptCorrect, true)
  assert.equal(answer.feedback.correct, true)
})

test('development skip preserves answered results and scores every unanswered trial incorrect', () => {
  const finding = inspectDraft('She play games.')[0]
  const skipped = skipRemainingWritingTrials([finding], {
    [finding.id]: {
      correctionComplete: true,
      practiceCompleted: 1,
      incorrectAttempts: 0,
      attemptResults: [true, true],
    },
  })[finding.id]

  assert.equal(skipped.correctionComplete, true)
  assert.equal(skipped.practiceCompleted, 3)
  assert.deepEqual(skipped.attemptResults, [true, true, false, false])
  assert.equal(skipped.incorrectAttempts, 2)
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
    'I saw my freind.',
  ]

  for (const finding of drafts.flatMap((draft) => inspectWritingFindings(draft))) {
    assert.equal(finding.practice.length, 3)
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

test('repeated errors of the same rule receive new reviewed practice sets', () => {
  const repeated = inspectDraft('She play games. He walk home. It run fast.')
    .filter((finding) => finding.ruleId === 'subject-verb-singular')

  assert.equal(repeated.length, 3)
  assert.deepEqual(
    repeated.map((finding) => finding.practice.map((trial) => trial.id)),
    [
      ['subject-verb-singular-1', 'subject-verb-singular-2', 'subject-verb-singular-3'],
      ['subject-verb-singular-4', 'subject-verb-singular-5', 'subject-verb-singular-6'],
      ['subject-verb-singular-7', 'subject-verb-singular-8', 'subject-verb-singular-9'],
    ],
  )
  assert.equal(new Set(repeated.flatMap((finding) => finding.practice.map((trial) => trial.correctAnswer))).size, 9)
})
