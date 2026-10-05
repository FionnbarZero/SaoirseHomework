import type { Finding, SpellingProgress, SpellingWord, WritingDictionary, WritingTrial } from './domain'

export const SPELLING_REPETITIONS = 3

export type SpellingPhase = 'copy' | 'hidden' | 'mixed'

export type SpellingStep = {
  wordId: string
  phase: SpellingPhase
  attempt: number
  prompt: string
  visible: boolean
}

const COMMON_MISSPELLINGS: Record<string, string> = {
  adn: 'and',
  accomodate: 'accommodate',
  adress: 'address',
  alot: 'a lot',
  becuase: 'because',
  beleive: 'believe',
  begining: 'beginning',
  broomed: 'broom',
  becasue: 'because',
  definately: 'definitely',
  diferent: 'different',
  embarass: 'embarrass',
  enviroment: 'environment',
  Febuary: 'February',
  freind: 'friend',
  goverment: 'government',
  happend: 'happened',
  immediatly: 'immediately',
  knowlege: 'knowledge',
  neccessary: 'necessary',
  occured: 'occurred',
  practise: 'practice',
  qidch: 'Quidditch',
  recieve: 'receive',
  recieved: 'received',
  seperate: 'separate',
  succesful: 'successful',
  teh: 'the',
  thier: 'their',
  tommorow: 'tomorrow',
  togther: 'together',
  triend: 'tried',
  untill: 'until',
  wierd: 'weird',
  wich: 'which',
  writting: 'writing',
  studing: 'studying',
  characted: 'character',
  cbouts: 'bought',
  hambester: 'hamster',
  whitch: 'witch',
  withher: 'with her',
  criminils: 'criminals',
}

const NORMALIZED_MISSPELLINGS = new Map(
  Object.entries(COMMON_MISSPELLINGS).map(([word, correction]) => [word.toLocaleLowerCase(), correction]),
)

