import { chmod, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const credentialPath = process.argv[2]
if (!credentialPath) throw new Error('Pass the downloaded Desktop OAuth JSON path')

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envPath = resolve(projectRoot, '.env')
const credential = JSON.parse(await readFile(resolve(credentialPath), 'utf8'))
const installed = credential?.installed

if (!installed?.client_id || !String(installed.client_id).endsWith('.apps.googleusercontent.com')) {
  throw new Error('The file is not a Google Desktop OAuth credential')
}
if (!installed.client_secret) {
  throw new Error('The Google Desktop OAuth credential has no token-exchange secret')
}
if (installed.project_id !== 'weeklydictationapp') {
  throw new Error('The Desktop OAuth credential is not from the WeeklyDictationApp project')
}
if (!Array.isArray(installed.redirect_uris) || !installed.redirect_uris.some((uri) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(uri))) {
  throw new Error('The Desktop OAuth credential does not allow a loopback redirect')
}

let env = await readFile(envPath, 'utf8').catch((error) => {
  if (error?.code === 'ENOENT') return ''
  throw error
})

function setValue(key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, '')}\n${line}\n`
}

setValue('HOMEWORK_GOOGLE_CLIENT_ID', installed.client_id)
// Google still requires this Desktop-client value at the token endpoint. It is
// stored only in the owner-readable, Git-ignored local environment file. PKCE
// remains the authorization-code security boundary for this public client.
setValue('HOMEWORK_GOOGLE_CLIENT_SECRET', installed.client_secret)

await writeFile(envPath, env, { encoding: 'utf8', mode: 0o600 })
await chmod(envPath, 0o600)
await chmod(resolve(credentialPath), 0o600)

console.log(`Configured Desktop OAuth client …${installed.client_id.slice(-16)} in owner-readable local settings.`)
