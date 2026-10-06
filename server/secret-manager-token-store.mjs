import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const DISCONNECTED_MARKER = 'saoirse-homework:disconnected'

function tokenStoreError(message, code) {
  return Object.assign(new Error(message), { code })
}

function isNotFound(error) {
  return Number(error?.code) === 5 || String(error?.message ?? '').includes('NOT_FOUND')
}

export function createSecretManagerTokenStore(options = {}) {
  const projectId = String(options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '').trim()
  const secretId = String(options.secretId ?? '').trim()
  const client = options.client ?? (projectId && secretId ? new SecretManagerServiceClient() : null)
  const secretName = projectId && secretId ? `projects/${projectId}/secrets/${secretId}` : ''

  function requireConfiguration() {
    if (!client || !secretName) {
      throw tokenStoreError('Cloud Calendar token storage is not configured', 'secret_manager_unavailable')
    }
  }

  return {
    available: Boolean(client && secretName),
    service: secretName,

    async getRefreshToken() {
      requireConfiguration()
      try {
        const [version] = await client.accessSecretVersion({ name: `${secretName}/versions/latest` })
        const value = Buffer.from(version?.payload?.data ?? '').toString('utf8').trim()
        return value && value !== DISCONNECTED_MARKER ? value : null
      } catch (error) {
        if (isNotFound(error)) return null
        throw tokenStoreError('The Calendar refresh token could not be read from Secret Manager', 'secret_manager_read_failed')
      }
    },

    async setRefreshToken(token) {
      requireConfiguration()
      const value = String(token ?? '').trim()
      if (!value) throw tokenStoreError('Google did not return a refresh token', 'missing_refresh_token')
      try {
        await client.addSecretVersion({
          parent: secretName,
          payload: { data: Buffer.from(value, 'utf8') },
        })
      } catch {
        throw tokenStoreError('The Calendar refresh token could not be saved in Secret Manager', 'secret_manager_write_failed')
      }
    },

    async deleteRefreshToken() {
      requireConfiguration()
      try {
        await client.addSecretVersion({
          parent: secretName,
          payload: { data: Buffer.from(DISCONNECTED_MARKER, 'utf8') },
        })
      } catch {
        throw tokenStoreError('The Calendar refresh token could not be removed from Secret Manager', 'secret_manager_delete_failed')
      }
    },
  }
}
