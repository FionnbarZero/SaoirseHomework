import { join, resolve } from 'node:path'
import { createMacOSKeychain } from '../server/keychain.mjs'
import { createSecretManagerTokenStore } from '../server/secret-manager-token-store.mjs'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
try { process.loadEnvFile?.(join(projectRoot, '.env')) } catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const projectId = String(process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '').trim()
const secretId = String(process.env.HOMEWORK_CALENDAR_TOKEN_SECRET ?? '').trim()
if (!projectId || !secretId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT and HOMEWORK_CALENDAR_TOKEN_SECRET before uploading the Calendar token')
}

const keychain = createMacOSKeychain({
  service: 'com.fionnbar.homework.calendar.google',
  account: 'oauth-refresh-token',
})
const token = await keychain.getRefreshToken()
if (!token) throw new Error('The Calendar refresh token was not found in macOS Keychain')

const destination = createSecretManagerTokenStore({ projectId, secretId })
await destination.setRefreshToken(token)
console.log(`Uploaded the existing Calendar authorization to Secret Manager secret ${secretId}.`)
