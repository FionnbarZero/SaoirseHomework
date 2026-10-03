import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const SCHEMA_VERSION = 6
const MAX_HEARTBEAT_GAP_MS = 7_000
const GAME_ACTIVITY_ID = 'reading-strategies'
const BROWSER_COMPLETION_ACTIVITIES = new Set(['mandarin', 'math', 'english-packet'])

function emptyState() {
  return {
    entered: false,
    requiredByDay: Object.fromEntries(DAYS.map((day) => [day, []])),
    optionalCompleted: [],
    rewardCredits: [],
    drafts: [],
    activeTimer: null,
    activeGameSession: null,
    completionRecords: [],
    guardianConnected: false,
    chromeConnected: false,
    googleProof: {
      mode: 'mock',
      connected: false,
      accountEmail: null,
      connectedAt: null,
      deliveries: [],
    },
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function assertState(state) {
  if (!state || typeof state !== 'object') throw new Error('State must be an object')
  if (!state.requiredByDay || typeof state.requiredByDay !== 'object') throw new Error('Missing daily completion state')
  if (!Array.isArray(state.optionalCompleted)) throw new Error('Invalid optional completion state')
  if (!Array.isArray(state.rewardCredits)) throw new Error('Invalid reward state')
  if (!Array.isArray(state.drafts)) throw new Error('Invalid writing state')
}

function asIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function serviceError(message, status = 400, code = 'invalid_request') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function hashNonce(value) {
  return createHash('sha256').update(String(value)).digest()
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value))
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') throw new Error()
    return url.origin
  } catch {
    throw serviceError('A valid HTTP game origin is required')
  }
}

function normalizeEmail(value, label) {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw serviceError(`A valid ${label} email address is required`)
  }
  return email
}

