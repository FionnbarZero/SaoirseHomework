import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chromeRoot = join(projectRoot, 'chrome')
const sourceDirectory = join(chromeRoot, 'extension')
const outputDirectory = join(chromeRoot, 'build', 'extension')
const manifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8'))

if (manifest.manifest_version !== 3) throw new Error('The Chrome extension must use Manifest V3')
if (manifest.background?.service_worker !== 'service-worker.js') throw new Error('A packaged service worker is required')
if (!manifest.key) throw new Error('The manifest public key is required for a stable development ID')
if (!manifest.host_permissions?.includes('<all_urls>')) throw new Error('Navigation rules require an explicit host permission')

const publicKey = Buffer.from(manifest.key, 'base64')
const digest = createHash('sha256').update(publicKey).digest().subarray(0, 16)
const extensionId = [...digest]
  .flatMap((byte) => [byte >> 4, byte & 15])
  .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
  .join('')
const expectedId = readFileSync(join(chromeRoot, 'extension-id.txt'), 'utf8').trim()
if (extensionId !== expectedId) throw new Error(`Extension ID mismatch: expected ${expectedId}, received ${extensionId}`)

for (const file of ['service-worker.js', 'popup.js', 'blocked.js']) {
  const source = readFileSync(join(sourceDirectory, file), 'utf8')
  if (/https?:\/\/[^'"`\s]+\.js/i.test(source)) throw new Error(`${file} references remote JavaScript`)
}

rmSync(outputDirectory, { recursive: true, force: true })
rmSync(join(chromeRoot, 'build', 'extension.crx'), { force: true })
mkdirSync(dirname(outputDirectory), { recursive: true })
cpSync(sourceDirectory, outputDirectory, { recursive: true })

console.log(`Built Chrome extension ${manifest.version}`)
console.log(`Extension ID: ${extensionId}`)
console.log(`Output: ${outputDirectory}`)
