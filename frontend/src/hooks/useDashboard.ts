'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type {
  DashboardStats, SeniorPresence, RoomHeatmap, AacActivity,
  Alert, KioskEvent, CCTVSnapshot, AlertCounts, Camera,
  RosterMember,
} from '@/lib/types'

interface DashboardData {
  stats: DashboardStats | null
  presences: SeniorPresence[]
  roster: RosterMember[]
  heatmap: RoomHeatmap[]
  activities: AacActivity[]
  alerts: Alert[]
  alertCounts: AlertCounts | null
  kioskEvents: KioskEvent[]
  cameras: Camera[]
  snapshots: CCTVSnapshot[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useDashboard(sseConnected: boolean): DashboardData {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [presences, setPresences] = useState<SeniorPresence[]>([])
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [heatmap, setHeatmap] = useState<RoomHeatmap[]>([])
  const [activities, setActivities] = useState<AacActivity[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertCounts, setAlertCounts] = useState<AlertCounts | null>(null)
  const [kioskEvents, setKioskEvents] = useState<KioskEvent[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [snapshots, setSnapshots] = useState<CCTVSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [s, p, ros, h, act, al, ac, k, cam, sn] = await Promise.all([
        api.dashboard(),
        api.presences(),
        api.roster(),
        api.heatmap(),
        api.activities(),
        api.alerts(),
        api.alertCounts(),
        api.kioskEvents(),
        api.cameras(),
        api.latestSnapshots(),
      ])
      setStats(s)
      setPresences(p)
      setRoster(ros)
      setHeatmap(h)
      const actList = Array.isArray(act) ? act : ((act as { activities?: AacActivity[] }).activities ?? [])
      setActivities(actList)
      setAlerts(al.alerts)
      setAlertCounts(ac)
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

  // Only poll when SSE is disconnected; 30s fallback interval
  useEffect(() => {
    if (sseConnected) return
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll, sseConnected])

  return {
    stats, presences, roster, heatmap, activities, alerts, alertCounts,
    kioskEvents, cameras, snapshots, loading, error, refresh: fetchAll,
  }
}
