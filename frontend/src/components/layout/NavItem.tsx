'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItemProps {
  label: string
  href: string
  icon: string
  badge?: number
}

const ICONS: Record<string, string> = {
  grid: '⊞',
  users: '👥',
  camera: '📹',
  map: '🗺',
  bell: '🔔',
  calendar: '📅',
  lock: '🔒',
  tablet: '📱',
  door: '🚪',
  chart: '📊',
  report: '📋',
  members: '🧑‍🤝‍🧑',
  settings: '⚙️',
  logs: '🖥',
}

export default function NavItem({ label, href, icon, badge }: NavItemProps) {
  const pathname = usePathname()
  const active = pathname === href

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] transition-colors ${
        active
          ? 'bg-primary-light text-primary font-semibold'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className="text-base w-5 text-center">{ICONS[icon] || '•'}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-coral text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {badge}
        </span>
      )}
    </Link>
  )
}
