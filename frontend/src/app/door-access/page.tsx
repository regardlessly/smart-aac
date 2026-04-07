'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { useSSE } from '@/hooks/useSSE'

export default function DoorAccessPage() {
  const { connected } = useSSE()
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar connected={connected} />
        <main className="p-6">
          <h1 className="text-2xl font-bold text-text">Door Access</h1>
          <p className="text-muted mt-2">Full page view coming soon.</p>
        </main>
      </div>
    </div>
  )
}
