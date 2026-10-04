import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { createLifecycleAuthenticator } from '../server/lifecycle-auth.mjs'
import { createUserSessionBroker } from '../server/user-session-broker.mjs'

const key = Buffer.alloc(32, 19)

function envelope(claim, signingKey = key) {
  const assertion = Buffer.from(JSON.stringify(claim))
  return {
    assertion: assertion.toString('base64url'),
    authenticationTag: createHmac('sha256', signingKey).update(assertion).digest('base64url'),
  }
}

function accessClaim(now) {
  return {
    version: 1,
    type: 'agent-access',
    issuedAtMilliseconds: now,
    expiresAtMilliseconds: now + 15_000,
    subject: 'guardian-agent',
    audience: 'homework-service',
    permissions: ['broker.read', 'broker.complete'],
    nonce: '01234567-89ab-4def-8123-456789abcdef',
  }
}

test('root service accepts only fresh daemon-signed agent broker grants', () => {
  const current = 1_800_000_000_000
  const broker = createUserSessionBroker({
    authenticator: createLifecycleAuthenticator({ key }),
    required: true,
    now: () => current,
  })
  const valid = envelope(accessClaim(current))
  assert.equal(
    broker.authenticateAccess(`Bearer ${valid.assertion}.${valid.authenticationTag}`).subject,
    'guardian-agent',
  )
  assert.throws(
    () => broker.authenticateAccess(`Bearer ${valid.assertion}.${valid.authenticationTag}`),
    (error) => error.code === 'user_broker_replay_denied',
  )

  const forged = envelope(accessClaim(current), Buffer.alloc(32, 20))
  assert.throws(
    () => broker.authenticateAccess(`Bearer ${forged.assertion}.${forged.authenticationTag}`),
    (error) => error.code === 'user_broker_authentication_denied',
  )
  const expired = envelope({
    ...accessClaim(current - 60_000),
    expiresAtMilliseconds: current - 45_000,
  })
  assert.throws(
    () => broker.authenticateAccess(`Bearer ${expired.assertion}.${expired.authenticationTag}`),
    (error) => error.code === 'user_broker_authentication_denied',
  )
})

test('native Parent decisions are bound to the exact challenge and purpose', () => {
  const current = 1_800_000_000_000
  const broker = createUserSessionBroker({
    authenticator: createLifecycleAuthenticator({ key }),
    required: true,
    now: () => current,
  })
  const authentication = envelope({
    version: 1,
    type: 'parent-authorization',
    issuedAtMilliseconds: current,
    expiresAtMilliseconds: current + 15_000,
    challengeId: 'challenge-1234567890',
    purpose: 'sensitive',
    approved: true,
  })
  assert.equal(broker.authenticateParentDecision(authentication, {
    id: 'challenge-1234567890',
    purpose: 'sensitive',
  }).approved, true)
  assert.throws(
    () => broker.authenticateParentDecision(authentication, {
      id: 'different-challenge',
      purpose: 'sensitive',
    }),
    (error) => error.code === 'parent_authorization_mismatch',
  )
})

test('Google credential work crosses the broker as one bounded request and response', async () => {
  const current = 1_800_000_000_000
  const broker = createUserSessionBroker({
    authenticator: createLifecycleAuthenticator({ key }),
    required: true,
    now: () => current,
    makeId: () => 'operation-1',
  })
  const pending = broker.googleCredentials.accessToken({ clientId: 'desktop-client' })
  assert.deepEqual(broker.nextOperation(), {
    id: 'operation-1',
    kind: 'google_access_token',
    payload: { clientId: 'desktop-client' },
    requestedAt: new Date(current).toISOString(),
    expiresAt: new Date(current + 45_000).toISOString(),
  })
  assert.deepEqual(broker.completeOperation('operation-1', {
    success: true,
    result: { accessToken: 'short-lived-token', expiresAt: new Date(current + 3_600_000).toISOString() },
  }), { completed: true })
  assert.equal((await pending).accessToken, 'short-lived-token')
})
