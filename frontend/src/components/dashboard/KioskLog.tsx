import { memo } from 'react'
import Panel from '@/components/ui/Panel'
import type { KioskEvent } from '@/lib/types'

interface Props {
  events: KioskEvent[]
}

const EVENT_ICONS: Record<string, string> = {
  check_in: '📋',
  locker_open: '🔓',
  activity_register: '📝',
}

const EVENT_LABELS: Record<string, string> = {
  check_in: 'Checked in',
  locker_open: 'Opened locker',
  activity_register: 'Registered for',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit',
  })
}

export default memo(function KioskLog({ events }: Props) {
  return (
    <Panel
      title="Kiosk Activity Log"
      subtitle={`${events.length} events today`}
      action={
        <a href="/kiosk" className="text-xs text-teal hover:underline">
          Full Log
        </a>
      }
    >
      <div className="space-y-1 max-h-[250px] overflow-y-auto">
        {events.map((evt) => (
          <div
            key={evt.id}
            className="flex items-center gap-3 py-2 px-1 border-b border-border last:border-0"
          >
            <span className="text-sm shrink-0">{EVENT_ICONS[evt.event_type] || '•'}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-text">{evt.senior_name}</span>
              <span className="text-sm text-muted ml-1">
                {EVENT_LABELS[evt.event_type] || evt.event_type}
                {evt.activity_name && ` "${evt.activity_name}"`}
                {evt.locker_number && ` ${evt.locker_number}`}
              </span>
            </div>
            <span className="text-xs text-muted shrink-0 font-mono">{formatTime(evt.timestamp)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
})
