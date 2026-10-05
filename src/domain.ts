export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export type DayName = (typeof DAYS)[number]
export type LocalDayName = DayName | 'Saturday' | 'Sunday'
export const DEFAULT_NINJA_DOJO_URL = 'https://weeklydictation-g5-beta.web.app/'
export const DEFAULT_DU_CHINESE_READING_URL = 'https://duchinese.net/lessons'
export const DEFAULT_DU_CHINESE_FLASHCARD_URL = 'https://duchinese.net/flashcards'

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
  ruleId: string
  category: 'Grammar' | 'Capitalization' | 'Punctuation' | 'Spelling'
  message: string
  suggestion: string
  start: number
  end: number
  replacement: string
  additionalEdits?: WritingEdit[]
  correction: WritingTrial
  practice: WritingTrial[]
}

export type WritingEdit = {
  start: number
  end: number
  replacement: string
}

export type WritingTrial = {
  id: string
  prompt: string
  choices: string[]
  correctAnswer: string
  explanation: string
}

export type FindingProgress = {
  correctionComplete: boolean
  practiceCompleted: number
  incorrectAttempts: number
  attemptResults?: boolean[]
}

export type SpellingWord = {
  id: string
  word: string
  correctWord: string
  occurrences: number
}

export type SpellingProgress = {
  copyCompleted: number
  hiddenCompleted: number
  mixedCompleted: number
  incorrectAttempts: number
}

export type WritingDictionary = {
  knownNames: string[]
  knownPlaces: string[]
}

export type ProofreadingMatch = {
  offset: number
  length: number
  message: string
  shortMessage: string
  replacements: string[]
  ruleId: string
  category: string
  issueType: string
}

export type WritingReviewItem = {
  id: string
  draftId: string
  category: 'Grammar' | 'Punctuation' | 'Capitalization' | 'Spelling'
  message: string
  excerpt: string
  explanation?: string
  suggestion?: string
  source?: 'local' | 'ai'
  confidence?: 'high' | 'medium' | 'low'
  status: 'pending' | 'resolved'
  decision?: 'confirmed' | 'dismissed'
  createdAt: string
  resolvedAt?: string
}

export type WritingReviewSuggestion = Omit<WritingReviewItem, 'draftId' | 'status' | 'decision' | 'createdAt' | 'resolvedAt'>

export type Draft = {
  id: string
  weekId?: string
  activityKey?: string
  revisionGroupId?: string
  versionNumber?: number
  title: string
  body: string
  correctedBody?: string
  updatedAt: string
  findings: Finding[]
  proofreadingMatches?: ProofreadingMatch[]
  reviewSuggestions?: WritingReviewSuggestion[]
  exerciseProgress?: Record<string, FindingProgress>
  spellingWords?: SpellingWord[]
  spellingProgress?: Record<string, SpellingProgress>
  reviewStatus?: 'draft' | 'practice' | 'spelling-pending' | 'complete'
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
  rewardSelectionDeadlineAt?: string
  rewardPlaybackStarted?: boolean
  rewardPlaybackActive?: boolean
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

export type GoogleLiveDelivery = {
  id: string
  weekId: string
  mode: 'live'
  status: 'queued' | 'creating' | 'sent' | 'skipped' | 'failed'
  accountEmail: string
  recipient: string
  documentId: string | null
  documentName: string
  documentUrl: string | null
  pdfUrl: string | null
  shareStatus: 'pending' | 'shared' | 'failed'
  emailMessageId: string | null
  draftCount: number
  attemptCount: number
  nextAttemptAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

export type GoogleLiveState = {
  mode: 'safe-test' | 'live'
  enabled: boolean
  clientConfigured: boolean
  keychainAvailable: boolean
  connected: boolean
  accountEmail: string | null
  connectedAt: string | null
  recipient: string | null
  lastError: string | null
  deliveries: GoogleLiveDelivery[]
}

export type AppState = {
  entered: boolean
  requiredByDay: Record<DayName, string[]>
  optionalCompleted: string[]
  freeModeByDay: Partial<Record<DayName, string>>
  rewardCredits: RewardCredit[]
  drafts: Draft[]
  writingDictionary: WritingDictionary
  writingReviewQueue: WritingReviewItem[]
  activeTimer: ActiveTimer | null
  activeGameSession: GameSession | null
  completionRecords: CompletionRecord[]
  guardianConnected: boolean
  chromeConnected: boolean
  activityConfiguration: ActivityConfiguration
  googleProof: GoogleProofState
  googleLive: GoogleLiveState
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
    id: 'level-chinese',
    title: 'Level Chinese',
    description: 'Log in with Clever, then complete 20 active minutes in Level Learning.',
    method: 'timer',
    minutes: 20,
    icon: '中',
  },
  {
    id: 'du-chinese',
    title: 'Du Chinese',
    description: 'Read for 13 active minutes, then review flashcards for 7.',
    method: 'timer',
    minutes: 20,
    icon: '读',
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
    title: 'Reading Response Writing Game',
    description: 'Write about a passage you chose, practice each detected error, and edit your response.',
    method: 'verified',
    icon: '✎',
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
]

export const OPTIONAL_TARGETS: Record<DayName, number> = {
  Monday: 2,
  Tuesday: 4,
  Wednesday: 6,
  Thursday: 8,
  Friday: 9,
}

export const OPTIONAL_SESSION_TOTAL = OPTIONAL_ACTIVITIES.reduce(
  (total, activity) => total + activity.sessions,
  0,
)

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
  writingDictionary: { knownNames: ['Fionnbar'], knownPlaces: [] },
  writingReviewQueue: [],
  activeTimer: null,
  activeGameSession: null,
  completionRecords: [],
  guardianConnected: false,
  chromeConnected: false,
  activityConfiguration: {
    ninjaDojo: {
      launchUrl: DEFAULT_NINJA_DOJO_URL,
      redirectOrigins: [],
      allowedOrigins: ['https://weeklydictation-g5-beta.web.app'],
      ready: true,
    },
    duChinese: {
      readingUrl: DEFAULT_DU_CHINESE_READING_URL,
      flashcardUrl: DEFAULT_DU_CHINESE_FLASHCARD_URL,
      redirectOrigins: [],
      allowedOrigins: ['https://duchinese.net'],
      ready: true,
    },
    levelChinese: { cleverUrl: '', learningUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
  },
  googleProof: {
    mode: 'mock',
    connected: false,
    accountEmail: null,
    connectedAt: null,
    deliveries: [],
  },
  googleLive: {
    mode: 'safe-test',
    enabled: false,
    clientConfigured: false,
    keychainAvailable: false,
    connected: false,
    accountEmail: null,
    connectedAt: null,
    recipient: null,
    lastError: null,
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

export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
