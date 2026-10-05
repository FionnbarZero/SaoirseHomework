import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const builder = join(projectRoot, 'guardian', 'deployment', 'build-production-app.mjs')
const serviceDependencies = [
  '@noble/ciphers', '@noble/hashes', '@swc/helpers', 'base64-js', 'brotli', 'clone',
  'dfa', 'fast-deep-equal', 'fflate', 'fontkit', 'linebreak', 'pako', 'pdfkit',
  'png-js', 'restructure', 'tiny-inflate', 'tslib', 'unicode-properties', 'unicode-trie',
]
const serviceFiles = [
  'ai-proofreader.mjs', 'proofreader.mjs', 'writing-check.mjs',
  'activity-config.mjs', 'database.mjs', 'google-live.mjs', 'google-proof.mjs',
  'index.mjs', 'keychain.mjs', 'lifecycle-auth.mjs', 'parent-auth.mjs',
  'runtime-security.mjs', 'user-session-broker.mjs',
]

test('production builder assembles an unsigned, non-production SMAppService enforcement review app', {
  skip: process.platform !== 'darwin',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-production-guardian-'))
  const output = join(directory, 'Fionnbar Homework Parent test.app')
  const executable = join(directory, 'unsigned-placeholder')
  const serviceResources = join(directory, 'service-resources')
  try {
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)
    mkdirSync(join(serviceResources, 'server'), { recursive: true })
    mkdirSync(join(serviceResources, 'dist'), { recursive: true })
    for (const filename of serviceFiles) {
      writeFileSync(join(serviceResources, 'server', filename),
        filename === 'index.mjs' ? 'console.log("test service")\n' : 'export {}\n')
    }
    writeFileSync(join(serviceResources, 'dist', 'index.html'), '<!doctype html><title>test</title>\n')
    mkdirSync(join(serviceResources, 'src'), { recursive: true })
    for (const filename of ['domain.ts', 'spelling.ts', 'writing.ts', 'writing-edits.ts', 'proofreading-limits.ts']) {
      writeFileSync(join(serviceResources, 'src', filename), 'export {}\n')
    }
    for (const dependency of serviceDependencies) {
      const dependencyDirectory = join(serviceResources, 'node_modules', dependency)
      mkdirSync(dependencyDirectory, { recursive: true })
      writeFileSync(join(dependencyDirectory, 'package.json'), '{"name":"test"}\n')
    }
    const result = spawnSync(process.execPath, [
      builder,
      '--skip-build',
      '--no-archive',
      '--parent-binary', executable,
      '--agent-binary', executable,
      '--daemon-binary', executable,
      '--service-binary', executable,
      '--node-binary', executable,
      '--service-resource-root', serviceResources,
      '--output', output,
    ], { cwd: projectRoot, encoding: 'utf8' })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const release = JSON.parse(readFileSync(`${output}.release.json`, 'utf8'))
    assert.equal(release.installReady, false)
    assert.equal(release.signingReady, false)
    assert.equal(release.enforcementIncluded, true)
    assert.equal(release.productionReady, false)
    assert.equal(release.rootOwnedServiceIncluded, true)
    assert.equal(release.lifecycleAuthentication, 'root-shared HMAC-SHA256')
    assert.equal(release.parentAuthorization, 'native agent + daemon attestation')
    assert.equal(release.googleCredentials, 'signed user-session Keychain broker')

    const security = JSON.parse(readFileSync(join(
      output,
      'Contents',
      'Resources',
      'guardian-security.json',
    ), 'utf8'))
    assert.equal(security.sharedSecret, false)
    assert.equal(security.enforcementIncluded, true)
    assert.equal(security.policyAuthority, 'privileged-daemon')
    assert.equal(security.protocolVersion, 6)
    assert.equal(security.childSessionStart, 'signed-agent-restrictive-only')
    assert.equal(security.completionAuthority, 'daemon-capability-plus-service-proof')
    assert.equal(security.lifecycleAuthentication, 'root-shared-hmac-sha256')
    assert.equal(security.parentAuthorization, 'native-agent-daemon-attestation')
    assert.equal(security.googleCredentials, 'signed-user-session-keychain-broker')
    assert.equal(security.serviceRuntime, 'bundled-node')
    assert.equal(security.dataOwnership, 'root-only-0700')
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

    const servicePlist = readFileSync(join(
      output,
      'Contents',
      'Library',
      'LaunchDaemons',
      'com.fionnbar.homework.service.plist',
    ), 'utf8')
    assert.match(servicePlist, /<key>BundleProgram<\/key>/)
    assert.match(servicePlist, /fionnbar-homework-service/)
    assert.equal(readFileSync(join(
      output,
      'Contents',
      'Resources',
      'HomeworkService',
      'server',
      'index.mjs',
    ), 'utf8'), 'console.log("test service")\n')

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
