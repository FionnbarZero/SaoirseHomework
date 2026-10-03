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
    activeGameSession: null,
    completionRecords: [],
    guardianConnected: false,
    chromeConnected: false,
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
    assert.equal(restored.activeTimer.status, 'paused')
    assert.equal(restored.activeTimer.serverControlled, true)
    assert.equal(reopened.info().schemaVersion, 6)
    assert.equal(reopened.listAudit()[0].eventType, 'parent_completion_override')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function controlledClock() {
  let wallMs = Date.parse('2026-10-03T16:00:00.000Z')
  let monotonicMs = 0
  let id = 0
  let nonce = 0
  return {
    options(runtimeId = 'test-runtime') {
      return {
        runtimeId,
        wallNow: () => new Date(wallMs),
        monotonicNow: () => monotonicMs,
        makeId: () => `test-id-${++id}`,
        makeNonce: () => `test-game-nonce-${++nonce}-secure-value`,
      }
    },
    advance(milliseconds) {
      wallMs += milliseconds
      monotonicMs += milliseconds
    },
  }
}

test('heartbeats award only bounded active monotonic time', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  const session = store.startSession({
    kind: 'required',
    activityId: 'ninja-dojo',
    sessionKey: 'Monday',
    label: 'Ninja Dojo',
    targetSeconds: 10,
  })

  clock.advance(5_000)
  const first = store.heartbeatSession(session.id, true)
  assert.equal(first.creditedSeconds, 5)
  assert.equal(first.remainingSeconds, 5)

  clock.advance(9_000)
  const afterLongGap = store.heartbeatSession(session.id, true)
  assert.equal(afterLongGap.creditedSeconds, 5, 'a delayed heartbeat must not award offline time')

  clock.advance(5_000)
  const completed = store.heartbeatSession(session.id, true)
  assert.equal(completed.status, 'completed')
  assert.equal(store.loadState().requiredByDay.Monday.includes('ninja-dojo'), true)
  store.close()
})

test('paused and hidden intervals earn no session credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'required',
    activityId: 'ninja-dojo',
    sessionKey: 'Friday',
    label: 'Ninja Dojo',
    targetSeconds: 10,
  })

  clock.advance(3_000)
  assert.equal(store.heartbeatSession(session.id, false).creditedSeconds, 0)
  clock.advance(60_000)
  assert.equal(store.heartbeatSession(session.id, false).creditedSeconds, 0)
  store.heartbeatSession(session.id, true)
  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).creditedSeconds, 5)
  store.close()
})

test('repeated completion heartbeats cannot duplicate optional credit or rewards', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'optional',
    activityId: 'voena',
    sessionKey: 'voena:0',
    label: 'Voena · Session 1',
    targetSeconds: 5,
  })

  clock.advance(5_000)
  store.heartbeatSession(session.id, true)
  store.heartbeatSession(session.id, true)

  const state = store.loadState()
  assert.deepEqual(state.optionalCompleted, ['voena:0'])
  assert.equal(state.rewardCredits.length, 1)
  assert.equal(state.completionRecords.filter((record) => record.id === `session:${session.id}`).length, 1)
  store.close()
})

test('a service restart recovers an incomplete session paused without adding downtime', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-session-recovery-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock()

  try {
    const first = createStore(filename, clock.options('runtime-one'))
    const session = first.startSession({
      kind: 'required',
      activityId: 'ninja-dojo',
      sessionKey: 'Tuesday',
      label: 'Ninja Dojo',
      targetSeconds: 20,
    })
    clock.advance(5_000)
    first.heartbeatSession(session.id, true)
    first.close()

    clock.advance(60_000)
    const reopened = createStore(filename, clock.options('runtime-two'))
    const recovered = reopened.loadState().activeTimer
    assert.equal(recovered.status, 'paused')
    assert.equal(recovered.remainingSeconds, 15)

    reopened.heartbeatSession(session.id, true)
    assert.equal(reopened.loadState().activeTimer.remainingSeconds, 15)
    clock.advance(5_000)
    assert.equal(reopened.heartbeatSession(session.id, true).remainingSeconds, 10)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('completion records identify self reports without duplicating repeated requests', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  store.setDailyCompletion({
    day: 'Wednesday',
    activityId: 'math',
    completed: true,
    method: 'self-reported',
  })
  store.setDailyCompletion({
    day: 'Wednesday',
    activityId: 'math',
    completed: true,
    method: 'self-reported',
  })

  const state = store.loadState()
  assert.deepEqual(state.requiredByDay.Wednesday, ['math'])
  assert.equal(state.completionRecords.length, 1)
  assert.equal(state.completionRecords[0].method, 'self-reported')
  store.close()
})

test('guardian heartbeats expire instead of leaving a false connected state', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  const current = store.recordGuardianHeartbeat({
    guardianId: 'child-mac',
    mode: 'dry-run',
    activeBundleId: 'com.google.Chrome',
    decision: 'allowed',
    version: '0.1.0',
  })
  assert.equal(current.connected, true)
  assert.equal(store.loadState().guardianConnected, true)

  const blockedHeartbeat = {
    guardianId: 'child-mac',
    mode: 'dry-run',
    activeBundleId: 'com.apple.Terminal',
    decision: 'blocked',
    version: '0.1.0',
  }
  store.recordGuardianHeartbeat(blockedHeartbeat)
  store.recordGuardianHeartbeat(blockedHeartbeat)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'guardian_blocked_app_observed').length,
    1,
  )

  clock.advance(16_000)
  assert.equal(store.getGuardianStatus().connected, false)
  assert.equal(store.loadState().guardianConnected, false)
  store.close()
})

