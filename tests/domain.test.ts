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
import { advanceFindingProgress, applyCompletedCorrections, inspectDraft, writingReviewStatus } from '../src/writing.ts'

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
  assert.equal(findings.every((finding) => finding.practice.length === 5), true)
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

test('accepted writing corrections build a separate copy and require five practice answers', () => {
  const body = 'today i play with this books'
  const findings = inspectDraft(body)
  const progress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: 5,
    incorrectAttempts: 1,
  }]))
  const corrected = applyCompletedCorrections(body, findings, progress)

  assert.equal(body, 'today i play with this books')
  assert.equal(corrected, 'Today I play with these books.')
  assert.equal(writingReviewStatus(findings, progress), 'spelling-pending')
  const first = findings[0]
  assert.equal(writingReviewStatus(findings, { ...progress, [first.id]: { ...progress[first.id], practiceCompleted: 4 } }), 'practice')
})

test('incorrect writing answers do not advance the exercise counter', () => {
  const initial = { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }
  const wrongCorrection = advanceFindingProgress(initial, false)
  const corrected = advanceFindingProgress(wrongCorrection, true)
  const wrongPractice = advanceFindingProgress(corrected, false)
  const practiced = advanceFindingProgress(wrongPractice, true)

  assert.deepEqual(wrongCorrection, { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 1 })
  assert.deepEqual(wrongPractice, { correctionComplete: true, practiceCompleted: 0, incorrectAttempts: 2 })
  assert.deepEqual(practiced, { correctionComplete: true, practiceCompleted: 1, incorrectAttempts: 2 })
})

test('Friday Fun stays locked until Friday work and all practice are complete', () => {
  const fridayRequired = activeRequiredActivities().map((activity) => activity.id)
  const state: AppState = {
    ...structuredClone(defaultState),
    requiredByDay: { ...defaultState.requiredByDay, Friday: fridayRequired },
    optionalCompleted: Array.from({ length: 12 }, (_, index) => `session:${index}`),
    drafts: [{
      id: 'draft-1',
      title: 'Friday story',
      body: 'Five carefully chosen words.',
      updatedAt: '2026-10-09T16:00:00.000Z',
      findings: [],
    }],
  }

  assert.equal(getFridayFunSummary(state).unlocked, false)
  state.optionalCompleted.push('session:12')
  const summary = getFridayFunSummary(state)
  assert.equal(summary.unlocked, true)
  assert.equal(summary.optionalCompleted, 13)
  assert.equal(summary.writingDrafts, 1)
  assert.equal(summary.writingWords, 4)
  assert.equal(summary.rewardsEarned, 13)
})
