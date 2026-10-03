import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore, getWeekContext } from '../server/database.mjs'

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
    assert.equal(reopened.info().schemaVersion, 10)
    assert.equal(reopened.listAudit()[0].eventType, 'parent_completion_override')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function controlledClock(start = '2026-10-03T16:00:00.000Z') {
  let wallMs = Date.parse(start)
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
    setWall(value) {
      wallMs = Date.parse(value)
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

test('YouTube rewards count only managed foreground content playback', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState({
    ...sampleState(),
    activeTimer: null,
    rewardCredits: [{ ...sampleState().rewardCredits[0], remainingSeconds: 10 }],
  })
  const session = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 10,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 10,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })
  const chromeHeartbeat = (playbackActive) => store.recordChromeExtensionHeartbeat({
    extensionId: 'managed-extension',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin: 'https://www.youtube.com',
    decision: 'allowed',
    policyVersion: '3',
    playbackActive,
  })

  assert.equal(session.status, 'paused')
  assert.equal(session.managedChromeRequired, true)
  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).creditedSeconds, 0, 'browser focus is not playback proof')
  chromeHeartbeat(false)
  clock.advance(5_000)
  chromeHeartbeat(false)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 0, 'paused, buffered, and ad time must not count')

  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.rewardPlaybackStarted, true)
  clock.advance(5_000)
  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 5)

  clock.advance(5_000)
  chromeHeartbeat(false)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 5)
  store.cancelSession(session.id)
  assert.equal(store.loadState().rewardCredits[0].remainingSeconds, 5)

  const resumed = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 5,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 5,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })
  chromeHeartbeat(true)
  clock.advance(5_000)
  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.status, 'completed')
  assert.equal(store.loadState().rewardCredits.length, 0)
  assert.equal(
    store.loadState().completionRecords.find((record) => record.id === `session:${resumed.id}`).method,
    'reward-playback',
  )
  store.close()
})

test('an unused YouTube selection window expires without spending its credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState({ ...sampleState(), activeTimer: null })
  const session = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 300,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 300,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })

  clock.advance(120_001)
  assert.equal(store.heartbeatSession(session.id, false), null)
  assert.equal(store.loadState().activeTimer, null)
  assert.equal(store.loadState().rewardCredits[0].remainingSeconds, 300)
  assert.equal(store.listAudit()[0].eventType, 'reward_selection_expired')
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

