import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { gzip as gzipCallback } from 'node:zlib'
import { Firestore } from '@google-cloud/firestore'
import { createStore } from '../server/database.mjs'

const gzip = promisify(gzipCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
try { process.loadEnvFile?.(join(projectRoot, '.env')) } catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const projectId = String(process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '').trim()
const documentPath = String(process.env.HOMEWORK_FIRESTORE_DOCUMENT ?? 'homework_state/saoirse').trim()
const databasePath = join(process.env.HOMEWORK_DATA_DIR || join(projectRoot, 'data'), 'homework.sqlite')
const replace = process.argv.includes('--replace')

if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT before uploading homework state')
const firestore = new Firestore({ projectId })
const document = firestore.doc(documentPath)
const existing = await document.get()
if (existing.exists && !replace) {
  throw new Error('Cloud homework state already exists. Use --replace only after making a verified backup.')
}

const store = createStore(databasePath, { timeZone: process.env.HOMEWORK_TIME_ZONE || 'America/Los_Angeles' })
store.checkpoint()
const schemaVersion = store.info().schemaVersion
store.close()
const database = await readFile(databasePath)
const snapshot = await gzip(database, { level: 9 })
if (snapshot.length > 900_000) throw new Error('The compressed database is too large for one Firestore document')

await document.set({
  snapshot,
  compression: 'gzip',
  databaseBytes: database.length,
  snapshotBytes: snapshot.length,
  sha256: createHash('sha256').update(snapshot).digest('hex'),
  schemaVersion,
  revision: (existing.exists ? Number(existing.data()?.revision) || 0 : 0) + 1,
  updatedAt: new Date().toISOString(),
})

console.log(`Uploaded the homework database to Firestore document ${documentPath}.`)
