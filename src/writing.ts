import type { Finding, FindingProgress, WritingTrial } from './domain'

type Category = Finding['category']

type FindingInput = {
  ruleId: string
  category: Category
  message: string
  suggestion: string
  start: number
  end: number
  replacement: string
  wrongReplacement?: string
}

const PRACTICE: Record<Category, WritingTrial[]> = {
  Grammar: [
    trial('grammar-1', 'Choose the sentence with correct subject–verb agreement.', 'Every afternoon, she walks home.', 'Every afternoon, she walk home.', 'Every afternoon, she walking home.'),
    trial('grammar-2', 'Choose the sentence with correct subject–verb agreement.', 'After school, they play outside.', 'After school, they plays outside.', 'After school, they playing outside.'),
    trial('grammar-3', 'Choose the sentence with the correct article.', 'I ate an apple.', 'I ate a apple.', 'I ate an apples.'),
    trial('grammar-4', 'Choose the sentence with consistent past tense.', 'Yesterday, we visited the library.', 'Yesterday, we visit the library.', 'Yesterday, we visiting the library.'),
    trial('grammar-5', 'Choose the sentence with matching singular and plural words.', 'These books belong on the shelf.', 'This books belong on the shelf.', 'These book belong on the shelf.'),
  ],
  Punctuation: [
    trial('punctuation-1', 'Choose the statement with the correct ending mark.', 'The science project is finished.', 'The science project is finished', 'The science project is finished..'),
    trial('punctuation-2', 'Choose the question with the correct ending mark.', 'Where did I put my notebook?', 'Where did I put my notebook.', 'Where did I put my notebook'),
    trial('punctuation-3', 'Choose the sentence with the introductory comma.', 'After I finished my work, I played outside.', 'After I finished my work I played outside.', 'After, I finished my work I played outside.'),
    trial('punctuation-4', 'Choose the sentence with the correct apostrophe.', 'I don’t need help yet.', 'I dont need help yet.', 'I don’’t need help yet.'),
    trial('punctuation-5', 'Choose the sentence with paired quotation marks.', 'Maya said, “Let’s begin.”', 'Maya said, “Let’s begin.', 'Maya said, Let’s begin.”'),
  ],
  Capitalization: [
    trial('capitalization-1', 'Choose the sentence that begins correctly.', 'The dog waited by the door.', 'the dog waited by the door.', 'THe dog waited by the door.'),
    trial('capitalization-2', 'Choose the sentence that capitalizes the pronoun I.', 'My sister and I made dinner.', 'My sister and i made dinner.', 'My sister and I Made dinner.'),
    trial('capitalization-3', 'Choose the sentence that capitalizes the day.', 'Our lesson is on Monday.', 'Our lesson is on monday.', 'Our lesson is on MONday.'),
    trial('capitalization-4', 'Choose the sentence that capitalizes the month.', 'School begins in August.', 'School begins in august.', 'School begins in AUgust.'),
    trial('capitalization-5', 'Choose the sentence that capitalizes the title.', 'Dr. Lee read our stories.', 'dr. Lee read our stories.', 'DR. Lee read our stories.'),
  ],
}

function trial(id: string, prompt: string, correct: string, wrongOne: string, wrongTwo: string): WritingTrial {
  const choices = Number(id.at(-1)) % 2 === 0
    ? [wrongOne, correct, wrongTwo]
    : [correct, wrongTwo, wrongOne]
  return {
    id,
    prompt,
    choices,
    correctAnswer: correct,
    explanation: 'That choice follows the rule in the prompt.',
  }
}

function sentenceBounds(body: string, index: number) {
  let start = index
  while (start > 0 && !/[.!?\n]/.test(body[start - 1])) start -= 1
  while (start < body.length && /\s/.test(body[start])) start += 1
  let end = index
  while (end < body.length && !/[.!?\n]/.test(body[end])) end += 1
  if (end < body.length && /[.!?]/.test(body[end])) end += 1
  return { start, end }
}

function rotateChoices(choices: string[], seed: number) {
  const offset = Math.abs(seed) % choices.length
  return [...choices.slice(offset), ...choices.slice(0, offset)]
}

