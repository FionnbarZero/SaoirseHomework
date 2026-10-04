import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OPTIONAL_TARGETS,
  activeRequiredActivities,
  dayIsComplete,
  defaultState,
  getFridayFunSummary,
  optionalSessionKey,
  type AppState,
} from '../src/domain.ts'
import {
  advanceFindingProgress,
  applyCompletedCorrections,
  inspectAmbiguousDraft,
  inspectDraft,
  inspectWritingFindings,
  scoreWritingResponses,
  writingReviewStatus,
} from '../src/writing.ts'

test('optional sessions have stable unique keys', () => {
  assert.equal(optionalSessionKey('voena', 0), 'voena:0')
  assert.notEqual(optionalSessionKey('voena', 0), optionalSessionKey('voena', 1))
})

test('a day needs required work and its cumulative practice target', () => {
  const mondayRequired = activeRequiredActivities().map((activity) => activity.id)
  const state: AppState = {
    ...structuredClone(defaultState),
    requiredByDay: { ...defaultState.requiredByDay, Monday: mondayRequired },
    optionalCompleted: Array.from({ length: OPTIONAL_TARGETS.Monday }, (_, index) => `session:${index}`),
  }

  assert.equal(dayIsComplete(state, 'Monday'), true)
  assert.equal(dayIsComplete({ ...state, optionalCompleted: state.optionalCompleted.slice(1) }, 'Monday'), false)
})

test('the local writing check finds supported capitalization and punctuation issues', () => {
  const findings = inspectDraft('today I wrote a story')
  assert.deepEqual(findings.map((finding) => finding.category), ['Capitalization', 'Punctuation'])
  assert.equal(inspectDraft('Today I wrote a story.').length, 0)
})

test('the deterministic writing rules cover high-confidence grammar cases', () => {
  const findings = inspectDraft('Yesterday I walk home. She play games with this books.')
  assert.deepEqual(
    findings.filter((finding) => finding.category === 'Grammar').map((finding) => finding.ruleId),
    ['tense-yesterday', 'subject-verb-singular', 'demonstrative-agreement'],
  )
  assert.equal(findings.every((finding) => finding.practice.length === 3), true)
  assert.equal(findings.every((finding) => finding.correction.choices.length === 3), true)
  assert.equal(inspectDraft('Yesterday I walked home. She plays games with these books.').length, 0)
})

test('sentence-start contractions and articles keep their capitalization', () => {
  const contraction = inspectDraft('im ready.')[0]
  const article = inspectDraft('A apple fell.')[0]
  assert.equal(contraction.ruleId, 'contraction-apostrophe')
  assert.equal(contraction.replacement, 'I’m')
  assert.equal(article.ruleId, 'article-an')
  assert.equal(article.replacement, 'An')
})

test('high-confidence agreement and simple-list rules produce exact replacements', () => {
  const findings = inspectDraft('She helped themselves. I packed socks shoes and books.')
  assert.equal(findings.find((finding) => finding.ruleId === 'pronoun-agreement')?.replacement, 'herself')
  assert.equal(
    findings.find((finding) => finding.ruleId === 'simple-list-commas')?.replacement,
    'I packed socks, shoes, and books',
  )
  assert.equal(inspectDraft('An book fell.')[0].replacement, 'A')
})

test('reviewed Grade 5 patterns cover perfect tense, tense consistency, conjunction pairs, and punctuation', () => {
  const samples = [
    ['She has write three pages.', 'perfect-tense-participle', 'written'],
    ['Yesterday, she walked and plays outside.', 'past-tense-consistency', 'played'],
    ['Either Maya nor Leo will present.', 'correlative-conjunction', 'or'],
    ['Please come with I.', 'object-pronoun-after-preposition', 'me'],
    ['Wow that was close!', 'interjection-comma', ', '],
    ['Thanks Mom.', 'direct-address-comma', ', '],
  ]

  for (const [body, ruleId, replacement] of samples) {
    const finding = inspectDraft(body).find((item) => item.ruleId === ruleId)
    assert.ok(finding, `${ruleId} should be detected`)
    assert.equal(finding.replacement, replacement)
    assert.equal(finding.practice.length, 3)
  }

  assert.equal(inspectDraft('She has written three pages.').length, 0)
  assert.equal(inspectDraft('Neither rain nor wind stopped us.').length, 0)
})

