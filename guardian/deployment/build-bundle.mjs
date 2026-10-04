import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const deploymentDirectory = fileURLToPath(new URL('.', import.meta.url))
const guardianDirectory = resolve(deploymentDirectory, '..')
const projectRoot = resolve(guardianDirectory, '..')

function parseArguments(arguments_) {
  const options = {
    output: join(guardianDirectory, 'build', 'FionnbarHomeworkGuardian'),
    binary: join(guardianDirectory, '.build', 'release', 'homework-guardian'),
    build: true,
    archive: true,
    identity: '',
  }
  const nextValue = (index, option) => {
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
    return value
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--output') {
      options.output = resolve(nextValue(index, argument))
      index += 1
    } else if (argument === '--binary') {
      options.binary = resolve(nextValue(index, argument))
      index += 1
    } else if (argument === '--identity') {
      options.identity = nextValue(index, argument)
      index += 1
    } else if (argument === '--skip-build') options.build = false
    else if (argument === '--no-archive') options.archive = false
    else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

function assertSafeOutput(output) {
  const resolved = resolve(output)
  const root = resolve('/')
  const home = resolve(process.env.HOME || '/nonexistent')
  if (resolved === root || resolved === home || resolved === projectRoot || resolved === guardianDirectory) {
    throw new Error(`Refusing unsafe output path: ${resolved}`)
  }
  if (!basename(resolved).startsWith('FionnbarHomeworkGuardian') && !resolved.startsWith('/private/tmp/')) {
    throw new Error('Output directory must be a named guardian bundle or live under /private/tmp')
  }
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex')
}

function signatureMetadata(binary) {
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--strict', binary], { encoding: 'utf8' })
  const detail = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', binary], { encoding: 'utf8' })
  const output = `${detail.stdout ?? ''}${detail.stderr ?? ''}`
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null
  return {
    valid: verification.status === 0,
    hardenedRuntime: /flags=.*\bruntime\b/m.test(output),
    teamIdentifier: teamIdentifier && teamIdentifier !== 'not set' ? teamIdentifier : null,
  }
}

function collectManifestFiles(output) {
  return [
    'bundle.json',
    'guardian-admin',
    'payload/com.fionnbar.homework.guardian.plist.template',
    'payload/guardian.json',
    'payload/homework-guardian',
  ].map((path) => ({ path, filename: join(output, path) }))
}

function buildBundle(options) {
  assertSafeOutput(options.output)
  if (options.build) {
    execFileSync('/usr/bin/swift', ['build', '-c', 'release'], {
      cwd: guardianDirectory,
      stdio: 'inherit',
    })
  }
  if (!existsSync(options.binary)) throw new Error(`Guardian binary not found: ${options.binary}`)

  rmSync(options.output, { recursive: true, force: true })
  mkdirSync(join(options.output, 'payload'), { recursive: true })
  const destinationBinary = join(options.output, 'payload', 'homework-guardian')
  cpSync(options.binary, destinationBinary)
  chmodSync(destinationBinary, 0o755)

  if (options.identity) {
    execFileSync('/usr/bin/codesign', [
      '--force', '--options', 'runtime', '--timestamp', '--sign', options.identity, destinationBinary,
    ], { stdio: 'inherit' })
  }

  const configuration = JSON.parse(readFileSync(join(guardianDirectory, 'guardian.example.json'), 'utf8'))
  configuration.allowEnforcement = false
  configuration.sharedSecret = ''
  writeFileSync(join(options.output, 'payload', 'guardian.json'), `${JSON.stringify(configuration, null, 2)}\n`, { mode: 0o644 })
  cpSync(
    join(guardianDirectory, 'com.fionnbar.homework.guardian.plist.template'),
    join(options.output, 'payload', 'com.fionnbar.homework.guardian.plist.template'),
  )
  cpSync(join(deploymentDirectory, 'guardian-admin'), join(options.output, 'guardian-admin'))
  chmodSync(join(options.output, 'guardian-admin'), 0o755)

  const version = readFileSync(join(guardianDirectory, 'VERSION'), 'utf8').trim()
  const signature = signatureMetadata(destinationBinary)
  const metadata = {
    name: 'Fionnbar Homework Guardian',
    version,
    builtAt: new Date().toISOString(),
    minimumMacOS: '13.0',
    mode: 'dry-run-only',
    parentAuthorization: 'blocked-until-privileged-broker',
    installReady: signature.valid && signature.hardenedRuntime && Boolean(signature.teamIdentifier),
    signature,
  }
  writeFileSync(join(options.output, 'bundle.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 })

  const manifest = collectManifestFiles(options.output)
    .map(({ path, filename }) => `${sha256(filename)}  ${path}`)
    .join('\n')
  writeFileSync(join(options.output, 'manifest.sha256'), `${manifest}\n`, { mode: 0o644 })

  let archivePath = null
  if (options.archive) {
    archivePath = join(dirname(options.output), `FionnbarHomeworkGuardian-${version}.tar.gz`)
    rmSync(archivePath, { force: true })
    execFileSync('/usr/bin/tar', ['-czf', archivePath, '-C', dirname(options.output), basename(options.output)])
    writeFileSync(
      `${archivePath}.sha256`,
      `${sha256(archivePath)}  ${basename(archivePath)}\n`,
      { mode: 0o644 },
    )
  }

  return { output: options.output, archivePath, metadata }
}

const options = parseArguments(process.argv.slice(2))
const result = buildBundle(options)
console.log(`Guardian bundle: ${relative(projectRoot, result.output) || result.output}`)
if (result.archivePath) console.log(`Archive: ${relative(projectRoot, result.archivePath) || result.archivePath}`)
console.log(`Install ready: ${result.metadata.installReady ? 'yes' : 'no — sign with a hardened Apple team identity'}`)
