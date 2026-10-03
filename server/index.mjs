import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from './database.mjs'

const serverDirectory = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(serverDirectory, '..')
const port = Number(process.env.HOMEWORK_PORT || 4179)
const host = '127.0.0.1'
const dataDirectory = process.env.HOMEWORK_DATA_DIR || join(projectRoot, 'data')
const databasePath = join(dataDirectory, 'homework.sqlite')
const distDirectory = join(projectRoot, 'dist')
const store = createStore(databasePath)

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

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
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
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  createReadStream(filePath).pipe(response)
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`)

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

    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      const body = await readJson(request)
      const session = store.startSession(resolveSessionRequest(body))
      const state = store.loadState()
      return sendJson(response, 201, { session, state, meta: store.info() })
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
    console.error(error)
    return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unexpected error' })
  }
})

server.listen(port, host, () => {
  console.log(`Homework service listening at http://${host}:${port}`)
  console.log(`SQLite database: ${databasePath}`)
})

function close() {
  server.close(() => {
    store.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