test('the multiple-choice review represents grammar, capitalization, punctuation, and spelling findings', () => {
  const findings = inspectWritingFindings(
    'Yesterday I walk home. today I packed socks shoes and books. I saw my freind.',
  )
  assert.deepEqual(
    [...new Set(findings.map((finding) => finding.category))].sort(),
    ['Capitalization', 'Grammar', 'Punctuation', 'Spelling'],
  )
  const spelling = findings.find((finding) => finding.category === 'Spelling')
  assert.ok(spelling)
  assert.equal(spelling.replacement, 'friend')
  assert.equal(spelling.practice.length, 3)
})

test('accepted writing corrections build a separate copy and require three practice answers', () => {
  const body = 'today i play with this books'
  const findings = inspectDraft(body)
  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: 3,
    incorrectAttempts: 1,
  }]))
  const corrected = applyCompletedCorrections(body, findings, progress)

  assert.equal(body, 'today i play with this books')
  assert.equal(corrected, 'Today I play with these books.')
  assert.equal(writingReviewStatus(findings, progress), 'spelling-pending')
  const first = findings[0]
  assert.equal(writingReviewStatus(findings, { ...progress, [first.id]: { ...progress[first.id], practiceCompleted: 2 } }), 'practice')
})

test('each resolved trial advances once while its first-attempt score is preserved', () => {
  const initial = { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }
  const wrongCorrection = advanceFindingProgress(initial, false)
  const corrected = advanceFindingProgress(wrongCorrection, true)
  const wrongPractice = advanceFindingProgress(corrected, false)
  const practiced = advanceFindingProgress(wrongPractice, true)

  assert.deepEqual(wrongCorrection, {
    correctionComplete: true,
    practiceCompleted: 0,
    incorrectAttempts: 1,
    attemptResults: [false],
  })
  assert.deepEqual(wrongPractice, {
    correctionComplete: true,
    practiceCompleted: 2,
    incorrectAttempts: 2,
    attemptResults: [false, true, false],
  })
  assert.deepEqual(practiced, {
    correctionComplete: true,
    practiceCompleted: 3,
    incorrectAttempts: 2,
    attemptResults: [false, true, false, true],
  })
})

test('the checker fails closed on ambiguous read tense and fixes audited capitalization and punctuation cases', () => {
  assert.deepEqual(inspectDraft('Yesterday she read a book.'), [])
  assert.deepEqual(inspectDraft('She read the book last night.'), [])
  assert.deepEqual(
    inspectDraft('He said "hello"').map((finding) => [finding.ruleId, finding.replacement]),
    [['terminal-punctuation', '."']],
  )
  assert.deepEqual(
    inspectDraft('MONDAY and DR. Lee met dr. smith.').map((finding) => [finding.ruleId, finding.replacement]),
    [
      ['calendar-capital', 'Monday'],
      ['title-capital', 'Dr. Lee'],
      ['title-capital', 'Dr. Smith'],
    ],
  )
})

test('every personalized finding creates three reviewed multiple-choice trials with one declared answer', () => {
  const samples = [
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
    'The main character Eddie went to the store bought a hamster it died and he was sad.',
  ]
  const findings = samples.flatMap((sample) => inspectDraft(sample))
  const ruleIds = new Set(findings.map((finding) => finding.ruleId))
  assert.deepEqual([...ruleIds].sort(), [
    'appositive-name-commas',
    'article-a',
    'article-an',
    'calendar-capital',
    'compound-predicate-conjunction',
    'compound-sentence-comma',
    'contraction-apostrophe',
    'correlative-conjunction',
    'demonstrative-agreement',
    'direct-address-comma',
    'fused-sentence-break',
    'interjection-comma',
    'intro-comma',
    'object-pronoun-after-preposition',
    'paired-quotes',
    'past-tense-consistency',
    'perfect-tense-participle',
    'pronoun-agreement',
    'pronoun-i',
    'sentence-capital',
    'simple-list-commas',
    'subject-verb-plural',
    'subject-verb-singular',
    'tense-yesterday',
    'terminal-punctuation',
    'title-capital',
  ])
  for (const finding of findings) {
    assert.equal(finding.practice.length, 3, `${finding.ruleId} should have three similar trials`)
    for (const trial of finding.practice) {
      assert.equal(trial.choices.length, 3, `${trial.id} should have three choices`)
      assert.equal(new Set(trial.choices).size, 3, `${trial.id} choices should be unique`)
      assert.equal(
        trial.choices.filter((choice) => choice === trial.correctAnswer).length,
        1,
        `${trial.id} should contain its declared correct answer exactly once`,
      )
      assert.equal(inspectDraft(trial.correctAnswer).length, 0, `${trial.id} declares a sentence the checker flags`)
      assert.equal(trial.explanation.length >= 35, true, `${trial.id} should explain the rule`)
    }
  }
})

