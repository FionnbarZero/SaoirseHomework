import type { Finding, FindingProgress, ProofreadingMatch, SpellingProgress, SpellingWord, WritingDictionary, WritingEdit, WritingTrial } from './domain'
import { inspectSpellingFindings, spellingPracticeComplete } from './spelling.ts'

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
  additionalEdits?: WritingEdit[]
  contextStart?: number
  contextEnd?: number
}

type PracticeRow = [correct: string, wrongOne: string, wrongTwo: string]

function trial(
  id: string,
  prompt: string,
  explanation: string,
  correct: string,
  wrongOne: string,
  wrongTwo: string,
): WritingTrial {
  const choices = Number(id.at(-1)) % 2 === 0
    ? [wrongOne, correct, wrongTwo]
    : [correct, wrongTwo, wrongOne]
  return {
    id,
    prompt,
    choices,
    correctAnswer: correct,
    explanation,
  }
}

function practiceSet(id: string, prompt: string, explanation: string, rows: PracticeRow[]) {
  if (rows.length < 9) throw new Error(`${id} needs nine reviewed practice examples`)
  return rows.map((row, index) => trial(`${id}-${index + 1}`, prompt, explanation, ...row))
}

const RULE_PRACTICE: Record<string, WritingTrial[]> = {
  'tense-yesterday': practiceSet(
    'tense-yesterday',
    'Choose the sentence that stays in the past tense.',
    'A past-time clue such as “yesterday” or “last night” needs a past-tense verb.',
    [
      ['Yesterday, we visited the library.', 'Yesterday, we visit the library.', 'Yesterday, we visiting the library.'],
      ['Last night, she walked home.', 'Last night, she walks home.', 'Last night, she walk home.'],
      ['Yesterday, they played soccer.', 'Yesterday, they play soccer.', 'Yesterday, they playing soccer.'],
      ['Last week, I cooked dinner.', 'Last week, I cook dinner.', 'Last week, I cooking dinner.'],
      ['Yesterday, he jumped over the puddle.', 'Yesterday, he jumps over the puddle.', 'Yesterday, he jump over the puddle.'],
      ['Last night, we watched a movie.', 'Last night, we watch a movie.', 'Last night, we watching a movie.'],
      ['Yesterday, Maya cleaned her room.', 'Yesterday, Maya clean her room.', 'Yesterday, Maya cleaning her room.'],
      ['Last night, I finished my homework.', 'Last night, I finish my homework.', 'Last night, I finishing my homework.'],
      ['Last week, they practiced the song.', 'Last week, they practice the song.', 'Last week, they practicing the song.'],
    ],
  ),
  'subject-verb-singular': practiceSet(
    'subject-verb-singular',
    'Choose the sentence with correct subject–verb agreement.',
    'In the present tense, a singular subject such as “he,” “she,” or “it” needs a matching singular verb.',
    [
      ['Every afternoon, she walks home.', 'Every afternoon, she walk home.', 'Every afternoon, she walking home.'],
      ['He plays outside after school.', 'He play outside after school.', 'He playing outside after school.'],
      ['The dog runs to the gate.', 'The dog run to the gate.', 'The dog running to the gate.'],
      ['It makes a loud sound.', 'It make a loud sound.', 'It making a loud sound.'],
      ['She studies before dinner.', 'She study before dinner.', 'She studying before dinner.'],
      ['The bird sings each morning.', 'The bird sing each morning.', 'The bird singing each morning.'],
      ['My brother reads every night.', 'My brother read every night.', 'My brother reading every night.'],
      ['The cat sleeps on the chair.', 'The cat sleep on the chair.', 'The cat sleeping on the chair.'],
      ['She carries her lunch.', 'She carry her lunch.', 'She carrying her lunch.'],
    ],
  ),
  'subject-verb-plural': practiceSet(
    'subject-verb-plural',
    'Choose the sentence with correct subject–verb agreement.',
    'The subjects “I,” “you,” “we,” and “they” use the base form of a present-tense verb.',
    [
      ['After school, they play outside.', 'After school, they plays outside.', 'After school, they playing outside.'],
      ['We walk to the library.', 'We walks to the library.', 'We walking to the library.'],
      ['I write in my journal.', 'I writes in my journal.', 'I writing in my journal.'],
      ['You have a good idea.', 'You has a good idea.', 'You having a good idea.'],
      ['They study together.', 'They studies together.', 'They studying together.'],
      ['We read after lunch.', 'We reads after lunch.', 'We reading after lunch.'],
      ['They run around the field.', 'They runs around the field.', 'They running around the field.'],
      ['I make breakfast on Sundays.', 'I makes breakfast on Sundays.', 'I making breakfast on Sundays.'],
      ['You study before the test.', 'You studies before the test.', 'You studying before the test.'],
    ],
  ),
  'article-an': practiceSet(
    'article-an',
    'Choose the sentence with the correct article.',
    'Use “an” before a word that begins with a vowel sound.',
    [
      ['I ate an apple.', 'I ate a apple.', 'I ate an apples.'],
      ['She drew an elephant.', 'She drew a elephant.', 'She drew an elephants.'],
      ['We had an idea.', 'We had a idea.', 'We had an ideas.'],
      ['He carried an umbrella.', 'He carried a umbrella.', 'He carried an umbrellas.'],
      ['That is an excellent answer.', 'That is a excellent answer.', 'That is an excellents answer.'],
      ['She found an old coin.', 'She found a old coin.', 'She found an old coins.'],
      ['We saw an orange butterfly.', 'We saw a orange butterfly.', 'We saw an orange butterflies.'],
      ['He waited for an hour.', 'He waited for a hour.', 'He waited for an hours.'],
      ['I need an eraser.', 'I need a eraser.', 'I need an erasers.'],
    ],
  ),
  'article-a': practiceSet(
    'article-a',
    'Choose the sentence with the correct article.',
    'Use “a” before a word that begins with a consonant sound.',
    [
      ['I borrowed a book.', 'I borrowed an book.', 'I borrowed a books.'],
      ['She saw a dog.', 'She saw an dog.', 'She saw a dogs.'],
      ['We played a game.', 'We played an game.', 'We played a games.'],
      ['He told a story.', 'He told an story.', 'He told a stories.'],
      ['I sharpened a pencil.', 'I sharpened an pencil.', 'I sharpened a pencils.'],
      ['He wore a red jacket.', 'He wore an red jacket.', 'He wore a red jackets.'],
      ['She packed a lunch.', 'She packed an lunch.', 'She packed a lunches.'],
      ['We saw a tall tree.', 'We saw an tall tree.', 'We saw a tall trees.'],
      ['He adopted a kitten.', 'He adopted an kitten.', 'He adopted a kittens.'],
    ],
  ),
  'demonstrative-agreement': practiceSet(
    'demonstrative-agreement',
    'Choose the sentence whose pointing word matches the noun.',
    'Use “this” or “that” with one item and “these” or “those” with more than one.',
    [
      ['These books belong on the shelf.', 'This books belong on the shelf.', 'These book belong on the shelf.'],
      ['Those dogs are friendly.', 'That dogs are friendly.', 'Those dog are friendly.'],
      ['This story is funny.', 'These story is funny.', 'This stories is funny.'],
      ['That game was difficult.', 'Those game was difficult.', 'That games was difficult.'],
      ['These ideas could work.', 'This ideas could work.', 'These idea could work.'],
      ['Those pencils need sharpening.', 'That pencils need sharpening.', 'Those pencil need sharpening.'],
      ['This pencil is sharp.', 'These pencil is sharp.', 'This pencils is sharp.'],
      ['That mountain looks tall.', 'Those mountain looks tall.', 'That mountains looks tall.'],
      ['These cookies smell good.', 'This cookies smell good.', 'These cookie smell good.'],
    ],
  ),
  'pronoun-agreement': practiceSet(
    'pronoun-agreement',
    'Choose the sentence with a pronoun that matches its subject.',
    'A singular subject needs a matching singular reflexive pronoun.',
    [
      ['She taught herself to knit.', 'She taught themselves to knit.', 'She taught herselfs to knit.'],
      ['He made himself a snack.', 'He made themselves a snack.', 'He made himselfs a snack.'],
      ['She introduced herself to the class.', 'She introduced themselves to the class.', 'She introduced herselfs to the class.'],
      ['He helped himself to some water.', 'He helped themselves to some water.', 'He helped himselfs to some water.'],
      ['She reminded herself to practice.', 'She reminded themselves to practice.', 'She reminded herselfs to practice.'],
      ['The girl prepared herself for school.', 'The girl prepared themselves for school.', 'The girl prepared herselfs for school.'],
      ['He dressed himself quickly.', 'He dressed themselves quickly.', 'He dressed himselfs quickly.'],
      ['The boy taught himself chess.', 'The boy taught themselves chess.', 'The boy taught himselfs chess.'],
      ['She made herself some tea.', 'She made themselves some tea.', 'She made herselfs some tea.'],
    ],
  ),
  'sentence-capital': practiceSet(
    'sentence-capital',
    'Choose the sentence that begins correctly.',
    'The first word of every sentence begins with a capital letter.',
    [
      ['The dog waited by the door.', 'the dog waited by the door.', 'THe dog waited by the door.'],
      ['My class planted a garden.', 'my class planted a garden.', 'MY class planted a garden.'],
      ['After lunch, we read quietly.', 'after lunch, we read quietly.', 'AFter lunch, we read quietly.'],
      ['Tomorrow will be sunny.', 'tomorrow will be sunny.', 'TOmorrow will be sunny.'],
      ['Everyone cheered at the end.', 'everyone cheered at the end.', 'EVeryone cheered at the end.'],
      ['Our team practiced after school.', 'our team practiced after school.', 'OUr team practiced after school.'],
      ['Rain tapped against the window.', 'rain tapped against the window.', 'RAin tapped against the window.'],
      ['Later, we finished the puzzle.', 'later, we finished the puzzle.', 'LAter, we finished the puzzle.'],
      ['Nothing moved in the hallway.', 'nothing moved in the hallway.', 'NOthing moved in the hallway.'],
    ],
  ),
  'pronoun-i': practiceSet(
    'pronoun-i',
    'Choose the sentence that capitalizes the pronoun “I.”',
    'The pronoun “I” is always capitalized.',
    [
      ['My sister and I made dinner.', 'My sister and i made dinner.', 'My sister and II made dinner.'],
      ['I finished my homework.', 'i finished my homework.', 'II finished my homework.'],
      ['Sam and I rode our bikes.', 'Sam and i rode our bikes.', 'Sam and II rode our bikes.'],
      ['When I arrived, class had started.', 'When i arrived, class had started.', 'When II arrived, class had started.'],
      ['I think the answer is seven.', 'i think the answer is seven.', 'II think the answer is seven.'],
      ['Dad and I cleaned the kitchen.', 'Dad and i cleaned the kitchen.', 'Dad and II cleaned the kitchen.'],
      ['Maya and I read together.', 'Maya and i read together.', 'Maya and II read together.'],
      ['After dinner, I washed the dishes.', 'After dinner, i washed the dishes.', 'After dinner, II washed the dishes.'],
      ['Can I borrow your pencil?', 'Can i borrow your pencil?', 'Can II borrow your pencil?'],
    ],
  ),
  'calendar-capital': practiceSet(
    'calendar-capital',
    'Choose the sentence that capitalizes the day or month correctly.',
    'Names of days and months begin with one capital letter.',
    [
      ['Our lesson is on Monday.', 'Our lesson is on monday.', 'Our lesson is on MONDAY.'],
      ['School begins in August.', 'School begins in august.', 'School begins in AUGUST.'],
      ['We practice on Friday.', 'We practice on friday.', 'We practice on FRIDAY.'],
      ['Her birthday is in January.', 'Her birthday is in january.', 'Her birthday is in JANUARY.'],
      ['The trip starts on Tuesday.', 'The trip starts on tuesday.', 'The trip starts on TUESDAY.'],
      ['The concert is in June.', 'The concert is in june.', 'The concert is in JUNE.'],
      ['We leave on Wednesday.', 'We leave on wednesday.', 'We leave on WEDNESDAY.'],
      ['My birthday is in October.', 'My birthday is in october.', 'My birthday is in OCTOBER.'],
      ['The game is on Saturday.', 'The game is on saturday.', 'The game is on SATURDAY.'],
    ],
  ),
  'title-capital': practiceSet(
    'title-capital',
    'Choose the sentence that capitalizes a person’s title and name correctly.',
    'A title and the person’s name each begin with one capital letter.',
    [
      ['Dr. Lee read our stories.', 'dr. Lee read our stories.', 'DR. Lee read our stories.'],
      ['Mr. Smith opened the door.', 'mr. smith opened the door.', 'MR. SMITH opened the door.'],
      ['Ms. Rivera teaches science.', 'ms. Rivera teaches science.', 'MS. RIVERA teaches science.'],
      ['Mrs. Green called the office.', 'mrs. green called the office.', 'MRS. GREEN called the office.'],
      ['Dr. Brown checked the results.', 'dr. brown checked the results.', 'DR. BROWN checked the results.'],
      ['Ms. Chen collected our papers.', 'ms. chen collected our papers.', 'MS. CHEN collected our papers.'],
      ['Mr. Patel coaches our team.', 'mr. patel coaches our team.', 'MR. PATEL coaches our team.'],
      ['Mrs. Jones leads the club.', 'mrs. jones leads the club.', 'MRS. JONES leads the club.'],
      ['Dr. Garcia answered my question.', 'dr. garcia answered my question.', 'DR. GARCIA answered my question.'],
    ],
  ),
  'proper-name-capital': practiceSet(
    'proper-name-capital',
    'Choose the sentence that capitalizes the person’s name correctly.',
    'A person’s name is a proper noun, so it begins with a capital letter.',
    [
      ['The main character, Eddie, found a map.', 'The main character, eddie, found a map.', 'The main character, EDDIE, found a map.'],
      ['A girl named Maya joined the team.', 'A girl named maya joined the team.', 'A girl named MAYA joined the team.'],
      ['Leo opened the old book.', 'leo opened the old book.', 'LEO opened the old book.'],
      ['My friend Sam brought a kite.', 'My friend sam brought a kite.', 'My friend SAM brought a kite.'],
      ['A boy called Ben answered the door.', 'A boy called ben answered the door.', 'A boy called BEN answered the door.'],
      ['Nora walked through the garden.', 'nora walked through the garden.', 'NORA walked through the garden.'],
      ['The character Ava solved the puzzle.', 'The character ava solved the puzzle.', 'The character AVA solved the puzzle.'],
      ['Liam said that he was ready.', 'liam said that he was ready.', 'LIAM said that he was ready.'],
      ['Zoe carried the basket home.', 'zoe carried the basket home.', 'ZOE carried the basket home.'],
    ],
  ),
  'contraction-apostrophe': practiceSet(
    'contraction-apostrophe',
    'Choose the sentence with the contraction written correctly.',
    'A contraction uses one apostrophe to show where letters were removed.',
    [
      ['I don’t need help yet.', 'I dont need help yet.', 'I don’’t need help yet.'],
      ['She can’t find her notebook.', 'She cant find her notebook.', 'She can’’t find her notebook.'],
      ['We won’t be late.', 'We wont be late.', 'We won’’t be late.'],
      ['I’m ready to begin.', 'Im ready to begin.', 'I’’m ready to begin.'],
      ['They’re waiting outside.', 'Theyre waiting outside.', 'They’’re waiting outside.'],
      ['He isn’t here yet.', 'He isnt here yet.', 'He isn’’t here yet.'],
      ['You’re welcome to join us.', 'Youre welcome to join us.', 'You’’re welcome to join us.'],
      ['We’ll finish tomorrow.', 'Well finish tomorrow.', 'We’’ll finish tomorrow.'],
      ['That’s my backpack.', 'Thats my backpack.', 'That’’s my backpack.'],
    ],
  ),
  'intro-comma': practiceSet(
    'intro-comma',
    'Choose the sentence with the introductory comma in the correct place.',
    'A dependent introductory clause is followed by a comma before the main clause.',
    [
      ['After I finished my work, I played outside.', 'After I finished my work I played outside.', 'After, I finished my work I played outside.'],
      ['Before we ate dinner, we washed our hands.', 'Before we ate dinner we washed our hands.', 'Before, we ate dinner we washed our hands.'],
      ['When she reached school, she called home.', 'When she reached school she called home.', 'When, she reached school she called home.'],
      ['If it rains, we will stay inside.', 'If it rains we will stay inside.', 'If, it rains we will stay inside.'],
      ['While they waited, they read a book.', 'While they waited they read a book.', 'While, they waited they read a book.'],
      ['Although I was tired, I finished the chapter.', 'Although I was tired I finished the chapter.', 'Although, I was tired I finished the chapter.'],
      ['Because the bell rang, we went inside.', 'Because the bell rang we went inside.', 'Because, the bell rang we went inside.'],
      ['As the sun set, the air cooled.', 'As the sun set the air cooled.', 'As, the sun set the air cooled.'],
      ['Unless you hurry, you will miss the bus.', 'Unless you hurry you will miss the bus.', 'Unless, you hurry you will miss the bus.'],
    ],
  ),
  'simple-list-commas': practiceSet(
    'simple-list-commas',
    'Choose the sentence that punctuates a list of three items correctly.',
    'Use commas to separate three items in a series.',
    [
      ['I packed socks, shoes, and books.', 'I packed socks shoes and books.', 'I packed, socks shoes, and books.'],
      ['We saw lions, tigers, and bears.', 'We saw lions tigers and bears.', 'We saw, lions tigers, and bears.'],
      ['She likes apples, pears, and grapes.', 'She likes apples pears and grapes.', 'She likes, apples pears, and grapes.'],
      ['I brought paper, pencils, and markers.', 'I brought paper pencils and markers.', 'I brought, paper pencils, and markers.'],
      ['They chose red, blue, and green.', 'They chose red blue and green.', 'They chose, red blue, and green.'],
      ['We need glue, tape, and scissors.', 'We need glue tape and scissors.', 'We need, glue tape, and scissors.'],
      ['She bought milk, bread, and eggs.', 'She bought milk bread and eggs.', 'She bought, milk bread, and eggs.'],
      ['The flag is red, white, and blue.', 'The flag is red white and blue.', 'The flag is, red white, and blue.'],
      ['We studied math, science, and art.', 'We studied math science and art.', 'We studied, math science, and art.'],
    ],
  ),
  'appositive-name-commas': practiceSet(
    'appositive-name-commas',
    'Choose the sentence that sets off the character’s name correctly.',
    'A name that renames a nearby noun is extra information, so a comma belongs before and after the name.',
    [
      ['The main character, Eddie, found a map.', 'The main character Eddie found a map.', 'The main character, Eddie found a map.'],
      ['The protagonist, Maya, opened the gate.', 'The protagonist Maya opened the gate.', 'The protagonist Maya, opened the gate.'],
      ['The main character, Leo, climbed the hill.', 'The main character Leo climbed the hill.', 'The main character, Leo climbed the hill.'],
      ['The protagonist, Ava, solved the puzzle.', 'The protagonist Ava solved the puzzle.', 'The protagonist Ava, solved the puzzle.'],
      ['The main character, Ben, carried the bag.', 'The main character Ben carried the bag.', 'The main character, Ben carried the bag.'],
      ['The protagonist, Nora, read the note.', 'The protagonist Nora read the note.', 'The protagonist Nora, read the note.'],
      ['The main character, Liam, crossed the bridge.', 'The main character Liam crossed the bridge.', 'The main character, Liam crossed the bridge.'],
      ['The protagonist, Zoe, heard a sound.', 'The protagonist Zoe heard a sound.', 'The protagonist Zoe, heard a sound.'],
      ['The main character, Sam, followed the trail.', 'The main character Sam followed the trail.', 'The main character, Sam followed the trail.'],
    ],
  ),
  'compound-predicate-conjunction': practiceSet(
    'compound-predicate-conjunction',
    'Choose the sentence that joins two actions by the same subject correctly.',
    'When one subject performs two connected actions, “and” can join the verbs without a comma.',
    [
      ['Eddie went to the store and bought a hamster.', 'Eddie went to the store bought a hamster.', 'Eddie went to the store, bought a hamster.'],
      ['Maya opened the book and read the first page.', 'Maya opened the book read the first page.', 'Maya opened the book, read the first page.'],
      ['Leo packed his bag and walked to school.', 'Leo packed his bag walked to school.', 'Leo packed his bag, walked to school.'],
      ['Ava found the key and opened the door.', 'Ava found the key opened the door.', 'Ava found the key, opened the door.'],
      ['Ben washed the apple and ate it.', 'Ben washed the apple ate it.', 'Ben washed the apple, ate it.'],
      ['Nora picked up the note and read it.', 'Nora picked up the note read it.', 'Nora picked up the note, read it.'],
      ['Liam tied his shoes and ran outside.', 'Liam tied his shoes ran outside.', 'Liam tied his shoes, ran outside.'],
      ['Zoe finished her work and closed the notebook.', 'Zoe finished her work closed the notebook.', 'Zoe finished her work, closed the notebook.'],
      ['Sam reached the park and met his friend.', 'Sam reached the park met his friend.', 'Sam reached the park, met his friend.'],
    ],
  ),
  'fused-sentence-break': practiceSet(
    'fused-sentence-break',
    'Choose the sentence that separates two complete thoughts correctly.',
    'Two complete thoughts need a period and a capital letter when they stand as separate sentences.',
    [
      ['I bought a hamster. It slept in a cage.', 'I bought a hamster it slept in a cage.', 'I bought a hamster, it slept in a cage.'],
      ['She found a kitten. It followed her home.', 'She found a kitten it followed her home.', 'She found a kitten, it followed her home.'],
      ['We saw a bird. It flew into a tree.', 'We saw a bird it flew into a tree.', 'We saw a bird, it flew into a tree.'],
      ['He carried the box. It was very heavy.', 'He carried the box it was very heavy.', 'He carried the box, it was very heavy.'],
      ['They planted a seed. It grew quickly.', 'They planted a seed it grew quickly.', 'They planted a seed, it grew quickly.'],
      ['I opened the letter. It had good news.', 'I opened the letter it had good news.', 'I opened the letter, it had good news.'],
      ['She kicked the ball. It rolled downhill.', 'She kicked the ball it rolled downhill.', 'She kicked the ball, it rolled downhill.'],
      ['We heard a noise. It came from upstairs.', 'We heard a noise it came from upstairs.', 'We heard a noise, it came from upstairs.'],
      ['He made a model. It looked realistic.', 'He made a model it looked realistic.', 'He made a model, it looked realistic.'],
    ],
  ),
  'compound-sentence-comma': practiceSet(
    'compound-sentence-comma',
    'Choose the sentence that joins two complete thoughts correctly.',
    'Use a comma before “and” when it joins two complete thoughts that each have their own subject and verb.',
    [
      ['It died, and he was sad.', 'It died and he was sad.', 'It died and, he was sad.'],
      ['She finished, and I checked the work.', 'She finished and I checked the work.', 'She finished and, I checked the work.'],
      ['He laughed, and she smiled.', 'He laughed and she smiled.', 'He laughed and, she smiled.'],
      ['They ran, and we followed.', 'They ran and we followed.', 'They ran and, we followed.'],
      ['It was late, and we went home.', 'It was late and we went home.', 'It was late and, we went home.'],
      ['I was tired, and she was hungry.', 'I was tired and she was hungry.', 'I was tired and, she was hungry.'],
      ['He cried, and she felt worried.', 'He cried and she felt worried.', 'He cried and, she felt worried.'],
      ['We laughed, and they laughed too.', 'We laughed and they laughed too.', 'We laughed and, they laughed too.'],
      ['She was ready, and he was calm.', 'She was ready and he was calm.', 'She was ready and, he was calm.'],
    ],
  ),
  'paired-quotes': practiceSet(
    'paired-quotes',
    'Choose the sentence with paired quotation marks.',
    'A direct quotation needs an opening and a closing quotation mark.',
    [
      ['Maya said, “Let’s begin.”', 'Maya said, “Let’s begin.', 'Maya said, Let’s begin.”'],
      ['“Please sit down,” said Mr. Lee.', '“Please sit down, said Mr. Lee.', 'Please sit down,” said Mr. Lee.'],
      ['I heard her shout, “Wait!”', 'I heard her shout, “Wait!', 'I heard her shout, Wait!”'],
      ['Dad asked, “Are you ready?”', 'Dad asked, “Are you ready?', 'Dad asked, Are you ready?”'],
      ['“That was amazing,” Fionnbar said.', '“That was amazing, Fionnbar said.', 'That was amazing,” Fionnbar said.'],
      ['Leo whispered, “Be quiet.”', 'Leo whispered, “Be quiet.', 'Leo whispered, Be quiet.”'],
      ['“I found it,” Maya said.', '“I found it, Maya said.', 'I found it,” Maya said.'],
      ['Mom said, “Dinner is ready.”', 'Mom said, “Dinner is ready.', 'Mom said, Dinner is ready.”'],
      ['“Turn left,” the guide said.', '“Turn left, the guide said.', 'Turn left,” the guide said.'],
    ],
  ),
  'direct-dialogue-quotes': practiceSet(
    'direct-dialogue-quotes',
    'Choose the sentence that punctuates direct dialogue correctly.',
    'Use a comma before spoken words, capitalize the quotation, put its ending mark inside the closing quotation mark, and use a comma before a following dialogue tag.',
    [
      ['Maya said, “Let’s begin.”', 'Maya said “let’s begin”.', 'Maya said, Let’s begin.'],
      ['Dad asked, “Are you ready?”', 'Dad asked “are you ready”?', 'Dad asked, Are you ready?'],
      ['“Please sit down,” said Mr. Lee.', '“Please sit down.” said Mr. Lee.', '“please sit down”, said Mr. Lee.'],
      ['Leo shouted, “Wait!”', 'Leo shouted “wait”!', 'Leo shouted, Wait!'],
      ['“I found it,” Maya said.', '“I found it.” Maya said.', '“i found it”, Maya said.'],
      ['Mom said, “Dinner is ready.”', 'Mom said “dinner is ready”.', 'Mom said, Dinner is ready.'],
      ['“Turn left,” the guide said.', '“Turn left.” the guide said.', '“turn left”, the guide said.'],
      ['Ava asked, “May I help?”', 'Ava asked “may I help”?', 'Ava asked, May I help?'],
      ['“That was amazing!” Fionnbar said.', '“That was amazing”! Fionnbar said.', '“that was amazing!” fionnbar said.'],
    ],
  ),
  'unexpected-midword-capital': practiceSet(
    'unexpected-midword-capital',
    'Choose the sentence that uses capitals correctly.',
    'An ordinary verb in the middle of a sentence begins with a lowercase letter unless it is part of a title or name.',
    [
      ['I walked to the store.', 'I Walked to the store.', 'I WALKED to the store.'],
      ['She played after school.', 'She Played after school.', 'She PLayed after school.'],
      ['We visited the library.', 'We Visited the library.', 'We VIsited the library.'],
      ['They bought a new game.', 'They Bought a new game.', 'They BOught a new game.'],
      ['He opened the door.', 'He Opened the door.', 'He OPened the door.'],
      ['I wrote a short story.', 'I Wrote a short story.', 'I WRote a short story.'],
      ['She found her notebook.', 'She Found her notebook.', 'She FOund her notebook.'],
      ['We finished the project.', 'We Finished the project.', 'We FInished the project.'],
      ['They laughed at the joke.', 'They Laughed at the joke.', 'They LAughed at the joke.'],
    ],
  ),
  'subject-verb-comma': practiceSet(
    'subject-verb-comma',
    'Choose the sentence without an incorrect comma between the subject and verb.',
    'Do not place a comma between a sentence’s subject and its verb.',
    [
      ['The lady was kind.', 'The lady, was kind.', 'The lady was, kind.'],
      ['The dog is sleeping.', 'The dog, is sleeping.', 'The dog is, sleeping.'],
      ['My friend has arrived.', 'My friend, has arrived.', 'My friend has, arrived.'],
      ['The books were heavy.', 'The books, were heavy.', 'The books were, heavy.'],
      ['Their teacher was helpful.', 'Their teacher, was helpful.', 'Their teacher was, helpful.'],
      ['There was a goldfish.', 'There, was a goldfish.', 'There was, a goldfish.'],
      ['Our class is ready.', 'Our class, is ready.', 'Our class is, ready.'],
      ['A bird was singing.', 'A bird, was singing.', 'A bird was, singing.'],
      ['Her backpack has a zipper.', 'Her backpack, has a zipper.', 'Her backpack has, a zipper.'],
    ],
  ),
  'stray-followup-fragment': practiceSet(
    'stray-followup-fragment',
    'Choose the version without a stray sentence fragment.',
    'Every group of words kept as a sentence must express a complete thought; remove an accidental fragment left after a completed quotation.',
    [
      ['Maya said, “What a beautiful fish!”', 'Maya said, “What a beautiful fish!” I got.', 'Maya said, “What a beautiful fish!” Got.'],
      ['Leo shouted, “Watch out!”', 'Leo shouted, “Watch out!” I did.', 'Leo shouted, “Watch out!” Did.'],
      ['Dad said, “That was close!”', 'Dad said, “That was close!” I was.', 'Dad said, “That was close!” Was.'],
      ['Ava said, “I found the key!”', 'Ava said, “I found the key!” I found.', 'Ava said, “I found the key!” Found.'],
      ['Mom said, “Dinner is ready!”', 'Mom said, “Dinner is ready!” It was.', 'Mom said, “Dinner is ready!” Was ready.'],
      ['Ben yelled, “We won!”', 'Ben yelled, “We won!” I got.', 'Ben yelled, “We won!” Got it.'],
      ['Nora said, “The puppy is adorable!”', 'Nora said, “The puppy is adorable!” I saw.', 'Nora said, “The puppy is adorable!” Saw.'],
      ['Sam shouted, “The bus is here!”', 'Sam shouted, “The bus is here!” It got.', 'Sam shouted, “The bus is here!” Got.'],
      ['Liam said, “That goal was amazing!”', 'Liam said, “That goal was amazing!” I had.', 'Liam said, “That goal was amazing!” Had.'],
    ],
  ),
  'whats-up-contraction': practiceSet(
    'whats-up-contraction',
    'Choose the correctly written dialogue.',
    '“What’s” is the contraction of “what is,” so it needs an apostrophe and a capital letter at the beginning of dialogue.',
    [
      ['He asked, “What’s up?”', 'He asked, “What up?”', 'He asked, “Whats up?”'],
      ['Maya asked, “What’s that?”', 'Maya asked, “What that?”', 'Maya asked, “Whats that?”'],
      ['Dad asked, “What’s wrong?”', 'Dad asked, “What wrong?”', 'Dad asked, “Whats wrong?”'],
      ['She said, “What’s happening?”', 'She said, “What happening?”', 'She said, “Whats happening?”'],
      ['Leo asked, “What’s next?”', 'Leo asked, “What next?”', 'Leo asked, “Whats next?”'],
      ['Mom asked, “What’s for dinner?”', 'Mom asked, “What for dinner?”', 'Mom asked, “Whats for dinner?”'],
      ['Ava asked, “What’s the answer?”', 'Ava asked, “What the answer?”', 'Ava asked, “Whats the answer?”'],
      ['Ben said, “What’s new?”', 'Ben said, “What new?”', 'Ben said, “Whats new?”'],
      ['The coach asked, “What’s our plan?”', 'The coach asked, “What our plan?”', 'The coach asked, “Whats our plan?”'],
    ],
  ),
  'perfect-tense-participle': practiceSet(
    'perfect-tense-participle',
    'Choose the sentence that forms the perfect tense correctly.',
    'The perfect tense uses “has,” “have,” or “had” followed by a past participle.',
    [
      ['She has written three pages.', 'She has write three pages.', 'She has wrote three pages.'],
      ['They have gone to the library.', 'They have go to the library.', 'They have went to the library.'],
      ['I had eaten before practice.', 'I had eat before practice.', 'I had ate before practice.'],
      ['He has taken the bus before.', 'He has take the bus before.', 'He has took the bus before.'],
      ['We have finished our project.', 'We have finish our project.', 'We have finishing our project.'],
      ['Dad had driven there before.', 'Dad had drive there before.', 'Dad had drove there before.'],
      ['I have seen that movie.', 'I have see that movie.', 'I have saw that movie.'],
      ['He had made a model.', 'He had make a model.', 'He had making a model.'],
      ['The class has begun the lesson.', 'The class has begin the lesson.', 'The class has began the lesson.'],
    ],
  ),
  'past-tense-consistency': practiceSet(
    'past-tense-consistency',
    'Choose the sentence that keeps both actions in the past tense.',
    'When both actions happened at a stated past time, their verbs should stay in the past tense.',
    [
      ['Yesterday, she walked and played outside.', 'Yesterday, she walked and plays outside.', 'Yesterday, she walks and played outside.'],
      ['Last night, he cooked and cleaned.', 'Last night, he cooked and cleans.', 'Last night, he cooks and cleaned.'],
      ['Yesterday, we visited and talked.', 'Yesterday, we visited and talk.', 'Yesterday, we visit and talked.'],
      ['Last week, they jumped and played.', 'Last week, they jumped and play.', 'Last week, they jump and played.'],
      ['Yesterday, I looked and listened.', 'Yesterday, I looked and listens.', 'Yesterday, I look and listened.'],
      ['Last night, she laughed and smiled.', 'Last night, she laughed and smiles.', 'Last night, she laughs and smiled.'],
      ['Yesterday, he opened the book and started reading.', 'Yesterday, he opened the book and starts reading.', 'Yesterday, he opens the book and started reading.'],
      ['Last week, we studied and practiced.', 'Last week, we studied and practice.', 'Last week, we study and practiced.'],
      ['Last night, they watched and laughed.', 'Last night, they watched and laugh.', 'Last night, they watch and laughed.'],
    ],
  ),
  'correlative-conjunction': practiceSet(
    'correlative-conjunction',
    'Choose the sentence with the matching conjunction pair.',
    'Correlative conjunctions work in matching pairs: either/or, neither/nor, and both/and.',
    [
      ['Either Maya or Leo will present.', 'Either Maya nor Leo will present.', 'Either Maya and Leo will present.'],
      ['Neither rain nor wind stopped us.', 'Neither rain or wind stopped us.', 'Neither rain and wind stopped us.'],
      ['Both the book and the film were funny.', 'Both the book or the film were funny.', 'Both the book nor the film were funny.'],
      ['We can either walk or take the bus.', 'We can either walk nor take the bus.', 'We can either walk and take the bus.'],
      ['She likes both drawing and writing.', 'She likes both drawing or writing.', 'She likes both drawing nor writing.'],
      ['They brought neither pencils nor paper.', 'They brought neither pencils or paper.', 'They brought neither pencils and paper.'],
      ['Both Maya and Leo volunteered.', 'Both Maya or Leo volunteered.', 'Both Maya nor Leo volunteered.'],
      ['Either the blue pen or the black pen will work.', 'Either the blue pen nor the black pen will work.', 'Either the blue pen and the black pen will work.'],
      ['Neither the teacher nor the students were late.', 'Neither the teacher or the students were late.', 'Neither the teacher and the students were late.'],
    ],
  ),
  'object-pronoun-after-preposition': practiceSet(
    'object-pronoun-after-preposition',
    'Choose the sentence with the correct pronoun after the preposition.',
    'A pronoun that follows a preposition such as “with,” “for,” or “between” uses its object form.',
    [
      ['Please come with me.', 'Please come with I.', 'Please come with my.'],
      ['This gift is for him.', 'This gift is for he.', 'This gift is for his.'],
      ['The teacher spoke to her.', 'The teacher spoke to she.', 'The teacher spoke to hers.'],
      ['Keep this between you and me.', 'Keep this between you and I.', 'Keep this between you and my.'],
      ['Dad sat beside us.', 'Dad sat beside we.', 'Dad sat beside our.'],
      ['The coach waited for them.', 'The coach waited for they.', 'The coach waited for their.'],
      ['She shared the snack with us.', 'She shared the snack with we.', 'She shared the snack with our.'],
      ['I saved a seat for her.', 'I saved a seat for she.', 'I saved a seat for hers.'],
      ['The letter came from him.', 'The letter came from he.', 'The letter came from his.'],
    ],
  ),
  'interjection-comma': practiceSet(
    'interjection-comma',
    'Choose the sentence that sets off its opening interjection.',
    'A mild interjection at the beginning of a sentence is followed by a comma.',
    [
      ['Wow, that was close!', 'Wow that was close!', 'Wow that, was close!'],
      ['Yes, I finished my work.', 'Yes I finished my work.', 'Yes I, finished my work.'],
      ['No, we did not miss the bus.', 'No we did not miss the bus.', 'No we, did not miss the bus.'],
      ['Well, I can try again.', 'Well I can try again.', 'Well I, can try again.'],
      ['Oh, that makes sense now.', 'Oh that makes sense now.', 'Oh that, makes sense now.'],
      ['Okay, I will check my answer.', 'Okay I will check my answer.', 'Okay I, will check my answer.'],
      ['Sure, I can help.', 'Sure I can help.', 'Sure I, can help.'],
      ['Hey, wait for me!', 'Hey wait for me!', 'Hey wait, for me!'],
      ['Gosh, that was surprising.', 'Gosh that was surprising.', 'Gosh that, was surprising.'],
    ],
  ),
  'direct-address-comma': practiceSet(
    'direct-address-comma',
    'Choose the sentence that punctuates a direct address correctly.',
    'Use a comma to separate the name of the person being spoken to from the rest of the sentence.',
    [
      ['Thanks, Mom.', 'Thanks Mom.', 'Thanks Mom,.'],
      ['Hello, Fionnbar.', 'Hello Fionnbar.', 'Hello Fionnbar,.'],
      ['Goodbye, Dad.', 'Goodbye Dad.', 'Goodbye Dad,.'],
      ['Please listen, Maya.', 'Please listen Maya.', 'Please, listen Maya.'],
      ['Are you ready, Leo?', 'Are you ready Leo?', 'Are you, ready Leo?'],
      ['Come here, Sam.', 'Come here Sam.', 'Come, here Sam.'],
      ['Please pass the ball, Liam.', 'Please pass the ball Liam.', 'Please, pass the ball Liam.'],
      ['I appreciate your help, Ava.', 'I appreciate your help Ava.', 'I appreciate, your help Ava.'],
      ['Wait for me, Ben!', 'Wait for me Ben!', 'Wait, for me Ben!'],
    ],
  ),
  'terminal-punctuation': practiceSet(
    'terminal-punctuation',
    'Choose the sentence with the correct ending punctuation.',
    'A complete sentence ends with one appropriate period, question mark, or exclamation mark.',
    [
      ['The science project is finished.', 'The science project is finished', 'The science project is finished..'],
      ['Where did I put my notebook?', 'Where did I put my notebook.', 'Where did I put my notebook'],
      ['Watch out for the puddle!', 'Watch out for the puddle', 'Watch out for the puddle!!'],
      ['She said, “Hello.”', 'She said, “Hello”', 'She said, “Hello..”'],
      ['We arrived before noon.', 'We arrived before noon', 'We arrived before noon..'],
      ['Did you finish the chapter?', 'Did you finish the chapter.', 'Did you finish the chapter'],
      ['The library closes at five.', 'The library closes at five', 'The library closes at five..'],
      ['Why is the sky blue?', 'Why is the sky blue.', 'Why is the sky blue'],
      ['That was an amazing goal!', 'That was an amazing goal', 'That was an amazing goal!!'],
    ],
  ),
}

