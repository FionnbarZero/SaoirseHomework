import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOOGLE_CALENDAR_SCOPES,
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarIntegration,
} from '../server/google-calendar.mjs'

function memoryKeychain() {
  let refreshToken = null
  return {
    available: true,
    async getRefreshToken() { return refreshToken },
    async setRefreshToken(value) { refreshToken = value },
    async deleteRefreshToken() { refreshToken = null },
  }
}

test('Calendar OAuth asks only for identity and read-only events', () => {
  const url = new URL(buildGoogleCalendarAuthorizationUrl({
    clientId: 'desktop-client',
    redirectUri: 'http://127.0.0.1:4179/api/google/calendar/oauth/callback',
    state: 'state',
    challenge: 'challenge',
  }))
  assert.deepEqual(url.searchParams.get('scope').split(' '), GOOGLE_CALENDAR_SCOPES)
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(GOOGLE_CALENDAR_SCOPES.includes('https://www.googleapis.com/auth/calendar'), false)
})

test('Calendar authorization rejects a different Google account', async () => {
  const keychain = memoryKeychain()
  const requests = []
  const integration = createGoogleCalendarIntegration({
    keychain,
    clientId: 'desktop-client',
    redirectUri: 'http://127.0.0.1:4179/api/google/calendar/oauth/callback',
    expectedEmail: 'saoirse@example.com',
    fetch: async (input) => {
      requests.push(String(input))
      if (String(input).includes('/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
      if (String(input).includes('/userinfo')) return Response.json({ email: 'someone-else@example.com' })
      if (String(input).includes('/revoke')) return new Response('', { status: 200 })
      throw new Error(`Unexpected request ${input}`)
    },
  })
  const authorization = await integration.beginAuthorization()
  const state = new URL(authorization.authorizationUrl).searchParams.get('state')
  await assert.rejects(
    integration.completeAuthorization({ state, code: 'code' }),
    (error) => error.code === 'calendar_account_mismatch' && error.status === 403,
  )
  assert.equal(await keychain.getRefreshToken(), null)
  assert.ok(requests.some((url) => url.includes('/revoke')))
})

test('Calendar week expands recurring events and returns only schedule fields', async () => {
  const keychain = memoryKeychain()
  const requests = []
  const integration = createGoogleCalendarIntegration({
    keychain,
    clientId: 'desktop-client',
    redirectUri: 'http://127.0.0.1:4179/api/google/calendar/oauth/callback',
    expectedEmail: 'saoirse@example.com',
    timeZone: 'America/Los_Angeles',
    now: () => new Date('2026-10-06T20:00:00.000Z'),
    fetch: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
      if (url.includes('/userinfo')) return Response.json({ email: 'saoirse@example.com' })
      if (url.includes('/calendar/v3/')) return Response.json({
        items: [
          {
            id: 'volleyball',
            summary: 'Volleyball',
            description: 'This private note must not reach the browser',
            attendees: [{ email: 'friend@example.com' }],
            status: 'confirmed',
            start: { dateTime: '2026-10-06T16:30:00-07:00' },
            end: { dateTime: '2026-10-06T18:00:00-07:00' },
          },
          { id: 'cancelled', summary: 'Cancelled', status: 'cancelled', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
        ],
      })
      throw new Error(`Unexpected request ${input}`)
    },
  })
  const authorization = await integration.beginAuthorization()
  const state = new URL(authorization.authorizationUrl).searchParams.get('state')
  await integration.completeAuthorization({ state, code: 'code' })
  const result = await integration.listWeek('2026-10-05')
  assert.deepEqual(result.events, [{
    id: 'volleyball',
    title: 'Volleyball',
    day: '2026-10-06',
    start: '2026-10-06T16:30:00-07:00',
    end: '2026-10-06T18:00:00-07:00',
    allDay: false,
  }])
  assert.equal('description' in result.events[0], false)
  const calendarUrl = new URL(requests.find((url) => url.includes('/calendar/v3/')))
  assert.equal(calendarUrl.searchParams.get('singleEvents'), 'true')
  assert.equal(calendarUrl.searchParams.get('orderBy'), 'startTime')
  assert.match(calendarUrl.searchParams.get('fields'), /^items\(/)
})
