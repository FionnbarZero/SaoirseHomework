import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../server/database.mjs'
import {
  GOOGLE_SCOPES,
  buildGmailRawMessage,
  buildGoogleAuthorizationUrl,
  buildWeeklyDocumentText,
  createGoogleLiveIntegration,
  createPkcePair,
  isFridayDeliveryDue,
  schoolYearForWeek,
} from '../server/google-live.mjs'
import { createMacOSKeychain } from '../server/keychain.mjs'

test('Google authorization uses PKCE, offline access, and only the planned scopes', () => {
  const pair = createPkcePair((size) => Buffer.alloc(size, 7))
  assert.ok(pair.verifier.length >= 43 && pair.verifier.length <= 128)
  assert.equal(pair.challenge.length, 43)
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId: 'desktop-client-id',
    redirectUri: 'http://127.0.0.1:4179',
    state: 'csrf-state',
    challenge: pair.challenge,
  }))
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.deepEqual(url.searchParams.get('scope').split(' '), GOOGLE_SCOPES)
})

test('weekly document and Gmail MIME preserve the writing and PDF attachment', () => {
  const delivery = {
    weekId: '2026-09-28',
    documentName: 'Fionnbar Writing — Week of 2026-09-28',
  }
  const drafts = [{
    title: 'The Adventure',
    body: 'the original',
    correctedBody: 'The original.',
    findings: [{ id: 'one' }],
    exerciseProgress: { one: { correctionComplete: true, practiceCompleted: 5 } },
    updatedAt: '2026-10-02T20:00:00.000Z',
  }]
  const text = buildWeeklyDocumentText(delivery, drafts)
  assert.match(text, /Original\nthe original/)
  assert.match(text, /Corrected copy\nThe original\./)
  assert.match(text, /6 of 6 grammar, punctuation, and capitalization steps completed/)
  assert.match(text, /No supported common misspellings were detected/)
  assert.equal(schoolYearForWeek('2026-09-28'), '2026-2027')

  const raw = buildGmailRawMessage({
    from: 'fionnbar@example.com',
    to: 'teacher@school.org',
    subject: delivery.documentName,
    text: 'The PDF is attached.',
    pdf: Buffer.from('%PDF-test'),
    filename: 'writing.pdf',
    messageId: 'stable-message@homework.local',
  })
  const mime = Buffer.from(raw, 'base64url').toString('utf8')
  assert.match(mime, /To: teacher@school\.org/)
  assert.match(mime, /Message-ID: <stable-message@homework\.local>/)
  assert.match(mime, /Content-Type: application\/pdf/)
  assert.match(mime, new RegExp(Buffer.from('%PDF-test').toString('base64')))
})

test('Friday delivery gate follows the configured school time zone', () => {
  assert.equal(isFridayDeliveryDue('2026-10-02T22:59:00.000Z', 'America/Los_Angeles'), false)
  assert.equal(isFridayDeliveryDue('2026-10-02T23:00:00.000Z', 'America/Los_Angeles'), true)
  assert.equal(isFridayDeliveryDue('2026-10-03T01:00:00.000Z', 'America/Los_Angeles'), true)
  assert.equal(isFridayDeliveryDue('2026-10-03T08:00:00.000Z', 'America/Los_Angeles'), false)
})

test('Keychain adapter reads, writes, and deletes only the dedicated generic password', async () => {
  const calls = []
  const keychain = createMacOSKeychain({
    platform: 'darwin',
    execFile: async (command, args) => {
      calls.push({ command, args })
      return { stdout: args[0] === 'find-generic-password' ? 'refresh-token\n' : '' }
    },
  })
  await keychain.setRefreshToken('refresh-token')
  assert.equal(await keychain.getRefreshToken(), 'refresh-token')
  await keychain.deleteRefreshToken()
  assert.deepEqual(calls.map((call) => call.args[0]), [
    'add-generic-password',
    'find-generic-password',
    'delete-generic-password',
  ])
  assert.ok(calls.every((call) => call.command === '/usr/bin/security'))
})

