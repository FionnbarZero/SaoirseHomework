import { sentenceWriting } from './ai-proofreader.mjs'
import { editsConflict } from '../src/writing-edits.ts'

function categoryForCandidate(match) {
  const rule = String(match.ruleId ?? '').toUpperCase()
  const description = `${match.category ?? ''} ${match.issueType ?? ''}`.toLowerCase()
  if (rule.includes('UPPERCASE') || description.includes('capitalization') || description.includes('casing')) return 'Capitalization'
  if (rule.includes('COMMA') || rule.includes('PUNCT') || rule.includes('APOSTROPHE') || description.includes('punctuation')) return 'Punctuation'
  if (rule.includes('MORFOLOGIK') || rule.includes('SPELLING') || description.includes('typo') || description.includes('misspelling')) return 'Spelling'
  return 'Grammar'
}

function overlaps(left, right) {
  return editsConflict(
    { start: left.offset, end: left.offset + left.length },
    { start: right.offset, end: right.offset + right.length },
  )
}

function applyEdits(sentence, edits) {
  return [...edits]
    .sort((left, right) => right.offset - left.offset || right.length - left.length)
    .reduce((text, edit) => {
      const start = edit.offset - sentence.start
      return `${text.slice(0, start)}${edit.replacement}${text.slice(start + edit.length)}`
    }, sentence.text)
}

