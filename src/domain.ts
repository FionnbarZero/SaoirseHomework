export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export type DayName = (typeof DAYS)[number]

export type CompletionMethod = 'self' | 'timer' | 'verified' | 'coming-soon'

export type RequiredActivity = {
  id: string
  title: string
  description: string
  method: CompletionMethod
  minutes?: number
  icon: string
}

export type OptionalActivity = {
  id: string
  title: string
  instruction: string
  sessions: number
  minutes: number
  icon: string
  detail: string
}

export type Finding = {
  id: string
  category: 'Capitalization' | 'Punctuation'
  message: string
  suggestion: string
}

export type Draft = {
  id: string
  title: string
  body: string
  updatedAt: string
  findings: Finding[]
}

export type RewardCredit = {
  id: string
  source: string
  remainingSeconds: number
  earnedAt: string
}

export type ActiveTimer = {
  kind: 'required' | 'optional' | 'reward'
  activityId: string
  sessionKey?: string
  label: string
  totalSeconds: number
  remainingSeconds: number
  running: boolean
}

export type AppState = {
  entered: boolean
  requiredByDay: Record<DayName, string[]>
  optionalCompleted: string[]
  rewardCredits: RewardCredit[]
  drafts: Draft[]
  activeTimer: ActiveTimer | null
  guardianConnected: boolean
}

export const REQUIRED_ACTIVITIES: RequiredActivity[] = [
  {
    id: 'mandarin',
    title: 'Mandarin Daily Work',
    description: 'Finish today’s Mandarin assignment.',
    method: 'self',
    icon: '你',
  },
  {
    id: 'math',
    title: 'Daily Math Practice',
    description: 'Complete today’s math practice.',
    method: 'self',
    icon: '×',
  },
  {
    id: 'english-packet',
    title: 'Daily English Packet',
    description: 'Complete the assigned English pages.',
    method: 'self',
    icon: 'Aa',
  },
  {
    id: 'reading-strategies',
    title: 'Reading Strategies Game',
    description: 'Complete one verified game round.',
    method: 'verified',
    icon: 'RS',
  },
  {
    id: 'ninja-dojo',
    title: 'Ninja Dojo',
    description: 'Focused time in the 5th Grade Learning Hub.',
    method: 'timer',
    minutes: 17,
    icon: '忍',
  },
  {
    id: 'english-escape',
    title: 'English Escape',
    description: 'A new English adventure is being built.',
    method: 'coming-soon',
    minutes: 10,
    icon: '🔐',
  },
]

export const OPTIONAL_ACTIVITIES: OptionalActivity[] = [
  {
    id: 'voena',
    title: 'Voena',
    instruction: 'Practice Voena',
    sessions: 3,
    minutes: 20,
    icon: '♪',
    detail: 'Warm up, rehearse, and sing with intention.',
  },
  {
    id: 'drums',
    title: 'Drum Drills',
    instruction: 'Practice Drums',
    sessions: 3,
    minutes: 20,
    icon: '🥁',
    detail: 'Choose a drill and keep a steady rhythm.',
  },
  {
    id: 'band',
    title: 'Band Practice',
    instruction: 'Practice Band Vocals',
    sessions: 3,
    minutes: 20,
    icon: '⚡',
    detail: 'Rehearse this week’s vocals and tricky sections.',
  },
  {
    id: 'level-chinese',
    title: 'Level Chinese',
    instruction: 'Enter Level Learning',
    sessions: 2,
    minutes: 20,
    icon: '中',
    detail: 'Log in with Clever, then begin Level Learning.',
  },
  {
    id: 'du-chinese',
    title: 'Du Chinese',
    instruction: 'Read, then review',
    sessions: 2,
    minutes: 20,
    icon: '读',
    detail: 'Read for 13 minutes, then use flashcards for 7.',
  },
]

export const OPTIONAL_TARGETS: Record<DayName, number> = {
  Monday: 3,
  Tuesday: 6,
  Wednesday: 9,
  Thursday: 11,
  Friday: 13,
}

export const defaultState: AppState = {
  entered: false,
  requiredByDay: {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
  },
  optionalCompleted: [],
  rewardCredits: [],
  drafts: [],
  activeTimer: null,
  guardianConnected: false,
}

export function activeRequiredActivities() {
  return REQUIRED_ACTIVITIES.filter((activity) => activity.method !== 'coming-soon')
}

export function optionalSessionKey(activityId: string, index: number) {
  return `${activityId}:${index}`
}

export function completedRequiredCount(state: AppState, day: DayName) {
  return state.requiredByDay[day].filter((id) =>
    activeRequiredActivities().some((activity) => activity.id === id),
  ).length
}

export function dayIsComplete(state: AppState, day: DayName) {
  return (
    completedRequiredCount(state, day) === activeRequiredActivities().length &&
    state.optionalCompleted.length >= OPTIONAL_TARGETS[day]
  )
}

export function progressForDay(state: AppState, day: DayName) {
  const required = completedRequiredCount(state, day)
  const requiredTotal = activeRequiredActivities().length
  const optional = Math.min(state.optionalCompleted.length, OPTIONAL_TARGETS[day])
  return {
    required,
    requiredTotal,
    optional,
    optionalTarget: OPTIONAL_TARGETS[day],
    percent: Math.round(((required + optional) / (requiredTotal + OPTIONAL_TARGETS[day])) * 100),
  }
}

export function getToday(): DayName {
  const current = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
  return DAYS.includes(current as DayName) ? (current as DayName) : 'Monday'
}

export function getWeekLabel() {
  const now = new Date()
  const weekday = now.getDay()
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const format = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  return `${format.format(monday)} – ${format.format(friday)}`
}

export function inspectDraft(body: string): Finding[] {
  const findings: Finding[] = []
  const trimmed = body.trim()
  if (!trimmed) return findings

  const sentencePattern = /(^|[.!?]\s+)([a-z])/g
  let match: RegExpExecArray | null
  while ((match = sentencePattern.exec(trimmed)) !== null) {
    const letter = match[2]
    findings.push({
      id: `capital-${match.index}`,
      category: 'Capitalization',
      message: `A sentence begins with “${letter}”.`,
      suggestion: `Start it with “${letter.toUpperCase()}”.`,
    })
  }

  if (!/[.!?][\s”"']*$/.test(trimmed)) {
    findings.push({
      id: 'terminal-punctuation',
      category: 'Punctuation',
      message: 'The final sentence needs an ending mark.',
      suggestion: 'Add a period, question mark, or exclamation mark.',
    })
  }

  return findings
}

export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
