'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type {
  DashboardStats, SeniorPresence, RoomHeatmap, Activity,
  Alert, Locker, KioskEvent, CCTVSnapshot, AlertCounts, Camera,
} from '@/lib/types'

interface DashboardData {
  stats: DashboardStats | null
  presences: SeniorPresence[]
  heatmap: RoomHeatmap[]
  activities: Activity[]
  alerts: Alert[]
  alertCounts: AlertCounts | null
  lockers: Locker[]
  kioskEvents: KioskEvent[]
  cameras: Camera[]
  snapshots: CCTVSnapshot[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useDashboard(): DashboardData {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [presences, setPresences] = useState<SeniorPresence[]>([])
  const [heatmap, setHeatmap] = useState<RoomHeatmap[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertCounts, setAlertCounts] = useState<AlertCounts | null>(null)
  const [lockers, setLockers] = useState<Locker[]>([])
  const [kioskEvents, setKioskEvents] = useState<KioskEvent[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [snapshots, setSnapshots] = useState<CCTVSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [s, p, h, act, al, ac, l, k, cam, sn] = await Promise.all([
        api.dashboard(),
        api.presences(),
        api.heatmap(),
        api.activities(),
        api.alerts(),
        api.alertCounts(),
        api.lockers(),
        api.kioskEvents(),
        api.cameras(),
        api.latestSnapshots(),
      ])
      setStats(s)
      setPresences(p)
      setHeatmap(h)
      setActivities(act)
      setAlerts(al)
      setAlertCounts(ac)
      setLockers(l)
      setKioskEvents(k)
      setCameras(cam)
      setSnapshots(sn)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  return {
    stats, presences, heatmap, activities, alerts, alertCounts,
    lockers, kioskEvents, cameras, snapshots, loading, error, refresh: fetchAll,
  }
}
