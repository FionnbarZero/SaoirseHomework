import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGoogleCalendarIntegration } from '../server/google-calendar.mjs'
import { createMacOSKeychain } from '../server/keychain.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
try {
  process.loadEnvFile?.(join(projectRoot, '.env'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const host = '127.0.0.1'
const port = 4191
const callbackPath = '/google-calendar/callback'
const redirectUri = `http://${host}:${port}${callbackPath}`
const clientId = String(process.env.HOMEWORK_GOOGLE_CLIENT_ID ?? '').trim()
const clientSecret = String(process.env.HOMEWORK_GOOGLE_CLIENT_SECRET ?? '').trim()
const expectedEmail = String(process.env.HOMEWORK_CALENDAR_ACCOUNT_EMAIL ?? '').trim()
const calendarId = String(process.env.HOMEWORK_CALENDAR_ID ?? 'primary').trim() || 'primary'

if (!clientId || !expectedEmail) throw new Error('Calendar OAuth is not configured in .env')

const keychain = createMacOSKeychain({
  service: 'com.fionnbar.homework.calendar.google',
  account: 'oauth-refresh-token',
})
const calendar = createGoogleCalendarIntegration({
  keychain,
  clientId,
  clientSecret,
  redirectUri,
  expectedEmail,
  calendarId,
  timeZone: process.env.HOMEWORK_TIME_ZONE || 'America/Los_Angeles',
  authorizationTtlMs: 30 * 60_000,
})

let finished = false
const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', redirectUri)
  if (url.pathname !== callbackPath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  try {
    const status = await calendar.completeAuthorization({
      state: url.searchParams.get('state'),
      code: url.searchParams.get('code'),
      error: url.searchParams.get('error'),
    })
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><meta charset="utf-8"><title>Calendar connected</title><style>body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f2ea;color:#26342f}.card{background:white;padding:32px;border-radius:18px;box-shadow:0 12px 40px #0002;max-width:520px}p{line-height:1.5;color:#5d6965}</style><main class="card"><h1>Calendar connected</h1><p>Read-only Google Calendar access is stored in macOS Keychain. You can close this tab and return to Saoirse Homework.</p></main>')
    console.log(`CONNECTED_ACCOUNT=${status.accountEmail}`)
    finished = true
  } catch (error) {
    response.writeHead(Number.isInteger(error?.status) ? error.status : 500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : 'Calendar authorization failed')
    console.error(error instanceof Error ? error.message : 'Calendar authorization failed')
    process.exitCode = 1
    finished = true
  } finally {
    if (finished) setTimeout(() => server.close(), 500).unref()
  }
})

server.listen(port, host, async () => {
  const authorization = await calendar.beginAuthorization()
  console.log(`AUTHORIZATION_URL=${authorization.authorizationUrl}`)
  console.log(`WAITING_FOR_CALLBACK=${redirectUri}`)
})

server.on('close', () => process.exit(process.exitCode ?? 0))
