import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from './database.mjs'
import { createMockGoogleArtifacts } from './google-proof.mjs'

const serverDirectory = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(serverDirectory, '..')
const port = Number(process.env.HOMEWORK_PORT || 4179)
const host = '127.0.0.1'
const serviceOrigin = `http://${host}:${port}`
const dataDirectory = process.env.HOMEWORK_DATA_DIR || join(projectRoot, 'data')
const databasePath = join(dataDirectory, 'homework.sqlite')
const googleProofDirectory = process.env.HOMEWORK_GOOGLE_PROOF_DIR || join(dataDirectory, 'google-proof')
const distDirectory = join(projectRoot, 'dist')
const store = createStore(databasePath)
const expectedChromeExtensionId = process.env.HOMEWORK_CHROME_EXTENSION_ID || 'mmpeglplfjkbefdgikaldkncikpfdend'
const readingGameUrl = new URL(
  process.env.HOMEWORK_READING_GAME_URL || `${serviceOrigin}/reading-game-simulator.html`,
)
const readingGameOrigin = new URL(
  process.env.HOMEWORK_READING_GAME_ORIGIN || readingGameUrl.origin,
).origin
if (readingGameUrl.origin !== readingGameOrigin) {
  throw new Error('HOMEWORK_READING_GAME_URL must use HOMEWORK_READING_GAME_ORIGIN')
}

const days = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
const selfReportedActivities = new Set(['mandarin', 'math', 'english-packet'])
const parentOverrideActivities = new Set(['mandarin', 'math', 'english-packet', 'reading-strategies', 'ninja-dojo'])
const optionalActivities = new Map([
  ['voena', { label: 'Voena', sessions: 3, targetSeconds: 20 * 60 }],
  ['drums', { label: 'Drum Drills', sessions: 3, targetSeconds: 20 * 60 }],
  ['band', { label: 'Band Practice', sessions: 3, targetSeconds: 20 * 60 }],
  ['level-chinese', { label: 'Level Chinese', sessions: 2, targetSeconds: 20 * 60 }],
  ['du-chinese', { label: 'Du Chinese', sessions: 2, targetSeconds: 20 * 60 }],
])
const requiredActivityIds = ['mandarin', 'math', 'english-packet', 'reading-strategies', 'ninja-dojo']
const optionalTargets = { Monday: 3, Tuesday: 6, Wednesday: 9, Thursday: 11, Friday: 13 }
const guardianPolicy = {
  version: '1',
  blockedBundleIds: [
    'com.apple.Safari',
    'com.apple.Terminal',
    'com.googlecode.iterm2',
    'com.roblox.Roblox',
    'com.roblox.RobloxPlayer',
    'org.mozilla.firefox',
    'com.microsoft.edgemac',
    'company.thebrowser.Browser',
    'com.brave.Browser',
  ],
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  response.end(body)
}

function sendEmpty(response, status, extraHeaders = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', ...extraHeaders })
  response.end()
}

