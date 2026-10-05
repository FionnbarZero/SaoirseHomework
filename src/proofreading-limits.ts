export const LOCAL_CHECK_TIMEOUT_MS = 8_000
// Structured detection and independent verification can each take longer than
// 25 seconds on real multi-error passages. Keep the browser deadline aligned.
export const AI_PASS_TIMEOUT_MS = 120_000
// Local check + detection + verification + optional meaning review + transport.
export const WRITING_CHECK_TIMEOUT_MS = LOCAL_CHECK_TIMEOUT_MS + AI_PASS_TIMEOUT_MS * 3 + 10_000
export const MEANING_CHECK_TIMEOUT_MS = LOCAL_CHECK_TIMEOUT_MS + AI_PASS_TIMEOUT_MS + 10_000
