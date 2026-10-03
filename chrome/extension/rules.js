export const MANAGED_RULE_START = 20_000
export const MANAGED_RULE_LIMIT = 100

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeDomains(domains) {
  return [...new Set(
    (Array.isArray(domains) ? domains : [])
      .map((domain) => String(domain).trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
      .filter((domain) => /^[a-z0-9.-]+$/.test(domain) && domain.length <= 253),
  )].slice(0, MANAGED_RULE_LIMIT - 1)
}

export function normalizeOrigins(origins) {
  return [...new Set(
    (Array.isArray(origins) ? origins : []).flatMap((origin) => {
      try {
        const parsed = new URL(String(origin).trim())
        return ['http:', 'https:'].includes(parsed.protocol) ? [parsed.origin] : []
      } catch {
        return []
      }
    }),
  )].slice(0, MANAGED_RULE_LIMIT - 1)
}

function exactOriginRegex(origin) {
  const parsed = new URL(origin)
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
  const port = parsed.port ? `:${escapeRegex(parsed.port)}` : `(?::${defaultPort})?`
  return `^${escapeRegex(parsed.protocol)}//${escapeRegex(parsed.hostname)}${port}/`
}

export function buildDynamicRules(restrictNavigation, allowedDomains, allowedOrigins = []) {
  if (!restrictNavigation) return []
  const domains = normalizeDomains(allowedDomains)
  const origins = normalizeOrigins(allowedOrigins)
  const rules = [{
    id: MANAGED_RULE_START,
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
    condition: { regexFilter: '^https?://', resourceTypes: ['main_frame'] },
  }]

  const allowRules = [
    ...domains.map((domain) => `^https?://([^/]+\\.)?${escapeRegex(domain)}(:[0-9]+)?/`),
    ...origins.map(exactOriginRegex),
  ].slice(0, MANAGED_RULE_LIMIT - 1)

  allowRules.forEach((regexFilter, index) => {
    rules.push({
      id: MANAGED_RULE_START + index + 1,
      priority: 2,
      action: { type: 'allow' },
      condition: {
        regexFilter,
        resourceTypes: ['main_frame'],
      },
    })
  })
  return rules
}

export function isAllowedUrl(url, allowedDomains, allowedOrigins = []) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return true
    return normalizeOrigins(allowedOrigins).includes(parsed.origin) ||
      normalizeDomains(allowedDomains).some(
        (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
      )
  } catch {
    return false
  }
}

export function originForUrl(url) {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null
  } catch {
    return null
  }
}
