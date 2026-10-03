import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../server/database.mjs'

function sampleState() {
  return {
    entered: true,
    requiredByDay: {
      Monday: ['mandarin', 'math'],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
    },
    optionalCompleted: ['voena:0'],
    rewardCredits: [{
      id: 'credit-1',
      source: 'Voena · Session 1',
      remainingSeconds: 300,
      earnedAt: '2026-10-03T07:00:00.000Z',
    }],
    drafts: [{
      id: 'draft-1',
      title: 'A test draft',
      body: 'Today I tested persistence.',
      updatedAt: '2026-10-03T07:00:00.000Z',
      findings: [],
    }],
    activeTimer: {
      kind: 'required',
      activityId: 'ninja-dojo',
      sessionKey: 'Monday',
      label: 'Ninja Dojo',
      totalSeconds: 1020,
      remainingSeconds: 917,
      running: false,
    },
    guardianConnected: false,
  }
}

test('SQLite state survives closing and reopening the service', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-homework-'))
  const filename = join(directory, 'homework.sqlite')

  try {
    const first = createStore(filename)
    assert.equal(first.isInitialized(), false)
    first.saveState(sampleState())
    first.addAudit('parent_completion_override', { day: 'Monday', activityId: 'math' })
    assert.equal(first.isInitialized(), true)
    first.close()

    const reopened = createStore(filename)
    const restored = reopened.loadState()
    assert.deepEqual(restored.requiredByDay.Monday, ['mandarin', 'math'])
    assert.deepEqual(restored.optionalCompleted, ['voena:0'])
    assert.equal(restored.rewardCredits[0].remainingSeconds, 300)
    assert.equal(restored.drafts[0].title, 'A test draft')
    assert.equal(restored.activeTimer.remainingSeconds, 917)
    assert.equal(reopened.listAudit()[0].eventType, 'parent_completion_override')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
