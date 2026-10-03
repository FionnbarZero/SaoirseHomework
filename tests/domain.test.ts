import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OPTIONAL_TARGETS,
  activeRequiredActivities,
  dayIsComplete,
  defaultState,
  getFridayFunSummary,
  inspectDraft,
  optionalSessionKey,
  type AppState,
} from '../src/domain.ts'

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
