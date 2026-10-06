import { createHash, randomBytes } from 'node:crypto'

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALENDAR_ENDPOINT = 'https://www.googleapis.com/calendar/v3'

function calendarError(message, code = 'google_calendar_error', status = 502, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  error.status = status
  return error
}

async function responseBody(response) {
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json().catch(() => ({}))
  return response.text().catch(() => '')
}

function apiMessage(body, fallback) {
  return body?.error_description || body?.error?.message || body?.error || fallback
}

function createPkcePair(random = randomBytes) {
  const verifier = random(64).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function buildGoogleCalendarAuthorizationUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTHORIZATION_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  }).toString()
  return url.toString()
}

function addDays(dateId, days) {
  const date = new Date(`${dateId}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw calendarError('A valid week is required', 'invalid_week', 400)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function assertWeekId(value) {
  const weekId = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId) || new Date(`${weekId}T00:00:00.000Z`).toISOString().slice(0, 10) !== weekId) {
    throw calendarError('A valid week is required', 'invalid_week', 400)
  }
  return weekId
}

function offsetForDate(dateId, timeZone) {
  const probe = new Date(`${dateId}T12:00:00.000Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe).map((part) => [part.type, part.value]))
  const represented = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  )
  const offsetMinutes = Math.round((represented - probe.getTime()) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

function localMidnight(dateId, timeZone) {
  return `${dateId}T00:00:00${offsetForDate(dateId, timeZone)}`
}

function localDateId(value, timeZone) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function sanitizeEvent(item, timeZone) {
  if (!item?.id || item.status === 'cancelled') return null
  const allDay = Boolean(item.start?.date)
  const start = allDay ? String(item.start.date ?? '') : String(item.start?.dateTime ?? '')
  const end = allDay ? String(item.end?.date ?? '') : String(item.end?.dateTime ?? '')
  if (!start) return null
  const day = allDay ? start : localDateId(start, timeZone)
  if (!day) return null
  return {
    id: String(item.id).slice(0, 300),
    title: String(item.summary ?? 'Busy').trim().slice(0, 200) || 'Busy',
    day,
    start,
    end: end || null,
    allDay,
  }
}

export function createGoogleCalendarIntegration(options) {
  const {
    keychain,
    clientId,
    clientSecret = '',
    redirectUri,
    expectedEmail = '',
    calendarId = 'primary',
    timeZone = 'America/Los_Angeles',
    fetch: fetchImpl = globalThis.fetch,
    now = () => new Date(),
    authorizationTtlMs = 10 * 60_000,
  } = options
  const pendingAuthorizations = new Map()
  const weekCache = new Map()
  const normalizedExpectedEmail = String(expectedEmail).trim().toLowerCase()
  const normalizedCalendarId = String(calendarId || 'primary').trim() || 'primary'
  let accessTokenCache = null
  let lastSyncedAt = null
  let lastError = null

  const configured = Boolean(clientId && redirectUri && normalizedExpectedEmail && keychain?.available)

  async function connected() {
    if (!configured) return false
    try {
      return Boolean(await keychain.getRefreshToken())
    } catch {
      return false
    }
  }

  async function getStatus({ includeAccount = false } = {}) {
    const isConnected = await connected()
    return {
      configured,
      connected: isConnected,
      ...(includeAccount ? {
        expectedAccountEmail: normalizedExpectedEmail || null,
        accountEmail: isConnected ? normalizedExpectedEmail : null,
        calendarId: normalizedCalendarId,
        scopes: GOOGLE_CALENDAR_SCOPES,
      } : {}),
      lastSyncedAt,
      lastError,
    }
  }

  async function beginAuthorization() {
    if (!configured) {
      throw calendarError('Calendar OAuth is not configured yet. Add the Desktop OAuth client and expected account to the local environment.', 'calendar_not_configured', 503)
    }
    const state = randomBytes(32).toString('base64url')
    const pair = createPkcePair()
    const expiresAt = new Date(now().getTime() + authorizationTtlMs)
    pendingAuthorizations.set(state, { verifier: pair.verifier, expiresAt })
    return {
      authorizationUrl: buildGoogleCalendarAuthorizationUrl({
        clientId,
        redirectUri,
        state,
        challenge: pair.challenge,
      }),
      expiresAt: expiresAt.toISOString(),
    }
  }

  async function completeAuthorization({ state, code, error }) {
    if (error) throw calendarError(`Google authorization was declined: ${error}`, 'calendar_authorization_declined', 400)
    const pending = pendingAuthorizations.get(String(state))
    pendingAuthorizations.delete(String(state))
    if (!pending || pending.expiresAt.getTime() < now().getTime()) {
      throw calendarError('The Calendar authorization request expired. Start it again.', 'calendar_authorization_expired', 400)
    }
    if (!code) throw calendarError('Google did not return an authorization code.', 'calendar_authorization_code_missing', 400)

    const tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        code: String(code),
        code_verifier: pending.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    const tokenBody = await responseBody(tokenResponse)
    if (!tokenResponse.ok || !tokenBody?.access_token) {
      throw calendarError(apiMessage(tokenBody, 'Google did not issue a Calendar access token.'), 'calendar_token_exchange_failed')
    }

    const userResponse = await fetchImpl(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    })
    const userBody = await responseBody(userResponse)
    if (!userResponse.ok || !userBody?.email) {
      throw calendarError(apiMessage(userBody, 'The authorized Google account could not be verified.'), 'calendar_account_verification_failed')
    }
    const authorizedEmail = String(userBody.email).trim().toLowerCase()
    if (authorizedEmail !== normalizedExpectedEmail) {
      await fetchImpl(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokenBody.access_token)}`, { method: 'POST' }).catch(() => {})
      throw calendarError('That is not the Google account selected for Saoirse’s schedule.', 'calendar_account_mismatch', 403)
    }

    const existingRefreshToken = await keychain.getRefreshToken()
    const refreshToken = String(tokenBody.refresh_token ?? existingRefreshToken ?? '')
    if (!refreshToken) throw calendarError('Google did not return an offline refresh token. Remove this app from Google Account access and try again.', 'calendar_refresh_token_missing')
    await keychain.setRefreshToken(refreshToken)
    accessTokenCache = {
      token: tokenBody.access_token,
      expiresAt: now().getTime() + Math.max(60, Number(tokenBody.expires_in) || 3600) * 1000 - 30_000,
    }
    lastError = null
    return getStatus({ includeAccount: true })
  }

  async function accessToken() {
    if (accessTokenCache?.expiresAt > now().getTime()) return accessTokenCache.token
    const refreshToken = await keychain.getRefreshToken()
    if (!refreshToken) throw calendarError('Google Calendar is not connected.', 'calendar_not_connected', 401)
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const body = await responseBody(response)
    if (!response.ok || !body?.access_token) {
      throw calendarError(apiMessage(body, 'Google Calendar authorization needs to be renewed.'), 'calendar_refresh_failed', 401)
    }
    accessTokenCache = {
      token: body.access_token,
      expiresAt: now().getTime() + Math.max(60, Number(body.expires_in) || 3600) * 1000 - 30_000,
    }
    return accessTokenCache.token
  }

  async function listWeek(weekIdInput, { force = false } = {}) {
    const weekId = assertWeekId(weekIdInput)
    const cached = weekCache.get(weekId)
    if (!force && cached && now().getTime() - new Date(cached.syncedAt).getTime() < 5 * 60_000) {
      return { events: cached.events, status: await getStatus() }
    }
    if (!(await connected())) return { events: [], status: await getStatus() }
    try {
      const token = await accessToken()
      const url = new URL(`${CALENDAR_ENDPOINT}/calendars/${encodeURIComponent(normalizedCalendarId)}/events`)
      url.search = new URLSearchParams({
        timeMin: localMidnight(weekId, timeZone),
        timeMax: localMidnight(addDays(weekId, 7), timeZone),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100',
        timeZone,
        fields: 'items(id,status,summary,start,end)',
      }).toString()
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
      const body = await responseBody(response)
      if (!response.ok) throw calendarError(apiMessage(body, 'Google Calendar events could not be loaded.'), 'calendar_events_failed')
      const events = (Array.isArray(body?.items) ? body.items : [])
        .map((item) => sanitizeEvent(item, timeZone))
        .filter(Boolean)
      lastSyncedAt = now().toISOString()
      lastError = null
      weekCache.set(weekId, { events, syncedAt: lastSyncedAt })
      return { events, status: await getStatus() }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Google Calendar events could not be loaded.'
      if (cached) return { events: cached.events, status: await getStatus(), stale: true }
      throw error
    }
  }

  async function disconnect() {
    const refreshToken = await keychain.getRefreshToken().catch(() => null)
    if (refreshToken) {
      await fetchImpl(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {})
    }
    await keychain.deleteRefreshToken()
    accessTokenCache = null
    weekCache.clear()
    lastSyncedAt = null
    lastError = null
    return getStatus({ includeAccount: true })
  }

  return { getStatus, beginAuthorization, completeAuthorization, listWeek, disconnect }
}
