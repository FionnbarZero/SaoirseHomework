import assert from 'node:assert/strict'
import test from 'node:test'
import { createParentAuthorization } from '../server/parent-auth.mjs'

function fixture() {
  let time = Date.parse('2026-10-03T16:00:00.000Z')
  let sequence = 0
  const authorization = createParentAuthorization({
    now: () => time,
    makeSecret: () => `secret-${++sequence}`,
  })
  return { authorization, advance: (milliseconds) => { time += milliseconds } }
}

test('a guardian-approved challenge creates a short-lived parent session', () => {
  const { authorization } = fixture()
  const challenge = authorization.createChallenge('dashboard')
  assert.equal(authorization.pendingChallenge().id, challenge.id)
  assert.equal(authorization.approveChallenge(challenge.id).status, 'approved')

  const result = authorization.consumeChallenge(challenge.id)
  assert.equal(result.status, 'approved')
  assert.equal(result.session.authenticated, true)
  assert.equal(authorization.validateSession(result.token).valid, true)
  assert.equal(authorization.consumeChallenge(challenge.id).status, 'expired')
})

test('expired and denied challenges never issue a session', () => {
  const first = fixture()
  const expired = first.authorization.createChallenge('dashboard')
  first.advance(2 * 60_000)
  assert.equal(first.authorization.approveChallenge(expired.id), null)
  assert.equal(first.authorization.consumeChallenge(expired.id).status, 'expired')

  const second = fixture()
  const denied = second.authorization.createChallenge('dashboard')
  second.authorization.denyChallenge(denied.id)
  assert.equal(second.authorization.consumeChallenge(denied.id).status, 'denied')
})

test('sensitive authorization expires before the dashboard session', () => {
  const { authorization, advance } = fixture()
  const challenge = authorization.createChallenge('sensitive')
  authorization.approveChallenge(challenge.id)
  const { token } = authorization.consumeChallenge(challenge.id)

  advance(2 * 60_000)
  assert.equal(authorization.validateSession(token).valid, true)
  assert.equal(
    authorization.validateSession(token, { sensitive: true }).code,
    'parent_reauthentication_required',
  )
  advance(8 * 60_000)
  assert.equal(authorization.validateSession(token).code, 'parent_session_expired')
})

test('a dashboard unlock cannot authorize a sensitive action', () => {
  const { authorization } = fixture()
  const challenge = authorization.createChallenge('dashboard')
  authorization.approveChallenge(challenge.id)
  const { token } = authorization.consumeChallenge(challenge.id)
  assert.equal(authorization.validateSession(token).valid, true)
  assert.equal(
    authorization.validateSession(token, { sensitive: true }).code,
    'parent_reauthentication_required',
  )
})

test('revocation invalidates a session and secret comparison is constant-shape', () => {
  const { authorization } = fixture()
  const challenge = authorization.createChallenge()
  authorization.approveChallenge(challenge.id)
  const { token } = authorization.consumeChallenge(challenge.id)
  assert.equal(authorization.revokeSession(token), true)
  assert.equal(authorization.validateSession(token).valid, false)
  assert.equal(authorization.safeEqual('same', 'same'), true)
  assert.equal(authorization.safeEqual('same', 'different'), false)
})
