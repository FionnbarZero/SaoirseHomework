const params = new URLSearchParams(window.location.hash.slice(1))
const sessionId = params.get('sessionId') || ''
const nonce = params.get('nonce') || ''
const day = params.get('day') || 'Today'
const completionUrl = params.get('completionUrl') || ''

// Remove the one-time token from the address bar without losing the in-memory value.
window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

const questions = [
  {
    strategy: 'Find the main idea',
    title: 'What is this passage mostly about?',
    passage: 'Mara planted three sunflower seeds beside the fence. She watered them each morning. By midsummer, their yellow faces stood taller than she did.',
    answers: ['How to build a fence', 'Mara growing sunflowers', 'Why summer is warm', 'Three kinds of seeds'],
    correct: 1,
  },
  {
    strategy: 'Use context clues',
    title: 'What does “reluctant” most likely mean?',
    passage: 'Theo was reluctant to step onto the shaky bridge. He stayed at the edge until his guide promised it was safe.',
    answers: ['Eager and excited', 'Unsure or unwilling', 'Noisy and cheerful', 'Fast and careless'],
    correct: 1,
  },
  {
    strategy: 'Make an inference',
    title: 'What can you infer about the weather?',
    passage: 'Nia zipped her coat to her chin. Her breath made pale clouds, and the puddles along the path had turned to glassy ice.',
    answers: ['It is very cold', 'It is raining hard', 'It is a hot afternoon', 'A storm just ended'],
    correct: 0,
  },
]

const gameCard = document.querySelector('#game-card')
const resultCard = document.querySelector('#result-card')
const dayBadge = document.querySelector('#day-badge')
const stepLabel = document.querySelector('#step-label')
const progressBar = document.querySelector('#progress-bar')
const strategyLabel = document.querySelector('.strategy-label')
const questionTitle = document.querySelector('#question-title')
const passage = document.querySelector('#passage')
const answers = document.querySelector('#answers')
const nextButton = document.querySelector('#next-button')
const feedback = document.querySelector('#feedback')
const resultLabel = document.querySelector('#result-label')
const resultTitle = document.querySelector('#result-title')
const resultCopy = document.querySelector('#result-copy')
const closeButton = document.querySelector('#close-button')

let questionIndex = 0
let selectedIndex = null
let checked = false

dayBadge.textContent = day
closeButton.addEventListener('click', () => window.close())

function showConfigurationError() {
  gameCard.hidden = true
  resultCard.hidden = false
  resultCard.classList.add('failed')
  resultLabel.textContent = 'SESSION NOT AVAILABLE'
  resultTitle.textContent = 'Launch this simulator from Homework Quest.'
  resultCopy.textContent = 'The secure session information is missing or invalid.'
  closeButton.hidden = false
}

function renderQuestion() {
  const question = questions[questionIndex]
  selectedIndex = null
  checked = false
  stepLabel.textContent = `Question ${questionIndex + 1} of ${questions.length}`
  progressBar.style.width = `${((questionIndex + 1) / questions.length) * 100}%`
  strategyLabel.textContent = question.strategy.toUpperCase()
  questionTitle.textContent = question.title
  passage.textContent = question.passage
  feedback.textContent = ''
  nextButton.disabled = true
  nextButton.textContent = 'Check answer'
  answers.replaceChildren(...question.answers.map((answer, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'answer'
    button.textContent = answer
    button.addEventListener('click', () => {
      if (checked) return
      selectedIndex = index
      for (const choice of answers.children) choice.classList.remove('selected')
      button.classList.add('selected')
      nextButton.disabled = false
    })
    return button
  }))
}

async function submitCompletion() {
  gameCard.hidden = true
  resultCard.hidden = false

  try {
    const target = new URL(completionUrl)
    if (target.origin !== window.location.origin) throw new Error('The completion service is not trusted.')
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `Verification failed (${response.status})`)

    resultCard.classList.add('verified')
    resultLabel.textContent = 'VERIFIED COMPLETE'
    resultTitle.textContent = 'Your result is safely recorded.'
    resultCopy.textContent = `${day} now includes Reading Strategies. You can close this window and return to Homework Quest.`
    closeButton.hidden = false
    window.opener?.postMessage({ type: 'reading-game-complete', sessionId }, window.location.origin)
  } catch (error) {
    resultCard.classList.add('failed')
    resultLabel.textContent = 'COULD NOT VERIFY'
    resultTitle.textContent = 'Your result was not recorded.'
    resultCopy.textContent = error instanceof Error ? error.message : 'Return to Homework Quest and launch a new round.'
    closeButton.hidden = false
  }
}

nextButton.addEventListener('click', () => {
  const question = questions[questionIndex]
  if (selectedIndex === null) return

  if (!checked) {
    checked = true
    const choices = [...answers.children]
    choices[question.correct].classList.add('correct')
    if (selectedIndex !== question.correct) {
      choices[selectedIndex].classList.add('incorrect')
      feedback.textContent = 'Good try. Notice the clues, then continue.'
    } else {
      feedback.textContent = 'That’s it — nice reading!'
    }
    nextButton.textContent = questionIndex === questions.length - 1 ? 'Finish round' : 'Next question'
    return
  }

  if (questionIndex === questions.length - 1) {
    void submitCompletion()
    return
  }
  questionIndex += 1
  renderQuestion()
})

if (!sessionId || !nonce || !completionUrl) showConfigurationError()
else renderQuestion()
