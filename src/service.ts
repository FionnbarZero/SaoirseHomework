import type { AppState } from './domain'

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
