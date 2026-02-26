const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  dashboard: () => apiFetch<import('./types').DashboardStats>('/api/dashboard'),
  seniors: () => apiFetch<import('./types').Senior[]>('/api/seniors'),
  presences: () => apiFetch<import('./types').SeniorPresence[]>('/api/seniors/presence'),
  rooms: () => apiFetch<import('./types').Room[]>('/api/rooms'),
  heatmap: () => apiFetch<import('./types').RoomHeatmap[]>('/api/rooms/heatmap'),
  activities: () => apiFetch<import('./types').Activity[]>('/api/activities'),
  alerts: () => apiFetch<import('./types').Alert[]>('/api/alerts'),
  alertCounts: () => apiFetch<import('./types').AlertCounts>('/api/alerts/count'),
  acknowledgeAlert: (id: number) =>
    apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PUT' }),
  lockers: () => apiFetch<import('./types').Locker[]>('/api/lockers'),
  kioskEvents: () => apiFetch<import('./types').KioskEvent[]>('/api/kiosk-events'),
  cameras: () => apiFetch<import('./types').Camera[]>('/api/cameras'),
  latestSnapshots: () =>
    apiFetch<import('./types').CCTVSnapshot[]>('/api/cameras/snapshots/latest'),
}
