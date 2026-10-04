import { randomUUID, timingSafeEqual } from 'node:crypto'

export const USER_BROKER_ASSERTION_VERSION = 1
export const USER_BROKER_MAXIMUM_ASSERTION_LIFETIME_MS = 30_000
export const USER_BROKER_OPERATION_TIMEOUT_MS = 45_000

const allowedOperationKinds = new Set([
  'google_begin_authorization',
  'google_complete_authorization',
  'google_access_token',
  'google_disconnect',
])

function brokerError(message, code, status = 503) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

function decodeBase64Url(value, maximumBytes) {
  const encoded = String(value ?? '')
  if (!encoded || encoded.length > maximumBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw brokerError('The user-session broker assertion is malformed', 'user_broker_authentication_denied', 401)
  }
  const decoded = Buffer.from(encoded, 'base64url')
  if (!decoded.length || decoded.length > maximumBytes || decoded.toString('base64url') !== encoded) {
    throw brokerError('The user-session broker assertion is malformed', 'user_broker_authentication_denied', 401)
  }
  return decoded
}

function parseEnvelope(envelope) {
  if (typeof envelope === 'string') {
    const pieces = envelope.split('.')
    if (pieces.length !== 2) {
      throw brokerError('The user-session broker credential is malformed', 'user_broker_authentication_denied', 401)
    }
    return { assertion: pieces[0], authenticationTag: pieces[1] }
  }
  return {
    assertion: String(envelope?.assertion ?? ''),
    authenticationTag: String(envelope?.authenticationTag ?? ''),
  }
}

function constantStringEqual(left, right) {
  const first = Buffer.from(String(left))
  const second = Buffer.from(String(right))
  return first.length === second.length && timingSafeEqual(first, second)
}

function publicOperation(operation) {
  return {
    id: operation.id,
    kind: operation.kind,
    payload: operation.payload,
    requestedAt: new Date(operation.requestedAtMs).toISOString(),
    expiresAt: new Date(operation.expiresAtMs).toISOString(),
  }
}

