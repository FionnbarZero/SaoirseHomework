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

test('the Huck paragraph exposes every supported error category in one pass', () => {
  const body = 'huck lived with an old widow she triend to make him an honest boy. He really hated living withher becasue she made him pray. he servant ran away, adn he happened to be on the same island as Jim and so they ran away together they had a good time togther they build a raft went fishing and scared off criminils.'
  const findings = inspectWritingFindings(body)
  assert.deepEqual(
    new Set(findings.map((finding) => finding.category)),
    new Set(['Capitalization', 'Grammar', 'Punctuation', 'Spelling']),
  )
  assert.equal(findings.filter((finding) => finding.ruleId === 'fused-sentence-break').length, 3)
  assert.equal(findings.filter((finding) => finding.ruleId === 'series-actions-commas').length, 2)
  assert.ok(findings.some((finding) => finding.ruleId === 'past-tense-consistency'))

  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
  }]))
  const corrected = applyCompletedCorrections(body, findings, progress)
  assert.match(corrected, /old widow\. She tried/)
  assert.match(corrected, /ran away together\. They had a good time together\. They built a raft, went fishing, and scared off criminals\./)

  const ambiguous = inspectAmbiguousDraft(body)
  assert.ok(ambiguous.some((item) => item.ruleId === 'pronoun-before-noun'))
})

test('the Wings of Fire paragraph catches its run-on and malformed adjective clause', () => {
  const body = `Tsunami's friends were in a cave, and there was a storm that was coming up so she tried to get them out of the cave, but the guards wouldn't let them come out they wouldn't give her the key and so she finally convinced them, but then they were really scared the queen coral was going to fire them or hurt them so tsunami backed her mother into a corner to make sure that she wasn't going to hurt the guards that let her friends go. She said mother isn't an amazing that these guards followed your commands and your brother shark did not.  Her mother said yes, that is quite true. `
  const findings = inspectWritingFindings(body)
  assert.ok(findings.some((finding) => finding.ruleId === 'fused-sentence-break'))
  assert.ok(findings.some((finding) => finding.ruleId === 'dummy-pronoun-it' && finding.category === 'Grammar'))
  assert.equal(findings.some((finding) => finding.ruleId === 'known-name' && finding.replacement === 'Mother'), false)

  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
  }]))
  const corrected = applyCompletedCorrections(body, findings, progress)
  assert.match(corrected, /come out\. They wouldn't give her the key/)
  assert.match(corrected, /mother isn't it amazing that/)
})

test('the deterministic writing rules cover high-confidence grammar cases', () => {
  const findings = inspectDraft('Yesterday I walk home. She play games with this books.')
  assert.deepEqual(
    findings.filter((finding) => finding.category === 'Grammar').map((finding) => finding.ruleId),
    ['tense-yesterday', 'subject-verb-singular', 'demonstrative-agreement'],
  )
  assert.equal(findings.every((finding) => finding.practice.length === 3), true)
  assert.equal(findings.every((finding) => finding.correction.choices.length === 2), true)
  assert.equal(inspectDraft('Yesterday I walked home. She plays games with these books.').length, 0)
})

test('capitalization quizzes use exact corrections and realistic reviewed distractors', () => {
  const sentenceStart = inspectDraft('today we begin.').find((finding) => finding.ruleId === 'sentence-capital')
  const midword = inspectDraft('I Walked home.').find((finding) => finding.ruleId === 'unexpected-midword-capital')
  assert.ok(sentenceStart)
  assert.ok(midword)

  assert.deepEqual(new Set(sentenceStart.correction.choices), new Set([
    'today we begin.',
    'Today we begin.',
  ]))
  for (const trial of [...sentenceStart.practice, ...midword.practice]) {
    assert.equal(
      trial.choices.some((choice) => /\b[A-Z]{2}[a-z]/.test(choice)),
      false,
      `${trial.id} should not contain a mechanically mangled mixed-case word`,
    )
  }
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
  assert.deepEqual(findings.filter((finding) => finding.ruleId === 'simple-list-commas')
    .map((finding) => finding.replacement), [',', ','])
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
    [
      ['dialogue-introduction-comma', ', '],
      ['quotation-capitalization', 'H'],
      ['quotation-punctuation-inside', '."'],
    ],
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

test('the checker recognizes missing and incorrectly punctuated direct quotations', () => {
  const samples = [
    ['Maya said "hello".', 'Maya said, "Hello."'],
    ['Maya said, “Hello”.', 'Maya said, “Hello.”'],
    ['“Hello.” Maya said.', '“Hello,” Maya said.'],
    ['Maya said, “Hello.', 'Maya said, “Hello.”'],
    ['Maya said, Hello.”', 'Maya said, “Hello.”'],
  ]

  for (const [body, expected] of samples) {
    const findings = inspectDraft(body)
    const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
      correctionComplete: true,
      practiceCompleted: finding.practice.length,
      incorrectAttempts: 0,
    }]))
    assert.equal(applyCompletedCorrections(body, findings, progress), expected)
    assert.equal(findings.every((finding) => finding.practice.length === 3), true)
  }

  const childPassage = 'The lady therewas nice she said what a bueatiful fish I got. I was happy. and then the gus was like. what up!'
  const findings = inspectDraft(childPassage)
  const dialogueFindings = findings.filter((finding) => finding.ruleId === 'missing-dialogue-quotes')
  assert.equal(dialogueFindings.length, 1)
  assert.equal(findings.filter((finding) => finding.ruleId === 'whats-up-contraction').length, 1)
  assert.equal(
    findings.filter((finding) => ['missing-dialogue-quotes', 'whats-up-contraction'].includes(finding.ruleId))
      .every((finding) => finding.additionalEdits?.length === 1),
    true,
  )

  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
  }]))
  assert.equal(
    applyCompletedCorrections(childPassage, findings, progress),
    'The lady therewas nice she said, “What a bueatiful fish I got.” I was happy. And then the gus was like, “What’s up!”',
  )
})