RULE_PRACTICE['known-name'] = RULE_PRACTICE['proper-name-capital']
RULE_PRACTICE['known-place'] = RULE_PRACTICE['title-capital']
RULE_PRACTICE['missing-dialogue-quotes'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['dialogue-introduction-comma'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['quotation-capitalization'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['quotation-punctuation-inside'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['dialogue-tag-comma'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['dialogue-tag-capitalization'] = RULE_PRACTICE['direct-dialogue-quotes']
RULE_PRACTICE['comma-splice'] = RULE_PRACTICE['fused-sentence-break']

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

function isDirectQuoteStart(body: string, quoteIndex: number) {
  const prefix = body.slice(sentenceBounds(body, quoteIndex).start, quoteIndex)
  return !prefix.trim()
    || /\b(?:said|asked|replied|shouted|whispered|yelled|cried|called)\s*,?\s*$/i.test(prefix)
    || /\b(?:was|were)\s+like\s*,?\s*$/i.test(prefix)
}

function rotateChoices(choices: string[], seed: number) {
  const offset = Math.abs(seed) % choices.length
  return [...choices.slice(offset), ...choices.slice(0, offset)]
}

function applyTextEdits(body: string, edits: WritingEdit[], base = 0) {
  return [...edits]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((value, edit) => {
      const start = edit.start - base
      const end = edit.end - base
      return `${value.slice(0, start)}${edit.replacement}${value.slice(end)}`
    }, body)
}

function editsOverlap(left: WritingEdit, right: WritingEdit) {
  if (left.start === left.end) return left.start > right.start && left.start < right.end
  if (right.start === right.end) return right.start > left.start && right.start < left.end
  return left.start < right.end && left.end > right.start
}

function inputEdits(input: FindingInput | Finding): WritingEdit[] {
  return [
    { start: input.start, end: input.end, replacement: input.replacement },
    ...(input.additionalEdits ?? []),
  ]
}

function correctionTrial(body: string, input: FindingInput): WritingTrial {
  const automaticBounds = sentenceBounds(body, input.start)
  const bounds = {
    start: input.contextStart ?? automaticBounds.start,
    end: input.contextEnd ?? automaticBounds.end,
  }
  const original = body.slice(bounds.start, bounds.end)
  const corrected = applyTextEdits(original, inputEdits(input), bounds.start)
  const wrongReplacement = input.wrongReplacement ?? input.replacement.toUpperCase()
  let distractor = applyTextEdits(original, [
    { start: input.start, end: input.end, replacement: wrongReplacement },
    ...(input.additionalEdits ?? []),
  ], bounds.start)
  if (distractor === original || distractor === corrected) distractor = `${corrected}.”`
  const choices = rotateChoices([...new Set([original, corrected, distractor])], input.start)
  while (choices.length < 3) choices.push(`${corrected}.`)
  const ruleExplanation = RULE_PRACTICE[input.ruleId]?.[0]?.explanation ?? input.suggestion
  return {
    id: `${input.ruleId}-${input.start}-correction`,
    prompt: 'Choose the best correction for your original sentence.',
    choices,
    correctAnswer: corrected,
    explanation: `${ruleExplanation} For your sentence, use “${input.replacement}”.`,
  }
}

function addFinding(body: string, findings: Finding[], input: FindingInput) {
  const edits = inputEdits(input)
  const overlaps = findings.some((finding) => (
    inputEdits(finding).some((existingEdit) => edits.some((edit) => editsOverlap(existingEdit, edit)))
  ))
  if (overlaps) return
  const practice = RULE_PRACTICE[input.ruleId]
  if (!practice) throw new Error(`Missing writing practice for ${input.ruleId}`)
  const sameRuleIndex = findings.filter((finding) => finding.ruleId === input.ruleId).length
  const practiceStart = (sameRuleIndex * 3) % practice.length
  const selectedPractice = Array.from(
    { length: 3 },
    (_, index) => practice[(practiceStart + index) % practice.length],
  )
  const { contextStart: _contextStart, contextEnd: _contextEnd, wrongReplacement: _wrongReplacement, ...findingInput } = input
  findings.push({
    ...findingInput,
    id: `${input.ruleId}-${input.start}`,
    correction: correctionTrial(body, input),
    practice: selectedPractice.map((item) => ({ ...item, choices: [...item.choices] })),
  })
}

function proofreadingCategory(match: ProofreadingMatch): Category {
  const rule = match.ruleId.toUpperCase()
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

function proofreadingPracticeRule(match: ProofreadingMatch, replacement: string) {
  const rule = match.ruleId.toUpperCase()
  if (rule === 'COMMA_COMPOUND_SENTENCE') return 'compound-sentence-comma'
  if (rule === 'MISSING_COMMA_AFTER_INTRODUCTORY_PHRASE') return 'intro-comma'
  if (rule === 'UPPERCASE_SENTENCE_START') return 'sentence-capital'
  if (rule === 'HE_VERB_AGR') return 'subject-verb-singular'
  if (rule === 'NON3PRS_VERB') return 'subject-verb-plural'
  if (rule === 'EN_A_VS_AN') return replacement.toLowerCase() === 'an' ? 'article-an' : 'article-a'
  if (rule === 'THIS_NNS') return 'demonstrative-agreement'
  if (rule === 'HAVE_PART_AGREEMENT') return 'perfect-tense-participle'
  if (rule === 'EN_CONTRACTION_SPELLING') return 'contraction-apostrophe'
  return null
}

function dynamicSpellingPractice(
  match: ProofreadingMatch,
  original: string,
  replacement: string,
): WritingTrial[] {
  let otherWrong = match.replacements.find((item) => item !== replacement && item !== original) ?? `${original}${original.at(-1) ?? 'x'}`
  if (otherWrong === replacement || otherWrong === original) otherWrong = replacement.toUpperCase()
  const frames = [
    (value: string) => `I wrote the word “${value}” in my notebook.`,
    (value: string) => `The word “${value}” appears in the passage.`,
    (value: string) => `Please check the spelling of “${value}” carefully.`,
  ]
  return frames.map((frame, index) => trial(
    `proofreading-${match.ruleId}-${match.offset}-practice-${index + 1}`,
    `Choose the sentence that spells “${replacement}” correctly.`,
    `The local proofreading engine recommends “${replacement}” for “${original}”.`,
    frame(replacement),
    frame(original),
    frame(otherWrong),
  ))
}

function proofreadingFinding(
  body: string,
  match: ProofreadingMatch,
  sameRuleIndex: number,
): Finding | null {
  const original = body.slice(match.offset, match.offset + match.length)
  const nearbyText = body.slice(Math.max(0, match.offset - 12), match.offset + match.length + 18)
  const contextualReplacement = original.toLowerCase() === 'gus'
    && /\bthe\s+gus\s+(?:is|was|seems|looks|said)\b/i.test(nearbyText)
    ? match.replacements.find((item) => item.toLowerCase() === 'guy')
    : undefined
  const replacement = contextualReplacement ?? match.replacements.find((item) => item !== original)
  if (replacement === undefined) return null
  const category = proofreadingCategory(match)
  const safeRule = match.ruleId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'review'
  const ruleId = `proofreading-${safeRule}`
  const input: FindingInput = {
    ruleId,
    category,
    start: match.offset,
    end: match.offset + match.length,
    replacement,
    message: match.message,
    suggestion: `The local proofreading engine recommends “${replacement}”.`,
    wrongReplacement: match.replacements.find((item) => item !== replacement && item !== original) ?? `${replacement}${replacement}`,
  }
  const mappedRule = proofreadingPracticeRule(match, replacement)
  const reviewedPractice = mappedRule ? RULE_PRACTICE[mappedRule] : null
  const fallbackRule = category === 'Grammar'
    ? 'subject-verb-singular'
    : category === 'Capitalization'
      ? 'sentence-capital'
      : 'terminal-punctuation'
  const practice = category === 'Spelling'
    ? dynamicSpellingPractice(match, original, replacement)
    : (reviewedPractice ?? RULE_PRACTICE[fallbackRule]).slice(
      (sameRuleIndex * 3) % (reviewedPractice ?? RULE_PRACTICE[fallbackRule]).length,
      ((sameRuleIndex * 3) % (reviewedPractice ?? RULE_PRACTICE[fallbackRule]).length) + 3,
    )
  return {
    ...input,
    id: `${ruleId}-${match.offset}`,
    correction: correctionTrial(body, input),
    practice: practice.map((item) => ({ ...item, choices: [...item.choices] })),
  }
}

function findingOverlapsMatch(finding: Finding, match: ProofreadingMatch) {
  const matchEdit = { start: match.offset, end: match.offset + match.length, replacement: '' }
  return inputEdits(finding).some((edit) => editsOverlap(edit, matchEdit))
}

function capitalizeLike(value: string, replacement: string) {
  return /^[A-Z]/.test(value) ? `${replacement[0].toUpperCase()}${replacement.slice(1)}` : replacement
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function capitalizeProperName(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`)
}

function inferredProperNames(body: string) {
  const names = new Map<string, string>()
  const ignored = new Set([
    'a', 'an', 'and', 'he', 'her', 'him', 'his', 'i', 'it', 'main', 'my', 'she', 'the', 'their',
    'them', 'they', 'this', 'we', 'who', 'you', 'your',
  ])
  const remember = (value: string) => {
    const normalized = value.toLowerCase()
    if (value.length < 2 || ignored.has(normalized)) return
    names.set(normalized, capitalizeProperName(value))
  }

  // Infer names only from explicit story context. This avoids treating every
  // unfamiliar lowercase word as a proper noun.
  const introducedName = /\bnamed\s+([a-z][a-z'’-]{1,30})\b/gi
  let match: RegExpExecArray | null
  while ((match = introducedName.exec(body)) !== null) remember(match[1])

  const calledName = /\b(?:boy|girl|person|character|friend|student|teacher|dog|cat|hamster|pet)\s+called\s+([a-z][a-z'’-]{1,30})\b/gi
  while ((match = calledName.exec(body)) !== null) remember(match[1])

  const characterThenAction = /\b(?:main\s+)?(?:character|characted|charater|caracter|protagonist)\s*,?\s+([a-z][a-z'’-]{1,30})\s*,?\s+(?=(?:is|was|went|said|asked|replied|shouted|whispered|had|has|did|does|walked|ran|lived|wanted|told|found|made|saw|liked|visited)\b)/gi
  while ((match = characterThenAction.exec(body)) !== null) remember(match[1])

  const speakerName = /\b([a-z][a-z'’-]{1,30})\s+(?=(?:said|asked|replied|shouted|whispered)\b)/gi
  while ((match = speakerName.exec(body)) !== null) remember(match[1])

  return [...names.values()]
}

export function inspectDraft(
  body: string,
  dictionary: WritingDictionary = { knownNames: ['Fionnbar'], knownPlaces: [] },
): Finding[] {
  const findings: Finding[] = []
  if (!body.trim()) return findings

  let match: RegExpExecArray | null

  const unexpectedCapitalizedVerb = /\b(I|you|we|they|he|she|it)\s+(Walked|Went|Bought|Played|Jumped|Looked|Saw|Got|Was|Were|Said|Asked|Made|Found|Read|Wrote|Felt|Ran|Cried|Laughed|Wanted|Visited|Opened|Closed|Finished|Started|Had|Did)\b/g
  while ((match = unexpectedCapitalizedVerb.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].lastIndexOf(verb)
    addFinding(body, findings, {
      ruleId: 'unexpected-midword-capital', category: 'Capitalization', start, end: start + verb.length,
      replacement: verb.toLowerCase(), message: `“${verb}” is an ordinary verb in the middle of the sentence.`,
      suggestion: `Use the lowercase form “${verb.toLowerCase()}”.`, wrongReplacement: verb.toUpperCase(),
    })
  }

  const subjectVerbCommaPatterns = [
    /\b(there)(,\s+)(?=(?:is|are|was|were)\b)/gi,
    /\b((?:the|a|an|my|your|his|her|our|their)\s+[A-Za-z][A-Za-z'’-]*)(,\s+)(?=(?:is|are|was|were|has|have|had)\b)/gi,
  ]
  for (const pattern of subjectVerbCommaPatterns) {
    while ((match = pattern.exec(body)) !== null) {
      const start = match.index + match[1].length
      addFinding(body, findings, {
        ruleId: 'subject-verb-comma', category: 'Punctuation', start, end: start + match[2].length,
        replacement: ' ', message: 'A comma incorrectly separates the sentence’s subject from its verb.',
        suggestion: 'Remove the comma between the subject and verb.', wrongReplacement: ',, ',
      })
    }
  }

  const commaSplicePatterns = [
    /\b(?:is|are|was|were)\s+[a-z][a-z'’-]*(,\s+)(I|he|she|it|we|they|the\s+[A-Za-z][A-Za-z'’-]*)\s+(?=(?:is|are|was|were|said|asked|replied|went|walked|had|has|did|does|bought|made|felt|looked)\b)/gi,
    /\b(?:bought|got|found|saw|made|carried|opened|finished)\s+(?:a|an|the|my|your|his|her|our|their)\s+[A-Za-z][A-Za-z'’-]*(,\s+)(I|he|she|it|we|they|the\s+[A-Za-z][A-Za-z'’-]*)\s+(?=(?:is|are|was|were|said|asked|replied|went|walked|had|has|did|does|made|felt|looked)\b)/gi,
  ]
  for (const pattern of commaSplicePatterns) {
    while ((match = pattern.exec(body)) !== null) {
      const separatorOffset = match[0].indexOf(match[1])
      const start = match.index + separatorOffset
      addFinding(body, findings, {
        ruleId: 'comma-splice', category: 'Punctuation', start,
        end: start + match[1].length + 1,
        replacement: `. ${match[2][0].toUpperCase()}`,
        message: 'A comma joins two complete sentences here, creating a run-on sentence.',
        suggestion: 'Use a period and begin the second sentence with a capital letter.',
        wrongReplacement: `, ${match[2][0].toUpperCase()}`,
      })
    }
  }

  const strayAfterQuotation = /([!?][”"])(\s+)I got\./g
  while ((match = strayAfterQuotation.exec(body)) !== null) {
    const start = match.index + match[1].length
    addFinding(body, findings, {
      ruleId: 'stray-followup-fragment', category: 'Grammar', start,
      end: match.index + match[0].length, replacement: '',
      message: '“I got” is a stray fragment after the completed quotation.',
      suggestion: 'Remove the accidental fragment so the quotation stands as a complete thought.',
      wrongReplacement: ' I got it.',
      contextStart: sentenceBounds(body, match.index).start,
      contextEnd: match.index + match[0].length,
    })
  }

  const whatsUpQuotation = /([“"])(what)\s+up(?=[!?])/gi
  while ((match = whatsUpQuotation.exec(body)) !== null) {
    const start = match.index + match[1].length
    addFinding(body, findings, {
      ruleId: 'whats-up-contraction', category: 'Grammar', start, end: start + match[2].length,
      replacement: 'What’s', message: '“What up” is missing the verb in the contraction “What’s.”',
      suggestion: 'Write “What’s up?” with a capital letter and an apostrophe.', wrongReplacement: 'Whats',
    })
  }

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

  // “Read” is intentionally excluded because its present and past spellings are identical.
  // A deterministic checker cannot safely change “Yesterday she read” to “reads.”
  const thirdPerson = /\b(he|she|it)\s+(walk|run|jump|play|write|eat|make|do|have|go|study)\b/gi
  const thirdPersonForms: Record<string, string> = {
    walk: 'walks', run: 'runs', jump: 'jumps', play: 'plays', write: 'writes',
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

  const perfectParticiples: Record<string, string> = {
    go: 'gone', see: 'seen', eat: 'eaten', write: 'written', take: 'taken', make: 'made', do: 'done',
    walk: 'walked', play: 'played', jump: 'jumped', cook: 'cooked', look: 'looked', visit: 'visited', finish: 'finished',
  }
  const perfectPattern = new RegExp(`\\b(has|have|had)\\s+(${Object.keys(perfectParticiples).join('|')})\\b`, 'gi')
  while ((match = perfectPattern.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].toLowerCase().lastIndexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, perfectParticiples[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'perfect-tense-participle', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `“${match[1]} ${verb}” does not form the perfect tense correctly.`,
      suggestion: `Use the past participle “${replacement}” after “${match[1]}”.`, wrongReplacement: `${replacement}ing`,
    })
  }

  const pastConsistency = /\b(Yesterday|Last night|Last week),?\s+[^.!?\n]{0,50}\b(walked|played|jumped|cooked|looked|visited)\s+and\s+(walks|plays|jumps|cooks|looks|visits)\b/gi
  const consistentPast: Record<string, string> = {
    walks: 'walked', plays: 'played', jumps: 'jumped', cooks: 'cooked', looks: 'looked', visits: 'visited',
  }
  while ((match = pastConsistency.exec(body)) !== null) {
    const verb = match[3]
    const start = match.index + match[0].toLowerCase().lastIndexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, consistentPast[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'past-tense-consistency', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `Both actions happened ${match[1].toLowerCase()}, so “${verb}” shifts tense.`,
      suggestion: `Keep the second action in the past tense with “${replacement}”.`, wrongReplacement: verb.replace(/s$/i, ''),
    })
  }

  const narrativePastShift = /\b(it|he|she)\s+(dies|walks|plays|runs|looks)\s+and\s+(he|she|it)\s+(was|were)\b/gi
  const narrativePastForms: Record<string, string> = {
    dies: 'died', walks: 'walked', plays: 'played', runs: 'ran', looks: 'looked',
  }
  while ((match = narrativePastShift.exec(body)) !== null) {
    const verb = match[2]
    const start = match.index + match[0].toLowerCase().indexOf(verb.toLowerCase())
    const replacement = capitalizeLike(verb, narrativePastForms[verb.toLowerCase()])
    addFinding(body, findings, {
      ruleId: 'past-tense-consistency', category: 'Grammar', start, end: start + verb.length, replacement,
      message: `“${verb}” shifts to the present even though the connected action uses the past tense.`,
      suggestion: `Keep the connected actions in the past tense with “${replacement}”.`,
      wrongReplacement: verb.replace(/s$/i, ''),
    })
  }

  const missingPredicateConjunction = /\b((?:went|walked|drove)\s+to\s+the\s+(?:store|shop|market))(\s+)(?=(?:cbouts|bought|purchased)\b)/gi
  while ((match = missingPredicateConjunction.exec(body)) !== null) {
    const start = match.index + match[1].length
    addFinding(body, findings, {
      ruleId: 'compound-predicate-conjunction', category: 'Grammar', start,
      end: start + match[2].length, replacement: ' and ',
      message: 'The same character performs two connected actions, but the joining word is missing.',
      suggestion: 'Use “and” to join “went” and “bought.”', wrongReplacement: ', ',
    })
  }

  for (const [opening, wrongClosing, correctClosing] of [
    ['either', 'nor', 'or'],
    ['neither', 'or', 'nor'],
    ['both', 'or', 'and'],
    ['both', 'nor', 'and'],
  ] as const) {
    const pairPattern = new RegExp(`\\b${opening}\\b[^.!?\\n]{1,80}\\b(${wrongClosing})\\b`, 'gi')
    while ((match = pairPattern.exec(body)) !== null) {
      const closing = match[1]
      const start = match.index + match[0].toLowerCase().lastIndexOf(closing.toLowerCase())
      addFinding(body, findings, {
        ruleId: 'correlative-conjunction', category: 'Grammar', start, end: start + closing.length,
        replacement: correctClosing,
        message: `“${opening}” does not pair with “${closing}”.`,
        suggestion: `Use the matching pair “${opening}/${correctClosing}”.`, wrongReplacement: 'and also',
      })
    }
  }

  const objectPronouns: Record<string, string> = { I: 'me', he: 'him', she: 'her', we: 'us', they: 'them' }
  const prepositionPronoun = /\b(with|for|to|from|beside)\s+(I|he|she|we|they)\b/g
  while ((match = prepositionPronoun.exec(body)) !== null) {
    const pronoun = match[2]
    const start = match.index + match[0].lastIndexOf(pronoun)
    const replacement = objectPronouns[pronoun]
    addFinding(body, findings, {
      ruleId: 'object-pronoun-after-preposition', category: 'Grammar', start, end: start + pronoun.length, replacement,
      message: `“${match[1]} ${pronoun}” needs an object pronoun.`,
      suggestion: `Use “${replacement}” after the preposition “${match[1]}”.`, wrongReplacement: `${replacement}s`,
    })
  }
  const betweenYouAndI = /\bbetween you and I\b/g
  while ((match = betweenYouAndI.exec(body)) !== null) {
    const start = match.index + match[0].length - 1
    addFinding(body, findings, {
      ruleId: 'object-pronoun-after-preposition', category: 'Grammar', start, end: start + 1, replacement: 'me',
      message: '“Between you and I” needs an object pronoun after the preposition.',
      suggestion: 'Use “between you and me.”', wrongReplacement: 'my',
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

  for (const [kind, entries] of [
    ['name', [...dictionary.knownNames, ...inferredProperNames(body)]],
    ['place', dictionary.knownPlaces],
  ] as const) {
    for (const entry of [...new Set(entries)]) {
      const expected = entry.trim()
      if (!expected) continue
      const pattern = new RegExp(`\\b${escapeRegex(expected.toLowerCase())}\\b`, 'g')
      const lowered = body.toLowerCase()
      while ((match = pattern.exec(lowered)) !== null) {
        const actual = body.slice(match.index, match.index + expected.length)
        if (actual === expected) continue
        addFinding(body, findings, {
          ruleId: `known-${kind}`, category: 'Capitalization', start: match.index,
          end: match.index + expected.length, replacement: expected,
          message: `The known ${kind} “${expected}” needs its saved capitalization.`,
          suggestion: `Write “${expected}”.`, wrongReplacement: expected.toUpperCase(),
        })
      }
    }
  }

  // Treat a simple title and surname as one correction so “dr. smith” does not
  // produce a confusing sentence-start correction followed by a second finding.
  const titlePattern = /\b(mr|mrs|ms|dr)\.\s+([A-Za-z][a-z]*)\b/gi
  while ((match = titlePattern.exec(body)) !== null) {
    const title = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`
    const name = `${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}`
    const replacement = `${title}. ${name}`
    if (match[0] === replacement) continue
    addFinding(body, findings, {
      ruleId: 'title-capital', category: 'Capitalization', start: match.index,
      end: match.index + match[0].length, replacement,
      message: `“${match[0]}” needs standard title and name capitalization.`,
      suggestion: `Write “${replacement}”.`, wrongReplacement: replacement.toUpperCase(),
    })
  }

  const appositiveName = /\b((?:main\s+)?(?:character|characted|charater|caracter|protagonist))(\s*,\s*|\s+)([A-Za-z][A-Za-z'’-]{1,30})(\s*,\s*|\s+)(?=(?:is|was|went|said|asked|replied|shouted|whispered|had|has|did|does|walked|ran|lived|wanted|told|found|made|saw|liked|visited)\b)/gi
  while ((match = appositiveName.exec(body)) !== null) {
    const name = capitalizeProperName(match[3])
    const beforeStart = match.index + match[1].length
    const beforeEnd = beforeStart + match[2].length
    if (match[2] !== ', ') {
      addFinding(body, findings, {
        ruleId: 'appositive-name-commas', category: 'Punctuation', start: beforeStart, end: beforeEnd,
        replacement: ', ', message: `The name “${name}” needs a comma before it.`,
        suggestion: `Write “${match[1]}, ${name}, …”`, wrongReplacement: ' ',
      })
    }
    const afterStart = beforeEnd + match[3].length
    const afterEnd = afterStart + match[4].length
    if (match[4] !== ', ') {
      addFinding(body, findings, {
        ruleId: 'appositive-name-commas', category: 'Punctuation', start: afterStart, end: afterEnd,
        replacement: ', ', message: `The name “${name}” needs a comma after it.`,
        suggestion: `Write “${match[1]}, ${name}, …”`, wrongReplacement: ' ',
      })
    }
  }

  // These high-confidence patterns recover direct speech when a child writes
  // the spoken words but leaves out both quotation marks. One finding carries
  // both edits so the child reviews the quotation error once, while spelling
  // and grammar inside the quotation remain available as separate findings.
  const unquotedDialoguePatterns = [
    /\b(said|replied|shouted|whispered|yelled|cried|called)(\s+)((?:what\s+(?:a|an)\b|hello\b|hi\b|hey\b|wow\b|look\b|stop\b|wait\b|yes\b|no\b|please\b))([^.!?\n]*)([.!?])/gi,
    /\b(asked)(\s+)((?:are|is|do|does|did|can|could|will|would|why|when|where|who|how|what)\b)([^.!?\n]*)(\?)/gi,
  ]
  for (const pattern of unquotedDialoguePatterns) {
    while ((match = pattern.exec(body)) !== null) {
      const separatorStart = match.index + match[1].length
      const firstLetter = match[3][0]
      const punctuationStart = match.index + match[0].length - match[5].length
      const contextStart = sentenceBounds(body, match.index).start
      addFinding(body, findings, {
        ruleId: 'missing-dialogue-quotes', category: 'Punctuation',
        start: separatorStart, end: separatorStart + match[2].length + 1,
        replacement: `, “${firstLetter.toUpperCase()}`,
        additionalEdits: [{
          start: punctuationStart,
          end: punctuationStart + match[5].length,
          replacement: `${match[5]}”`,
        }],
        contextStart,
        contextEnd: punctuationStart + match[5].length,
        message: 'These are a character’s exact spoken words, so they need quotation marks.',
        suggestion: 'Add a comma and opening quotation mark before the dialogue, then a closing quotation mark after its ending punctuation.',
        wrongReplacement: ` “${firstLetter.toUpperCase()}`,
      })
    }
  }

  const unquotedLikeDialogue = /\b((?:was|were)\s+like)([\s.,:;-]+)((?:what(?:['’]s|\s+is)?\s+up|hello|hi|hey|wow|no\s+way|yes)\b)([^.!?\n]*)([.!?])/gi
  while ((match = unquotedLikeDialogue.exec(body)) !== null) {
    const separatorStart = match.index + match[1].length
    const firstLetter = match[3][0]
    const whatsUp = /^what(?:['’]s|\s+is)?\s+up\b/i.test(match[3])
    const primaryEnd = whatsUp
      ? separatorStart + match[2].length + 'what'.length
      : separatorStart + match[2].length + 1
    const primaryReplacement = whatsUp ? ', “What’s' : `, “${firstLetter.toUpperCase()}`
    const punctuationStart = match.index + match[0].length - match[5].length
    addFinding(body, findings, {
      ruleId: whatsUp ? 'whats-up-contraction' : 'missing-dialogue-quotes',
      category: whatsUp ? 'Grammar' : 'Punctuation',
      start: separatorStart, end: primaryEnd,
      replacement: primaryReplacement,
      additionalEdits: [{
        start: punctuationStart,
        end: punctuationStart + match[5].length,
        replacement: `${match[5]}”`,
      }],
      contextStart: sentenceBounds(body, match.index).start,
      contextEnd: punctuationStart + match[5].length,
      message: whatsUp
        ? 'This dialogue needs quotation marks and the contraction “What’s.”'
        : 'The words after “was like” are direct dialogue and need quotation marks.',
      suggestion: whatsUp
        ? 'Write the dialogue as “What’s up!”'
        : 'Introduce the spoken words with a comma and place them inside quotation marks.',
      wrongReplacement: whatsUp ? ' “Whats' : ` “${firstLetter.toUpperCase()}`,
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
  const calendarPattern = new RegExp(`\\b(${calendarWords.join('|')})\\b`, 'gi')
  while ((match = calendarPattern.exec(body)) !== null) {
    const replacement = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`
    if (match[1] === replacement) continue
    addFinding(body, findings, {
      ruleId: 'calendar-capital', category: 'Capitalization', start: match.index,
      end: match.index + match[1].length, replacement,
      message: `“${match[1]}” is a day or month.`, suggestion: `Capitalize it as “${replacement}”.`,
      wrongReplacement: match[1].toUpperCase(),
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

  const interjectionPattern = /(^|[.!?]\s+|\n)(Wow|Yes|No|Oh|Well)(\s+)(?=(I|we|he|she|they|it|that|this|you)\b)/g
  while ((match = interjectionPattern.exec(body)) !== null) {
    const start = match.index + match[1].length + match[2].length
    addFinding(body, findings, {
      ruleId: 'interjection-comma', category: 'Punctuation', start, end: start + match[3].length, replacement: ', ',
      message: `The opening interjection “${match[2]}” needs a comma.`,
      suggestion: `Place a comma after “${match[2]}”.`, wrongReplacement: ' ',
    })
  }

  const directAddressNames = [...new Set(['Mom', 'Dad', 'Fionnbar', ...dictionary.knownNames])]
    .filter(Boolean)
    .map(escapeRegex)
    .join('|')
  if (directAddressNames) {
    const directAddressPattern = new RegExp(`(^|[.!?]\\s+|\\n)(Thanks|Hello|Goodbye)(\\s+)(?=(${directAddressNames})\\b)`, 'g')
    while ((match = directAddressPattern.exec(body)) !== null) {
      const start = match.index + match[1].length + match[2].length
      addFinding(body, findings, {
        ruleId: 'direct-address-comma', category: 'Punctuation', start, end: start + match[3].length, replacement: ', ',
        message: `The person addressed after “${match[2]}” needs to be separated with a comma.`,
        suggestion: `Place a comma after “${match[2]}”.`, wrongReplacement: ' ',
      })
    }
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

  const fusedSentence = /\b(?:a|an|the)\s+[A-Za-z]+(\s+)(it)(?=\s+(?:is|was|has|had|dies|died|runs|ran|gets|got|becomes|became|sleeps|slept|looks|looked)\b)/gi
  while ((match = fusedSentence.exec(body)) !== null) {
    const start = match.index + match[0].length - match[1].length - match[2].length
    addFinding(body, findings, {
      ruleId: 'fused-sentence-break', category: 'Punctuation', start,
      end: match.index + match[0].length, replacement: '. It',
      message: 'Two complete thoughts have been joined without an ending mark.',
      suggestion: 'End the first thought with a period and begin “It” with a capital letter.',
      wrongReplacement: ', it',
    })
  }

  const compoundSentence = /\b(?:it|he|she|they|we|I)\s+(?:is|are|was|were|has|have|had|does|did|dies|died|runs|ran|laughs|laughed|cries|cried|finishes|finished|feels|felt|wants|wanted|goes|went)(?:\s+[A-Za-z]+){0,3}(\s+)and(\s+)(?=(?:it|he|she|they|we|I)\s+(?:is|are|was|were|has|have|had|does|did|runs|ran|laughs|laughed|cries|cried|checks|checked|feels|felt|wants|wanted|goes|went)\b)/gi
  while ((match = compoundSentence.exec(body)) !== null) {
    const start = match.index + match[0].length - match[2].length - 'and'.length - match[1].length
    addFinding(body, findings, {
      ruleId: 'compound-sentence-comma', category: 'Punctuation', start,
      end: start + match[1].length, replacement: ', ',
      message: '“And” joins two complete thoughts, so it needs a comma before it.',
      suggestion: 'Place a comma before “and.”', wrongReplacement: ' ',
    })
  }

  const dialogueIntroduction = /\b(said|asked|replied|shouted|whispered|yelled|cried|called)(\s+)(?=[“"])/gi
  while ((match = dialogueIntroduction.exec(body)) !== null) {
    const start = match.index + match[1].length
    addFinding(body, findings, {
      ruleId: 'dialogue-introduction-comma', category: 'Punctuation', start,
      end: start + match[2].length, replacement: ', ',
      message: `The dialogue after “${match[1]}” needs an introductory comma.`,
      suggestion: 'Place a comma before the opening quotation mark.', wrongReplacement: ' ',
    })
  }

  const quotationCapital = /[“"]([a-z])/g
  while ((match = quotationCapital.exec(body)) !== null) {
    if (!isDirectQuoteStart(body, match.index)) continue
    const start = match.index + 1
    addFinding(body, findings, {
      ruleId: 'quotation-capitalization', category: 'Capitalization', start, end: start + 1,
      replacement: match[1].toUpperCase(),
      message: 'The first word of a direct quotation begins with a capital letter.',
      suggestion: `Capitalize “${match[1]}” at the beginning of the quotation.`,
      wrongReplacement: `${match[1].toUpperCase()}${match[1]}`,
    })
  }

  const punctuationOutsideQuote = /([”"])([,.!?])/g
  while ((match = punctuationOutsideQuote.exec(body)) !== null) {
    addFinding(body, findings, {
      ruleId: 'quotation-punctuation-inside', category: 'Punctuation',
      start: match.index, end: match.index + match[0].length,
      replacement: `${match[2]}${match[1]}`,
      message: 'The ending punctuation for this quotation belongs inside the closing quotation mark.',
      suggestion: `Move “${match[2]}” before the closing quotation mark.`,
      wrongReplacement: `${match[1]}${match[2]}${match[2]}`,
    })
  }

  const periodBeforeDialogueTag = /(\.)([”"])(\s+)(?=(?:[A-Z][A-Za-z'’-]*|he|she|they|I)\s+(?:said|asked|replied|shouted|whispered|yelled|cried)\b)/g
  while ((match = periodBeforeDialogueTag.exec(body)) !== null) {
    const tagEnding = /[.!?]/.exec(body.slice(match.index + match[0].length))
    addFinding(body, findings, {
      ruleId: 'dialogue-tag-comma', category: 'Punctuation', start: match.index, end: match.index + 1,
      replacement: ',', message: 'A quotation followed by a dialogue tag uses a comma instead of a period.',
      suggestion: 'Use a comma inside the quotation before the speaker tag.', wrongReplacement: ';',
      contextStart: sentenceBounds(body, match.index).start,
      contextEnd: tagEnding
        ? match.index + match[0].length + tagEnding.index + 1
        : sentenceBounds(body, match.index).end,
    })
  }

  const capitalizedDialogueTag = /([”"]\s+)(Said|Asked|Replied|Shouted|Whispered|Yelled|Cried)\b/g
  while ((match = capitalizedDialogueTag.exec(body)) !== null) {
    const start = match.index + match[1].length
    addFinding(body, findings, {
      ruleId: 'dialogue-tag-capitalization', category: 'Capitalization', start, end: start + match[2].length,
      replacement: match[2].toLowerCase(), message: 'A dialogue tag continues the sentence, so it begins with a lowercase letter.',
      suggestion: `Write “${match[2].toLowerCase()}” after the quotation.`, wrongReplacement: match[2].toUpperCase(),
    })
  }

  const completeQuotation = /([“"])([^“”"\n]{1,160})([”"])/g
  while ((match = completeQuotation.exec(body)) !== null) {
    if (!isDirectQuoteStart(body, match.index)) continue
    const finalCharacter = match[2].at(-1) ?? ''
    if (/[,.!?]/.test(finalCharacter)) continue
    const closingStart = match.index + match[1].length + match[2].length
    const afterQuote = body.slice(closingStart + match[3].length)
    const followedByTag = /^\s+(?:(?:said|asked|replied|shouted|whispered|yelled|cried)\b|(?:[A-Z][A-Za-z'’-]*|he|she|they|I)\s+(?:said|asked|replied|shouted|whispered|yelled|cried)\b)/.test(afterQuote)
    const atSentenceEnd = !afterQuote.trim() || /^\s*[.!?]/.test(afterQuote)
    if (!followedByTag && !atSentenceEnd) continue
    const ending = followedByTag ? ',' : '.'
    addFinding(body, findings, {
      ruleId: 'quotation-punctuation-inside', category: 'Punctuation',
      start: closingStart, end: closingStart + match[3].length,
      replacement: `${ending}${match[3]}`,
      message: 'The direct quotation needs an ending punctuation mark inside the closing quotation mark.',
      suggestion: `Place “${ending}” before the closing quotation mark.`, wrongReplacement: `${match[3]}${ending}`,
    })
  }

  const missingOpeningQuote = /\b(said|asked|replied|shouted|whispered|yelled|cried|called)(,\s+)(?![“"])([A-Za-z])([^.!?\n]{0,150}[.!?])([”"])/gi
  while ((match = missingOpeningQuote.exec(body)) !== null) {
    const start = match.index + match[1].length + match[2].length
    addFinding(body, findings, {
      ruleId: 'paired-quotes', category: 'Punctuation', start, end: start + 1,
      replacement: `“${match[3].toUpperCase()}`,
      message: 'This quotation has a closing mark but no opening quotation mark.',
      suggestion: 'Add the opening quotation mark before the spoken words.', wrongReplacement: `${match[3]}“`,
      contextStart: sentenceBounds(body, match.index).start,
      contextEnd: match.index + match[0].length,
    })
  }

  let openQuote: { index: number; character: string } | null = null
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === '“') {
      if (!openQuote) openQuote = { index, character }
      continue
    }
    if (character === '”') {
      if (openQuote) openQuote = null
      continue
    }
    if (character !== '"') continue
    if (openQuote) {
      openQuote = null
      continue
    }
    const previous = body[index - 1] ?? ''
    const next = body[index + 1] ?? ''
    const looksLikeClosingMark = /[A-Za-z0-9.!?]/.test(previous) && (!next || /\s/.test(next))
    if (!looksLikeClosingMark) openQuote = { index, character }
  }
  if (openQuote) {
    const closingMark = openQuote.character === '“' ? '”' : '"'
    const afterOpening = body.slice(openQuote.index + 1)
    const endingMatch = /[.!?]/.exec(afterOpening)
    if (endingMatch) {
      const start = openQuote.index + 1 + endingMatch.index
      addFinding(body, findings, {
        ruleId: 'paired-quotes', category: 'Punctuation', start, end: start + 1,
        replacement: `${body[start]}${closingMark}`,
        message: 'This quotation has an opening mark but no closing quotation mark.',
        suggestion: 'Add the closing quotation mark after the spoken sentence’s ending punctuation.',
        wrongReplacement: `${closingMark}${body[start]}`,
      })
    } else {
      const end = body.trimEnd().length
      addFinding(body, findings, {
        ruleId: 'paired-quotes', category: 'Punctuation', start: end, end,
        replacement: `.${closingMark}`,
        message: 'This quotation needs ending punctuation and a closing quotation mark.',
        suggestion: 'End the spoken sentence, then close its quotation marks.', wrongReplacement: closingMark,
      })
    }
  }

  const trimmedEnd = body.trimEnd().length
  const trimmedBody = body.slice(0, trimmedEnd)
  const pairedQuoteCompletesEnding = findings.some((finding) => (
    finding.ruleId === 'paired-quotes'
      && finding.start === trimmedEnd
      && /[.!?]/.test(finding.replacement)
  ))
  if (trimmedEnd > 0 && !pairedQuoteCompletesEnding && !/[.!?](?:[”"'])?$/.test(trimmedBody)) {
    const closingQuote = /[”"]$/.test(trimmedBody) ? trimmedBody.at(-1) ?? '' : ''
    const start = closingQuote ? trimmedEnd - 1 : trimmedEnd
    addFinding(body, findings, {
      ruleId: 'terminal-punctuation', category: 'Punctuation', start,
      end: closingQuote ? trimmedEnd : trimmedEnd,
      replacement: closingQuote ? `.${closingQuote}` : '.', message: 'The final sentence needs an ending mark.',
      suggestion: 'Add a period, question mark, or exclamation mark.', wrongReplacement: '..',
    })
  }

  return findings.sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
}

export function inspectWritingFindings(
  body: string,
  dictionary: WritingDictionary = { knownNames: ['Fionnbar'], knownPlaces: [] },
  proofreadingMatches: ProofreadingMatch[] = [],
) {
  const findings = [...inspectDraft(body, dictionary), ...inspectSpellingFindings(body, dictionary)]
  const ruleCounts = new Map<string, number>()
  for (const match of proofreadingMatches) {
    if (findings.some((finding) => findingOverlapsMatch(finding, match))) continue
    if (match.offset < 0 || match.length < 0 || match.offset + match.length > body.length) continue
    const count = ruleCounts.get(match.ruleId) ?? 0
    const finding = proofreadingFinding(body, match, count)
    if (!finding || findings.some((item) => finding.start < item.end && finding.end > item.start)) continue
    findings.push(finding)
    ruleCounts.set(match.ruleId, count + 1)
  }
  return findings.sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
}

export type AmbiguousWritingFinding = {
  id: string
  category: 'Grammar' | 'Punctuation'
  message: string
  excerpt: string
}

export function inspectAmbiguousDraft(body: string): AmbiguousWritingFinding[] {
  const items: AmbiguousWritingFinding[] = []
  let match: RegExpExecArray | null
  const repeatedWord = /\b([a-z]{2,})\s+\1\b/gi
  while ((match = repeatedWord.exec(body)) !== null) {
    items.push({
      id: `repeated-word-${match.index}`,
      category: 'Grammar',
      message: `“${match[0]}” may repeat a word accidentally.`,
      excerpt: sentenceBounds(body, match.index).start === sentenceBounds(body, match.index).end
        ? match[0]
        : body.slice(sentenceBounds(body, match.index).start, sentenceBounds(body, match.index).end),
    })
  }

  const irregularYesterday = /\byesterday\b[^.!?\n]{0,70}\b(go|see|eat|run|write|make|take)\b/gi
  while ((match = irregularYesterday.exec(body)) !== null) {
    const bounds = sentenceBounds(body, match.index)
    items.push({
      id: `irregular-tense-${match.index}`,
      category: 'Grammar',
      message: 'This sentence may need an irregular past-tense verb. A parent should review it.',
      excerpt: body.slice(bounds.start, bounds.end),
    })
  }

  for (const [paragraphIndex, paragraph] of body.split(/\n+/).entries()) {
    const words = paragraph.trim().match(/\S+/g) ?? []
    if (words.length >= 35 && !/[.!?]/.test(paragraph)) {
      items.push({
        id: `long-sentence-${paragraphIndex}`,
        category: 'Punctuation',
        message: 'This long passage may need sentence breaks, but the app cannot decide them safely.',
        excerpt: `${paragraph.trim().slice(0, 160)}${paragraph.trim().length > 160 ? '…' : ''}`,
      })
    }
  }
  return items
}

export function applyCompletedCorrections(
  body: string,
  findings: Finding[],
  progress: Record<string, FindingProgress>,
) {
  return findings
    .filter((finding) => progress[finding.id]?.correctionComplete)
    .flatMap((finding) => inputEdits(finding))
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((corrected, edit) => (
      `${corrected.slice(0, edit.start)}${edit.replacement}${corrected.slice(edit.end)}`
    ), body)
}

export function advanceFindingProgress(
  current: FindingProgress | undefined,
  correct: boolean,
  practiceTarget = 3,
): FindingProgress {
  const progress = current ?? { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }
  const next = {
    ...progress,
    incorrectAttempts: progress.incorrectAttempts + (correct ? 0 : 1),
    attemptResults: [...(progress.attemptResults ?? []), correct],
  }
  if (!progress.correctionComplete) return { ...next, correctionComplete: true }
  return { ...next, practiceCompleted: Math.min(practiceTarget, progress.practiceCompleted + 1) }
}

export function skipRemainingWritingTrials(
  findings: Finding[],
  current: Record<string, FindingProgress>,
) {
  return Object.fromEntries(findings.map((finding) => {
    const progress = current[finding.id] ?? {
      correctionComplete: false,
      practiceCompleted: 0,
      incorrectAttempts: 0,
    }
    const requiredResponses = finding.practice.length + 1
    const attemptResults = Array.isArray(progress.attemptResults)
      ? progress.attemptResults.slice(0, requiredResponses).map(Boolean)
      : []
    while (attemptResults.length < requiredResponses) attemptResults.push(false)
    return [finding.id, {
      correctionComplete: true,
      practiceCompleted: finding.practice.length,
      incorrectAttempts: Math.max(
        progress.incorrectAttempts,
        attemptResults.filter((result) => !result).length,
      ),
      attemptResults,
    }]
  }))
}

export type WritingScore = {
  correct: number
  total: number
  percent: number
  cumulativePercent: number[]
}

export function evaluateWritingChoice(trial: WritingTrial, choice: string) {
  if (!trial.choices.includes(choice)) throw new Error('The selected writing answer is not part of this trial')
  const correct = choice === trial.correctAnswer
  return {
    choice,
    correct,
    correctAnswer: trial.correctAnswer,
    summary: correct
      ? 'Correct.'
      : `Not quite. The correct answer is “${trial.correctAnswer}”`,
    explanation: trial.explanation,
  }
}

export type WritingAnswerState = {
  firstChoice: string
  firstAttemptCorrect: boolean
  resolved: boolean
  feedback: ReturnType<typeof evaluateWritingChoice>
}

export function resolveWritingChoice(
  trial: WritingTrial,
  choice: string,
  current: WritingAnswerState | null = null,
): WritingAnswerState {
  if (current?.resolved) return current
  const evaluated = evaluateWritingChoice(trial, choice)
  if (!current) {
    return {
      firstChoice: choice,
      firstAttemptCorrect: evaluated.correct,
      resolved: evaluated.correct,
      feedback: evaluated.correct
        ? evaluated
        : {
            ...evaluated,
            summary: `${evaluated.summary}. Select that answer to continue.`,
          },
    }
  }
  if (!evaluated.correct) {
    return {
      ...current,
      feedback: {
        ...evaluated,
        summary: `${evaluated.summary}. Select that answer to continue.`,
      },
    }
  }
  return {
    ...current,
    resolved: true,
    feedback: {
      ...evaluated,
      summary: `Corrected. The correct answer is “${trial.correctAnswer}”`,
    },
  }
}

export function scoreWritingResponses(
  findings: Finding[],
  progress: Record<string, FindingProgress>,
): WritingScore {
  const results = findings.flatMap((finding) => progress[finding.id]?.attemptResults ?? [])
  const correct = results.filter(Boolean).length
  return {
    correct,
    total: results.length,
    percent: results.length ? Math.round((correct / results.length) * 100) : 100,
    cumulativePercent: results.map((_, index) => {
      const correctSoFar = results.slice(0, index + 1).filter(Boolean).length
      return Math.round((correctSoFar / (index + 1)) * 100)
    }),
  }
}

export function writingReviewStatus(
  findings: Finding[],
  progress: Record<string, FindingProgress>,
  spellingWords?: SpellingWord[],
  spellingProgress: Record<string, SpellingProgress> = {},
): 'practice' | 'spelling-pending' | 'complete' {
  const complete = findings.every((finding) => {
    const item = progress[finding.id]
    return item?.correctionComplete && item.practiceCompleted >= finding.practice.length
  })
  if (!complete) return 'practice'
  if (!spellingWords) return 'spelling-pending'
  return spellingPracticeComplete(spellingWords, spellingProgress) ? 'complete' : 'spelling-pending'
}
