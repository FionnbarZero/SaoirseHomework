function nthIndexOf(text, search, occurrence = 1) {
  let index = -1
  let from = 0
  for (let count = 0; count < occurrence; count += 1) {
    index = text.indexOf(search, from)
    if (index < 0) throw new Error(`Fixture text does not contain occurrence ${occurrence} of ${search}`)
    from = index + Math.max(1, search.length)
  }
  return index
}

function example(id, text, corrections = []) {
  const edits = corrections.map((correction) => {
    const start = nthIndexOf(text, correction.original, correction.occurrence)
    return {
      start,
      end: start + correction.original.length,
      replacement: correction.replacement,
    }
  })
  const expectedText = [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((value, edit) => (
      `${value.slice(0, edit.start)}${edit.replacement}${value.slice(edit.end)}`
    ), text)
  return { id, text, expectedText, edits }
}

const cases = []

const capitalStarts = [
  'the dog ran.', 'my class read quietly.', 'after lunch we played.', 'today is sunny.', 'we found a shell.',
  'everyone cheered.', 'our team practiced.', 'this book is funny.', 'she opened the door.', 'he finished early.',
  'a bird landed.', 'the rain stopped.', 'tomorrow is Monday.', 'because it rained, we stayed inside.', 'when the bell rang, we left.',
  'first we mixed the paint.', 'finally the bus arrived.', 'sometimes I draw.', 'during recess we talked.', 'before bed I read.',
]
for (const [index, text] of capitalStarts.entries()) {
  cases.push(example(`capital-start-${index + 1}`, text, [{ original: text[0], replacement: text[0].toUpperCase() }]))
}

const singularSubjects = ['She', 'He', 'The dog', 'My friend', 'A bird']
const singularVerbs = [['walk', 'walks'], ['play', 'plays'], ['run', 'runs'], ['eat', 'eats'], ['need', 'needs']]
for (const subject of singularSubjects) {
  for (const [base, corrected] of singularVerbs) {
    const text = `${subject} ${base} after school.`
    cases.push(example(`agreement-${cases.length + 1}`, text, [{ original: base, replacement: corrected }]))
  }
}

const spellingPairs = [
  ['freind', 'friend'], ['becuase', 'because'], ['recieve', 'receive'], ['definately', 'definitely'],
  ['seperate', 'separate'], ['wierd', 'weird'], ['thier', 'their'], ['writting', 'writing'],
  ['alot', 'a lot'], ['tommorow', 'tomorrow'], ['untill', 'until'], ['agian', 'again'],
  ['classese', 'classes'], ['shoudl', 'should'], ['abck', 'back'], ['bueatiful', 'beautiful'],
  ['ssuspended', 'suspended'], ['rescused', 'rescued'], ['teh', 'the'], ['dont', 'don’t'],
  ['cant', 'can’t'], ['wont', 'won’t'], ['goverment', 'government'], ['begining', 'beginning'],
  ['occured', 'occurred'],
]
for (const [index, [wrong, correct]] of spellingPairs.entries()) {
  const text = `I wrote ${wrong} in my response.`
  cases.push(example(`spelling-${index + 1}`, text, [{ original: wrong, replacement: correct }]))
}

const questions = [
  'Why did the dog run.', 'Where is my notebook.', 'When does class begin.', 'How did you solve it.', 'Who opened the window.',
  'What happened next.', 'Did Maya finish.', 'Can we go outside.', 'Are you ready.', 'Would you help me.',
]
for (const [index, text] of questions.entries()) {
  cases.push(example(`question-mark-${index + 1}`, text, [{ original: '.', replacement: '?' }]))
}

const compounds = [
  ['I was tired so I went home.', 'tired so', 'tired, so'],
  ['It was raining so we stayed inside.', 'raining so', 'raining, so'],
  ['The bell rang and the students left.', 'rang and', 'rang, and'],
  ['Maya studied hard so she passed.', 'hard so', 'hard, so'],
  ['I opened the book but the page was missing.', 'book but', 'book, but'],
  ['The dog barked and the baby woke up.', 'barked and', 'barked, and'],
  ['We hurried but the bus had left.', 'hurried but', 'hurried, but'],
  ['Dad cooked dinner and I washed the dishes.', 'dinner and', 'dinner, and'],
  ['The sun came out so the field dried.', 'out so', 'out, so'],
  ['I wanted to stay but it was late.', 'stay but', 'stay, but'],
]
for (const [index, [text, original, replacement]] of compounds.entries()) {
  cases.push(example(`compound-comma-${index + 1}`, text, [{ original, replacement }]))
}

const introductions = [
  ['After dinner we played outside.', 'After dinner', 'After dinner,'],
  ['Before school I packed my lunch.', 'Before school', 'Before school,'],
  ['During recess we practiced soccer.', 'During recess', 'During recess,'],
  ['In the morning the streets were quiet.', 'In the morning', 'In the morning,'],
  ['At the park we saw a hawk.', 'At the park', 'At the park,'],
  ['When the movie ended we went home.', 'When the movie ended', 'When the movie ended,'],
  ['Because I studied I knew the answer.', 'Because I studied', 'Because I studied,'],
  ['Although it was cold we walked.', 'Although it was cold', 'Although it was cold,'],
  ['If it rains we will stay inside.', 'If it rains', 'If it rains,'],
  ['While Dad cooked I set the table.', 'While Dad cooked', 'While Dad cooked,'],
]
for (const [index, [text, original, replacement]] of introductions.entries()) {
  cases.push(example(`intro-comma-${index + 1}`, text, [{ original, replacement }]))
}

const noOneCases = [
  'Noone knows the answer.', 'Noone saw the fox.', 'Noone heard the bell.', 'Noone was waiting.', 'Noone found the key.',
  'Noone entered the room.', 'Noone expected rain.', 'Noone remembered the map.', 'Noone opened the box.', 'Noone called my name.',
]
for (const [index, text] of noOneCases.entries()) {
  cases.push(example(`no-one-${index + 1}`, text, [{ original: 'Noone', replacement: 'No one' }]))
}

const contextualWords = [
  ['Their going home.', 'Their', 'They’re'],
  ['Put the bag over they’re.', 'they’re', 'there'],
  ['The dog wagged it’s tail.', 'it’s', 'its'],
  ['Its raining outside.', 'Its', 'It’s'],
  ['I want to go to.', 'to', 'too'],
  ['Your going to win.', 'Your', 'You’re'],
  ['The book is over their.', 'their', 'there'],
  ['We ate are lunch.', 'are', 'our'],
  ['I can here music.', 'here', 'hear'],
  ['She new the answer.', 'new', 'knew'],
]
for (const [index, [text, original, replacement]] of contextualWords.entries()) {
  cases.push(example(`context-word-${index + 1}`, text, [{ original, replacement }]))
}

const pastTense = [
  ['go', 'went'], ['see', 'saw'], ['eat', 'ate'], ['run', 'ran'], ['write', 'wrote'],
  ['take', 'took'], ['make', 'made'], ['come', 'came'], ['buy', 'bought'], ['think', 'thought'],
]
for (const [index, [present, past]] of pastTense.entries()) {
  const text = `Yesterday I ${present} home.`
  cases.push(example(`past-tense-${index + 1}`, text, [{ original: present, replacement: past }]))
}

const cleanControls = [
  'The dog ran home.', 'My class read quietly.', 'After lunch, we played outside.', 'Why did the dog run?',
  'She walks after school.', 'They walk after school.', 'Yesterday I went home.', 'No one knows the answer.',
  'Their dog is friendly.', 'They’re going home.', 'Put the book over there.', 'The dog wagged its tail.',
  'It’s raining outside.', 'I want to go too.', 'You’re going to win.', 'We ate our lunch.',
  'I can hear music.', 'She knew the answer.', 'Professor McGonagall entered the room.', 'Aragog stayed in the forest.',
  'Buckbeak flew away.', 'Hermione used a Time-Turner.', 'Malfoy spoke to Harry.', 'After dinner, Dad washed the dishes.',
  'The bell rang, and the students left.', 'Although it was cold, we walked.', 'Maya said, “Let’s begin.”',
  'One of the boys is late.', 'My brother is very happy.', 'The children are playing outside.',
]
for (const [index, text] of cleanControls.entries()) cases.push(example(`clean-${index + 1}`, text))

export const writingEvalCases = cases
