import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import {
  applyCompletedSpellingCorrections,
  inspectSpelling,
  spellingPracticeComplete,
} from '../src/spelling.ts'
import {
  applyCompletedCorrections,
  inspectAmbiguousDraft,
  inspectWritingFindings,
  writingReviewStatus,
} from '../src/writing.ts'
import { emptyActivityConfiguration, normalizeActivityConfiguration } from './activity-config.mjs'
import { normalizeProofreadingMatches, proofreadingReviewItems } from './proofreader.mjs'
import { activeRequiredActivities } from '../src/domain.ts'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SCHEMA_VERSION = 29
const MAX_HEARTBEAT_GAP_MS = 7_000
const GAME_ACTIVITY_ID = 'reading-strategies'
const BROWSER_COMPLETION_ACTIVITIES = new Set(activeRequiredActivities().filter((activity) => activity.method === 'self').map((activity) => activity.id))
const requiredActivityIds = (day) => activeRequiredActivities(day).map((activity) => activity.id)
const OPTIONAL_SESSION_KEYS = new Set([
  'voena:0', 'voena:1', 'voena:2',
  'drums:0', 'drums:1', 'drums:2',
  'band:0', 'band:1', 'band:2',
  'volleyball:0', 'volleyball:1', 'volleyball:2',
])
const OPTIONAL_TARGETS = { Monday: 2, Tuesday: 4, Wednesday: 6, Thursday: 8, Friday: 9 }
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
const AI_PROOFREADING_MODES = new Set(['off', 'shadow', 'review', 'assist'])

function emptyWeekContext() {
  return {
    weekId: '',
    fridayId: '',
    timeZone: DEFAULT_TIME_ZONE,
    localDay: 'Monday',
    headStart: false,
    clockRollbackDetected: false,
  }
}

function emptyState(weekContext = emptyWeekContext()) {
  return {
    entered: false,
    requiredByDay: Object.fromEntries(DAYS.map((day) => [day, []])),
    optionalCompleted: [],
    freeModeByDay: {},
    rewardCredits: [],
    drafts: [],
    writingDictionary: { knownNames: ['Saoirse'], knownPlaces: [] },
    writingReviewQueue: [],
    activeTimer: null,
    activeGameSession: null,
    completionRecords: [],
    guardianConnected: false,
    chromeConnected: false,
    activityConfiguration: emptyActivityConfiguration(),
    googleProof: {
      mode: 'mock',
      connected: false,
      accountEmail: null,
      connectedAt: null,
      deliveries: [],
    },
    googleLive: {
      mode: 'safe-test',
      enabled: false,
      clientConfigured: false,
      keychainAvailable: false,
      connected: false,
      accountEmail: null,
      connectedAt: null,
      recipient: null,
      lastError: null,
      deliveries: [],
    },
    weekContext,
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeReadingDate(value) {
  const candidate = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return ''
  const parsed = new Date(`${candidate}T12:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
    ? ''
    : candidate
}

function assertState(state) {
  if (!state || typeof state !== 'object') throw new Error('State must be an object')
  if (!state.requiredByDay || typeof state.requiredByDay !== 'object') throw new Error('Missing daily completion state')
  if (!Array.isArray(state.optionalCompleted)) throw new Error('Invalid optional completion state')
  if (!Array.isArray(state.rewardCredits)) throw new Error('Invalid reward state')
  if (!Array.isArray(state.drafts)) throw new Error('Invalid writing state')
}

function normalizeDictionaryEntries(values) {
  const entries = Array.isArray(values) ? values : []
  const unique = new Map()
  for (const value of entries) {
    const item = String(value ?? '').trim().replace(/\s+/g, ' ')
    if (!item || item.length > 80) continue
    unique.set(item.toLocaleLowerCase(), item)
    if (unique.size >= 100) break
  }
  return [...unique.values()]
}

function normalizeWritingDictionary(value) {
  return {
    knownNames: normalizeDictionaryEntries(value?.knownNames ?? ['Saoirse']),
    knownPlaces: normalizeDictionaryEntries(value?.knownPlaces),
  }
}

function normalizeWritingReviewQueue(value) {
  if (!Array.isArray(value)) return []
  return value.slice(-200).flatMap((item) => {
    const id = String(item?.id ?? '').slice(0, 240)
    const draftId = String(item?.draftId ?? '').slice(0, 160)
    if (!id || !draftId) return []
    const start = Number(item.start)
    const end = Number(item.end)
    const hasEdit = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    const alternatives = Array.isArray(item.alternatives)
      ? [...new Set(item.alternatives.map((entry) => String(entry).slice(0, 400)).filter(Boolean))].slice(0, 8)
      : []
    const source = ['local', 'languagetool', 'ai'].includes(item.source) ? item.source : 'local'
    return [{
      id,
      draftId,
      category: ['Grammar', 'Punctuation', 'Capitalization', 'Spelling'].includes(item.category) ? item.category : 'Grammar',
      message: String(item.message ?? '').slice(0, 500),
      excerpt: String(item.excerpt ?? '').slice(0, 500),
      ...(item.explanation ? { explanation: String(item.explanation).slice(0, 500) } : {}),
      ...(item.suggestion ? { suggestion: String(item.suggestion).slice(0, 400) } : {}),
      source,
      ...(item.confidence && ['high', 'medium', 'low'].includes(item.confidence)
        ? { confidence: item.confidence }
        : {}),
      ...(hasEdit ? { start, end } : {}),
      ...(typeof item.replacement === 'string' ? { replacement: item.replacement.slice(0, 400) } : {}),
      ...(alternatives.length ? { alternatives } : {}),
      ...(item.ruleId ? { ruleId: String(item.ruleId).slice(0, 120) } : {}),
      status: item.status === 'resolved' ? 'resolved' : 'pending',
      ...(item.status === 'resolved' && ['confirmed', 'dismissed'].includes(item.decision)
        ? { decision: item.decision }
        : {}),
      createdAt: String(item.createdAt ?? new Date(0).toISOString()),
      ...(item.resolvedAt ? { resolvedAt: String(item.resolvedAt) } : {}),
    }]
  })
}

function normalizeWritingReviewSuggestions(value) {
  if (!Array.isArray(value)) return []
  return value.slice(-1000).flatMap((item) => {
    const id = String(item?.id ?? '').slice(0, 200)
    if (!id) return []
    const start = Number(item.start)
    const end = Number(item.end)
    const hasEdit = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    const alternatives = Array.isArray(item.alternatives)
      ? [...new Set(item.alternatives.map((entry) => String(entry).slice(0, 400)).filter(Boolean))].slice(0, 8)
      : []
    const source = ['local', 'languagetool', 'ai'].includes(item.source) ? item.source : 'local'
    return [{
      id,
      category: ['Grammar', 'Punctuation', 'Capitalization', 'Spelling'].includes(item.category) ? item.category : 'Grammar',
      message: String(item.message ?? '').slice(0, 500),
      excerpt: String(item.excerpt ?? '').slice(0, 500),
      ...(item.explanation ? { explanation: String(item.explanation).slice(0, 500) } : {}),
      ...(item.suggestion ? { suggestion: String(item.suggestion).slice(0, 400) } : {}),
      source,
      ...(item.confidence && ['high', 'medium', 'low'].includes(item.confidence)
        ? { confidence: item.confidence }
        : {}),
      ...(hasEdit ? { start, end } : {}),
      ...(typeof item.replacement === 'string' ? { replacement: item.replacement.slice(0, 400) } : {}),
      ...(alternatives.length ? { alternatives } : {}),
      ...(item.ruleId ? { ruleId: String(item.ruleId).slice(0, 120) } : {}),
    }]
  })
}

function reviewSuggestionsForDraft(body, value, authoritative = false) {
  const suggestions = [
    ...(authoritative ? [] : inspectAmbiguousDraft(body)),
    ...normalizeWritingReviewSuggestions(value),
  ]
  return [...new Map(suggestions.map((item) => [item.id, item])).values()]
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

function addUtcDays(dateId, days) {
  const date = new Date(`${dateId}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getWeekContext(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('A valid date is required')

  let parts
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]))
  } catch {
    throw new Error(`Invalid weekly-plan time zone: ${timeZone}`)
  }

  const localDateId = `${parts.year}-${parts.month}-${parts.day}`
  const localDayIndex = new Date(`${localDateId}T00:00:00.000Z`).getUTCDay()
  const localHour = Number(parts.hour)
  const headStart = localDayIndex === 0 && localHour >= 4
  const mondayOffset = localDayIndex === 0 ? (headStart ? 1 : -6) : 1 - localDayIndex
  const weekId = addUtcDays(localDateId, mondayOffset)
  return {
    weekId,
    fridayId: addUtcDays(weekId, 4),
    timeZone,
    localDay: DAY_NAMES[localDayIndex],
    headStart,
    clockRollbackDetected: false,
  }
}

