import { createRemoteJWKSet, jwtVerify } from 'jose'

function denied(message = 'Sign in through the private homework website.', status = 401) {
  return Object.assign(new Error(message), { status, code: 'private_access_required' })
}

function httpsOrigin(value, label) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${label} must be an HTTPS origin`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS origin without a path or credentials`)
  }
  return url
}

// Cloud mode never trusts an email header or an unsigned cookie. The JWT is
// verified against this application's audience and the configured team's keys.
export function createPrivateAccess(options = {}) {
  const env = options.env ?? process.env
  const mode = env.HOMEWORK_DEPLOYMENT_MODE || 'local'
  if (!['local', 'private-cloud'].includes(mode)) throw new Error('Unknown HOMEWORK_DEPLOYMENT_MODE')
  if (mode === 'local') return { enabled: false, authenticate: async () => null }

  const team = httpsOrigin(env.HOMEWORK_ACCESS_TEAM_ORIGIN, 'HOMEWORK_ACCESS_TEAM_ORIGIN')
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team.hostname) || team.port) {
    throw new Error('HOMEWORK_ACCESS_TEAM_ORIGIN must be your Cloudflare Access team origin')
  }
  const site = httpsOrigin(env.HOMEWORK_PUBLIC_ORIGIN, 'HOMEWORK_PUBLIC_ORIGIN')
  const audience = String(env.HOMEWORK_ACCESS_AUDIENCE ?? '').trim()
  const emails = new Set(String(env.HOMEWORK_ACCESS_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
  if (!audience || !emails.size || [...emails].some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('Private cloud hosting requires an Access application audience and an exact email allowlist')
  }
  const keys = options.keys ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', team), { timeoutDuration: 5000 })

  return {
    enabled: true,
    publicOrigin: site.origin,
    async authenticate(request) {
      if (request.headers.host !== site.host) throw denied('This hostname is not configured for the private app.', 403)
      const token = request.headers['cf-access-jwt-assertion']
      if (typeof token !== 'string' || token.length > 16384) throw denied()
      let payload
      try {
        ;({ payload } = await jwtVerify(token, keys, {
          issuer: team.origin,
          audience,
          algorithms: ['RS256'],
          requiredClaims: ['exp', 'iat', 'sub', 'email'],
          clockTolerance: 5,
          ...(options.currentDate ? { currentDate: options.currentDate } : {}),
        }))
      } catch {
        // Do not disclose tokens, claims, or details of key-server failures.
        throw denied()
      }
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
      if (!emails.has(email)) throw denied('This account is not allowed to use the private app.', 403)
      const now = (options.currentDate?.getTime() ?? Date.now()) / 1000
      if (payload.iat > now + 5 || payload.exp <= payload.iat) throw denied()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== site.origin) {
        throw denied('Open the private homework website before making changes.', 403)
      }
      return { email, subject: payload.sub }
    },
  }
}