test('Chrome extension heartbeats expire and deduplicate blocked-navigation audits', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const heartbeat = {
    extensionId: 'mmpeglplfjkbefdgikaldkncikpfdend',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin: 'https://example.com',
    decision: 'blocked',
    policyVersion: '1',
  }

  store.recordChromeExtensionHeartbeat(heartbeat)
  store.recordChromeExtensionHeartbeat(heartbeat)
  assert.equal(store.getChromeExtensionStatus().connected, true)
  assert.equal(store.loadState().chromeConnected, true)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'chrome_navigation_blocked').length,
    1,
  )

  clock.advance(46_000)
  assert.equal(store.getChromeExtensionStatus().connected, false)
  assert.equal(store.loadState().chromeConnected, false)
  store.close()
})

function assertServiceError(callback, status, code) {
  assert.throws(callback, (error) => {
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

test('a valid one-time game token atomically records verified Reading Strategies completion', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Monday',
    expectedOrigin: origin,
    ttlSeconds: 60,
  })

  const stored = store.db.prepare('SELECT nonce_hash FROM game_session WHERE id = ?').get(session.id)
  assert.notEqual(stored.nonce_hash, nonce)
  assert.equal(stored.nonce_hash.includes(nonce), false)
  assert.equal(store.loadState().activeGameSession.id, session.id)

  const completed = store.completeGameSession({ id: session.id, nonce, origin })
  assert.equal(completed.status, 'completed')
  const state = store.loadState()
  assert.equal(state.activeGameSession, null)
  assert.equal(state.requiredByDay.Monday.includes('reading-strategies'), true)
  assert.equal(state.completionRecords[0].method, 'game-verified')
  assert.equal(state.completionRecords[0].source, 'reading-game-contract')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'game_session_completed').length,
    1,
  )
  store.close()
})

test('game completion rejects spoofed origins and tokens without awarding credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Tuesday',
    expectedOrigin: origin,
  })

  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce, origin: 'https://attacker.example' }),
    403,
    'origin_mismatch',
  )
  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce: 'wrong-token', origin }),
    403,
    'nonce_mismatch',
  )
  assert.deepEqual(store.loadState().requiredByDay.Tuesday, [])
  assert.equal(store.listCompletions().length, 0)
  store.close()
})

test('a completed game token cannot be replayed', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Wednesday',
    expectedOrigin: origin,
  })

  store.completeGameSession({ id: session.id, nonce, origin })
  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce, origin }),
    409,
    'session_replayed',
  )
  assert.equal(store.listCompletions().filter((record) => record.method === 'game-verified').length, 1)
  store.close()
})

test('expired and replaced game sessions cannot award completion', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const expired = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Thursday',
    expectedOrigin: origin,
    ttlSeconds: 1,
  })
  clock.advance(1_001)
  assertServiceError(
    () => store.completeGameSession({ id: expired.session.id, nonce: expired.nonce, origin }),
    410,
    'session_expired',
  )

  const first = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Friday',
    expectedOrigin: origin,
  })
  const replacement = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Friday',
    expectedOrigin: origin,
  })
  assert.equal(store.getGameSession(first.session.id).status, 'cancelled')
  assert.equal(store.getGameSession(replacement.session.id).status, 'pending')
  assertServiceError(
    () => store.completeGameSession({ id: first.session.id, nonce: first.nonce, origin }),
    409,
    'session_inactive',
  )
  store.close()
})

test('browser state import cannot spoof a verified or timed required completion', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.requiredByDay.Monday.push('reading-strategies', 'ninja-dojo')
  const saved = store.saveState(state)

  assert.deepEqual(saved.requiredByDay.Monday, ['mandarin', 'math'])
  assert.equal(saved.completionRecords.some((record) => record.activityId === 'reading-strategies'), false)
  assert.equal(saved.completionRecords.some((record) => record.activityId === 'ninja-dojo'), false)
  store.close()
})

test('mock Google delivery is persistent and duplicate-safe for a weekly document', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState(sampleState())

  const connected = store.connectMockGoogle({ accountEmail: 'Parent.Test@example.com' })
  assert.equal(connected.connected, true)
  assert.equal(connected.accountEmail, 'parent.test@example.com')

  const prepared = store.prepareMockGoogleDelivery({
    recipient: 'Teacher.Test@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(prepared.created, true)
  assert.equal(prepared.delivery.status, 'creating')
  assert.equal(prepared.delivery.draftCount, 1)
  assert.equal(prepared.drafts[0].title, 'A test draft')

  const completed = store.completeMockGoogleDelivery(prepared.delivery.id, {
    documentPath: '/tmp/mock-google-proof.html',
    pdfPath: '/tmp/mock-google-proof.pdf',
  })
  assert.equal(completed.status, 'simulated')
  assert.match(completed.documentUrl, /\/document$/)
  assert.match(completed.pdfUrl, /\/pdf$/)

  const duplicate = store.prepareMockGoogleDelivery({
    recipient: 'different@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.delivery.id, completed.id)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'google_mock_delivery_simulated').length,
    1,
  )

  assert.equal(store.disconnectMockGoogle().connected, false)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  store.close()
})

test('mock Google proof records a duplicate-safe skip when no writing exists', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.connectMockGoogle({ accountEmail: 'parent@example.com' })

  const skipped = store.prepareMockGoogleDelivery({
    recipient: 'teacher@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(skipped.created, true)
  assert.equal(skipped.delivery.status, 'skipped')
  assert.equal(skipped.delivery.draftCount, 0)

  const duplicate = store.prepareMockGoogleDelivery({
    recipient: 'teacher@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(duplicate.created, false)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  store.close()
})
