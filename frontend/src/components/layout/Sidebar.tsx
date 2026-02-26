'use client'

import NavItem from './NavItem'
import { NAV_SECTIONS } from '@/lib/constants'

interface SidebarProps {
  alertCount?: number
}

export default function Sidebar({ alertCount = 0 }: SidebarProps) {
  return (
    <aside className="w-60 bg-navy-dark h-screen flex flex-col fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal rounded-lg flex items-center justify-center text-white font-bold text-sm">
            C
          </div>
          <div>
            <div className="text-white font-semibold text-sm">CaritaHub</div>
            <div className="text-gray-400 text-xs">Smart AAC Module</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-3 mb-2">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem
                  key={item.href}
                  label={item.label}
                  href={item.href}
                  icon={item.icon}
                  badge={item.badge ? alertCount : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-gray-500 text-xs">
          Smart AAC v0.1
        </div>
        <div className="text-gray-600 text-xs mt-0.5">
          Satellite Centre Manager
        </div>
      </div>
    </aside>
  )
}
