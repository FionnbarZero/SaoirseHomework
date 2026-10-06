import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/gmail.send',
]

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const DRIVE_ENDPOINT = 'https://www.googleapis.com/drive/v3'
const DOCS_ENDPOINT = 'https://docs.googleapis.com/v1'
const GMAIL_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1'
export const WRITING_LOG_NAMED_RANGE = 'fionnbar_homework_writing_log_v1'

function liveError(message, code = 'google_live_error', status = 502, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  error.status = status
  return error
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'writing'
}

async function responseBody(response) {
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json().catch(() => ({}))
  return response.text().catch(() => '')
}

function apiMessage(body, fallback) {
  return body?.error_description || body?.error?.message || body?.error || fallback
}

export function createPkcePair(random = randomBytes) {
  const verifier = random(64).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function buildGoogleAuthorizationUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTHORIZATION_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString()
  return url.toString()
}

export function schoolYearForWeek(weekId) {
  const [year, month] = String(weekId).split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error('A valid week ID is required')
  const start = month >= 7 ? year : year - 1
  return `${start}-${start + 1}`
}

function formatReadingDate(value) {
  const candidate = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return ''
  const date = new Date(`${candidate}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) return ''
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function readingDetailLines(draft) {
  const date = formatReadingDate(draft.readingDate)
  return [
    `Book title: ${draft.title || 'Untitled writing'}`,
    draft.author ? `Author: ${draft.author}` : '',
    date ? `Reading date: ${date}` : '',
    draft.pagesRead ? `Pages read: ${draft.pagesRead}` : '',
  ].filter(Boolean)
}

export function buildWeeklyDocumentText(delivery, drafts) {
  const sections = [
    delivery.documentName,
    `Week of ${delivery.weekId}`,
    '',
  ]
  for (const draft of drafts) {
    const versionLabel = `Version ${Math.max(1, Number(draft.versionNumber) || 1)}`
    const completeSteps = Object.values(draft.exerciseProgress ?? {}).reduce(
      (total, item) => total + (item?.correctionComplete ? 1 : 0) + Number(item?.practiceCompleted ?? 0),
      0,
    )
    const totalSteps = (draft.findings ?? []).reduce(
      (total, finding) => total + (Array.isArray(finding.practice) ? finding.practice.length : 3) + 1,
      0,
    )
    const attemptResults = (draft.findings ?? []).flatMap((finding) => {
      const results = draft.exerciseProgress?.[finding.id]?.attemptResults
      return Array.isArray(results) ? results.filter((result) => typeof result === 'boolean') : []
    })
    const correctResponses = attemptResults.filter(Boolean).length
    const scorePercent = attemptResults.length
      ? Math.round((correctResponses / attemptResults.length) * 100)
      : null
    const cumulativePercent = attemptResults.map((_, index) => {
      const correctSoFar = attemptResults.slice(0, index + 1).filter(Boolean).length
      return Math.round((correctSoFar / (index + 1)) * 100)
    })
    const spellingWords = draft.spellingWords ?? []
    const spellingSteps = spellingWords.reduce((total, word) => {
      const item = draft.spellingProgress?.[word.id]
      return total + Math.min(3, Number(item?.copyCompleted) || 0) +
        Math.min(3, Number(item?.hiddenCompleted) || 0) +
        Math.min(3, Number(item?.mixedCompleted) || 0)
    }, 0)
    const spellingTotal = spellingWords.length * 9
    const spellingFindingCount = (draft.findings ?? []).filter((finding) => finding.category === 'Spelling').length
    sections.push(
      `${draft.title || 'Untitled writing'} — ${versionLabel}`,
      `Completed ${new Date(draft.updatedAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}`,
      ...readingDetailLines(draft),
      '',
      'Original',
      draft.body,
      '',
      'Corrected copy',
      draft.correctedBody || draft.body,
      '',
      `Practice summary: ${completeSteps} of ${totalSteps} writing correction and review steps completed. ` +
        (spellingWords.length
          ? `${spellingSteps} of ${spellingTotal} spelling responses completed for ${spellingWords.length} ${spellingWords.length === 1 ? 'word' : 'words'}.`
          : spellingFindingCount
            ? `${spellingFindingCount} reviewed ${spellingFindingCount === 1 ? 'misspelling was' : 'misspellings were'} completed in the multiple-choice game.`
          : 'No supported common misspellings were detected.'),
      scorePercent === null
        ? 'First-try writing game score: no scored responses were recorded.'
        : `First-try writing game score: ${correctResponses} of ${attemptResults.length} correct (${scorePercent}%).`,
      attemptResults.length
        ? `First-try accuracy by question: ${cumulativePercent.map((value) => `${value}%`).join(', ')}.`
        : '',
      '',
      '────────────────────────────────────────',
      '',
    )
  }
  return sections.join('\n')
}

function safeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0) : date
}

function writingLogProgress(draft) {
  const findings = Array.isArray(draft.findings) ? draft.findings : []
  const completed = findings.reduce((total, finding) => {
    const progress = draft.exerciseProgress?.[finding.id]
    return total + (progress?.correctionComplete ? 1 : 0) + Number(progress?.practiceCompleted ?? 0)
  }, 0)
  const total = findings.reduce(
    (sum, finding) => sum + (Array.isArray(finding.practice) ? finding.practice.length : 3) + 1,
    0,
  )
  if (draft.reviewStatus === 'complete') return 'Correction status: complete'
  if (total === 0) return 'Correction status: no supported corrections found'
  return `Correction status: ${Math.min(completed, total)} of ${total} practice steps complete`
}

export function buildWritingLogText(drafts) {
  const ordered = [...(Array.isArray(drafts) ? drafts : [])]
    .filter((draft) => String(draft?.body ?? '').trim())
    .sort((left, right) => safeDate(right.updatedAt).getTime() - safeDate(left.updatedAt).getTime())
  const sections = [
    'Fionnbar Writing Attempts & Corrections',
    'Newest entries appear first.',
    '',
  ]
  for (const draft of ordered) {
    sections.push(
      `${draft.title || 'Untitled writing'} — Version ${Math.max(1, Number(draft.versionNumber) || 1)}`,
      `Saved ${safeDate(draft.updatedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`,
      ...readingDetailLines(draft),
      writingLogProgress(draft),
      '',
      'Writing attempt',
      String(draft.body ?? ''),
      '',
      'Corrections',
      String(draft.correctedBody || draft.body || ''),
      '',
      '────────────────────────────────────────',
      '',
    )
  }
  if (ordered.length === 0) sections.push('No writing attempts have been saved yet.', '', '')
  return sections.join('\n')
}

export function buildGmailRawMessage({ from, to, subject, text, pdf, filename, messageId }) {
  const boundary = `fionnbar_${randomBytes(18).toString('hex')}`
  const normalizedText = String(text).replace(/\r?\n/g, '\r\n')
  const attachment = Buffer.from(pdf).toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd()
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedText,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    attachment,
    `--${boundary}--`,
    '',
  ]
  return base64Url(headers.join('\r\n'))
}

export function isFridayDeliveryDue(value, timeZone = 'America/Los_Angeles') {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('A valid date is required')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return parts.weekday === 'Friday' && (Number(parts.hour) > 15 || (Number(parts.hour) === 15 && Number(parts.minute) >= 0))
}

export function createGoogleLiveIntegration(options) {
  const {
    store,
    keychain,
    credentialBroker = null,
    clientId,
    clientSecret = '',
    redirectUri,
    outputDirectory,
    mode = 'safe-test',
    fetch: fetchImpl = globalThis.fetch,
    now = () => new Date(),
    timeZone = 'America/Los_Angeles',
    writingLogDocumentId = '',
    writingLogTabId = 't.0',
  } = options
  const pendingAuthorizations = new Map()
  let accessTokenCache = null
  let processing = null
  let writingLogProcessing = null
  let pendingWritingLogDrafts = null
  let writingLogLastSyncedAt = null
  let writingLogLastError = null
  let writingLogDraftCount = 0

  const normalizedWritingLogDocumentId = String(writingLogDocumentId).trim()
  const normalizedWritingLogTabId = String(writingLogTabId || 't.0').trim() || 't.0'
  const writingLogDocumentUrl = normalizedWritingLogDocumentId
    ? `https://docs.google.com/document/d/${encodeURIComponent(normalizedWritingLogDocumentId)}/edit?tab=${encodeURIComponent(normalizedWritingLogTabId)}`
    : null

  function getWritingLogState() {
    const connected = store.getLiveGoogleState().connected
    const configured = Boolean(normalizedWritingLogDocumentId)
    return {
      configured,
      connected,
      documentId: configured ? normalizedWritingLogDocumentId : null,
      documentUrl: writingLogDocumentUrl,
      tabId: configured ? normalizedWritingLogTabId : null,
      status: !configured
        ? 'not-configured'
        : mode !== 'live'
          ? 'safe-test'
          : !connected
            ? 'authorization-required'
            : writingLogLastError
              ? 'failed'
              : writingLogProcessing
                ? 'syncing'
                : writingLogLastSyncedAt
                  ? 'synced'
                  : 'ready',
      draftCount: writingLogDraftCount,
      lastSyncedAt: writingLogLastSyncedAt,
      lastError: writingLogLastError,
    }
  }

  function assertEnabled() {
    if (mode !== 'live') {
      throw liveError('Live Google delivery is disabled. Set HOMEWORK_GOOGLE_MODE=live to enable it.', 'google_live_disabled', 409)
    }
    if (!clientId) {
      throw liveError('A Google Desktop OAuth client ID is required', 'google_client_not_configured', 409)
    }
    if (credentialBroker ? !credentialBroker.available : !keychain?.available) {
      throw liveError('The signed user-session Google credential broker is unavailable', 'keychain_unavailable', 409)
    }
  }

  async function postForm(url, values) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    })
    const body = await responseBody(response)
    if (!response.ok) throw liveError(apiMessage(body, 'Google authorization failed'), 'google_oauth_failed', 502)
    return body
  }

  async function beginAuthorization() {
    assertEnabled()
    if (credentialBroker) {
      return credentialBroker.beginAuthorization({
        clientId,
        clientSecret,
        redirectUri,
        scopes: GOOGLE_SCOPES,
      })
    }
    const state = randomBytes(32).toString('base64url')
    const pkce = createPkcePair()
    const createdAt = now().getTime()
    pendingAuthorizations.set(state, { verifier: pkce.verifier, createdAt })
    for (const [key, pending] of pendingAuthorizations) {
      if (createdAt - pending.createdAt > 10 * 60 * 1000) pendingAuthorizations.delete(key)
    }
    return {
      authorizationUrl: buildGoogleAuthorizationUrl({
        clientId,
        redirectUri,
        state,
        challenge: pkce.challenge,
      }),
      expiresAt: new Date(createdAt + 10 * 60 * 1000).toISOString(),
    }
  }

  async function completeAuthorization({ state, code, error: authorizationError }) {
    assertEnabled()
    if (credentialBroker) {
      const credentials = await credentialBroker.completeAuthorization({
        clientId,
        clientSecret,
        redirectUri,
        scopes: GOOGLE_SCOPES,
        state: String(state ?? ''),
        code: String(code ?? ''),
        error: String(authorizationError ?? ''),
      })
      if (!credentials?.accessToken || !credentials?.accountEmail) {
        throw liveError('The signed user-session component returned incomplete Google credentials', 'google_broker_invalid', 502)
      }
      accessTokenCache = {
        token: credentials.accessToken,
        expiresAt: Number.isFinite(Date.parse(credentials.expiresAt))
          ? Date.parse(credentials.expiresAt)
          : now().getTime() + 3_600_000,
      }
      store.connectLiveGoogle({ accountEmail: credentials.accountEmail, scopes: GOOGLE_SCOPES })
      await queueWritingLogSync(store.loadState().drafts)
      return store.getLiveGoogleState()
    }
    if (authorizationError) throw liveError(`Google authorization was not completed: ${authorizationError}`, 'google_oauth_denied', 400)
    const pending = pendingAuthorizations.get(String(state))
    pendingAuthorizations.delete(String(state))
    if (!pending || now().getTime() - pending.createdAt > 10 * 60 * 1000) {
      throw liveError('The Google authorization request expired or could not be verified', 'google_oauth_state_invalid', 400)
    }
    if (!code) throw liveError('Google did not return an authorization code', 'google_oauth_code_missing', 400)

    const values = {
      client_id: clientId,
      code: String(code),
      code_verifier: pending.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }
    if (clientSecret) values.client_secret = clientSecret
    const tokens = await postForm(TOKEN_ENDPOINT, values)
    if (!tokens.refresh_token) {
      throw liveError('Google did not return an offline refresh token. Revoke the app and authorize again.', 'missing_refresh_token', 502)
    }
    const userResponse = await fetchImpl(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const user = await responseBody(userResponse)
    if (!userResponse.ok || !user.email) {
      throw liveError(apiMessage(user, 'The authorized Google account could not be identified'), 'google_userinfo_failed', 502)
    }
    await keychain.setRefreshToken(tokens.refresh_token)
    accessTokenCache = {
      token: tokens.access_token,
      expiresAt: now().getTime() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
    }
    store.connectLiveGoogle({ accountEmail: user.email, scopes: GOOGLE_SCOPES })
    await queueWritingLogSync(store.loadState().drafts)
    return store.getLiveGoogleState()
  }

  async function accessToken(forceRefresh = false) {
    assertEnabled()
    if (!forceRefresh && accessTokenCache && accessTokenCache.expiresAt - now().getTime() > 60_000) {
      return accessTokenCache.token
    }
    if (credentialBroker) {
      try {
        const credentials = await credentialBroker.accessToken({ clientId, clientSecret })
        if (!credentials?.accessToken) throw new Error('Missing access token')
        accessTokenCache = {
          token: credentials.accessToken,
          expiresAt: Number.isFinite(Date.parse(credentials.expiresAt))
            ? Date.parse(credentials.expiresAt)
            : now().getTime() + 3_600_000,
        }
        return accessTokenCache.token
      } catch (error) {
        store.disconnectLiveGoogle({
          reason: 'Google authorization was revoked, expired, or unavailable in the user session',
          lastError: 'Google authorization requires the signed user-session component',
        })
        accessTokenCache = null
        throw liveError('Google authorization is unavailable. Authorize the account again.', 'google_reauthorization_required', 401, error)
      }
    }
    const refreshToken = await keychain.getRefreshToken()
    if (!refreshToken) {
      store.disconnectLiveGoogle({
        reason: 'The Keychain refresh token is missing',
        lastError: 'The Keychain refresh token is missing',
      })
      throw liveError('Google authorization is missing. Authorize the account again.', 'google_reauthorization_required', 401)
    }
    const values = {
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }
    if (clientSecret) values.client_secret = clientSecret
    try {
      const tokens = await postForm(TOKEN_ENDPOINT, values)
      accessTokenCache = {
        token: tokens.access_token,
        expiresAt: now().getTime() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
      }
      return accessTokenCache.token
    } catch (error) {
      if (error?.code === 'google_oauth_failed') {
        store.disconnectLiveGoogle({
          reason: 'Google authorization was revoked or expired',
          lastError: 'Google authorization was revoked or expired',
        })
        accessTokenCache = null
        throw liveError('Google authorization was revoked or expired. Authorize the account again.', 'google_reauthorization_required', 401, error)
      }
      throw error
    }
  }

  async function googleRequest(url, init = {}, retry = true) {
    const token = await accessToken()
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    })
    if (response.status === 401 && retry) {
      accessTokenCache = null
      await accessToken(true)
      return googleRequest(url, init, false)
    }
    if (!response.ok) {
      const body = await responseBody(response)
      throw liveError(apiMessage(body, `Google API request failed (${response.status})`), 'google_api_failed', 502)
    }
    return response
  }

  async function syncWritingLog(drafts = store.loadState().drafts) {
    assertEnabled()
    if (!normalizedWritingLogDocumentId) {
      throw liveError('The writing log document is not configured', 'writing_log_not_configured', 409)
    }
    const text = buildWritingLogText(drafts)
    try {
      const documentEndpoint = `${DOCS_ENDPOINT}/documents/${encodeURIComponent(normalizedWritingLogDocumentId)}`
      const document = await responseBody(await googleRequest(`${documentEndpoint}?includeTabsContent=true`))
      if (document.documentId !== normalizedWritingLogDocumentId) {
        throw liveError('Google returned a different writing log document', 'writing_log_target_mismatch', 409)
      }
      const targetTab = document.tabs?.find((tab) => tab.tabProperties?.tabId === normalizedWritingLogTabId)
      if (Array.isArray(document.tabs) && !targetTab) {
        throw liveError('The configured writing log tab was not found', 'writing_log_tab_not_found', 409)
      }
      const namedRanges = targetTab?.documentTab?.namedRanges ?? document.namedRanges
      const namedRange = namedRanges?.[WRITING_LOG_NAMED_RANGE]?.namedRanges?.[0]
      const requests = namedRange
        ? [{
            replaceNamedRangeContent: {
              namedRangeName: WRITING_LOG_NAMED_RANGE,
              tabsCriteria: { tabIds: [normalizedWritingLogTabId] },
              text,
            },
          }]
        : [
            {
              insertText: {
                location: { index: 1, tabId: normalizedWritingLogTabId },
                text,
              },
            },
            {
              createNamedRange: {
                name: WRITING_LOG_NAMED_RANGE,
                range: {
                  startIndex: 1,
                  endIndex: 1 + text.length,
                  tabId: normalizedWritingLogTabId,
                },
              },
            },
          ]
      const updated = await responseBody(await googleRequest(`${documentEndpoint}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests,
          ...(document.revisionId ? { writeControl: { requiredRevisionId: document.revisionId } } : {}),
        }),
      }))
      writingLogDraftCount = Array.isArray(drafts) ? drafts.filter((draft) => String(draft?.body ?? '').trim()).length : 0
      writingLogLastSyncedAt = now().toISOString()
      writingLogLastError = null
      return {
        ...getWritingLogState(),
        revisionId: updated.writeControl?.requiredRevisionId ?? updated.writeControl?.targetRevisionId ?? null,
      }
    } catch (error) {
      writingLogLastError = error instanceof Error ? error.message : 'The writing log could not be updated.'
      throw error
    }
  }

  function queueWritingLogSync(drafts) {
    pendingWritingLogDrafts = structuredClone(Array.isArray(drafts) ? drafts : [])
    if (writingLogProcessing) return writingLogProcessing
    if (mode !== 'live' || !normalizedWritingLogDocumentId || !store.getLiveGoogleState().connected) {
      return Promise.resolve(getWritingLogState())
    }
    writingLogProcessing = (async () => {
      while (pendingWritingLogDrafts) {
        const nextDrafts = pendingWritingLogDrafts
        pendingWritingLogDrafts = null
        try {
          await syncWritingLog(nextDrafts)
        } catch {
          // Local writing remains durable. The status endpoint exposes the sync failure for retry.
        }
      }
      return getWritingLogState()
    })().finally(() => { writingLogProcessing = null })
    return writingLogProcessing
  }

  async function findOrCreateFolder(name, parentId) {
    const parentClause = parentId ? `'${escapeDriveQuery(parentId)}' in parents` : `'root' in parents`
    const query = `name='${escapeDriveQuery(name)}' and mimeType='application/vnd.google-apps.folder' and ${parentClause} and trashed=false`
    const search = new URL(`${DRIVE_ENDPOINT}/files`)
    search.search = new URLSearchParams({ q: query, spaces: 'drive', fields: 'files(id,name)', pageSize: '10' }).toString()
    const found = await responseBody(await googleRequest(search))
    if (found.files?.[0]?.id) return found.files[0].id
    const created = await responseBody(await googleRequest(`${DRIVE_ENDPOINT}/files?fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    }))
    return created.id
  }

  async function ensureWritingFolder(weekId) {
    const root = await findOrCreateFolder('Fionnbar Homework', null)
    const schoolYear = await findOrCreateFolder(schoolYearForWeek(weekId), root)
    return findOrCreateFolder('Writing', schoolYear)
  }

  async function createDocument(delivery, drafts) {
    const folderId = await ensureWritingFolder(delivery.weekId)
    const file = await responseBody(await googleRequest(`${DRIVE_ENDPOINT}/files?fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: delivery.documentName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      }),
    }))
    const text = buildWeeklyDocumentText(delivery, drafts)
    await googleRequest(`${DOCS_ENDPOINT}/documents/${encodeURIComponent(file.id)}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
    })
    const documentUrl = file.webViewLink || `https://docs.google.com/document/d/${encodeURIComponent(file.id)}/edit`
    store.recordLiveGoogleDocument(delivery.id, { documentId: file.id, documentUrl })
    return { documentId: file.id, documentUrl }
  }

  async function exportPdf(delivery) {
    const response = await googleRequest(
      `${DRIVE_ENDPOINT}/files/${encodeURIComponent(delivery.documentId)}/export?mimeType=${encodeURIComponent('application/pdf')}`,
    )
    const pdf = Buffer.from(await response.arrayBuffer())
    if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw liveError('Google Drive did not return a valid PDF export', 'google_pdf_invalid', 502)
    }
    await mkdir(outputDirectory, { recursive: true })
    const path = join(outputDirectory, `${safeFilename(delivery.weekId)}-${safeFilename(delivery.documentId)}.pdf`)
    await writeFile(path, pdf, { mode: 0o600 })
    store.recordLiveGooglePdf(delivery.id, path)
    return { pdf, path }
  }

  async function shareDocument(delivery) {
    await googleRequest(`${DRIVE_ENDPOINT}/files/${encodeURIComponent(delivery.documentId)}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: delivery.recipient }),
    })
    store.recordLiveGoogleShare(delivery.id, 'shared')
    return true
  }

  async function sendEmail(delivery, pdf, shared) {
    const linkLine = shared
      ? `Google Doc (view only): ${delivery.documentUrl}`
      : 'The Google Doc could not be shared. The complete PDF is attached.'
    const raw = buildGmailRawMessage({
      from: delivery.accountEmail,
      to: delivery.recipient,
      subject: delivery.documentName,
      text: `Hello,\n\nAttached is Fionnbar's completed writing for the week of ${delivery.weekId}.\n\n${linkLine}\n\nSent by Fionnbar Homework.`,
      pdf,
      filename: `${safeFilename(delivery.documentName)}.pdf`,
      messageId: `fionnbar-${delivery.weekId}-${delivery.documentId}@homework.local`,
    })
    const sent = await responseBody(await googleRequest(`${GMAIL_ENDPOINT}/users/me/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    }))
    return sent.id
  }

  async function processDelivery(deliveryId) {
    const prepared = store.beginLiveGoogleDeliveryAttempt(deliveryId)
    if (!prepared || ['sent', 'skipped'].includes(prepared.delivery.status)) return prepared?.delivery ?? null
    try {
      let delivery = prepared.delivery
      if (!delivery.documentId) {
        await createDocument(delivery, prepared.drafts)
        delivery = store.getLiveGoogleDeliveryWork(deliveryId).delivery
      }
      let pdf
      if (delivery.pdfPath) {
        const { readFile } = await import('node:fs/promises')
        pdf = await readFile(delivery.pdfPath)
      } else {
        pdf = (await exportPdf(delivery)).pdf
        delivery = store.getLiveGoogleDeliveryWork(deliveryId).delivery
      }
      let shared = delivery.shareStatus === 'shared'
      if (!shared) {
        try {
          shared = await shareDocument(delivery)
        } catch (error) {
          store.recordLiveGoogleShare(delivery.id, 'failed', error)
        }
      }
      const messageId = await sendEmail(delivery, pdf, shared)
      return store.completeLiveGoogleDelivery(delivery.id, { messageId })
    } catch (error) {
      store.failLiveGoogleDelivery(deliveryId, error)
      throw error
    }
  }

  async function queueDelivery(input = {}) {
    assertEnabled()
    const prepared = store.prepareLiveGoogleDelivery(input)
    if (!prepared.created || prepared.delivery.status === 'skipped') return prepared
    return { ...prepared, delivery: await processDelivery(prepared.delivery.id) }
  }

  async function runQueue() {
    if (processing) return processing
    processing = (async () => {
      if (mode !== 'live' || !store.getLiveGoogleState().connected) return []
      const due = store.listRetryableLiveGoogleDeliveries()
      const results = []
      for (const delivery of due) {
        try {
          results.push(await processDelivery(delivery.id))
        } catch {
          // The persisted failure and next retry time are the result of this attempt.
        }
      }
      if (isFridayDeliveryDue(now(), timeZone)) {
        try {
          const prepared = store.prepareLiveGoogleDelivery({ scheduled: true })
          if (prepared.created && prepared.delivery.status !== 'skipped') {
            results.push(await processDelivery(prepared.delivery.id))
          } else {
            results.push(prepared.delivery)
          }
        } catch {
          // Configuration and authorization errors are visible in live status.
        }
      }
      return results
    })().finally(() => { processing = null })
    return processing
  }

  async function retryDelivery(id) {
    assertEnabled()
    const delivery = store.retryLiveGoogleDelivery(id)
    return processDelivery(delivery.id)
  }

  async function disconnect() {
    accessTokenCache = null
    if (credentialBroker) {
      let revocationWarning = null
      try {
        const result = await credentialBroker.disconnect({ clientId, clientSecret })
        revocationWarning = result?.revocationWarning || null
      } catch {
        revocationWarning = 'The Google connection was disabled, but the signed user-session component could not confirm token removal.'
      }
      store.disconnectLiveGoogle({
        reason: 'Authorization disconnected by parent',
        ...(revocationWarning ? { lastError: revocationWarning } : {}),
      })
      return store.getLiveGoogleState()
    }
    const refreshToken = await keychain.getRefreshToken()
    let revocationWarning = null
    if (refreshToken) {
      try {
        const response = await fetchImpl(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        })
        if (!response.ok) revocationWarning = 'Google revocation could not be confirmed; the local Keychain token was removed.'
      } catch {
        revocationWarning = 'Google revocation could not be confirmed; the local Keychain token was removed.'
      }
      try {
        await keychain.deleteRefreshToken()
      } catch {
        revocationWarning = 'The Google connection was disabled, but its refresh token could not be removed from macOS Keychain.'
      }
    }
    store.disconnectLiveGoogle({
      reason: 'Authorization disconnected by parent',
      ...(revocationWarning ? { lastError: revocationWarning } : {}),
    })
    return store.getLiveGoogleState()
  }

  return {
    beginAuthorization,
    completeAuthorization,
    queueDelivery,
    processDelivery,
    retryDelivery,
    runQueue,
    getWritingLogState,
    queueWritingLogSync,
    syncWritingLog,
    disconnect,
  }
}
