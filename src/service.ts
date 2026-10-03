import type { ActiveTimer, AppState, DayName, GameSession } from './domain'

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

type SessionResponse = StateResponse & {
  session: ActiveTimer | null
}

type GameSessionResponse = StateResponse & {
  gameSession: GameSession
}

type GameSessionLaunchResponse = StateResponse & {
  gameSession: GameSession & { launchUrl: string }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    signal: AbortSignal.timeout(3500),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Service request failed (${response.status})`)
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

export function saveStateToService(state: AppState) {
  return request<StateResponse>('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
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
) {
  return request<StateResponse>('/api/completions', {
    method: 'POST',
    body: JSON.stringify({ day, activityId, completed, method }),
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
