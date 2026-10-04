const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081/v2/check'
const MAX_TEXT_LENGTH = 20_000
const MAX_MATCHES = 100

function localEndpoint(value) {
  const parsed = new URL(String(value || DEFAULT_ENDPOINT))
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('The proofreading endpoint must be a local HTTP service')
  }
  return parsed.toString()
}

function cleanReplacement(value) {
  const replacement = String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 160)
  return replacement.trim() ? replacement : ''
}

export function normalizeProofreadingMatches(value, text) {
  if (!Array.isArray(value)) return []
  const length = String(text ?? '').length
  return value.slice(0, MAX_MATCHES).flatMap((item) => {
    const offset = Math.floor(Number(item?.offset))
    const matchLength = Math.floor(Number(item?.length))
    const replacements = [...new Set(
      (Array.isArray(item?.replacements) ? item.replacements : [])
        .map((replacement) => cleanReplacement(
          typeof replacement === 'string' ? replacement : replacement?.value,
        ))
        .filter(Boolean),
    )].slice(0, 8)
    if (!Number.isFinite(offset) || !Number.isFinite(matchLength) || offset < 0 || matchLength < 0) return []
    if (offset + matchLength > length || replacements.length === 0) return []
    return [{
      offset,
      length: matchLength,
      message: String(item?.message ?? 'A proofreading issue was found.').slice(0, 500),
      shortMessage: String(item?.shortMessage ?? '').slice(0, 200),
      replacements,
      ruleId: String(item?.ruleId ?? item?.rule?.id ?? 'proofreading').slice(0, 120),
      category: String(item?.category ?? item?.rule?.category?.name ?? '').slice(0, 120),
      issueType: String(item?.issueType ?? item?.rule?.issueType ?? '').slice(0, 80),
    }]
  })
}

export function createProofreader(options = {}) {
  const endpoint = localEndpoint(options.endpoint ?? process.env.HOMEWORK_LANGUAGETOOL_URL)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(500, Number(options.timeoutMs) || 8_000)

  return {
    endpoint,
    async check(input) {
      const text = String(input ?? '')
      if (!text.trim()) return { available: true, engine: 'LanguageTool local', matches: [] }
      if (text.length > MAX_TEXT_LENGTH) throw new Error(`Writing is limited to ${MAX_TEXT_LENGTH.toLocaleString()} characters`)
      try {
        const parameters = new URLSearchParams({ language: 'en-US', text })
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: parameters,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) throw new Error(`LanguageTool returned ${response.status}`)
        const result = await response.json()
        return {
          available: true,
          engine: `LanguageTool ${String(result?.software?.version ?? 'local')}`,
          matches: normalizeProofreadingMatches(result?.matches, text),
        }
      } catch (error) {
        return {
          available: false,
          engine: 'reviewed offline rules',
          matches: [],
          error: error instanceof Error ? error.message : 'Local proofreading is unavailable',
        }
      }
    },
  }
}