function mergeHighlights(ranges, sentence) {
  const ordered = ranges
    .map((range) => ({
      start: Math.max(0, range.offset - sentence.start),
      end: Math.min(sentence.text.length, range.offset + Math.max(1, range.length) - sentence.start),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged = []
  for (const range of ordered) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

function findingEdits(finding) {
  return [
    {
      offset: finding.start,
      length: finding.end - finding.start,
      replacement: finding.replacement,
      category: finding.category,
      message: finding.message,
      explanation: finding.suggestion,
    },
    ...(finding.additionalEdits ?? []).map((edit) => ({
      offset: edit.start,
      length: edit.end - edit.start,
      replacement: edit.replacement,
      category: finding.category,
      message: finding.message,
      explanation: finding.suggestion,
    })),
  ]
}

function contextualUncertaintyRanges(sentence) {
  const ranges = []
  const companionList = /\bwith\s+(.+?)(?=\s+(?:said|asked|replied|shouted|whispered)\b|[.!?]|$)/gi
  let match
  while ((match = companionList.exec(sentence.text)) !== null) {
    const localStart = match.index + match[0].indexOf(match[1])
    ranges.push({
      offset: sentence.start + localStart,
      length: match[1].length,
    })
  }
  return ranges
}

const REVIEWED_FALLBACK_NAMES = ['Harry', 'Ron', 'Ann', 'Billy', 'Mike', 'Saoirse']

function capitalizedName(value) {
  return value
    .toLocaleLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase()}`)
}

function joinedNames(values) {
  if (values.length <= 1) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function contextualMeaningCandidates(sentence) {
  const candidates = []
  const fusedSpeaker = /\bwith\s+((?:[A-Za-z'’-]+\s+){1,8}?and\s+([a-z][a-z'’-]*)([A-Z][A-Za-z'’-]*))\s+(said|asked|replied|shouted|whispered)\s+(I|we|he|she|they)\b/g
  let match
  while ((match = fusedSpeaker.exec(sentence.text)) !== null) {
    const listText = match[1]
    const finalCompanion = capitalizedName(match[2])
    const speaker = capitalizedName(match[3])
    const earlierText = listText.slice(0, listText.length - `${match[2]}${match[3]}`.length)
      .replace(/\band\s*$/i, '')
      .trim()
    const earlierNames = earlierText.split(/\s+/).filter(Boolean).map(capitalizedName)
    if (earlierNames.length < 2) continue
    const unusedNames = REVIEWED_FALLBACK_NAMES.filter((name) => (
      !new RegExp(`\\b${name}\\b`, 'i').test(sentence.text)
    ))
    const start = sentence.start + match.index + match[0].indexOf(listText)
    const original = sentence.text.slice(start - sentence.start, match.index + match[0].length)
    const lead = (names, nextSpeaker) => `${joinedNames(names)}. ${nextSpeaker} ${match[4]}, "${match[5]}`
    const replacements = [
      lead([...earlierNames, finalCompanion], speaker),
      unusedNames[0] ? lead([...earlierNames, unusedNames[0]], speaker) : '',
      lead(earlierNames, `${finalCompanion} ${speaker}`),
      unusedNames[1] ? lead([...earlierNames, unusedNames[1]], speaker) : '',
      unusedNames[0] ? lead([...earlierNames, finalCompanion], unusedNames[0]) : '',
      unusedNames[0] ? lead([...earlierNames, unusedNames[0]], `${finalCompanion} ${speaker}`) : '',
    ].filter(Boolean)
    candidates.push({
      offset: start,
      length: original.length,
      replacements: [...new Set(replacements)],
      ruleId: 'LOCAL_FUSED_COMPANION_SPEAKER',
      category: 'Sentence meaning',
      issueType: 'unclear',
      message: 'This may contain the end of one sentence and the speaker of the next sentence.',
      contextual: true,
    })
  }
  return candidates
}

export function buildLocalMeaningReviews(text, findings = [], candidates = [], options = {}) {
  const attempt = Math.max(1, Math.min(8, Math.floor(Number(options.attempt) || 1)))
  const rejected = new Set((options.rejectedOptions ?? []).map((value) => String(value).trim().toLocaleLowerCase()))
  const reviews = []
  for (const sentence of sentenceWriting(text)) {
    const sentenceFindings = findings.filter((finding) => finding.start >= sentence.start && finding.end <= sentence.end)
    const sentenceCandidates = candidates.filter((match) => (
      match.offset >= sentence.start && match.offset + match.length <= sentence.end && match.replacements?.length
    ))
    const contextualCandidates = contextualMeaningCandidates(sentence)
    const allCandidates = [...contextualCandidates, ...sentenceCandidates]
    const severe = sentenceFindings.length >= 3 || allCandidates.length >= 2
    const hasAmbiguity = allCandidates.some((match) => match.replacements.length > 1)
    if (!severe || !hasAmbiguity) continue

    const trustedEdits = sentenceFindings.flatMap(findingEdits)
    // Meaning choices exist specifically to resolve ambiguity. If a local rule also
    // touched the same range, let the candidate alternatives take precedence in
    // this stage instead of silently locking in the deterministic guess.
    const usableCandidates = allCandidates
      .filter((match) => match.contextual || !trustedEdits.some((edit) => overlaps(edit, {
        offset: match.offset,
        length: match.length,
      })))
      .filter((match, index, all) => !all.slice(0, index).some((existing) => overlaps(existing, match)))
    if (usableCandidates.length === 0) continue
    const generated = []
    const combinationStart = (attempt - 1) * 3
    for (let combination = combinationStart; combination < combinationStart + 60 && generated.length < 3; combination += 1) {
      let cursor = combination
      const candidateEdits = usableCandidates.map((match) => {
        const original = text.slice(match.offset, match.offset + match.length)
        const replacements = match.replacements.filter((replacement) => {
          if (!replacement || replacement === original) return false
          if (replacement.toLocaleLowerCase() !== original.toLocaleLowerCase()) return true
          return /^[A-Z][a-z]/.test(replacement) && original === original.toLocaleLowerCase()
        })
        if (replacements.length === 0) return null
        const replacement = replacements[cursor % replacements.length]
        cursor = Math.floor(cursor / replacements.length)
        return {
          offset: match.offset,
          length: match.length,
          replacement,
          category: categoryForCandidate(match),
          message: match.shortMessage || match.message || 'This part may need a correction.',
          explanation: 'You selected this wording during the meaning check.',
        }
      }).filter(Boolean)
      const edits = [...candidateEdits, ...trustedEdits]
        .filter((edit, index, all) => !all.slice(0, index).some((existing) => overlaps(existing, edit)))
      const target = applyEdits(sentence, edits).trim()
      if (!target || target === sentence.text.trim() || rejected.has(target.toLocaleLowerCase())) continue
      if (generated.some((option) => option.text.toLocaleLowerCase() === target.toLocaleLowerCase())) continue
      generated.push({
        id: `sentence-${sentence.id}-local-${combination + 1}-attempt-${attempt}`,
        text: target,
        edits,
      })
    }
    if (generated.length !== 3) continue
    const allRanges = [
      ...trustedEdits,
      ...allCandidates.map((match) => ({ offset: match.offset, length: match.length })),
      ...contextualUncertaintyRanges(sentence),
    ]
    reviews.push({
      id: `sentence-${sentence.start}-${sentence.end}`,
      start: sentence.start,
      end: sentence.end,
      original: sentence.text,
      highlights: mergeHighlights(allRanges, sentence),
      options: generated,
      attempt,
      rejectedOptions: [...rejected],
    })
  }
  return reviews
}