function normalizeWord(value: string) {
  return value.trim().replaceAll('’', "'").toLocaleLowerCase()
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function preserveCase(original: string, correction: string) {
  if (original === original.toLocaleUpperCase()) return correction.toLocaleUpperCase()
  if (/^[A-Z]/.test(original)) return `${correction[0].toLocaleUpperCase()}${correction.slice(1)}`
  return correction
}

function sentenceBounds(body: string, index: number) {
  let start = index
  while (start > 0 && !/[.!?\n]/.test(body[start - 1])) start -= 1
  while (start < body.length && /\s/.test(body[start])) start += 1
  let end = index
  while (end < body.length && !/[.!?\n]/.test(body[end])) end += 1
  if (end < body.length && /[.!?]/.test(body[end])) end += 1
  while (end < body.length && /[”"']/.test(body[end])) end += 1
  return { start, end }
}

function rotateChoices(choices: string[], seed: number) {
  const offset = Math.abs(seed) % choices.length
  return [...choices.slice(offset), ...choices.slice(0, offset)]
}

function spellingPracticeTrials(
  word: string,
  original: string,
  correction: string,
  seed: number,
): WritingTrial[] {
  const extraMisspelling = `${original}${original.at(-1) ?? 'x'}`
  const frames = [
    (value: string) => `I wrote the word “${value}” in my notebook.`,
    (value: string) => `The word “${value}” appears on the page.`,
    (value: string) => `Please check the word “${value}” carefully.`,
  ]
  return frames.map((frame, index) => {
    const correctAnswer = frame(correction)
    return {
      id: `spelling-reviewed-${word}-${seed}-practice-${index + 1}`,
      prompt: `Choose the sentence that spells “${correction}” correctly.`,
      choices: rotateChoices(
        [correctAnswer, frame(original), frame(extraMisspelling)],
        seed + index,
      ),
      correctAnswer,
      explanation: `The reviewed spelling is “${correction}”.`,
    }
  })
}

function progressFor(progress: Record<string, SpellingProgress>, id: string): SpellingProgress {
  return progress[id] ?? {
    copyCompleted: 0,
    hiddenCompleted: 0,
    mixedCompleted: 0,
    incorrectAttempts: 0,
  }
}

export function inspectSpelling(
  body: string,
  dictionary: WritingDictionary = { knownNames: ['Fionnbar'], knownPlaces: [] },
): SpellingWord[] {
  const protectedWords = new Set(
    [...dictionary.knownNames, ...dictionary.knownPlaces]
      .flatMap((entry) => entry.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [])
      .map(normalizeWord),
  )
  const found = new Map<string, SpellingWord>()
  for (const match of body.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
    const actual = match[0]
    const word = normalizeWord(actual)
    const correctWord = NORMALIZED_MISSPELLINGS.get(word)
    if (!correctWord || protectedWords.has(word)) continue
    const id = `spelling-${word}-${normalizeWord(correctWord).replace(/[^a-z0-9]+/g, '-')}`
    const existing = found.get(id)
    if (existing) {
      existing.occurrences += 1
    } else {
      found.set(id, { id, word, correctWord, occurrences: 1 })
    }
  }
  return [...found.values()]
}

export function inspectSpellingFindings(
  body: string,
  dictionary: WritingDictionary = { knownNames: ['Fionnbar'], knownPlaces: [] },
): Finding[] {
  const protectedWords = new Set(
    [...dictionary.knownNames, ...dictionary.knownPlaces]
      .flatMap((entry) => entry.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [])
      .map(normalizeWord),
  )
  const findings: Finding[] = []
  for (const match of body.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
    const actual = match[0]
    const word = normalizeWord(actual)
    const rawCorrection = NORMALIZED_MISSPELLINGS.get(word)
    const start = match.index ?? 0
    if (!rawCorrection || protectedWords.has(word)) continue
    const replacement = preserveCase(actual, rawCorrection)
    const bounds = sentenceBounds(body, start)
    const original = body.slice(bounds.start, bounds.end)
    const relativeStart = start - bounds.start
    const corrected = `${original.slice(0, relativeStart)}${replacement}${original.slice(relativeStart + actual.length)}`
    let distractor = `${original.slice(0, relativeStart)}${replacement.toUpperCase()}${original.slice(relativeStart + actual.length)}`
    if (distractor === original || distractor === corrected) distractor = `${corrected}.`
    findings.push({
      id: `spelling-reviewed-${word}-${start}`,
      ruleId: `spelling-reviewed-${word}`,
      category: 'Spelling',
      message: `“${actual}” is a reviewed common misspelling.`,
      suggestion: `Spell it “${replacement}”.`,
      start,
      end: start + actual.length,
      replacement,
      correction: {
        id: `spelling-reviewed-${word}-${start}-correction`,
        prompt: 'Choose the sentence that corrects your spelling.',
        choices: rotateChoices([original, corrected, distractor], start),
        correctAnswer: corrected,
        explanation: `The reviewed spelling of “${actual}” is “${replacement}”.`,
      },
      practice: spellingPracticeTrials(word, actual, replacement, start),
    })
  }
  return findings
}

export function nextSpellingStep(
  words: SpellingWord[],
  progress: Record<string, SpellingProgress>,
): SpellingStep | null {
  for (const word of words) {
    const item = progressFor(progress, word.id)
    if (item.copyCompleted < SPELLING_REPETITIONS) {
      return {
        wordId: word.id,
        phase: 'copy',
        attempt: item.copyCompleted + 1,
        prompt: 'Look at the word, listen, and type it exactly.',
        visible: true,
      }
    }
    if (item.hiddenCompleted < SPELLING_REPETITIONS) {
      return {
        wordId: word.id,
        phase: 'hidden',
        attempt: item.hiddenCompleted + 1,
        prompt: 'Listen to the hidden word, then type it from memory.',
        visible: false,
      }
    }
  }

  for (let round = 0; round < SPELLING_REPETITIONS; round += 1) {
    for (const word of words) {
      const item = progressFor(progress, word.id)
      if (item.mixedCompleted <= round) {
        return {
          wordId: word.id,
          phase: 'mixed',
          attempt: round + 1,
          prompt: 'Mixed review: listen, then spell the hidden word.',
          visible: false,
        }
      }
    }
  }
  return null
}

export function submitSpellingAnswer(
  words: SpellingWord[],
  progress: Record<string, SpellingProgress>,
  step: SpellingStep,
  answer: string,
) {
  const word = words.find((item) => item.id === step.wordId)
  if (!word) throw new Error('Spelling word not found')
  const current = progressFor(progress, word.id)
  const correct = normalizeWord(answer) === normalizeWord(word.correctWord)
  const next = { ...current }
  if (!correct) {
    next.incorrectAttempts += 1
  } else if (step.phase === 'copy') {
    next.copyCompleted = Math.min(SPELLING_REPETITIONS, next.copyCompleted + 1)
  } else if (step.phase === 'hidden') {
    next.hiddenCompleted = Math.min(SPELLING_REPETITIONS, next.hiddenCompleted + 1)
  } else {
    next.mixedCompleted = Math.min(SPELLING_REPETITIONS, next.mixedCompleted + 1)
  }
  return { correct, progress: { ...progress, [word.id]: next } }
}

export function spellingPracticeComplete(
  words: SpellingWord[],
  progress: Record<string, SpellingProgress>,
) {
  return words.every((word) => {
    const item = progressFor(progress, word.id)
    return item.copyCompleted >= SPELLING_REPETITIONS &&
      item.hiddenCompleted >= SPELLING_REPETITIONS &&
      item.mixedCompleted >= SPELLING_REPETITIONS
  })
}

export function completedSpellingSteps(
  words: SpellingWord[],
  progress: Record<string, SpellingProgress>,
) {
  return words.reduce((total, word) => {
    const item = progressFor(progress, word.id)
    return total + Math.min(3, item.copyCompleted) + Math.min(3, item.hiddenCompleted) + Math.min(3, item.mixedCompleted)
  }, 0)
}

export function applyCompletedSpellingCorrections(
  body: string,
  words: SpellingWord[],
  progress: Record<string, SpellingProgress>,
) {
  return words.reduce((corrected, word) => {
    const item = progressFor(progress, word.id)
    if (item.copyCompleted < 3 || item.hiddenCompleted < 3 || item.mixedCompleted < 3) return corrected
    const pattern = new RegExp(`\\b${escapeRegex(word.word)}\\b`, 'gi')
    return corrected.replace(pattern, (match) => preserveCase(match, word.correctWord))
  }, body)
}

export const spellingPracticeAdapter = {
  inspect: inspectSpelling,
  nextStep: nextSpellingStep,
  submit: submitSpellingAnswer,
  complete: spellingPracticeComplete,
  completedSteps: completedSpellingSteps,
  applyCorrections: applyCompletedSpellingCorrections,
}
