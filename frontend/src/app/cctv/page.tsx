'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { Camera, CCTVSnapshot, FRStatus, SSEEvent } from '@/lib/types'

interface DetectionItem {
  id: number
  person: string
  personType: 'known' | 'unknown'
  cameraName: string
  confidence: number
  timestamp: string
  crop: string | null
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function CCTVPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [snapshots, setSnapshots] = useState<CCTVSnapshot[]>([])
  const [status, setStatus] = useState<FRStatus | null>(null)
  const [detections, setDetections] = useState<DetectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const [cams, snaps, st] = await Promise.all([
        api.cameras(),
        api.latestSnapshots(),
        api.cctvStatus(),
      ])
      setCameras(cams)
      setSnapshots(snaps)
      setStatus(st)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CCTV data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Poll status every 10 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const st = await api.cctvStatus()
        setStatus(st)
      } catch { /* ignore */ }
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  // Handle SSE events
  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === 'detection' && event.person) {
      setDetections(prev => [{
        id: nextId.current++,
        person: event.person!,
        personType: (event.person_type as 'known' | 'unknown') || 'unknown',
        cameraName: event.camera_name || '',
        confidence: event.confidence || 0,
        timestamp: event.timestamp || new Date().toISOString(),
        crop: event.crop || null,
      }, ...prev].slice(0, 50))
    }
    if (event.type === 'snapshot') {
      api.latestSnapshots().then(setSnapshots).catch(() => {})
    }
  }, [])

  const { connected } = useSSE(handleSSE)

  const isRunning = status?.status === 'running'
  const snapshotMap = new Map(snapshots.map(s => [s.camera_id, s]))

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60 overflow-y-auto">
          <TopBar connected={connected} />
          <main className="p-6 flex items-center justify-center h-[calc(100vh-3.5rem)]">
            <div className="text-muted">Loading CCTV feeds...</div>
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
            <p className="text-coral font-semibold">Failed to load CCTV feeds</p>
            <p className="text-muted text-sm mt-1">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-teal text-white rounded-lg text-sm hover:bg-teal/90"
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
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-6">
          {/* ── Header ─────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text">CCTV Feeds</h1>
              <p className="text-muted text-sm mt-0.5">
                {cameras.filter(c => c.enabled).length} of {cameras.length} cameras configured
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? 'bg-green animate-pulse-dot' : 'bg-gray-400'
              }`} />
              <span className={`text-sm font-medium ${
                isRunning ? 'text-green' : 'text-muted'
              }`}>
                {isRunning ? 'System Active' : 'System Offline'}
              </span>
            </div>
          </div>

          {/* ── Camera Grid ────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {cameras.map((cam) => {
              const snap = snapshotMap.get(cam.id)
              return (
                <div key={cam.id} className="rounded-xl overflow-hidden border border-border bg-gray-900">
                  {/* Feed area */}
                  <div className="aspect-video relative bg-navy-dark flex items-center justify-center">
                    {snap?.snapshot_b64 ? (
                      <img
                        src={`data:image/jpeg;base64,${snap.snapshot_b64}`}
                        alt={cam.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center">
                        <div className="text-gray-500 text-3xl mb-2">📹</div>
                        <div className="text-gray-500 text-sm">
                          {cam.enabled
                            ? (isRunning ? 'Awaiting capture...' : 'System offline')
                            : 'Camera disabled'}
                        </div>
                      </div>
                    )}
                    {/* Camera label overlay */}
                    <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-md font-medium">
                      {cam.name}
                    </div>
                    {/* Status dot */}
                    <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${
                      cam.enabled && isRunning
                        ? 'bg-green animate-pulse-dot'
                        : 'bg-gray-500'
                    }`} />
                    {/* Timestamp overlay */}
                    {snap?.timestamp && (
                      <div className="absolute bottom-3 right-3 bg-black/60 text-gray-300 text-[10px] px-2 py-0.5 rounded">
                        {new Date(snap.timestamp).toLocaleTimeString('en-SG', { hour12: false })}
                      </div>
                    )}
                  </div>
                  {/* Info bar */}
                  <div className="bg-navy-dark px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-gray-400">{cam.location}</span>
                    <div className="flex items-center gap-3">
                      {snap ? (
                        <>
                          <span className="text-green font-medium">
                            {snap.identified_count} identified
                          </span>
                          {snap.unidentified_count > 0 && (
                            <span className="text-coral font-medium">
                              {snap.unidentified_count} unidentified
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500">No data</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Bottom Row: Detections + Status ─────── */}
          <div className="grid grid-cols-12 gap-6">
            {/* Detection Events Feed */}
            <div className="col-span-8">
              <Panel
                title="Detection Events"
                subtitle={`${detections.length} event${detections.length !== 1 ? 's' : ''} captured`}
                action={
                  detections.length > 0 ? (
                    <button
                      onClick={() => setDetections([])}
                      className="text-xs text-muted hover:text-text"
                    >
                      Clear
                    </button>
                  ) : undefined
                }
              >
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {detections.length === 0 ? (
                    <div className="text-center py-8 text-muted text-sm">
                      {isRunning
                        ? 'Waiting for detection events...'
                        : 'System offline — no events'}
                    </div>
                  ) : (
                    detections.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors"
                      >
                        {/* Face crop thumbnail */}
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-navy-dark flex-shrink-0 flex items-center justify-center">
                          {d.crop ? (
                            <img
                              src={`data:image/png;base64,${d.crop}`}
                              alt={d.person}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-gray-500 text-xs">
                              {d.person.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        {/* Person info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text truncate">
                              {d.person}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              d.personType === 'known'
                                ? 'bg-green/10 text-green'
                                : 'bg-coral/10 text-coral'
                            }`}>
                              {d.personType === 'known' ? 'Known' : 'Unknown'}
                            </span>
                          </div>
                          <div className="text-xs text-muted">
                            {d.cameraName}
                            {d.confidence > 0 && (
                              <> · {(d.confidence * 100).toFixed(0)}% confidence</>
                            )}
                          </div>
                        </div>
                        {/* Timestamp */}
                        <div className="text-xs text-muted flex-shrink-0">
                          {d.timestamp ? timeAgo(d.timestamp) : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </div>

            {/* System Status */}
            <div className="col-span-4">
              <Panel
                title="System Status"
                subtitle={isRunning ? 'FaceRecognizer active' : 'System offline'}
              >
                {status && isRunning ? (
                  <div className="space-y-4">
                    {/* Status indicator */}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green animate-pulse-dot" />
                      <span className="text-sm font-semibold text-green">Running</span>
                      {status.uptime_seconds != null && (
                        <span className="text-xs text-muted ml-auto">
                          Uptime: {formatUptime(status.uptime_seconds)}
                        </span>
                      )}
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox label="Captures" value={status.total_captures ?? 0} />
                      <StatBox label="Analyses" value={status.total_analyses ?? 0} />
                      <StatBox label="Total Detections" value={status.total_detections ?? 0} />
                      <StatBox label="Embeddings" value={status.total_embeddings ?? 0} />
                    </div>

                    {/* Known persons */}
                    {status.known_persons_detected &&
                      Object.keys(status.known_persons_detected).length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                            Known Persons Detected
                          </h4>
                          <div className="space-y-1">
                            {Object.entries(status.known_persons_detected).map(
                              ([name, count]) => (
                                <div
                                  key={name}
                                  className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface"
                                >
                                  <span className="text-text font-medium">{name}</span>
                                  <span className="text-green">{count}x</span>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    {/* Unknown count */}
                    {(status.unknown_persons_count ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-coral/5 border border-coral/20">
                        <span className="text-text font-medium">Unknown Persons</span>
                        <span className="text-coral font-semibold">
                          {status.unknown_persons_count}
                        </span>
                      </div>
                    )}

                    {/* Camera list */}
                    {status.cameras && status.cameras.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                          Active Cameras
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {status.cameras.map((name) => (
                            <span
                              key={name}
                              className="text-[10px] px-2 py-1 rounded-full bg-teal/10 text-teal font-medium"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-gray-400 text-3xl mb-3">📡</div>
                    <p className="text-muted text-sm">CCTV system is offline</p>
                    <p className="text-muted text-xs mt-1">
                      Set CAMERA_WORKER_ENABLED=true to activate
                    </p>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-lg px-3 py-2">
      <div className="text-lg font-bold text-text">{value.toLocaleString()}</div>
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
    </div>
  )
}
