'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { AacActivity, AacActivitySlot } from '@/lib/types'

export default function ActivitiesPage() {
  const { connected } = useSSE()
  const [activities, setActivities] = useState<AacActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchActivities = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.activities({ period: 'today' })
      const list = Array.isArray(data) ? data : (data.activities ?? [])
      setActivities(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  // Get today's slot
  const getTodaySlot = (activity: AacActivity): AacActivitySlot | null => {
    const slots = activity.slot_ids
    if (!slots || slots.length === 0) return null
    const today = new Date().toISOString().split('T')[0]
    return slots.find(s => s.date === today) ?? null
  }

  // Venue from slot or venue_ids
  const getVenue = (activity: AacActivity): string => {
    const slot = getTodaySlot(activity)
    if (slot?.venue) return String(slot.venue)
    const venues = activity.venue_ids
    if (!venues) return ''
    return venues.filter(v => v.name).map(v => String(v.name)).join(', ')
  }

  // Event types
  const getTypes = (activity: AacActivity): string => {
    const types = activity.event_type
    if (!types) return ''
    return types.map(t => t.name).join(', ')
  }

  // Status badge
  const statusBadge = (status: string) => {
    const s = status.toLowerCase()
    if (s === 'active' || s === 'ongoing') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
    if (s === 'done' || s === 'completed') return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
    if (s === 'cancelled' || s === 'cancel') return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-text">Activities</h1>
              <p className="text-muted text-sm mt-1">Today&apos;s scheduled activities &middot; {activities.length} total</p>
            </div>
            <button
              onClick={fetchActivities}
              disabled={loading}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Syncing…' : 'Sync from Odoo'}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
              {error}
            </div>
          )}

          {loading && activities.length === 0 ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-panel rounded-[14px] border border-border p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : activities.length === 0 && !loading ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-muted text-lg">No activities scheduled for today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((activity, index) => {
                const name = String(activity.name ?? `Activity ${index + 1}`)
                const status = String(activity.status ?? '')
                const fromTime = String(activity.from_time ?? '')
                const toTime = String(activity.to_time ?? '')
                const venue = getVenue(activity)
                const types = getTypes(activity)
                const desc = activity.desc ? String(activity.desc) : ''
                const fee = typeof activity.fee === 'number' ? activity.fee : null
                const slot = getTodaySlot(activity)

                return (
                  <div
                    key={activity.id ?? index}
                    className="bg-panel rounded-[14px] border border-border p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-3 mb-1.5">
                        <h3 className="font-semibold text-text truncate">{name}</h3>
                        {status && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusBadge(status)}`}>
                            {status}
                          </span>
                        )}
                        {activity.regular_event && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 shrink-0">
                            Regular
                          </span>
                        )}
                      </div>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                        {(fromTime || toTime) && (
                          <span className="flex items-center gap-1">
                            🕐 {fromTime}{toTime ? ` – ${toTime}` : ''}
                          </span>
                        )}
                        {venue && (
                          <span className="flex items-center gap-1">📍 {venue}</span>
                        )}
                        {types && (
                          <span className="flex items-center gap-1">🏷️ {types}</span>
                        )}
                        {fee != null && fee > 0 && (
                          <span className="flex items-center gap-1">💰 ${fee.toFixed(2)}</span>
                        )}
                      </div>

                      {/* Slot info */}
                      {slot && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted mt-1">
                          {slot.time && (
                            <span className="flex items-center gap-1">📋 {slot.time}</span>
                          )}
                          <span className="flex items-center gap-1">
                            👥 {slot.total_register ?? 0} registered · {slot.seats_available ?? 0} seats left
                          </span>
                        </div>
                      )}

                      {/* Description */}
                      {desc && (
                        <p className="text-sm text-muted mt-2 line-clamp-2">{desc}</p>
                      )}
                    </div>
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
