import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const processes = []

try {
  process.loadEnvFile?.(join(projectRoot, '.env'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

async function proofreaderIsRunning() {
  try {
    const response = await fetch('http://127.0.0.1:8081/v2/languages', {
      signal: AbortSignal.timeout(750),
    })
    return response.ok
  } catch {
    return false
  }
}

function languageToolDirectory() {
  const configured = String(process.env.HOMEWORK_LANGUAGETOOL_HOME ?? '').trim()
  if (configured && existsSync(join(configured, 'languagetool-server.jar'))) return configured
  const base = join(homedir(), '.local', 'share', 'fionnbar-homework')
  if (!existsSync(base)) return null
  const directory = readdirSync(base)
    .filter((entry) => entry.startsWith('LanguageTool-'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .find((entry) => existsSync(join(base, entry, 'languagetool-server.jar')))
  return directory ? join(base, directory) : null
}

if (!await proofreaderIsRunning()) {
  const directory = languageToolDirectory()
  if (directory) {
    const child = spawn('java', [
      '-cp', 'languagetool-server.jar',
      'org.languagetool.server.HTTPServer',
      '--config', 'server.properties',
      '--port', '8081',
    ], { cwd: directory, stdio: 'inherit' })
    processes.push({ child, required: false })
  } else {
    console.warn('Local LanguageTool is not installed; reviewed offline writing rules will be used.')
  }
}

processes.push(
  { child: spawn(process.execPath, ['server/index.mjs'], { cwd: projectRoot, stdio: 'inherit' }), required: true },
  { child: spawn(resolve(projectRoot, 'node_modules/.bin/vite'), [], { cwd: projectRoot, stdio: 'inherit' }), required: true },
)

let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const { child } of processes) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 250)
}

for (const { child, required } of processes) {
  child.on('exit', (code, signal) => {
    if (!closing && required && code !== 0) {
      console.error(`Development process stopped (${signal ?? code})`)
      close(code ?? 1)
    } else if (!closing && !required && code !== 0) {
      console.warn(`Local LanguageTool stopped (${signal ?? code}); offline writing rules remain available.`)
    }
  })
}

process.on('SIGINT', () => close(0))
process.on('SIGTERM', () => close(0))