export function createUserSessionBroker(options = {}) {
  const authenticator = options.authenticator
  const configured = options.required === true && authenticator?.configured === true
  const now = options.now ?? (() => Date.now())
  const makeId = options.makeId ?? (() => randomUUID())
  const operationTimeoutMs = options.operationTimeoutMs ?? USER_BROKER_OPERATION_TIMEOUT_MS
  const operations = new Map()
  const seenAccessNonces = new Map()

  function verifyEnvelope(envelope, expectedType) {
    if (!configured) {
      throw brokerError('The signed user-session broker is unavailable', 'user_broker_unavailable')
    }
    const parsed = parseEnvelope(envelope)
    const assertion = decodeBase64Url(parsed.assertion, 8_192)
    const tag = decodeBase64Url(parsed.authenticationTag, 64)
    if (tag.length !== 32 || !authenticator.verify(parsed.assertion, parsed.authenticationTag)) {
      throw brokerError('The user-session broker credential could not be authenticated', 'user_broker_authentication_denied', 401)
    }
    let claim
    try {
      claim = JSON.parse(assertion.toString('utf8'))
    } catch {
      throw brokerError('The user-session broker assertion is malformed', 'user_broker_authentication_denied', 401)
    }
    const current = now()
    const lifetime = claim.expiresAtMilliseconds - claim.issuedAtMilliseconds
    if (claim.version !== USER_BROKER_ASSERTION_VERSION ||
        claim.type !== expectedType ||
        !Number.isSafeInteger(claim.issuedAtMilliseconds) ||
        !Number.isSafeInteger(claim.expiresAtMilliseconds) ||
        claim.issuedAtMilliseconds > current + 5_000 ||
        claim.expiresAtMilliseconds < current ||
        lifetime < 1 || lifetime > USER_BROKER_MAXIMUM_ASSERTION_LIFETIME_MS) {
      throw brokerError('The user-session broker assertion has expired or is invalid', 'user_broker_authentication_denied', 401)
    }
    return claim
  }

  function authenticateAccess(authorizationHeader) {
    const header = String(authorizationHeader ?? '')
    if (!header.startsWith('Bearer ')) {
      throw brokerError('A signed user-session broker credential is required', 'user_broker_authentication_required', 401)
    }
    const claim = verifyEnvelope(header.slice(7), 'agent-access')
    if (claim.subject !== 'guardian-agent' ||
        claim.audience !== 'homework-service' ||
        !Array.isArray(claim.permissions) ||
        !claim.permissions.includes('broker.read') ||
        !claim.permissions.includes('broker.complete') ||
        typeof claim.nonce !== 'string' || claim.nonce.length < 16) {
      throw brokerError('The user-session broker credential has the wrong scope', 'user_broker_authentication_denied', 403)
    }
    for (const [nonce, expiresAt] of seenAccessNonces) {
      if (expiresAt < now()) seenAccessNonces.delete(nonce)
    }
    if (seenAccessNonces.has(claim.nonce)) {
      throw brokerError('The user-session broker credential was already used', 'user_broker_replay_denied', 401)
    }
    seenAccessNonces.set(claim.nonce, claim.expiresAtMilliseconds)
    return claim
  }

  function authenticateParentDecision(envelope, challenge) {
    const claim = verifyEnvelope(envelope, 'parent-authorization')
    if (!constantStringEqual(claim.challengeId, challenge.id) ||
        claim.purpose !== challenge.purpose ||
        typeof claim.approved !== 'boolean') {
      throw brokerError('The native authorization does not match this Parent request', 'parent_authorization_mismatch', 403)
    }
    return claim
  }

  function cleanup() {
    const current = now()
    for (const [id, operation] of operations) {
      if (operation.expiresAtMs <= current) {
        operations.delete(id)
        operation.reject(brokerError(
          'The signed user-session component did not answer in time',
          'user_broker_timed_out',
          504,
        ))
      }
    }
  }

  function request(kind, payload = {}) {
    if (!configured) {
      return Promise.reject(brokerError(
        'Google credentials require the signed user-session component',
        'user_broker_unavailable',
      ))
    }
    if (!allowedOperationKinds.has(kind)) {
      return Promise.reject(brokerError('Unsupported user-session operation', 'user_broker_invalid_operation', 400))
    }
    cleanup()
    const id = makeId()
    const requestedAtMs = now()
    return new Promise((resolve, reject) => {
      const operation = {
        id,
        kind,
        payload,
        requestedAtMs,
        expiresAtMs: requestedAtMs + operationTimeoutMs,
        claimedAtMs: null,
        resolve,
        reject,
      }
      operations.set(id, operation)
      const timer = setTimeout(() => cleanup(), operationTimeoutMs + 10)
      timer.unref?.()
    })
  }

  function nextOperation() {
    cleanup()
    const current = now()
    const operation = [...operations.values()]
      .filter((item) => item.claimedAtMs == null || current - item.claimedAtMs > 10_000)
      .sort((left, right) => left.requestedAtMs - right.requestedAtMs)[0]
    if (!operation) return null
    operation.claimedAtMs = current
    return publicOperation(operation)
  }

  function completeOperation(id, result) {
    cleanup()
    const operation = operations.get(String(id))
    if (!operation) {
      throw brokerError('The user-session operation expired or was already completed', 'user_broker_operation_expired', 404)
    }
    operations.delete(operation.id)
    if (result?.success === true) {
      operation.resolve(result.result ?? {})
    } else {
      operation.reject(brokerError(
        String(result?.error ?? 'The signed user-session operation failed').slice(0, 1_000),
        String(result?.code ?? 'user_broker_operation_failed').slice(0, 120),
        502,
      ))
    }
    return { completed: true }
  }

  function close() {
    for (const operation of operations.values()) {
      operation.reject(brokerError('The homework service is stopping', 'user_broker_stopped'))
    }
    operations.clear()
    seenAccessNonces.clear()
  }

  const googleCredentials = {
    available: configured,
    beginAuthorization(input) {
      return request('google_begin_authorization', input)
    },
    completeAuthorization(input) {
      return request('google_complete_authorization', input)
    },
    accessToken(input) {
      return request('google_access_token', input)
    },
    disconnect(input) {
      return request('google_disconnect', input)
    },
  }

  return {
    configured,
    googleCredentials,
    authenticateAccess,
    authenticateParentDecision,
    nextOperation,
    completeOperation,
    request,
    close,
  }
}
