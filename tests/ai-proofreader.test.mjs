import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAiProofreader,
  normalizeAiFindings,
  normalizeIntentReviews,
  normalizeAiMode,
  segmentWriting,
  sentenceWriting,
} from '../server/ai-proofreader.mjs'
import { inspectWritingFindings } from '../src/writing.ts'
import { buildLocalMeaningReviews } from '../server/meaning-review.mjs'

function responseWith(findings) {
  return {
    ok: true,
    async json() {
      return {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({ findings }) }],
        }],
      }
    },
  }
}

test('AI findings must quote an exact occurrence from the submitted passage', () => {
  const text = 'She walk home. She walk slowly.'
  const segments = segmentWriting(text)
  const findings = normalizeAiFindings([
    {
      segment: 1,
      operation: 'replace',
      original: 'She walk',
      occurrence: 2,
      replacement: 'She walks',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'subject verb',
      message: 'The subject and verb do not agree.',
      explanation: 'A singular subject needs a matching present-tense verb.',
    },
    {
      segment: 1,
      operation: 'replace',
      original: 'words that are not present',
      occurrence: 1,
      replacement: 'replacement',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'invented',
      message: 'Bad location.',
      explanation: 'This must be discarded.',
    },
  ], text, segments)

  assert.equal(findings.length, 1)
  assert.equal(text.slice(findings[0].start, findings[0].end), 'walk')
  assert.equal(findings[0].start, text.lastIndexOf('walk'))
  assert.equal(findings[0].issueCode, 'subject-verb')
})

test('guided practice uses independent detection and verification before exposing a correction', async () => {
  const requests = []
  const proofreader = createAiProofreader({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      const request = { url, options, body: JSON.parse(options.body) }
      requests.push(request)
      const verification = request.body.text.format.name === 'child_writing_verification'
      return responseWith([
        {
          segment: 1,
          operation: 'replace',
          original: 'she walk',
          occurrence: 1,
          replacement: 'She walks',
          category: 'grammar',
          confidence: 'high',
          issue_code: 'subject-verb-agreement',
          message: 'The sentence needs a capital and a matching verb.',
          explanation: 'A sentence begins with a capital, and “she” needs “walks.”',
          ...(verification ? { disposition: 'verified', based_on_candidate_ids: ['lt-0'] } : {}),
        },
        {
          segment: 1,
          operation: 'insert_after',
          original: 'home',
          occurrence: 1,
          replacement: '.',
          category: 'punctuation',
          confidence: 'medium',
          issue_code: 'possible-period',
          message: 'This may need an ending mark.',
          explanation: 'A complete sentence usually ends with punctuation.',
          ...(verification ? { disposition: 'review', based_on_candidate_ids: [] } : {}),
        },
      ])
    },
  })

  const result = await proofreader.check('she walk home', 'assist')

  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key')
  assert.equal(requests[0].body.model, 'test-model')
  assert.equal(requests.every((request) => request.body.store === false), true)
  assert.deepEqual(requests.map((request) => request.body.text.format.name), [
    'child_writing_detection',
    'child_writing_verification',
  ])
  assert.equal(requests.every((request) => request.body.text.format.strict === true), true)
  assert.deepEqual(result.counts, { total: 3, practice: 2, review: 1, ignored: 0 })
  assert.equal(result.matches[0].offset, 0)
  assert.equal(result.matches[0].replacements[0], 'She')
  assert.equal(result.matches[1].replacements[0], 'walks')
  assert.equal(result.matches[0].verification, 'verified')
  assert.equal(result.reviewItems[0].source, 'ai')
  assert.equal(result.reviewItems[0].confidence, 'medium')
  assert.equal(result.reviewItems[0].start, 'she walk home'.length)
})

test('shadow mode returns counts but does not expose findings', async () => {
  const proofreader = createAiProofreader({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      const verification = JSON.parse(options.body).text.format.name === 'child_writing_verification'
      return responseWith([{
      segment: 1,
      operation: 'replace',
      original: 'walk',
      occurrence: 1,
      replacement: 'walks',
      category: 'grammar',
      confidence: 'high',
      issue_code: 'agreement',
      message: 'The verb does not agree.',
      explanation: 'Use a matching singular verb.',
      ...(verification ? { disposition: 'verified', based_on_candidate_ids: [] } : {}),
    }])
    },
  })

  const result = await proofreader.check('She walk.', 'shadow')
  assert.equal(result.analyzed, true)
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.reviewItems, [])
  assert.deepEqual(result.counts, { total: 1, practice: 0, review: 0, ignored: 1 })
})

test('unconfigured AI and invalid modes fail closed without a network request', async () => {
  let called = false
  const proofreader = createAiProofreader({
    fetchImpl: async () => {
      called = true
      throw new Error('should not run')
    },
  })

  assert.equal(normalizeAiMode('anything'), 'off')
  const result = await proofreader.check('She walk.', 'review')
  assert.equal(result.available, false)
  assert.equal(result.analyzed, false)
  assert.equal(called, false)
  assert.match(result.error, /API key and model/)
})

