'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { RosterMember } from '@/lib/types'

const MIN_CAPTURES = 3
const MAX_CAPTURES = 6
const MIN_QUALITY = 0.65

const ANGLE_PROMPTS: { text: string; icon: string }[] = [
  { text: 'Look straight ahead', icon: '\u{1F610}' },
  { text: 'Turn head slightly LEFT', icon: '\u{2B05}' },
  { text: 'Turn head slightly RIGHT', icon: '\u{27A1}' },
  { text: 'Look slightly DOWN', icon: '\u{2B07}' },
  { text: 'Straight again', icon: '\u{1F610}' },
  { text: 'Tilt head slightly LEFT', icon: '\u{21BA}' },
]

interface Capture {
  cropB64: string
  quality: number
  label: string
}

export default function EnrollPage() {
  const { connected } = useSSE()

  // ── Senior list ─────────────────────────────────────────
  const [seniors, setSeniors] = useState<RosterMember[]>([])
  const [loadingSeniors, setLoadingSeniors] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<RosterMember | null>(null)

  // ── Camera ──────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const guideRafRef = useRef<number | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)

  // ── Capture state ───────────────────────────────────────
  const [captures, setCaptures] = useState<Capture[]>([])
  const [busyCapture, setBusyCapture] = useState(false)
  const [busySave, setBusySave] = useState(false)
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [success, setSuccess] = useState<{ saved: number; embeddings: number } | null>(null)

  // ── Load seniors ────────────────────────────────────────
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    api.roster().then((rows) => {
      console.log('[enroll] loaded roster:', rows.length, 'members')
      setSeniors(rows)
      setLoadingSeniors(false)
    }).catch((e) => {
      console.error('[enroll] roster fetch failed:', e)
      setLoadError(e instanceof Error ? e.message : String(e))
      setLoadingSeniors(false)
    })
  }, [])

  // ── Camera lifecycle ────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (guideRafRef.current) {
      cancelAnimationFrame(guideRafRef.current)
      guideRafRef.current = null
    }
    const c = canvasRef.current
    if (c) {
      const ctx = c.getContext('2d')
      ctx?.clearRect(0, 0, c.width, c.height)
    }
  }, [])

  const populateCameras = useCallback(async (selectedId?: string) => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videos = devices.filter((d) => d.kind === 'videoinput')
      setCameras(videos)
      if (selectedId) setActiveDeviceId(selectedId)
    } catch {
      // permissions not yet granted
    }
  }, [])

  const startGuideLoop = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const frame = () => {
      if (!streamRef.current || !canvas.parentElement) return
      const rect = canvas.parentElement.getBoundingClientRect()
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width
        canvas.height = rect.height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const w = canvas.width, h = canvas.height
      const cx = w / 2, cy = h * 0.47
      const rx = w * 0.22, ry = h * 0.36
      const lw = Math.max(2, w * 0.004)

      // Oval
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.strokeStyle = '#00D4FF'
      ctx.lineWidth = lw
      ctx.stroke()

      // Corner brackets
      const pad = Math.min(w, h) * 0.055
      const bx1 = cx - rx - pad, by1 = cy - ry - pad
      const bx2 = cx + rx + pad, by2 = cy + ry + pad
      const bl = Math.min(w, h) * 0.065
      ctx.strokeStyle = '#00A878'
      ctx.lineWidth = lw * 1.2
      ctx.lineCap = 'square'
      const corners: [[number, number], [number, number], [number, number]][] = [
        [[bx1, by1 + bl], [bx1, by1], [bx1 + bl, by1]],
        [[bx2 - bl, by1], [bx2, by1], [bx2, by1 + bl]],
        [[bx1, by2 - bl], [bx1, by2], [bx1 + bl, by2]],
        [[bx2 - bl, by2], [bx2, by2], [bx2, by2 - bl]],
      ]
      corners.forEach((pts) => {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        ctx.lineTo(pts[1][0], pts[1][1])
        ctx.lineTo(pts[2][0], pts[2][1])
        ctx.stroke()
      })

      guideRafRef.current = requestAnimationFrame(frame)
    }
    frame()
  }, [])

  const startCamera = useCallback(async (deviceId?: string) => {
    stopCamera()
    const video = videoRef.current
    if (!video) return
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      await populateCameras(deviceId)
      startGuideLoop()
    } catch (e) {
      showFeedback('Camera error: ' + (e instanceof Error ? e.message : 'unknown'), false)
    }
  }, [stopCamera, populateCameras, startGuideLoop])

  // Start camera when a senior is selected, stop when deselected
  useEffect(() => {
    if (selected) {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [selected, startCamera, stopCamera])

  function showFeedback(msg: string, ok: boolean) {
    setFeedback({ msg, ok })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000)
  }

  // ── Capture ─────────────────────────────────────────────
  async function doCapture() {
    if (busyCapture || !streamRef.current || captures.length >= MAX_CAPTURES) return
    const video = videoRef.current
    if (!video) return

    setBusyCapture(true)
    try {
      const c = document.createElement('canvas')
      c.width = video.videoWidth
      c.height = video.videoHeight
      c.getContext('2d')?.drawImage(video, 0, 0)
      const blob = await new Promise<Blob | null>((resolve) =>
        c.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) {
        showFeedback('Failed to capture frame', false)
        return
      }
      const data = await api.analyzePhoto(blob)
      const q = data.quality
      if (q < MIN_QUALITY) {
        showFeedback(`Quality too low (${Math.round(q * 100)}%) — try better lighting`, false)
      } else {
        const idx = captures.length
        const label = idx < ANGLE_PROMPTS.length ? ANGLE_PROMPTS[idx].text : 'Extra'
        setCaptures((prev) => [...prev, { cropB64: data.crop_b64, quality: q, label }])
        showFeedback(`Captured ${captures.length + 1} / ${MAX_CAPTURES} \u2713`, true)
      }
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Capture failed', false)
    } finally {
      setBusyCapture(false)
    }
  }

  // ── Save ────────────────────────────────────────────────
  async function doSave() {
    if (!selected || captures.length < MIN_CAPTURES) return
    setBusySave(true)
    try {
      const r = await api.saveWebEnrollment(selected.name, captures.map((c) => c.cropB64))
      stopCamera()
      setSuccess({ saved: r.saved, embeddings: r.embeddings })
    } catch (e) {
      showFeedback('Save failed: ' + (e instanceof Error ? e.message : 'unknown'), false)
    } finally {
      setBusySave(false)
    }
  }

  function removeCapture(i: number) {
    setCaptures((prev) => prev.filter((_, idx) => idx !== i))
  }

  function reset() {
    setSuccess(null)
    setCaptures([])
    setSelected(null)
  }

  // ── Filtered seniors ────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return seniors
    return seniors.filter((s) =>
      s.name.toLowerCase().includes(q))
  }, [seniors, search])

  // ── Computed UI ─────────────────────────────────────────
  const promptIdx = Math.min(captures.length, ANGLE_PROMPTS.length - 1)
  const currentPrompt = ANGLE_PROMPTS[promptIdx]

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-text">Face Enrollment</h1>
            <p className="text-muted text-sm mt-0.5">Capture a senior&apos;s face using your device&apos;s camera</p>
          </div>

          {/* ── Step 1: Pick senior ─────────────────────────────── */}
          {!selected && (
            <div className="bg-panel border border-border rounded-xl p-5 space-y-4 max-w-[42rem]">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name..."
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                           placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                autoFocus
              />
              {loadError && (
                <p className="text-coral text-sm py-2 bg-coral-light px-3 rounded">
                  Failed to load members: {loadError}
                </p>
              )}
              <div className="text-xs text-muted">
                {loadingSeniors ? 'Loading...' : `${seniors.length} member(s) loaded, ${filtered.length} shown`}
              </div>
              <div className="max-h-[60vh] overflow-y-auto space-y-1">
                {loadingSeniors ? (
                  <p className="text-muted text-sm py-3">Loading seniors...</p>
                ) : filtered.length === 0 ? (
                  <p className="text-muted text-sm py-3">No seniors found</p>
                ) : (
                  filtered.map((s) => (
                    <button
                      key={s.senior_id ?? s.name}
                      onClick={() => setSelected(s)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border
                                 hover:bg-surface text-left transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary
                                      flex items-center justify-center font-semibold text-sm flex-shrink-0">
                        {initials(s.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text truncate">{s.name}</div>
                      </div>
                      <span className="text-muted">&rsaquo;</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Capture ─────────────────────────────────── */}
          {selected && !success && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setCaptures([]); setSelected(null) }}
                  className="px-3 py-1.5 bg-surface hover:bg-border text-text text-sm rounded-lg border border-border"
                >
                  &larr; Back
                </button>
                <div className="flex-1">
                  <div className="font-semibold text-text">{selected.name}</div>
                </div>
                {cameras.length > 1 && (
                  <select
                    value={activeDeviceId || ''}
                    onChange={(e) => { setActiveDeviceId(e.target.value); startCamera(e.target.value) }}
                    className="px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-text"
                  >
                    {cameras.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Camera with overlay */}
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-w-[48rem] border border-border">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />
                {/* Angle prompt chip */}
                {captures.length < MAX_CAPTURES && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/75 text-white text-sm px-3 py-1.5 rounded-full flex items-center gap-2">
                    <span className="text-base">{currentPrompt.icon}</span>
                    <span>{currentPrompt.text}</span>
                  </div>
                )}
                {/* Feedback toast */}
                {feedback && (
                  <div
                    className={`absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                      feedback.ok ? 'bg-green/90 text-white' : 'bg-coral/90 text-white'
                    }`}
                  >
                    {feedback.msg}
                  </div>
                )}
              </div>

              {/* Progress + thumbnails */}
              <div className="bg-panel border border-border rounded-xl p-4 space-y-3 max-w-[48rem]">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {Array.from({ length: MAX_CAPTURES }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-2.5 h-2.5 rounded-full transition-colors ${
                          i < captures.length ? 'bg-primary' : 'bg-border'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="text-xs text-muted">
                    {captures.length} / {MAX_CAPTURES} &middot; min {MIN_CAPTURES} to save
                  </div>
                </div>

                {captures.length > 0 && (
                  <div className="grid grid-cols-6 gap-2">
                    {captures.map((c, i) => {
                      const qPct = Math.round(c.quality * 100)
                      const qColor = c.quality >= 0.85 ? 'text-green' : c.quality >= MIN_QUALITY ? 'text-orange' : 'text-coral'
                      return (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-surface">
                          <img
                            src={`data:image/jpeg;base64,${c.cropB64}`}
                            alt={c.label}
                            className="w-full h-full object-cover"
                          />
                          <div className={`absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] font-bold ${qColor}`}>
                            {qPct}%
                          </div>
                          <button
                            onClick={() => removeCapture(i)}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs hover:bg-coral"
                            title="Remove"
                          >
                            &times;
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={doCapture}
                    disabled={busyCapture || captures.length >= MAX_CAPTURES}
                    className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-lg
                               transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyCapture ? 'Processing...' : `\u{1F4F7} Capture${captures.length >= MAX_CAPTURES ? ' (max reached)' : ''}`}
                  </button>
                  <button
                    onClick={doSave}
                    disabled={busySave || captures.length < MIN_CAPTURES}
                    className="px-5 py-2.5 bg-green hover:bg-green/80 text-white text-sm font-semibold rounded-lg
                               transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busySave ? 'Saving...' : `\u{1F4BE} Save (${captures.length})`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Success ─────────────────────────────────── */}
          {success && (
            <div className="bg-panel border border-border rounded-xl p-8 max-w-[28rem] text-center space-y-3">
              <div className="text-5xl">&#10003;</div>
              <h2 className="text-xl font-bold text-text">Enrollment Saved</h2>
              <p className="text-text">{selected?.name}</p>
              <p className="text-muted text-sm">{success.saved} photo{success.saved !== 1 ? 's' : ''} enrolled</p>
              <p className="text-muted text-xs">{success.embeddings} total embeddings loaded</p>
              <button
                onClick={reset}
                className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-lg transition-colors mt-2"
              >
                Done
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (name[0] || '?').toUpperCase()
}
