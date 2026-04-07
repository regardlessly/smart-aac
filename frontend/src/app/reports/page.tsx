'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import StatCard from '@/components/dashboard/StatCard'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { Room, RoomOccupancyData } from '@/lib/types'

const OccupancyChart = dynamic(
  () => import('@/components/reports/OccupancyChart'),
  {
    loading: () => (
      <div className="h-80 flex items-center justify-center">
        <p className="text-sm text-muted">Loading chart...</p>
      </div>
    ),
    ssr: false,
  },
)

type RangeKey = 'week' | 'month'

export default function ReportsPage() {
  const { connected } = useSSE()
  const [rooms, setRooms] = useState<Room[]>([])
  const [data, setData] = useState<RoomOccupancyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeKey>('week')
  const [roomFilter, setRoomFilter] = useState<number | null>(null)

  const fetchRooms = useCallback(async () => {
    try {
      const r = await api.rooms()
      setRooms(r)
    } catch {
      // ignore
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params: { range: string; room_id?: number } = { range }
      if (roomFilter) params.room_id = roomFilter
      const d = await api.roomOccupancy(params)
      setData(d)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [range, roomFilter])

  useEffect(() => {
    fetchRooms()
  }, [fetchRooms])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Format date labels
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  // Prepare chart data
  const chartData = data?.series.map((pt) => ({
    ...pt,
    label: formatDate(pt.date as string),
  })) || []

  const chartRooms = data?.rooms || []

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-6">
          {/* Report Tabs */}
          <div className="flex items-center gap-1 border-b border-border">
            <span className="px-4 py-2.5 text-sm font-semibold text-primary border-b-2 border-primary">
              Room Occupancy
            </span>
            <a
              href="/reports/daily-attendance"
              className="px-4 py-2.5 text-sm font-medium text-muted hover:text-text border-b-2 border-transparent"
            >
              Daily Attendance
            </a>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-text">Room Occupancy</h1>
            <p className="text-sm text-muted mt-1">
              Room occupancy trends
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={roomFilter ?? ''}
              onChange={(e) =>
                setRoomFilter(e.target.value ? Number(e.target.value) : null)
              }
              className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text"
            >
              <option value="">All Rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <div className="flex bg-surface rounded-lg p-0.5">
              {(['week', 'month'] as RangeKey[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    range === r
                      ? 'bg-panel text-text shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {r === 'week' ? 'This Week' : 'This Month'}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <Panel
            title="Daily Room Occupancy"
            subtitle="Unique people detected per room per day"
          >
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <p className="text-sm text-muted">Loading chart data...</p>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <p className="text-sm text-muted">
                  No occupancy data for this period.
                </p>
              </div>
            ) : (
              <OccupancyChart chartData={chartData} chartRooms={chartRooms} />
            )}
          </Panel>

          {/* Summary stat cards */}
          {data?.summary && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Peak Day"
                value={
                  data.summary.peak_day
                    ? `${data.summary.peak_count} people`
                    : '—'
                }
                subtitle={
                  data.summary.peak_day
                    ? formatDate(data.summary.peak_day)
                    : undefined
                }
                icon="📈"
                color="text-primary"
                bgColor="bg-primary/10"
              />
              <StatCard
                label="Busiest Room"
                value={data.summary.busiest_room || '—'}
                icon="🏠"
                color="text-sky"
                bgColor="bg-sky-light"
              />
              <StatCard
                label="Avg / Day"
                value={`${data.summary.avg_per_day} people`}
                icon="📊"
                color="text-amber"
                bgColor="bg-amber-light"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
