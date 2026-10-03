import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OPTIONAL_TARGETS,
  activeRequiredActivities,
  dayIsComplete,
  defaultState,
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