function correctionTrial(body: string, input: FindingInput): WritingTrial {
  const bounds = sentenceBounds(body, input.start)
  const original = body.slice(bounds.start, bounds.end)
  const relativeStart = input.start - bounds.start
  const relativeEnd = input.end - bounds.start
  const corrected = `${original.slice(0, relativeStart)}${input.replacement}${original.slice(relativeEnd)}`
  const wrongReplacement = input.wrongReplacement ?? input.replacement.toUpperCase()
  let distractor = `${original.slice(0, relativeStart)}${wrongReplacement}${original.slice(relativeEnd)}`
  if (distractor === original || distractor === corrected) distractor = `${corrected}.”`
  const choices = rotateChoices([...new Set([original, corrected, distractor])], input.start)
  while (choices.length < 3) choices.push(`${corrected}.`)
  return {
    id: `${input.ruleId}-${input.start}-correction`,
    prompt: 'Choose the best correction for your original sentence.',
    choices,
    correctAnswer: corrected,
    explanation: input.suggestion,
  }
}

function addFinding(body: string, findings: Finding[], input: FindingInput) {
  const overlaps = findings.some((finding) => input.start < finding.end && input.end > finding.start)
  if (overlaps) return
  findings.push({
    ...input,
    id: `${input.ruleId}-${input.start}`,
    correction: correctionTrial(body, input),
    practice: PRACTICE[input.category].map((item) => ({ ...item, choices: [...item.choices] })),
  })
}

function capitalizeLike(value: string, replacement: string) {
  return /^[A-Z]/.test(value) ? `${replacement[0].toUpperCase()}${replacement.slice(1)}` : replacement
}

