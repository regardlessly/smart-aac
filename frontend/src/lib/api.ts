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
  cctvStatus: () =>
    apiFetch<import('./types').FRStatus>('/api/cameras/status'),
  addKnownFace: async (name: string, image: File) => {
    const form = new FormData()
    form.append('name', name)
    form.append('image', image)
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
    const res = await fetch(`${API_BASE}/api/cameras/known-faces`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    return res.json()
  },
  removeKnownFace: (name: string) =>
    apiFetch(`/api/cameras/known-faces/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  camerasAdmin: () =>
    apiFetch<import('./types').Camera[]>('/api/cameras/admin'),
  createCamera: (data: { name: string; rtsp_url?: string; location?: string; enabled?: boolean }) =>
    apiFetch<import('./types').Camera>('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCamera: (id: number, data: Partial<{ name: string; rtsp_url: string; location: string; enabled: boolean }>) =>
    apiFetch<import('./types').Camera>(`/api/cameras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteCamera: (id: number) =>
    apiFetch<{ status: string; id: number }>(`/api/cameras/${id}`, {
      method: 'DELETE',
    }),
  knownFaces: () =>
    apiFetch<{ name: string; image_count: number }[]>('/api/cameras/known-faces'),
}