test('managed Du Chinese phases reject browser credit and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-du-phases-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock()
  const plan = {
    phases: [
      {
        id: 'reading',
        label: 'Reading',
        targetSeconds: 5,
        launchUrl: 'https://read.example/story',
        allowedOrigins: ['https://read.example', 'https://cards.example'],
        creditOrigins: ['https://read.example'],
        verification: 'managed-chrome',
      },
      {
        id: 'flashcards',
        label: 'Flashcards',
        targetSeconds: 5,
        launchUrl: 'https://cards.example/review',
        allowedOrigins: ['https://read.example', 'https://cards.example'],
        creditOrigins: ['https://cards.example'],
        verification: 'managed-chrome',
        navigateOnStart: true,
      },
    ],
  }

  try {
    const first = createStore(filename, clock.options('du-runtime-one'))
    const session = first.startSession({
      kind: 'optional',
      activityId: 'du-chinese',
      sessionKey: 'du-chinese:0',
      label: 'Du Chinese · Session 1',
      targetSeconds: 10,
      plan,
    })
    assert.equal(session.status, 'paused')
    assert.equal(session.phaseId, 'reading')
    assert.equal(session.managedChromeRequired, true)

    clock.advance(5_000)
    assert.equal(first.heartbeatSession(session.id, true).creditedSeconds, 0)
    first.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    clock.advance(5_000)
    const flashcards = first.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    assert.equal(flashcards.phaseId, 'flashcards')
    assert.equal(flashcards.creditedSeconds, 5)
    assert.equal(flashcards.status, 'paused')
    first.close()

    const reopened = createStore(filename, clock.options('du-runtime-two'))
    assert.equal(reopened.loadState().activeTimer.phaseId, 'flashcards')
    reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    assert.equal(reopened.loadState().activeTimer.creditedSeconds, 5)
    reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://cards.example',
    })
    clock.advance(5_000)
    const completed = reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://cards.example',
    })
    assert.equal(completed.status, 'completed')
    assert.deepEqual(reopened.loadState().optionalCompleted, ['du-chinese:0'])
    assert.equal(reopened.loadState().rewardCredits.length, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Level Chinese waits for an exact managed-Chrome learning origin', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'optional',
    activityId: 'level-chinese',
    sessionKey: 'level-chinese:0',
    label: 'Level Chinese · Session 1',
    targetSeconds: 5,
    plan: {
      phases: [
        {
          id: 'clever-login',
          label: 'Log in through Clever',
          targetSeconds: 0,
          launchUrl: 'https://clever.example/login',
          allowedOrigins: ['https://clever.example', 'https://level.example'],
          creditOrigins: [],
          advanceOrigins: ['https://level.example'],
          verification: 'managed-chrome',
        },
        {
          id: 'level-learning',
          label: 'Level Learning',
          targetSeconds: 5,
          launchUrl: 'https://level.example/learn',
          allowedOrigins: ['https://clever.example', 'https://level.example'],
          creditOrigins: ['https://level.example'],
          verification: 'managed-chrome',
        },
      ],
    },
  })

  const heartbeat = (activeOrigin) => store.recordChromeExtensionHeartbeat({
    extensionId: 'managed-extension',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin,
    decision: 'allowed',
    policyVersion: '2',
  })

  heartbeat('https://clever.example')
  assert.equal(store.loadState().activeTimer.phaseId, 'clever-login')
  heartbeat('https://level.example.evil.test')
  assert.equal(store.loadState().activeTimer.phaseId, 'clever-login')
  heartbeat('https://level.example')
  assert.equal(store.loadState().activeTimer.phaseId, 'level-learning')
  clock.advance(5_000)
  heartbeat('https://level.example')
  assert.equal(store.loadState().activeTimer.status, 'completed')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'session_phase_advanced').length,
    1,
  )
  assert.equal(session.phaseId, 'clever-login')
  store.close()
})

test('parent activity configuration persists with readiness and an audit event', () => {
  const store = createStore(':memory:')
  const saved = store.setActivityConfiguration({
    ninjaDojo: { launchUrl: 'https://hub.example.edu/grade-5', allowedOrigins: [] },
    duChinese: { readingUrl: '', flashcardUrl: '', allowedOrigins: [] },
    levelChinese: { cleverUrl: '', learningUrl: '', allowedOrigins: [] },
  })

  assert.equal(saved.ninjaDojo.ready, true)
  assert.equal(store.loadState().activityConfiguration.ninjaDojo.launchUrl, 'https://hub.example.edu/grade-5')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'activity_configuration_updated').length,
    1,
  )
  store.close()
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

test('weekly context changes at Sunday 4 a.m. in the configured time zone', () => {
  const before = getWeekContext(new Date('2026-10-04T10:59:59.000Z'), 'America/Los_Angeles')
  assert.equal(before.localDay, 'Sunday')
  assert.equal(before.headStart, false)
  assert.equal(before.weekId, '2026-09-28')

  const after = getWeekContext(new Date('2026-10-04T11:00:00.000Z'), 'America/Los_Angeles')
  assert.equal(after.headStart, true)
  assert.equal(after.weekId, '2026-10-05')
  assert.equal(after.fridayId, '2026-10-09')

  const monday = getWeekContext(new Date('2026-10-05T15:00:00.000Z'), 'America/Los_Angeles')
  assert.equal(monday.localDay, 'Monday')
  assert.equal(monday.headStart, false)
  assert.equal(monday.weekId, '2026-10-05')
})

