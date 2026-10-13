import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib'
import { Firestore } from '@google-cloud/firestore'
import { createStore } from './database.mjs'

const gzip = promisify(gzipCallback)
const gunzip = promisify(gunzipCallback)
const MAX_SNAPSHOT_BYTES = 900_000
const DEFAULT_DOCUMENT = 'homework_state/saoirse'

const mutatingMethods = new Set([
  'recordWritingCheck',
  'saveState',
  'startLearningSession',
  'startGameSession',
  'completeGameSession',
  'completeWritingGameSession',
  'startSession',
  'heartbeatSession',
  'cancelSession',
  'acknowledgeSession',
  'setDailyCompletion',
  'addParentRewardCredit',
  'setWritingDictionary',
  'setAiProofreadingMode',
  'setWritingReviewStatus',
  'resetParentPreviewData',
  'recordGuardianHeartbeat',
  'recordChromeExtensionHeartbeat',
  'setActivityConfiguration',
  'connectMockGoogle',
  'disconnectMockGoogle',
  'prepareMockGoogleDelivery',
  'completeMockGoogleDelivery',
  'failMockGoogleDelivery',
  'configureLiveGoogle',
  'connectLiveGoogle',
  'disconnectLiveGoogle',
  'prepareLiveGoogleDelivery',
  'beginLiveGoogleDeliveryAttempt',
  'recordLiveGoogleDocument',
  'recordLiveGooglePdf',
  'recordLiveGoogleShare',
  'completeLiveGoogleDelivery',
  'failLiveGoogleDelivery',
  'retryLiveGoogleDelivery',
  'addAudit',
])

function cloudStoreError(message, code = 'cloud_persistence_failed', status = 503) {
  return Object.assign(new Error(message), { code, status })
}

function snapshotBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value?.toUint8Array) return Buffer.from(value.toUint8Array())
  if (value instanceof Uint8Array) return Buffer.from(value)
  return null
}

function validateDocumentPath(value) {
  const path = String(value || DEFAULT_DOCUMENT).trim()
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length % 2 !== 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('HOMEWORK_FIRESTORE_DOCUMENT must be a Firestore document path')
  }
  return parts.join('/')
}

export async function createFirestoreBackedStore(filename, options = {}) {
  if (!filename || filename === ':memory:') {
    throw new Error('Firestore persistence requires a local SQLite cache filename')
  }
  const projectId = String(options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '').trim()
  if (!projectId) throw new Error('Firestore persistence requires GOOGLE_CLOUD_PROJECT')
  const documentPath = validateDocumentPath(options.documentPath ?? process.env.HOMEWORK_FIRESTORE_DOCUMENT)
  const firestore = options.firestore ?? new Firestore({ projectId })
  const document = firestore.doc(documentPath)
  const remote = await document.get()
  let remoteRevision = remote.exists ? Number(remote.data()?.revision) || 0 : 0
  const compressed = remote.exists ? snapshotBuffer(remote.data()?.snapshot) : null

  if (compressed?.length) {
    let database
    try {
      database = await gunzip(compressed)
    } catch {
      throw cloudStoreError('The saved homework database could not be restored.', 'cloud_snapshot_invalid')
    }
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, database, { mode: 0o600 })
  }

  let activeFilename = filename
  let local = createStore(activeFilename, options.storeOptions)
  let dirtyRevision = 1
  let persistedRevision = 0
  let flushPromise = Promise.resolve()
  let generation = 0
  let recoveryNeeded = false
  let recoveryPromise = null
  const requests = new AsyncLocalStorage()

  function conflictError() {
    return cloudStoreError('Progress changed on another server. Reconnect to load the saved progress, then retry your last action.', 'cloud_snapshot_conflict', 409)
  }

  function assertCurrent(expected = requests.getStore()?.generation ?? generation) {
    if (recoveryNeeded || expected !== generation) throw conflictError()
  }

  async function recoverIfNeeded() {
    if (recoveryNeeded) {
      recoveryPromise ??= (async () => {
        // Failed requests must remain failed. Restore only confirmed cloud data;
        // never replay an unconfirmed timer or reward operation automatically.
        const latest = await document.get()
        const payload = latest.exists ? snapshotBuffer(latest.data()?.snapshot) : null
        if (!payload?.length) throw cloudStoreError('The saved homework database is unavailable.', 'cloud_snapshot_invalid')
        let database
        try { database = await gunzip(payload) }
        catch { throw cloudStoreError('The saved homework database could not be restored.', 'cloud_snapshot_invalid') }
        // A fresh cache avoids both open databases and orphaned WAL files from
        // a previous process. Open it successfully before closing the old cache.
        const replacementFilename = `${filename}.recovered-${randomUUID()}`
        await writeFile(replacementFilename, database, { mode: 0o600, flag: 'wx' })
        const replacement = createStore(replacementFilename, options.storeOptions)
        local.close()
        local = replacement
        activeFilename = replacementFilename
        remoteRevision = Number(latest.data()?.revision) || 0
        dirtyRevision = 1
        persistedRevision = 0
        recoveryNeeded = false
      })().finally(() => { recoveryPromise = null })
      await recoveryPromise
    }
    const request = requests.getStore()
    if (request) request.generation = generation
  }

  async function writeSnapshot(targetRevision) {
    local.checkpoint()
    const database = await readFile(activeFilename)
    const payload = await gzip(database, { level: 9 })
    if (payload.length > MAX_SNAPSHOT_BYTES) {
      throw cloudStoreError(
        'The homework database is too large for its Firestore safety snapshot.',
        'cloud_snapshot_too_large',
      )
    }
    const checksum = createHash('sha256').update(payload).digest('hex')
    const nextRevision = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(document)
      const currentRevision = current.exists ? Number(current.data()?.revision) || 0 : 0
      if (currentRevision !== remoteRevision) {
        throw conflictError()
      }
      const revision = currentRevision + 1
      transaction.set(document, {
        snapshot: payload,
        compression: 'gzip',
        databaseBytes: database.length,
        snapshotBytes: payload.length,
        sha256: checksum,
        schemaVersion: local.info().schemaVersion,
        revision,
        updatedAt: new Date().toISOString(),
      })
      return revision
    })
    remoteRevision = nextRevision
    persistedRevision = targetRevision
  }

  function markDirty() {
    dirtyRevision += 1
  }

  async function flushIfDirty() {
    const expected = requests.getStore()?.generation ?? generation
    // Preserve rejection for the caller of the failed write, but allow the next
    // request to retry all still-dirty state after a transient network failure.
    flushPromise = flushPromise.catch(() => {}).then(async () => {
      assertCurrent(expected)
      while (persistedRevision < dirtyRevision) {
        const targetRevision = dirtyRevision
        try {
          await writeSnapshot(targetRevision)
        } catch (error) {
          if (error?.code === 'cloud_snapshot_conflict') {
            recoveryNeeded = true
            generation += 1
          }
          throw error
        }
      }
    })
    return flushPromise
  }

  const cloud = {
    get db() { return local.db },
    info() {
      assertCurrent()
      return {
        ...local.info(),
        database: `firestore:${documentPath}`,
      }
    },
    flushIfDirty,
    recoverIfNeeded,
    withRequestContext(work) {
      return requests.run({ generation }, work)
    },
    async close() {
      await flushIfDirty()
      local.close()
    },
  }

  for (const name of Object.keys(local)) {
    if (name in cloud || typeof local[name] !== 'function') continue
    cloud[name] = (...args) => {
      assertCurrent()
      const result = local[name](...args)
      if (mutatingMethods.has(name)) markDirty()
      return result
    }
  }

  await flushIfDirty()
  return cloud
}
