export const NAV_SECTIONS = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/', icon: 'grid' },
      { label: 'Members', href: '/members', icon: 'members' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'CCTV Feeds', href: '/cctv', icon: 'camera' },
      { label: 'Room Heatmap', href: '/heatmap', icon: 'map' },
      { label: 'Alerts & Events', href: '/alerts', icon: 'bell', badge: true },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Activities', href: '/activities', icon: 'calendar' },
      { label: 'Smart Lockers', href: '/lockers', icon: 'lock' },
      { label: 'Kiosk Status', href: '/kiosk', icon: 'tablet' },
      { label: 'Door Access', href: '/door-access', icon: 'door' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { label: 'KPI Analytics', href: '/analytics', icon: 'chart' },
      { label: 'Reports', href: '/reports', icon: 'report' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Settings', href: '/settings', icon: 'settings' },
    ],
  },
]

export const ALERT_COLORS = {
  critical: { bg: 'bg-coral-light', text: 'text-coral', dot: 'bg-coral' },
  warning: { bg: 'bg-orange-light', text: 'text-orange', dot: 'bg-orange' },
  info: { bg: 'bg-sky-light', text: 'text-sky', dot: 'bg-sky' },
} as const

export const HEATMAP_COLORS = {
  empty: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-400', label: 'Empty' },
  low: { bg: 'bg-green-light', text: 'text-green', label: 'Low' },
  medium: { bg: 'bg-amber-light', text: 'text-amber', label: 'Moderate' },
  high: { bg: 'bg-coral-light', text: 'text-coral', label: 'High' },
} as const

export const STATUS_COLORS = {
  done: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' },
  active: { bg: 'bg-green-light', text: 'text-green' },
  upcoming: { bg: 'bg-sky-light', text: 'text-sky' },
} as const

export const LOCKER_COLORS = {
  available: { bg: 'bg-green-light', border: 'border-green' },
  in_use: { bg: 'bg-sky-light', border: 'border-sky' },
  reserved: { bg: 'bg-orange-light', border: 'border-orange' },
} as const
