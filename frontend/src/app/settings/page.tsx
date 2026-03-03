'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { Camera, Room } from '@/lib/types'

interface KnownFace {
  name: string
  image_count: number
}

interface CameraForm {
  name: string
  rtsp_url: string
  room_id: number | null
  enabled: boolean
}

interface RoomForm {
  name: string
  max_capacity: number
}

const emptyCameraForm: CameraForm = { name: '', rtsp_url: '', room_id: null, enabled: true }
const emptyRoomForm: RoomForm = { name: '', max_capacity: 20 }

export default function SettingsPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [knownFaces, setKnownFaces] = useState<KnownFace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Camera form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<CameraForm>(emptyCameraForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<CameraForm>(emptyCameraForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showUrls, setShowUrls] = useState<Set<number>>(new Set())

  // Room form state
  const [showAddRoomForm, setShowAddRoomForm] = useState(false)
  const [addRoomForm, setAddRoomForm] = useState<RoomForm>(emptyRoomForm)
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null)
  const [editRoomForm, setEditRoomForm] = useState<RoomForm>(emptyRoomForm)
  const [savingRoom, setSavingRoom] = useState(false)
  const [deleteRoomConfirm, setDeleteRoomConfirm] = useState<number | null>(null)

  // Member delete state
  const [faceDeleteConfirm, setFaceDeleteConfirm] = useState<string | null>(null)

  // Clear data + Sync from Odoo state
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{
    synced: number; skipped: number; total: number; name: string
  } | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number; errors: string[] } | null>(null)

  // Message state
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [cams, rms, faces] = await Promise.all([
        api.camerasAdmin(),
        api.rooms(),
        api.knownFaces(),
      ])
      setCameras(cams)
      setRooms(rms)
      setKnownFaces(faces)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // SSE handler for sync progress (ref avoids stale closures)
  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData

  const handleSSE = useCallback((event: import('@/lib/types').SSEEvent) => {
    if (event.type === 'sync_progress') {
      const e = event as Record<string, unknown>
      setSyncProgress({
        synced: (e.synced as number) || 0,
        skipped: (e.skipped as number) || 0,
        total: (e.total as number) || 0,
        name: (e.name as string) || '',
      })
    } else if (event.type === 'sync_complete') {
      const e = event as Record<string, unknown>
      setSyncing(false)
      setSyncProgress(null)
      setSyncResult({
        synced: (e.synced as number) || 0,
        skipped: (e.skipped as number) || 0,
        errors: (e.errors as string[]) || [],
      })
      fetchDataRef.current()
      setMessage({
        text: `Synced ${(e.synced as number) || 0} faces from Odoo (${(e.skipped as number) || 0} skipped)`,
        type: 'success',
      })
      setTimeout(() => setMessage(null), 4000)
    }
  }, [])

  const { connected } = useSSE(handleSSE)

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  // ── Camera CRUD ──────────────────────────────────────────

  const handleAddCamera = async () => {
    if (!addForm.name.trim()) return
    setSaving(true)
    try {
      await api.createCamera(addForm)
      setShowAddForm(false)
      setAddForm(emptyCameraForm)
      await fetchData()
      showMessage('Camera added. Restart backend to apply.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to add camera', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleEditCamera = async () => {
    if (editingId === null || !editForm.name.trim()) return
    setSaving(true)
    try {
      await api.updateCamera(editingId, editForm)
      setEditingId(null)
      await fetchData()
      showMessage('Camera updated. Restart backend to apply.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to update camera', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCamera = async (id: number) => {
    setSaving(true)
    try {
      await api.deleteCamera(id)
      setDeleteConfirm(null)
      await fetchData()
      showMessage('Camera deleted. Restart backend to apply.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to delete camera', 'error')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (cam: Camera) => {
    setEditingId(cam.id)
    setEditForm({
      name: cam.name,
      rtsp_url: cam.rtsp_url || '',
      room_id: cam.room_id,
      enabled: cam.enabled,
    })
    setShowAddForm(false)
  }

  const toggleUrl = (id: number) => {
    setShowUrls(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleEnabled = async (cam: Camera) => {
    try {
      await api.updateCamera(cam.id, { enabled: !cam.enabled })
      await fetchData()
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to update', 'error')
    }
  }

  // ── Room CRUD ──────────────────────────────────────────

  const handleAddRoom = async () => {
    if (!addRoomForm.name.trim()) return
    setSavingRoom(true)
    try {
      await api.createRoom(addRoomForm)
      setShowAddRoomForm(false)
      setAddRoomForm(emptyRoomForm)
      await fetchData()
      showMessage('Room added', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to add room', 'error')
    } finally {
      setSavingRoom(false)
    }
  }

  const handleEditRoom = async () => {
    if (editingRoomId === null || !editRoomForm.name.trim()) return
    setSavingRoom(true)
    try {
      await api.updateRoom(editingRoomId, editRoomForm)
      setEditingRoomId(null)
      await fetchData()
      showMessage('Room updated', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to update room', 'error')
    } finally {
      setSavingRoom(false)
    }
  }

  const handleDeleteRoom = async (id: number) => {
    setSavingRoom(true)
    try {
      await api.deleteRoom(id)
      setDeleteRoomConfirm(null)
      await fetchData()
      showMessage('Room deleted', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to delete room', 'error')
    } finally {
      setSavingRoom(false)
    }
  }

  const startEditRoom = (room: Room) => {
    setEditingRoomId(room.id)
    setEditRoomForm({ name: room.name, max_capacity: room.max_capacity })
    setShowAddRoomForm(false)
  }

  // ── Members (Known Faces) ───────────────────────────────

  const handleDeleteFace = async (name: string) => {
    try {
      await api.removeKnownFace(name)
      setFaceDeleteConfirm(null)
      await fetchData()
      showMessage(`Known face "${name}" removed`, 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to remove face', 'error')
    }
  }

  // ── Clear Data + Sync ───────────────────────────────────

  const handleClearData = async () => {
    setClearing(true)
    try {
      const result = await api.clearCctvData()
      setClearConfirm(false)
      await fetchData()
      showMessage(`Cleared ${result.cleared.snapshots} snapshots and all face data`, 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to clear data', 'error')
    } finally {
      setClearing(false)
    }
  }

  const handleSyncFromOdoo = async () => {
    setSyncing(true)
    setSyncResult(null)
    setSyncProgress(null)
    try {
      await api.syncKnownFacesFromOdoo()
      // Backend returns immediately; progress comes via SSE events
    } catch (e) {
      setSyncing(false)
      showMessage(e instanceof Error ? e.message : 'Failed to sync from Odoo', 'error')
    }
  }

  // Helper: count cameras linked to a room
  const camerasInRoom = (roomId: number) =>
    cameras.filter(c => c.room_id === roomId)

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 ml-60 overflow-y-auto">
          <TopBar connected={connected} />
          <main className="p-6 flex items-center justify-center h-[calc(100vh-3.5rem)]">
            <div className="text-muted">Loading settings...</div>
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
            <p className="text-coral font-semibold">Failed to load settings</p>
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
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-text">Settings</h1>
            <p className="text-muted text-sm mt-0.5">
              Configure rooms, CCTV cameras and members
            </p>
          </div>

          {/* Message toast */}
          {message && (
            <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
              message.type === 'success'
                ? 'bg-green/10 text-green border border-green/20'
                : 'bg-coral/10 text-coral border border-coral/20'
            }`}>
              {message.text}
            </div>
          )}

          {/* ── Room Configuration ──────────────────────── */}
          <Panel
            title="Room Configuration"
            subtitle={`${rooms.length} room${rooms.length !== 1 ? 's' : ''} configured`}
            action={
              !showAddRoomForm ? (
                <button
                  onClick={() => { setShowAddRoomForm(true); setEditingRoomId(null) }}
                  className="text-xs px-3 py-1.5 bg-teal text-white rounded-lg hover:bg-teal/90 font-medium"
                >
                  + Add Room
                </button>
              ) : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-4 font-semibold">Name</th>
                    <th className="pb-2 pr-4 font-semibold text-center">Capacity</th>
                    <th className="pb-2 pr-4 font-semibold">Cameras</th>
                    <th className="pb-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Add room form row */}
                  {showAddRoomForm && (
                    <tr className="border-b border-border bg-teal/5">
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addRoomForm.name}
                          onChange={e => setAddRoomForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Room name"
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={addRoomForm.max_capacity}
                          onChange={e => setAddRoomForm(f => ({ ...f, max_capacity: parseInt(e.target.value) || 0 }))}
                          min={1}
                          className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text text-center focus:outline-none focus:border-teal"
                        />
                      </td>
                      <td className="py-2 pr-3 text-muted text-xs">—</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={handleAddRoom}
                            disabled={savingRoom || !addRoomForm.name.trim()}
                            className="px-3 py-1 bg-teal text-white text-xs rounded-md hover:bg-teal/90 disabled:opacity-50"
                          >
                            {savingRoom ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setShowAddRoomForm(false); setAddRoomForm(emptyRoomForm) }}
                            className="px-3 py-1 text-muted text-xs hover:text-text"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Room rows */}
                  {rooms.map(room => (
                    editingRoomId === room.id ? (
                      /* Edit mode */
                      <tr key={room.id} className="border-b border-border bg-teal/5">
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editRoomForm.name}
                            onChange={e => setEditRoomForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            value={editRoomForm.max_capacity}
                            onChange={e => setEditRoomForm(f => ({ ...f, max_capacity: parseInt(e.target.value) || 0 }))}
                            min={1}
                            className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text text-center focus:outline-none focus:border-teal"
                          />
                        </td>
                        <td className="py-2 pr-3 text-muted text-xs">
                          {camerasInRoom(room.id).map(c => c.name).join(', ') || '—'}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={handleEditRoom}
                              disabled={savingRoom || !editRoomForm.name.trim()}
                              className="px-3 py-1 bg-teal text-white text-xs rounded-md hover:bg-teal/90 disabled:opacity-50"
                            >
                              {savingRoom ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingRoomId(null)}
                              className="px-3 py-1 text-muted text-xs hover:text-text"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      /* Display mode */
                      <tr key={room.id} className="border-b border-border hover:bg-surface transition-colors">
                        <td className="py-3 pr-4">
                          <span className="font-medium text-text">{room.name}</span>
                        </td>
                        <td className="py-3 pr-4 text-center text-muted">{room.max_capacity}</td>
                        <td className="py-3 pr-4 text-muted text-xs">
                          {camerasInRoom(room.id).map(c => c.name).join(', ') || '—'}
                        </td>
                        <td className="py-3 text-right">
                          {deleteRoomConfirm === room.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-coral">Delete?</span>
                              <button
                                onClick={() => handleDeleteRoom(room.id)}
                                disabled={savingRoom}
                                className="px-2 py-1 bg-coral text-white text-xs rounded-md hover:bg-coral/90 disabled:opacity-50"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeleteRoomConfirm(null)}
                                className="px-2 py-1 text-muted text-xs hover:text-text"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => startEditRoom(room)}
                                className="px-2 py-1 text-teal text-xs hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteRoomConfirm(room.id)}
                                className="px-2 py-1 text-coral text-xs hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ))}

                  {rooms.length === 0 && !showAddRoomForm && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted text-sm">
                        No rooms configured.{' '}
                        <button
                          onClick={() => setShowAddRoomForm(true)}
                          className="text-teal hover:underline"
                        >
                          Add one
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Camera Configuration ─────────────────── */}
          <Panel
            title="Camera Configuration"
            subtitle={`${cameras.length} camera${cameras.length !== 1 ? 's' : ''} configured`}
            action={
              !showAddForm ? (
                <button
                  onClick={() => { setShowAddForm(true); setEditingId(null) }}
                  className="text-xs px-3 py-1.5 bg-teal text-white rounded-lg hover:bg-teal/90 font-medium"
                >
                  + Add Camera
                </button>
              ) : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-4 font-semibold">Name</th>
                    <th className="pb-2 pr-4 font-semibold">RTSP URL</th>
                    <th className="pb-2 pr-4 font-semibold">Room</th>
                    <th className="pb-2 pr-4 font-semibold text-center">Enabled</th>
                    <th className="pb-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Add form row */}
                  {showAddForm && (
                    <tr className="border-b border-border bg-teal/5">
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addForm.name}
                          onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Camera name"
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addForm.rtsp_url}
                          onChange={e => setAddForm(f => ({ ...f, rtsp_url: e.target.value }))}
                          placeholder="rtsp://..."
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          value={addForm.room_id ?? ''}
                          onChange={e => setAddForm(f => ({ ...f, room_id: e.target.value ? parseInt(e.target.value) : null }))}
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                        >
                          <option value="">— No Room —</option>
                          {rooms.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <button
                          onClick={() => setAddForm(f => ({ ...f, enabled: !f.enabled }))}
                          className={`w-10 h-5 rounded-full relative transition-colors ${
                            addForm.enabled ? 'bg-teal' : 'bg-gray-300'
                          }`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                            addForm.enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={handleAddCamera}
                            disabled={saving || !addForm.name.trim()}
                            className="px-3 py-1 bg-teal text-white text-xs rounded-md hover:bg-teal/90 disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setShowAddForm(false); setAddForm(emptyCameraForm) }}
                            className="px-3 py-1 text-muted text-xs hover:text-text"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Camera rows */}
                  {cameras.map(cam => (
                    editingId === cam.id ? (
                      /* Edit mode */
                      <tr key={cam.id} className="border-b border-border bg-teal/5">
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editForm.rtsp_url}
                            onChange={e => setEditForm(f => ({ ...f, rtsp_url: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal font-mono text-xs"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={editForm.room_id ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, room_id: e.target.value ? parseInt(e.target.value) : null }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                          >
                            <option value="">— No Room —</option>
                            {rooms.map(r => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3 text-center">
                          <button
                            onClick={() => setEditForm(f => ({ ...f, enabled: !f.enabled }))}
                            className={`w-10 h-5 rounded-full relative transition-colors ${
                              editForm.enabled ? 'bg-teal' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                              editForm.enabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={handleEditCamera}
                              disabled={saving || !editForm.name.trim()}
                              className="px-3 py-1 bg-teal text-white text-xs rounded-md hover:bg-teal/90 disabled:opacity-50"
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1 text-muted text-xs hover:text-text"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      /* Display mode */
                      <tr key={cam.id} className="border-b border-border hover:bg-surface transition-colors">
                        <td className="py-3 pr-4">
                          <span className="font-medium text-text">{cam.name}</span>
                        </td>
                        <td className="py-3 pr-4">
                          {cam.rtsp_url ? (
                            <div className="flex items-center gap-2">
                              <code className="text-xs text-muted font-mono bg-surface px-2 py-0.5 rounded max-w-xs truncate">
                                {showUrls.has(cam.id) ? cam.rtsp_url : '••••••••••••'}
                              </code>
                              <button
                                onClick={() => toggleUrl(cam.id)}
                                className="text-xs text-teal hover:underline flex-shrink-0"
                              >
                                {showUrls.has(cam.id) ? 'Hide' : 'Show'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted italic">Not configured</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-muted">
                          {cam.room_name || '—'}
                        </td>
                        <td className="py-3 pr-4 text-center">
                          <button
                            onClick={() => handleToggleEnabled(cam)}
                            className={`w-10 h-5 rounded-full relative transition-colors ${
                              cam.enabled ? 'bg-teal' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                              cam.enabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </td>
                        <td className="py-3 text-right">
                          {deleteConfirm === cam.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-coral">Delete?</span>
                              <button
                                onClick={() => handleDeleteCamera(cam.id)}
                                disabled={saving}
                                className="px-2 py-1 bg-coral text-white text-xs rounded-md hover:bg-coral/90 disabled:opacity-50"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 text-muted text-xs hover:text-text"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => startEdit(cam)}
                                className="px-2 py-1 text-teal text-xs hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(cam.id)}
                                className="px-2 py-1 text-coral text-xs hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ))}

                  {cameras.length === 0 && !showAddForm && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted text-sm">
                        No cameras configured.{' '}
                        <button
                          onClick={() => setShowAddForm(true)}
                          className="text-teal hover:underline"
                        >
                          Add one
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 px-3 py-2 bg-amber/5 border border-amber/20 rounded-lg">
              <p className="text-xs text-amber">
                <strong>Note:</strong> Camera changes require a backend restart to take effect in the CCTV system.
              </p>
            </div>
          </Panel>

          {/* ── Members ──────────────────────────────── */}
          <Panel
            title="Members"
            subtitle={`${knownFaces.length} member${knownFaces.length !== 1 ? 's' : ''} registered`}
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncFromOdoo}
                  disabled={syncing || clearing}
                  className="text-xs px-3 py-1.5 bg-teal text-white rounded-lg hover:bg-teal/90 font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {syncing && (
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {syncing ? 'Syncing...' : 'Sync from Odoo'}
                </button>
                {!clearConfirm ? (
                  <button
                    onClick={() => setClearConfirm(true)}
                    disabled={syncing || clearing}
                    className="text-xs px-3 py-1.5 bg-coral text-white rounded-lg hover:bg-coral/90 font-medium disabled:opacity-50"
                  >
                    Clear All Data
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-coral font-medium">Delete all?</span>
                    <button
                      onClick={handleClearData}
                      disabled={clearing}
                      className="text-xs px-2 py-1 bg-coral text-white rounded-md hover:bg-coral/90 disabled:opacity-50"
                    >
                      {clearing ? 'Clearing...' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setClearConfirm(false)}
                      className="text-xs px-2 py-1 text-muted hover:text-text"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            }
          >
            {/* Sync progress bar */}
            {syncing && syncProgress && syncProgress.total > 0 && (
              <div className="mb-4 px-3 py-3 bg-teal/5 border border-teal/20 rounded-lg">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-teal font-medium">
                    Syncing members... {syncProgress.synced + syncProgress.skipped}/{syncProgress.total}
                  </span>
                  <span className="text-muted text-xs">
                    {syncProgress.synced} synced, {syncProgress.skipped} skipped
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-teal h-2 rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${Math.round(((syncProgress.synced + syncProgress.skipped) / syncProgress.total) * 100)}%`,
                    }}
                  />
                </div>
                {syncProgress.name && (
                  <div className="text-xs text-muted mt-1.5 truncate">
                    Last: {syncProgress.name}
                  </div>
                )}
              </div>
            )}

            {/* Syncing without progress yet */}
            {syncing && (!syncProgress || syncProgress.total === 0) && (
              <div className="mb-4 px-3 py-3 bg-teal/5 border border-teal/20 rounded-lg flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-teal" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-teal font-medium">Fetching members from Odoo...</span>
              </div>
            )}

            {/* Sync result */}
            {!syncing && syncResult && (
              <div className="mb-4 px-3 py-2 bg-teal/5 border border-teal/20 rounded-lg text-sm">
                <div className="flex items-center gap-4">
                  <span className="text-teal font-medium">{syncResult.synced} synced</span>
                  <span className="text-muted">{syncResult.skipped} skipped</span>
                  {syncResult.errors.length > 0 && (
                    <span className="text-coral">{syncResult.errors.length} error{syncResult.errors.length !== 1 ? 's' : ''}</span>
                  )}
                  <button onClick={() => setSyncResult(null)} className="ml-auto text-xs text-muted hover:text-text">Dismiss</button>
                </div>
                {syncResult.errors.length > 0 && (
                  <div className="mt-2 text-xs text-coral space-y-0.5">
                    {syncResult.errors.slice(0, 5).map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                    {syncResult.errors.length > 5 && (
                      <div className="text-muted">...and {syncResult.errors.length - 5} more</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Members table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-4 font-semibold w-8">#</th>
                    <th className="pb-2 pr-4 font-semibold">Name</th>
                    <th className="pb-2 pr-4 font-semibold text-center">Images</th>
                    <th className="pb-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {knownFaces.map((face, idx) => (
                    <tr key={face.name} className="border-b border-border hover:bg-surface transition-colors">
                      <td className="py-2.5 pr-4 text-muted text-xs">{idx + 1}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-navy-dark flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                            {face.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-text">{face.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-center text-muted">
                        {face.image_count}
                      </td>
                      <td className="py-2.5 text-right">
                        {faceDeleteConfirm === face.name ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-coral">Remove?</span>
                            <button
                              onClick={() => handleDeleteFace(face.name)}
                              className="px-2 py-1 bg-coral text-white text-xs rounded-md hover:bg-coral/90"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setFaceDeleteConfirm(null)}
                              className="px-2 py-1 text-muted text-xs hover:text-text"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setFaceDeleteConfirm(face.name)}
                            className="px-2 py-1 text-coral text-xs hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {knownFaces.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted text-sm">
                        No members registered. Click &quot;Sync from Odoo&quot; to import members.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </main>
      </div>
    </div>
  )
}