test('six Sunday sessions and seven Monday sessions share one bank, then archive once', () => {
  const clock = controlledClock('2026-10-04T11:00:00.000Z')
  const store = createStore(':memory:', clock.options())
  const allSessions = [
    'voena:0', 'voena:1', 'voena:2',
    'drums:0', 'drums:1', 'drums:2',
    'band:0', 'band:1', 'band:2',
    'level-chinese:0', 'level-chinese:1',
    'du-chinese:0', 'du-chinese:1',
  ]

  const sunday = store.loadState()
  assert.equal(sunday.weekContext.headStart, true)
  assert.equal(sunday.weekContext.weekId, '2026-10-05')
  sunday.entered = true
  sunday.optionalCompleted = allSessions.slice(0, 6)
  const sundaySaved = store.saveState(sunday)
  assert.equal(sundaySaved.optionalCompleted.length, 6)

  clock.setWall('2026-10-05T15:00:00.000Z')
  const monday = store.loadState()
  assert.equal(monday.weekContext.weekId, '2026-10-05')
  assert.equal(monday.weekContext.headStart, false)
  assert.equal(monday.optionalCompleted.length, 6)
  monday.optionalCompleted = allSessions
  monday.requiredByDay.Monday = ['math']
  assert.equal(store.saveState(monday).optionalCompleted.length, 13)

  clock.setWall('2026-10-11T10:59:59.000Z')
  assert.equal(store.loadState().optionalCompleted.length, 13)
  clock.setWall('2026-10-11T11:00:00.000Z')
  const nextWeek = store.loadState()
  assert.equal(nextWeek.weekContext.weekId, '2026-10-12')
  assert.equal(nextWeek.weekContext.headStart, true)
  assert.equal(nextWeek.optionalCompleted.length, 0)
  assert.deepEqual(nextWeek.requiredByDay.Monday, [])
  assert.equal(nextWeek.entered, false)
  assert.equal(
    store.db.prepare('SELECT archived FROM weekly_plan WHERE week_id = ?').get('2026-10-05').archived,
    1,
  )
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?')
      .get('2026-10-05').count,
    13,
  )
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'weekly_plan_rolled_over').length,
    1,
  )

  assertServiceError(() => store.saveState(monday), 409, 'stale_week')

  clock.setWall('2026-10-05T15:00:00.000Z')
  const rollback = store.loadState()
  assert.equal(rollback.weekContext.weekId, '2026-10-12')
  assert.equal(rollback.weekContext.clockRollbackDetected, true)
  assert.equal(rollback.optionalCompleted.length, 0)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'weekly_plan_rolled_over').length,
    1,
  )
  store.close()
})

