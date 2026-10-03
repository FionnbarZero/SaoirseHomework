import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const SCHEMA_VERSION = 1

function emptyState() {
  return {
    entered: false,
    requiredByDay: Object.fromEntries(DAYS.map((day) => [day, []])),
    optionalCompleted: [],
    rewardCredits: [],
    drafts: [],
    activeTimer: null,
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

export function createStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })

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
  setMeta.run('schema_version', String(SCHEMA_VERSION))

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
  const insertTimer = db.prepare(`
    INSERT INTO active_timer (
      singleton, kind, activity_id, session_key, label, total_seconds,
      remaining_seconds, running, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const insertAudit = db.prepare(`
    INSERT INTO audit_log (event_type, details_json, created_at) VALUES (?, ?, ?)
  `)

  function isInitialized() {
    return db.prepare(`SELECT value FROM app_meta WHERE key = 'initialized'`).get()?.value === '1'
  }

  function loadState() {
    const state = emptyState()
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((row) => [row.key, row.value]),
    )

    state.entered = settings.entered === '1'
    state.guardianConnected = settings.guardian_connected === '1'

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

    const timer = db.prepare('SELECT * FROM active_timer WHERE singleton = 1').get()
    if (timer) {
      state.activeTimer = {
        kind: timer.kind,
        activityId: timer.activity_id,
        sessionKey: timer.session_key ?? undefined,
        label: timer.label,
        totalSeconds: Number(timer.total_seconds),
        remainingSeconds: Number(timer.remaining_seconds),
        running: Boolean(timer.running),
      }
    }

    return state
  }

  function saveState(state) {
    assertState(state)
    const now = new Date().toISOString()
    const weekId = getMondayId(new Date())

    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        DELETE FROM daily_completion;
        DELETE FROM optional_completion;
        DELETE FROM reward_credit;
        DELETE FROM writing_submission;
        DELETE FROM active_timer;
      `)

      for (const day of DAYS) {
        const activities = Array.isArray(state.requiredByDay[day]) ? state.requiredByDay[day] : []
        for (const activityId of [...new Set(activities)]) {
          insertRequired.run(day, String(activityId), 'browser', now)
        }
      }

      for (const sessionKey of [...new Set(state.optionalCompleted)]) {
        insertOptional.run(String(sessionKey), now)
      }

      for (const credit of state.rewardCredits) {
        insertReward.run(
          String(credit.id),
          String(credit.source ?? 'Reward'),
          Math.max(0, Number(credit.remainingSeconds) || 0),
          String(credit.earnedAt ?? now),
        )
      }

      for (const draft of state.drafts) {
        insertDraft.run(
          String(draft.id),
          String(draft.title ?? 'Untitled writing'),
          String(draft.body ?? ''),
          JSON.stringify(Array.isArray(draft.findings) ? draft.findings : []),
          String(draft.updatedAt ?? now),
        )
      }

      if (state.activeTimer) {
        const timer = state.activeTimer
        insertTimer.run(
          String(timer.kind),
          String(timer.activityId),
          timer.sessionKey ? String(timer.sessionKey) : null,
          String(timer.label),
          Math.max(0, Number(timer.totalSeconds) || 0),
          Math.max(0, Number(timer.remainingSeconds) || 0),
          timer.running ? 1 : 0,
          now,
        )
      }

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

  function addAudit(eventType, details = {}) {
    const createdAt = new Date().toISOString()
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

  return { db, loadState, saveState, addAudit, listAudit, info, isInitialized, close: () => db.close() }
}

function getMondayId(date) {
  const copy = new Date(date)
  const day = copy.getDay()
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day))
  return copy.toISOString().slice(0, 10)
}
