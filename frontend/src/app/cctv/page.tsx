'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedCam, setSelectedCam] = useState<Camera | null>(null)
  const nextId = useRef(0)

  // Track SSE detection IDs so polled data doesn't overwrite SSE data (which has crops)
  const sseDetectionIds = useRef(new Set<string>())

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
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CCTV data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch recent detections from API (polling fallback)
  const fetchDetections = useCallback(async () => {
    try {
      const data = await api.recentDetections()
      setDetections(prev => {
        // Merge: keep SSE detections (they have crops), add polled ones that are new
        const existingKeys = new Set(prev.map(d => `${d.person}-${d.timestamp}`))
        const newItems: DetectionItem[] = []
        for (const d of data) {
          const key = `${d.person}-${d.timestamp}`
          if (!existingKeys.has(key) && !sseDetectionIds.current.has(key)) {
            newItems.push({
              id: nextId.current++,
              person: d.person,
              personType: d.personType,
              cameraName: d.cameraName,
              confidence: d.confidence,
              timestamp: d.timestamp,
              crop: d.crop,
            })
          }
        }
        if (newItems.length === 0) return prev
        return [...newItems, ...prev].slice(0, 50)
      })
    } catch {
      // silent
    }
  }, [])

  useEffect(() => { fetchData(); fetchDetections() }, [fetchData, fetchDetections])

  // Close modal on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedCam(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Polling is set up after SSE hook below (needs `connected` state)

  // Throttle snapshot refresh — at most once every 5s
  const snapThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle SSE events
  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === 'detection' && event.person) {
      const ts = event.timestamp || new Date().toISOString()
      const key = `${event.person}-${ts}`
      sseDetectionIds.current.add(key)
      setDetections(prev => [{
        id: nextId.current++,
        person: event.person!,
        personType: (event.person_type as 'known' | 'unknown') || 'unknown',
        cameraName: event.camera_name || '',
        confidence: event.confidence || 0,
        timestamp: ts,
        crop: event.crop || null,
      }, ...prev].slice(0, 50))
    }
    if (event.type === 'snapshot' && !snapThrottleRef.current) {
      // Delay slightly so all cameras in the batch have time to save
      setTimeout(() => {
        api.latestSnapshots().then(s => { setSnapshots(s); setLastUpdated(new Date()) }).catch(() => {})
      }, 2000)
      snapThrottleRef.current = setTimeout(() => {
        snapThrottleRef.current = null
      }, 8000)
    }
  }, [])

  const { connected } = useSSE(handleSSE)

  // Poll every 10s to ensure all cameras stay fresh
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [cams, st, snaps] = await Promise.all([
          api.cameras(),
          api.cctvStatus(),
          api.latestSnapshots(),
        ])
        setCameras(cams)
        setStatus(st)
        setSnapshots(snaps)
        setError(null)
        setLastUpdated(new Date())
      } catch {
        // silent
      }
      fetchDetections()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchDetections, connected])

  const isRunning = status?.status === 'running'
  const snapshotMap = useMemo(
    () => new Map(snapshots.map(s => [s.camera_id, s])),
    [snapshots]
  )

  // Group cameras by room
  const camerasByRoom = useMemo(() => {
    const groups = new Map<string, Camera[]>()
    for (const cam of cameras) {
      const key = cam.room_name || 'Unassigned'
      const list = groups.get(key) || []
      list.push(cam)
      groups.set(key, list)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1
      if (b === 'Unassigned') return -1
      return a.localeCompare(b)
    })
  }, [cameras])

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
              {lastUpdated && (
                <p className="text-xs text-muted mt-0.5">
                  Last updated: {lastUpdated.toLocaleTimeString('en-SG', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </p>
              )}
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

          {/* ── Camera Feeds grouped by Room ──────────── */}
          {camerasByRoom.map(([roomName, roomCameras]) => (
            <div key={roomName} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-text">{roomName}</h2>
                <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded-full">
                  {roomCameras.length} camera{roomCameras.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className={`grid gap-4 ${
                roomCameras.length <= 2 ? 'grid-cols-1 sm:grid-cols-2'
                : roomCameras.length <= 4 ? 'grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              }`}>
                {roomCameras.map((cam) => {
                  const snap = snapshotMap.get(cam.id)
                  return (
                    <div
                      key={cam.id}
                      className="rounded-[14px] overflow-hidden border border-border bg-gray-900 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                      onClick={() => setSelectedCam(cam)}
                    >
                      {/* Feed area */}
                      <div className="aspect-video relative bg-navy-dark flex items-center justify-center">
                        {snap?.snapshot_b64 ? (
                          <img
                            src={`data:image/jpeg;base64,${snap.snapshot_b64}`}
                            alt={cam.name}
                            className="w-full h-full object-cover"
                            width={640}
                            height={360}
                            loading="lazy"
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
                        <span className="text-gray-400">{cam.name}</span>
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
            </div>
          ))}

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
                              className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-medium"
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
          {/* ── Expanded Camera Modal ────────────── */}
          {selectedCam && (() => {
            const snap = snapshotMap.get(selectedCam.id)
            const camDetections = detections.filter(d => d.cameraName === selectedCam.name).slice(0, 10)
            return (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                onClick={() => setSelectedCam(null)}
              >
                <div
                  className="bg-panel rounded-2xl shadow-2xl w-[95vw] max-w-6xl max-h-[95vh] overflow-hidden flex flex-col"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Modal header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                      <h2 className="text-lg font-bold text-text">{selectedCam.name}</h2>
                      <p className="text-sm text-muted">{selectedCam.room_name || 'Unassigned Room'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          selectedCam.enabled && isRunning ? 'bg-green animate-pulse-dot' : 'bg-gray-400'
                        }`} />
                        <span className={`text-sm ${
                          selectedCam.enabled && isRunning ? 'text-green' : 'text-muted'
                        }`}>
                          {selectedCam.enabled && isRunning ? 'Live' : 'Offline'}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedCam(null)}
                        className="p-2 hover:bg-surface rounded-lg transition-colors text-muted hover:text-text"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Modal body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Expanded snapshot */}
                    <div className="rounded-[14px] overflow-hidden bg-gray-900 border border-border">
                      <div className="aspect-video relative flex items-center justify-center bg-navy-dark">
                        {snap?.snapshot_b64 ? (
                          <img
                            src={`data:image/jpeg;base64,${snap.snapshot_b64}`}
                            alt={selectedCam.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-center">
                            <div className="text-gray-500 text-4xl mb-2">📹</div>
                            <div className="text-gray-500 text-sm">
                              {selectedCam.enabled
                                ? (isRunning ? 'Awaiting capture...' : 'System offline')
                                : 'Camera disabled'}
                            </div>
                          </div>
                        )}
                        {snap?.timestamp && (
                          <div className="absolute bottom-3 right-3 bg-black/60 text-gray-300 text-xs px-2.5 py-1 rounded">
                            {new Date(snap.timestamp).toLocaleTimeString('en-SG', { hour12: false })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-surface rounded-[14px] px-4 py-3">
                        <div className="text-2xl font-bold text-text">{snap?.identified_count ?? 0}</div>
                        <div className="text-xs text-muted uppercase tracking-wide">Identified</div>
                      </div>
                      <div className="bg-surface rounded-[14px] px-4 py-3">
                        <div className="text-2xl font-bold text-coral">{snap?.unidentified_count ?? 0}</div>
                        <div className="text-xs text-muted uppercase tracking-wide">Unidentified</div>
                      </div>
                      <div className="bg-surface rounded-[14px] px-4 py-3">
                        <div className="text-2xl font-bold text-text">{(snap?.identified_count ?? 0) + (snap?.unidentified_count ?? 0)}</div>
                        <div className="text-xs text-muted uppercase tracking-wide">Total Persons</div>
                      </div>
                    </div>

                    {/* Recent detections for this camera */}
                    {camDetections.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-text mb-2">Recent Detections</h3>
                        <div className="space-y-1">
                          {camDetections.map(d => (
                            <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface">
                              <div className="w-8 h-8 rounded-full overflow-hidden bg-navy-dark flex-shrink-0 flex items-center justify-center">
                                {d.crop ? (
                                  <img src={`data:image/png;base64,${d.crop}`} alt={d.person} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-gray-500 text-xs">{d.person.charAt(0).toUpperCase()}</span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-text">{d.person}</span>
                                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  d.personType === 'known' ? 'bg-green/10 text-green' : 'bg-coral/10 text-coral'
                                }`}>
                                  {d.personType === 'known' ? 'Known' : 'Unknown'}
                                </span>
                              </div>
                              <span className="text-xs text-muted">{d.timestamp ? timeAgo(d.timestamp) : ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
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
