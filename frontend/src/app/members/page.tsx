'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { api, apiFetch } from '@/lib/api'
import { getToken } from '@/lib/auth'
import type { RosterMember } from '@/lib/types'

export default function MembersPage() {
  const [members, setMembers] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [connected, setConnected] = useState(false)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{
    current: number
    total: number
    name: string
  } | null>(null)
  const [syncResult, setSyncResult] = useState<{
    synced: number
    skipped: number
    errors: string[]
  } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const data = await api.roster()
      setMembers(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // SSE for real-time sync progress
  useEffect(() => {
    const token = getToken()
    if (!token) return

    const es = new EventSource(
      `/api/events?token=${encodeURIComponent(token)}`,
    )
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type === 'sync_progress') {
          setSyncProgress({
            current: data.current,
            total: data.total,
            name: data.name,
          })
        } else if (data.type === 'sync_complete') {
          setSyncing(false)
          setSyncProgress(null)
          setSyncResult({
            synced: data.synced,
            skipped: data.skipped,
            errors: data.errors || [],
          })
          fetchDataRef.current()
        }
      } catch {
        // ignore
      }
    }

    return () => es.close()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      await api.syncKnownFacesFromOdoo()
    } catch {
      setSyncing(false)
    }
  }

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  )

  const activeCount = members.filter((m) => m.status === 'active').length

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-text">Members</h1>
            <p className="text-sm text-muted mt-1">
              Registered members and their activity
            </p>
          </div>

          {/* Actions bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text w-64 focus:outline-none focus:ring-2 focus:ring-teal/30"
            />
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-1.5 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal-dark transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : '🔄 Sync from Odoo'}
            </button>
            <span className="text-sm text-muted ml-auto">
              {members.length} members · {activeCount} active now
            </span>
          </div>

          {/* Sync progress */}
          {syncing && syncProgress && (
            <div className="bg-sky-light border border-sky/20 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-sky font-medium">
                  Syncing members...
                </span>
                <span className="text-muted">
                  {syncProgress.current}/{syncProgress.total}
                </span>
              </div>
              <div className="h-2 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky rounded-full transition-all"
                  style={{
                    width: `${
                      syncProgress.total > 0
                        ? (syncProgress.current / syncProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted mt-1">{syncProgress.name}</p>
            </div>
          )}

          {/* Sync result */}
          {syncResult && (
            <div className="bg-green-light border border-green/20 rounded-lg p-3 text-sm">
              <span className="text-green font-medium">Sync complete!</span>{' '}
              {syncResult.synced} synced, {syncResult.skipped} skipped
              {syncResult.errors.length > 0 && (
                <span className="text-coral">
                  , {syncResult.errors.length} errors
                </span>
              )}
              <button
                onClick={() => setSyncResult(null)}
                className="ml-2 text-muted hover:text-text"
              >
                ✕
              </button>
            </div>
          )}

          {/* Members table */}
          <Panel
            title="All Members"
            subtitle={`${filtered.length} member${filtered.length !== 1 ? 's' : ''} found`}
          >
            {loading ? (
              <p className="text-sm text-muted text-center py-8">
                Loading members...
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">
                {search
                  ? 'No members match your search.'
                  : "No members registered. Click 'Sync from Odoo' to import."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th className="pb-2 pr-4 font-medium w-10">#</th>
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Last Seen</th>
                      <th className="pb-2 font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m, i) => (
                      <tr
                        key={m.name}
                        className="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-muted">{i + 1}</td>
                        <td className="py-2.5 pr-4">
                          <Link
                            href={
                              m.senior_id
                                ? `/members/${m.senior_id}`
                                : '#'
                            }
                            className="flex items-center gap-2 hover:text-teal transition-colors"
                          >
                            <span className="w-8 h-8 rounded-full bg-teal/10 text-teal flex items-center justify-center text-xs font-bold shrink-0">
                              {m.name
                                .split(' ')
                                .map((w) => w[0])
                                .join('')
                                .slice(0, 2)}
                            </span>
                            <span className="font-medium text-text">
                              {m.name}
                            </span>
                          </Link>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              m.status === 'active'
                                ? 'bg-green-light text-green'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                m.status === 'active'
                                  ? 'bg-green'
                                  : 'bg-gray-400'
                              }`}
                            />
                            {m.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-muted">
                          {m.location ? (
                            <span>
                              {m.location}
                              {m.last_seen && (
                                <span className="text-xs ml-1">
                                  ·{' '}
                                  {formatTimeAgo(m.last_seen)}
                                </span>
                              )}
                            </span>
                          ) : m.last_seen ? (
                            formatTimeAgo(m.last_seen)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5">
                          {m.senior_id && (
                            <Link
                              href={`/members/${m.senior_id}`}
                              className="text-muted hover:text-teal transition-colors"
                            >
                              →
                            </Link>
                          )}
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

function formatTimeAgo(isoStr: string): string {
  const d = new Date(isoStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  const time = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })

  if (diff < 60) return `just now (${time})`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago (${time})`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago (${time})`
  const dateStr = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
  return `${Math.floor(diff / 86400)}d ago (${dateStr})`
}
