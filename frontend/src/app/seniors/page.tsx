'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { RosterMember, SSEEvent } from '@/lib/types'

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SeniorsPage() {
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const data = await api.roster()
      setRoster(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roster')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Poll roster every 10s as fallback when SSE is down
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Throttle SSE-driven refresh to at most once every 10s
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchRef = useRef(fetchData)
  fetchRef.current = fetchData

  const handleSSE = useCallback((event: SSEEvent) => {
    // Only refresh on detection events (presence changes)
    if (event.type !== 'detection') return
    if (!throttleRef.current) {
      fetchRef.current()
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null
      }, 10000)
    }
  }, [])

  const { connected } = useSSE(handleSSE)

  const activeCount = roster.filter((m) => m.status === 'active').length
  const inactiveCount = roster.filter((m) => m.status === 'inactive').length

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-text">Senior Roster</h1>
            <div className="flex gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-muted">{activeCount} active</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-muted">{inactiveCount} inactive</span>
              </span>
            </div>
          </div>

          <Panel
            title="Known Members"
            subtitle={`${roster.length} member${roster.length !== 1 ? 's' : ''} registered`}
          >
            {loading ? (
              <div className="text-center py-8 text-muted text-sm">Loading roster...</div>
            ) : error ? (
              <div className="text-center py-8 text-coral text-sm">{error}</div>
            ) : roster.length === 0 ? (
              <div className="text-center py-8 text-muted text-sm">
                No known faces registered. Add members via Settings &rarr; Known Faces.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Since</th>
                      <th className="pb-2 pr-4 font-medium">Last Seen</th>
                      <th className="pb-2 pr-4 font-medium">Location</th>
                      <th className="pb-2 pr-4 font-medium">Camera</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((member) => (
                      <tr
                        key={member.name}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2.5 pr-4 font-medium text-text">
                          {member.name}
                        </td>
                        <td className="py-2.5 pr-4 text-muted">
                          {member.first_seen
                            ? formatTime(member.first_seen)
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-muted">
                          {member.last_seen ? (
                            <span title={formatTime(member.last_seen)}>
                              {timeAgo(member.last_seen)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-muted">
                          {member.location || '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-muted">
                          {member.camera_location || '—'}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                              member.status === 'active'
                                ? 'bg-green-500/15 text-green-400'
                                : 'bg-gray-500/15 text-gray-400'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                member.status === 'active'
                                  ? 'bg-green-500'
                                  : 'bg-gray-400'
                              }`}
                            />
                            {member.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </main>
      </div>
    </div>
  )
}
