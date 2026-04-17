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
  alerts: (params?: { type?: string; acknowledged?: string; search?: string; page?: number; per_page?: number }) => {
    const qs = new URLSearchParams()
    if (params?.type) qs.set('type', params.type)
    if (params?.acknowledged) qs.set('acknowledged', params.acknowledged)
    if (params?.search) qs.set('search', params.search)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.per_page) qs.set('per_page', String(params.per_page))
    const q = qs.toString()
    return apiFetch<import('./types').AlertsPage>(`/api/alerts${q ? '?' + q : ''}`)
  },
  alertCounts: () => apiFetch<import('./types').AlertCounts>('/api/alerts/count'),
  acknowledgeAlert: (id: number) =>
    apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PUT' }),
  bulkAcknowledgeAlerts: (ids: number[]) =>
    apiFetch<{ acknowledged: number }>('/api/alerts/bulk-acknowledge', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
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
  createRoom: (data: { name: string; max_capacity?: number; moderate_threshold?: number | null }) =>
    apiFetch<import('./types').Room>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoom: (id: number, data: Partial<{ name: string; max_capacity: number; moderate_threshold: number | null }>) =>
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

  // ── System Settings ──
  getSettings: () =>
    apiFetch<Record<string, number>>('/api/settings'),
  updateSettings: (data: Record<string, number>) =>
    apiFetch<{ updated: Record<string, number>; restart_required: boolean }>(
      '/api/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // ── Reports ──
  dailyAttendance: (params?: { date?: string }) => {
    const qs = new URLSearchParams()
    if (params?.date) qs.set('date', params.date)
    const q = qs.toString()
    return apiFetch<import('./types').DailyAttendanceData>(
      `/api/reports/daily-attendance${q ? '?' + q : ''}`)
  },
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

  // ── Alert Config ──
  getAlertConfig: () =>
    apiFetch<{ alert_unidentified: boolean }>('/api/config/alerts'),
  updateAlertConfig: (data: { alert_unidentified?: boolean }) =>
    apiFetch<{ status: string; updated: Record<string, boolean> }>('/api/config/alerts', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Enrollment ──
  startEnrollment: (cameraId: number, personName: string, duration?: number) =>
    apiFetch<{ status: string }>('/api/cameras/enrollment/start', {
      method: 'POST',
      body: JSON.stringify({ camera_id: cameraId, person_name: personName, duration: duration || 15 }),
    }),
  cancelEnrollment: () =>
    apiFetch<{ status: string }>('/api/cameras/enrollment/cancel', {
      method: 'POST',
    }),
  enrollmentStatus: () =>
    apiFetch<{ active: boolean; camera_name?: string; person_name?: string; captured?: number }>(
      '/api/cameras/enrollment/status'),

  // ── Sync Config ──
  getSyncConfig: () =>
    apiFetch<{ sync_mode: string; sync_selected_ids: string }>('/api/config/sync'),
  updateSyncConfig: (data: { sync_mode?: string; sync_selected_ids?: string }) =>
    apiFetch<{ status: string; updated: Record<string, string> }>('/api/config/sync', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Odoo Config ──
  getOdooConfig: () => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
    return fetch(`${API_BASE}/api/config/odoo`).then(r => r.json()) as Promise<import('./types').OdooConfig>
  },
  updateOdooConfig: (data: Partial<import('./types').OdooConfig>) =>
    apiFetch<{ status: string; updated: Record<string, string> }>('/api/config/odoo', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}
