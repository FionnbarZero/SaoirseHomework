import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildActivitySessionPlan } from './activity-config.mjs'
import { createStore } from './database.mjs'
import { createGoogleLiveIntegration } from './google-live.mjs'
import { createMockGoogleArtifacts } from './google-proof.mjs'
import { createMacOSKeychain } from './keychain.mjs'
import { createParentAuthorization } from './parent-auth.mjs'
import { createProofreader } from './proofreader.mjs'
import { createAiProofreader } from './ai-proofreader.mjs'
import { checkWriting } from './writing-check.mjs'
import { createLifecycleAuthenticatorFromEnvironment } from './lifecycle-auth.mjs'
import { enforceRootOwnedRuntime } from './runtime-security.mjs'
import { createUserSessionBroker } from './user-session-broker.mjs'
import { createPrivateAccess } from './private-access.mjs'
import { activeRequiredActivities } from '../src/domain.ts'

const serverDirectory = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(serverDirectory, '..')
try {
  process.loadEnvFile?.(join(projectRoot, '.env'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const port = Number(process.env.HOMEWORK_PORT || 4179)
const privateAccess = createPrivateAccess()
const host = '127.0.0.1'
const serviceOrigin = `http://${host}:${port}`
const dataDirectory = process.env.HOMEWORK_DATA_DIR || join(projectRoot, 'data')
const databasePath = join(dataDirectory, 'homework.sqlite')
const googleProofDirectory = process.env.HOMEWORK_GOOGLE_PROOF_DIR || join(dataDirectory, 'google-proof')
const googleLiveDirectory = process.env.HOMEWORK_GOOGLE_LIVE_DIR || join(dataDirectory, 'google-live')
const distDirectory = join(projectRoot, 'dist')
const timeZone = process.env.HOMEWORK_TIME_ZONE || 'America/Los_Angeles'
const googleMode = process.env.HOMEWORK_GOOGLE_MODE === 'live' ? 'live' : 'safe-test'
const googleClientId = String(process.env.HOMEWORK_GOOGLE_CLIENT_ID ?? '').trim()
const googleClientSecret = String(process.env.HOMEWORK_GOOGLE_CLIENT_SECRET ?? '').trim()
const writingLogDocumentId = String(process.env.HOMEWORK_WRITING_LOG_DOCUMENT_ID ?? '').trim()
const writingLogTabId = String(process.env.HOMEWORK_WRITING_LOG_TAB_ID ?? 't.0').trim() || 't.0'
const guardianSharedSecret = String(process.env.HOMEWORK_GUARDIAN_SHARED_SECRET ?? '').trim()
const lifecycleKeyFile = String(process.env.HOMEWORK_LIFECYCLE_KEY_FILE ?? '').trim()
const requireRootOwnership = process.env.HOMEWORK_REQUIRE_ROOT_OWNERSHIP === '1'
const securityMode = process.env.HOMEWORK_SECURITY_MODE === 'enforcing' ? 'enforcing' : 'preview'
const parentAuthorization = createParentAuthorization()
const proofreader = createProofreader()
const aiProofreader = createAiProofreader()
const parentSessionCookie = 'fionnbar_parent_session'
if (requireRootOwnership) {
  enforceRootOwnedRuntime({ dataDirectory, keyFile: lifecycleKeyFile, serviceRoot: projectRoot })
}
const lifecycleAuthenticator = createLifecycleAuthenticatorFromEnvironment()
const userSessionBroker = createUserSessionBroker({
  authenticator: lifecycleAuthenticator,
  required: requireRootOwnership,
})
const googleKeychain = requireRootOwnership ? null : createMacOSKeychain()
const googleCredentialBroker = requireRootOwnership ? userSessionBroker.googleCredentials : null
const parentAuthorizationConfigured = requireRootOwnership
  ? userSessionBroker.configured
  : guardianSharedSecret.length >= 32
const store = createStore(databasePath, {
  timeZone,
  enforceFilePermissions: requireRootOwnership,
  googleLiveConfiguration: {
    mode: googleMode,
    clientConfigured: Boolean(googleClientId),
    keychainAvailable: googleCredentialBroker?.available ?? googleKeychain?.available ?? false,
  },
})
const googleLive = createGoogleLiveIntegration({
  store,
  keychain: googleKeychain,
  credentialBroker: googleCredentialBroker,
  clientId: googleClientId,
  clientSecret: googleClientSecret,
  redirectUri: serviceOrigin,
  outputDirectory: googleLiveDirectory,
  mode: googleMode,
  timeZone,
  writingLogDocumentId,
  writingLogTabId,
})
const expectedChromeExtensionId = process.env.HOMEWORK_CHROME_EXTENSION_ID || 'mmpeglplfjkbefdgikaldkncikpfdend'
const readingGameOrigin = new URL(
  process.env.HOMEWORK_READING_GAME_ORIGIN || serviceOrigin,
).origin
const youtubeLaunchUrl = 'https://www.youtube.com/'
const youtubePlaybackOrigins = [
  'https://youtube.com',
  'https://www.youtube.com',
  'https://m.youtube.com',
  'https://music.youtube.com',
]
const days = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
const selfReportedActivities = new Set(activeRequiredActivities().filter((activity) => activity.method === 'self').map((activity) => activity.id))
const parentOverrideActivities = new Set(activeRequiredActivities().map((activity) => activity.id))
const optionalActivities = new Map([
  ['voena', { label: 'Voena', sessions: 3, targetSeconds: 20 * 60 }],
  ['drums', { label: 'Drum Drills', sessions: 3, targetSeconds: 20 * 60 }],
  ['band', { label: 'Band Practice', sessions: 3, targetSeconds: 20 * 60 }],
])
const requiredTimedActivities = new Map([
  ['ninja-dojo', { label: 'Ninja Dojo' }],
  ['level-chinese', { label: 'Level Chinese' }],
  ['du-chinese', { label: 'Du Chinese' }],
])
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

function sendHtml(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function requestCookie(request, name) {
  const cookies = String(request.headers.cookie ?? '').split(';')
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')
    if (separator < 0) continue
    if (cookie.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(cookie.slice(separator + 1).trim())
  }
  return ''
}

function parentSessionToken(request) {
  return requestCookie(request, parentSessionCookie)
}

function parentSessionHeader(token) {
  return `${parentSessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=600${privateAccess.enabled ? '; Secure' : ''}`
}

function expiredParentSessionHeader() {
  return `${parentSessionCookie}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${privateAccess.enabled ? '; Secure' : ''}`
}

function bearerToken(request) {
  const value = String(request.headers.authorization ?? '')
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function guardianRequestIsAuthenticated(request) {
  if (requireRootOwnership) {
    try {
      userSessionBroker.authenticateAccess(request.headers.authorization)
      return true
    } catch {
      return false
    }
  }
  return parentAuthorizationConfigured && parentAuthorization.safeEqual(bearerToken(request), guardianSharedSecret)
}

function requireGuardian(request) {
  if (!parentAuthorizationConfigured) {
    const error = new Error('Parent authorization is not configured')
    error.status = 503
    error.code = 'parent_authorization_not_configured'
    throw error
  }
  if (!guardianRequestIsAuthenticated(request)) {
    const error = new Error('Guardian authentication failed')
    error.status = 401
    error.code = 'guardian_authentication_required'
    throw error
  }
}

function requireUserSessionBroker(request) {
  return userSessionBroker.authenticateAccess(request.headers.authorization)
}

function requireParent(request, options = {}) {
  const result = parentAuthorization.validateSession(parentSessionToken(request), options)
  if (result.valid) return result.session
  const error = new Error(options.sensitive
    ? 'Administrator reauthorization is required for this action'
    : 'Parent authorization is required')
  error.status = result.code === 'parent_reauthentication_required' ? 403 : 401
  error.code = result.code
  throw error
}

function oauthResultPage(success, message) {
  const title = success ? 'Google connected' : 'Google connection failed'
  const safeMessage = String(message)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f5f2ea;color:#26342f;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;background:#fff;padding:32px;border-radius:18px;box-shadow:0 12px 40px #0002}h1{font-size:24px}p{line-height:1.55;color:#5d6965}</style></head><body><main class="card"><h1>${title}</h1><p>${safeMessage}</p><p>You can close this window and return to Fionnbar Homework.</p></main><script>window.opener?.postMessage({type:'fionnbar-google-oauth',success:${success}},window.location.origin)</script></body></html>`
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
    const activity = requiredTimedActivities.get(body.activityId)
    if (!activity || !days.has(body.sessionKey)) {
      throw new Error('Unsupported required activity session')
    }
    const plan = buildActivitySessionPlan(body.activityId, store.getActivityConfiguration())
    if (!store.getChromeExtensionStatus().connected) {
      const error = new Error(`Managed Chrome must be connected before ${activity.label} can start`)
      error.status = 409
      error.code = 'managed_chrome_required'
      throw error
    }
    return {
      kind: 'required',
      activityId: body.activityId,
      sessionKey: body.sessionKey,
      label: activity.label,
      targetSeconds: plan.targetSeconds,
      plan,
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
    const plan = buildActivitySessionPlan(body.activityId, store.getActivityConfiguration())
    if (plan && !store.getChromeExtensionStatus().connected) {
      const error = new Error(`Managed Chrome must be connected before ${activity.label} can start`)
      error.status = 409
      error.code = 'managed_chrome_required'
      throw error
    }
    return {
      kind: 'optional',
      activityId: body.activityId,
      sessionKey: body.sessionKey,
      label: `${activity.label} · Session ${sessionIndex + 1}`,
      targetSeconds: plan?.targetSeconds ?? activity.targetSeconds,
      ...(plan ? { plan } : {}),
    }
  }

  if (body.kind === 'reward') {
    const credit = store.getRewardCredit(body.activityId)
    if (!credit || credit.remainingSeconds <= 0) throw new Error('Reward credit not found')
    if (!store.getChromeExtensionStatus().connected) {
      const error = new Error('Managed Chrome must be connected before YouTube reward time can start')
      error.status = 409
      error.code = 'managed_chrome_required'
      throw error
    }
    return {
      kind: 'reward',
      activityId: credit.id,
      label: 'YouTube reward',
      targetSeconds: credit.remainingSeconds,
      selectionSeconds: 2 * 60,
      plan: {
        phases: [{
          id: 'youtube-playback',
          label: 'YouTube playback',
          targetSeconds: credit.remainingSeconds,
          launchUrl: youtubeLaunchUrl,
          allowedOrigins: youtubePlaybackOrigins,
          creditOrigins: youtubePlaybackOrigins,
          advanceOrigins: [],
          verification: 'youtube-playback',
        }],
      },
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
  const day = state.weekContext.localDay
  const mode = !state.entered
    ? 'inactive'
    : Boolean(state.freeModeByDay[day])
      ? 'free'
      : 'homework'
  return { state, mode, homeworkMode: mode === 'homework', day }
}

function guardianResponse(includeParentChallenge = false) {
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
    parentAuthorizationChallenge: includeParentChallenge
      ? parentAuthorization.pendingChallenge()
      : null,
    serviceTime: new Date().toISOString(),
  }
}

function securityResponse() {
  const { state, mode, homeworkMode } = learningModeState()
  const guardian = store.getGuardianStatus()
  const chrome = store.getChromeExtensionStatus()
  const reasons = []
  if (securityMode === 'enforcing' && homeworkMode) {
    if (!parentAuthorizationConfigured) reasons.push('parent_authorization_not_configured')
    if (!guardian.connected || !parentAuthorizationConfigured) reasons.push('guardian_unavailable')
    if (!chrome.connected) reasons.push('managed_chrome_unavailable')
  }
  return {
    mode: securityMode,
    learningMode: mode,
    locked: reasons.length > 0,
    reasons,
    guardianConnected: guardian.connected,
    chromeConnected: chrome.connected,
    parentAuthorizationConfigured,
    serviceTime: new Date().toISOString(),
    entered: state.entered,
  }
}

function parentStatus(request) {
  const result = parentAuthorization.validateSession(parentSessionToken(request))
  return {
    configured: parentAuthorizationConfigured,
    guardianConnected: store.getGuardianStatus().connected,
    authenticated: result.valid,
    ...(result.valid ? result.session : {}),
  }
}

function chromeResponse() {
  const { state, mode, homeworkMode } = learningModeState()
  const rewardActive = state.activeTimer?.kind === 'reward' && state.activeTimer.status !== 'completed'
  const sessionOrigins = state.activeTimer?.allowedOrigins ?? []
  const gameOrigins = state.activeGameSession?.status === 'pending'
    ? [readingGameOrigin]
    : []
  const allowedDomains = rewardActive
    ? ['127.0.0.1', 'youtube.com', 'youtu.be']
    : ['127.0.0.1']
  const allowedOrigins = rewardActive
    ? []
    : [...new Set([...sessionOrigins, ...gameOrigins])]
  return {
    mode,
    homeworkMode,
    activeSession: state.activeTimer
      ? {
          id: state.activeTimer.id,
          kind: state.activeTimer.kind,
          activityId: state.activeTimer.activityId,
          phaseId: state.activeTimer.phaseId,
          phaseIndex: state.activeTimer.phaseIndex,
          phaseToken: `${state.activeTimer.id}:${state.activeTimer.phaseIndex ?? 0}`,
          launchUrl: state.activeTimer.launchUrl ?? null,
          navigateOnPhaseStart: state.activeTimer.navigateOnPhaseStart === true,
          status: state.activeTimer.status,
          rewardSelectionDeadlineAt: state.activeTimer.rewardSelectionDeadlineAt ?? null,
          rewardPlaybackStarted: state.activeTimer.rewardPlaybackStarted === true,
          rewardPlaybackActive: state.activeTimer.rewardPlaybackActive === true,
        }
      : null,
    policy: {
      version: '3',
      restrictNavigation: homeworkMode,
      allowedDomains,
      allowedOrigins,
      expectedExtensionId: expectedChromeExtensionId,
    },
    extension: store.getChromeExtensionStatus(),
    serviceTime: new Date().toISOString(),
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', serviceOrigin)
  try {
    // Apply to HTML, static files, data, and AI endpoints alike. No health or
    // loopback exception may accidentally become a public route through a tunnel.
    request.privateIdentity = await privateAccess.authenticate(request)
    if (privateAccess.enabled) {
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'same-origin')
      response.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return sendJson(response, 200, { ok: true, service: 'fionnbar-homework', ...store.info() })
    }

    if (url.pathname === '/api/security/status' && request.method === 'GET') {
      return sendJson(response, 200, securityResponse())
    }

    if (url.pathname === '/api/proofread' && request.method === 'POST') {
      const body = await readJson(request)
      const mode = store.getAiProofreadingMode()
      const result = await checkWriting(String(body.text ?? ''), {
        proofreader, aiProofreader, mode, dictionary: store.loadState().writingDictionary,
      })
      const aiResult = result.ai
      result.checkId = store.recordWritingCheck(String(body.text ?? ''), result)
      if (aiResult.analyzed) {
        store.addAudit('ai_proofreading_completed', {
          mode: aiResult.mode,
          model: aiResult.model,
          ...aiResult.counts,
        })
      } else if (aiResult.mode !== 'off' && aiResult.error) {
        store.addAudit('ai_proofreading_unavailable', {
          mode: aiResult.mode,
          reason: aiResult.configured ? 'provider_unavailable' : 'not_configured',
        })
      }
      const intentResult = result.intentAi
      if (intentResult.analyzed) {
        store.addAudit('ai_meaning_review_completed', {
          mode: intentResult.mode,
          model: intentResult.model,
          sentenceCount: intentResult.reviews.length,
        })
      }
      return sendJson(response, 200, result)
    }

    if (url.pathname === '/api/interpret-sentence' && request.method === 'POST') {
      const body = await readJson(request)
      const text = String(body.text ?? '')
      const sourceStart = Math.max(0, Math.floor(Number(body.start) || 0))
      const sourceEnd = Math.min(text.length, Math.floor(Number(body.end) || text.length))
      if (!text.trim() || sourceEnd <= sourceStart) {
        const error = new Error('A valid sentence is required for meaning review')
        error.status = 400
        error.code = 'invalid_sentence'
        throw error
      }
      const sentence = text.slice(sourceStart, sourceEnd)
      if (store.getAiProofreadingMode() !== 'assist') {
        return sendJson(response, 409, { error: 'Meaning choices require Guided practice mode.' })
      }
      const result = await aiProofreader.interpret(sentence, store.getAiProofreadingMode(), {
        attempt: body.attempt,
        rejectedOptions: body.rejectedOptions,
      })
      const review = result.reviews[0]
      const shifted = review
        ? {
            ...review,
            id: `sentence-${sourceStart}-${sourceEnd}`,
            start: review.start + sourceStart,
            end: review.end + sourceStart,
            options: review.options.map((option) => ({
              ...option,
              edits: option.edits.map((edit) => ({ ...edit, offset: edit.offset + sourceStart })),
            })),
          }
        : null
      return sendJson(response, 200, { review: shifted, intentAi: result })
    }

    if (url.pathname === '/api/guardian/lifecycle' && request.method === 'GET') {
      return sendJson(response, 200, lifecycleAuthenticator.authenticate(store.getGuardianLifecycle()))
    }

    if (url.pathname === '/api/learning-session/start' && request.method === 'POST') {
      const lifecycle = lifecycleAuthenticator.authenticate(store.startLearningSession())
      return sendJson(response, 200, {
        lifecycle,
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/user-broker/work' && request.method === 'GET') {
      requireUserSessionBroker(request)
      const guardian = store.recordGuardianHeartbeat({
        guardianId: 'signed-guardian-agent',
        mode: securityMode === 'enforcing' ? 'enforcing' : 'dry-run',
        decision: 'user-session-broker-ready',
        version: '0.8.0',
      })
      return sendJson(response, 200, {
        parentAuthorizationChallenge: parentAuthorization.pendingChallenge(),
        operation: userSessionBroker.nextOperation(),
        guardian,
      })
    }

    const userBrokerOperationMatch = url.pathname.match(/^\/api\/user-broker\/operations\/([^/]+)$/)
    if (userBrokerOperationMatch && request.method === 'POST') {
      requireUserSessionBroker(request)
      const body = await readJson(request)
      const result = userSessionBroker.completeOperation(
        decodeURIComponent(userBrokerOperationMatch[1]),
        body,
      )
      return sendJson(response, 200, result)
    }

    if (url.pathname === '/api/user-broker/parent-authorization' && request.method === 'POST') {
      const body = await readJson(request)
      const challenge = parentAuthorization.getChallenge(body.challengeId)
      if (!challenge || challenge.status !== 'pending') {
        return sendJson(response, 404, {
          error: 'Parent authorization challenge was not found or has expired',
          code: 'parent_challenge_expired',
        })
      }
      const decision = userSessionBroker.authenticateParentDecision(body.authentication, challenge)
      const resolved = decision.approved
        ? parentAuthorization.approveChallenge(challenge.id)
        : parentAuthorization.denyChallenge(challenge.id)
      store.addAudit(decision.approved
        ? 'parent_authorization_approved_by_native_broker'
        : 'parent_authorization_denied_by_native_broker', {
        challengeId: challenge.id,
        purpose: challenge.purpose,
      })
      return sendJson(response, 200, { challenge: resolved })
    }

    if (url.pathname === '/api/parent/auth/status' && request.method === 'GET') {
      return sendJson(response, 200, parentStatus(request))
    }

    if (url.pathname === '/api/parent/auth/challenges' && request.method === 'POST') {
      if (!parentAuthorizationConfigured) {
        return sendJson(response, 503, {
          error: 'Parent authorization needs a guardian shared secret',
          code: 'parent_authorization_not_configured',
        })
      }
      if (!store.getGuardianStatus().connected) {
        return sendJson(response, 503, {
          error: 'The macOS guardian must be connected before Parent controls can open',
          code: 'guardian_unavailable',
        })
      }
      const body = await readJson(request)
      const challenge = parentAuthorization.createChallenge(body.purpose)
      store.addAudit('parent_authorization_requested', {
        challengeId: challenge.id,
        purpose: challenge.purpose,
      })
      return sendJson(response, 201, { challenge })
    }

    const parentChallengeMatch = url.pathname.match(/^\/api\/parent\/auth\/challenges\/([^/]+)$/)
    if (parentChallengeMatch && request.method === 'GET') {
      const challengeId = decodeURIComponent(parentChallengeMatch[1])
      const result = parentAuthorization.consumeChallenge(challengeId)
      if (result.status === 'approved') {
        store.addAudit('parent_authorization_succeeded', {
          challengeId,
          purpose: result.session.purpose,
          expiresAt: result.session.expiresAt,
        })
        return sendJson(response, 200, {
          status: result.status,
          session: result.session,
        }, { 'Set-Cookie': parentSessionHeader(result.token) })
      }
      return sendJson(response, 200, result)
    }

    if (url.pathname === '/api/parent/auth/logout' && request.method === 'POST') {
      parentAuthorization.revokeSession(parentSessionToken(request))
      store.addAudit('parent_session_locked', {})
      return sendJson(response, 200, { authenticated: false }, {
        'Set-Cookie': expiredParentSessionHeader(),
      })
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
      void googleLive.queueWritingLogSync(state.drafts)
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/writing-log/status' && request.method === 'GET') {
      return sendJson(response, 200, { writingLog: googleLive.getWritingLogState() })
    }

    if (url.pathname === '/api/writing-log/sync' && request.method === 'POST') {
      const writingLog = await googleLive.syncWritingLog(store.loadState().drafts)
      return sendJson(response, 200, { writingLog })
    }

    if (url.pathname === '/api/activity-configuration' && request.method === 'PUT') {
      requireParent(request)
      const body = await readJson(request)
      store.setActivityConfiguration(body.configuration ?? body)
      return sendJson(response, 200, { state: store.loadState(), meta: store.info() })
    }

    if (url.pathname === '/api/guardian/status' && request.method === 'GET') {
      return sendJson(response, 200, guardianResponse(guardianRequestIsAuthenticated(request)))
    }

    if (url.pathname === '/api/guardian/heartbeat' && request.method === 'POST') {
      if (parentAuthorizationConfigured || securityMode === 'enforcing') requireGuardian(request)
      const body = await readJson(request)
      const guardian = store.recordGuardianHeartbeat(body)
      return sendJson(response, 200, { guardian, status: guardianResponse(true) })
    }

    if (url.pathname === '/api/guardian/parent-approval' && request.method === 'POST') {
      if (requireRootOwnership) {
        return sendJson(response, 403, {
          error: 'Protected mode requires a daemon-authenticated native authorization assertion',
          code: 'native_parent_authorization_required',
        })
      }
      requireGuardian(request)
      const body = await readJson(request)
      const challenge = body.approved === true
        ? parentAuthorization.approveChallenge(body.challengeId)
        : parentAuthorization.denyChallenge(body.challengeId)
      if (!challenge) {
        return sendJson(response, 404, {
          error: 'Parent authorization challenge was not found or has expired',
          code: 'parent_challenge_expired',
        })
      }
      store.addAudit(body.approved === true
        ? 'parent_authorization_approved_by_macos'
        : 'parent_authorization_denied_by_macos', {
        challengeId: challenge.id,
        purpose: challenge.purpose,
      })
      return sendJson(response, 200, { challenge })
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
      requireParent(request)
      return sendJson(response, 200, {
        googleProof: store.getGoogleProofState(),
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/google/live/status' && request.method === 'GET') {
      requireParent(request)
      return sendJson(response, 200, {
        googleLive: store.getLiveGoogleState(),
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/google/live/configuration' && request.method === 'POST') {
      requireParent(request)
      const body = await readJson(request)
      const googleLiveState = store.configureLiveGoogle(body)
      return sendJson(response, 200, {
        googleLive: googleLiveState,
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/google/live/authorize' && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const authorization = await googleLive.beginAuthorization()
      return sendJson(response, 200, authorization)
    }

    const googleOAuthCallback = request.method === 'GET' && (
      url.pathname === '/api/google/live/oauth/callback' ||
      (url.pathname === '/' && url.searchParams.has('state') && (url.searchParams.has('code') || url.searchParams.has('error')))
    )
    if (googleOAuthCallback) {
      try {
        const googleLiveState = await googleLive.completeAuthorization({
          state: url.searchParams.get('state'),
          code: url.searchParams.get('code'),
          error: url.searchParams.get('error'),
        })
        return sendHtml(
          response,
          200,
          oauthResultPage(true, `${googleLiveState.accountEmail} is authorized. The refresh token is stored in macOS Keychain.`),
        )
      } catch (error) {
        return sendHtml(
          response,
          Number.isInteger(error?.status) ? error.status : 500,
          oauthResultPage(false, error instanceof Error ? error.message : 'Google authorization could not be completed.'),
        )
      }
    }

    if (url.pathname === '/api/google/live/disconnect' && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const googleLiveState = await googleLive.disconnect()
      return sendJson(response, 200, {
        googleLive: googleLiveState,
        state: store.loadState(),
        meta: store.info(),
      })
    }

    if (url.pathname === '/api/google/live/deliveries' && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const body = await readJson(request)
      const prepared = await googleLive.queueDelivery({ recipient: body.recipient, weekId: body.weekId })
      return sendJson(response, prepared.created ? 201 : 200, {
        delivery: prepared.delivery,
        duplicate: !prepared.created,
        state: store.loadState(),
        meta: store.info(),
      })
    }

    const googleLiveRetryMatch = url.pathname.match(/^\/api\/google\/live\/deliveries\/([^/]+)\/retry$/)
    if (googleLiveRetryMatch && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const delivery = await googleLive.retryDelivery(decodeURIComponent(googleLiveRetryMatch[1]))
      return sendJson(response, 200, { delivery, state: store.loadState(), meta: store.info() })
    }

    const googleLivePdfMatch = url.pathname.match(/^\/api\/google\/live\/deliveries\/([^/]+)\/pdf$/)
    if (googleLivePdfMatch && request.method === 'GET') {
      requireParent(request)
      const artifact = store.getLiveGoogleDeliveryArtifact(decodeURIComponent(googleLivePdfMatch[1]))
      if (serveArtifact(artifact, response)) return
      return sendJson(response, 404, { error: 'Delivery PDF file not found', code: 'artifact_not_found' })
    }

    if (url.pathname === '/api/google/mock/connect' && request.method === 'POST') {
      requireParent(request)
      const body = await readJson(request)
      const googleProof = store.connectMockGoogle(body)
      return sendJson(response, 200, { googleProof, state: store.loadState(), meta: store.info() })
    }

    if (url.pathname === '/api/google/mock/disconnect' && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const googleProof = store.disconnectMockGoogle()
      return sendJson(response, 200, { googleProof, state: store.loadState(), meta: store.info() })
    }

    if (url.pathname === '/api/google/mock/deliveries' && request.method === 'POST') {
      requireParent(request)
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
      requireParent(request)
      const artifact = store.getGoogleDeliveryArtifact(
        decodeURIComponent(googleArtifactMatch[1]),
        googleArtifactMatch[2],
      )
      if (serveArtifact(artifact, response)) return
      return sendJson(response, 404, { error: 'Delivery artifact file not found', code: 'artifact_not_found' })
    }

    if (url.pathname === '/api/parent/reward-credits' && request.method === 'POST') {
      requireParent(request)
      const body = await readJson(request)
      const state = store.addParentRewardCredit(body)
      return sendJson(response, 201, { state, meta: store.info() })
    }

    if (url.pathname === '/api/parent/writing-dictionary' && request.method === 'PUT') {
      requireParent(request)
      const body = await readJson(request)
      const state = store.setWritingDictionary(body.dictionary ?? body)
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/parent/ai-proofreading' && request.method === 'GET') {
      requireParent(request)
      return sendJson(response, 200, aiProofreader.status(store.getAiProofreadingMode()))
    }

    if (url.pathname === '/api/parent/ai-proofreading' && request.method === 'PUT') {
      requireParent(request)
      const body = await readJson(request)
      const status = aiProofreader.status(body.mode)
      if (!status.configured && status.mode !== 'off') {
        const error = new Error('Add OPENAI_API_KEY and HOMEWORK_OPENAI_MODEL to the local service before enabling AI proofreading')
        error.status = 409
        error.code = 'ai_proofreading_not_configured'
        throw error
      }
      const mode = store.setAiProofreadingMode(status.mode)
      return sendJson(response, 200, aiProofreader.status(mode))
    }

    const writingReviewMatch = url.pathname.match(/^\/api\/parent\/writing-reviews\/([^/]+)$/)
    if (writingReviewMatch && request.method === 'PUT') {
      requireParent(request)
      const body = await readJson(request)
      const state = store.setWritingReviewStatus(
        decodeURIComponent(writingReviewMatch[1]),
        body.status,
        body.decision,
        body.replacement,
      )
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/parent/reset-preview' && request.method === 'POST') {
      requireParent(request, { sensitive: true })
      const state = store.resetParentPreviewData()
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      const body = await readJson(request)
      const session = store.startSession(resolveSessionRequest(body))
      const state = store.loadState()
      return sendJson(response, 201, { session, state, meta: store.info() })
    }

    if (url.pathname === '/api/game-sessions' && request.method === 'POST') {
      const body = await readJson(request)
      const { session } = store.startGameSession({
        activityId: body.activityId,
        day: body.day,
        expectedOrigin: readingGameOrigin,
      })
      return sendJson(response, 201, {
        gameSession: session,
        state: store.loadState(),
        meta: store.info(),
      })
    }

    const writingCompletionMatch = url.pathname.match(/^\/api\/game-sessions\/([^/]+)\/complete-writing$/)
    if (writingCompletionMatch && request.method === 'POST') {
      const body = await readJson(request)
      const result = store.completeWritingGameSession({
        id: decodeURIComponent(writingCompletionMatch[1]),
        draftId: body.draftId,
      })
      return sendJson(response, 200, {
        gameSession: result.session,
        evidence: result.evidence,
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
      if (body.method === 'parent-override') requireParent(request)
      const allowedActivities = body.method === 'self-reported' ? selfReportedActivities : parentOverrideActivities
      if (!allowedActivities.has(body.activityId)) {
        return sendJson(response, 400, { error: 'That activity cannot use this completion method' })
      }
      const state = store.setDailyCompletion(body)
      return sendJson(response, 200, { state, meta: store.info() })
    }

    if (url.pathname === '/api/audit' && request.method === 'GET') {
      requireParent(request)
      return sendJson(response, 200, { events: store.listAudit(url.searchParams.get('limit')) })
    }

    if (url.pathname === '/api/audit' && request.method === 'POST') {
      requireParent(request)
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
  console.log(`Writing remediation origin: ${readingGameOrigin}`)
  console.log(`Google delivery mode: ${googleMode}`)
  console.log(`Parent authorization: ${parentAuthorizationConfigured ? 'configured' : 'locked (shared secret missing)'}`)
  console.log(`Recovery security mode: ${securityMode}`)
})

const googleQueueInterval = setInterval(() => {
  void googleLive.runQueue().catch((error) => console.error('Google delivery queue failed:', error.message))
}, 60_000)
googleQueueInterval.unref()
const initialGoogleQueueRun = setTimeout(() => {
  void googleLive.runQueue().catch((error) => console.error('Google delivery queue failed:', error.message))
  void googleLive.queueWritingLogSync(store.loadState().drafts)
}, 2_000)
initialGoogleQueueRun.unref()

function close() {
  clearInterval(googleQueueInterval)
  clearTimeout(initialGoogleQueueRun)
  userSessionBroker.close()
  server.close(() => {
    store.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
