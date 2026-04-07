'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { login, getToken } from '@/lib/auth'
import { api } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Server settings
  const [showServer, setShowServer] = useState(false)
  const [odooUrl, setOdooUrl] = useState('')
  const [odooDb, setOdooDb] = useState('')
  const [odooCentre, setOdooCentre] = useState('')
  const [serverSaved, setServerSaved] = useState(false)
  const [serverLoading, setServerLoading] = useState(false)

  // Load current Odoo config
  useEffect(() => {
    api.getOdooConfig().then((cfg) => {
      setOdooUrl(cfg.odoo_base_url)
      setOdooDb(cfg.odoo_db_name)
      setOdooCentre(cfg.odoo_centre_id)
    }).catch(() => {})
  }, [])

  // Redirect to dashboard if already logged in
  useEffect(() => {
    if (getToken()) { router.push('/') }
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveServer() {
    setServerLoading(true)
    setServerSaved(false)
    try {
      // Save without auth — the endpoint allows unauthenticated PUT for initial setup
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${API_BASE}/api/config/odoo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odoo_base_url: odooUrl,
          odoo_db_name: odooDb,
          odoo_centre_id: odooCentre,
        }),
      })
      if (res.ok) {
        setServerSaved(true)
        setTimeout(() => setServerSaved(false), 3000)
      }
    } catch {
      // silent
    } finally {
      setServerLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-[14px] flex items-center justify-center mx-auto mb-4" style={{ boxShadow: '0 6px 24px rgba(61,114,232,0.13)' }}>
            <span className="text-white text-2xl font-bold">C</span>
          </div>
          <h1 className="text-[22px] font-bold text-text">Smart AAC Dashboard</h1>
          <p className="text-[13px] text-muted mt-1">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-panel rounded-[14px] border border-border p-6 space-y-4" style={{ boxShadow: '0 2px 14px rgba(61,114,232,0.08)' }}>
          {error && (
            <div className="bg-coral-light text-coral text-[14px] px-3 py-2 rounded-[8px]">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-[14px] font-semibold text-text mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              className="w-full px-3 py-2 bg-white border border-border rounded-[8px] text-[14px] text-text
                         placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[14px] font-semibold text-text mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-white border border-border rounded-[8px] text-[14px] text-text
                         placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white text-[14px] font-semibold rounded-[14px]
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Server Settings (collapsible) */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowServer(!showServer)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors mx-auto"
          >
            <span className={`transition-transform ${showServer ? 'rotate-90' : ''}`}>&#9654;</span>
            Server Settings
          </button>

          {showServer && (
            <div className="mt-3 bg-panel rounded-xl border border-border p-5 space-y-3">
              <div>
                <label htmlFor="odoo-url" className="block text-xs font-medium text-text mb-1">
                  Odoo Base URL
                </label>
                <input
                  id="odoo-url"
                  type="url"
                  value={odooUrl}
                  onChange={(e) => setOdooUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="https://odoo.example.com"
                />
              </div>

              <div>
                <label htmlFor="odoo-db" className="block text-xs font-medium text-text mb-1">
                  Database Name
                </label>
                <input
                  id="odoo-db"
                  type="text"
                  value={odooDb}
                  onChange={(e) => setOdooDb(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="mydb"
                />
              </div>

              <div>
                <label htmlFor="odoo-centre" className="block text-xs font-medium text-text mb-1">
                  Centre ID
                </label>
                <input
                  id="odoo-centre"
                  type="text"
                  value={odooCentre}
                  onChange={(e) => setOdooCentre(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                             placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                  placeholder="9"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveServer}
                disabled={serverLoading}
                className="w-full py-2 bg-surface hover:bg-border text-text text-sm font-medium rounded-lg
                           border border-border transition-colors disabled:opacity-50"
              >
                {serverSaved ? 'Saved!' : serverLoading ? 'Saving\u2026' : 'Save Server Settings'}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted mt-6">
          CaritaHub &middot; Smart Active Ageing Centre
        </p>
      </div>
    </div>
  )
}
