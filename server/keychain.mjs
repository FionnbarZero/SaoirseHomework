import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const DEFAULT_SERVICE = 'com.fionnbar.homework.google'
const DEFAULT_ACCOUNT = 'oauth-refresh-token'

function keychainError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createMacOSKeychain(options = {}) {
  const platform = options.platform ?? process.platform
  const run = options.execFile ?? execFile
  const service = options.service ?? DEFAULT_SERVICE
  const account = options.account ?? DEFAULT_ACCOUNT

  function requireMacOS() {
    if (platform !== 'darwin') {
      throw keychainError('Live Google authorization requires macOS Keychain', 'keychain_unavailable')
    }
  }

  return {
    available: platform === 'darwin',
    service,

    async getRefreshToken() {
      requireMacOS()
      try {
        const result = await run('/usr/bin/security', [
          'find-generic-password', '-s', service, '-a', account, '-w',
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 })
        const value = String(result?.stdout ?? result).trim()
        return value || null
      } catch (error) {
        if (Number(error?.code) === 44 || String(error?.stderr ?? '').includes('could not be found')) return null
        throw keychainError('The Google refresh token could not be read from macOS Keychain', 'keychain_read_failed')
      }
    },

    async setRefreshToken(token) {
      requireMacOS()
      const value = String(token ?? '')
      if (!value) throw keychainError('Google did not return a refresh token', 'missing_refresh_token')
      try {
        await run('/usr/bin/security', [
          'add-generic-password', '-U', '-s', service, '-a', account, '-w', value,
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 })
      } catch {
        throw keychainError('The Google refresh token could not be saved in macOS Keychain', 'keychain_write_failed')
      }
    },

    async deleteRefreshToken() {
      requireMacOS()
      try {
        await run('/usr/bin/security', [
          'delete-generic-password', '-s', service, '-a', account,
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 })
      } catch (error) {
        if (Number(error?.code) === 44 || String(error?.stderr ?? '').includes('could not be found')) return
        throw keychainError('The Google refresh token could not be removed from macOS Keychain', 'keychain_delete_failed')
      }
    },
  }
}