export function createStore(filename, options = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })

  const wallNow = options.wallNow ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const makeId = options.makeId ?? (() => randomUUID())
  const makeNonce = options.makeNonce ?? (() => randomBytes(32).toString('base64url'))
  const runtimeId = options.runtimeId ?? randomUUID()
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = FULL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_plan (
      week_id TEXT PRIMARY KEY,
      optional_target INTEGER NOT NULL DEFAULT 13,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_completion (
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (day, activity_id)
    );

    CREATE TABLE IF NOT EXISTS optional_completion (
      session_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reward_credit (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      earned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS writing_submission (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_timer (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      kind TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      session_key TEXT,
      label TEXT NOT NULL,
      total_seconds INTEGER NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      running INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_session (
      id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      kind TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      session_key TEXT,
      label TEXT NOT NULL,
      target_ms INTEGER NOT NULL CHECK (target_ms > 0),
      credited_ms INTEGER NOT NULL DEFAULT 0 CHECK (credited_ms >= 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
      runtime_id TEXT,
      last_tick_ms REAL,
      created_at TEXT NOT NULL,
      last_heartbeat_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_activity_session
      ON activity_session ((1))
      WHERE acknowledged = 0 AND status IN ('active', 'paused', 'completed');

    CREATE TABLE IF NOT EXISTS completion_record (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      session_key TEXT,
      method TEXT NOT NULL,
      source TEXT NOT NULL,
      session_id TEXT UNIQUE,
      completed_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS game_session (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      day TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,
      expected_origin TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS game_session_lookup
      ON game_session (activity_id, day, status);

    CREATE TABLE IF NOT EXISTS guardian_status (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      guardian_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'enforcing')),
      active_bundle_id TEXT,
      decision TEXT NOT NULL,
      version TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chrome_extension_status (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      extension_id TEXT NOT NULL,
      version TEXT NOT NULL,
      mode TEXT NOT NULL,
      active_origin TEXT,
      decision TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_connection (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      mode TEXT NOT NULL CHECK (mode = 'mock'),
      account_email TEXT NOT NULL,
      connected INTEGER NOT NULL CHECK (connected IN (0, 1)),
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_delivery (
      id TEXT PRIMARY KEY,
      week_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL CHECK (mode = 'mock'),
      status TEXT NOT NULL CHECK (status IN ('creating', 'simulated', 'skipped', 'failed')),
      account_email TEXT NOT NULL,
      recipient TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_name TEXT NOT NULL,
      document_path TEXT,
      pdf_path TEXT,
      draft_count INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS google_delivery_week
      ON google_delivery (week_id, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  const setMeta = db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  const setSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  const upsertWeek = db.prepare(`
    INSERT INTO weekly_plan (week_id, optional_target, archived, updated_at)
    VALUES (?, 13, 0, ?)
    ON CONFLICT(week_id) DO UPDATE SET updated_at = excluded.updated_at
  `)
  const insertRequired = db.prepare(`
    INSERT INTO daily_completion (day, activity_id, source, completed_at)
    VALUES (?, ?, ?, ?)
  `)
  const insertOptional = db.prepare(`
    INSERT INTO optional_completion (session_key, completed_at) VALUES (?, ?)
  `)
  const insertReward = db.prepare(`
    INSERT INTO reward_credit (id, source, remaining_seconds, earned_at) VALUES (?, ?, ?, ?)
  `)
  const insertDraft = db.prepare(`
    INSERT INTO writing_submission (id, title, body, findings_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertAudit = db.prepare(`
    INSERT INTO audit_log (event_type, details_json, created_at) VALUES (?, ?, ?)
  `)
  const insertSession = db.prepare(`
    INSERT INTO activity_session (
      id, nonce, kind, activity_id, session_key, label, target_ms, credited_ms,
      status, runtime_id, last_tick_ms, created_at, last_heartbeat_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCompletion = db.prepare(`
    INSERT OR IGNORE INTO completion_record (
      id, activity_id, session_key, method, source, session_id, completed_at, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertGameSession = db.prepare(`
    INSERT INTO game_session (
      id, activity_id, day, nonce_hash, expected_origin, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `)

  setMeta.run('schema_version', String(SCHEMA_VERSION))

  // Restart recovery is fail-closed: elapsed downtime can never become credit.
  db.prepare(`
    UPDATE activity_session
    SET status = 'paused', runtime_id = NULL, last_tick_ms = NULL, updated_at = ?
    WHERE status = 'active'
  `).run(asIso(wallNow()))

  db.prepare(`
    UPDATE google_delivery
    SET status = 'failed', last_error = 'The local service restarted during artifact creation', updated_at = ?
    WHERE status = 'creating'
  `).run(asIso(wallNow()))

  // Preserve a timer written by schema version 1 as a paused, server-owned session.
  const legacyTimer = db.prepare('SELECT * FROM active_timer WHERE singleton = 1').get()
  const pendingSession = db.prepare(`
    SELECT id FROM activity_session
    WHERE acknowledged = 0 AND status IN ('active', 'paused', 'completed')
  `).get()
  if (legacyTimer && !pendingSession) {
    const now = asIso(wallNow())
    insertSession.run(
      makeId(), makeId(), legacyTimer.kind, legacyTimer.activity_id,
      legacyTimer.session_key ?? null, legacyTimer.label,
      Number(legacyTimer.total_seconds) * 1000,
      Math.max(0, Number(legacyTimer.total_seconds - legacyTimer.remaining_seconds)) * 1000,
      'paused', null, null, now, null, now,
    )
  }
  db.exec('DELETE FROM active_timer')

  function isInitialized() {
    return db.prepare(`SELECT value FROM app_meta WHERE key = 'initialized'`).get()?.value === '1'
  }

  function sessionFromRow(row) {
    if (!row) return null
    const remainingMs = Math.max(0, Number(row.target_ms) - Number(row.credited_ms))
    return {
      id: row.id,
      kind: row.kind,
      activityId: row.activity_id,
      sessionKey: row.session_key ?? undefined,
      label: row.label,
      totalSeconds: Math.ceil(Number(row.target_ms) / 1000),
      creditedSeconds: Math.floor(Number(row.credited_ms) / 1000),
      remainingSeconds: Math.ceil(remainingMs / 1000),
      running: row.status === 'active',
      status: row.status,
      startedAt: row.created_at,
      lastHeartbeatAt: row.last_heartbeat_at ?? null,
      serverControlled: true,
    }
  }

  function getSessionRow(id) {
    return db.prepare('SELECT * FROM activity_session WHERE id = ?').get(String(id))
  }

  function getPendingSessionRow() {
    return db.prepare(`
      SELECT * FROM activity_session
      WHERE acknowledged = 0 AND status IN ('active', 'paused', 'completed')
      ORDER BY created_at DESC LIMIT 1
    `).get()
  }

  function gameSessionFromRow(row) {
    if (!row) return null
    return {
      id: row.id,
      activityId: row.activity_id,
      day: row.day,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at ?? null,
    }
  }

  function expireGameSessions() {
    db.prepare(`
      UPDATE game_session
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= ?
    `).run(asIso(wallNow()))
  }

  function getGameSessionRow(id) {
    expireGameSessions()
    return db.prepare('SELECT * FROM game_session WHERE id = ?').get(String(id))
  }

  function getPendingGameSessionRow() {
    expireGameSessions()
    return db.prepare(`
      SELECT * FROM game_session
      WHERE status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get()
  }

  function listCompletions(limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50))
    return db.prepare(`
      SELECT id, activity_id, session_key, method, source, completed_at
      FROM completion_record ORDER BY completed_at DESC LIMIT ?
    `).all(safeLimit).map((row) => ({
      id: row.id,
      activityId: row.activity_id,
      sessionKey: row.session_key ?? undefined,
      method: row.method,
      source: row.source,
      completedAt: row.completed_at,
    }))
  }

  function loadState() {
    const state = emptyState()
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((row) => [row.key, row.value]),
    )

    state.entered = settings.entered === '1'
    state.guardianConnected = getGuardianStatus().connected
    state.chromeConnected = getChromeExtensionStatus().connected
    state.googleProof = getGoogleProofState()

    for (const row of db.prepare('SELECT day, activity_id FROM daily_completion ORDER BY completed_at').all()) {
      if (DAYS.includes(row.day)) state.requiredByDay[row.day].push(row.activity_id)
    }

    state.optionalCompleted = db
      .prepare('SELECT session_key FROM optional_completion ORDER BY completed_at')
      .all()
      .map((row) => row.session_key)

    state.rewardCredits = db
      .prepare('SELECT id, source, remaining_seconds, earned_at FROM reward_credit ORDER BY earned_at')
      .all()
      .map((row) => ({
        id: row.id,
        source: row.source,
        remainingSeconds: Number(row.remaining_seconds),
        earnedAt: row.earned_at,
      }))

    state.drafts = db
      .prepare('SELECT id, title, body, findings_json, updated_at FROM writing_submission ORDER BY updated_at DESC')
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        findings: safeJson(row.findings_json, []),
        updatedAt: row.updated_at,
      }))

    state.activeTimer = sessionFromRow(getPendingSessionRow())
    state.activeGameSession = gameSessionFromRow(getPendingGameSessionRow())
    state.completionRecords = listCompletions(50)
    return state
  }

  function importBrowserTimer(timer, now) {
    if (!timer || getPendingSessionRow()) return
    const totalSeconds = Math.max(1, Number(timer.totalSeconds) || 1)
    const remainingSeconds = Math.max(0, Math.min(totalSeconds, Number(timer.remainingSeconds) || 0))
    insertSession.run(
      makeId(), makeId(), String(timer.kind), String(timer.activityId), timer.sessionKey ? String(timer.sessionKey) : null,
      String(timer.label), totalSeconds * 1000, (totalSeconds - remainingSeconds) * 1000,
      remainingSeconds === 0 ? 'completed' : 'paused', null, null, now, null, now,
    )
  }

  function saveState(state) {
    assertState(state)
    const now = asIso(wallNow())
    const weekId = getMondayId(new Date(now))

    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        DELETE FROM daily_completion WHERE source IN ('browser', 'self-reported');
        DELETE FROM optional_completion;
        DELETE FROM reward_credit;
        DELETE FROM writing_submission;
      `)

      for (const day of DAYS) {
        const activities = Array.isArray(state.requiredByDay[day]) ? state.requiredByDay[day] : []
        for (const activityId of [...new Set(activities)]) {
          if (!BROWSER_COMPLETION_ACTIVITIES.has(String(activityId))) continue
          insertRequired.run(day, String(activityId), 'browser', now)
          const hasRecord = db.prepare(`
            SELECT 1 FROM completion_record WHERE activity_id = ? AND session_key = ? LIMIT 1
          `).get(String(activityId), day)
          if (!hasRecord) {
            insertCompletion.run(
              `imported:${day}:${activityId}`, String(activityId), day, 'imported', 'browser-state', null, now, '{}',
            )
          }
        }
      }

      for (const sessionKey of [...new Set(state.optionalCompleted)]) {
        insertOptional.run(String(sessionKey), now)
        const activityId = String(sessionKey).split(':')[0]
        const hasRecord = db.prepare(`
          SELECT 1 FROM completion_record WHERE session_key = ? LIMIT 1
        `).get(String(sessionKey))
        if (!hasRecord) {
          insertCompletion.run(
            `imported:${sessionKey}`, activityId, String(sessionKey), 'imported', 'browser-state', null, now, '{}',
          )
        }
      }

      for (const credit of state.rewardCredits) {
        insertReward.run(
          String(credit.id), String(credit.source ?? 'Reward'),
          Math.max(0, Number(credit.remainingSeconds) || 0), String(credit.earnedAt ?? now),
        )
      }

      for (const draft of state.drafts) {
        insertDraft.run(
          String(draft.id), String(draft.title ?? 'Untitled writing'), String(draft.body ?? ''),
          JSON.stringify(Array.isArray(draft.findings) ? draft.findings : []), String(draft.updatedAt ?? now),
        )
      }

      importBrowserTimer(state.activeTimer, now)
      setSetting.run('entered', state.entered ? '1' : '0')
      setSetting.run('guardian_connected', state.guardianConnected ? '1' : '0')
      upsertWeek.run(weekId, now)
      setMeta.run('initialized', '1')
      setMeta.run('last_write_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return loadState()
  }

  function startGameSession(input) {
    const activityId = String(input.activityId ?? '')
    const day = String(input.day ?? '')
    const expectedOrigin = normalizeOrigin(input.expectedOrigin)
    const ttlSeconds = Math.floor(Number(input.ttlSeconds ?? 60 * 60))

    if (activityId !== GAME_ACTIVITY_ID) throw serviceError('Unsupported verified game activity')
    if (!DAYS.includes(day)) throw serviceError('Invalid weekday')
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 24 * 60 * 60) {
      throw serviceError('Game session lifetime must be between 1 second and 24 hours')
    }
    if (db.prepare(
      'SELECT 1 FROM daily_completion WHERE day = ? AND activity_id = ?',
    ).get(day, activityId)) {
      throw serviceError('Reading Strategies is already complete for that day', 409, 'already_completed')
    }

    const id = makeId()
    const nonce = String(makeNonce())
    if (nonce.length < 16) throw new Error('Generated game nonce is too short')
    const createdAt = asIso(wallNow())
    const expiresAt = asIso(new Date(new Date(createdAt).getTime() + ttlSeconds * 1000))

    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE game_session
        SET status = 'cancelled'
        WHERE activity_id = ? AND day = ? AND status = 'pending'
      `).run(activityId, day)
      insertGameSession.run(
        id, activityId, day, hashNonce(nonce).toString('hex'), expectedOrigin, createdAt, expiresAt,
      )
      insertAudit.run(
        'game_session_started',
        JSON.stringify({ sessionId: id, activityId, day, expectedOrigin, expiresAt }),
        createdAt,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return { session: gameSessionFromRow(getGameSessionRow(id)), nonce }
  }

  function getGameSession(id) {
    const row = getGameSessionRow(id)
    if (!row) throw serviceError('Game session not found', 404, 'session_not_found')
    return gameSessionFromRow(row)
  }

  function completeGameSession(input) {
    const id = String(input.id ?? '')
    const suppliedOrigin = String(input.origin ?? '')
    const suppliedNonce = typeof input.nonce === 'string' ? input.nonce : ''
    let completedSession

    expireGameSessions()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT * FROM game_session WHERE id = ?').get(id)
      if (!row) throw serviceError('Game session not found', 404, 'session_not_found')

      const now = asIso(wallNow())
      if (row.status === 'expired') {
        throw serviceError('Game session has expired', 410, 'session_expired')
      }
      if (row.status === 'completed') {
        throw serviceError('Game session has already been used', 409, 'session_replayed')
      }
      if (row.status !== 'pending') {
        throw serviceError('Game session is no longer active', 409, 'session_inactive')
      }
      if (suppliedOrigin !== row.expected_origin) {
        throw serviceError('Game completion origin was not accepted', 403, 'origin_mismatch')
      }

      const expectedHash = Buffer.from(row.nonce_hash, 'hex')
      const suppliedHash = hashNonce(suppliedNonce)
      if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash)) {
        throw serviceError('Game completion token was not accepted', 403, 'nonce_mismatch')
      }

      const update = db.prepare(`
        UPDATE game_session
        SET status = 'completed', completed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, id)
      if (Number(update.changes) !== 1) {
        throw serviceError('Game session has already been used', 409, 'session_replayed')
      }

      db.prepare(`
        INSERT INTO daily_completion (day, activity_id, source, completed_at)
        VALUES (?, ?, 'game-verified', ?)
        ON CONFLICT(day, activity_id) DO UPDATE SET
          source = excluded.source,
          completed_at = excluded.completed_at
      `).run(row.day, row.activity_id, now)
      insertCompletion.run(
        `game:${row.id}`, row.activity_id, row.day, 'game-verified', 'reading-game-contract', row.id,
        now, JSON.stringify({ expectedOrigin: row.expected_origin }),
      )
      completedSession = gameSessionFromRow({ ...row, status: 'completed', completed_at: now })
      insertAudit.run(
        'game_session_completed',
        JSON.stringify({ sessionId: row.id, activityId: row.activity_id, day: row.day }),
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return completedSession
  }

  function startSession(input) {
    if (getPendingSessionRow()) throw new Error('Finish or end the current session first')
    const targetSeconds = Math.floor(Number(input.targetSeconds))
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new Error('A positive target duration is required')
    if (!['required', 'optional', 'reward'].includes(input.kind)) throw new Error('Unsupported session kind')

    const id = makeId()
    const now = asIso(wallNow())
    insertSession.run(
      id, makeId(), input.kind, String(input.activityId), input.sessionKey ? String(input.sessionKey) : null,
      String(input.label), targetSeconds * 1000, 0, 'active', runtimeId, monotonicNow(), now, now, now,
    )
    addAudit('session_started', { sessionId: id, kind: input.kind, activityId: input.activityId, sessionKey: input.sessionKey })
    return sessionFromRow(getSessionRow(id))
  }

  function applySessionCompletion(row, completedAt) {
    const method = row.kind === 'reward' ? 'reward-playback' : 'time-in-session'
    const result = insertCompletion.run(
      `session:${row.id}`, row.activity_id, row.session_key ?? null, method, 'server-heartbeat', row.id,
      completedAt, JSON.stringify({ creditedSeconds: Math.ceil(Number(row.target_ms) / 1000) }),
    )
    if (Number(result.changes) === 0) return false

    if (row.kind === 'required') {
      db.prepare(`
        INSERT INTO daily_completion (day, activity_id, source, completed_at)
        VALUES (?, ?, 'time-in-session', ?)
        ON CONFLICT(day, activity_id) DO UPDATE SET source = excluded.source, completed_at = excluded.completed_at
      `).run(row.session_key, row.activity_id, completedAt)
    } else if (row.kind === 'optional') {
      const optionalResult = db.prepare(`
        INSERT OR IGNORE INTO optional_completion (session_key, completed_at) VALUES (?, ?)
      `).run(row.session_key, completedAt)
      if (Number(optionalResult.changes) > 0) {
        db.prepare(`
          INSERT OR IGNORE INTO reward_credit (id, source, remaining_seconds, earned_at)
          VALUES (?, ?, 300, ?)
        `).run(`session:${row.id}`, row.label, completedAt)
      }
    } else if (row.kind === 'reward') {
      db.prepare('DELETE FROM reward_credit WHERE id = ?').run(row.activity_id)
    }
    return true
  }

  function heartbeatSession(id, active) {
    const row = getSessionRow(id)
    if (!row) throw new Error('Session not found')
    if (row.status === 'cancelled' || row.acknowledged) throw new Error('Session is no longer active')
    if (row.status === 'completed') return sessionFromRow(row)

    const now = asIso(wallNow())
    const tick = monotonicNow()
    const requestedActive = active === true
    let creditedMs = Number(row.credited_ms)

    if (requestedActive && row.status === 'active' && row.runtime_id === runtimeId && row.last_tick_ms != null) {
      const elapsed = tick - Number(row.last_tick_ms)
      if (elapsed >= 0 && elapsed <= MAX_HEARTBEAT_GAP_MS) creditedMs += elapsed
    }

    creditedMs = Math.min(Number(row.target_ms), Math.max(0, Math.floor(creditedMs)))
    const completed = creditedMs >= Number(row.target_ms)

    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE activity_session
        SET credited_ms = ?, status = ?, runtime_id = ?, last_tick_ms = ?,
            last_heartbeat_at = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(
        creditedMs,
        completed ? 'completed' : requestedActive ? 'active' : 'paused',
        completed || !requestedActive ? null : runtimeId,
        completed || !requestedActive ? null : tick,
        now,
        now,
        completed ? now : null,
        row.id,
      )
      if (completed) applySessionCompletion({ ...row, credited_ms: creditedMs }, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    if (completed) addAudit('session_completed', { sessionId: row.id, kind: row.kind, activityId: row.activity_id })
    return sessionFromRow(getSessionRow(row.id))
  }

  function cancelSession(id) {
    const row = getSessionRow(id)
    if (!row) throw new Error('Session not found')
    if (row.status === 'completed') throw new Error('Completed sessions must be acknowledged')
    if (row.status === 'cancelled' || row.acknowledged) return null
    const now = asIso(wallNow())

    db.exec('BEGIN IMMEDIATE')
    try {
      if (row.kind === 'reward') {
        const remainingSeconds = Math.ceil(Math.max(0, Number(row.target_ms) - Number(row.credited_ms)) / 1000)
        db.prepare('UPDATE reward_credit SET remaining_seconds = ? WHERE id = ?').run(remainingSeconds, row.activity_id)
      }
      db.prepare(`
        UPDATE activity_session
        SET status = 'cancelled', acknowledged = 1, runtime_id = NULL, last_tick_ms = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, row.id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    addAudit('session_cancelled', { sessionId: row.id, kind: row.kind, activityId: row.activity_id })
    return null
  }

  function acknowledgeSession(id) {
    const row = getSessionRow(id)
    if (!row) throw new Error('Session not found')
    if (row.status !== 'completed') throw new Error('Session is not complete')
    db.prepare('UPDATE activity_session SET acknowledged = 1, updated_at = ? WHERE id = ?').run(asIso(wallNow()), row.id)
    return null
  }

  function setDailyCompletion({ day, activityId, completed, method }) {
    if (!DAYS.includes(day)) throw new Error('Invalid weekday')
    if (!['self-reported', 'parent-override'].includes(method)) throw new Error('Invalid completion method')
    const now = asIso(wallNow())
    const wasComplete = Boolean(db.prepare(
      'SELECT 1 FROM daily_completion WHERE day = ? AND activity_id = ?',
    ).get(day, String(activityId)))
    if (completed) {
      db.prepare(`
        INSERT INTO daily_completion (day, activity_id, source, completed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(day, activity_id) DO UPDATE SET source = excluded.source, completed_at = excluded.completed_at
      `).run(day, String(activityId), method, now)
      if (!wasComplete) {
        insertCompletion.run(
          makeId(), String(activityId), day, method, method === 'parent-override' ? 'parent-dashboard' : 'child-ui',
          null, now, '{}',
        )
      }
    } else {
      db.prepare('DELETE FROM daily_completion WHERE day = ? AND activity_id = ?').run(day, String(activityId))
    }
    addAudit('daily_completion_changed', { day, activityId, completed: Boolean(completed), method })
    return loadState()
  }

  function getRewardCredit(id) {
    const row = db.prepare('SELECT * FROM reward_credit WHERE id = ?').get(String(id))
    return row ? {
      id: row.id,
      source: row.source,
      remainingSeconds: Number(row.remaining_seconds),
      earnedAt: row.earned_at,
    } : null
  }

  function recordGuardianHeartbeat(input) {
    const guardianId = String(input.guardianId ?? '').trim().slice(0, 120)
    const mode = input.mode === 'enforcing' ? 'enforcing' : 'dry-run'
    const activeBundleId = input.activeBundleId ? String(input.activeBundleId).slice(0, 200) : null
    const decision = String(input.decision ?? 'unknown').slice(0, 80)
    const version = String(input.version ?? 'unknown').slice(0, 40)
    if (!guardianId) throw new Error('guardianId is required')
    const lastSeenAt = asIso(wallNow())
    const previous = db.prepare('SELECT decision, active_bundle_id FROM guardian_status WHERE singleton = 1').get()
    db.prepare(`
      INSERT INTO guardian_status (
        singleton, guardian_id, mode, active_bundle_id, decision, version, last_seen_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        guardian_id = excluded.guardian_id,
        mode = excluded.mode,
        active_bundle_id = excluded.active_bundle_id,
        decision = excluded.decision,
        version = excluded.version,
        last_seen_at = excluded.last_seen_at
    `).run(guardianId, mode, activeBundleId, decision, version, lastSeenAt)
    if (decision === 'blocked' && (previous?.decision !== 'blocked' || previous?.active_bundle_id !== activeBundleId)) {
      addAudit('guardian_blocked_app_observed', { guardianId, mode, activeBundleId })
    }
    return getGuardianStatus()
  }

  function getGuardianStatus() {
    const row = db.prepare('SELECT * FROM guardian_status WHERE singleton = 1').get()
    if (!row) return { connected: false, lastSeenAt: null }
    const ageMs = new Date(asIso(wallNow())).getTime() - new Date(row.last_seen_at).getTime()
    return {
      connected: ageMs >= 0 && ageMs <= 15_000,
      guardianId: row.guardian_id,
      mode: row.mode,
      activeBundleId: row.active_bundle_id ?? null,
      decision: row.decision,
      version: row.version,
      lastSeenAt: row.last_seen_at,
    }
  }

  function recordChromeExtensionHeartbeat(input) {
    const extensionId = String(input.extensionId ?? '').trim().slice(0, 80)
    const version = String(input.version ?? 'unknown').slice(0, 40)
    const mode = String(input.mode ?? 'unknown').slice(0, 40)
    const activeOrigin = input.activeOrigin ? String(input.activeOrigin).slice(0, 300) : null
    const decision = String(input.decision ?? 'unknown').slice(0, 80)
    const policyVersion = String(input.policyVersion ?? 'unknown').slice(0, 40)
    if (!extensionId) throw new Error('extensionId is required')
    const lastSeenAt = asIso(wallNow())
    const previous = db.prepare(
      'SELECT decision, active_origin FROM chrome_extension_status WHERE singleton = 1',
    ).get()
    db.prepare(`
      INSERT INTO chrome_extension_status (
        singleton, extension_id, version, mode, active_origin, decision, policy_version, last_seen_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        extension_id = excluded.extension_id,
        version = excluded.version,
        mode = excluded.mode,
        active_origin = excluded.active_origin,
        decision = excluded.decision,
        policy_version = excluded.policy_version,
        last_seen_at = excluded.last_seen_at
    `).run(extensionId, version, mode, activeOrigin, decision, policyVersion, lastSeenAt)
    if (decision === 'blocked' && (previous?.decision !== 'blocked' || previous?.active_origin !== activeOrigin)) {
      addAudit('chrome_navigation_blocked', { extensionId, activeOrigin, policyVersion })
    }
    return getChromeExtensionStatus()
  }

  function getChromeExtensionStatus() {
    const row = db.prepare('SELECT * FROM chrome_extension_status WHERE singleton = 1').get()
    if (!row) return { connected: false, lastSeenAt: null }
    const ageMs = new Date(asIso(wallNow())).getTime() - new Date(row.last_seen_at).getTime()
    return {
      connected: ageMs >= 0 && ageMs <= 45_000,
      extensionId: row.extension_id,
      version: row.version,
      mode: row.mode,
      activeOrigin: row.active_origin ?? null,
      decision: row.decision,
      policyVersion: row.policy_version,
      lastSeenAt: row.last_seen_at,
    }
  }

  function googleDeliveryFromRow(row) {
    if (!row) return null
    return {
      id: row.id,
      weekId: row.week_id,
      mode: row.mode,
      status: row.status,
      accountEmail: row.account_email,
      recipient: row.recipient,
      documentId: row.document_id,
      documentName: row.document_name,
      documentUrl: row.document_path ? `/api/google/mock/deliveries/${encodeURIComponent(row.id)}/document` : null,
      pdfUrl: row.pdf_path ? `/api/google/mock/deliveries/${encodeURIComponent(row.id)}/pdf` : null,
      draftCount: Number(row.draft_count),
      attemptCount: Number(row.attempt_count),
      lastError: row.last_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deliveredAt: row.delivered_at ?? null,
    }
  }

  function listGoogleDeliveries(limit = 12) {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 12))
    return db.prepare(`
      SELECT * FROM google_delivery ORDER BY created_at DESC LIMIT ?
    `).all(safeLimit).map(googleDeliveryFromRow)
  }

  function getGoogleProofState() {
    const connection = db.prepare('SELECT * FROM google_connection WHERE singleton = 1').get()
    return {
      mode: 'mock',
      connected: Boolean(connection?.connected),
      accountEmail: connection?.connected ? connection.account_email : null,
      connectedAt: connection?.connected ? connection.connected_at : null,
      deliveries: listGoogleDeliveries(),
    }
  }

  function connectMockGoogle(input) {
    const accountEmail = normalizeEmail(input.accountEmail, 'test account')
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO google_connection (
          singleton, mode, account_email, connected, connected_at, updated_at
        ) VALUES (1, 'mock', ?, 1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          mode = 'mock',
          account_email = excluded.account_email,
          connected = 1,
          connected_at = excluded.connected_at,
          updated_at = excluded.updated_at
      `).run(accountEmail, now, now)
      insertAudit.run('google_mock_connected', JSON.stringify({ accountEmail }), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getGoogleProofState()
  }

  function disconnectMockGoogle() {
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE google_connection SET connected = 0, updated_at = ? WHERE singleton = 1
      `).run(now)
      insertAudit.run('google_mock_disconnected', '{}', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getGoogleProofState()
  }

  function prepareMockGoogleDelivery(input) {
    const connection = db.prepare(`
      SELECT * FROM google_connection WHERE singleton = 1 AND connected = 1
    `).get()
    if (!connection) throw serviceError('Connect the test Google account first', 409, 'google_not_connected')

    const recipient = normalizeEmail(input.recipient, 'test recipient')
    const weekId = input.weekId ? String(input.weekId) : getMondayId(wallNow())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw serviceError('A valid week ID is required')
    const documentId = `mock-doc-${createHash('sha256')
      .update(`${connection.account_email}:${weekId}`)
      .digest('hex')
      .slice(0, 16)}`
    const idempotencyKey = `${weekId}:${documentId}`
    const existing = db.prepare('SELECT * FROM google_delivery WHERE idempotency_key = ?').get(idempotencyKey)
    const draftRows = db.prepare(`
      SELECT id, title, body, findings_json, updated_at
      FROM writing_submission
      WHERE length(trim(body)) > 0
      ORDER BY updated_at
    `).all()
    const drafts = draftRows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      findings: safeJson(row.findings_json, []),
      updatedAt: row.updated_at,
    }))

    if (existing && existing.status !== 'failed') {
      return { delivery: googleDeliveryFromRow(existing), drafts: [], created: false }
    }

    const now = asIso(wallNow())
    const documentName = `Fionnbar Writing - Week of ${weekId}`
    if (existing) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`
          UPDATE google_delivery
          SET status = 'creating', recipient = ?, draft_count = ?, attempt_count = attempt_count + 1,
              last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'failed'
        `).run(recipient, drafts.length, now, existing.id)
        insertAudit.run(
          'google_mock_delivery_retried',
          JSON.stringify({ deliveryId: existing.id, weekId, documentId, recipient }),
          now,
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return {
        delivery: googleDeliveryFromRow(db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(existing.id)),
        drafts,
        created: true,
      }
    }

    const id = makeId()
    const status = drafts.length === 0 ? 'skipped' : 'creating'
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO google_delivery (
          id, week_id, idempotency_key, mode, status, account_email, recipient,
          document_id, document_name, draft_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'mock', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, weekId, idempotencyKey, status, connection.account_email, recipient,
        documentId, documentName, drafts.length, now, now,
      )
      insertAudit.run(
        drafts.length === 0 ? 'google_mock_delivery_skipped' : 'google_mock_delivery_started',
        JSON.stringify({ deliveryId: id, weekId, documentId, recipient, draftCount: drafts.length }),
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return {
      delivery: googleDeliveryFromRow(db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(id)),
      drafts,
      created: true,
    }
  }

  function completeMockGoogleDelivery(id, artifacts) {
    const deliveryId = String(id)
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      const update = db.prepare(`
        UPDATE google_delivery
        SET status = 'simulated', document_path = ?, pdf_path = ?, last_error = NULL,
            updated_at = ?, delivered_at = ?
        WHERE id = ? AND status = 'creating'
      `).run(String(artifacts.documentPath), String(artifacts.pdfPath), now, now, deliveryId)
      if (Number(update.changes) !== 1) {
        throw serviceError('The proof delivery is no longer awaiting artifacts', 409, 'delivery_not_pending')
      }
      const row = db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(deliveryId)
      insertAudit.run(
        'google_mock_delivery_simulated',
        JSON.stringify({
          deliveryId,
          weekId: row.week_id,
          documentId: row.document_id,
          recipient: row.recipient,
          draftCount: Number(row.draft_count),
        }),
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return googleDeliveryFromRow(db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(deliveryId))
  }

  function failMockGoogleDelivery(id, error) {
    const deliveryId = String(id)
    const message = String(error instanceof Error ? error.message : error).slice(0, 500)
    const now = asIso(wallNow())
    db.prepare(`
      UPDATE google_delivery
      SET status = 'failed', last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'creating'
    `).run(message, now, deliveryId)
    addAudit('google_mock_delivery_failed', { deliveryId, error: message })
    return googleDeliveryFromRow(db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(deliveryId))
  }

  function getGoogleDeliveryArtifact(id, kind) {
    if (!['document', 'pdf'].includes(kind)) throw serviceError('Unknown delivery artifact', 404, 'artifact_not_found')
    const row = db.prepare('SELECT * FROM google_delivery WHERE id = ?').get(String(id))
    const path = kind === 'document' ? row?.document_path : row?.pdf_path
    if (!row || row.status !== 'simulated' || !path) {
      throw serviceError('Delivery artifact not found', 404, 'artifact_not_found')
    }
    return {
      path,
      filename: kind === 'document' ? `${row.document_name}.html` : `${row.document_name}.pdf`,
      contentType: kind === 'document' ? 'text/html; charset=utf-8' : 'application/pdf',
    }
  }

  function isOptionalComplete(sessionKey) {
    return Boolean(db.prepare('SELECT 1 FROM optional_completion WHERE session_key = ?').get(String(sessionKey)))
  }

  function addAudit(eventType, details = {}) {
    const createdAt = asIso(wallNow())
    insertAudit.run(String(eventType), JSON.stringify(details), createdAt)
    return { eventType, details, createdAt }
  }

  function listAudit(limit = 30) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30))
    return db
      .prepare('SELECT id, event_type, details_json, created_at FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(safeLimit)
      .map((row) => ({
        id: Number(row.id),
        eventType: row.event_type,
        details: safeJson(row.details_json, {}),
        createdAt: row.created_at,
      }))
  }

  function info() {
    return {
      database: filename,
      schemaVersion: SCHEMA_VERSION,
      initialized: isInitialized(),
      lastWriteAt: db.prepare(`SELECT value FROM app_meta WHERE key = 'last_write_at'`).get()?.value ?? null,
    }
  }

  return {
    db,
    loadState,
    saveState,
    startGameSession,
    getGameSession,
    completeGameSession,
    startSession,
    heartbeatSession,
    cancelSession,
    acknowledgeSession,
    setDailyCompletion,
    getRewardCredit,
    isOptionalComplete,
    recordGuardianHeartbeat,
    getGuardianStatus,
    recordChromeExtensionHeartbeat,
    getChromeExtensionStatus,
    connectMockGoogle,
    disconnectMockGoogle,
    getGoogleProofState,
    prepareMockGoogleDelivery,
    completeMockGoogleDelivery,
    failMockGoogleDelivery,
    getGoogleDeliveryArtifact,
    addAudit,
    listAudit,
    listCompletions,
    info,
    isInitialized,
    close: () => db.close(),
  }
}

function getMondayId(date) {
  const copy = new Date(date)
  const day = copy.getDay()
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day))
  return copy.toISOString().slice(0, 10)
}
