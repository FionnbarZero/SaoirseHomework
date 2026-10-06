import { proofreadingReviewItems } from './proofreader.mjs'
import { inspectWritingFindings } from '../src/writing.ts'

const REVIEWED_LOCAL_RULES = new Set([
  'COMMA_COMPOUND_SENTENCE',
  'MISSING_COMMA_AFTER_INTRODUCTORY_PHRASE',
  'EN_A_VS_AN',
  'THIS_NNS',
  'HAVE_PART_AGREEMENT',
  'EN_CONTRACTION_SPELLING',
])

function verifiedLocalMatches(matches) {
  return matches.flatMap((match) => (
    REVIEWED_LOCAL_RULES.has(String(match.ruleId).toUpperCase()) && match.replacements.length === 1
      ? [{ ...match, source: 'local', verification: 'verified', confidence: 'high', explanation: match.message }]
      : []
  ))
}

function sameCandidate(item, match) {
  return item.start === match.offset && item.end === match.offset + match.length &&
    String(item.ruleId).toUpperCase() === String(match.ruleId).toUpperCase()
}

// One orchestration path for the HTTP endpoint and integration tests.
export async function checkWriting(text, { proofreader, aiProofreader, mode, dictionary = { knownNames: ['Saoirse'], knownPlaces: [] } }) {
  const local = await proofreader.check(text)
  // Every rule that could enter the game must first be visible to the verifier.
  const offlineCandidates = inspectWritingFindings(text, dictionary).flatMap((finding) => (
    [finding, ...(finding.additionalEdits ?? [])].map((edit) => ({
      offset: edit.start, length: edit.end - edit.start, replacements: [edit.replacement],
      ruleId: `OFFLINE_${finding.ruleId}`, category: finding.category, message: finding.message,
    }))
  ))
  const candidates = [...local.matches, ...offlineCandidates]
  const ai = await aiProofreader.check(text, mode, candidates, dictionary)
  const authoritative = ai.analyzed && mode === 'assist'
  // Never resurrect a rejected or uncertain candidate after an active AI review.
  const localMatches = ai.analyzed && mode !== 'shadow' ? [] : verifiedLocalMatches(local.matches)
  const matches = [...ai.matches, ...localMatches.filter((localMatch) => !ai.matches.some((aiMatch) => (
    aiMatch.offset === localMatch.offset && aiMatch.length === localMatch.length &&
    aiMatch.replacements[0] === localMatch.replacements[0]
  )))]
  const reviewItems = (ai.analyzed ? [...ai.reviewItems] : [...ai.reviewItems, ...proofreadingReviewItems(text, local.matches)])
    .filter((item) => !localMatches.some((match) => sameCandidate(item, match)))
  const incomplete = Boolean(ai.incomplete || (mode !== 'off' && !ai.analyzed) || (!local.available && !ai.analyzed))
  if (incomplete) {
    reviewItems.push({
      id: 'incomplete-proofreading',
      source: 'local',
      category: 'Grammar',
      message: 'The full writing check did not finish. Recheck this version or ask a parent to review it.',
      explanation: ai.error || local.error || 'The proofreading service was unavailable.',
      excerpt: text.slice(0, 500),
    })
  }
  // Meaning choices resolve uncertainty, not routine errors. They must not leak
  // AI suggestions into Shadow or Parent-review mode, or erase review evidence.
  const intent = mode === 'assist' && ai.analyzed && reviewItems.length > 0
    ? await aiProofreader.interpret(text, mode, { knownIssues: [...matches, ...reviewItems], reviewIssues: reviewItems })
    : { ...aiProofreader.status(mode), available: ai.available, analyzed: false, reviews: [] }
  return {
    available: local.available || ai.analyzed,
    engine: [local.engine, ai.analyzed ? `${ai.provider} · ${ai.mode}` : null].filter(Boolean).join(' + '),
    matches,
    reviewItems,
    sentenceReviews: intent.reviews,
    intentAi: intent,
    ai,
    incomplete,
    authoritative,
    ...(local.error ? { error: local.error } : {}),
  }
}
