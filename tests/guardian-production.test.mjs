import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const builder = join(projectRoot, 'guardian', 'deployment', 'build-production-app.mjs')

test('production builder assembles an unsigned, non-installable SMAppService review app', {
  skip: process.platform !== 'darwin',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-production-guardian-'))
  const output = join(directory, 'Fionnbar Homework Parent test.app')
  const executable = join(directory, 'unsigned-placeholder')
  try {
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)
    const result = spawnSync(process.execPath, [
      builder,
      '--skip-build',
      '--no-archive',
      '--parent-binary', executable,
      '--agent-binary', executable,
      '--daemon-binary', executable,
      '--output', output,
    ], { cwd: projectRoot, encoding: 'utf8' })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const release = JSON.parse(readFileSync(`${output}.release.json`, 'utf8'))
    assert.equal(release.installReady, false)
    assert.equal(release.signingReady, false)
    assert.equal(release.enforcementIncluded, false)

    const security = JSON.parse(readFileSync(join(
      output,
      'Contents',
      'Resources',
      'guardian-security.json',
    ), 'utf8'))
    assert.equal(security.sharedSecret, false)
    assert.equal(security.enforcementIncluded, false)
    assert.deepEqual(security.allowedDaemonClients, [
      'com.fionnbar.homework.parent',
      'com.fionnbar.homework.guardian.agent',
    ])

    const daemonPlist = readFileSync(join(
      output,
      'Contents',
      'Library',
      'LaunchDaemons',
      'com.fionnbar.homework.guardian.daemon.plist',
    ), 'utf8')
    assert.match(daemonPlist, /<key>MachServices<\/key>/)
    assert.match(daemonPlist, /com\.fionnbar\.homework\.guardian\.daemon/)
    assert.doesNotMatch(daemonPlist, /sharedSecret|--enforce/)

    const marker = join(output, 'Contents', 'Resources', 'notarization-ticket-marker')
    writeFileSync(marker, 'preserve an externally stapled app')
    const verified = spawnSync(process.execPath, [
      builder,
      '--verify-only',
      '--no-archive',
      '--output', output,
    ], { cwd: projectRoot, encoding: 'utf8' })
    assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`)
    assert.equal(readFileSync(marker, 'utf8'), 'preserve an externally stapled app')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('production builder refuses non-app and broad output targets', { skip: process.platform !== 'darwin' }, () => {
  for (const output of [projectRoot, join(projectRoot, 'guardian', 'not-an-app')]) {
    const result = spawnSync(process.execPath, [
      builder,
      '--skip-build',
      '--no-archive',
      '--output', output,
    ], { cwd: projectRoot, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
  }
})