export function createStore(filename, options = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })

  const wallNow = options.wallNow ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const makeId = options.makeId ?? (() => randomUUID())
  const makeLearningSessionId = options.makeLearningSessionId ?? (() => randomUUID())
  const makeNonce = options.makeNonce ?? (() => randomBytes(32).toString('base64url'))
  const runtimeId = options.runtimeId ?? randomUUID()
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
  const googleLiveConfiguration = {
    mode: options.googleLiveConfiguration?.mode === 'live' ? 'live' : 'safe-test',
    clientConfigured: options.googleLiveConfiguration?.clientConfigured === true,
    keychainAvailable: options.googleLiveConfiguration?.keychainAvailable === true,
  }
  const db = new DatabaseSync(filename)
  if (filename !== ':memory:' && options.enforceFilePermissions === true) chmodSync(filename, 0o600)
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
      optional_target INTEGER NOT NULL DEFAULT 9,
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

    CREATE TABLE IF NOT EXISTS weekly_daily_completion (
      week_id TEXT NOT NULL,
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (week_id, day, activity_id)
    );

    CREATE TABLE IF NOT EXISTS weekly_optional_completion (
      week_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (week_id, session_key)
    );

    CREATE INDEX IF NOT EXISTS weekly_optional_completion_date
      ON weekly_optional_completion (week_id, completed_at);

    CREATE TABLE IF NOT EXISTS free_mode_unlock (
      week_id TEXT NOT NULL,
      day TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (week_id, day)
    );

    CREATE TABLE IF NOT EXISTS guardian_learning_session (
      service_session_id TEXT PRIMARY KEY,
      week_id TEXT NOT NULL,
      day TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('requested', 'completion-eligible', 'superseded')),
      created_at TEXT NOT NULL,
      completion_eligible_at TEXT
    );

    CREATE INDEX IF NOT EXISTS guardian_learning_session_day
      ON guardian_learning_session (week_id, day, created_at);

    CREATE TABLE IF NOT EXISTS reward_credit (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      earned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS writing_submission (
      id TEXT PRIMARY KEY,
      week_id TEXT,
      activity_key TEXT,
      revision_group_id TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      reading_date TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      pages_read TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      corrected_body TEXT,
      findings_json TEXT NOT NULL,
      proofreading_matches_json TEXT NOT NULL DEFAULT '[]',
      review_suggestions_json TEXT NOT NULL DEFAULT '[]',
      sentence_reviews_json TEXT NOT NULL DEFAULT '[]',
      exercise_progress_json TEXT NOT NULL DEFAULT '{}',
      spelling_words_json TEXT NOT NULL DEFAULT '[]',
      spelling_progress_json TEXT NOT NULL DEFAULT '{}',
      review_status TEXT NOT NULL DEFAULT 'draft',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS writing_check_result (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      result_json TEXT NOT NULL
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
      plan_json TEXT NOT NULL DEFAULT '{}',
      phase_index INTEGER NOT NULL DEFAULT 0,
      phase_credited_ms INTEGER NOT NULL DEFAULT 0,
      target_ms INTEGER NOT NULL CHECK (target_ms > 0),
      credited_ms INTEGER NOT NULL DEFAULT 0 CHECK (credited_ms >= 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
      runtime_id TEXT,
      last_tick_ms REAL,
      created_at TEXT NOT NULL,
      last_heartbeat_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      selection_deadline_at TEXT,
      reward_started_at TEXT,
      reward_playback_active INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS google_live_connection (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      account_email TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      connected INTEGER NOT NULL CHECK (connected IN (0, 1)),
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS google_live_delivery (
      id TEXT PRIMARY KEY,
      week_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('queued', 'creating', 'sent', 'skipped', 'failed')),
      account_email TEXT NOT NULL,
      recipient TEXT NOT NULL,
      document_id TEXT,
      document_name TEXT NOT NULL,
      document_url TEXT,
      pdf_path TEXT,
      share_status TEXT NOT NULL DEFAULT 'pending' CHECK (share_status IN ('pending', 'shared', 'failed')),
      email_message_id TEXT,
      draft_count INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS google_live_delivery_retry
      ON google_live_delivery (status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS google_live_delivery_draft (
      delivery_id TEXT NOT NULL REFERENCES google_live_delivery(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      PRIMARY KEY (delivery_id, draft_id)
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

  function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  ensureColumn('activity_session', 'week_id', 'TEXT')
  ensureColumn('activity_session', 'plan_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('activity_session', 'phase_index', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('activity_session', 'phase_credited_ms', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('activity_session', 'selection_deadline_at', 'TEXT')
  ensureColumn('activity_session', 'reward_started_at', 'TEXT')
  ensureColumn('activity_session', 'reward_playback_active', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('game_session', 'week_id', 'TEXT')
  ensureColumn('writing_submission', 'corrected_body', 'TEXT')
  ensureColumn('writing_submission', 'week_id', 'TEXT')
  ensureColumn('writing_submission', 'activity_key', 'TEXT')
  ensureColumn('writing_submission', 'revision_group_id', 'TEXT')
  ensureColumn('writing_submission', 'version_number', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn('writing_submission', 'reading_date', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('writing_submission', 'author', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('writing_submission', 'pages_read', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('writing_submission', 'exercise_progress_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('writing_submission', 'proofreading_matches_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('writing_submission', 'proofreading_authoritative', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('writing_submission', 'proofreading_check_id', 'TEXT')
  ensureColumn('writing_submission', 'review_suggestions_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('writing_submission', 'sentence_reviews_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('writing_submission', 'spelling_words_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('writing_submission', 'spelling_progress_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('writing_submission', 'review_status', "TEXT NOT NULL DEFAULT 'draft'")

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
    VALUES (?, 9, 0, ?)
    ON CONFLICT(week_id) DO UPDATE SET
      optional_target = 9,
      archived = 0,
      updated_at = excluded.updated_at
  `)
  const insertRequired = db.prepare(`
    INSERT OR IGNORE INTO weekly_daily_completion (week_id, day, activity_id, source, completed_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertOptional = db.prepare(`
    INSERT INTO weekly_optional_completion (week_id, session_key, completed_at) VALUES (?, ?, ?)
  `)
  const insertReward = db.prepare(`
    INSERT INTO reward_credit (id, source, remaining_seconds, earned_at) VALUES (?, ?, ?, ?)
  `)
  const insertDraft = db.prepare(`
    INSERT INTO writing_submission (
      id, week_id, activity_key, revision_group_id, version_number, reading_date, title, author, pages_read, body, corrected_body, findings_json, proofreading_matches_json, review_suggestions_json, sentence_reviews_json,
      exercise_progress_json, spelling_words_json, spelling_progress_json, review_status, updated_at, proofreading_authoritative, proofreading_check_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAudit = db.prepare(`
    INSERT INTO audit_log (event_type, details_json, created_at) VALUES (?, ?, ?)
  `)
  const insertSession = db.prepare(`
    INSERT INTO activity_session (
      id, nonce, kind, activity_id, session_key, week_id, label, plan_json, phase_index,
      phase_credited_ms, target_ms, credited_ms, status, runtime_id, last_tick_ms,
      created_at, last_heartbeat_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCompletion = db.prepare(`
    INSERT OR IGNORE INTO completion_record (
      id, activity_id, session_key, method, source, session_id, completed_at, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertGameSession = db.prepare(`
    INSERT INTO game_session (
      id, activity_id, day, week_id, nonce_hash, expected_origin, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `)

  function ensureCurrentWeek() {
    const computed = getWeekContext(wallNow(), timeZone)
    const activeWeekId = db.prepare(`
      SELECT value FROM app_meta WHERE key = 'active_week_id'
    `).get()?.value

    // A clock rollback must never reopen an older ledger or reset it again.
    if (activeWeekId && computed.weekId < activeWeekId) {
      return {
        ...computed,
        weekId: activeWeekId,
        fridayId: addUtcDays(activeWeekId, 4),
        clockRollbackDetected: true,
      }
    }

    const now = asIso(wallNow())
    if (!activeWeekId || activeWeekId !== computed.weekId) {
      db.exec('BEGIN IMMEDIATE')
      try {
        if (activeWeekId) {
          db.prepare('UPDATE weekly_plan SET archived = 1, updated_at = ? WHERE week_id = ?')
            .run(now, activeWeekId)
        }
        upsertWeek.run(computed.weekId, now)
        setMeta.run('active_week_id', computed.weekId)
        if (activeWeekId) {
          setSetting.run('entered', '0')
          insertAudit.run(
            'weekly_plan_rolled_over',
            JSON.stringify({ previousWeekId: activeWeekId, weekId: computed.weekId, timeZone }),
            now,
          )
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    } else if (!db.prepare('SELECT 1 FROM weekly_plan WHERE week_id = ?').get(computed.weekId)) {
      upsertWeek.run(computed.weekId, now)
    }
    return computed
  }

  const computedMigrationWeek = getWeekContext(wallNow(), timeZone).weekId
  const legacyWeekId = db.prepare(`
    SELECT week_id FROM weekly_plan WHERE archived = 0 ORDER BY updated_at DESC LIMIT 1
  `).get()?.week_id
  const migrationWeek = /^\d{4}-\d{2}-\d{2}$/.test(legacyWeekId ?? '')
    ? legacyWeekId
    : computedMigrationWeek
  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'weekly_scope_migrated'`).get()?.value !== '1') {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT OR IGNORE INTO weekly_daily_completion (
          week_id, day, activity_id, source, completed_at
        ) SELECT ?, day, activity_id, source, completed_at FROM daily_completion
      `).run(migrationWeek)
      db.prepare(`
        INSERT OR IGNORE INTO weekly_optional_completion (week_id, session_key, completed_at)
        SELECT ?, session_key, completed_at FROM optional_completion
      `).run(migrationWeek)
      if (!db.prepare(`SELECT value FROM app_meta WHERE key = 'active_week_id'`).get()) {
        setMeta.run('active_week_id', migrationWeek)
      }
      setMeta.run('weekly_scope_migrated', '1')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'daily_chinese_activities_migrated'`).get()?.value !== '1') {
    const moved = db.prepare(`
      SELECT week_id, session_key, completed_at
      FROM weekly_optional_completion
      WHERE session_key LIKE 'level-chinese:%' OR session_key LIKE 'du-chinese:%'
      ORDER BY completed_at
    `).all()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const completion of moved) {
        const activityId = String(completion.session_key).split(':')[0]
        const context = getWeekContext(new Date(completion.completed_at), timeZone)
        const day = context.localDay === 'Sunday' && context.headStart
          ? 'Monday'
          : context.localDay
        if (context.weekId === completion.week_id && DAYS.includes(day)) {
          insertRequired.run(
            completion.week_id,
            day,
            activityId,
            'migrated-from-practice-bank',
            completion.completed_at,
          )
        }
      }
      db.prepare(`
        DELETE FROM weekly_optional_completion
        WHERE session_key LIKE 'level-chinese:%' OR session_key LIKE 'du-chinese:%'
      `).run()
      db.prepare(`
        DELETE FROM optional_completion
        WHERE session_key LIKE 'level-chinese:%' OR session_key LIKE 'du-chinese:%'
      `).run()
      db.prepare('UPDATE weekly_plan SET optional_target = 9').run()
      setMeta.run('daily_chinese_activities_migrated', '1')
      if (moved.length > 0) {
        insertAudit.run(
          'chinese_activities_moved_to_daily_checklist',
          JSON.stringify({ migratedPracticeCompletions: moved.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'writing_practice_target_3_migrated'`).get()?.value !== '1') {
    const dictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const drafts = db.prepare(`
      SELECT id, body, exercise_progress_json, spelling_progress_json
      FROM writing_submission
      WHERE review_status != 'complete'
    `).all()
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateDraft = db.prepare(`
        UPDATE writing_submission
        SET corrected_body = ?, findings_json = ?, exercise_progress_json = ?,
            spelling_words_json = ?, spelling_progress_json = ?, review_status = ?
        WHERE id = ?
      `)
      for (const draft of drafts) {
        const body = String(draft.body ?? '')
        const findings = inspectWritingFindings(body, dictionary)
        const previousProgress = safeJson(draft.exercise_progress_json, {})
        const progress = Object.fromEntries(findings.map((finding) => {
          const previous = previousProgress[finding.id] ?? {}
          const attemptResults = Array.isArray(previous.attemptResults)
            ? previous.attemptResults.slice(0, finding.practice.length + 1).map(Boolean)
            : []
          return [finding.id, {
            correctionComplete: previous.correctionComplete === true,
            practiceCompleted: Math.min(
              finding.practice.length,
              Math.max(0, Number(previous.practiceCompleted) || 0),
            ),
            incorrectAttempts: attemptResults.length
              ? attemptResults.filter((result) => !result).length
              : Math.max(0, Number(previous.incorrectAttempts) || 0),
            ...(attemptResults.length ? { attemptResults } : {}),
          }]
        }))
        const spellingWords = inspectSpelling(body, dictionary)
        const spellingProgress = safeJson(draft.spelling_progress_json, {})
        const grammarCorrected = applyCompletedCorrections(body, findings, progress)
        const correctedBody = applyCompletedSpellingCorrections(
          grammarCorrected,
          spellingWords,
          spellingProgress,
        )
        const reviewStatus = writingReviewStatus(findings, progress, spellingWords, spellingProgress)
        updateDraft.run(
          correctedBody,
          JSON.stringify(findings),
          JSON.stringify(progress),
          JSON.stringify(spellingWords),
          JSON.stringify(spellingProgress),
          reviewStatus,
          draft.id,
        )
      }
      setMeta.run('writing_practice_target_3_migrated', '1')
      if (drafts.length > 0) {
        insertAudit.run(
          'writing_practice_target_migrated',
          JSON.stringify({ practiceExamples: 3, draftsUpdated: drafts.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'spelling_multiple_choice_v2_migrated'`).get()?.value !== '1') {
    const dictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const drafts = db.prepare(`
      SELECT id, body, exercise_progress_json
      FROM writing_submission
      WHERE review_status != 'complete'
         OR updated_at >= COALESCE(
           (SELECT min(created_at) FROM game_session WHERE status = 'pending'),
           '9999-12-31T23:59:59.999Z'
         )
    `).all()
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateDraft = db.prepare(`
        UPDATE writing_submission
        SET corrected_body = ?, findings_json = ?, exercise_progress_json = ?,
            spelling_words_json = '[]', spelling_progress_json = '{}', review_status = ?
        WHERE id = ?
      `)
      for (const draft of drafts) {
        const body = String(draft.body ?? '')
        const findings = inspectWritingFindings(body, dictionary)
        const previousProgress = safeJson(draft.exercise_progress_json, {})
        const progress = Object.fromEntries(findings.map((finding) => {
          const previous = previousProgress[finding.id] ?? {}
          const attemptResults = Array.isArray(previous.attemptResults)
            ? previous.attemptResults.slice(0, finding.practice.length + 1).map(Boolean)
            : []
          return [finding.id, {
            correctionComplete: previous.correctionComplete === true,
            practiceCompleted: Math.min(
              finding.practice.length,
              Math.max(0, Number(previous.practiceCompleted) || 0),
            ),
            incorrectAttempts: attemptResults.length
              ? attemptResults.filter((result) => !result).length
              : Math.max(0, Number(previous.incorrectAttempts) || 0),
            ...(attemptResults.length ? { attemptResults } : {}),
          }]
        }))
        const correctedBody = applyCompletedCorrections(body, findings, progress)
        const reviewStatus = writingReviewStatus(findings, progress, [], {})
        updateDraft.run(
          correctedBody,
          JSON.stringify(findings),
          JSON.stringify(progress),
          reviewStatus,
          draft.id,
        )
      }
      setMeta.run('spelling_multiple_choice_v2_migrated', '1')
      if (drafts.length > 0) {
        insertAudit.run(
          'spelling_practice_migrated_to_multiple_choice',
          JSON.stringify({ draftsUpdated: drafts.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'varied_writing_practice_v2_migrated'`).get()?.value !== '1') {
    const dictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const drafts = db.prepare(`
      SELECT id, body, exercise_progress_json
      FROM writing_submission
      WHERE review_status != 'complete'
         OR updated_at >= COALESCE(
           (SELECT min(created_at) FROM game_session WHERE status = 'pending'),
           '9999-12-31T23:59:59.999Z'
         )
    `).all()
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateDraft = db.prepare(`
        UPDATE writing_submission
        SET corrected_body = ?, findings_json = ?, exercise_progress_json = ?, review_status = ?
        WHERE id = ?
      `)
      for (const draft of drafts) {
        const body = String(draft.body ?? '')
        const findings = inspectWritingFindings(body, dictionary)
        const previousProgress = safeJson(draft.exercise_progress_json, {})
        const progress = Object.fromEntries(findings.map((finding) => {
          const previous = previousProgress[finding.id] ?? {}
          const attemptResults = Array.isArray(previous.attemptResults)
            ? previous.attemptResults.slice(0, finding.practice.length + 1).map(Boolean)
            : []
          return [finding.id, {
            correctionComplete: previous.correctionComplete === true,
            practiceCompleted: Math.min(
              finding.practice.length,
              Math.max(0, Number(previous.practiceCompleted) || 0),
            ),
            incorrectAttempts: attemptResults.length
              ? attemptResults.filter((result) => !result).length
              : Math.max(0, Number(previous.incorrectAttempts) || 0),
            ...(attemptResults.length ? { attemptResults } : {}),
          }]
        }))
        const correctedBody = applyCompletedCorrections(body, findings, progress)
        const reviewStatus = writingReviewStatus(findings, progress, [], {})
        updateDraft.run(
          correctedBody,
          JSON.stringify(findings),
          JSON.stringify(progress),
          reviewStatus,
          draft.id,
        )
      }
      setMeta.run('varied_writing_practice_v2_migrated', '1')
      if (drafts.length > 0) {
        insertAudit.run(
          'writing_practice_examples_varied',
          JSON.stringify({ draftsUpdated: drafts.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'verified_proofreading_pipeline_v1_migrated'`).get()?.value !== '1') {
    const dictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const existingQueue = normalizeWritingReviewQueue(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_review_queue'`).get()?.value ?? '[]',
      [],
    ))
    const existingById = new Map(existingQueue.map((item) => [item.id, item]))
    const drafts = db.prepare(`
      SELECT id, body, proofreading_matches_json, review_suggestions_json, exercise_progress_json,
             spelling_words_json, spelling_progress_json
      FROM writing_submission
    `).all()
    const migratedQueue = []
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateDraft = db.prepare(`
        UPDATE writing_submission
        SET corrected_body = ?, findings_json = ?, proofreading_matches_json = ?,
            review_suggestions_json = ?, exercise_progress_json = ?, review_status = ?
        WHERE id = ?
      `)
      for (const draft of drafts) {
        const body = String(draft.body ?? '')
        const storedMatches = normalizeProofreadingMatches(
          safeJson(draft.proofreading_matches_json, []),
          body,
        )
        const candidates = storedMatches
          .filter((match) => match.verification !== 'verified')
          .map((match) => ({ ...match, source: 'languagetool', verification: 'candidate' }))
        const proofreadingMatches = [
          ...storedMatches.filter((match) => match.verification === 'verified'),
          ...candidates,
        ]
        const reviewSuggestions = reviewSuggestionsForDraft(body, [
          ...safeJson(draft.review_suggestions_json, []),
          ...proofreadingReviewItems(body, candidates),
        ])
        const findings = inspectWritingFindings(body, dictionary, proofreadingMatches)
        const previousProgress = safeJson(draft.exercise_progress_json, {})
        const exerciseProgress = Object.fromEntries(findings.flatMap((finding) => (
          previousProgress[finding.id] ? [[finding.id, previousProgress[finding.id]]] : []
        )))
        const spellingWords = safeJson(draft.spelling_words_json, [])
        const spellingProgress = safeJson(draft.spelling_progress_json, {})
        const queueItems = reviewSuggestions.map((item) => {
          const id = `${String(draft.id)}:${item.id}`
          return existingById.get(id) ?? {
            ...item,
            id,
            draftId: String(draft.id),
            status: 'pending',
            createdAt: asIso(wallNow()),
          }
        })
        migratedQueue.push(...queueItems)
        const pendingReviewCount = queueItems.filter((item) => item.status === 'pending').length
        const reviewStatus = body.trim()
          ? writingReviewStatus(
            findings,
            exerciseProgress,
            spellingWords,
            spellingProgress,
            pendingReviewCount,
          )
          : 'draft'
        updateDraft.run(
          applyCompletedCorrections(body, findings, exerciseProgress),
          JSON.stringify(findings),
          JSON.stringify(proofreadingMatches),
          JSON.stringify(reviewSuggestions),
          JSON.stringify(exerciseProgress),
          reviewStatus,
          draft.id,
        )
      }
      setSetting.run('writing_review_queue', JSON.stringify(normalizeWritingReviewQueue([
        ...migratedQueue,
        ...existingQueue.filter((item) => !migratedQueue.some((migrated) => migrated.id === item.id)),
      ])))
      setMeta.run('verified_proofreading_pipeline_v1_migrated', '1')
      if (drafts.length > 0) {
        insertAudit.run(
          'writing_proofreading_migrated_to_verified_pipeline',
          JSON.stringify({ draftsUpdated: drafts.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (db.prepare(`SELECT value FROM app_meta WHERE key = 'reviewed_quiz_choice_quality_v1_migrated'`).get()?.value !== '1') {
    const dictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const drafts = db.prepare(`
      SELECT id, body, proofreading_matches_json
      FROM writing_submission
    `).all()
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateDraft = db.prepare(`
        UPDATE writing_submission SET findings_json = ? WHERE id = ?
      `)
      for (const draft of drafts) {
        const body = String(draft.body ?? '')
        const proofreadingMatches = normalizeProofreadingMatches(
          safeJson(draft.proofreading_matches_json, []),
          body,
        )
        const findings = inspectWritingFindings(body, dictionary, proofreadingMatches)
        updateDraft.run(JSON.stringify(findings), draft.id)
      }
      setMeta.run('reviewed_quiz_choice_quality_v1_migrated', '1')
      if (drafts.length > 0) {
        insertAudit.run(
          'writing_quiz_choices_rebuilt',
          JSON.stringify({ draftsUpdated: drafts.length }),
          asIso(wallNow()),
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  db.prepare('UPDATE activity_session SET week_id = ? WHERE week_id IS NULL').run(migrationWeek)
  db.prepare('UPDATE game_session SET week_id = ? WHERE week_id IS NULL').run(migrationWeek)
  db.prepare('UPDATE writing_submission SET week_id = ? WHERE week_id IS NULL').run(migrationWeek)
  ensureCurrentWeek()

  setMeta.run('schema_version', String(SCHEMA_VERSION))

  // Restart recovery is fail-closed: elapsed downtime can never become credit.
  db.prepare(`
    UPDATE activity_session
    SET status = 'paused', runtime_id = NULL, last_tick_ms = NULL,
        reward_playback_active = 0, updated_at = ?
    WHERE status = 'active'
  `).run(asIso(wallNow()))

  db.prepare(`
    UPDATE google_delivery
    SET status = 'failed', last_error = 'The local service restarted during artifact creation', updated_at = ?
    WHERE status = 'creating'
  `).run(asIso(wallNow()))

  db.prepare(`
    UPDATE google_live_delivery
    SET status = 'failed', last_error = 'The local service restarted during Google delivery',
        next_attempt_at = ?, updated_at = ?
    WHERE status = 'creating'
  `).run(asIso(wallNow()), asIso(wallNow()))

  // Preserve a timer written by schema version 1 as a paused, server-owned session.
  const legacyTimer = db.prepare('SELECT * FROM active_timer WHERE singleton = 1').get()
  const pendingSession = db.prepare(`
    SELECT id FROM activity_session
    WHERE acknowledged = 0 AND status IN ('active', 'paused', 'completed')
  `).get()
  if (legacyTimer && !pendingSession) {
    const now = asIso(wallNow())
    const weekId = ensureCurrentWeek().weekId
    const creditedMs = Math.max(0, Number(legacyTimer.total_seconds - legacyTimer.remaining_seconds)) * 1000
    insertSession.run(
      makeId(), makeId(), legacyTimer.kind, legacyTimer.activity_id,
      legacyTimer.session_key ?? null, weekId, legacyTimer.label,
      '{}', 0, creditedMs,
      Number(legacyTimer.total_seconds) * 1000,
      creditedMs,
      'paused', null, null, now, null, now,
    )
  }
  db.exec('DELETE FROM active_timer')

  function isInitialized() {
    return db.prepare(`SELECT value FROM app_meta WHERE key = 'initialized'`).get()?.value === '1'
  }

  function getActivityConfiguration() {
    const saved = db.prepare(`SELECT value FROM settings WHERE key = 'activity_configuration'`).get()?.value
    return normalizeActivityConfiguration(saved ? safeJson(saved, {}) : {})
  }

  function setActivityConfiguration(input) {
    const configuration = normalizeActivityConfiguration(input)
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      setSetting.run('activity_configuration', JSON.stringify(configuration))
      insertAudit.run(
        'activity_configuration_updated',
        JSON.stringify({
          ninjaDojoReady: configuration.ninjaDojo.ready,
          duChineseReady: configuration.duChinese.ready,
          levelChineseReady: configuration.levelChinese.ready,
        }),
        now,
      )
      setMeta.run('last_write_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return configuration
  }

  function normalizeSessionPlan(input, targetSeconds, label) {
    if (!input?.phases) {
      return {
        phases: [{
          id: 'focus',
          label,
          targetSeconds,
          launchUrl: '',
          allowedOrigins: [],
          creditOrigins: [],
          advanceOrigins: [],
          verification: 'browser-focus',
          navigateOnStart: false,
        }],
      }
    }
    if (!Array.isArray(input.phases) || input.phases.length < 1 || input.phases.length > 5) {
      throw new Error('A session plan needs between one and five phases')
    }
    const phases = input.phases.map((phase, index) => {
      const phaseSeconds = Math.floor(Number(phase.targetSeconds))
      if (!Number.isFinite(phaseSeconds) || phaseSeconds < 0) throw new Error('Session phase duration is invalid')
      const verification = ['managed-chrome', 'youtube-playback', 'in-app-browser', 'self-timed'].includes(phase.verification)
        ? phase.verification
        : 'browser-focus'
      const allowedOrigins = [...new Set(Array.isArray(phase.allowedOrigins) ? phase.allowedOrigins.map(String) : [])]
      const creditOrigins = [...new Set(Array.isArray(phase.creditOrigins) ? phase.creditOrigins.map(String) : [])]
      const advanceOrigins = [...new Set(Array.isArray(phase.advanceOrigins) ? phase.advanceOrigins.map(String) : [])]
      for (const origin of [...allowedOrigins, ...creditOrigins, ...advanceOrigins]) normalizeOrigin(origin)
      if (['managed-chrome', 'youtube-playback', 'in-app-browser'].includes(verification) && !allowedOrigins.length) {
        throw new Error('Verified browser phases need at least one approved origin')
      }
      if (creditOrigins.some((origin) => !allowedOrigins.includes(origin)) ||
          advanceOrigins.some((origin) => !allowedOrigins.includes(origin))) {
        throw new Error('Credit and transition origins must be approved for the phase')
      }
      return {
        id: String(phase.id || `phase-${index + 1}`).slice(0, 80),
        label: String(phase.label || `Phase ${index + 1}`).slice(0, 120),
        targetSeconds: phaseSeconds,
        launchUrl: phase.launchUrl ? String(phase.launchUrl) : '',
        allowedOrigins,
        creditOrigins,
        advanceOrigins,
        verification,
        navigateOnStart: phase.navigateOnStart === true,
      }
    })
    if (phases.reduce((total, phase) => total + phase.targetSeconds, 0) !== targetSeconds) {
      throw new Error('Session phase durations must equal the total duration')
    }
    if (phases.some((phase, index) => phase.targetSeconds === 0 && index === phases.length - 1)) {
      throw new Error('A verification-only phase cannot finish a session')
    }
    return { phases }
  }

  function planFromRow(row) {
    const parsed = safeJson(row.plan_json, {})
    if (Array.isArray(parsed.phases) && parsed.phases.length) return { plan: parsed, legacy: false }
    return {
      legacy: true,
      plan: normalizeSessionPlan(null, Math.ceil(Number(row.target_ms) / 1000), row.label),
    }
  }

  function sessionFromRow(row) {
    if (!row) return null
    const { plan, legacy } = planFromRow(row)
    const phaseIndex = Math.min(plan.phases.length - 1, Math.max(0, Number(row.phase_index) || 0))
    const phase = plan.phases[phaseIndex]
    const phaseTargetMs = Number(phase.targetSeconds) * 1000
    const phaseCreditedMs = legacy ? Number(row.credited_ms) : Number(row.phase_credited_ms)
    const remainingMs = Math.max(0, Number(row.target_ms) - Number(row.credited_ms))
    return {
      id: row.id,
      kind: row.kind,
      activityId: row.activity_id,
      sessionKey: row.session_key ?? undefined,
      weekId: row.week_id ?? undefined,
      label: row.label,
      totalSeconds: Math.ceil(Number(row.target_ms) / 1000),
      creditedSeconds: Math.floor(Number(row.credited_ms) / 1000),
      remainingSeconds: Math.ceil(remainingMs / 1000),
      running: row.status === 'active',
      status: row.status,
      startedAt: row.created_at,
      lastHeartbeatAt: row.last_heartbeat_at ?? null,
      serverControlled: true,
      phaseId: phase.id,
      phaseLabel: phase.label,
      phaseIndex,
      phaseCount: plan.phases.length,
      phaseTotalSeconds: Number(phase.targetSeconds),
      phaseRemainingSeconds: Math.ceil(Math.max(0, phaseTargetMs - phaseCreditedMs) / 1000),
      launchUrl: phase.launchUrl || undefined,
      allowedOrigins: phase.allowedOrigins,
      managedChromeRequired: ['managed-chrome', 'youtube-playback'].includes(phase.verification),
      inAppBrowserRequired: phase.verification === 'in-app-browser',
      selfTimed: phase.verification === 'self-timed',
      waitingForVerification: Number(phase.targetSeconds) === 0,
      navigateOnPhaseStart: phase.navigateOnStart === true,
      rewardSelectionDeadlineAt: row.selection_deadline_at ?? undefined,
      rewardPlaybackStarted: Boolean(row.reward_started_at),
      rewardPlaybackActive: Boolean(row.reward_playback_active),
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
      weekId: row.week_id,
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

  function reconcileFreeMode(weekId, now = asIso(wallNow())) {
    const optionalCompleted = Number(db.prepare(`
      SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?
    `).get(weekId).count)

    for (const day of DAYS) {
      const completed = new Set(db.prepare(`
        SELECT activity_id FROM weekly_daily_completion WHERE week_id = ? AND day = ?
      `).all(weekId, day).map((row) => row.activity_id))
      const requiredIds = requiredActivityIds(day)
      const eligible = requiredIds.every((activityId) => completed.has(activityId)) &&
        optionalCompleted >= OPTIONAL_TARGETS[day]
      const existing = db.prepare(`
        SELECT unlocked_at FROM free_mode_unlock WHERE week_id = ? AND day = ?
      `).get(weekId, day)

      if (eligible && !existing) {
        db.prepare(`
          INSERT INTO free_mode_unlock (week_id, day, unlocked_at) VALUES (?, ?, ?)
        `).run(weekId, day, now)
        insertAudit.run(
          'free_mode_unlocked',
          JSON.stringify({ weekId, day, requiredCompleted: requiredIds.length, optionalCompleted }),
          now,
        )
      } else if (!eligible && existing) {
        db.prepare('DELETE FROM free_mode_unlock WHERE week_id = ? AND day = ?').run(weekId, day)
        insertAudit.run(
          'free_mode_relocked',
          JSON.stringify({ weekId, day, requiredCompleted: completed.size, optionalCompleted }),
          now,
        )
      }
    }
  }

  function loadState() {
    const weekContext = ensureCurrentWeek()
    reconcileFreeMode(weekContext.weekId)
    const state = emptyState(weekContext)
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((row) => [row.key, row.value]),
    )

    state.entered = settings.entered === '1'
    state.guardianConnected = getGuardianStatus().connected
    state.chromeConnected = getChromeExtensionStatus().connected
    state.activityConfiguration = getActivityConfiguration()
    state.googleProof = getGoogleProofState()
    state.googleLive = getLiveGoogleState()
    state.writingDictionary = normalizeWritingDictionary(safeJson(settings.writing_dictionary ?? '{}', {}))
    state.writingReviewQueue = normalizeWritingReviewQueue(safeJson(settings.writing_review_queue ?? '[]', []))

    for (const row of db.prepare(`
      SELECT day, activity_id FROM weekly_daily_completion
      WHERE week_id = ? ORDER BY completed_at
    `).all(weekContext.weekId)) {
      if (DAYS.includes(row.day)) state.requiredByDay[row.day].push(row.activity_id)
    }

    state.optionalCompleted = db
      .prepare(`
        SELECT session_key FROM weekly_optional_completion
        WHERE week_id = ? ORDER BY completed_at
      `)
      .all(weekContext.weekId)
      .map((row) => row.session_key)

    state.freeModeByDay = Object.fromEntries(db.prepare(`
      SELECT day, unlocked_at FROM free_mode_unlock WHERE week_id = ? ORDER BY unlocked_at
    `).all(weekContext.weekId).map((row) => [row.day, row.unlocked_at]))

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
      .prepare(`
      SELECT id, week_id, activity_key, reading_date, title, author, pages_read, body, corrected_body, findings_json, proofreading_matches_json, review_suggestions_json, sentence_reviews_json, exercise_progress_json,
               revision_group_id, version_number, spelling_words_json, spelling_progress_json,
               review_status, updated_at, proofreading_authoritative, proofreading_check_id
        FROM writing_submission ORDER BY updated_at DESC
      `)
      .all()
      .map((row) => ({
        id: row.id,
        weekId: row.week_id ?? weekContext.weekId,
        activityKey: row.activity_key ?? undefined,
        revisionGroupId: row.revision_group_id ?? row.id,
        versionNumber: Math.max(1, Number(row.version_number) || 1),
        readingDate: row.reading_date ?? '',
        title: row.title,
        author: row.author ?? '',
        pagesRead: row.pages_read ?? '',
        body: row.body,
        correctedBody: row.corrected_body ?? row.body,
        findings: safeJson(row.findings_json, []),
        proofreadingMatches: safeJson(row.proofreading_matches_json, []),
        proofreadingAuthoritative: Boolean(row.proofreading_authoritative),
        proofreadingCheckId: row.proofreading_check_id ?? undefined,
        reviewSuggestions: reviewSuggestionsForDraft(row.body, safeJson(row.review_suggestions_json, []), Boolean(row.proofreading_authoritative)),
        sentenceReviews: safeJson(row.sentence_reviews_json, []),
        exerciseProgress: safeJson(row.exercise_progress_json, {}),
        spellingWords: safeJson(row.spelling_words_json, []),
        spellingProgress: safeJson(row.spelling_progress_json, {}),
        reviewStatus: row.review_status ?? 'draft',
        updatedAt: row.updated_at,
      }))

    state.activeTimer = sessionFromRow(getPendingSessionRow())
    state.activeGameSession = gameSessionFromRow(getPendingGameSessionRow())
    state.completionRecords = listCompletions(50)
    return state
  }

  function getGuardianLifecycle() {
    const state = loadState()
    const serviceTime = asIso(wallNow())
    if (!state.entered) return { mode: 'inactive', session: null, serviceTime }

    const weekId = state.weekContext.weekId
    const day = state.weekContext.localDay
    const unlock = state.freeModeByDay[day]
    let row = db.prepare(`
      SELECT * FROM guardian_learning_session
      WHERE week_id = ? AND day = ? AND status != 'superseded'
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(weekId, day)
    let lifecycleChanged = false

    db.exec('BEGIN IMMEDIATE')
    try {
      if (row?.status === 'completion-eligible' && !unlock) {
        db.prepare(`
          UPDATE guardian_learning_session SET status = 'superseded'
          WHERE service_session_id = ?
        `).run(row.service_session_id)
        insertAudit.run(
          'guardian_learning_session_superseded',
          JSON.stringify({ serviceSessionId: row.service_session_id, weekId, day }),
          serviceTime,
        )
        lifecycleChanged = true
        row = null
      }

      if (!row) {
        const serviceSessionId = String(makeLearningSessionId())
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceSessionId)) {
          throw new Error('Generated guardian learning-session ID is not a UUID')
        }
        db.prepare(`
          INSERT INTO guardian_learning_session (
            service_session_id, week_id, day, status, created_at, completion_eligible_at
          ) VALUES (?, ?, ?, 'requested', ?, NULL)
        `).run(serviceSessionId, weekId, day, serviceTime)
        insertAudit.run(
          'guardian_learning_session_requested',
          JSON.stringify({ serviceSessionId, weekId, day }),
          serviceTime,
        )
        lifecycleChanged = true
        row = db.prepare(`
          SELECT * FROM guardian_learning_session WHERE service_session_id = ?
        `).get(serviceSessionId)
      }

      if (unlock && row.status !== 'completion-eligible') {
        db.prepare(`
          UPDATE guardian_learning_session
          SET status = 'completion-eligible', completion_eligible_at = ?
          WHERE service_session_id = ?
        `).run(unlock, row.service_session_id)
        insertAudit.run(
          'guardian_learning_session_completion_eligible',
          JSON.stringify({ serviceSessionId: row.service_session_id, weekId, day, eligibleAt: unlock }),
          serviceTime,
        )
        lifecycleChanged = true
        row = { ...row, status: 'completion-eligible', completion_eligible_at: unlock }
      }
      if (lifecycleChanged) setMeta.run('last_write_at', serviceTime)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    const requiredIds = requiredActivityIds(day)
    const requiredCompleted = Number(db.prepare(`
      SELECT count(*) AS count FROM weekly_daily_completion
      WHERE week_id = ? AND day = ? AND activity_id IN (${requiredIds.map(() => '?').join(', ')})
    `).get(weekId, day, ...requiredIds).count)
    const optionalCompleted = Number(db.prepare(`
      SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?
    `).get(weekId).count)
    const completionProof = unlock
      ? {
          serviceSessionId: row.service_session_id,
          weekId,
          day,
          eligibleAt: unlock,
          requiredCompleted,
          requiredTarget: requiredIds.length,
          optionalCompleted,
          optionalTarget: OPTIONAL_TARGETS[day],
        }
      : null

    return {
      mode: unlock ? 'free' : 'homework',
      session: {
        serviceSessionId: row.service_session_id,
        weekId,
        day,
        status: row.status,
        startedAt: row.created_at,
        completionProof,
      },
      serviceTime,
    }
  }

  function startLearningSession() {
    const now = asIso(wallNow())
    ensureCurrentWeek()
    db.exec('BEGIN IMMEDIATE')
    try {
      setSetting.run('entered', '1')
      setMeta.run('initialized', '1')
      setMeta.run('last_write_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getGuardianLifecycle()
  }

  function importBrowserTimer(timer, now, weekId) {
    if (!timer || getPendingSessionRow()) return
    const totalSeconds = Math.max(1, Number(timer.totalSeconds) || 1)
    const remainingSeconds = Math.max(0, Math.min(totalSeconds, Number(timer.remainingSeconds) || 0))
    insertSession.run(
      makeId(), makeId(), String(timer.kind), String(timer.activityId), timer.sessionKey ? String(timer.sessionKey) : null,
      weekId, String(timer.label), '{}', 0, (totalSeconds - remainingSeconds) * 1000,
      totalSeconds * 1000, (totalSeconds - remainingSeconds) * 1000,
      remainingSeconds === 0 ? 'completed' : 'paused', null, null, now, null, now,
    )
  }

  function saveState(state) {
    const previousDraftChecks = new Map(db.prepare('SELECT id, proofreading_check_id FROM writing_submission')
      .all().map((draft) => [draft.id, draft.proofreading_check_id]))
    assertState(state)
    const now = asIso(wallNow())
    const weekContext = ensureCurrentWeek()
    const weekId = weekContext.weekId
    const importingBrowserState = !isInitialized()
    const storedDictionary = normalizeWritingDictionary(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
      {},
    ))
    const dictionary = importingBrowserState
      ? normalizeWritingDictionary(state.writingDictionary)
      : storedDictionary
    const storedReviewQueue = normalizeWritingReviewQueue(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_review_queue'`).get()?.value ?? '[]',
      [],
    ))
    const previousReviewQueue = importingBrowserState
      ? normalizeWritingReviewQueue(state.writingReviewQueue)
      : storedReviewQueue
    if (state.weekContext?.weekId && state.weekContext.weekId !== weekId) {
      throw serviceError('This browser state belongs to an archived week. Refresh before saving.', 409, 'stale_week')
    }

    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM writing_submission;')

      if (importingBrowserState) {
        for (const day of DAYS) {
          const activities = Array.isArray(state.requiredByDay[day]) ? state.requiredByDay[day] : []
          for (const activityId of [...new Set(activities)]) {
            if (!BROWSER_COMPLETION_ACTIVITIES.has(String(activityId)) || !requiredActivityIds(day).includes(String(activityId))) continue
            insertRequired.run(weekId, day, String(activityId), 'browser', now)
            const hasRecord = db.prepare(`
              SELECT 1 FROM completion_record
              WHERE activity_id = ? AND session_key = ? AND details_json LIKE ? LIMIT 1
            `).get(String(activityId), day, `%"weekId":"${weekId}"%`)
            if (!hasRecord) {
              insertCompletion.run(
                `imported:${weekId}:${day}:${activityId}`, String(activityId), day, 'imported', 'browser-state',
                null, now, JSON.stringify({ weekId }),
              )
            }
          }
        }

        for (const sessionKey of [...new Set(state.optionalCompleted)].filter(
          (key) => OPTIONAL_SESSION_KEYS.has(String(key)),
        )) {
          insertOptional.run(weekId, String(sessionKey), now)
          const activityId = String(sessionKey).split(':')[0]
          const hasRecord = db.prepare(`
            SELECT 1 FROM completion_record WHERE session_key = ? AND details_json LIKE ? LIMIT 1
          `).get(String(sessionKey), `%"weekId":"${weekId}"%`)
          if (!hasRecord) {
            insertCompletion.run(
              `imported:${weekId}:${sessionKey}`, activityId, String(sessionKey), 'imported', 'browser-state',
              null, now, JSON.stringify({ weekId }),
            )
          }
        }

        for (const credit of state.rewardCredits) {
          insertReward.run(
            String(credit.id), String(credit.source ?? 'Reward'),
            Math.max(0, Number(credit.remainingSeconds) || 0), String(credit.earnedAt ?? now),
          )
        }
      }

      const existingReviews = new Map(previousReviewQueue.map((item) => [item.id, item]))
      for (const draft of state.drafts) {
        const body = String(draft.body ?? '')
        // Only a service-issued result for this exact text may disable offline
        // checks. Never trust a browser flag or let a save drop verified errors.
        const check = db.prepare('SELECT result_json FROM writing_check_result WHERE id = ? AND body = ?')
          .get(String(draft.proofreadingCheckId ?? ''), body)
        const checked = check ? safeJson(check.result_json, null) : null
        const authoritative = checked?.authoritative === true
        if (authoritative && previousDraftChecks.get(String(draft.id)) !== draft.proofreadingCheckId) {
          for (const [id, review] of existingReviews) {
            if (review.draftId === String(draft.id)) existingReviews.delete(id)
          }
        }
        const proofreadingMatches = normalizeProofreadingMatches(authoritative
          ? [...(draft.proofreadingMatches ?? []).filter((match) => match.source === 'parent' || String(match.ruleId).startsWith('AI_CONFIRMED_MEANING_')), ...checked.matches]
          : draft.proofreadingMatches, body)
        const reviewSuggestions = reviewSuggestionsForDraft(body, authoritative ? checked.reviewItems : draft.reviewSuggestions, authoritative)
        const sentenceReviews = Array.isArray(draft.sentenceReviews) ? draft.sentenceReviews : []
        const findings = inspectWritingFindings(body, dictionary, proofreadingMatches, { authoritative })
        const exerciseProgress = draft.exerciseProgress && typeof draft.exerciseProgress === 'object'
          ? draft.exerciseProgress
          : {}
        const spellingWords = []
        const spellingProgress = {}
        const grammarComplete = findings.every((finding) => {
          const progress = exerciseProgress[finding.id]
          return progress?.correctionComplete === true &&
            Number(progress.practiceCompleted) >= finding.practice.length
        })
        const pendingReviewCount = reviewSuggestions.filter((item) => {
          const existing = existingReviews.get(`${String(draft.id)}:${item.id}`)
          return !existing || existing.status !== 'resolved'
        }).length
        const meaningReviewPending = sentenceReviews.some((review) => !review?.selectedOptionId)
        const reviewStatus = body.trim()
          ? meaningReviewPending
            ? 'intent-review'
            : grammarComplete ? pendingReviewCount > 0 ? 'awaiting-review' : 'complete' : 'practice'
          : 'draft'
        const correctedBody = applyCompletedCorrections(body, findings, exerciseProgress)
        insertDraft.run(
          String(draft.id), String(draft.weekId ?? weekId), draft.activityKey ? String(draft.activityKey) : null,
          String(draft.revisionGroupId ?? draft.id),
          Math.max(1, Math.floor(Number(draft.versionNumber) || 1)),
          normalizeReadingDate(draft.readingDate),
          String(draft.title ?? 'Untitled writing').trim().slice(0, 200),
          String(draft.author ?? '').trim().slice(0, 160),
          String(draft.pagesRead ?? '').trim().slice(0, 80),
          body,
          correctedBody,
          JSON.stringify(findings),
          JSON.stringify(proofreadingMatches),
          JSON.stringify(reviewSuggestions),
          JSON.stringify(sentenceReviews),
          JSON.stringify(exerciseProgress),
          JSON.stringify(spellingWords),
          JSON.stringify(spellingProgress),
          reviewStatus,
          String(draft.updatedAt ?? now),
          authoritative ? 1 : 0,
          authoritative ? String(draft.proofreadingCheckId) : null,
        )
      }

      const writingReviewQueue = db.prepare('SELECT id, body, review_suggestions_json, proofreading_authoritative, updated_at FROM writing_submission').all().flatMap((draft) => reviewSuggestionsForDraft(
        String(draft.body ?? ''),
        safeJson(draft.review_suggestions_json, []),
        Boolean(draft.proofreading_authoritative),
      )
        .map((item) => {
          const id = `${String(draft.id)}:${item.id}`
          return existingReviews.get(id) ?? {
            ...item,
            id,
            draftId: String(draft.id),
            status: 'pending',
            createdAt: String(draft.updated_at ?? now),
          }
        }))
      if (importingBrowserState) {
        const detectedIds = new Set(writingReviewQueue.map((item) => item.id))
        writingReviewQueue.push(...previousReviewQueue.filter((item) => !detectedIds.has(item.id)))
      }

      if (importingBrowserState) importBrowserTimer(state.activeTimer, now, weekId)
      if (importingBrowserState || state.entered === true) {
        setSetting.run('entered', state.entered ? '1' : '0')
      }
      if (importingBrowserState) {
        setSetting.run('writing_dictionary', JSON.stringify(dictionary))
      }
      setSetting.run('writing_review_queue', JSON.stringify(normalizeWritingReviewQueue(writingReviewQueue)))
      setMeta.run('initialized', '1')
      setMeta.run('last_write_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return loadState()
  }

  function addParentRewardCredit(input = {}) {
    const seconds = Math.min(60 * 60, Math.max(60, Math.floor(Number(input.seconds) || 300)))
    const source = String(input.source ?? 'Parent-added credit').trim().slice(0, 160) || 'Parent-added credit'
    const id = makeId()
    const earnedAt = asIso(wallNow())
    insertReward.run(id, source, seconds, earnedAt)
    addAudit('parent_reward_credit_added', { creditId: id, seconds, source })
    return loadState()
  }

  function setWritingDictionary(input) {
    const dictionary = normalizeWritingDictionary(input)
    const now = asIso(wallNow())
    setSetting.run('writing_dictionary', JSON.stringify(dictionary))
    setMeta.run('last_write_at', now)
    addAudit('writing_dictionary_updated', {
      knownNames: dictionary.knownNames.length,
      knownPlaces: dictionary.knownPlaces.length,
    })
    return loadState()
  }

  function getAiProofreadingMode() {
    const value = String(
      db.prepare(`SELECT value FROM settings WHERE key = 'ai_proofreading_mode'`).get()?.value ?? 'off',
    ).toLowerCase()
    return AI_PROOFREADING_MODES.has(value) ? value : 'off'
  }

  function setAiProofreadingMode(input) {
    const mode = String(input ?? '').trim().toLowerCase()
    if (!AI_PROOFREADING_MODES.has(mode)) throw serviceError('Invalid AI proofreading mode')
    const now = asIso(wallNow())
    setSetting.run('ai_proofreading_mode', mode)
    setMeta.run('last_write_at', now)
    addAudit('ai_proofreading_mode_changed', { mode })
    return mode
  }

  function setWritingReviewStatus(id, status, decision, replacementInput) {
    if (!['pending', 'resolved'].includes(status)) throw serviceError('Invalid writing review status')
    if (status === 'resolved' && !['confirmed', 'dismissed'].includes(decision)) {
      throw serviceError('Choose whether the finding was confirmed or dismissed')
    }
    const current = normalizeWritingReviewQueue(safeJson(
      db.prepare(`SELECT value FROM settings WHERE key = 'writing_review_queue'`).get()?.value ?? '[]',
      [],
    ))
    const index = current.findIndex((item) => item.id === String(id))
    if (index < 0) throw serviceError('Writing review item was not found', 404, 'review_not_found')
    const resolvedAt = status === 'resolved' ? asIso(wallNow()) : undefined
    const selectedReplacement = decision === 'confirmed'
      ? String(replacementInput ?? current[index].replacement ?? '').slice(0, 400)
      : undefined
    if (decision === 'confirmed' && !selectedReplacement && !(current[index].end > current[index].start)) {
      throw serviceError('An insertion needs replacement text; only existing text can be deleted')
    }
    current[index] = {
      ...current[index],
      status,
      ...(resolvedAt ? { resolvedAt, decision } : {}),
      ...(selectedReplacement !== undefined ? { replacement: selectedReplacement } : {}),
    }
    if (!resolvedAt) {
      delete current[index].resolvedAt
      delete current[index].decision
    }
    const reviewItem = current[index]
    const draft = db.prepare(`
      SELECT body, proofreading_matches_json, exercise_progress_json, spelling_words_json, spelling_progress_json, proofreading_authoritative
      FROM writing_submission WHERE id = ?
    `).get(reviewItem.draftId)
    if (draft) {
      const body = String(draft.body ?? '')
      let proofreadingMatches = normalizeProofreadingMatches(
        safeJson(draft.proofreading_matches_json, []),
        body,
      ).filter((match) => match.reviewId !== reviewItem.id)
      if (decision === 'confirmed') {
        const start = Number(reviewItem.start)
        const end = Number(reviewItem.end)
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > body.length) {
          throw serviceError('This review item no longer points to valid writing. Recheck the draft.')
        }
        proofreadingMatches.push({
          offset: start,
          length: end - start,
          message: reviewItem.message,
          shortMessage: reviewItem.message,
          replacements: [selectedReplacement],
          ruleId: `PARENT_${String(reviewItem.ruleId ?? 'REVIEW').replace(/[^A-Za-z0-9_]+/g, '_')}`.slice(0, 120),
          category: reviewItem.category,
          issueType: `parent-${reviewItem.category.toLowerCase()}`,
          source: 'parent',
          verification: 'verified',
          confidence: 'high',
          explanation: reviewItem.explanation ?? reviewItem.message,
          reviewId: reviewItem.id,
        })
      }
      proofreadingMatches = normalizeProofreadingMatches(proofreadingMatches, body)
      const dictionary = normalizeWritingDictionary(safeJson(
        db.prepare(`SELECT value FROM settings WHERE key = 'writing_dictionary'`).get()?.value ?? '{}',
        {},
      ))
      const findings = inspectWritingFindings(body, dictionary, proofreadingMatches, { authoritative: Boolean(draft.proofreading_authoritative) })
      const exerciseProgress = safeJson(draft.exercise_progress_json, {})
      const spellingWords = safeJson(draft.spelling_words_json, [])
      const spellingProgress = safeJson(draft.spelling_progress_json, {})
      const pendingReviewCount = current.filter((item) => (
        item.draftId === reviewItem.draftId && item.status === 'pending'
      )).length
      const reviewStatus = body.trim()
        ? writingReviewStatus(
          findings,
          exerciseProgress,
          spellingWords,
          spellingProgress,
          pendingReviewCount,
        )
        : 'draft'
      const correctedBody = applyCompletedCorrections(body, findings, exerciseProgress)
      db.prepare(`
        UPDATE writing_submission
        SET proofreading_matches_json = ?, findings_json = ?, corrected_body = ?, review_status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(proofreadingMatches),
        JSON.stringify(findings),
        correctedBody,
        reviewStatus,
        resolvedAt ?? asIso(wallNow()),
        reviewItem.draftId,
      )
    }
    setSetting.run('writing_review_queue', JSON.stringify(current))
    addAudit('writing_review_status_changed', {
      reviewId: String(id),
      status,
      ...(decision ? { decision } : {}),
      source: current[index].source,
      confidence: current[index].confidence ?? null,
    })
    return loadState()
  }

  function resetParentPreviewData() {
    const weekId = ensureCurrentWeek().weekId
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM weekly_daily_completion WHERE week_id = ?').run(weekId)
      db.prepare('DELETE FROM weekly_optional_completion WHERE week_id = ?').run(weekId)
      db.prepare('DELETE FROM free_mode_unlock WHERE week_id = ?').run(weekId)
      db.prepare('DELETE FROM activity_session WHERE week_id = ?').run(weekId)
      db.prepare('DELETE FROM game_session WHERE week_id = ?').run(weekId)
      db.exec('DELETE FROM reward_credit; DELETE FROM writing_submission; DELETE FROM completion_record;')
      setSetting.run('writing_review_queue', '[]')
      setSetting.run('entered', '1')
      insertAudit.run('parent_preview_reset', JSON.stringify({ weekId }), now)
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
    const ttlSeconds = Math.floor(Number(input.ttlSeconds ?? 24 * 60 * 60))

    if (activityId !== GAME_ACTIVITY_ID) throw serviceError('Unsupported verified writing activity')
    if (!DAYS.includes(day)) throw serviceError('Invalid weekday')
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 24 * 60 * 60) {
      throw serviceError('Writing session lifetime must be between 1 second and 24 hours')
    }
    const weekId = ensureCurrentWeek().weekId
    if (db.prepare(
      'SELECT 1 FROM weekly_daily_completion WHERE week_id = ? AND day = ? AND activity_id = ?',
    ).get(weekId, day, activityId)) {
      throw serviceError('Reading response writing is already complete for that day', 409, 'already_completed')
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
        WHERE activity_id = ? AND day = ? AND week_id = ? AND status = 'pending'
      `).run(activityId, day, weekId)
      insertGameSession.run(
        id, activityId, day, weekId, hashNonce(nonce).toString('hex'), expectedOrigin, createdAt, expiresAt,
      )
      insertAudit.run(
        'game_session_started',
        JSON.stringify({ sessionId: id, activityId, day, weekId, expectedOrigin, expiresAt }),
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
        INSERT INTO weekly_daily_completion (week_id, day, activity_id, source, completed_at)
        VALUES (?, ?, ?, 'game-verified', ?)
        ON CONFLICT(week_id, day, activity_id) DO UPDATE SET
          source = excluded.source,
          completed_at = excluded.completed_at
      `).run(row.week_id, row.day, row.activity_id, now)
      insertCompletion.run(
        `game:${row.id}`, row.activity_id, row.day, 'game-verified', 'reading-game-contract', row.id,
        now, JSON.stringify({ expectedOrigin: row.expected_origin, weekId: row.week_id }),
      )
      completedSession = gameSessionFromRow({ ...row, status: 'completed', completed_at: now })
      insertAudit.run(
        'game_session_completed',
        JSON.stringify({ sessionId: row.id, activityId: row.activity_id, day: row.day, weekId: row.week_id }),
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return completedSession
  }

  function completeWritingGameSession(input) {
    const id = String(input.id ?? '')
    const draftId = String(input.draftId ?? '')
    let completedSession
    let evidence

    expireGameSessions()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT * FROM game_session WHERE id = ?').get(id)
      if (!row) throw serviceError('Writing session not found', 404, 'session_not_found')

      const now = asIso(wallNow())
      if (row.status === 'expired') throw serviceError('Writing session has expired', 410, 'session_expired')
      if (row.status === 'completed') throw serviceError('Writing session has already been used', 409, 'session_replayed')
      if (row.status !== 'pending') throw serviceError('Writing session is no longer active', 409, 'session_inactive')

      const draft = db.prepare(`
        SELECT id, week_id, revision_group_id, version_number, body, corrected_body, findings_json, sentence_reviews_json, exercise_progress_json,
               spelling_words_json, spelling_progress_json, updated_at
        FROM writing_submission WHERE id = ?
      `).get(draftId)
      if (!draft || !String(draft.body).trim()) {
        throw serviceError('Save a writing response before completing this activity', 409, 'writing_required')
      }
      if (new Date(draft.updated_at).getTime() < new Date(row.created_at).getTime()) {
        throw serviceError('This writing response must be reviewed during the current activity', 409, 'stale_writing')
      }

      const findings = safeJson(draft.findings_json, [])
      const sentenceReviews = safeJson(draft.sentence_reviews_json, [])
      if (sentenceReviews.some((review) => !review?.selectedOptionId)) {
        throw serviceError(
          'Confirm what each highlighted sentence means before starting the correction quiz',
          409,
          'writing_intent_review_incomplete',
        )
      }
      const progress = safeJson(draft.exercise_progress_json, {})
      const spellingWords = safeJson(draft.spelling_words_json, [])
      const spellingProgress = safeJson(draft.spelling_progress_json, {})
      const pendingReviewCount = normalizeWritingReviewQueue(safeJson(
        db.prepare(`SELECT value FROM settings WHERE key = 'writing_review_queue'`).get()?.value ?? '[]',
        [],
      )).filter((item) => item.draftId === draftId && item.status === 'pending').length
      const reviewStatus = writingReviewStatus(
        findings,
        progress,
        spellingWords,
        spellingProgress,
        pendingReviewCount,
      )
      if (reviewStatus !== 'complete') {
        throw serviceError(
          reviewStatus === 'awaiting-review'
            ? 'A parent must confirm or dismiss every contextual writing suggestion first'
            : 'Answer every correction and practice question, then finish the editing step',
          409,
          'writing_practice_incomplete',
        )
      }

      if (findings.length > 0) {
        throw serviceError(
          'The correction game is complete. Revise the writing, save a new version, and check it again.',
          409,
          'writing_revision_required',
        )
      }

      const revisionGroupId = String(draft.revision_group_id ?? draft.id)
      const versions = db.prepare(`
        SELECT id, body, findings_json, exercise_progress_json, review_status
        FROM writing_submission
        WHERE week_id = ? AND COALESCE(revision_group_id, id) = ?
        ORDER BY version_number, updated_at
      `).all(draft.week_id, revisionGroupId)
      if (versions.some((version) => version.review_status !== 'complete')) {
        throw serviceError(
          'Finish the correction game for each saved version before completing the activity',
          409,
          'writing_version_incomplete',
        )
      }
      const versionFindings = versions.map((version) => safeJson(version.findings_json, []))
      const responses = versions.flatMap((version, versionIndex) => {
        const findingsForVersion = versionFindings[versionIndex]
        const progressForVersion = safeJson(version.exercise_progress_json, {})
        return findingsForVersion.flatMap((finding) => {
          const item = progressForVersion[finding.id]
          const results = Array.isArray(item?.attemptResults) ? item.attemptResults : []
          if (results.length < finding.practice.length + 1) {
            throw serviceError('Writing response evidence is incomplete', 409, 'writing_evidence_incomplete')
          }
          return results.slice(0, finding.practice.length + 1).map(Boolean)
        })
      })
      const correct = responses.filter(Boolean).length
      const total = responses.length
      const percent = total ? Math.round((correct / total) * 100) : 100
      evidence = {
        draftId,
        revisionGroupId,
        versionCount: versions.length,
        findingCount: versionFindings.reduce((totalFindings, items) => totalFindings + items.length, 0),
        correct,
        total,
        percent,
        wordCount: String(draft.body).trim().split(/\s+/).length,
        edited: versions.length > 1 && String(versions.at(-1)?.body) !== String(versions[0]?.body),
      }

      const update = db.prepare(`
        UPDATE game_session
        SET status = 'completed', completed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, id)
      if (Number(update.changes) !== 1) {
        throw serviceError('Writing session has already been used', 409, 'session_replayed')
      }

      db.prepare(`
        INSERT INTO weekly_daily_completion (week_id, day, activity_id, source, completed_at)
        VALUES (?, ?, ?, 'writing-remediation', ?)
        ON CONFLICT(week_id, day, activity_id) DO UPDATE SET
          source = excluded.source,
          completed_at = excluded.completed_at
      `).run(row.week_id, row.day, row.activity_id, now)
      insertCompletion.run(
        `writing-game:${row.id}`, row.activity_id, row.day, 'game-verified', 'writing-remediation', row.id,
        now, JSON.stringify({ ...evidence, weekId: row.week_id }),
      )
      completedSession = gameSessionFromRow({ ...row, status: 'completed', completed_at: now })
      insertAudit.run(
        'writing_game_session_completed',
        JSON.stringify({ sessionId: row.id, activityId: row.activity_id, day: row.day, weekId: row.week_id, ...evidence }),
        now,
      )
      db.exec('COMMIT')
      reconcileFreeMode(row.week_id)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return { session: completedSession, evidence }
  }

  function startSession(input) {
    if (input.activityId === 'independent-reading' && (
      input.kind !== 'required' || !DAYS.includes(input.sessionKey) || !requiredActivityIds(input.sessionKey).includes(input.activityId)
    )) throw serviceError('Reading is scheduled Monday through Thursday', 400, 'activity_not_scheduled')
    if (getPendingSessionRow()) throw new Error('Finish or end the current session first')
    const targetSeconds = Math.floor(Number(input.targetSeconds))
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new Error('A positive target duration is required')
    if (!['required', 'optional', 'reward'].includes(input.kind)) throw new Error('Unsupported session kind')

    const id = makeId()
    const now = asIso(wallNow())
    const weekId = ensureCurrentWeek().weekId
    const plan = normalizeSessionPlan(input.plan, targetSeconds, String(input.label))
    const managedChrome = ['managed-chrome', 'youtube-playback'].includes(plan.phases[0].verification)
    const inAppBrowser = plan.phases[0].verification === 'in-app-browser'
    const externallyVerified = managedChrome || inAppBrowser
    const selectionSeconds = input.kind === 'reward'
      ? Math.floor(Number(input.selectionSeconds ?? 120))
      : null
    if (selectionSeconds !== null &&
        (!Number.isFinite(selectionSeconds) || selectionSeconds < 1 || selectionSeconds > 10 * 60)) {
      throw new Error('Reward selection time must be between 1 and 600 seconds')
    }
    insertSession.run(
      id, makeId(), input.kind, String(input.activityId), input.sessionKey ? String(input.sessionKey) : null,
      weekId, String(input.label), JSON.stringify(plan), 0, 0, targetSeconds * 1000, 0,
      externallyVerified ? 'paused' : 'active', externallyVerified ? null : runtimeId,
      externallyVerified ? null : monotonicNow(), now, now, now,
    )
    if (selectionSeconds !== null) {
      const selectionDeadlineAt = asIso(new Date(new Date(now).getTime() + selectionSeconds * 1000))
      db.prepare(`
        UPDATE activity_session SET selection_deadline_at = ?, updated_at = ? WHERE id = ?
      `).run(selectionDeadlineAt, now, id)
    }
    addAudit('session_started', {
      sessionId: id,
      kind: input.kind,
      activityId: input.activityId,
      sessionKey: input.sessionKey,
      weekId,
      phases: plan.phases.map((phase) => phase.id),
      verification: plan.phases[0].verification,
    })
    const row = getSessionRow(id)
    return {
      ...sessionFromRow(row),
      ...(inAppBrowser ? { inAppAuthenticationToken: row.nonce } : {}),
    }
  }

  function applySessionCompletion(row, completedAt) {
    const method = row.kind === 'reward' ? 'reward-playback' : 'time-in-session'
    const result = insertCompletion.run(
      `session:${row.id}`, row.activity_id, row.session_key ?? null, method, 'server-heartbeat', row.id,
      completedAt, JSON.stringify({
        creditedSeconds: Math.ceil(Number(row.target_ms) / 1000),
        weekId: row.week_id,
      }),
    )
    if (Number(result.changes) === 0) return false

    if (row.kind === 'required') {
      db.prepare(`
        INSERT INTO weekly_daily_completion (week_id, day, activity_id, source, completed_at)
        VALUES (?, ?, ?, 'time-in-session', ?)
        ON CONFLICT(week_id, day, activity_id) DO UPDATE SET
          source = excluded.source,
          completed_at = excluded.completed_at
      `).run(row.week_id, row.session_key, row.activity_id, completedAt)
    } else if (row.kind === 'optional') {
      const optionalResult = db.prepare(`
        INSERT OR IGNORE INTO weekly_optional_completion (week_id, session_key, completed_at)
        VALUES (?, ?, ?)
      `).run(row.week_id, row.session_key, completedAt)
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

  function heartbeatSession(id, active, context = {}) {
    let row = getSessionRow(id)
    if (!row) throw new Error('Session not found')
    if (row.status === 'cancelled' || row.acknowledged) return null
    if (row.status === 'completed') return sessionFromRow(row)

    const now = asIso(wallNow())
    if (row.kind === 'reward' && !row.reward_started_at && row.selection_deadline_at && now >= row.selection_deadline_at) {
      db.prepare(`
        UPDATE activity_session
        SET status = 'cancelled', acknowledged = 1, runtime_id = NULL, last_tick_ms = NULL,
            reward_playback_active = 0, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, row.id)
      addAudit('reward_selection_expired', { sessionId: row.id, creditId: row.activity_id })
      return null
    }
    const tick = monotonicNow()
    const { plan, legacy } = planFromRow(row)
    let phaseIndex = Math.min(plan.phases.length - 1, Math.max(0, Number(row.phase_index) || 0))
    let phase = plan.phases[phaseIndex]
    const managedChrome = ['managed-chrome', 'youtube-playback'].includes(phase.verification)
    const inAppBrowser = phase.verification === 'in-app-browser'
    if (managedChrome && context.source !== 'managed-chrome') return sessionFromRow(row)
    if (inAppBrowser) {
      const expectedToken = Buffer.from(String(row.nonce))
      const suppliedToken = Buffer.from(String(context.sessionToken ?? ''))
      if (context.source !== 'in-app-browser' ||
          expectedToken.length !== suppliedToken.length ||
          !timingSafeEqual(expectedToken, suppliedToken)) {
        throw serviceError('This in-app session is not authenticated', 401, 'in_app_session_authentication_required')
      }
    }

    const activeOrigin = context.activeOrigin ? String(context.activeOrigin) : ''
    let requestedActive = active === true
    if (managedChrome) requestedActive = requestedActive && phase.creditOrigins.includes(activeOrigin)
    if (phase.verification === 'youtube-playback') requestedActive = requestedActive && context.playbackActive === true
    const rewardStartedAt = row.kind === 'reward' && requestedActive && !row.reward_started_at
      ? now
      : row.reward_started_at
    let creditedMs = Number(row.credited_ms)
    let phaseCreditedMs = legacy ? creditedMs : Number(row.phase_credited_ms)
    let phaseAdvanced = false

    if (Number(phase.targetSeconds) === 0) {
      const canAdvance = active === true && phase.advanceOrigins.includes(activeOrigin)
      if (!canAdvance) {
        db.prepare(`
          UPDATE activity_session
          SET status = 'paused', runtime_id = NULL, last_tick_ms = NULL,
              last_heartbeat_at = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, row.id)
        return sessionFromRow(getSessionRow(row.id))
      }
      phaseIndex += 1
      phase = plan.phases[phaseIndex]
      phaseCreditedMs = 0
      db.prepare(`
        UPDATE activity_session
        SET phase_index = ?, phase_credited_ms = 0, status = 'active', runtime_id = ?,
            last_tick_ms = ?, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
      `).run(phaseIndex, runtimeId, tick, now, now, row.id)
      addAudit('session_phase_advanced', {
        sessionId: row.id,
        activityId: row.activity_id,
        phase: phase.id,
        verifiedOrigin: activeOrigin,
      })
      return sessionFromRow(getSessionRow(row.id))
    }

    if (requestedActive && row.status === 'active' && row.runtime_id === runtimeId && row.last_tick_ms != null) {
      const elapsed = tick - Number(row.last_tick_ms)
      if (elapsed >= 0 && elapsed <= (phase.verification === 'self-timed' ? 75_000 : MAX_HEARTBEAT_GAP_MS)) {
        const remainingInPhase = Math.max(0, Number(phase.targetSeconds) * 1000 - phaseCreditedMs)
        const awarded = Math.min(elapsed, remainingInPhase)
        creditedMs += awarded
        phaseCreditedMs += awarded
      }
    }

    creditedMs = Math.min(Number(row.target_ms), Math.max(0, Math.floor(creditedMs)))
    phaseCreditedMs = Math.max(0, Math.floor(phaseCreditedMs))
    const phaseComplete = phaseCreditedMs >= Number(phase.targetSeconds) * 1000
    const completed = phaseComplete && phaseIndex === plan.phases.length - 1
    if (phaseComplete && !completed) {
      phaseIndex += 1
      phase = plan.phases[phaseIndex]
      phaseCreditedMs = 0
      phaseAdvanced = true
      requestedActive = false
    }

    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE activity_session
        SET credited_ms = ?, phase_index = ?, phase_credited_ms = ?, status = ?, runtime_id = ?, last_tick_ms = ?,
            last_heartbeat_at = ?, updated_at = ?, completed_at = ?, reward_started_at = ?,
            reward_playback_active = ?
        WHERE id = ?
      `).run(
        creditedMs,
        phaseIndex,
        phaseCreditedMs,
        completed ? 'completed' : phaseAdvanced ? 'paused' : requestedActive ? 'active' : 'paused',
        completed || phaseAdvanced || !requestedActive ? null : runtimeId,
        completed || phaseAdvanced || !requestedActive ? null : tick,
        now,
        now,
        completed ? now : null,
        rewardStartedAt,
        requestedActive && !completed ? 1 : 0,
        row.id,
      )
      if (completed) applySessionCompletion({ ...row, credited_ms: creditedMs }, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    if (phaseAdvanced) addAudit('session_phase_advanced', {
      sessionId: row.id,
      activityId: row.activity_id,
      phase: phase.id,
    })
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
        SET status = 'cancelled', acknowledged = 1, runtime_id = NULL, last_tick_ms = NULL,
            reward_playback_active = 0, updated_at = ?
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

  function setDailyCompletion({ day, activityId, completed, method, weekId: requestedWeekId }) {
    if (!DAYS.includes(day)) throw new Error('Invalid weekday')
    if (!['self-reported', 'parent-override'].includes(method)) throw new Error('Invalid completion method')
    if (!requiredActivityIds(day).includes(activityId)) throw serviceError('That activity is not scheduled for this day', 400, 'activity_not_scheduled')
    if (method === 'self-reported' && !BROWSER_COMPLETION_ACTIVITIES.has(activityId)) throw serviceError('That activity cannot be self-reported', 400, 'invalid_completion_method')
    const weekId = ensureCurrentWeek().weekId
    if (requestedWeekId && String(requestedWeekId) !== weekId) {
      throw serviceError('That completion belongs to an archived week', 409, 'stale_week')
    }
    const now = asIso(wallNow())
    const wasComplete = Boolean(db.prepare(
      'SELECT 1 FROM weekly_daily_completion WHERE week_id = ? AND day = ? AND activity_id = ?',
    ).get(weekId, day, String(activityId)))
    if (completed) {
      db.prepare(`
        INSERT INTO weekly_daily_completion (week_id, day, activity_id, source, completed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(week_id, day, activity_id) DO UPDATE SET
          source = excluded.source,
          completed_at = excluded.completed_at
      `).run(weekId, day, String(activityId), method, now)
      if (!wasComplete) {
        insertCompletion.run(
          makeId(), String(activityId), day, method, method === 'parent-override' ? 'parent-dashboard' : 'child-ui',
          null, now, JSON.stringify({ weekId }),
        )
      }
    } else {
      db.prepare(`
        DELETE FROM weekly_daily_completion WHERE week_id = ? AND day = ? AND activity_id = ?
      `).run(weekId, day, String(activityId))
    }
    addAudit('daily_completion_changed', { weekId, day, activityId, completed: Boolean(completed), method })
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
    const pendingSession = getPendingSessionRow()
    if (pendingSession && pendingSession.status !== 'completed' && sessionFromRow(pendingSession).managedChromeRequired) {
      heartbeatSession(pendingSession.id, decision === 'allowed', {
        source: 'managed-chrome',
        activeOrigin,
        playbackActive: input.playbackActive === true,
      })
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
    const weekId = input.weekId ? String(input.weekId) : ensureCurrentWeek().weekId
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw serviceError('A valid week ID is required')
    const documentId = `mock-doc-${createHash('sha256')
      .update(`${connection.account_email}:${weekId}`)
      .digest('hex')
      .slice(0, 16)}`
    const idempotencyKey = `${weekId}:${documentId}`
    const existing = db.prepare('SELECT * FROM google_delivery WHERE idempotency_key = ?').get(idempotencyKey)
    const draftRows = db.prepare(`
      SELECT id, week_id, reading_date, title, author, pages_read, body, corrected_body, findings_json, exercise_progress_json,
             revision_group_id, version_number, spelling_words_json, spelling_progress_json,
             review_status, updated_at
      FROM writing_submission
      WHERE week_id = ? AND length(trim(body)) > 0
      ORDER BY updated_at
    `).all(weekId)
    const drafts = draftRows.map((row) => ({
      id: row.id,
      weekId: row.week_id ?? weekId,
      revisionGroupId: row.revision_group_id ?? row.id,
      versionNumber: Math.max(1, Number(row.version_number) || 1),
      readingDate: row.reading_date ?? '',
      title: row.title,
      author: row.author ?? '',
      pagesRead: row.pages_read ?? '',
      body: row.body,
      correctedBody: row.corrected_body ?? row.body,
      findings: safeJson(row.findings_json, []),
      exerciseProgress: safeJson(row.exercise_progress_json, {}),
      spellingWords: safeJson(row.spelling_words_json, []),
      spellingProgress: safeJson(row.spelling_progress_json, {}),
      reviewStatus: row.review_status ?? 'draft',
      updatedAt: row.updated_at,
    }))

    if (existing && existing.status !== 'failed') {
      return { delivery: googleDeliveryFromRow(existing), drafts: [], created: false }
    }

    const now = asIso(wallNow())
    const documentName = `Saoirse Writing - Week of ${weekId}`
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

  function liveGoogleDeliveryFromRow(row) {
    if (!row) return null
    return {
      id: row.id,
      weekId: row.week_id,
      mode: 'live',
      status: row.status,
      accountEmail: row.account_email,
      recipient: row.recipient,
      documentId: row.document_id ?? null,
      documentName: row.document_name,
      documentUrl: row.document_url ?? null,
      pdfUrl: row.pdf_path ? `/api/google/live/deliveries/${encodeURIComponent(row.id)}/pdf` : null,
      pdfPath: row.pdf_path ?? null,
      shareStatus: row.share_status,
      emailMessageId: row.email_message_id ?? null,
      draftCount: Number(row.draft_count),
      attemptCount: Number(row.attempt_count),
      nextAttemptAt: row.next_attempt_at ?? null,
      lastError: row.last_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deliveredAt: row.delivered_at ?? null,
    }
  }

  function listLiveGoogleDeliveries(limit = 12) {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 12))
    return db.prepare(`
      SELECT * FROM google_live_delivery ORDER BY created_at DESC LIMIT ?
    `).all(safeLimit).map(liveGoogleDeliveryFromRow)
  }

  function getLiveGoogleState() {
    const connection = db.prepare('SELECT * FROM google_live_connection WHERE singleton = 1').get()
    const recipient = db.prepare(`SELECT value FROM settings WHERE key = 'google_live_recipient'`).get()?.value ?? null
    return {
      ...googleLiveConfiguration,
      enabled: googleLiveConfiguration.mode === 'live',
      connected: Boolean(connection?.connected),
      accountEmail: connection?.connected ? connection.account_email : null,
      connectedAt: connection?.connected ? connection.connected_at : null,
      recipient,
      lastError: connection?.last_error ?? null,
      deliveries: listLiveGoogleDeliveries(),
    }
  }

  function configureLiveGoogle(input) {
    const recipient = normalizeEmail(input.recipient, 'school recipient')
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      setSetting.run('google_live_recipient', recipient)
      insertAudit.run('google_live_recipient_configured', JSON.stringify({ recipient }), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getLiveGoogleState()
  }

  function connectLiveGoogle(input) {
    const accountEmail = normalizeEmail(input.accountEmail, 'Google account')
    const scopes = Array.isArray(input.scopes) ? [...new Set(input.scopes.map(String))] : []
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO google_live_connection (
          singleton, account_email, scopes_json, connected, connected_at, updated_at, last_error
        ) VALUES (1, ?, ?, 1, ?, ?, NULL)
        ON CONFLICT(singleton) DO UPDATE SET
          account_email = excluded.account_email,
          scopes_json = excluded.scopes_json,
          connected = 1,
          connected_at = excluded.connected_at,
          updated_at = excluded.updated_at,
          last_error = NULL
      `).run(accountEmail, JSON.stringify(scopes), now, now)
      insertAudit.run('google_live_connected', JSON.stringify({ accountEmail, scopes }), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getLiveGoogleState()
  }

  function disconnectLiveGoogle(input = {}) {
    const reason = String(input.reason ?? 'Authorization disconnected').slice(0, 500)
    const lastError = input.lastError ? String(input.lastError).slice(0, 500) : null
    const now = asIso(wallNow())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE google_live_connection
        SET connected = 0, updated_at = ?, last_error = ?
        WHERE singleton = 1
      `).run(now, lastError)
      insertAudit.run('google_live_disconnected', JSON.stringify({ reason }), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return getLiveGoogleState()
  }

  function completedWritingSnapshots(weekId) {
    const drafts = db.prepare(`
      SELECT id, week_id, reading_date, title, author, pages_read, body, corrected_body, findings_json, exercise_progress_json,
             revision_group_id, version_number, spelling_words_json, spelling_progress_json,
             review_status, updated_at
      FROM writing_submission
      WHERE week_id = ? AND length(trim(body)) > 0
      ORDER BY updated_at
    `).all(weekId).map((row) => ({
      id: row.id,
      weekId: row.week_id ?? weekId,
      revisionGroupId: row.revision_group_id ?? row.id,
      versionNumber: Math.max(1, Number(row.version_number) || 1),
      readingDate: row.reading_date ?? '',
      title: row.title,
      author: row.author ?? '',
      pagesRead: row.pages_read ?? '',
      body: row.body,
      correctedBody: row.corrected_body ?? row.body,
      findings: safeJson(row.findings_json, []),
      exerciseProgress: safeJson(row.exercise_progress_json, {}),
      spellingWords: safeJson(row.spelling_words_json, []),
      spellingProgress: safeJson(row.spelling_progress_json, {}),
      reviewStatus: row.review_status,
      updatedAt: row.updated_at,
    }))
    const latestByGroup = new Map()
    for (const draft of drafts) {
      const current = latestByGroup.get(draft.revisionGroupId)
      if (!current || draft.versionNumber > current.versionNumber || (
        draft.versionNumber === current.versionNumber && Date.parse(draft.updatedAt) > Date.parse(current.updatedAt)
      )) {
        latestByGroup.set(draft.revisionGroupId, draft)
      }
    }
    const eligibleGroups = new Set([...latestByGroup.values()]
      .filter((draft) => draft.reviewStatus === 'complete' && draft.findings.length === 0)
      .map((draft) => draft.revisionGroupId))
    return drafts.filter((draft) => eligibleGroups.has(draft.revisionGroupId))
  }

  function prepareLiveGoogleDelivery(input = {}) {
    const connection = db.prepare(`
      SELECT * FROM google_live_connection WHERE singleton = 1 AND connected = 1
    `).get()
    if (!connection) throw serviceError('Authorize the live Google account first', 409, 'google_not_connected')

    const savedRecipient = db.prepare(`SELECT value FROM settings WHERE key = 'google_live_recipient'`).get()?.value
    const recipient = normalizeEmail(input.recipient ?? savedRecipient, 'school recipient')
    const weekId = input.weekId ? String(input.weekId) : ensureCurrentWeek().weekId
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw serviceError('A valid week ID is required')
    const existing = db.prepare('SELECT * FROM google_live_delivery WHERE week_id = ?').get(weekId)
    if (existing) return { delivery: liveGoogleDeliveryFromRow(existing), drafts: [], created: false }

    const drafts = completedWritingSnapshots(weekId)
    const id = makeId()
    const now = asIso(wallNow())
    const status = drafts.length ? 'queued' : 'skipped'
    const documentName = `Saoirse Writing — Week of ${weekId}`
    db.exec('BEGIN IMMEDIATE')
    try {
      setSetting.run('google_live_recipient', recipient)
      db.prepare(`
        INSERT INTO google_live_delivery (
          id, week_id, idempotency_key, status, account_email, recipient,
          document_name, draft_count, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, weekId, `week:${weekId}`, status, connection.account_email, recipient,
        documentName, drafts.length, status === 'queued' ? now : null, now, now,
      )
      const insertSnapshot = db.prepare(`
        INSERT INTO google_live_delivery_draft (delivery_id, draft_id, content_json) VALUES (?, ?, ?)
      `)
      for (const draft of drafts) insertSnapshot.run(id, draft.id, JSON.stringify(draft))
      insertAudit.run(
        status === 'skipped' ? 'google_live_delivery_skipped' : 'google_live_delivery_queued',
        JSON.stringify({ deliveryId: id, weekId, recipient, draftCount: drafts.length, scheduled: input.scheduled === true }),
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return {
      delivery: liveGoogleDeliveryFromRow(db.prepare('SELECT * FROM google_live_delivery WHERE id = ?').get(id)),
      drafts,
      created: true,
    }
  }

  function getLiveGoogleDeliveryWork(id) {
    const row = db.prepare('SELECT * FROM google_live_delivery WHERE id = ?').get(String(id))
    if (!row) throw serviceError('Google delivery not found', 404, 'delivery_not_found')
    const drafts = db.prepare(`
      SELECT content_json FROM google_live_delivery_draft WHERE delivery_id = ? ORDER BY rowid
    `).all(row.id).map((item) => safeJson(item.content_json, {}))
    return { delivery: liveGoogleDeliveryFromRow(row), drafts }
  }

  function beginLiveGoogleDeliveryAttempt(id) {
    const deliveryId = String(id)
    const now = asIso(wallNow())
    const row = db.prepare('SELECT * FROM google_live_delivery WHERE id = ?').get(deliveryId)
    if (!row) throw serviceError('Google delivery not found', 404, 'delivery_not_found')
    if (['sent', 'skipped'].includes(row.status)) return getLiveGoogleDeliveryWork(deliveryId)
    if (row.status !== 'creating') {
      db.prepare(`
        UPDATE google_live_delivery
        SET status = 'creating', attempt_count = attempt_count + 1, next_attempt_at = NULL,
            last_error = CASE WHEN share_status = 'failed' THEN last_error ELSE NULL END, updated_at = ?
        WHERE id = ?
      `).run(now, deliveryId)
      addAudit('google_live_delivery_attempted', { deliveryId, attempt: Number(row.attempt_count) + 1 })
    }
    return getLiveGoogleDeliveryWork(deliveryId)
  }

  function recordLiveGoogleDocument(id, input) {
    const deliveryId = String(id)
    const documentId = String(input.documentId ?? '').trim()
    const documentUrl = String(input.documentUrl ?? '').trim()
    if (!documentId || !documentUrl) throw serviceError('Google document metadata is incomplete')
    const now = asIso(wallNow())
    db.prepare(`
      UPDATE google_live_delivery
      SET document_id = ?, document_url = ?, idempotency_key = week_id || ':' || ?, updated_at = ?
      WHERE id = ? AND status = 'creating'
    `).run(documentId, documentUrl, documentId, now, deliveryId)
    addAudit('google_live_document_created', { deliveryId, documentId })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function recordLiveGooglePdf(id, path) {
    const deliveryId = String(id)
    const now = asIso(wallNow())
    db.prepare(`
      UPDATE google_live_delivery SET pdf_path = ?, updated_at = ? WHERE id = ? AND status = 'creating'
    `).run(String(path), now, deliveryId)
    addAudit('google_live_pdf_exported', { deliveryId })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function recordLiveGoogleShare(id, status, error) {
    if (!['shared', 'failed'].includes(status)) throw serviceError('Invalid Google share status')
    const deliveryId = String(id)
    const message = status === 'failed'
      ? `Document sharing failed: ${String(error instanceof Error ? error.message : error).slice(0, 420)}`
      : null
    const now = asIso(wallNow())
    db.prepare(`
      UPDATE google_live_delivery
      SET share_status = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'creating'
    `).run(status, message, now, deliveryId)
    addAudit(status === 'shared' ? 'google_live_document_shared' : 'google_live_document_share_failed', {
      deliveryId,
      ...(message ? { error: message } : {}),
    })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function completeLiveGoogleDelivery(id, input) {
    const deliveryId = String(id)
    const now = asIso(wallNow())
    const update = db.prepare(`
      UPDATE google_live_delivery
      SET status = 'sent', email_message_id = ?, next_attempt_at = NULL,
          updated_at = ?, delivered_at = ?
      WHERE id = ? AND status = 'creating'
    `).run(String(input.messageId ?? ''), now, now, deliveryId)
    if (Number(update.changes) !== 1) {
      throw serviceError('The Google delivery is no longer awaiting completion', 409, 'delivery_not_pending')
    }
    addAudit('google_live_delivery_sent', { deliveryId, messageId: String(input.messageId ?? '') })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function failLiveGoogleDelivery(id, error) {
    const deliveryId = String(id)
    const message = String(error instanceof Error ? error.message : error).slice(0, 500)
    const row = db.prepare('SELECT attempt_count FROM google_live_delivery WHERE id = ?').get(deliveryId)
    if (!row) throw serviceError('Google delivery not found', 404, 'delivery_not_found')
    const delayMinutes = Math.min(360, 5 * (2 ** Math.max(0, Number(row.attempt_count) - 1)))
    const nowDate = wallNow()
    const now = asIso(nowDate)
    const nextAttemptAt = asIso(new Date(nowDate.getTime() + delayMinutes * 60 * 1000))
    db.prepare(`
      UPDATE google_live_delivery
      SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('sent', 'skipped')
    `).run(message, nextAttemptAt, now, deliveryId)
    addAudit('google_live_delivery_failed', { deliveryId, error: message, nextAttemptAt })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function retryLiveGoogleDelivery(id) {
    const deliveryId = String(id)
    const now = asIso(wallNow())
    const update = db.prepare(`
      UPDATE google_live_delivery
      SET status = 'queued', next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'failed'
    `).run(now, now, deliveryId)
    if (Number(update.changes) !== 1) {
      throw serviceError('Only failed Google deliveries can be retried', 409, 'delivery_not_retryable')
    }
    addAudit('google_live_delivery_retry_requested', { deliveryId })
    return getLiveGoogleDeliveryWork(deliveryId).delivery
  }

  function listRetryableLiveGoogleDeliveries(limit = 5) {
    const now = asIso(wallNow())
    const safeLimit = Math.min(20, Math.max(1, Number(limit) || 5))
    return db.prepare(`
      SELECT * FROM google_live_delivery
      WHERE status IN ('queued', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at LIMIT ?
    `).all(now, safeLimit).map(liveGoogleDeliveryFromRow)
  }

  function getLiveGoogleDeliveryArtifact(id) {
    const row = db.prepare('SELECT * FROM google_live_delivery WHERE id = ?').get(String(id))
    if (!row?.pdf_path) throw serviceError('Delivery PDF not found', 404, 'artifact_not_found')
    return {
      path: row.pdf_path,
      filename: `${row.document_name}.pdf`,
      contentType: 'application/pdf',
    }
  }

  function isOptionalComplete(sessionKey) {
    const weekId = ensureCurrentWeek().weekId
    return Boolean(db.prepare(`
      SELECT 1 FROM weekly_optional_completion WHERE week_id = ? AND session_key = ?
    `).get(weekId, String(sessionKey)))
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
    recordWritingCheck(body, result) {
      if (!result.authoritative) return undefined
      const id = makeId()
      db.prepare('INSERT INTO writing_check_result (id, body, result_json) VALUES (?, ?, ?)')
        .run(id, String(body), JSON.stringify({ authoritative: true, matches: result.matches, reviewItems: result.reviewItems }))
      return id
    },
    loadState,
    saveState,
    startLearningSession,
    getGuardianLifecycle,
    startGameSession,
    getGameSession,
    completeGameSession,
    completeWritingGameSession,
    startSession,
    heartbeatSession,
    cancelSession,
    acknowledgeSession,
    setDailyCompletion,
    addParentRewardCredit,
    setWritingDictionary,
    getAiProofreadingMode,
    setAiProofreadingMode,
    setWritingReviewStatus,
    resetParentPreviewData,
    getRewardCredit,
    isOptionalComplete,
    recordGuardianHeartbeat,
    getGuardianStatus,
    recordChromeExtensionHeartbeat,
    getChromeExtensionStatus,
    getActivityConfiguration,
    setActivityConfiguration,
    connectMockGoogle,
    disconnectMockGoogle,
    getGoogleProofState,
    prepareMockGoogleDelivery,
    completeMockGoogleDelivery,
    failMockGoogleDelivery,
    getGoogleDeliveryArtifact,
    getLiveGoogleState,
    configureLiveGoogle,
    connectLiveGoogle,
    disconnectLiveGoogle,
    prepareLiveGoogleDelivery,
    getLiveGoogleDeliveryWork,
    beginLiveGoogleDeliveryAttempt,
    recordLiveGoogleDocument,
    recordLiveGooglePdf,
    recordLiveGoogleShare,
    completeLiveGoogleDelivery,
    failLiveGoogleDelivery,
    retryLiveGoogleDelivery,
    listRetryableLiveGoogleDeliveries,
    getLiveGoogleDeliveryArtifact,
    addAudit,
    listAudit,
    listCompletions,
    info,
    isInitialized,
    checkpoint: () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'),
    close: () => db.close(),
  }
}
