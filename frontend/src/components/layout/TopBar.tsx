'use client'

import { useEffect, useState } from 'react'
import { getUser, logout } from '@/lib/auth'
import type { User } from '@/lib/types'

interface TopBarProps {
  connected: boolean
  alertCount?: number
}

export default function TopBar({ connected, alertCount = 0 }: TopBarProps) {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    setUser(getUser())
  }, [])

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit',
  })

  const initial = user?.name?.charAt(0)?.toUpperCase() || '?'

  return (
    <header className="h-14 bg-panel border-b border-border flex items-center justify-between px-6 sticky top-0 z-20">
      {/* Left: Title + live indicator */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text">Smart AAC Dashboard</h1>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green animate-pulse-dot' : 'bg-gray-300'
          }`} />
          <span className="text-xs text-muted">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Right: Date, alerts, user, logout */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-text-secondary hidden sm:block">
          {dateStr} &middot; {timeStr}
        </span>

        {/* Alert bell */}
        <button className="relative p-2 hover:bg-surface rounded-lg transition-colors">
          <span className="text-lg">🔔</span>
          {alertCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-coral text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </button>

        {/* User info */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal rounded-full flex items-center justify-center text-white text-sm font-medium">
            {initial}
          </div>
          {user && (
            <span className="text-sm text-text hidden md:block">{user.name}</span>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          title="Sign out"
          className="p-2 hover:bg-surface rounded-lg transition-colors text-muted hover:text-coral"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  )
}
