import { LOCAL_CHECK_TIMEOUT_MS } from '../src/proofreading-limits.ts'

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
  return replacement
}

export function normalizeProofreadingMatches(value, text) {
  if (!Array.isArray(value)) return []
  const length = String(text ?? '').length
  return value.slice(0, MAX_MATCHES).flatMap((item) => {
    const offset = Math.floor(Number(item?.offset))
    const matchLength = Math.floor(Number(item?.length))
    const replacements = [...new Set(
      (Array.isArray(item?.replacements) ? item.replacements : [])
        .filter((replacement) => typeof replacement === 'string' || typeof replacement?.value === 'string')
        .map((replacement) => cleanReplacement(
          typeof replacement === 'string' ? replacement : replacement?.value,
        ))
        .filter((replacement) => replacement !== '' || Number(item?.length) > 0),
    )].slice(0, 8)
    if (!Number.isFinite(offset) || !Number.isFinite(matchLength) || offset < 0 || matchLength < 0) return []
    if (offset + matchLength > length || replacements.length === 0) return []
    const source = ['languagetool', 'local', 'ai', 'parent'].includes(item?.source) ? item.source : undefined
    const verification = ['candidate', 'verified'].includes(item?.verification) ? item.verification : undefined
    const confidence = ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : undefined
    return [{
      offset,
      length: matchLength,
      message: String(item?.message ?? 'A proofreading issue was found.').slice(0, 500),
      shortMessage: String(item?.shortMessage ?? '').slice(0, 200),
      replacements,
      ruleId: String(item?.ruleId ?? item?.rule?.id ?? 'proofreading').slice(0, 120),
      category: String(item?.category ?? item?.rule?.category?.name ?? '').slice(0, 120),
      issueType: String(item?.issueType ?? item?.rule?.issueType ?? '').slice(0, 80),
      ...(source ? { source } : {}),
      ...(verification ? { verification } : {}),
      ...(confidence ? { confidence } : {}),
      ...(item?.issueCode ? { issueCode: String(item.issueCode).slice(0, 80) } : {}),
      ...(item?.explanation ? { explanation: String(item.explanation).slice(0, 500) } : {}),
      ...(item?.reviewId ? { reviewId: String(item.reviewId).slice(0, 240) } : {}),
    }]
  })
}

function reviewCategory(match) {
  const rule = String(match.ruleId).toUpperCase()
  const description = `${match.category} ${match.issueType}`.toLowerCase()
  if (rule.includes('UPPERCASE') || description.includes('capitalization') || description.includes('casing')) {
    return 'Capitalization'
  }
  if (rule.includes('COMMA') || rule.includes('PUNCT') || rule.includes('APOSTROPHE') || description.includes('punctuation')) {
    return 'Punctuation'
  }
  if (rule.includes('MORFOLOGIK') || rule.includes('SPELLING') || description.includes('typo') || description.includes('misspelling')) {
    return 'Spelling'
  }
  return 'Grammar'
}

function sentenceExcerpt(text, offset, length) {
  let start = Math.max(0, offset)
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start -= 1
  let end = Math.min(text.length, offset + length)
  while (end < text.length && !/[.!?\n]/.test(text[end])) end += 1
  if (end < text.length && /[.!?]/.test(text[end])) end += 1
  return text.slice(start, end).trim().slice(0, 500)
}

export function proofreadingReviewItems(text, matches) {
  return matches.flatMap((match, index) => {
    const issueType = String(match.issueType).toLowerCase()
    if (issueType === 'style' || String(match.ruleId).toUpperCase().includes('STYLE')) return []
    const alternatives = match.replacements.slice(0, 8)
    if (alternatives.length === 0) return []
    return [{
      id: `languagetool-${index}-${match.offset}-${match.length}-${String(match.ruleId).toLowerCase()}`,
      category: reviewCategory(match),
      message: `${match.message} LanguageTool suggestions are not automatically trusted.`,
      excerpt: sentenceExcerpt(text, match.offset, match.length),
      explanation: 'Choose a replacement only if it preserves the sentence meaning, grammar, and proper names.',
      suggestion: alternatives.join(' / '),
      alternatives,
      start: match.offset,
      end: match.offset + match.length,
      ruleId: match.ruleId,
      source: 'languagetool',
      confidence: 'medium',
    }]
  })
}

export function createProofreader(options = {}) {
  const endpoint = localEndpoint(options.endpoint ?? process.env.HOMEWORK_LANGUAGETOOL_URL)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(500, Number(options.timeoutMs) || LOCAL_CHECK_TIMEOUT_MS)

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
          engine: `LanguageTool ${String(result?.software?.version ?? 'local')} candidate scan`,
          matches: normalizeProofreadingMatches(result?.matches, text).map((match) => ({
            ...match,
            source: 'languagetool',
            verification: 'candidate',
          })),
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
