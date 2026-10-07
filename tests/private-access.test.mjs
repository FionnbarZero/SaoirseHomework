import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPair, SignJWT } from 'jose'
import { createPrivateAccess } from '../server/private-access.mjs'

test('Google IAP validates signed identity and assigns the parent role only to the configured parent', async () => {
  const pair = await generateKeyPair('ES256')
  const settings = {
    HOMEWORK_DEPLOYMENT_MODE: 'google-iap',
    HOMEWORK_PUBLIC_ORIGIN: 'https://homework.example.com',
    HOMEWORK_ACCESS_AUDIENCE: '/projects/123/locations/us-west1/services/homework',
    HOMEWORK_ACCESS_EMAILS: 'parent@example.com,child@example.com',
    HOMEWORK_PARENT_EMAILS: 'parent@example.com',
  }
  const gate = createPrivateAccess({ env: settings, keys: pair.publicKey })
  const token = (email, overrides = {}) => new SignJWT({ email, ...overrides })
    .setProtectedHeader({ alg: 'ES256' }).setIssuer('https://cloud.google.com/iap')
    .setAudience(settings.HOMEWORK_ACCESS_AUDIENCE).setSubject('google-user').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey)
  const req = jwt => ({ method: 'GET', headers: { host: 'homework.example.com', 'x-goog-iap-jwt-assertion': jwt } })
  assert.equal((await gate.authenticate(req(await token('parent@example.com')))).role, 'parent')
  assert.equal((await gate.authenticate(req(await token('child@example.com')))).role, 'child')
  await assert.rejects(gate.authenticate(req(await token('outsider@example.com'))), { status: 403 })
  await assert.rejects(gate.authenticate({ method: 'GET', headers: { host: 'homework.example.com', 'x-goog-authenticated-user-email': 'accounts.google.com:parent@example.com' } }), { status: 401 })
  const wrongAudience = await new SignJWT({email:'parent@example.com'}).setProtectedHeader({alg:'ES256'}).setIssuer('https://cloud.google.com/iap').setAudience('other-service').setSubject('user').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey)
  await assert.rejects(gate.authenticate(req(wrongAudience)), { status: 401 })
  await assert.rejects(gate.authenticate({ ...req(await token('parent@example.com')), method: 'POST' }), { status: 403 })
  assert.throws(() => createPrivateAccess({ env: { ...settings, HOMEWORK_PARENT_EMAILS: '' } }))
})

const { publicKey, privateKey } = await generateKeyPair('RS256')
const env = {
  HOMEWORK_DEPLOYMENT_MODE: 'private-cloud',
  HOMEWORK_PUBLIC_ORIGIN: 'https://homework.example.com',
  HOMEWORK_ACCESS_TEAM_ORIGIN: 'https://family.cloudflareaccess.com',
  HOMEWORK_ACCESS_AUDIENCE: 'homework-app',
  HOMEWORK_ACCESS_EMAILS: 'parent@example.com,child@example.com',
}
const currentDate = new Date('2026-10-05T12:00:00Z')
const now = currentDate.getTime() / 1000
const gate = createPrivateAccess({ env, keys: publicKey, currentDate })
const signed = (claims = {}, key = privateKey) => new SignJWT({
  email: 'parent@example.com', sub: 'user-id', iss: env.HOMEWORK_ACCESS_TEAM_ORIGIN,
  aud: [env.HOMEWORK_ACCESS_AUDIENCE], iat: now - 30, exp: now + 300, ...claims,
}).setProtectedHeader({ alg: 'RS256' }).sign(key)
const request = (token, extra = {}) => ({ method: 'GET', ...extra, headers: {
  host: 'homework.example.com', 'cf-access-jwt-assertion': token, ...extra.headers,
} })

test('local mode is unchanged while cloud mode requires complete explicit configuration', async () => {
  assert.equal(await createPrivateAccess({ env: {} }).authenticate({}), null)
  for (const key of Object.keys(env).filter(key => key !== 'HOMEWORK_DEPLOYMENT_MODE')) {
    assert.throws(() => createPrivateAccess({ env: { ...env, [key]: '' } }))
  }
  assert.throws(() => createPrivateAccess({ env: { ...env, HOMEWORK_ACCESS_TEAM_ORIGIN: 'https://attacker.example.com' } }))
  assert.throws(() => createPrivateAccess({ env: { ...env, HOMEWORK_DEPLOYMENT_MODE: 'typo' } }))
})

test('only signed members of the exact allowlist can access the private app', async () => {
  assert.equal((await gate.authenticate(request(await signed()))).email, 'parent@example.com')
  assert.equal((await gate.authenticate(request(await signed({ email: 'Child@Example.com' })))).email, 'child@example.com')
  await assert.rejects(gate.authenticate(request(await signed({ email: 'outsider@example.com' }))), { status: 403 })
  await assert.rejects(gate.authenticate(request(undefined, { headers: { 'cf-access-authenticated-user-email': 'parent@example.com' } })), { status: 401 })
})

test('wrong signatures, issuer, audience, expired, future, and incomplete tokens fail closed', async () => {
  for (const claims of [
    { iss: 'https://other.cloudflareaccess.com' }, { aud: ['different-app'] },
    { exp: now - 10 }, { iat: now + 90 }, { email: undefined }, { exp: undefined },
    { sub: undefined }, { nbf: now + 90 },
  ]) await assert.rejects(gate.authenticate(request(await signed(claims))), { status: 401 })
  const other = await generateKeyPair('RS256')
  await assert.rejects(gate.authenticate(request(await signed({}, other.privateKey))), { status: 401 })
  await assert.rejects(gate.authenticate(request('not-a-token')), { status: 401 })
})

test('writes require the intended website origin and cannot bypass the configured hostname', async () => {
  const token = await signed()
  for (const origin of [undefined, 'null', 'https://evil.example.com']) {
    await assert.rejects(gate.authenticate(request(token, { method: 'PUT', headers: { origin } })), { status: 403 })
  }
  assert.ok(await gate.authenticate(request(token, { method: 'POST', headers: { origin: env.HOMEWORK_PUBLIC_ORIGIN } })))
  await assert.rejects(gate.authenticate(request(token, { headers: { host: '127.0.0.1:4179' } })), { status: 403 })
})

test('unavailable signing-key validation never falls back to trusting identity headers', async () => {
  const offline = createPrivateAccess({ env, currentDate, keys: async () => { throw new Error('Key service unavailable') } })
  await assert.rejects(offline.authenticate(request(await signed())), { status: 401 })
})
