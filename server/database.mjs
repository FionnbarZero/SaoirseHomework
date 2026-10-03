import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const SCHEMA_VERSION = 3
const MAX_HEARTBEAT_GAP_MS = 7_000

function emptyState() {
  return {
    entered: false,
    requiredByDay: Object.fromEntries(DAYS.map((day) => [day, []])),
    optionalCompleted: [],
    rewardCredits: [],
    drafts: [],
    activeTimer: null,
    completionRecords: [],
    guardianConnected: false,
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

export function createStore(filename, options = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })

  const wallNow = options.wallNow ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const makeId = options.makeId ?? (() => randomUUID())
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

    CREATE TABLE IF NOT EXISTS guardian_status (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      guardian_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'enforcing')),
      active_bundle_id TEXT,
      decision TEXT NOT NULL,
      version TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

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

  setMeta.run('schema_version', String(SCHEMA_VERSION))

  // Restart recovery is fail-closed: elapsed downtime can never become credit.
  db.prepare(`
    UPDATE activity_session
    SET status = 'paused', runtime_id = NULL, last_tick_ms = NULL, updated_at = ?
    WHERE status = 'active'
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
        DELETE FROM daily_completion;
        DELETE FROM optional_completion;
        DELETE FROM reward_credit;
        DELETE FROM writing_submission;
      `)

      for (const day of DAYS) {
        const activities = Array.isArray(state.requiredByDay[day]) ? state.requiredByDay[day] : []
        for (const activityId of [...new Set(activities)]) {
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
    startSession,
    heartbeatSession,
    cancelSession,
    acknowledgeSession,
    setDailyCompletion,
    getRewardCredit,
    isOptionalComplete,
    recordGuardianHeartbeat,
    getGuardianStatus,
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
