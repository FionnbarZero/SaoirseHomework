import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const downloadUrl = 'https://languagetool.org/download/LanguageTool-stable.zip'
const installRoot = join(homedir(), '.local', 'share', 'fionnbar-homework')
const archivePath = join(installRoot, 'LanguageTool-stable.zip')

function installedDirectory() {
  if (!existsSync(installRoot)) return null
  const directory = readdirSync(installRoot)
    .filter((entry) => entry.startsWith('LanguageTool-'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .find((entry) => existsSync(join(installRoot, entry, 'languagetool-server.jar')))
  return directory ? join(installRoot, directory) : null
}

const existing = installedDirectory()
if (existing) {
  console.log(`LanguageTool is already installed at ${existing}`)
  process.exit(0)
}

mkdirSync(installRoot, { recursive: true })
console.log('Downloading the official LanguageTool standalone package…')
const response = await fetch(downloadUrl)
if (!response.ok || !response.body) throw new Error(`LanguageTool download failed (${response.status})`)
await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath, { mode: 0o600 }))

const unzip = spawnSync('unzip', ['-q', '-o', archivePath, '-d', installRoot], { stdio: 'inherit' })
if (unzip.status !== 0) throw new Error('LanguageTool could not be extracted')
const directory = installedDirectory()
if (!directory) throw new Error('The downloaded package did not contain languagetool-server.jar')
const configuration = join(directory, 'server.properties')
if (!existsSync(configuration)) {
  writeFileSync(configuration, '# FionnbarHomework uses LanguageTool only over loopback.\n', { mode: 0o600 })
}
console.log(`LanguageTool installed at ${directory}`)
console.log('Run npm run dev; child writing will be checked only through 127.0.0.1:8081.')