function gameCorsHeaders(origin) {
  if (origin !== readingGameOrigin) return {}
  return {
    'Access-Control-Allow-Origin': readingGameOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2_000_000) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

function serveStatic(pathname, response) {
  if (!existsSync(distDirectory)) return false
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  const requestedPath = normalize(join(distDirectory, relativePath))
  if (!requestedPath.startsWith(distDirectory)) return false
  const filePath = existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : join(distDirectory, 'index.html')
  if (!existsSync(filePath)) return false
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  createReadStream(filePath).pipe(response)
  return true
}

function serveArtifact(artifact, response) {
  if (!existsSync(artifact.path) || !statSync(artifact.path).isFile()) return false
  const filename = artifact.filename.replace(/["\r\n]/g, '')
  response.writeHead(200, {
    'Content-Type': artifact.contentType,
    'Content-Length': statSync(artifact.path).size,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  })
  createReadStream(artifact.path).pipe(response)
  return true
}

function resolveSessionRequest(body) {
  if (body.kind === 'required') {
    if (body.activityId !== 'ninja-dojo' || !days.has(body.sessionKey)) {
      throw new Error('Unsupported required activity session')
    }
    return {
      kind: 'required',
      activityId: 'ninja-dojo',
      sessionKey: body.sessionKey,
      label: 'Ninja Dojo',
      targetSeconds: 17 * 60,
    }
  }

  if (body.kind === 'optional') {
    const activity = optionalActivities.get(body.activityId)
    const match = typeof body.sessionKey === 'string'
      ? body.sessionKey.match(/^([^:]+):(\d+)$/)
      : null
    const sessionIndex = match ? Number(match[2]) : -1
    if (!activity || match?.[1] !== body.activityId || sessionIndex < 0 || sessionIndex >= activity.sessions) {
      throw new Error('Unsupported optional activity session')
    }
    if (store.isOptionalComplete(body.sessionKey)) throw new Error('That practice session is already complete')
    return {
      kind: 'optional',
      activityId: body.activityId,
      sessionKey: body.sessionKey,
      label: `${activity.label} · Session ${sessionIndex + 1}`,
      targetSeconds: activity.targetSeconds,
    }
  }

  if (body.kind === 'reward') {
    const credit = store.getRewardCredit(body.activityId)
    if (!credit || credit.remainingSeconds <= 0) throw new Error('Reward credit not found')
    return {
      kind: 'reward',
      activityId: credit.id,
      label: 'YouTube reward',
      targetSeconds: credit.remainingSeconds,
    }
  }

  throw new Error('Unsupported session kind')
}

function sessionResponse() {
  const state = store.loadState()
  return { session: state.activeTimer, state, meta: store.info() }
}

function learningModeState() {
  const state = store.loadState()
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
  const dailyCompleted = state.requiredByDay[day] ?? []
  const dailyReady = requiredActivityIds.every((activityId) => dailyCompleted.includes(activityId))
  const optionalReady = day in optionalTargets
    ? state.optionalCompleted.length >= optionalTargets[day]
    : false
  const mode = !state.entered
    ? 'inactive'
    : dailyReady && optionalReady
      ? 'free'
      : 'homework'
  return { state, mode, homeworkMode: mode === 'homework', day }
}

function guardianResponse() {
  const { state, mode, homeworkMode, day } = learningModeState()
  return {
    mode,
    homeworkMode,
    day,
    activeSession: state.activeTimer
      ? { id: state.activeTimer.id, kind: state.activeTimer.kind, activityId: state.activeTimer.activityId }
      : null,
    policy: guardianPolicy,
    guardian: store.getGuardianStatus(),
    serviceTime: new Date().toISOString(),
  }
}

function chromeResponse() {
  const { state, mode, homeworkMode } = learningModeState()
  const rewardActive = state.activeTimer?.kind === 'reward'
  return {
    mode,
    homeworkMode,
    activeSession: state.activeTimer
      ? { id: state.activeTimer.id, kind: state.activeTimer.kind, activityId: state.activeTimer.activityId }
      : null,
    policy: {
      version: '1',
      restrictNavigation: homeworkMode,
      allowedDomains: rewardActive
        ? ['127.0.0.1', 'youtube.com', 'youtu.be']
        : ['127.0.0.1'],
      expectedExtensionId: expectedChromeExtensionId,
    },
    extension: store.getChromeExtensionStatus(),
    serviceTime: new Date().toISOString(),
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', serviceOrigin)
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return sendJson(response, 200, { ok: true, service: 'fionnbar-homework', ...store.info() })
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      return sendJson(response, 200, {
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/state' && request.method === 'PUT') {
      const body = await readJson(request)
      const state = store.saveState(body.state ?? body)
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/guardian/status' && request.method === 'GET') {
      return sendJson(response, 200, guardianResponse())
    }

    if (url.pathname === '/api/guardian/heartbeat' && request.method === 'POST') {
      const body = await readJson(request)
      const guardian = store.recordGuardianHeartbeat(body)
      return sendJson(response, 200, { guardian, status: guardianResponse() })
    }

    if (url.pathname === '/api/chrome/status' && request.method === 'GET') {
      return sendJson(response, 200, chromeResponse())
    }

    if (url.pathname === '/api/chrome/heartbeat' && request.method === 'POST') {
      const body = await readJson(request)
      if (body.extensionId !== expectedChromeExtensionId) {
        return sendJson(response, 403, { error: 'Unrecognized Chrome extension ID' })
      }
      const extension = store.recordChromeExtensionHeartbeat(body)
      return sendJson(response, 200, { extension, status: chromeResponse() })
    }

    if (url.pathname === '/api/google/mock/status' && request.method === 'GET') {
      return sendJson(response, 200, {
        googleProof: store.getGoogleProofState(),
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/google/mock/connect' && request.method === 'POST') {
      const body = await readJson(request)
      const googleProof = store.connectMockGoogle(body)
      return sendJson(response, 200, { googleProof, state: store.loadState(), meta: store.info() })
    }

    if (url.pathname === '/api/google/mock/disconnect' && request.method === 'POST') {
      const googleProof = store.disconnectMockGoogle()
      return sendJson(response, 200, { googleProof, state: store.loadState(), meta: store.info() })
    }

    if (url.pathname === '/api/google/mock/deliveries' && request.method === 'POST') {
      const body = await readJson(request)
      const prepared = store.prepareMockGoogleDelivery({ recipient: body.recipient })
      if (!prepared.created || prepared.delivery.status === 'skipped') {
        return sendJson(response, 200, {
          delivery: prepared.delivery,
          duplicate: !prepared.created,
          state: store.loadState(),
          meta: store.info(),
        })
      }

      try {
        const artifacts = await createMockGoogleArtifacts({
          outputDirectory: googleProofDirectory,
          delivery: prepared.delivery,
          drafts: prepared.drafts,
        })
        const delivery = store.completeMockGoogleDelivery(prepared.delivery.id, artifacts)
        return sendJson(response, 201, {
          delivery,
          duplicate: false,
          state: store.loadState(),
          meta: store.info(),
        })
      } catch (error) {
        const delivery = store.failMockGoogleDelivery(prepared.delivery.id, error)
        return sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'The local proof artifacts could not be created',
          code: 'google_mock_artifact_failed',
          delivery,
          state: store.loadState(),
          meta: store.info(),
        })
      }
    }

    const googleArtifactMatch = url.pathname.match(/^\/api\/google\/mock\/deliveries\/([^/]+)\/(document|pdf)$/)
    if (googleArtifactMatch && request.method === 'GET') {
      const artifact = store.getGoogleDeliveryArtifact(
        decodeURIComponent(googleArtifactMatch[1]),
        googleArtifactMatch[2],
      )
      if (serveArtifact(artifact, response)) return
      return sendJson(response, 404, { error: 'Delivery artifact file not found', code: 'artifact_not_found' })
    }

    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      const body = await readJson(request)
      const session = store.startSession(resolveSessionRequest(body))
      const state = store.loadState()
      return sendJson(response, 201, { session, state, meta: store.info() })
    }

    if (url.pathname === '/api/game-sessions' && request.method === 'POST') {
      const body = await readJson(request)
      const { session, nonce } = store.startGameSession({
        activityId: body.activityId,
        day: body.day,
        expectedOrigin: readingGameOrigin,
      })
      const launchUrl = new URL(readingGameUrl)
      launchUrl.hash = new URLSearchParams({
        sessionId: session.id,
        nonce,
        day: session.day,
        completionUrl: `${serviceOrigin}/api/game-sessions/${encodeURIComponent(session.id)}/complete`,
      }).toString()
      return sendJson(response, 201, {
        gameSession: { ...session, launchUrl: launchUrl.toString() },
        state: store.loadState(),
        meta: store.info(),
      })
    }

    const gameCompletionMatch = url.pathname.match(/^\/api\/game-sessions\/([^/]+)\/complete$/)
    if (gameCompletionMatch && request.method === 'OPTIONS') {
      const origin = request.headers.origin || ''
      if (origin !== readingGameOrigin) {
        return sendJson(response, 403, { error: 'Game completion origin was not accepted', code: 'origin_mismatch' })
      }
      return sendEmpty(response, 204, gameCorsHeaders(origin))
    }

    if (gameCompletionMatch && request.method === 'POST') {
      const origin = request.headers.origin || ''
      const headers = gameCorsHeaders(origin)
      if (origin !== readingGameOrigin) {
        return sendJson(
          response,
          403,
          { error: 'Game completion origin was not accepted', code: 'origin_mismatch' },
        )
      }
      const body = await readJson(request)
      const gameSession = store.completeGameSession({
        id: decodeURIComponent(gameCompletionMatch[1]),
        nonce: body.nonce,
        origin,
      })
      return sendJson(response, 200, {
        gameSession,
        state: store.loadState(),
        meta: store.info(),
      }, headers)
    }

    const gameStatusMatch = url.pathname.match(/^\/api\/game-sessions\/([^/]+)$/)
    if (gameStatusMatch && request.method === 'GET') {
      return sendJson(response, 200, {
        gameSession: store.getGameSession(decodeURIComponent(gameStatusMatch[1])),
        state: store.loadState(),
        meta: store.info(),
      })
    }

    const heartbeatMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/heartbeat$/)
    if (heartbeatMatch && request.method === 'POST') {
      const body = await readJson(request)
      store.heartbeatSession(decodeURIComponent(heartbeatMatch[1]), body.active === true)
      return sendJson(response, 200, sessionResponse())
    }

    const cancelMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cancel$/)
    if (cancelMatch && request.method === 'POST') {
      store.cancelSession(decodeURIComponent(cancelMatch[1]))
      return sendJson(response, 200, sessionResponse())
    }

    const acknowledgeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/acknowledge$/)
    if (acknowledgeMatch && request.method === 'POST') {
      store.acknowledgeSession(decodeURIComponent(acknowledgeMatch[1]))
      return sendJson(response, 200, sessionResponse())
    }

    if (url.pathname === '/api/completions' && request.method === 'POST') {
      const body = await readJson(request)
      const allowedActivities = body.method === 'self-reported' ? selfReportedActivities : parentOverrideActivities
      if (!allowedActivities.has(body.activityId)) {
        return sendJson(response, 400, { error: 'That activity cannot use this completion method' })
      }
      const state = store.setDailyCompletion(body)
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/audit' && request.method === 'GET') {
      return sendJson(response, 200, { events: store.listAudit(url.searchParams.get('limit')) })
    }

    if (url.pathname === '/api/audit' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body.eventType) return sendJson(response, 400, { error: 'eventType is required' })
      return sendJson(response, 201, { event: store.addAudit(body.eventType, body.details) })
    }

    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found' })
    if (request.method === 'GET' && serveStatic(url.pathname, response)) return
    return sendJson(response, 404, { error: 'Build the web app before serving it here' })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500
    if (status >= 500) console.error(error)
    const completionRequest = /^\/api\/game-sessions\/[^/]+\/complete$/.test(url.pathname)
    const headers = completionRequest ? gameCorsHeaders(request.headers.origin || '') : {}
    return sendJson(response, status, {
      error: error instanceof Error ? error.message : 'Unexpected error',
      code: error?.code || 'unexpected_error',
    }, headers)
  }
})

server.listen(port, host, () => {
  console.log(`Homework service listening at ${serviceOrigin}`)
  console.log(`SQLite database: ${databasePath}`)
  console.log(`Reading game origin: ${readingGameOrigin}`)
})

function close() {
  server.close(() => {
    store.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
