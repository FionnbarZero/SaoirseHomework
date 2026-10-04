import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

function assertRootOwned(path, type, maximumMode) {
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink()) throw new Error(`Secure runtime path cannot be a symbolic link: ${path}`)
  if (type === 'directory' && !metadata.isDirectory()) throw new Error(`Secure runtime directory is invalid: ${path}`)
  if (type === 'file' && !metadata.isFile()) throw new Error(`Secure runtime file is invalid: ${path}`)
  if (metadata.uid !== 0) throw new Error(`Secure runtime path is not root-owned: ${path}`)
  if ((metadata.mode & 0o777) & ~maximumMode) {
    throw new Error(`Secure runtime permissions are too broad: ${path}`)
  }
}

export function enforceRootOwnedRuntime({ dataDirectory, keyFile, serviceRoot }) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('The protected homework service must run as root')
  }
  process.umask(0o077)
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  chmodSync(dataDirectory, 0o700)
  assertRootOwned(resolve(dataDirectory), 'directory', 0o700)
  assertRootOwned(resolve(keyFile), 'file', 0o600)
  assertRootOwned(resolve(serviceRoot), 'directory', 0o755)
}
