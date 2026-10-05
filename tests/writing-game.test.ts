import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceFindingProgress,
  draftBelongsToWritingActivity,
  evaluateWritingChoice,
  inspectDraft,
  inspectWritingFindings,
  resolveWritingChoice,
  scoreWritingResponses,
  selectedMeaningMatches,
  skipRemainingWritingTrials,
  writingActivityKey,
  writingReviewStatus,
} from '../src/writing.ts'

test('writing drafts belong only to their homework day', () => {
  const mondayKey = writingActivityKey('2026-09-28', 'Monday')
  const tuesdayKey = writingActivityKey('2026-09-28', 'Tuesday')
  const mondayDraft = {
    activityKey: mondayKey,
    updatedAt: '2026-09-28T20:00:00.000Z',
  }

  assert.equal(draftBelongsToWritingActivity(mondayDraft, mondayKey), true)
  assert.equal(draftBelongsToWritingActivity(mondayDraft, tuesdayKey), false)
})

test('an unkeyed legacy draft stays in history instead of reopening in a new daily editor', () => {
  const activityKey = writingActivityKey('2026-09-28', 'Monday')
  const legacyDraft = { updatedAt: '2026-09-28T20:00:00.000Z' }

  assert.equal(draftBelongsToWritingActivity(legacyDraft, activityKey), false)
})

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
    'I Walked home.',
    'The lady there, was kind.',
    'She was kind, she went home.',
    'Maya said, “That was close!” I got.',
    'He asked, “what up?”',
  ]

  for (const finding of drafts.flatMap((draft) => inspectWritingFindings(draft))) {
    assert.equal(finding.practice.length, 3)
    if (!finding.ruleId.startsWith('spelling-reviewed-')) {
      assert.equal(new Set(finding.correction.choices).size, 2, `${finding.correction.id} should compare the original with one exact correction`)
    }
    for (const trial of finding.practice) {
      assert.equal(new Set(trial.choices).size, 3, `${trial.id} should have three reviewed choices`)
    }
    for (const trial of [finding.correction, ...finding.practice]) {
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

test('a multi-error sentence isolates one yellow error while every other part is corrected', () => {
  const body = 'harry and ron walks to qidch practise with ann billy and mike'
  const replacements = [
    ['harry', 'Harry', 'Capitalization'],
    ['ron', 'Ron', 'Capitalization'],
    ['walks', 'walk', 'Grammar'],
    ['qidch', 'Quidditch', 'Spelling'],
    ['practise', 'practice', 'Spelling'],
    ['ann billy and mike', 'Ann, Billy, and Mike.', 'Punctuation'],
  ] as const
  const matches = replacements.map(([original, replacement, category], index) => ({
    offset: body.indexOf(original),
    length: original.length,
    message: `Correct ${original}.`,
    shortMessage: `Correct ${original}.`,
    replacements: [replacement],
    ruleId: `AI_EXAMPLE_${index}`,
    category,
    issueType: category.toLowerCase(),
    source: 'ai' as const,
    verification: 'verified' as const,
    confidence: 'high' as const,
  }))
  const findings = inspectWritingFindings(body, undefined, matches)
  const first = findings.find((finding) => finding.replacement === 'Harry')
  const list = findings.find((finding) => finding.replacement === 'Ann')

  assert.ok(first?.correction.focus)
  assert.equal(first.correction.focus.text, 'harry and Ron walk to Quidditch practice with Ann, Billy, and Mike.')
  assert.equal(
    first.correction.focus.text.slice(first.correction.focus.start, first.correction.focus.end),
    'harry',
  )
  assert.ok(list?.correction.focus)
  assert.equal(list.correction.focus.text, 'Harry and Ron walk to Quidditch practice with ann, Billy, and Mike.')
  assert.equal(
    list.correction.focus.text.slice(list.correction.focus.start, list.correction.focus.end),
    'ann',
  )
})

test('the local checker still finds plural agreement when the conjunction is misspelled', () => {
  const body = 'harry adn ron walks to qidch practise.'
  const findings = inspectWritingFindings(body)

  const hasCorrection = (original: string, replacement: string) => findings.some((finding) => (
    body.slice(finding.start, finding.end) === original && finding.replacement === replacement
  ))

  assert.equal(hasCorrection('adn', 'and'), true)
  assert.equal(hasCorrection('walks', 'walk'), true)
  assert.equal(hasCorrection('qidch', 'Quidditch'), true)
  assert.equal(hasCorrection('practise', 'practice'), true)
})

test('confirmed sentence meaning becomes verified corrections for the quiz', () => {
  const reviews = [{
    id: 'sentence-0-15',
    start: 0,
    end: 15,
    original: 'harry walks.',
    highlights: [{ start: 0, end: 5 }],
    attempt: 1,
    selectedOptionId: 'option-1',
    selectedText: 'Harry walks.',
    options: [{
      id: 'option-1',
      text: 'Harry walks.',
      edits: [{
        offset: 0,
        length: 5,
        replacement: 'Harry',
        category: 'Capitalization' as const,
        message: 'Capitalize the name.',
        explanation: 'A person’s name begins with a capital letter.',
      }],
    }],
  }]
  const matches = selectedMeaningMatches(reviews)

  assert.equal(matches.length, 1)
  assert.equal(matches[0].offset, 0)
  assert.equal(matches[0].replacements[0], 'Harry')
  assert.equal(matches[0].verification, 'verified')

  const spellingMatches = selectedMeaningMatches([{
    ...reviews[0],
    selectedOptionId: 'spelling-option',
    options: [{
      id: 'spelling-option',
      text: 'Harry walks.',
      edits: [{
        offset: 0,
        length: 5,
        replacement: 'Harry',
        category: 'Spelling' as const,
        message: 'Spell the name correctly.',
        explanation: 'Use the reviewed spelling.',
      }],
    }],
  }])
  const spellingFindings = inspectWritingFindings('harry walks.', undefined, spellingMatches)
  assert.equal(spellingFindings[0].category, 'Spelling')
})
