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
          <div className="w-14 h-14 bg-teal rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">C</span>
          </div>
          <h1 className="text-xl font-semibold text-text">Smart AAC Dashboard</h1>
          <p className="text-sm text-muted mt-1">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-panel rounded-xl border border-border p-6 space-y-4">
          {error && (
            <div className="bg-coral-light text-coral text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-text mb-1">
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
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                         placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text
                         placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-teal hover:bg-teal-dark text-white text-sm font-medium rounded-lg
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-muted mt-6">
          CaritaHub &middot; Smart Active Ageing Centre
        </p>
      </div>
    </div>
  )
}