test('live delivery creates Drive hierarchy and still emails PDF when sharing fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-google-live-'))
  const store = createStore(':memory:', {
    wallNow: () => new Date('2026-10-02T23:00:00.000Z'),
    makeId: () => 'delivery-1',
    googleLiveConfiguration: { mode: 'live', clientConfigured: true, keychainAvailable: true },
  })
  let refreshToken = null
  const keychain = {
    available: true,
    async setRefreshToken(value) { refreshToken = value },
    async getRefreshToken() { return refreshToken },
    async deleteRefreshToken() { refreshToken = null },
  }
  const requests = []
  let folder = 0
  const fakeFetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
    if (url.includes('/userinfo')) return Response.json({ email: 'fionnbar@example.com' })
    if (url.includes('/drive/v3/files?') && (!init.method || init.method === 'GET')) return Response.json({ files: [] })
    if (url.includes('/drive/v3/files?fields=') && init.method === 'POST') {
      const body = JSON.parse(init.body)
      if (body.mimeType === 'application/vnd.google-apps.folder') return Response.json({ id: `folder-${++folder}` })
      return Response.json({ id: 'doc-1', webViewLink: 'https://docs.google.com/document/d/doc-1/edit' })
    }
    if (url.includes('docs.googleapis.com')) return Response.json({ replies: [{}] })
    if (url.includes('/export?')) return new Response(Buffer.from('%PDF-live-proof'), { headers: { 'Content-Type': 'application/pdf' } })
    if (url.includes('/permissions?')) return Response.json({ error: { message: 'school sharing blocked' } }, { status: 403 })
    if (url.includes('gmail.googleapis.com')) return Response.json({ id: 'gmail-message-1' })
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    store.saveState({
      entered: true,
      requiredByDay: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
      optionalCompleted: [],
      rewardCredits: [],
      drafts: [{
        id: 'draft-1', title: 'Friday story', body: 'Original story.', correctedBody: 'Corrected story.',
        updatedAt: '2026-10-02T20:00:00.000Z', findings: [], exerciseProgress: {}, reviewStatus: 'complete',
      }],
      writingDictionary: { knownNames: ['Fionnbar'], knownPlaces: [] },
      writingReviewQueue: [],
      activeTimer: null,
    })
    const integration = createGoogleLiveIntegration({
      store,
      keychain,
      clientId: 'desktop-client-id',
      redirectUri: 'http://127.0.0.1:4179',
      outputDirectory: directory,
      mode: 'live',
      fetch: fakeFetch,
      now: () => new Date('2026-10-02T23:00:00.000Z'),
    })
    const authorization = await integration.beginAuthorization()
    const state = new URL(authorization.authorizationUrl).searchParams.get('state')
    await integration.completeAuthorization({ state, code: 'authorization-code' })
    store.configureLiveGoogle({ recipient: 'teacher@school.org' })
    const result = await integration.queueDelivery({ weekId: '2026-09-28' })

    assert.equal(result.delivery.status, 'sent')
    assert.equal(result.delivery.shareStatus, 'failed')
    assert.match(result.delivery.lastError, /school sharing blocked/)
    assert.equal(result.delivery.emailMessageId, 'gmail-message-1')
    assert.equal(readFileSync(result.delivery.pdfPath).subarray(0, 5).toString(), '%PDF-')
    assert.equal(requests.filter((request) => request.url.includes('gmail.googleapis.com')).length, 1)
    const gmailRequest = requests.find((request) => request.url.includes('gmail.googleapis.com'))
    const mime = Buffer.from(JSON.parse(gmailRequest.init.body).raw, 'base64url').toString('utf8')
    assert.match(mime, /could not be shared/)
    assert.doesNotMatch(mime, /Google Doc \(view only\)/)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