export function inspectDraft(body: string): Finding[] {
  const findings: Finding[] = []
  if (!body.trim()) return findings

  let match: RegExpExecArray | null

  const yesterdayPattern = /\bYesterday,?\s+(I|he|she|we|they)\s+(walk|play|jump|cook|look|visit)\b/gi
  const pastTense: Record<string, string> = {
    walk: 'walked', play: 'played', jump: 'jumped', cook: 'cooked', look: 'looked', visit: 'visited',
  }
  while ((match = yesterdayPattern.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].toLowerCase().lastIndexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, pastTense[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'tense-yesterday', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `“Yesterday” needs a past-tense verb, not “${verb}”.`,
      suggestion: `Use “${replacement}” to keep the sentence in past tense.`,
      wrongReplacement: `${replacement}ing`,
    })
  }

  const thirdPerson = /\b(he|she|it)\s+(walk|run|jump|play|write|read|eat|make|do|have|go|study)\b/gi
  const thirdPersonForms: Record<string, string> = {
    walk: 'walks', run: 'runs', jump: 'jumps', play: 'plays', write: 'writes', read: 'reads',
    eat: 'eats', make: 'makes', do: 'does', have: 'has', go: 'goes', study: 'studies',
  }
  while ((match = thirdPerson.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].toLowerCase().lastIndexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, thirdPersonForms[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'subject-verb-singular', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `“${match[1]}” needs a matching singular verb.`,
      suggestion: `Use “${replacement}”.`, wrongReplacement: `${verb}ing`,
    })
  }

  const pluralPerson = /\b(I|you|we|they)\s+(walks|runs|jumps|plays|writes|reads|eats|makes|does|has|goes|studies)\b/gi
  const baseForms: Record<string, string> = {
    walks: 'walk', runs: 'run', jumps: 'jump', plays: 'play', writes: 'write', reads: 'read',
    eats: 'eat', makes: 'make', does: 'do', has: 'have', goes: 'go', studies: 'study',
  }
  while ((match = pluralPerson.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].toLowerCase().lastIndexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, baseForms[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'subject-verb-plural', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `“${match[1]}” needs a matching base-form verb.`,
      suggestion: `Use “${replacement}”.`, wrongReplacement: `${replacement}ing`,
    })
  }

  const vowelWords = 'apple|egg|orange|idea|animal|elephant|umbrella|octopus|answer'
  const aBeforeVowel = new RegExp(`\\b(a)\\s+(${vowelWords})\\b`, 'gi')
  while ((match = aBeforeVowel.exec(body)) !== null) {
    const replacement = capitalizeLike(match[1], 'an')
    addFinding(body, findings, {
      ruleId: 'article-an', category: 'Grammar', start: match.index, end: match.index + 1, replacement,
      message: `Use “an” before “${match[2]}”.`, suggestion: 'Use “an” before a vowel sound.', wrongReplacement: 'the',
    })
  }

  const consonantWords = 'book|cat|dog|game|story|pencil|teacher|student|banana|table'
  const anBeforeConsonant = new RegExp(`\\b(an)\\s+(${consonantWords})\\b`, 'gi')
  while ((match = anBeforeConsonant.exec(body)) !== null) {
    const replacement = capitalizeLike(match[1], 'a')
    addFinding(body, findings, {
      ruleId: 'article-a', category: 'Grammar', start: match.index, end: match.index + match[1].length,
      replacement, message: `Use “a” before “${match[2]}”.`,
      suggestion: 'Use “a” before a consonant sound.', wrongReplacement: 'the',
    })
  }

  const pluralNouns = 'books|dogs|cats|games|stories|apples|ideas'
  const singularDemonstrative = new RegExp(`\\b(this|that)\\s+(${pluralNouns})\\b`, 'gi')
  while ((match = singularDemonstrative.exec(body)) !== null) {
    const replacement = match[1].toLowerCase() === 'this' ? 'these' : 'those'
    addFinding(body, findings, {
      ruleId: 'demonstrative-agreement', category: 'Grammar', start: match.index,
      end: match.index + match[1].length, replacement: capitalizeLike(match[1], replacement),
      message: `“${match[1]}” does not match the plural word “${match[2]}”.`,
      suggestion: `Use “${replacement}”.`, wrongReplacement: 'the',
    })
  }

  const singularReflexive = /\b(he|she)\s+(made|helped|taught|hurt|introduced)\s+themselves\b/gi
  while ((match = singularReflexive.exec(body)) !== null) {
    const pronoun = match[1].toLowerCase() === 'he' ? 'himself' : 'herself'
    const relative = match[0].toLowerCase().lastIndexOf('themselves')
    const start = match.index + relative
    addFinding(body, findings, {
      ruleId: 'pronoun-agreement', category: 'Grammar', start, end: start + 'themselves'.length,
      replacement: pronoun, message: `“${match[1]}” does not match “themselves”.`,
      suggestion: `Use “${pronoun}”.`, wrongReplacement: `${pronoun}s`,
    })
  }

  const sentenceCapital = /(^|[.!?]\s+|\n\s*)([a-z])/gm
  while ((match = sentenceCapital.exec(body)) !== null) {
    const letter = match[2]
    const start = match.index + match[1].length
    if (/^(dont|cant|wont|isnt|wasnt|didnt|im|ive|youre|theyre)\b/i.test(body.slice(start))) continue
    addFinding(body, findings, {
      ruleId: 'sentence-capital', category: 'Capitalization', start, end: start + 1,
      replacement: letter.toUpperCase(), message: `A sentence begins with “${letter}”.`,
      suggestion: `Start it with “${letter.toUpperCase()}”.`, wrongReplacement: `${letter.toUpperCase()}${letter}`,
    })
  }

  const pronounI = /\bi\b/g
  while ((match = pronounI.exec(body)) !== null) {
    addFinding(body, findings, {
      ruleId: 'pronoun-i', category: 'Capitalization', start: match.index, end: match.index + 1,
      replacement: 'I', message: 'The pronoun “I” is always capitalized.', suggestion: 'Change “i” to “I”.',
      wrongReplacement: 'II',
    })
  }

  const calendarWords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const calendarPattern = new RegExp(`\\b(${calendarWords.join('|')})\\b`, 'g')
  while ((match = calendarPattern.exec(body)) !== null) {
    const replacement = `${match[1][0].toUpperCase()}${match[1].slice(1)}`
    addFinding(body, findings, {
      ruleId: 'calendar-capital', category: 'Capitalization', start: match.index,
      end: match.index + match[1].length, replacement,
      message: `“${match[1]}” is a day or month.`, suggestion: `Capitalize it as “${replacement}”.`,
      wrongReplacement: match[1].toUpperCase(),
    })
  }

  const titlePattern = /\b(mr|mrs|ms|dr)\.\s+[A-Z][a-z]+/g
  while ((match = titlePattern.exec(body)) !== null) {
    const title = match[1]
    addFinding(body, findings, {
      ruleId: 'title-capital', category: 'Capitalization', start: match.index,
      end: match.index + title.length, replacement: `${title[0].toUpperCase()}${title.slice(1)}`,
      message: `The title “${title}.” needs a capital letter.`,
      suggestion: `Write “${title[0].toUpperCase()}${title.slice(1)}.”`, wrongReplacement: title.toUpperCase(),
    })
  }

  const contractions: Record<string, string> = {
    dont: 'don’t', cant: 'can’t', wont: 'won’t', isnt: 'isn’t', wasnt: 'wasn’t',
    didnt: 'didn’t', im: 'I’m', ive: 'I’ve', youre: 'you’re', theyre: 'they’re',
  }
  const contractionPattern = new RegExp(`\\b(${Object.keys(contractions).join('|')})\\b`, 'gi')
  while ((match = contractionPattern.exec(body)) !== null) {
    const mapped = contractions[match[1].toLowerCase()]
    const atSentenceStart = sentenceBounds(body, match.index).start === match.index
    const replacement = atSentenceStart
      ? `${mapped[0].toUpperCase()}${mapped.slice(1)}`
      : capitalizeLike(match[1], mapped)
    addFinding(body, findings, {
      ruleId: 'contraction-apostrophe', category: 'Punctuation', start: match.index,
      end: match.index + match[1].length, replacement,
      message: `“${match[1]}” needs an apostrophe.`, suggestion: `Write “${replacement}”.`,
      wrongReplacement: replacement.replace('’', '’’'),
    })
  }

  const introPattern = /(^|[.!?]\s+)(After|Before|When|While|If)\s+(I|we|he|she|they)\s+\w+(?:\s+\w+){0,2}\s+(I|we|he|she|they)\s/gi
  while ((match = introPattern.exec(body)) !== null) {
    const needle = ` ${match[4]} `
    const local = match[0].toLowerCase().lastIndexOf(needle.toLowerCase())
    const start = match.index + local
    addFinding(body, findings, {
      ruleId: 'intro-comma', category: 'Punctuation', start, end: start + 1, replacement: ', ',
      message: `The introductory “${match[2]}” clause needs a comma.`,
      suggestion: 'Add a comma after the introductory clause.', wrongReplacement: ',, ',
    })
  }

  const listPattern = /\b(I (?:packed|brought|saw|like)) ([a-z]+) ([a-z]+) and ([a-z]+)\b/gi
  while ((match = listPattern.exec(body)) !== null) {
    const start = match.index
    const replacement = `${match[1]} ${match[2]}, ${match[3]}, and ${match[4]}`
    addFinding(body, findings, {
      ruleId: 'simple-list-commas', category: 'Punctuation', start, end: start + match[0].length,
      replacement, message: 'A simple list of three items needs commas.',
      suggestion: 'Separate the three listed items with commas.',
      wrongReplacement: `${match[1]}, ${match[2]} ${match[3]} and ${match[4]}`,
    })
  }

  const quoteCount = [...body].filter((character) => character === '“' || character === '”' || character === '"').length
  if (quoteCount % 2 === 1) {
    const end = body.trimEnd().length
    addFinding(body, findings, {
      ruleId: 'paired-quotes', category: 'Punctuation', start: end, end, replacement: '”',
      message: 'A quotation mark does not have a matching partner.',
      suggestion: 'Add the closing quotation mark.', wrongReplacement: '””',
    })
  }

  const trimmedEnd = body.trimEnd().length
  if (trimmedEnd > 0 && !/[.!?”"']$/.test(body.slice(0, trimmedEnd))) {
    addFinding(body, findings, {
      ruleId: 'terminal-punctuation', category: 'Punctuation', start: trimmedEnd, end: trimmedEnd,
      replacement: '.', message: 'The final sentence needs an ending mark.',
      suggestion: 'Add a period, question mark, or exclamation mark.', wrongReplacement: '..',
    })
  }

  return findings.sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
}

export function applyCompletedCorrections(
  body: string,
  findings: Finding[],
  progress: Record<string, FindingProgress>,
) {
  return findings
    .filter((finding) => progress[finding.id]?.correctionComplete)
    .sort((left, right) => right.start - left.start)
    .reduce(
      (corrected, finding) => `${corrected.slice(0, finding.start)}${finding.replacement}${corrected.slice(finding.end)}`,
      body,
    )
}

export function advanceFindingProgress(
  current: FindingProgress | undefined,
  correct: boolean,
  practiceTarget = 5,
): FindingProgress {
  const progress = current ?? { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }
  if (!correct) return { ...progress, incorrectAttempts: progress.incorrectAttempts + 1 }
  if (!progress.correctionComplete) return { ...progress, correctionComplete: true }
  return { ...progress, practiceCompleted: Math.min(practiceTarget, progress.practiceCompleted + 1) }
}

export function writingReviewStatus(
  findings: Finding[],
  progress: Record<string, FindingProgress>,
): 'practice' | 'spelling-pending' {
  const complete = findings.every((finding) => {
    const item = progress[finding.id]
    return item?.correctionComplete && item.practiceCompleted >= finding.practice.length
  })
  return complete ? 'spelling-pending' : 'practice'
}
