import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const DASHBOARD_PURPOSE = 'dashboard'
const SENSITIVE_PURPOSE = 'sensitive'

function iso(milliseconds) {
  return new Date(milliseconds).toISOString()
}

function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left))
  const second = Buffer.from(String(right))
  return first.length === second.length && timingSafeEqual(first, second)
}

export function createParentAuthorization(options = {}) {
  const now = options.now ?? (() => Date.now())
  const makeSecret = options.makeSecret ?? (() => randomBytes(32).toString('base64url'))
  const challengeTtlMs = options.challengeTtlMs ?? 2 * 60_000
  const sessionTtlMs = options.sessionTtlMs ?? 10 * 60_000
  const sensitiveTtlMs = options.sensitiveTtlMs ?? 2 * 60_000
  const challenges = new Map()
  const sessions = new Map()

  function cleanup() {
    const current = now()
    for (const [id, challenge] of challenges) {
      if (challenge.expiresAtMs <= current || challenge.consumed) challenges.delete(id)
    }
    for (const [tokenHash, session] of sessions) {
      if (session.expiresAtMs <= current || session.revoked) sessions.delete(tokenHash)
    }
  }

  function publicChallenge(challenge) {
    return {
      id: challenge.id,
      purpose: challenge.purpose,
      purposeLabel: challenge.purpose === SENSITIVE_PURPOSE
        ? 'Approve a sensitive parent action'
        : 'Open Parent controls',
      status: challenge.status,
      requestedAt: iso(challenge.requestedAtMs),
      expiresAt: iso(challenge.expiresAtMs),
      ...(challenge.approvedAtMs ? { approvedAt: iso(challenge.approvedAtMs) } : {}),
    }
  }

  function createChallenge(purpose = DASHBOARD_PURPOSE) {
    cleanup()
    if (![DASHBOARD_PURPOSE, SENSITIVE_PURPOSE].includes(purpose)) {
      throw new Error('Unsupported parent authorization purpose')
    }
    for (const challenge of challenges.values()) {
      if (challenge.status === 'pending') challenge.status = 'cancelled'
    }
    const createdAt = now()
    const challenge = {
      id: makeSecret(),
      purpose,
      status: 'pending',
      requestedAtMs: createdAt,
      expiresAtMs: createdAt + challengeTtlMs,
      approvedAtMs: null,
      consumed: false,
    }
    challenges.set(challenge.id, challenge)
    return publicChallenge(challenge)
  }

  function getChallenge(id) {
    cleanup()
    const challenge = challenges.get(String(id))
    if (!challenge) return null
    return publicChallenge(challenge)
  }

  function pendingChallenge() {
    cleanup()
    const pending = [...challenges.values()]
      .filter((challenge) => challenge.status === 'pending')
      .sort((a, b) => a.requestedAtMs - b.requestedAtMs)[0]
    return pending ? publicChallenge(pending) : null
  }

  function resolveChallenge(id, approved) {
    cleanup()
    const challenge = challenges.get(String(id))
    if (!challenge || challenge.status !== 'pending') return null
    challenge.status = approved ? 'approved' : 'denied'
    if (approved) challenge.approvedAtMs = now()
    return publicChallenge(challenge)
  }

  function consumeChallenge(id) {
    cleanup()
    const challenge = challenges.get(String(id))
    if (!challenge) return { status: 'expired' }
    if (challenge.status !== 'approved') return { status: challenge.status, challenge: publicChallenge(challenge) }
    if (challenge.consumed) return { status: 'expired' }

    challenge.consumed = true
    const issuedAtMs = now()
    const token = makeSecret()
    const session = {
      purpose: challenge.purpose,
      issuedAtMs,
      expiresAtMs: issuedAtMs + sessionTtlMs,
      sensitiveUntilMs: issuedAtMs + sensitiveTtlMs,
      revoked: false,
    }
    sessions.set(hashToken(token), session)
    return { status: 'approved', token, session: publicSession(session) }
  }

  function publicSession(session) {
    return {
      authenticated: true,
      purpose: session.purpose,
      issuedAt: iso(session.issuedAtMs),
      expiresAt: iso(session.expiresAtMs),
      sensitiveUntil: iso(session.sensitiveUntilMs),
    }
  }

  function validateSession(token, options = {}) {
    if (!token) return { valid: false, code: 'parent_authorization_required' }
    const tokenHash = hashToken(token)
    const session = sessions.get(tokenHash)
    if (!session || session.revoked) {
      cleanup()
      return { valid: false, code: 'parent_authorization_required' }
    }
    if (session.expiresAtMs <= now()) {
      sessions.delete(tokenHash)
      return { valid: false, code: 'parent_session_expired' }
    }
    if (options.sensitive && (
      session.purpose !== SENSITIVE_PURPOSE || session.sensitiveUntilMs <= now()
    )) {
      return { valid: false, code: 'parent_reauthentication_required', session: publicSession(session) }
    }
    return { valid: true, session: publicSession(session) }
  }

  function revokeSession(token) {
    if (!token) return false
    const tokenHash = hashToken(token)
    const session = sessions.get(tokenHash)
    if (!session) return false
    session.revoked = true
    sessions.delete(tokenHash)
    return true
  }

  return {
    createChallenge,
    getChallenge,
    pendingChallenge,
    approveChallenge: (id) => resolveChallenge(id, true),
    denyChallenge: (id) => resolveChallenge(id, false),
    consumeChallenge,
    validateSession,
    revokeSession,
    safeEqual,
  }
}
