import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const builder = join(projectRoot, 'guardian', 'deployment', 'build-bundle.mjs')

test('deployment builder creates a checksum-protected, secret-free dry-run review bundle', {
  skip: process.platform !== 'darwin',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-guardian-deployment-'))
  const binary = join(directory, 'unsigned-guardian')
  const output = join(directory, 'FionnbarHomeworkGuardian-test')
  try {
    writeFileSync(binary, '#!/bin/sh\nexit 0\n')
    chmodSync(binary, 0o755)
    const built = spawnSync(process.execPath, [
      builder,
      '--skip-build',
      '--no-archive',
      '--binary', binary,
      '--output', output,
    ], { cwd: projectRoot, encoding: 'utf8' })
    assert.equal(built.status, 0, built.stderr)

    const metadata = JSON.parse(readFileSync(join(output, 'bundle.json'), 'utf8'))
    const configuration = JSON.parse(readFileSync(join(output, 'payload', 'guardian.json'), 'utf8'))
    assert.equal(metadata.mode, 'dry-run-only')
    assert.equal(metadata.installReady, false)
    assert.equal(configuration.allowEnforcement, false)
    assert.equal(configuration.sharedSecret, '')

    const manifest = readFileSync(join(output, 'manifest.sha256'), 'utf8').trim().split('\n')
    for (const line of manifest) {
      const [expected, path] = line.split(/\s{2}/)
      const actual = createHash('sha256').update(readFileSync(join(output, path))).digest('hex')
      assert.equal(actual, expected, path)
    }

    const report = spawnSync('/bin/bash', [join(output, 'guardian-admin'), 'bundle-report'], {
      cwd: output,
      encoding: 'utf8',
    })
    assert.notEqual(report.status, 0, 'an unsigned review bundle must not be install-ready')
    assert.match(`${report.stdout}${report.stderr}`, /INSTALL_READY=no/)
    assert.match(`${report.stdout}${report.stderr}`, /Code signing: BLOCKED/)

    configuration.sharedSecret = 'embedded-secrets-are-never-deployable'
    writeFileSync(join(output, 'payload', 'guardian.json'), `${JSON.stringify(configuration, null, 2)}\n`)
    const refreshedManifest = manifest.map((line) => {
      const [, path] = line.split(/\s{2}/)
      const hash = createHash('sha256').update(readFileSync(join(output, path))).digest('hex')
      return `${hash}  ${path}`
    })
    writeFileSync(join(output, 'manifest.sha256'), `${refreshedManifest.join('\n')}\n`)
    const unsafeReport = spawnSync('/bin/bash', [join(output, 'guardian-admin'), 'bundle-report'], {
      cwd: output,
      encoding: 'utf8',
    })
    assert.notEqual(unsafeReport.status, 0)
    assert.match(`${unsafeReport.stdout}${unsafeReport.stderr}`, /must not contain the prototype shared secret/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment builder refuses broad output targets', { skip: process.platform !== 'darwin' }, () => {
  const result = spawnSync(process.execPath, [builder, '--skip-build', '--output', projectRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Refusing unsafe output path/)
})
