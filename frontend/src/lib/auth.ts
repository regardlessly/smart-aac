import type { User, LoginResponse } from './types'

const TOKEN_KEY = 'smart_aac_token'
const USER_KEY = 'smart_aac_user'
const COOKIE_NAME = 'auth-token'

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  // Set a cookie so Next.js middleware can read it (server-side)
  document.cookie = `${COOKIE_NAME}=${token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export function getUser(): User | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function setUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearUser(): void {
  localStorage.removeItem(USER_KEY)
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<LoginResponse> {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Login failed')
  }

  const data: LoginResponse = await res.json()
  setToken(data.token)
  setUser(data.user)
  return data
}

export function logout(): void {
  const token = getToken()
  if (token) {
    // Fire-and-forget logout request
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
    fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
  clearToken()
  clearUser()
  window.location.href = '/login'
}
