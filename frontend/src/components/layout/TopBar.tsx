'use client'

interface TopBarProps {
  connected: boolean
  alertCount?: number
}

export default function TopBar({ connected, alertCount = 0 }: TopBarProps) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit',
  })

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

      {/* Right: Date, alerts, avatar */}
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

        {/* Avatar */}
        <div className="w-8 h-8 bg-teal rounded-full flex items-center justify-center text-white text-sm font-medium">
          S
        </div>
      </div>
    </header>
  )
}
