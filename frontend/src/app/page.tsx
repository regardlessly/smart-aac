'use client'

import { useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import StatCard from '@/components/dashboard/StatCard'
import SeniorRoster from '@/components/dashboard/SeniorRoster'
import RoomHeatmap from '@/components/dashboard/RoomHeatmap'
import AlertConsole from '@/components/dashboard/AlertConsole'
import ActivitiesPanel from '@/components/dashboard/ActivitiesPanel'
import CCTVGrid from '@/components/dashboard/CCTVGrid'
import { useDashboard } from '@/hooks/useDashboard'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'

export default function DashboardPage() {
  // SSE must be established first so useDashboard knows connection status
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const { connected } = useSSE(useCallback(() => {
    if (!refreshTimerRef.current) {
      refreshRef.current()
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
      }, 10000)
    }
  }, []))
  const data = useDashboard(connected)
  refreshRef.current = data.refresh

  const handleAcknowledge = useCallback(async (id: number) => {
    await api.acknowledgeAlert(id)
    data.refresh()
  }, [data])

  if (data.loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60">
          <TopBar connected={false} />
          <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
            <div className="text-muted text-lg">Loading dashboard...</div>
          </div>
        </div>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60">
          <TopBar connected={false} />
          <div className="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)] gap-4">
            <div className="text-coral text-lg">Failed to load dashboard</div>
            <div className="text-muted text-sm">{data.error}</div>
            <button
              onClick={data.refresh}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-dark"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const stats = data.stats!

  return (
    <div className="flex h-screen">
      <Sidebar alertCount={data.alertCounts?.total} />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} alertCount={data.alertCounts?.total} />

        <main className="p-6 space-y-6">
          {/* Stat Cards Row */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Seniors Present"
              value={stats.seniors_present}
              subtitle={`of ${stats.seniors_max} registered`}
              icon="👥"
              color="text-primary"
              bgColor="bg-primary/10"
            />
            <StatCard
              label="Unidentified"
              value={stats.unidentified_count}
              subtitle="persons detected"
              icon="❓"
              color={stats.unidentified_count > 0 ? 'text-coral' : 'text-green'}
              bgColor={stats.unidentified_count > 0 ? 'bg-coral/10' : 'bg-green/10'}
            />
            <StatCard
              label="Active Rooms"
              value={`${stats.active_rooms.count}/${stats.active_rooms.total}`}
              subtitle="rooms occupied"
              icon="🏠"
              color="text-sky"
              bgColor="bg-sky/10"
            />
            <StatCard
              label="Today's Activities"
              value={stats.todays_activities}
              subtitle="scheduled"
              icon="📅"
              color="text-orange"
              bgColor="bg-orange/10"
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-12 gap-6">
            {/* Left Column - Senior Roster + CCTV */}
            <div className="col-span-8 space-y-6">
              <SeniorRoster roster={data.roster} />
              <CCTVGrid cameras={data.cameras} snapshots={data.snapshots} />
            </div>

            {/* Right Column - Heatmap + Alerts + Activities */}
            <div className="col-span-4 space-y-6">
              <RoomHeatmap rooms={data.heatmap} />
              <AlertConsole
                alerts={data.alerts}
                onAcknowledge={handleAcknowledge}
              />
              <ActivitiesPanel activities={data.activities} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
