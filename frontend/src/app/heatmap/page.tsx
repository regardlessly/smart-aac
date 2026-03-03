'use client'

import { useCallback, useEffect, useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { HEATMAP_COLORS } from '@/lib/constants'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import type { RoomHeatmap } from '@/lib/types'

// Poll every 30s — matches the backend snapshot cycle (30s),
// so polling faster would just return the same data.
const POLL_INTERVAL = 30_000

export default function HeatmapPage() {
  const [rooms, setRooms] = useState<RoomHeatmap[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchHeatmap = useCallback(async () => {
    try {
      const data = await api.heatmap()
      setRooms(data)
      setLastUpdated(new Date())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHeatmap()
  }, [fetchHeatmap])

  // Poll at interval matching backend snapshot cycle
  useEffect(() => {
    const interval = setInterval(fetchHeatmap, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchHeatmap])

  // SSE real-time updates
  const { connected } = useSSE(fetchHeatmap)

  const totalOccupancy = rooms.reduce((s, r) => s + r.occupancy, 0)
  const totalCapacity = rooms.reduce((s, r) => s + r.max_capacity, 0)
  const activeRooms = rooms.filter(r => r.occupancy > 0).length

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-text">Room Occupancy Heatmap</h1>
            <p className="text-sm text-muted mt-1">
              {activeRooms} of {rooms.length} rooms active
              {' · '}
              {totalOccupancy} people across all rooms
              {totalCapacity > 0 && ` (${Math.round((totalOccupancy / totalCapacity) * 100)}% overall capacity)`}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted mt-1">
              {lastUpdated && (
                <span>
                  Last updated: {lastUpdated.toLocaleTimeString('en-SG', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green animate-pulse-dot' : 'bg-gray-300'}`} />
                <span>{connected ? 'Live' : 'Polling'}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6">
            {(['empty', 'low', 'medium', 'high'] as const).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded ${HEATMAP_COLORS[level].bg} border border-border`} />
                <span className="text-sm text-muted">{HEATMAP_COLORS[level].label}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted text-lg">Loading heatmap...</div>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted text-lg">No rooms configured</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {rooms.map((room) => {
                const colors = HEATMAP_COLORS[room.color_level]
                const pct = room.max_capacity > 0
                  ? Math.round((room.occupancy / room.max_capacity) * 100)
                  : 0
                return (
                  <div
                    key={room.id}
                    className={`${colors.bg} rounded-xl p-5 border border-border transition-all hover:shadow-md`}
                  >
                    {/* Room name */}
                    <div className="text-sm font-semibold text-text truncate">{room.name}</div>

                    {/* Big occupancy number */}
                    <div className={`text-4xl font-bold ${colors.text} mt-2`}>
                      {room.occupancy}
                      <span className="text-base font-normal text-muted">/{room.max_capacity}</span>
                    </div>

                    {/* Known / Unknown breakdown */}
                    {room.occupancy > 0 && (
                      <div className="text-xs text-muted mt-1 flex items-center gap-2">
                        {room.identified > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green inline-block" />
                            {room.identified} known
                          </span>
                        )}
                        {room.strangers > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-coral inline-block" />
                            {room.strangers} unknown
                          </span>
                        )}
                      </div>
                    )}

                    {/* Progress bar */}
                    <div className="mt-3 h-2.5 bg-white/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          room.color_level === 'high' ? 'bg-coral' :
                          room.color_level === 'medium' ? 'bg-amber' :
                          room.color_level === 'low' ? 'bg-green' : 'bg-gray-300'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted mt-1.5">{pct}% capacity</div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
