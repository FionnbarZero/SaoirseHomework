import { proofreadingReviewItems } from './proofreader.mjs'

// One orchestration path for the HTTP endpoint and integration tests.
export async function checkWriting(text, { proofreader, aiProofreader, mode, dictionary = {} }) {
  const local = await proofreader.check(text)
  const ai = await aiProofreader.check(text, mode, local.matches, dictionary)
  const reviewItems = ai.analyzed ? [...ai.reviewItems] : proofreadingReviewItems(text, local.matches)
  const incomplete = (mode !== 'off' && !ai.analyzed) || (!local.available && !ai.analyzed)
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
    ? await aiProofreader.interpret(text, mode, { knownIssues: [...ai.matches, ...reviewItems] })
    : { ...aiProofreader.status(mode), available: ai.available, analyzed: false, reviews: [] }
  return {
    available: local.available || ai.analyzed,
    engine: [local.engine, ai.analyzed ? `${ai.provider} · ${ai.mode}` : null].filter(Boolean).join(' + '),
    matches: ai.matches,
    reviewItems,
    sentenceReviews: intent.reviews,
    intentAi: intent,
    ai,
    incomplete,
    ...(local.error ? { error: local.error } : {}),
  }
}
