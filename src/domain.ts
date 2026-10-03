export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export type DayName = (typeof DAYS)[number]
export type LocalDayName = DayName | 'Saturday' | 'Sunday'

export type WeekContext = {
  weekId: string
  fridayId: string
  timeZone: string
  localDay: LocalDayName
  headStart: boolean
  clockRollbackDetected: boolean
}

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

export type SessionStatus = 'active' | 'paused' | 'completed'

export type ActiveTimer = {
  id?: string
  kind: 'required' | 'optional' | 'reward'
  activityId: string
  sessionKey?: string
  weekId?: string
  label: string
  totalSeconds: number
  remainingSeconds: number
  running: boolean
  status?: SessionStatus
  creditedSeconds?: number
  startedAt?: string
  lastHeartbeatAt?: string | null
  serverControlled?: boolean
  phaseId?: string
  phaseLabel?: string
  phaseIndex?: number
  phaseCount?: number
  phaseTotalSeconds?: number
  phaseRemainingSeconds?: number
  launchUrl?: string
  allowedOrigins?: string[]
  managedChromeRequired?: boolean
  waitingForVerification?: boolean
  navigateOnPhaseStart?: boolean
}

export type ActivityConfiguration = {
  ninjaDojo: {
    launchUrl: string
    redirectOrigins: string[]
    allowedOrigins: string[]
    ready: boolean
  }
  duChinese: {
    readingUrl: string
    flashcardUrl: string
    redirectOrigins: string[]
    allowedOrigins: string[]
    ready: boolean
  }
  levelChinese: {
    cleverUrl: string
    learningUrl: string
    redirectOrigins: string[]
    allowedOrigins: string[]
    ready: boolean
  }
}

export type CompletionRecord = {
  id: string
  activityId: string
  sessionKey?: string
  method: 'self-reported' | 'time-in-session' | 'game-verified' | 'parent-override' | 'reward-playback' | 'imported'
  source: string
  completedAt: string
}

export type GameSession = {
  id: string
  activityId: string
  day: DayName
  weekId: string
  status: 'pending' | 'completed' | 'cancelled' | 'expired'
  createdAt: string
  expiresAt: string
  completedAt: string | null
}

export type GoogleDelivery = {
  id: string
  weekId: string
  mode: 'mock'
  status: 'creating' | 'simulated' | 'skipped' | 'failed'
  accountEmail: string
  recipient: string
  documentId: string
  documentName: string
  documentUrl: string | null
  pdfUrl: string | null
  draftCount: number
  attemptCount: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

export type GoogleProofState = {
  mode: 'mock'
  connected: boolean
  accountEmail: string | null
  connectedAt: string | null
  deliveries: GoogleDelivery[]
}

export type AppState = {
  entered: boolean
  requiredByDay: Record<DayName, string[]>
  optionalCompleted: string[]
  freeModeByDay: Partial<Record<DayName, string>>
  rewardCredits: RewardCredit[]
  drafts: Draft[]
  activeTimer: ActiveTimer | null
  activeGameSession: GameSession | null
  completionRecords: CompletionRecord[]
  guardianConnected: boolean
  chromeConnected: boolean
  activityConfiguration: ActivityConfiguration
  googleProof: GoogleProofState
  weekContext: WeekContext
}

function dateId(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftLocalDate(date: Date, days: number) {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() + days)
  return dateId(shifted)
}

export function getBrowserWeekContext(date = new Date()): WeekContext {
  const dayIndex = date.getDay()
  const headStart = dayIndex === 0 && date.getHours() >= 4
  const mondayOffset = dayIndex === 0 ? (headStart ? 1 : -6) : 1 - dayIndex
  const weekId = shiftLocalDate(date, mondayOffset)
  return {
    weekId,
    fridayId: shiftLocalDate(new Date(`${weekId}T12:00:00`), 4),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localDay: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayIndex] as LocalDayName,
    headStart,
    clockRollbackDetected: false,
  }
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
  freeModeByDay: {},
  rewardCredits: [],
  drafts: [],
  activeTimer: null,
  activeGameSession: null,
  completionRecords: [],
  guardianConnected: false,
  chromeConnected: false,
  activityConfiguration: {
    ninjaDojo: { launchUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
    duChinese: { readingUrl: '', flashcardUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
    levelChinese: { cleverUrl: '', learningUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
  },
  googleProof: {
    mode: 'mock',
    connected: false,
    accountEmail: null,
    connectedAt: null,
    deliveries: [],
  },
  weekContext: getBrowserWeekContext(),
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

export function getFridayFunSummary(state: AppState) {
  const requiredActivities = activeRequiredActivities()
  const days = DAYS.map((day) => {
    const completed = completedRequiredCount(state, day)
    return {
      day,
      completed,
      total: requiredActivities.length,
      questComplete: dayIsComplete(state, day),
    }
  })
  const writingDrafts = state.drafts.filter((draft) => draft.body.trim().length > 0)
  const writingWords = writingDrafts.reduce((total, draft) => {
    const words = draft.body.trim().match(/\S+/g)?.length ?? 0
    return total + words
  }, 0)

  return {
    unlocked: dayIsComplete(state, 'Friday'),
    unlockedAt: state.freeModeByDay.Friday ?? null,
    days,
    requiredCompleted: days.reduce((total, day) => total + day.completed, 0),
    requiredTotal: requiredActivities.length * DAYS.length,
    optionalCompleted: Math.min(state.optionalCompleted.length, OPTIONAL_TARGETS.Friday),
    optionalTotal: OPTIONAL_TARGETS.Friday,
    writingDrafts: writingDrafts.length,
    writingWords,
    rewardsEarned: Math.min(state.optionalCompleted.length, OPTIONAL_TARGETS.Friday),
    rewardsAvailable: state.rewardCredits.length,
  }
}

export function getToday(): DayName {
  const current = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
  return DAYS.includes(current as DayName) ? (current as DayName) : 'Monday'
}

export function getWeekLabel(weekId?: string) {
  const now = new Date()
  const monday = weekId
    ? new Date(`${weekId}T12:00:00.000Z`)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()))
  const friday = new Date(monday)
  if (weekId) friday.setUTCDate(monday.getUTCDate() + 4)
  else friday.setDate(monday.getDate() + 4)
  const format = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(weekId ? { timeZone: 'UTC' } : {}),
  })
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