test('schema 7 migrates existing unscoped completions into the active week once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-week-migration-'))
  const filename = join(directory, 'homework.sqlite')
  const legacy = new DatabaseSync(filename)
  legacy.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE daily_completion (
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (day, activity_id)
    );
    CREATE TABLE optional_completion (
      session_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    INSERT INTO daily_completion VALUES ('Monday', 'math', 'browser', '2026-10-01T12:00:00.000Z');
    INSERT INTO optional_completion VALUES ('voena:0', '2026-10-01T12:00:00.000Z');
  `)
  legacy.close()

  try {
    const clock = controlledClock()
    const first = createStore(filename, clock.options())
    assert.deepEqual(first.loadState().requiredByDay.Monday, ['math'])
    assert.deepEqual(first.loadState().optionalCompleted, ['voena:0'])
    first.close()

    const reopened = createStore(filename, clock.options())
    assert.deepEqual(reopened.loadState().requiredByDay.Monday, ['math'])
    assert.deepEqual(reopened.loadState().optionalCompleted, ['voena:0'])
    assert.equal(
      reopened.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion').get().count,
      1,
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a Sunday upgrade archives legacy weekly data instead of carrying it into the new pool', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-sunday-migration-'))
  const filename = join(directory, 'homework.sqlite')
  const legacy = new DatabaseSync(filename)
  legacy.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE weekly_plan (
      week_id TEXT PRIMARY KEY,
      optional_target INTEGER NOT NULL DEFAULT 13,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE daily_completion (
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (day, activity_id)
    );
    CREATE TABLE optional_completion (
      session_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    INSERT INTO settings VALUES ('entered', '1');
    INSERT INTO weekly_plan VALUES ('2026-09-28', 13, 0, '2026-10-03T20:00:00.000Z');
    INSERT INTO daily_completion VALUES ('Friday', 'math', 'browser', '2026-10-03T20:00:00.000Z');
    INSERT INTO optional_completion VALUES ('voena:0', '2026-10-03T20:00:00.000Z');
  `)
  legacy.close()

  try {
    const clock = controlledClock('2026-10-04T11:00:00.000Z')
    const store = createStore(filename, clock.options())
    const state = store.loadState()
    assert.equal(state.weekContext.weekId, '2026-10-05')
    assert.equal(state.entered, false)
    assert.deepEqual(state.requiredByDay.Friday, [])
    assert.deepEqual(state.optionalCompleted, [])
    assert.equal(
      store.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?')
        .get('2026-09-28').count,
      1,
    )
    assert.equal(
      store.db.prepare('SELECT archived FROM weekly_plan WHERE week_id = ?').get('2026-09-28').archived,
      1,
    )
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a controlled session completed after rollover stays with the week where it started', () => {
  const clock = controlledClock('2026-10-04T10:59:58.000Z')
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'optional',
    activityId: 'voena',
    sessionKey: 'voena:0',
    label: 'Voena · Session 1',
    targetSeconds: 5,
  })
  assert.equal(session.weekId, '2026-09-28')

  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).status, 'completed')
  const current = store.loadState()
  assert.equal(current.weekContext.weekId, '2026-10-05')
  assert.deepEqual(current.optionalCompleted, [])
  assert.equal(
    store.db.prepare(`
      SELECT count(*) AS count FROM weekly_optional_completion
      WHERE week_id = ? AND session_key = ?
    `).get('2026-09-28', 'voena:0').count,
    1,
  )
  store.close()
})

test('Friday Free Mode unlocks once, relocks after a correction, and resets on rollover', () => {
  const clock = controlledClock('2026-10-09T16:00:00.000Z')
  const store = createStore(':memory:', clock.options())
  const required = ['mandarin', 'math', 'english-packet', 'reading-strategies', 'ninja-dojo']
  const optional = [
    'voena:0', 'voena:1', 'voena:2',
    'drums:0', 'drums:1', 'drums:2',
    'band:0', 'band:1', 'band:2',
    'level-chinese:0', 'level-chinese:1',
    'du-chinese:0', 'du-chinese:1',
  ]

  for (const activityId of required) {
    store.setDailyCompletion({
      day: 'Friday',
      activityId,
      completed: true,
      method: 'parent-override',
    })
  }
  const locked = store.loadState()
  assert.equal(locked.freeModeByDay.Friday, undefined)

  locked.optionalCompleted = optional
  const unlocked = store.saveState(locked)
  assert.match(unlocked.freeModeByDay.Friday, /^2026-10-09T/)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_unlocked').length,
    1,
  )
  store.loadState()
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_unlocked').length,
    1,
  )

  const relocked = store.setDailyCompletion({
    day: 'Friday',
    activityId: 'math',
    completed: false,
    method: 'parent-override',
  })
  assert.equal(relocked.freeModeByDay.Friday, undefined)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_relocked').length,
    1,
  )

  store.setDailyCompletion({
    day: 'Friday',
    activityId: 'math',
    completed: true,
    method: 'parent-override',
  })
  assert.ok(store.loadState().freeModeByDay.Friday)

  clock.setWall('2026-10-11T11:00:00.000Z')
  const nextWeek = store.loadState()
  assert.deepEqual(nextWeek.freeModeByDay, {})
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM free_mode_unlock WHERE week_id = ?')
      .get('2026-10-05').count,
    1,
  )
  store.close()
})
