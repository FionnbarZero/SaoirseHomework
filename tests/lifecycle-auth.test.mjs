import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIFECYCLE_ASSERTION_TTL_MS,
  createLifecycleAuthenticator,
} from '../server/lifecycle-auth.mjs'

const key = Buffer.alloc(32, 0x5a)
const now = new Date('2026-10-05T16:00:00.000Z')

function freeLifecycle() {
  return {
    mode: 'free',
    session: {
      serviceSessionId: '11111111-2222-4333-8444-555555555555',
      weekId: '2026-10-05',
      day: 'Monday',
      status: 'completion-eligible',
      startedAt: '2026-10-05T15:00:00.000Z',
      completionProof: {
        serviceSessionId: '11111111-2222-4333-8444-555555555555',
        weekId: '2026-10-05',
        day: 'Monday',
        eligibleAt: '2026-10-05T15:59:00.000Z',
        requiredCompleted: 5,
        requiredTarget: 5,
        optionalCompleted: 3,
        optionalTarget: 3,
      },
    },
    serviceTime: now.toISOString(),
  }
}

test('root lifecycle authenticator signs a short-lived opaque assertion', () => {
  const authenticator = createLifecycleAuthenticator({ key, now: () => now })
  const signed = authenticator.authenticate(freeLifecycle())
  assert.equal(signed.authentication.scheme, 'hmac-sha256')
  assert.equal(authenticator.verify(
    signed.authentication.assertion,
    signed.authentication.authenticationTag,
  ), true)

  const assertion = JSON.parse(Buffer.from(signed.authentication.assertion, 'base64url'))
  assert.deepEqual(assertion, {
    version: 1,
    issuedAtMilliseconds: now.getTime(),
    expiresAtMilliseconds: now.getTime() + LIFECYCLE_ASSERTION_TTL_MS,
    mode: 'free',
    serviceSessionId: '11111111-2222-4333-8444-555555555555',
    weekId: '2026-10-05',
    day: 'Monday',
    eligibleAtMilliseconds: Date.parse('2026-10-05T15:59:00.000Z'),
    requiredCompleted: 5,
    requiredTarget: 5,
    optionalCompleted: 3,
    optionalTarget: 3,
  })
})

test('lifecycle authentication rejects a changed assertion or tag', () => {
  const authenticator = createLifecycleAuthenticator({ key, now: () => now })
  const signed = authenticator.authenticate(freeLifecycle())
  const assertion = Buffer.from(signed.authentication.assertion, 'base64url')
  assertion[assertion.length - 2] ^= 1
  assert.equal(authenticator.verify(
    assertion.toString('base64url'),
    signed.authentication.authenticationTag,
  ), false)

  const tag = Buffer.from(signed.authentication.authenticationTag, 'base64url')
  tag[0] ^= 1
  assert.equal(authenticator.verify(
    signed.authentication.assertion,
    tag.toString('base64url'),
  ), false)
})

test('development can omit lifecycle authentication but protected mode cannot', () => {
  const development = createLifecycleAuthenticator()
  assert.equal(development.authenticate({ mode: 'inactive', session: null }).authentication, null)
  assert.throws(
    () => createLifecycleAuthenticator({ required: true }),
    /authentication is required/,
  )
  assert.throws(
    () => createLifecycleAuthenticator({ key: Buffer.alloc(31) }),
    /32-byte key/,
  )
})
