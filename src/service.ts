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
  WritingDictionary,
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
  gameSession: GameSession & { launchUrl: string }
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

export function saveWritingReviewStatus(id: string, status: 'pending' | 'resolved') {
  return request<StateResponse>(`/api/parent/writing-reviews/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
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