test('the checker repairs the reported goldfish passage without trusting the first spelling suggestion', () => {
  const body = 'I Walked to the store and I bought a goldfish. The lady there, was nice,  she said, "what a bueatiful fish!" I got. I was happy. And then I went next door and bought a soda, the gus was like. what up!'
  const findings = inspectWritingFindings(body, undefined, [
    {
      offset: body.indexOf('bueatiful'),
      length: 'bueatiful'.length,
      message: 'Possible spelling mistake found.',
      shortMessage: 'Spelling mistake',
      replacements: ['beautiful'],
      ruleId: 'MORFOLOGIK_RULE_EN_US',
      category: 'Possible Typo',
      issueType: 'misspelling',
      source: 'ai',
      verification: 'verified',
    },
    {
      offset: body.indexOf('gus'),
      length: 'gus'.length,
      message: 'Possible spelling mistake found.',
      shortMessage: 'Spelling mistake',
      replacements: ['guy'],
      ruleId: 'AI_CONTEXTUAL_SPELLING',
      category: 'Spelling',
      issueType: 'ai-spelling',
      source: 'ai',
      verification: 'verified',
    },
    {
      offset: body.indexOf('what up'),
      length: 'what'.length,
      message: 'It seems that a verb is missing after “what”.',
      shortMessage: '',
      replacements: ['what is'],
      ruleId: 'MISSING_VERB_AFTER_WHAT',
      category: 'Grammar',
      issueType: 'grammar',
    },
  ])

  const requiredRules = [
    'unexpected-midword-capital',
    'subject-verb-comma',
    'comma-splice',
    'quotation-capitalization',
    'stray-followup-fragment',
    'whats-up-contraction',
  ]
  for (const ruleId of requiredRules) {
    assert.ok(findings.some((finding) => finding.ruleId === ruleId), `${ruleId} should be detected`)
  }
  assert.equal(findings.filter((finding) => finding.ruleId === 'comma-splice').length, 2)
  assert.equal(findings.find((finding) => finding.start === body.indexOf('gus'))?.replacement, 'guy')
  assert.equal(findings.find((finding) => finding.start === body.indexOf('gus'))?.practice.length, 3)
  assert.equal(findings.every((finding) => finding.correction.choices.includes(finding.correction.correctAnswer)), true)

  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
  }]))
  assert.equal(
    applyCompletedCorrections(body, findings, progress),
    'I walked to the store and I bought a goldfish. The lady there was nice. She said, "What a beautiful fish!" I was happy. And then I went next door and bought a soda. The guy was like, “What’s up!”',
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
    'I Walked home.',
    'The lady there, was kind.',
    'She was kind, she went home.',
    'Maya said, “That was close!” I got.',
    'He asked, “what up?”',
  ]
  const findings = samples.flatMap((sample) => inspectDraft(sample))
  const ruleIds = new Set(findings.map((finding) => finding.ruleId))
  assert.deepEqual([...ruleIds].sort(), [
    'appositive-name-commas',
    'article-a',
    'article-an',
    'calendar-capital',
    'comma-splice',
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
    'stray-followup-fragment',
    'subject-verb-comma',
    'subject-verb-plural',
    'subject-verb-singular',
    'tense-yesterday',
    'terminal-punctuation',
    'title-capital',
    'unexpected-midword-capital',
    'whats-up-contraction',
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

test('local proofreader candidates never override reviewed corrections or enter child practice', () => {
  const body = 'Eddie cbouts a qwick snack.'
  const findings = inspectWritingFindings(body, undefined, [
    {
      offset: 6,
      length: 6,
      message: 'Possible spelling mistake found.',
      shortMessage: '',
      replacements: ['bouts', 'clouts'],
      ruleId: 'MORFOLOGIK_RULE_EN_US',
      category: 'Possible Typo',
      issueType: 'misspelling',
      source: 'languagetool',
      verification: 'candidate',
    },
    {
      offset: 15,
      length: 5,
      message: 'Possible spelling mistake found.',
      shortMessage: '',
      replacements: ['quick', 'quirk'],
      ruleId: 'MORFOLOGIK_RULE_EN_US',
      category: 'Possible Typo',
      issueType: 'misspelling',
      source: 'languagetool',
      verification: 'candidate',
    },
  ])

  assert.equal(findings.find((finding) => finding.start === 6)?.replacement, 'bought')
  assert.equal(findings.find((finding) => finding.start === 15), undefined)
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