test('meaning review returns three exact sentence interpretations and highlighted uncertainty', () => {
  const text = 'harry and ron walks.'
  const edit = (original, replacement, category = 'capitalization') => ({
    operation: 'replace', original, occurrence: 1, replacement, category,
    message: `Correct ${original}.`, explanation: 'Use the form that matches the intended sentence.',
  })
  const reviews = normalizeIntentReviews([{
    segment: 1,
    uncertain_parts: [
      { original: 'harry', occurrence: 1 },
      { original: 'ron', occurrence: 1 },
      { original: 'walks', occurrence: 1 },
    ],
    options: [
      { text: 'Harry and Ron walk.', edits: [edit('harry', 'Harry'), edit('ron', 'Ron'), edit('walks', 'walk', 'grammar')] },
      { text: 'Harry and Ron walked.', edits: [edit('harry', 'Harry'), edit('ron', 'Ron'), edit('walks', 'walked', 'grammar')] },
      { text: 'Harry and Ron are walking.', edits: [edit('harry', 'Harry'), edit('ron', 'Ron'), edit('walks', 'are walking', 'grammar')] },
    ],
  }], text, sentenceWriting(text))

  assert.equal(reviews.length, 1)
  assert.deepEqual(reviews[0].options.map((option) => option.text), [
    'Harry and Ron walk.',
    'Harry and Ron walked.',
    'Harry and Ron are walking.',
  ])
  assert.deepEqual(reviews[0].highlights, [
    { start: 0, end: 5 },
    { start: 10, end: 13 },
    { start: 14, end: 19 },
  ])
})

test('local meaning review offers three candidate interpretations when AI is unavailable', () => {
  const text = 'harry and ron walks to qidch.'
  const findings = [
    { start: 0, end: 5, replacement: 'Harry', category: 'Capitalization', message: 'Capitalize Harry.', suggestion: 'Names begin with capitals.' },
    { start: 10, end: 13, replacement: 'Ron', category: 'Capitalization', message: 'Capitalize Ron.', suggestion: 'Names begin with capitals.' },
    { start: 14, end: 19, replacement: 'walk', category: 'Grammar', message: 'Use walk.', suggestion: 'A plural subject uses walk.' },
  ]
  const candidateStart = text.indexOf('qidch')
  const reviews = buildLocalMeaningReviews(text, findings, [{
    offset: candidateStart,
    length: 5,
    replacements: ['Quidditch', 'ditch', 'witch'],
    ruleId: 'MORFOLOGIK_RULE_EN_US',
    category: 'Possible Typo',
    issueType: 'misspelling',
    message: 'Possible spelling mistake.',
  }])

  assert.equal(reviews.length, 1)
  assert.deepEqual(reviews[0].options.map((option) => option.text), [
    'Harry and Ron walk to Quidditch.',
    'Harry and Ron walk to ditch.',
    'Harry and Ron walk to witch.',
  ])
  assert.equal(reviews[0].highlights.length, 4)
})

test('local meaning review highlights an uncertain companion list as one readable chunk', () => {
  const text = 'harry adn ron walks to qidch practise with ann billy and tiloAnn said I want the new broomed"'
  const uncertainName = text.indexOf('tiloAnn')
  const reviews = buildLocalMeaningReviews(text, inspectWritingFindings(text), [{
    offset: uncertainName,
    length: 'tiloAnn'.length,
    replacements: ['Mike', 'Tilo Ann', 'Tilo'],
    ruleId: 'MORFOLOGIK_RULE_EN_US',
    category: 'Possible Typo',
    issueType: 'misspelling',
    message: 'Possible spelling mistake.',
  }])
  const phraseStart = text.indexOf('ann billy')
  const phraseEnd = uncertainName + 'tiloAnn'.length

  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].highlights.some((range) => range.start <= phraseStart && range.end >= phraseEnd), true)
  assert.equal(reviews[0].options.every((option) => option.text.includes('Harry and Ron walk to Quidditch practice')), true)

  const retry = buildLocalMeaningReviews(text, inspectWritingFindings(text), [{
    offset: uncertainName,
    length: 'tiloAnn'.length,
    replacements: ['Mike', 'Tilo Ann', 'Tilo'],
    ruleId: 'MORFOLOGIK_RULE_EN_US',
    category: 'Possible Typo',
    issueType: 'misspelling',
    message: 'Possible spelling mistake.',
  }], {
    attempt: 2,
    rejectedOptions: reviews[0].options.map((option) => option.text),
  })
  assert.equal(retry.length, 1)
  assert.equal(retry[0].options.every((option) => !reviews[0].options.some((first) => first.text === option.text)), true)
})

