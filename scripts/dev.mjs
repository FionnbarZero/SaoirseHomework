import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const processes = [
  spawn(process.execPath, ['server/index.mjs'], { cwd: projectRoot, stdio: 'inherit' }),
  spawn(resolve(projectRoot, 'node_modules/.bin/vite'), [], { cwd: projectRoot, stdio: 'inherit' }),
]

let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const child of processes) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 250)
}

for (const child of processes) {
  child.on('exit', (code, signal) => {
    if (!closing && code !== 0) {
      console.error(`Development process stopped (${signal ?? code})`)
      close(code ?? 1)
    }
  })
}

process.on('SIGINT', () => close(0))
process.on('SIGTERM', () => close(0))
