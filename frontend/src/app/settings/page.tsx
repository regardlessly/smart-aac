'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { Camera, Room } from '@/lib/types'

interface CameraForm {
  name: string
  rtsp_url: string
  room_id: number | null
  enabled: boolean
}

interface RoomForm {
  name: string
  max_capacity: number
  moderate_threshold: number | null
}

const emptyCameraForm: CameraForm = { name: '', rtsp_url: '', room_id: null, enabled: true }
const emptyRoomForm: RoomForm = { name: '', max_capacity: 20, moderate_threshold: null }

export default function SettingsPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
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

  // System settings state
  const [sysSettings, setSysSettings] = useState<Record<string, number>>({})
  const [sysForm, setSysForm] = useState<Record<string, number>>({})
  const [savingSys, setSavingSys] = useState(false)
  const [sysEditing, setSysEditing] = useState(false)

  // Alert config state
  const [alertUnidentified, setAlertUnidentified] = useState(true)
  const [savingAlert, setSavingAlert] = useState(false)

  // Sync config state
  const [syncMode, setSyncMode] = useState<'all' | 'selected'>('all')
  const [syncSelectedIds, setSyncSelectedIds] = useState('')
  const [savingSync, setSavingSync] = useState(false)

  // Odoo config state
  const [odooUrl, setOdooUrl] = useState('')
  const [odooDb, setOdooDb] = useState('')
  const [odooCentre, setOdooCentre] = useState('')
  const [savingOdoo, setSavingOdoo] = useState(false)

  // Known faces / embeddings state
  const [knownFaces, setKnownFaces] = useState<{ name: string; image_count: number; embedding_count: number }[]>([])

  // Clear data state
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)

  // Message state
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [cams, rms, settings] = await Promise.all([
        api.camerasAdmin(),
        api.rooms(),
        api.getSettings(),
      ])
      setCameras(cams)
      setRooms(rms)
      setSysSettings(settings)
      setSysForm(settings)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch known faces / embedding stats (auto-refresh hourly)
  const fetchKnownFaces = useCallback(async () => {
    try {
      const data = await api.knownFaces()
      setKnownFaces(data as { name: string; image_count: number; embedding_count: number }[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchKnownFaces()
    const interval = setInterval(fetchKnownFaces, 60 * 60 * 1000) // every hour
    return () => clearInterval(interval)
  }, [fetchKnownFaces])

  useEffect(() => {
    api.getAlertConfig().then(cfg => {
      setAlertUnidentified(cfg.alert_unidentified)
    }).catch(() => {})
    api.getSyncConfig().then(cfg => {
      setSyncMode(cfg.sync_mode as 'all' | 'selected')
      setSyncSelectedIds(cfg.sync_selected_ids)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.getOdooConfig().then(cfg => {
      setOdooUrl(cfg.odoo_base_url)
      setOdooDb(cfg.odoo_db_name)
      setOdooCentre(cfg.odoo_centre_id)
    }).catch(() => {})
  }, [])

  const { connected } = useSSE()

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  // ── Alert Config ─────────────────────────────────────────

  const handleToggleAlertUnidentified = async () => {
    const newVal = !alertUnidentified
    setAlertUnidentified(newVal)
    setSavingAlert(true)
    try {
      await api.updateAlertConfig({ alert_unidentified: newVal })
      showMessage(
        newVal ? 'Unidentified person alerts enabled.' : 'Unidentified person alerts disabled.',
        'success',
      )
    } catch (e) {
      setAlertUnidentified(!newVal) // revert
      showMessage(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSavingAlert(false)
    }
  }

  // ── Sync Config ──────────────────────────────────────────

  const handleSaveSync = async () => {
    setSavingSync(true)
    try {
      await api.updateSyncConfig({
        sync_mode: syncMode,
        sync_selected_ids: syncSelectedIds,
      })
      showMessage('Sync settings saved.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSavingSync(false)
    }
  }

  // ── Odoo Config ──────────────────────────────────────────

  const handleSaveOdoo = async () => {
    setSavingOdoo(true)
    try {
      await api.updateOdooConfig({
        odoo_base_url: odooUrl,
        odoo_db_name: odooDb,
        odoo_centre_id: odooCentre,
      })
      showMessage('Odoo connection settings saved.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSavingOdoo(false)
    }
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
    setEditRoomForm({ name: room.name, max_capacity: room.max_capacity, moderate_threshold: room.moderate_threshold })
    setShowAddRoomForm(false)
  }

  // ── Clear Data ──────────────────────────────────────────

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

  // ── System Settings ────────────────────────────────────
  const handleSaveSettings = async () => {
    setSavingSys(true)
    try {
      const changed: Record<string, number> = {}
      for (const key of Object.keys(sysForm)) {
        if (sysForm[key] !== sysSettings[key]) {
          changed[key] = sysForm[key]
        }
      }
      if (Object.keys(changed).length === 0) {
        setSysEditing(false)
        return
      }
      await api.updateSettings(changed)
      setSysSettings({ ...sysSettings, ...changed })
      setSysEditing(false)
      showMessage('Settings saved. Restart backend to apply capture interval changes.', 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to save settings', 'error')
    } finally {
      setSavingSys(false)
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
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-text">Settings</h1>
            <p className="text-muted text-sm mt-0.5">
              Configure rooms and CCTV cameras
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

          {/* ── Alert Settings ─────────────────────────── */}
          <Panel
            title="Alert Settings"
            subtitle="Configure when alerts are triggered"
          >
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text">Unidentified Person Alerts</div>
                  <div className="text-xs text-muted mt-0.5">
                    Create a warning alert when the camera detects someone not in the known faces database
                  </div>
                </div>
                <button
                  onClick={handleToggleAlertUnidentified}
                  disabled={savingAlert}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    alertUnidentified ? 'bg-teal' : 'bg-gray-300 dark:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    alertUnidentified ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
          </Panel>

          {/* ── Face Recognition Stats ──────────────────── */}
          <Panel
            title="Face Recognition"
            subtitle={`${knownFaces.length} member${knownFaces.length !== 1 ? 's' : ''} enrolled`}
            action={
              <button
                onClick={fetchKnownFaces}
                className="text-xs text-teal hover:underline"
              >
                Refresh
              </button>
            }
          >
            {knownFaces.length === 0 ? (
              <div className="p-4 text-sm text-muted">
                No known faces enrolled. Sync from Odoo to download member photos.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-4 py-2 font-medium">Member</th>
                      <th className="px-4 py-2 font-medium text-center">Embeddings</th>
                      <th className="px-4 py-2 font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knownFaces.map((face) => (
                      <tr key={face.name} className="border-b border-border/50 hover:bg-surface/50">
                        <td className="px-4 py-2.5 text-text font-medium">
                          {face.name.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-2.5 text-center text-muted">
                          {face.embedding_count}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {face.embedding_count >= 5 ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green/10 text-green">Strong</span>
                          ) : face.embedding_count >= 2 ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600">Learning</span>
                          ) : face.embedding_count >= 1 ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">Basic</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500">No face</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-muted">
                  Auto-refreshes every hour. Embeddings increase as the camera captures more angles.
                </div>
              </div>
            )}
          </Panel>

          {/* ── Sync Filter ────────────────────────────── */}
          <Panel
            title="Member Sync Filter"
            subtitle="Control which members are synced from Odoo"
          >
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="syncMode"
                    checked={syncMode === 'all'}
                    onChange={() => setSyncMode('all')}
                    className="accent-teal"
                  />
                  <span className="text-sm text-text">Sync all members</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="syncMode"
                    checked={syncMode === 'selected'}
                    onChange={() => setSyncMode('selected')}
                    className="accent-teal"
                  />
                  <span className="text-sm text-text">Selected members only</span>
                </label>
              </div>

              {syncMode === 'selected' && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Odoo Member IDs (comma-separated)
                  </label>
                  <textarea
                    value={syncSelectedIds}
                    onChange={(e) => setSyncSelectedIds(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                               placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal
                               font-mono"
                    placeholder="e.g. 261, 145, 302"
                  />
                  <p className="text-xs text-muted mt-1">
                    Enter the Odoo member IDs of seniors to include in the sync.
                    Only these members will have their profiles and face images downloaded.
                  </p>
                </div>
              )}

              <button
                onClick={handleSaveSync}
                disabled={savingSync}
                className="px-4 py-2 bg-teal hover:bg-teal-dark text-white text-sm font-medium rounded-lg
                           transition-colors disabled:opacity-50"
              >
                {savingSync ? 'Saving\u2026' : 'Save Sync Settings'}
              </button>
            </div>
          </Panel>

          {/* ── Odoo Connection ───────────────────────── */}
          <Panel
            title="Odoo Connection"
            subtitle="Backend server for authentication and activities"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-muted mb-1">Odoo Base URL</label>
                <input
                  type="url"
                  value={odooUrl}
                  onChange={(e) => setOdooUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="https://odoo.example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Database Name</label>
                <input
                  type="text"
                  value={odooDb}
                  onChange={(e) => setOdooDb(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="mydb"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Centre ID</label>
                <input
                  type="text"
                  value={odooCentre}
                  onChange={(e) => setOdooCentre(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="9"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  onClick={handleSaveOdoo}
                  disabled={savingOdoo}
                  className="px-4 py-2 bg-teal hover:bg-teal-dark text-white text-sm font-medium rounded-lg
                             transition-colors disabled:opacity-50"
                >
                  {savingOdoo ? 'Saving\u2026' : 'Save Connection'}
                </button>
              </div>
            </div>
          </Panel>

          {/* ── Room Configuration ──────────────────────── */}
          <Panel
            title="Room Configuration"
            subtitle={`${rooms.length} room${rooms.length !== 1 ? 's' : ''} configured`}
            action={
              !showAddRoomForm ? (
                <button
                  onClick={() => { setShowAddRoomForm(true); setEditingRoomId(null) }}
                  className="text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 font-medium"
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
                    <th className="pb-2 pr-4 font-semibold text-center">Moderate</th>
                    <th className="pb-2 pr-4 font-semibold">Cameras</th>
                    <th className="pb-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Add room form row */}
                  {showAddRoomForm && (
                    <tr className="border-b border-border bg-primary/5">
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addRoomForm.name}
                          onChange={e => setAddRoomForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Room name"
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={addRoomForm.max_capacity}
                          onChange={e => setAddRoomForm(f => ({ ...f, max_capacity: parseInt(e.target.value) || 0 }))}
                          min={1}
                          className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text text-center focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={addRoomForm.moderate_threshold ?? ''}
                          onChange={e => setAddRoomForm(f => ({ ...f, moderate_threshold: e.target.value ? parseInt(e.target.value) : null }))}
                          min={1}
                          placeholder="Auto"
                          className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text text-center focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="py-2 pr-3 text-muted text-xs">—</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={handleAddRoom}
                            disabled={savingRoom || !addRoomForm.name.trim()}
                            className="px-3 py-1 bg-primary text-white text-xs rounded-md hover:bg-primary/90 disabled:opacity-50"
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
                      <tr key={room.id} className="border-b border-border bg-primary/5">
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editRoomForm.name}
                            onChange={e => setEditRoomForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            value={editRoomForm.max_capacity}
                            onChange={e => setEditRoomForm(f => ({ ...f, max_capacity: parseInt(e.target.value) || 0 }))}
                            min={1}
                            className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text text-center focus:outline-none focus:border-primary"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            value={editRoomForm.moderate_threshold ?? ''}
                            onChange={e => setEditRoomForm(f => ({ ...f, moderate_threshold: e.target.value ? parseInt(e.target.value) : null }))}
                            min={1}
                            placeholder="Auto"
                            className="w-20 mx-auto block px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text text-center focus:outline-none focus:border-primary"
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
                              className="px-3 py-1 bg-primary text-white text-xs rounded-md hover:bg-primary/90 disabled:opacity-50"
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
                        <td className="py-3 pr-4 text-center text-muted">
                          {room.moderate_threshold ?? <span className="text-xs italic">Auto</span>}
                        </td>
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
                                className="px-2 py-1 text-primary text-xs hover:underline"
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
                      <td colSpan={5} className="py-8 text-center text-muted text-sm">
                        No rooms configured.{' '}
                        <button
                          onClick={() => setShowAddRoomForm(true)}
                          className="text-primary hover:underline"
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

          {/* ── Face Recognition Settings ──────────────── */}
          <Panel
            title="Face Recognition"
            subtitle="Camera capture and analysis settings"
            action={
              !sysEditing ? (
                <button
                  onClick={() => { setSysEditing(true); setSysForm({ ...sysSettings }) }}
                  className="text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 font-medium"
                >
                  Edit
                </button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-6">
              {/* Capture Interval */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                  Capture Interval
                </label>
                {sysEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={sysForm.FR_CAPTURE_INTERVAL ?? 5}
                      onChange={e => setSysForm(f => ({ ...f, FR_CAPTURE_INTERVAL: parseInt(e.target.value) || 1 }))}
                      min={1}
                      max={300}
                      className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-muted">seconds</span>
                  </div>
                ) : (
                  <p className="text-sm text-text">{sysSettings.FR_CAPTURE_INTERVAL ?? 5} seconds</p>
                )}
                <p className="text-xs text-muted mt-1">How often each camera captures a frame</p>
              </div>

              {/* Analyse Every */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                  Analyse Every
                </label>
                {sysEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={sysForm.FR_ANALYSE_EVERY ?? 1}
                      onChange={e => setSysForm(f => ({ ...f, FR_ANALYSE_EVERY: parseInt(e.target.value) || 1 }))}
                      min={1}
                      max={20}
                      className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-muted">captures</span>
                  </div>
                ) : (
                  <p className="text-sm text-text">{sysSettings.FR_ANALYSE_EVERY ?? 1} capture{(sysSettings.FR_ANALYSE_EVERY ?? 1) !== 1 ? 's' : ''}</p>
                )}
                <p className="text-xs text-muted mt-1">Run face recognition every N captures</p>
              </div>

              {/* CCTV Start Hour */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                  CCTV Start Hour
                </label>
                {sysEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={sysForm.CCTV_START_HOUR ?? 7}
                      onChange={e => setSysForm(f => ({ ...f, CCTV_START_HOUR: parseInt(e.target.value) || 0 }))}
                      min={0}
                      max={23}
                      className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-muted">:00</span>
                  </div>
                ) : (
                  <p className="text-sm text-text">{(sysSettings.CCTV_START_HOUR ?? 7).toString().padStart(2, '0')}:00</p>
                )}
                <p className="text-xs text-muted mt-1">Cameras active from this hour</p>
              </div>

              {/* CCTV End Hour */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                  CCTV End Hour
                </label>
                {sysEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={sysForm.CCTV_END_HOUR ?? 22}
                      onChange={e => setSysForm(f => ({ ...f, CCTV_END_HOUR: parseInt(e.target.value) || 0 }))}
                      min={0}
                      max={23}
                      className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-muted">:00</span>
                  </div>
                ) : (
                  <p className="text-sm text-text">{(sysSettings.CCTV_END_HOUR ?? 22).toString().padStart(2, '0')}:00</p>
                )}
                <p className="text-xs text-muted mt-1">Cameras stop at this hour</p>
              </div>
            </div>

            {/* Effective rate summary */}
            <div className="mt-4 px-3 py-2 bg-surface rounded-lg">
              <p className="text-xs text-muted">
                <strong>Effective rate:</strong>{' '}
                Face recognition runs every{' '}
                <span className="text-text font-medium">
                  {(sysEditing ? sysForm : sysSettings).FR_CAPTURE_INTERVAL * (sysEditing ? sysForm : sysSettings).FR_ANALYSE_EVERY}s
                </span>
                {' '}per camera ({(sysEditing ? sysForm : sysSettings).FR_CAPTURE_INTERVAL}s capture &times; {(sysEditing ? sysForm : sysSettings).FR_ANALYSE_EVERY} captures)
              </p>
            </div>

            {sysEditing && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSys}
                  className="px-4 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50 font-medium"
                >
                  {savingSys ? 'Saving...' : 'Save Settings'}
                </button>
                <button
                  onClick={() => { setSysEditing(false); setSysForm({ ...sysSettings }) }}
                  className="px-4 py-1.5 text-muted text-sm hover:text-text"
                >
                  Cancel
                </button>
                <span className="text-xs text-amber ml-auto">
                  Changes require backend restart
                </span>
              </div>
            )}
          </Panel>

          {/* ── Camera Configuration ─────────────────── */}
          <Panel
            title="Camera Configuration"
            subtitle={`${cameras.length} camera${cameras.length !== 1 ? 's' : ''} configured`}
            action={
              !showAddForm ? (
                <button
                  onClick={() => { setShowAddForm(true); setEditingId(null) }}
                  className="text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 font-medium"
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
                    <tr className="border-b border-border bg-primary/5">
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addForm.name}
                          onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Camera name"
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={addForm.rtsp_url}
                          onChange={e => setAddForm(f => ({ ...f, rtsp_url: e.target.value }))}
                          placeholder="rtsp://..."
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          value={addForm.room_id ?? ''}
                          onChange={e => setAddForm(f => ({ ...f, room_id: e.target.value ? parseInt(e.target.value) : null }))}
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
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
                            addForm.enabled ? 'bg-teal' : 'bg-gray-300 dark:bg-gray-600'
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
                            className="px-3 py-1 bg-primary text-white text-xs rounded-md hover:bg-primary/90 disabled:opacity-50"
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
                      <tr key={cam.id} className="border-b border-border bg-primary/5">
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={editForm.rtsp_url}
                            onChange={e => setEditForm(f => ({ ...f, rtsp_url: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary font-mono text-xs"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={editForm.room_id ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, room_id: e.target.value ? parseInt(e.target.value) : null }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-panel text-text focus:outline-none focus:border-primary"
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
                              editForm.enabled ? 'bg-teal' : 'bg-gray-300 dark:bg-gray-600'
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
                              className="px-3 py-1 bg-primary text-white text-xs rounded-md hover:bg-primary/90 disabled:opacity-50"
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
                                className="text-xs text-primary hover:underline flex-shrink-0"
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
                              cam.enabled ? 'bg-teal' : 'bg-gray-300 dark:bg-gray-600'
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
                                className="px-2 py-1 text-primary text-xs hover:underline"
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
                          className="text-primary hover:underline"
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

          {/* ── Data Management ──────────────────────── */}
          <Panel
            title="Data Management"
            subtitle="Clear CCTV snapshots and face recognition data"
          >
            <div className="flex items-center gap-3">
              {!clearConfirm ? (
                <button
                  onClick={() => setClearConfirm(true)}
                  disabled={clearing}
                  className="text-xs px-3 py-1.5 bg-coral text-white rounded-lg hover:bg-coral/90 font-medium disabled:opacity-50"
                >
                  Clear All CCTV Data
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-coral font-medium">
                    This will delete all snapshots and face data. Continue?
                  </span>
                  <button
                    onClick={handleClearData}
                    disabled={clearing}
                    className="text-xs px-3 py-1 bg-coral text-white rounded-md hover:bg-coral/90 disabled:opacity-50"
                  >
                    {clearing ? 'Clearing...' : 'Yes, Clear'}
                  </button>
                  <button
                    onClick={() => setClearConfirm(false)}
                    className="text-xs px-3 py-1 text-muted hover:text-text"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted mt-2">
              Members can be managed from the{' '}
              <a href="/members" className="text-primary hover:underline">Members</a> page.
            </p>
          </Panel>
        </main>
      </div>
    </div>
  )
}
