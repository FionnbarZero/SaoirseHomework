import { WRITING_CHECK_TIMEOUT_MS, MEANING_CHECK_TIMEOUT_MS } from './proofreading-limits.ts'
import type {
  ActivityConfiguration,
  ActiveTimer,
  AppState,
  DayName,
  GameSession,
  GoogleDelivery,
  GoogleLiveDelivery,
  GoogleLiveState,
  GoogleProofState,
  ProofreadingMatch,
  SentenceMeaningReview,
  WritingDictionary,
  WritingReviewSuggestion,
} from './domain'

export type ServiceMeta = {
  database: string
  schemaVersion: number
  initialized: boolean
  lastWriteAt: string | null
}

type StateResponse = {
  state: AppState
  meta: ServiceMeta
}

export type GuardianCompletionProof = {
  serviceSessionId: string
  weekId: string
  day: string
  eligibleAt: string
  requiredCompleted: number
  requiredTarget: number
  optionalCompleted: number
  optionalTarget: number
}

export type GuardianLifecycle = {
  mode: 'inactive' | 'homework' | 'free'
  session: null | {
    serviceSessionId: string
    weekId: string
    day: string
    status: 'requested' | 'completion-eligible'
    startedAt: string
    completionProof: GuardianCompletionProof | null
  }
  serviceTime: string
}

type LearningSessionResponse = StateResponse & {
  lifecycle: GuardianLifecycle
}

export type ParentAuthorizationStatus = {
  configured: boolean
  guardianConnected: boolean
  authenticated: boolean
  purpose?: 'dashboard' | 'sensitive'
  issuedAt?: string
  expiresAt?: string
  sensitiveUntil?: string
}

export type ParentAuthorizationChallenge = {
  id: string
  purpose: 'dashboard' | 'sensitive'
  purposeLabel: string
  status: 'pending' | 'approved' | 'denied' | 'cancelled'
  requestedAt: string
  expiresAt: string
}

export type SecurityStatus = {
  mode: 'preview' | 'enforcing'
  learningMode: 'inactive' | 'homework' | 'free'
  locked: boolean
  reasons: ('guardian_unavailable' | 'managed_chrome_unavailable' | 'service_unavailable' | 'parent_authorization_not_configured')[]
  guardianConnected: boolean
  chromeConnected: boolean
  parentAuthorizationConfigured: boolean
  serviceTime: string
  entered: boolean
}

type SessionResponse = StateResponse & {
  session: ActiveTimer | null
}

type GameSessionResponse = StateResponse & {
  gameSession: GameSession
}

type GameSessionLaunchResponse = StateResponse & {
  gameSession: GameSession
}

type WritingGameCompletionResponse = GameSessionResponse & {
  evidence: {
    draftId: string
    revisionGroupId: string
    versionCount: number
    findingCount: number
    correct: number
    total: number
    percent: number
    wordCount: number
    edited: boolean
  }
}

export type ProofreadingResponse = {
  incomplete: boolean
  authoritative: boolean
  checkId?: string
  available: boolean
  engine: string
  matches: ProofreadingMatch[]
  reviewItems: WritingReviewSuggestion[]
  sentenceReviews: SentenceMeaningReview[]
  ai: AiProofreadingResult
  intentAi: AiMeaningReviewResult
  error?: string
}

export type AiProofreadingMode = 'off' | 'shadow' | 'review' | 'assist'

export type AiProofreadingStatus = {
  configured: boolean
  mode: AiProofreadingMode
  model: string | null
  provider: string
  sendsOnlyCurrentPassage: boolean
  storesResponses: boolean
}

export type AiProofreadingResult = AiProofreadingStatus & {
  incomplete?: boolean
  available: boolean
  analyzed: boolean
  matches: ProofreadingMatch[]
  reviewItems: WritingReviewSuggestion[]
  counts: {
    total: number
    practice: number
    review: number
    ignored: number
  }
  error?: string
}

export type AiMeaningReviewResult = AiProofreadingStatus & {
  available: boolean
  analyzed: boolean
  reviews: SentenceMeaningReview[]
  error?: string
}

type GoogleProofResponse = StateResponse & {
  googleProof: GoogleProofState
}

type GoogleDeliveryResponse = StateResponse & {
  delivery: GoogleDelivery
  duplicate: boolean
}

type GoogleLiveResponse = StateResponse & {
  googleLive: GoogleLiveState
}

type GoogleLiveDeliveryResponse = StateResponse & {
  delivery: GoogleLiveDelivery
  duplicate?: boolean
}

