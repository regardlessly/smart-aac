import { getToken, clearToken, clearUser } from './auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

// In-flight GET request deduplication — prevents duplicate concurrent fetches
const inflightRequests = new Map<string, Promise<unknown>>()

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() || 'GET'

  // Deduplicate concurrent GET requests to the same path
  if (method === 'GET') {
    const existing = inflightRequests.get(path)
    if (existing) return existing as Promise<T>
  }

  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const promise = fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  }).then(async (res) => {
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
  }).finally(() => {
    inflightRequests.delete(path)
  })

  if (method === 'GET') {
    inflightRequests.set(path, promise)
  }

  return promise as Promise<T>
}

export const api = {
  dashboard: () => apiFetch<import('./types').DashboardStats>('/api/dashboard'),
  seniors: () => apiFetch<import('./types').Senior[]>('/api/seniors'),
  presences: () => apiFetch<import('./types').SeniorPresence[]>('/api/seniors/presence'),
  rooms: () => apiFetch<import('./types').Room[]>('/api/rooms'),
  heatmap: () => apiFetch<import('./types').RoomHeatmap[]>('/api/rooms/heatmap'),
  activities: (params?: { period?: string }) => {
    const qs = new URLSearchParams()
    if (params?.period) qs.set('period', params.period)
    const q = qs.toString()
    return apiFetch<import('./types').AacActivitiesResponse>(
      `/api/activities${q ? '?' + q : ''}`)
  },
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

  // ── Reports ──
  roomOccupancy: (params?: { room_id?: number; range?: string }) => {
    const qs = new URLSearchParams()
    if (params?.room_id) qs.set('room_id', String(params.room_id))
    if (params?.range) qs.set('range', params.range)
    const q = qs.toString()
    return apiFetch<import('./types').RoomOccupancyData>(
      `/api/reports/room-occupancy${q ? '?' + q : ''}`)
  },
  memberSummary: (id: number) =>
    apiFetch<import('./types').MemberSummary>(`/api/reports/member/${id}/summary`),
  memberWeekly: (id: number, params?: { month?: string }) => {
    const qs = new URLSearchParams()
    if (params?.month) qs.set('month', params.month)
    const q = qs.toString()
    return apiFetch<import('./types').MemberWeeklyData>(
      `/api/reports/member/${id}/weekly${q ? '?' + q : ''}`)
  },
  memberDuration: (id: number, params?: { date?: string }) => {
    const qs = new URLSearchParams()
    if (params?.date) qs.set('date', params.date)
    const q = qs.toString()
    return apiFetch<import('./types').MemberDurationData>(
      `/api/reports/member/${id}/duration${q ? '?' + q : ''}`)
  },
  memberCalendar: (id: number, params?: { month?: string }) => {
    const qs = new URLSearchParams()
    if (params?.month) qs.set('month', params.month)
    const q = qs.toString()
    return apiFetch<import('./types').MemberCalendarData>(
      `/api/reports/member/${id}/calendar${q ? '?' + q : ''}`)
  },
  memberFavouriteRooms: (id: number, params?: { month?: string }) => {
    const qs = new URLSearchParams()
    if (params?.month) qs.set('month', params.month)
    const q = qs.toString()
    return apiFetch<import('./types').MemberFavouriteRoomsData>(
      `/api/reports/member/${id}/favourite-rooms${q ? '?' + q : ''}`)
  },
  memberAttendanceTrend: (id: number, params?: { months?: number }) => {
    const qs = new URLSearchParams()
    if (params?.months) qs.set('months', String(params.months))
    const q = qs.toString()
    return apiFetch<import('./types').MemberAttendanceTrendData>(
      `/api/reports/member/${id}/attendance-trend${q ? '?' + q : ''}`)
  },
  memberPeers: (id: number, params?: { month?: string }) => {
    const qs = new URLSearchParams()
    if (params?.month) qs.set('month', params.month)
    const q = qs.toString()
    return apiFetch<import('./types').MemberPeersData>(
      `/api/reports/member/${id}/peers${q ? '?' + q : ''}`)
  },
}
