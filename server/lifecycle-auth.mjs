import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const LIFECYCLE_ASSERTION_VERSION = 1
export const LIFECYCLE_ASSERTION_TTL_MS = 15_000

function asMilliseconds(value) {
  if (value == null) return null
  const milliseconds = Date.parse(String(value))
  if (!Number.isSafeInteger(milliseconds)) throw new Error('Lifecycle timestamp is invalid')
  return milliseconds
}

function assertionFor(lifecycle, issuedAtMs) {
  const session = lifecycle.session
  const proof = session?.completionProof
  return {
    version: LIFECYCLE_ASSERTION_VERSION,
    issuedAtMilliseconds: issuedAtMs,
    expiresAtMilliseconds: issuedAtMs + LIFECYCLE_ASSERTION_TTL_MS,
    mode: lifecycle.mode,
    serviceSessionId: session?.serviceSessionId ?? null,
    weekId: session?.weekId ?? null,
    day: session?.day ?? null,
    eligibleAtMilliseconds: asMilliseconds(proof?.eligibleAt),
    requiredCompleted: proof?.requiredCompleted ?? null,
    requiredTarget: proof?.requiredTarget ?? null,
    optionalCompleted: proof?.optionalCompleted ?? null,
    optionalTarget: proof?.optionalTarget ?? null,
  }
}

function assertKey(key) {
  const bytes = Buffer.from(key)
  if (bytes.length !== 32) throw new Error('Guardian lifecycle authentication requires a 32-byte key')
  return bytes
}

export function createLifecycleAuthenticator(options = {}) {
  const key = options.key ? assertKey(options.key) : null
  const now = options.now ?? (() => new Date())
  const required = options.required === true
  if (required && !key) throw new Error('Guardian lifecycle authentication is required')

  return {
    configured: Boolean(key),
    authenticate(lifecycle) {
      if (!key) return { ...lifecycle, authentication: null }
      const issuedAtMs = now().getTime()
      if (!Number.isSafeInteger(issuedAtMs)) throw new Error('Lifecycle signing clock is invalid')
      const assertion = Buffer.from(JSON.stringify(assertionFor(lifecycle, issuedAtMs)), 'utf8')
      const authenticationTag = createHmac('sha256', key).update(assertion).digest()
      return {
        ...lifecycle,
        authentication: {
          scheme: 'hmac-sha256',
          assertion: assertion.toString('base64url'),
          authenticationTag: authenticationTag.toString('base64url'),
        },
      }
    },
    verify(assertion, authenticationTag) {
      if (!key) return false
      const assertionBytes = Buffer.from(String(assertion), 'base64url')
      const suppliedTag = Buffer.from(String(authenticationTag), 'base64url')
      const expectedTag = createHmac('sha256', key).update(assertionBytes).digest()
      return suppliedTag.length === expectedTag.length && timingSafeEqual(suppliedTag, expectedTag)
    },
  }
}

export function createLifecycleAuthenticatorFromEnvironment(environment = process.env) {
  const keyFile = String(environment.HOMEWORK_LIFECYCLE_KEY_FILE ?? '').trim()
  const required = environment.HOMEWORK_REQUIRE_ROOT_OWNERSHIP === '1'
  const key = keyFile ? readFileSync(keyFile) : null
  return createLifecycleAuthenticator({ key, required })
}