export type WritingLogState = {
  configured: boolean
  connected: boolean
  documentId: string | null
  documentUrl: string | null
  tabId: string | null
  status: 'not-configured' | 'safe-test' | 'authorization-required' | 'ready' | 'syncing' | 'synced' | 'failed'
  draftCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

type WritingLogResponse = {
  writingLog: WritingLogState
}

export type CalendarEvent = {
  id: string
  title: string
  day: string
  start: string
  end: string | null
  allDay: boolean
}

export type CalendarStatus = {
  configured: boolean
  connected: boolean
  expectedAccountEmail?: string | null
  accountEmail?: string | null
  calendarId?: string
  scopes?: string[]
  lastSyncedAt: string | null
  lastError: string | null
}

export type CalendarWeekResponse = {
  events: CalendarEvent[]
  status: CalendarStatus
  stale?: boolean
}

export class ServiceRequestError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'service_error') {
    super(message)
    this.name = 'ServiceRequestError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(3500),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ServiceRequestError(
      body.error || `Service request failed (${response.status})`,
      response.status,
      body.code,
    )
  }
  return response.json() as Promise<T>
}

export async function hydrateFromService(browserState: AppState): Promise<StateResponse> {
  const response = await request<StateResponse>('/api/state')
  if (response.meta.initialized) return response
  return saveStateToService(browserState)
}

export function loadStateFromService() {
  return request<StateResponse>('/api/state')
}

export function getSecurityStatus() {
  return request<SecurityStatus>('/api/security/status')
}

export function getParentAuthorizationStatus() {
  return request<ParentAuthorizationStatus>('/api/parent/auth/status')
}

export function startParentAuthorization(purpose: 'dashboard' | 'sensitive') {
  return request<{ challenge: ParentAuthorizationChallenge }>('/api/parent/auth/challenges', {
    method: 'POST',
    body: JSON.stringify({ purpose }),
  })
}

export function pollParentAuthorization(challengeId: string) {
  return request<{
    status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
    challenge?: ParentAuthorizationChallenge
    session?: ParentAuthorizationStatus
  }>(`/api/parent/auth/challenges/${encodeURIComponent(challengeId)}`)
}

export function lockParentSession() {
  return request<{ authenticated: false }>('/api/parent/auth/logout', { method: 'POST' })
}

export function saveStateToService(state: AppState) {
  return request<StateResponse>('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
}

export function getWritingLogStatus() {
  return request<WritingLogResponse>('/api/writing-log/status')
}

export function syncWritingLog() {
  return request<WritingLogResponse>('/api/writing-log/sync', { method: 'POST' })
}

export function getCalendarStatus() {
  return request<{ calendar: CalendarStatus }>('/api/calendar/status')
}

export function getCalendarAdminStatus() {
  return request<{ calendar: CalendarStatus }>('/api/calendar/admin/status')
}

export function getCalendarWeek(weekId: string) {
  return request<CalendarWeekResponse>(`/api/calendar/week?weekId=${encodeURIComponent(weekId)}`, {
    signal: AbortSignal.timeout(10_000),
  })
}

export function beginCalendarAuthorization() {
  return request<{ authorizationUrl: string; expiresAt: string }>('/api/calendar/authorize', {
    method: 'POST',
  })
}

export function disconnectCalendar() {
  return request<{ calendar: CalendarStatus }>('/api/calendar/disconnect', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  })
}

export function startLearningSession() {
  return request<LearningSessionResponse>('/api/learning-session/start', { method: 'POST' })
}

export function saveActivityConfiguration(configuration: ActivityConfiguration) {
  return request<StateResponse>('/api/activity-configuration', {
    method: 'PUT',
    body: JSON.stringify({ configuration }),
  })
}

export function addParentRewardCredit(seconds = 300) {
  return request<StateResponse>('/api/parent/reward-credits', {
    method: 'POST',
    body: JSON.stringify({ seconds, source: 'Parent-added credit' }),
  })
}

export function saveWritingDictionary(dictionary: WritingDictionary) {
  return request<StateResponse>('/api/parent/writing-dictionary', {
    method: 'PUT',
    body: JSON.stringify({ dictionary }),
  })
}

