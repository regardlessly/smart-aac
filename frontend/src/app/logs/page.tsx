'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { useSSE } from '@/hooks/useSSE'
import { apiFetch } from '@/lib/api'

type LogTab = 'backend' | 'frontend'

interface CameraStatus {
  status: 'loading' | 'running' | 'stopped' | 'error'
  details: string
  running: boolean
}

function getLineColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('failed') || l.includes('exception') || l.includes('traceback')) return '#ef4444'
  if (l.includes('warn') || l.includes('warning')) return '#f59e0b'
  if (l.includes('camera_worker') || l.includes('face') || l.includes('embed') || l.includes('yolo') || l.includes('insightface')) return '#1155cc'
  if (l.includes(' 200 ') || l.includes('ok') || l.includes('success') || l.includes('ready') || l.includes('started') || l.includes('running')) return '#16a34a'
  if (l.includes(' 4') || l.includes(' 5')) return '#f59e0b'
  return '#374151'
}

export default function LogsPage() {
  const [tab, setTab] = useState<LogTab>('backend')
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { connected } = useSSE(() => {})

  const fetchLogs = useCallback(async () => {
    try {
      const data = await apiFetch<{ lines: string[] }>(`/api/logs/${tab}?lines=300`)
      setLines(data.lines || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [tab])

  const fetchCameraStatus = useCallback(async () => {
    try {
      const data = await apiFetch<CameraStatus>('/api/logs/camera-status')
      setCameraStatus(data)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    setLines([])
    fetchLogs()
    fetchCameraStatus()
  }, [tab, fetchLogs, fetchCameraStatus])

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (autoRefresh) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoRefresh])

  // Auto-refresh every 3s
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchLogs()
      fetchCameraStatus()
    }, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchLogs, fetchCameraStatus])

  const statusColor = {
    loading: '#f59e0b',
    running: '#16a34a',
    stopped: '#6b7280',
    error: '#ef4444',
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-hidden flex flex-col">
        <TopBar connected={connected} />
        <main className="flex-1 overflow-hidden flex flex-col p-6 gap-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text">System Logs</h1>
              <p className="text-sm text-muted mt-0.5">Real-time backend and frontend logs</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAutoRefresh(a => !a)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  autoRefresh
                    ? 'bg-teal text-white border-teal'
                    : 'bg-white text-text border-border hover:bg-surface'
                }`}
              >
                {autoRefresh ? '⟳ Live' : '⟳ Paused'}
              </button>
              <button
                onClick={() => { setLoading(true); fetchLogs() }}
                className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-surface transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Camera Worker Status Banner */}
          {cameraStatus && (
            <div
              className="rounded-xl border px-4 py-3 flex items-center gap-3"
              style={{
                borderColor: statusColor[cameraStatus.status] + '40',
                backgroundColor: statusColor[cameraStatus.status] + '10',
              }}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: statusColor[cameraStatus.status],
                  boxShadow: cameraStatus.status === 'running' ? `0 0 6px ${statusColor[cameraStatus.status]}` : 'none',
                }}
              />
              <div>
                <span className="text-sm font-semibold" style={{ color: statusColor[cameraStatus.status] }}>
                  Camera Worker: {cameraStatus.status.charAt(0).toUpperCase() + cameraStatus.status.slice(1)}
                </span>
                <span className="text-sm text-muted ml-2">{cameraStatus.details}</span>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-surface rounded-lg p-1 w-fit">
            {(['backend', 'frontend'] as LogTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t ? 'bg-white text-text shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                {t === 'backend' ? '🐍 Backend' : '⚡ Frontend'}
              </button>
            ))}
          </div>

          {/* Log viewer */}
          <div className="flex-1 overflow-hidden rounded-xl border border-border bg-gray-950 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <span className="text-xs text-gray-400 font-mono">
                {tab === 'backend' ? '/tmp/smart-aac-backend.log' : '/tmp/smart-aac-frontend.log'}
              </span>
              <span className="text-xs text-gray-500">{lines.length} lines</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
              {loading ? (
                <p className="text-gray-500">Loading logs...</p>
              ) : lines.length === 0 ? (
                <p className="text-gray-500">No log entries found.</p>
              ) : (
                lines.map((line, i) => (
                  <div
                    key={i}
                    className="whitespace-pre-wrap break-all py-0.5 hover:bg-gray-900 px-1 rounded"
                    style={{ color: getLineColor(line) }}
                  >
                    {line || ' '}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}
