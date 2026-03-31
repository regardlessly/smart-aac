'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import { ALERT_COLORS } from '@/lib/constants'
import type { Alert, AlertCounts, AlertsPage } from '@/lib/types'

type FilterType = 'all' | 'critical' | 'warning' | 'info'
type FilterStatus = 'active' | 'acknowledged' | 'all'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AlertsPage() {
  const [data, setData] = useState<AlertsPage | null>(null)
  const [counts, setCounts] = useState<AlertCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const fetchAlerts = useCallback(async (p = 1) => {
    try {
      const params: Record<string, string | number> = { page: p, per_page: 50 }
      if (filterType !== 'all') params.type = filterType
      if (filterStatus !== 'all') params.acknowledged = filterStatus === 'acknowledged' ? 'true' : 'false'
      if (search) params.search = search

      const [alertsData, countsData] = await Promise.all([
        api.alerts(params as { type?: string; acknowledged?: string; search?: string; page?: number; per_page?: number }),
        api.alertCounts(),
      ])
      setData(alertsData)
      setCounts(countsData)
      setError(null)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [filterType, filterStatus, search])

  useEffect(() => {
    setPage(1)
    fetchAlerts(1)
  }, [fetchAlerts])

  // SSE: refresh on new alert events
  const handleSSE = useCallback(() => {
    fetchAlerts(page)
  }, [fetchAlerts, page])

  const { connected } = useSSE(handleSSE)

  // Fallback polling when SSE disconnected
  useEffect(() => {
    if (connected) return
    const interval = setInterval(() => fetchAlerts(page), 30000)
    return () => clearInterval(interval)
  }, [connected, fetchAlerts, page])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchAlerts(newPage)
  }

  const handleAcknowledge = async (id: number) => {
    await api.acknowledgeAlert(id)
    fetchAlerts(page)
  }

  const handleBulkAcknowledge = async () => {
    if (selected.size === 0) return
    await api.bulkAcknowledgeAlerts(Array.from(selected))
    fetchAlerts(page)
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (!data) return
    const unacked = data.alerts.filter(a => !a.acknowledged)
    if (selected.size === unacked.length && unacked.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(unacked.map(a => a.id)))
    }
  }

  const alerts = data?.alerts ?? []
  const unackedOnPage = useMemo(() => alerts.filter(a => !a.acknowledged), [alerts])

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60 overflow-y-auto">
          <TopBar connected={connected} />
          <main className="p-6 flex items-center justify-center h-[calc(100vh-3.5rem)]">
            <div className="text-muted">Loading alerts...</div>
          </main>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60 overflow-y-auto">
          <TopBar connected={connected} />
          <main className="p-6 flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
            <p className="text-coral font-semibold">Failed to load alerts</p>
            <p className="text-muted text-sm mt-1">{error}</p>
            <button
              onClick={() => fetchAlerts(1)}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
            >
              Retry
            </button>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <Sidebar alertCount={counts?.total} />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} alertCount={counts?.total} />
        <main className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text">Alerts & Events</h1>
              <p className="text-muted text-sm mt-0.5">
                {data?.total ?? 0} total alerts{counts ? `, ${counts.total} unacknowledged` : ''}
              </p>
            </div>
          </div>

          {/* Stat Cards */}
          {counts && (
            <div className="grid grid-cols-4 gap-4">
              <StatCard
                label="Total Active"
                value={counts.total}
                color="text-text"
                bgColor="bg-surface"
              />
              <StatCard
                label="Critical"
                value={counts.critical}
                color="text-coral"
                bgColor="bg-coral/10"
                onClick={() => { setFilterType('critical'); setFilterStatus('active') }}
                active={filterType === 'critical'}
              />
              <StatCard
                label="Warning"
                value={counts.warning}
                color="text-orange"
                bgColor="bg-orange/10"
                onClick={() => { setFilterType('warning'); setFilterStatus('active') }}
                active={filterType === 'warning'}
              />
              <StatCard
                label="Info"
                value={counts.info}
                color="text-sky"
                bgColor="bg-sky/10"
                onClick={() => { setFilterType('info'); setFilterStatus('active') }}
                active={filterType === 'info'}
              />
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Type filter */}
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
              {(['all', 'critical', 'warning', 'info'] as FilterType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    filterType === t
                      ? 'bg-panel text-text shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
              {(['active', 'acknowledged', 'all'] as FilterStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    filterStatus === s
                      ? 'bg-panel text-text shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px] max-w-sm">
              <input
                type="text"
                placeholder="Search alerts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Bulk actions */}
            {selected.size > 0 && (
              <button
                onClick={handleBulkAcknowledge}
                className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90"
              >
                Acknowledge {selected.size} selected
              </button>
            )}
          </div>

          {/* Alert List */}
          <Panel
            title="Alerts"
            subtitle={`Showing ${alerts.length} of ${data?.total ?? 0}`}
            action={
              unackedOnPage.length > 0 ? (
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-primary hover:underline"
                >
                  {selected.size === unackedOnPage.length ? 'Deselect All' : 'Select All'}
                </button>
              ) : undefined
            }
          >
            <div className="space-y-1">
              {alerts.length === 0 ? (
                <div className="text-center text-muted text-sm py-12">
                  No alerts match your filters
                </div>
              ) : (
                alerts.map(alert => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    selected={selected.has(alert.id)}
                    onToggle={() => toggleSelect(alert.id)}
                    onAcknowledge={() => handleAcknowledge(alert.id)}
                  />
                ))
              )}
            </div>

            {/* Pagination */}
            {data && data.pages > 1 && (
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
                <span className="text-xs text-muted">
                  Page {data.page} of {data.pages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1 rounded text-xs font-medium disabled:opacity-30 text-muted hover:text-text hover:bg-surface"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(data.pages, 7) }, (_, i) => {
                    let p: number
                    if (data.pages <= 7) {
                      p = i + 1
                    } else if (page <= 4) {
                      p = i + 1
                    } else if (page >= data.pages - 3) {
                      p = data.pages - 6 + i
                    } else {
                      p = page - 3 + i
                    }
                    return (
                      <button
                        key={p}
                        onClick={() => handlePageChange(p)}
                        className={`w-8 h-8 rounded text-xs font-medium ${
                          p === page
                            ? 'bg-primary text-white'
                            : 'text-muted hover:text-text hover:bg-surface'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= (data.pages || 1)}
                    className="px-3 py-1 rounded text-xs font-medium disabled:opacity-30 text-muted hover:text-text hover:bg-surface"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </main>
      </div>
    </div>
  )
}

function StatCard({
  label, value, color, bgColor, onClick, active,
}: {
  label: string
  value: number
  color: string
  bgColor: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`${bgColor} rounded-[14px] p-4 text-left transition-all ${
        active ? 'ring-2 ring-primary' : ''
      } ${onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
    >
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </button>
  )
}

function AlertRow({
  alert, selected, onToggle, onAcknowledge,
}: {
  alert: Alert
  selected: boolean
  onToggle: () => void
  onAcknowledge: () => void
}) {
  const colors = ALERT_COLORS[alert.type] || ALERT_COLORS.info

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border-l-4 transition-colors ${
        colors.bg
      } ${
        alert.type === 'critical' ? 'border-l-coral' :
        alert.type === 'warning' ? 'border-l-orange' : 'border-l-sky'
      } ${alert.acknowledged ? 'opacity-60' : ''}`}
    >
      {/* Checkbox for unacknowledged */}
      {!alert.acknowledged ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 shrink-0 accent-teal"
        />
      ) : (
        <div className="w-4 shrink-0" />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge bg={colors.bg} text={colors.text}>
            {alert.type.toUpperCase()}
          </Badge>
          {alert.acknowledged && (
            <Badge bg="bg-surface" text="text-muted">ACKNOWLEDGED</Badge>
          )}
          {alert.camera_name && (
            <span className="text-xs text-muted">
              Camera: {alert.camera_name}
            </span>
          )}
        </div>
        <div className="font-medium text-sm text-text mt-1">{alert.title}</div>
        {alert.description && (
          <div className="text-xs text-text-secondary mt-0.5">{alert.description}</div>
        )}
        <div className="text-[11px] text-muted mt-1">
          {formatDateTime(alert.created_at)} ({timeAgo(alert.created_at)})
        </div>
      </div>

      {/* Actions */}
      {!alert.acknowledged && (
        <button
          onClick={onAcknowledge}
          className="text-xs text-primary hover:underline shrink-0 mt-1"
        >
          Acknowledge
        </button>
      )}
    </div>
  )
}