test('the verified workflow repairs the Harry passage without corrupting contextual words or names', async () => {
  const body = 'Hermiony wants to take more classese than tshe shoudl so she asks professor mcgonagal for a time turner. the tien turner let\'s her go abck in time and redo things. Noone knows she has it. In classs buckbeak hurst malfoy cause malfoy was being mean. Hagrid get ssuspended and buckbeak will be kills. Hermine used the time turner to go back in time She rescused buck beak and harry finds out about Aragog. '
  const expected = 'Hermione wants to take more classes than she should, so she asks Professor McGonagall for a Time-Turner. The Time-Turner lets her go back in time and redo things. No one knows she has it. In class, Buckbeak hurts Malfoy because Malfoy was being mean. Hagrid gets suspended, and Buckbeak will be killed. Hermione uses the Time-Turner to go back in time. She rescues Buckbeak, and Harry finds out about Aragog. '
  const edit = (original, replacement, occurrence = 1, category = 'spelling', operation = 'replace') => ({
    segment: 1,
    operation,
    original,
    occurrence,
    replacement,
    category,
    confidence: 'high',
    issue_code: `${category}-${original.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${occurrence}`,
    message: `Correct “${original}”.`,
    explanation: 'Use the form that fits the meaning and grammar of the complete passage.',
  })
  const detectorFindings = [
    edit('Hermiony', 'Hermione'),
    edit('classese', 'classes'),
    edit('tshe', 'she'),
    edit('shoudl so', 'should, so', 1, 'punctuation'),
    edit('professor', 'Professor', 1, 'capitalization'),
    edit('mcgonagal', 'McGonagall'),
    edit('time turner', 'Time-Turner', 1),
    edit('the tien turner', 'The Time-Turner'),
    edit("let's", 'lets', 1, 'grammar'),
    edit('abck', 'back'),
    edit('Noone', 'No one'),
    edit('In classs', 'In class,', 1, 'punctuation'),
    edit('buckbeak', 'Buckbeak', 1, 'capitalization'),
    edit('hurst', 'hurts', 1, 'grammar'),
    edit('malfoy', 'Malfoy', 1, 'capitalization'),
    edit('cause', 'because', 1, 'grammar'),
    edit('malfoy', 'Malfoy', 2, 'capitalization'),
    edit('get', 'gets', 1, 'grammar'),
    edit('ssuspended', 'suspended'),
    edit(' and buckbeak', ', and Buckbeak', 1, 'punctuation'),
    edit('kills', 'killed', 1, 'grammar'),
    edit('Hermine', 'Hermione'),
    edit('used', 'uses', 1, 'grammar'),
    edit('time turner', 'Time-Turner', 2),
    edit('time She', 'time. She', 1, 'punctuation'),
    edit('rescused', 'rescues', 1, 'grammar'),
    edit('buck beak', 'Buckbeak', 1, 'capitalization'),
    edit(' and harry', ', and Harry', 1, 'punctuation'),
  ]
  const proofreader = createAiProofreader({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      const verification = JSON.parse(options.body).text.format.name === 'child_writing_verification'
      return responseWith(detectorFindings.map((finding, index) => verification
        ? { ...finding, disposition: 'verified', based_on_candidate_ids: [`candidate-${index}`] }
        : finding))
    },
  })

  const result = await proofreader.check(body, 'assist', [{
    offset: body.indexOf('Noone'),
    length: 'Noone'.length,
    replacements: ['None', 'No one'],
    ruleId: 'MORFOLOGIK_RULE_EN_US',
    category: 'Possible Typo',
    issueType: 'misspelling',
    message: 'Possible spelling mistake found.',
  }])
  const corrected = [...result.matches]
    .sort((left, right) => right.offset - left.offset)
    .reduce((text, match) => (
      `${text.slice(0, match.offset)}${match.replacements[0]}${text.slice(match.offset + match.length)}`
    ), body)

  assert.equal(corrected, expected)
  assert.equal(result.matches.every((match) => match.verification === 'verified'), true)
  assert.equal(result.matches.some((match) => match.replacements.includes('None')), false)
  assert.equal(result.matches.some((match) => match.replacements.includes('Aragon')), false)
  const quizFindings = inspectWritingFindings(body, undefined, result.matches)
  const externalQuizFindings = quizFindings.filter((finding) => finding.ruleId.startsWith('proofreading-'))
  assert.equal(externalQuizFindings.length > 0, true)
  assert.equal(externalQuizFindings.every((finding) => finding.correction.choices.length === 2), true)
  assert.equal(externalQuizFindings.every((finding) => (
    finding.correction.choices.includes(finding.correction.correctAnswer)
  )), true)
  assert.equal(quizFindings.some((finding) => ['None', 'Aragon', 'Hurst', 'then'].includes(finding.replacement)), false)
})