export function saveWritingReviewStatus(
  id: string,
  status: 'pending' | 'resolved',
  decision?: 'confirmed' | 'dismissed',
  replacement?: string,
) {
  return request<StateResponse>(`/api/parent/writing-reviews/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status, decision, replacement }),
  })
}

export function getAiProofreadingStatus() {
  return request<AiProofreadingStatus>('/api/parent/ai-proofreading')
}

export function saveAiProofreadingMode(mode: AiProofreadingMode) {
  return request<AiProofreadingStatus>('/api/parent/ai-proofreading', {
    method: 'PUT',
    body: JSON.stringify({ mode }),
  })
}

export function resetParentPreviewData() {
  return request<StateResponse>('/api/parent/reset-preview', { method: 'POST' })
}

export function recordAudit(eventType: string, details: Record<string, unknown>) {
  return request<{ event: unknown }>('/api/audit', {
    method: 'POST',
    body: JSON.stringify({ eventType, details }),
  })
}

export function startControlledSession(timer: ActiveTimer) {
  return request<SessionResponse>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      kind: timer.kind,
      activityId: timer.activityId,
      sessionKey: timer.sessionKey,
    }),
  })
}

export function heartbeatControlledSession(sessionId: string, active: boolean) {
  return request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ active }),
    keepalive: true,
  })
}

export function endControlledSession(sessionId: string) {
  return request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
  })
}

export function acknowledgeControlledSession(sessionId: string) {
  return request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/acknowledge`, {
    method: 'POST',
  })
}

export function setDailyCompletion(
  day: DayName,
  activityId: string,
  completed: boolean,
  method: 'self-reported' | 'parent-override',
  weekId: string,
) {
  return request<StateResponse>('/api/completions', {
    method: 'POST',
    body: JSON.stringify({ day, activityId, completed, method, weekId }),
  })
}

export function startReadingGame(day: DayName) {
  return request<GameSessionLaunchResponse>('/api/game-sessions', {
    method: 'POST',
    body: JSON.stringify({ activityId: 'reading-strategies', day }),
  })
}

export function getReadingGameSession(sessionId: string) {
  return request<GameSessionResponse>(`/api/game-sessions/${encodeURIComponent(sessionId)}`)
}

export function completeWritingGame(sessionId: string, draftId: string) {
  return request<WritingGameCompletionResponse>(`/api/game-sessions/${encodeURIComponent(sessionId)}/complete-writing`, {
    method: 'POST',
    body: JSON.stringify({ draftId }),
  })
}

export function proofreadWriting(text: string) {
  return request<ProofreadingResponse>('/api/proofread', {
    method: 'POST',
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(WRITING_CHECK_TIMEOUT_MS),
  })
}

export function retrySentenceMeaning(
  text: string,
  review: Pick<SentenceMeaningReview, 'start' | 'end' | 'attempt' | 'rejectedOptions'>,
) {
  return request<{ review: SentenceMeaningReview | null; intentAi: AiMeaningReviewResult }>('/api/interpret-sentence', {
    method: 'POST',
    body: JSON.stringify({
      text,
      start: review.start,
      end: review.end,
      attempt: review.attempt + 1,
      rejectedOptions: review.rejectedOptions,
    }),
    signal: AbortSignal.timeout(MEANING_CHECK_TIMEOUT_MS),
  })
}

export function connectMockGoogle(accountEmail: string) {
  return request<GoogleProofResponse>('/api/google/mock/connect', {
    method: 'POST',
    body: JSON.stringify({ accountEmail }),
  })
}

export function disconnectMockGoogle() {
  return request<GoogleProofResponse>('/api/google/mock/disconnect', { method: 'POST' })
}

export function runMockGoogleDelivery(recipient: string) {
  return request<GoogleDeliveryResponse>('/api/google/mock/deliveries', {
    method: 'POST',
    body: JSON.stringify({ recipient }),
    signal: AbortSignal.timeout(15_000),
  })
}

export function saveLiveGoogleConfiguration(recipient: string) {
  return request<GoogleLiveResponse>('/api/google/live/configuration', {
    method: 'POST',
    body: JSON.stringify({ recipient }),
  })
}

export function beginLiveGoogleAuthorization() {
  return request<{ authorizationUrl: string; expiresAt: string }>('/api/google/live/authorize', {
    method: 'POST',
  })
}

export function disconnectLiveGoogle() {
  return request<GoogleLiveResponse>('/api/google/live/disconnect', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  })
}

export function runLiveGoogleDelivery(recipient: string) {
  return request<GoogleLiveDeliveryResponse>('/api/google/live/deliveries', {
    method: 'POST',
    body: JSON.stringify({ recipient }),
    signal: AbortSignal.timeout(90_000),
  })
}

export function retryLiveGoogleDelivery(deliveryId: string) {
  return request<GoogleLiveDeliveryResponse>(`/api/google/live/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
  })
}