test('writing score records response accuracy and produces cumulative line-graph points', () => {
  const finding = inspectDraft('She play games.')[0]
  const score = scoreWritingResponses([finding], {
    [finding.id]: {
      correctionComplete: true,
      practiceCompleted: 3,
      incorrectAttempts: 2,
      attemptResults: [false, true, false, true],
    },
  })
  assert.deepEqual(score, {
    correct: 2,
    total: 4,
    percent: 50,
    cumulativePercent: [0, 50, 33, 50],
  })
})

test('the parent dictionary supplies exact capitalization without guessing', () => {
  const findings = inspectDraft('fionnbar visited san francisco.', {
    knownNames: ['Fionnbar'],
    knownPlaces: ['San Francisco'],
  })
  assert.deepEqual(findings.map((finding) => finding.ruleId), ['known-name', 'known-place'])
  assert.deepEqual(findings.map((finding) => finding.replacement), ['Fionnbar', 'San Francisco'])
})

test('story introductions identify proper names and capitalize every repeated use', () => {
  const findings = inspectDraft(
    'The main characted eddie went to the store. Later, eddie said he was ready.',
  ).filter((finding) => finding.ruleId === 'known-name')

  assert.deepEqual(findings.map((finding) => finding.replacement), ['Eddie', 'Eddie'])
  assert.equal(findings.every((finding) => finding.category === 'Capitalization'), true)
  assert.equal(findings.every((finding) => finding.practice.length === 3), true)
  assert.equal(findings[0].correction.correctAnswer.includes('Eddie'), true)
  assert.equal(inspectDraft('The main character went home.').some((finding) => finding.ruleId === 'known-name'), false)
  assert.equal(
    inspectDraft('The main character Eddie went home. Later, eddie rested.')
      .filter((finding) => finding.ruleId === 'known-name').length,
    1,
  )
})

test('the checker repairs the audited Eddie passage without teaching comma splices', () => {
  const body = 'The main characted eddie went to the store cbouts a hambester it dies and he was sad.'
  const findings = inspectWritingFindings(body)
  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
  }]))

  assert.equal(findings.find((finding) => finding.ruleId === 'spelling-reviewed-cbouts')?.replacement, 'bought')
  assert.equal(findings.filter((finding) => finding.ruleId === 'appositive-name-commas').length, 2)
  assert.equal(findings.some((finding) => finding.ruleId === 'compound-predicate-conjunction'), true)
  assert.equal(findings.some((finding) => finding.ruleId === 'fused-sentence-break'), true)
  assert.equal(findings.some((finding) => finding.ruleId === 'compound-sentence-comma'), true)
  assert.equal(
    applyCompletedCorrections(body, findings, progress),
    'The main character, Eddie, went to the store and bought a hamster. It died, and he was sad.',
  )
})

test('ambiguous writing suggestions enter a non-blocking parent review queue', () => {
  const items = inspectAmbiguousDraft('I saw the the sign. Yesterday I go home.')
  assert.deepEqual(items.map((item) => item.id.split('-').slice(0, -1).join('-')), ['repeated-word', 'irregular-tense'])
  assert.equal(items.every((item) => item.message.includes('may') || item.message.includes('should review')), true)
})

test('Friday Fun stays locked until Friday work and all practice are complete', () => {
  const fridayRequired = activeRequiredActivities().map((activity) => activity.id)
  const state: AppState = {
    ...structuredClone(defaultState),
    requiredByDay: { ...defaultState.requiredByDay, Friday: fridayRequired },
    optionalCompleted: Array.from({ length: 8 }, (_, index) => `session:${index}`),
    drafts: [{
      id: 'draft-1',
      title: 'Friday story',
      body: 'Five carefully chosen words.',
      updatedAt: '2026-10-09T16:00:00.000Z',
      findings: [],
    }],
  }

  assert.equal(getFridayFunSummary(state).unlocked, false)
  state.optionalCompleted.push('session:8')
  const summary = getFridayFunSummary(state)
  assert.equal(summary.unlocked, true)
  assert.equal(summary.optionalCompleted, 9)
  assert.equal(summary.writingDrafts, 1)
  assert.equal(summary.writingWords, 4)
  assert.equal(summary.rewardsEarned, 9)
})
