'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { login } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

        <p className="text-center text-xs text-muted mt-6">
          CaritaHub &middot; Smart Active Ageing Centre
        </p>
      </div>
    </div>
  )
}
