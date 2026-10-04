import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const deploymentDirectory = fileURLToPath(new URL('.', import.meta.url))
const guardianDirectory = resolve(deploymentDirectory, '..')
const projectRoot = resolve(guardianDirectory, '..')
const templatesDirectory = join(guardianDirectory, 'AppBundle')

const identifiers = {
  parent: 'com.fionnbar.homework.parent',
  agent: 'com.fionnbar.homework.guardian.agent',
  daemon: 'com.fionnbar.homework.guardian.daemon',
}

function parseArguments(arguments_) {
  const releaseDirectory = join(guardianDirectory, '.build', 'release')
  const options = {
    output: join(guardianDirectory, 'build', 'Fionnbar Homework Parent.app'),
    parentBinary: join(releaseDirectory, 'fionnbar-homework-parent'),
    agentBinary: join(releaseDirectory, 'homework-guardian-agent'),
    daemonBinary: join(releaseDirectory, 'homework-guardian-daemon'),
    identity: '',
    build: true,
    archive: true,
    verifyOnly: false,
  }
  const takeValue = (index, option) => {
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
    return value
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--output') options.output = resolve(takeValue(index++, argument))
    else if (argument === '--parent-binary') options.parentBinary = resolve(takeValue(index++, argument))
    else if (argument === '--agent-binary') options.agentBinary = resolve(takeValue(index++, argument))
    else if (argument === '--daemon-binary') options.daemonBinary = resolve(takeValue(index++, argument))
    else if (argument === '--identity') options.identity = takeValue(index++, argument)
    else if (argument === '--skip-build') options.build = false
    else if (argument === '--no-archive') options.archive = false
    else if (argument === '--verify-only') {
      options.verifyOnly = true
      options.build = false
    }
    else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

function assertSafeOutput(output) {
  const resolved = resolve(output)
  const protectedPaths = new Set([
    resolve('/'),
    resolve(process.env.HOME || '/nonexistent'),
    projectRoot,
    guardianDirectory,
    resolve(guardianDirectory, 'build'),
  ])
  if (protectedPaths.has(resolved)) throw new Error(`Refusing unsafe output path: ${resolved}`)
  if (!resolved.endsWith('.app')) throw new Error('Production output must be a named .app bundle')
  if (!basename(resolved).startsWith('Fionnbar Homework Parent') && !resolved.startsWith('/private/tmp/')) {
    throw new Error('Output must be the Fionnbar Homework Parent app or live under /private/tmp')
  }
}

function copyExecutable(source, destination) {
  if (!existsSync(source)) throw new Error(`Required executable not found: ${source}`)
  cpSync(source, destination)
  chmodSync(destination, 0o755)
}

function signatureMetadata(path) {
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--strict', path], { encoding: 'utf8' })
  const detail = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', path], { encoding: 'utf8' })
  const output = `${detail.stdout ?? ''}${detail.stderr ?? ''}`
  const value = (name) => output.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim() ?? null
  return {
    valid: verification.status === 0,
    identifier: value('Identifier'),
    teamIdentifier: value('TeamIdentifier') === 'not set' ? null : value('TeamIdentifier'),
    hardenedRuntime: /flags=.*\bruntime\b/m.test(output),
  }
}

function sign(path, identity, identifier) {
  const arguments_ = ['--force', '--options', 'runtime', '--timestamp']
  if (identifier) arguments_.push('--identifier', identifier)
  arguments_.push('--sign', identity, path)
  execFileSync('/usr/bin/codesign', arguments_, { stdio: 'inherit' })
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex')
}

function buildProductionApp(options) {
  assertSafeOutput(options.output)
  if (options.build && !options.verifyOnly) {
    execFileSync('/usr/bin/swift', ['build', '-c', 'release'], {
      cwd: guardianDirectory,
      stdio: 'inherit',
    })
  }

  const contents = join(options.output, 'Contents')
  const macOSDirectory = join(contents, 'MacOS')
  const launchAgents = join(contents, 'Library', 'LaunchAgents')
  const launchDaemons = join(contents, 'Library', 'LaunchDaemons')
  const resources = join(contents, 'Resources')
  const version = readFileSync(join(guardianDirectory, 'VERSION'), 'utf8').trim()
  const paths = {
    parent: join(macOSDirectory, 'fionnbar-homework-parent'),
    agent: join(macOSDirectory, 'homework-guardian-agent'),
    daemon: join(macOSDirectory, 'homework-guardian-daemon'),
  }
  if (options.verifyOnly) {
    if (!existsSync(options.output)) throw new Error(`App bundle not found: ${options.output}`)
  } else {
    rmSync(options.output, { recursive: true, force: true })
    for (const directory of [macOSDirectory, launchAgents, launchDaemons, resources]) {
      mkdirSync(directory, { recursive: true })
    }

    const buildVersion = version.replace(/[^0-9.]/g, '')
    const info = readFileSync(join(templatesDirectory, 'Info.plist'), 'utf8')
      .replaceAll('__VERSION__', version)
      .replaceAll('__BUILD_VERSION__', buildVersion)
    writeFileSync(join(contents, 'Info.plist'), info)
    copyExecutable(options.parentBinary, paths.parent)
    copyExecutable(options.agentBinary, paths.agent)
    copyExecutable(options.daemonBinary, paths.daemon)
    cpSync(
      join(templatesDirectory, 'LaunchAgents', 'com.fionnbar.homework.guardian.agent.plist'),
      join(launchAgents, 'com.fionnbar.homework.guardian.agent.plist'),
    )
    cpSync(
      join(templatesDirectory, 'LaunchDaemons', 'com.fionnbar.homework.guardian.daemon.plist'),
      join(launchDaemons, 'com.fionnbar.homework.guardian.daemon.plist'),
    )
    writeFileSync(join(resources, 'guardian-security.json'), `${JSON.stringify({
      protocolVersion: 3,
      version,
      daemonMachService: identifiers.daemon,
      allowedDaemonClients: [identifiers.parent, identifiers.agent],
      authorizationRight: 'system.privilege.admin',
      sharedSecret: false,
      policyAuthority: 'privileged-daemon',
      childSessionStart: 'signed-agent-restrictive-only',
      completionAuthority: 'daemon-capability-plus-service-proof',
      enforcementIncluded: true,
    }, null, 2)}\n`)

    for (const plist of [
      join(contents, 'Info.plist'),
      join(launchAgents, 'com.fionnbar.homework.guardian.agent.plist'),
      join(launchDaemons, 'com.fionnbar.homework.guardian.daemon.plist'),
    ]) {
      execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'ignore' })
    }

    if (options.identity) {
      sign(paths.agent, options.identity, identifiers.agent)
      sign(paths.daemon, options.identity, identifiers.daemon)
      sign(options.output, options.identity)
    }
  }

  const signatures = {
    parent: signatureMetadata(options.output),
    agent: signatureMetadata(paths.agent),
    daemon: signatureMetadata(paths.daemon),
  }
  const teams = new Set(Object.values(signatures).map((signature) => signature.teamIdentifier).filter(Boolean))
  const identifiersMatch = signatures.parent.identifier === identifiers.parent
    && signatures.agent.identifier === identifiers.agent
    && signatures.daemon.identifier === identifiers.daemon
  const signingReady = Object.values(signatures).every((signature) => (
    signature.valid && signature.hardenedRuntime && signature.teamIdentifier
  )) && teams.size === 1 && identifiersMatch
  const staple = spawnSync('/usr/bin/xcrun', ['stapler', 'validate', options.output], { encoding: 'utf8' })
  const notarizationReady = staple.status === 0
  const metadata = {
    name: 'Fionnbar Homework Parent',
    version,
    builtAt: new Date().toISOString(),
    minimumMacOS: '13.0',
    architecture: 'SMAppService enforcement agent + policy daemon with authenticated XPC',
    enforcementIncluded: true,
    installReady: signingReady && notarizationReady,
    productionReady: false,
    signingReady,
    notarizationReady,
    signatures,
  }
  const metadataPath = `${options.output}.release.json`
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)

  let archivePath = null
  if (options.archive) {
    archivePath = join(dirname(options.output), `FionnbarHomeworkParent-${version}.tar.gz`)
    rmSync(archivePath, { force: true })
    execFileSync('/usr/bin/tar', [
      '-czf', archivePath,
      '-C', dirname(options.output),
      basename(options.output),
      basename(metadataPath),
    ])
    writeFileSync(`${archivePath}.sha256`, `${sha256(archivePath)}  ${basename(archivePath)}\n`)
  }
  return { archivePath, metadata, metadataPath, output: options.output }
}

const result = buildProductionApp(parseArguments(process.argv.slice(2)))
console.log(`Parent app: ${relative(projectRoot, result.output)}`)
console.log(`Release report: ${relative(projectRoot, result.metadataPath)}`)
if (result.archivePath) console.log(`Archive: ${relative(projectRoot, result.archivePath)}`)
console.log(`Signing ready: ${result.metadata.signingReady ? 'yes' : 'no'}`)
console.log(`Notarization ready: ${result.metadata.notarizationReady ? 'yes' : 'no'}`)
console.log(`Install ready: ${result.metadata.installReady ? 'yes' : 'no — sign every component and staple a notarization ticket'}`)
console.log('Production ready: no — signed second-Mac acceptance testing is still required')
