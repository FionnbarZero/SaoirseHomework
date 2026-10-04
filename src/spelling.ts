import type { SpellingProgress, SpellingWord, WritingDictionary } from './domain'

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
  accomodate: 'accommodate',
  adress: 'address',
  alot: 'a lot',
  becuase: 'because',
  beleive: 'believe',
  begining: 'beginning',
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
  recieve: 'receive',
  recieved: 'received',
  seperate: 'separate',
  succesful: 'successful',
  teh: 'the',
  thier: 'their',
  tommorow: 'tomorrow',
  untill: 'until',
  wierd: 'weird',
  wich: 'which',
  writting: 'writing',
  studing: 'studying',
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
