'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'
import type { Camera } from '@/lib/types'

interface KnownFace {
  name: string
  image_count: number
}

interface CameraForm {
  name: string
  rtsp_url: string
  location: string
  enabled: boolean
}

const emptyForm: CameraForm = { name: '', rtsp_url: '', location: '', enabled: true }

export default function SettingsPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [knownFaces, setKnownFaces] = useState<KnownFace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Camera form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<CameraForm>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<CameraForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showUrls, setShowUrls] = useState<Set<number>>(new Set())

  // Known face upload state
  const [faceName, setFaceName] = useState('')
  const [faceUploading, setFaceUploading] = useState(false)
  const [faceDeleteConfirm, setFaceDeleteConfirm] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Message state
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { connected } = useSSE()

  const fetchData = useCallback(async () => {
    try {
      const [cams, faces] = await Promise.all([
        api.camerasAdmin(),
        api.knownFaces(),
      ])
      setCameras(cams)
      setKnownFaces(faces)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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
      setAddForm(emptyForm)
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
      location: cam.location || '',
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

  // ── Known Faces ──────────────────────────────────────────

  const handleUploadFace = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!faceName.trim() || !file) return
    setFaceUploading(true)
    try {
      await api.addKnownFace(faceName.trim(), file)
      setFaceName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchData()
      showMessage(`Known face "${faceName.trim()}" added`, 'success')
    } catch (e) {
      showMessage(e instanceof Error ? e.message : 'Failed to upload face', 'error')
    } finally {
      setFaceUploading(false)
    }
  }

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
              Configure CCTV cameras and face recognition
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
                    <th className="pb-2 pr-4 font-semibold">Location</th>
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
                        <input
                          type="text"
                          value={addForm.location}
                          onChange={e => setAddForm(f => ({ ...f, location: e.target.value }))}
                          placeholder="e.g. Main Hall"
                          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                        />
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
                            onClick={() => { setShowAddForm(false); setAddForm(emptyForm) }}
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
                          <input
                            type="text"
                            value={editForm.location}
                            onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                          />
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
                          {cam.location || '—'}
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

          {/* ── Known Faces ──────────────────────────── */}
          <Panel
            title="Known Faces"
            subtitle={`${knownFaces.length} person${knownFaces.length !== 1 ? 's' : ''} registered`}
          >
            {/* Upload form */}
            <div className="flex items-end gap-3 mb-4 pb-4 border-b border-border">
              <div className="flex-1 max-w-[200px]">
                <label className="block text-xs font-medium text-muted mb-1">Person Name</label>
                <input
                  type="text"
                  value={faceName}
                  onChange={e => setFaceName(e.target.value)}
                  placeholder="e.g. John"
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-white text-text focus:outline-none focus:border-teal"
                />
              </div>
              <div className="flex-1 max-w-[280px]">
                <label className="block text-xs font-medium text-muted mb-1">Face Image</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-medium file:bg-surface file:text-text file:rounded-md hover:file:bg-gray-200"
                />
              </div>
              <button
                onClick={handleUploadFace}
                disabled={faceUploading || !faceName.trim()}
                className="px-4 py-1.5 bg-teal text-white text-sm rounded-lg hover:bg-teal/90 disabled:opacity-50 font-medium"
              >
                {faceUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            {/* Faces list */}
            {knownFaces.length === 0 ? (
              <div className="text-center py-6 text-muted text-sm">
                No known faces registered. Upload a face image above to get started.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {knownFaces.map(face => (
                  <div
                    key={face.name}
                    className="bg-surface rounded-lg p-3 flex flex-col items-center gap-2 group relative"
                  >
                    <div className="w-12 h-12 rounded-full bg-navy-dark flex items-center justify-center text-white font-bold text-lg">
                      {face.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-medium text-text truncate max-w-full">
                        {face.name}
                      </div>
                      <div className="text-xs text-muted">
                        {face.image_count} image{face.image_count !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {faceDeleteConfirm === face.name ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteFace(face.name)}
                          className="px-2 py-0.5 bg-coral text-white text-xs rounded hover:bg-coral/90"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => setFaceDeleteConfirm(null)}
                          className="px-2 py-0.5 text-muted text-xs hover:text-text"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setFaceDeleteConfirm(face.name)}
                        className="text-xs text-coral opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </main>
      </div>
    </div>
  )
}
