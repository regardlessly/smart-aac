'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { RosterMember, SSEEvent } from '@/lib/types'

const PAGE_SIZE = 25

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

export default function MembersPage() {
  const [members, setMembers] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

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
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roster')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData

  useEffect(() => { fetchData() }, [fetchData])

  // Throttle SSE-driven refresh to at most once every 10s
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === 'detection') {
      if (!throttleRef.current) {
        fetchDataRef.current()
        throttleRef.current = setTimeout(() => {
          throttleRef.current = null
        }, 10000)
      }
    }
    if (event.type === 'sync_progress') {
      setSyncProgress({
        current: event.current as number,
        total: event.total as number,
        name: event.name as string,
      })
    }
    if (event.type === 'sync_complete') {
      setSyncing(false)
      setSyncProgress(null)
      setSyncResult({
        synced: event.synced as number,
        skipped: event.skipped as number,
        errors: (event.errors as string[]) || [],
      })
      fetchDataRef.current()
    }
  }, [])

  const { connected } = useSSE(handleSSE)

  useEffect(() => {
    if (connected) return
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData, connected])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      await api.syncKnownFacesFromOdoo()
    } catch {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() =>
    members.filter((m) =>
      m.name.toLowerCase().includes(search.toLowerCase()),
    ),
  [members, search])

  // Reset to page 1 when search changes
  useEffect(() => { setPage(1) }, [search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const startIndex = (page - 1) * PAGE_SIZE

  const { activeCount, inactiveCount } = useMemo(() => ({
    activeCount: members.filter(m => m.status === 'active').length,
    inactiveCount: members.filter(m => m.status === 'inactive').length,
  }), [members])

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text">Members</h1>
              <p className="text-sm text-muted mt-0.5">
                Registered members and their activity
              </p>
            </div>
            <div className="flex gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green" />
                <span className="text-muted">{activeCount} active</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-muted">{inactiveCount} inactive</span>
              </span>
            </div>
          </div>

          {/* Actions bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text w-64 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync from Odoo'}
            </button>
            <span className="text-sm text-muted ml-auto">
              {filtered.length} member{filtered.length !== 1 ? 's' : ''}{search ? ' found' : ' total'}
            </span>
          </div>

          {/* Sync progress */}
          {syncing && syncProgress && (
            <div className="bg-sky-light border border-sky/20 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-sky font-medium">Syncing members...</span>
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
            subtitle={`Showing ${startIndex + 1}–${Math.min(startIndex + PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          >
            {loading ? (
              <p className="text-sm text-muted text-center py-8">Loading members...</p>
            ) : error ? (
              <p className="text-sm text-coral text-center py-8">{error}</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">
                {search
                  ? 'No members match your search.'
                  : "No members registered. Click 'Sync from Odoo' to import."}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        <th className="pb-2 pr-4 font-medium w-10">#</th>
                        <th className="pb-2 pr-4 font-medium">Name</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Location</th>
                        <th className="pb-2 pr-4 font-medium">Last Seen</th>
                        <th className="pb-2 font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((m, i) => (
                        <tr
                          key={m.senior_id ?? m.name}
                          className="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors"
                        >
                          <td className="py-2.5 pr-4 text-muted">{startIndex + i + 1}</td>
                          <td className="py-2.5 pr-4">
                            {m.senior_id ? (
                              <Link
                                href={`/members/${m.senior_id}`}
                                className="flex items-center gap-2 hover:text-primary transition-colors"
                              >
                                <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                  {m.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                </span>
                                <span className="font-medium text-text hover:text-primary">
                                  {m.name}
                                </span>
                              </Link>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                  {m.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                </span>
                                <span className="font-medium text-text">{m.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
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
                            {m.location || '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-muted">
                            {m.last_seen ? formatTimeAgo(m.last_seen) : '—'}
                          </td>
                          <td className="py-2.5">
                            {m.senior_id && (
                              <Link
                                href={`/members/${m.senior_id}`}
                                className="text-muted hover:text-primary transition-colors"
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

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                        .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
                          if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis')
                          acc.push(p)
                          return acc
                        }, [])
                        .map((p, i) =>
                          p === 'ellipsis' ? (
                            <span key={`e${i}`} className="px-2 text-muted text-sm">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setPage(p)}
                              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                                page === p
                                  ? 'bg-primary text-white'
                                  : 'text-text hover:bg-surface'
                              }`}
                            >
                              {p}
                            </button>
                          )
                        )}
                    </div>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </Panel>
        </main>
      </div>
    </div>
  )
}
