import { getToken, clearToken, clearUser } from './auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })

  if (res.status === 401) {
    clearToken()
    clearUser()
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new Error('Session expired')
  }

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
  roster: () => apiFetch<import('./types').RosterMember[]>('/api/seniors/roster'),
  cameras: () => apiFetch<import('./types').Camera[]>('/api/cameras'),
  latestSnapshots: () =>
    apiFetch<import('./types').CCTVSnapshot[]>('/api/cameras/snapshots/latest'),
  cctvStatus: () =>
    apiFetch<import('./types').FRStatus>('/api/cameras/status'),
  addKnownFace: async (name: string, image: File) => {
    const token = getToken()
    const form = new FormData()
    form.append('name', name)
    form.append('image', image)
    const res = await fetch(`${API_BASE}/api/cameras/known-faces`, {
      method: 'POST',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (res.status === 401) {
      clearToken()
      clearUser()
      if (typeof window !== 'undefined') window.location.href = '/login'
      throw new Error('Session expired')
    }
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    return res.json()
  },
  removeKnownFace: (name: string) =>
    apiFetch(`/api/cameras/known-faces/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  camerasAdmin: () =>
    apiFetch<import('./types').Camera[]>('/api/cameras/admin'),
  createCamera: (data: { name: string; rtsp_url?: string; location?: string; room_id?: number | null; enabled?: boolean }) =>
    apiFetch<import('./types').Camera>('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCamera: (id: number, data: Partial<{ name: string; rtsp_url: string; location: string; room_id: number | null; enabled: boolean }>) =>
    apiFetch<import('./types').Camera>(`/api/cameras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteCamera: (id: number) =>
    apiFetch<{ status: string; id: number }>(`/api/cameras/${id}`, {
      method: 'DELETE',
    }),
  createRoom: (data: { name: string; max_capacity?: number }) =>
    apiFetch<import('./types').Room>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoom: (id: number, data: Partial<{ name: string; max_capacity: number }>) =>
    apiFetch<import('./types').Room>(`/api/rooms/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteRoom: (id: number) =>
    apiFetch<{ status: string; id: number }>(`/api/rooms/${id}`, {
      method: 'DELETE',
    }),
  recentDetections: () =>
    apiFetch<{ id: number; person: string; personType: 'known' | 'unknown'; cameraName: string; confidence: number; timestamp: string; crop: string | null }[]>(
      '/api/cameras/recent-detections'
    ),
  knownFaces: () =>
    apiFetch<{ name: string; image_count: number }[]>('/api/cameras/known-faces'),
  clearCctvData: () =>
    apiFetch<{ status: string; cleared: { snapshots: number } }>(
      '/api/cameras/clear-data', { method: 'POST' }),
  syncKnownFacesFromOdoo: () =>
    apiFetch<{ status: string; synced: number; skipped: number; errors: string[] }>(
      '/api/cameras/known-faces/sync-odoo', { method: 'POST' }),
}
