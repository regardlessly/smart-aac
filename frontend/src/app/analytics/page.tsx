'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'

export default function AnalyticsPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={false} />
        <main className="p-6">
          <h1 className="text-2xl font-bold text-text">KPI Analytics</h1>
          <p className="text-muted mt-2">Full page view coming soon.</p>
        </main>
      </div>
    </div>
  )
}
