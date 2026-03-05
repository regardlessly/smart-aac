import { memo } from 'react'
import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import { STATUS_COLORS } from '@/lib/constants'
import type { AacActivity } from '@/lib/types'

interface Props {
  activities: AacActivity[]
}

function getStatusKey(status?: string): 'done' | 'active' | 'upcoming' {
  const s = (String(status ?? '')).toLowerCase()
  if (s === 'done' || s === 'completed' || s === 'ended') return 'done'
  if (s === 'active' || s === 'ongoing' || s === 'in_progress' || s === 'started') return 'active'
  return 'upcoming'
}

function getVenue(act: AacActivity): string {
  // Try today's slot venue first
  const slots = act.slot_ids
  if (slots && slots.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const todaySlot = slots.find(s => s.date === today)
    if (todaySlot?.venue) return String(todaySlot.venue)
  }
  // Fall back to venue_ids
  const venues = act.venue_ids
  if (!venues) return ''
  const named = venues.filter(v => v.name)
  return named.length > 0 ? String(named[0].name) : ''
}

export default memo(function ActivitiesPanel({ activities }: Props) {
  return (
    <Panel
      title="Today's Activities"
      subtitle={`${activities.length} scheduled`}
      action={
        <a href="/activities" className="text-xs text-teal hover:underline">
          View All
        </a>
      }
    >
      <div className="space-y-2 max-h-[250px] overflow-y-auto">
        {activities.map((act, index) => {
          const statusKey = getStatusKey(act.status ?? act.state)
          const colors = STATUS_COLORS[statusKey]
          const name = String(act.name ?? `Activity ${index + 1}`)
          const fromTime = String(act.from_time ?? '')
          const toTime = String(act.to_time ?? '')
          const venue = getVenue(act)

          return (
            <div
              key={act.id ?? index}
              className={`flex items-center gap-3 p-3 rounded-lg border border-border ${
                statusKey === 'active' ? 'bg-green-light/30' : 'bg-surface'
              }`}
            >
              <div className="text-center shrink-0 w-14">
                <div className="text-xs font-medium text-text">
                  {fromTime || '—'}
                </div>
                <div className="text-[10px] text-muted">
                  {toTime || '—'}
                </div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-text truncate">{name}</div>
                <div className="text-xs text-muted">{venue}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge bg={colors.bg} text={colors.text}>
                  {statusKey === 'done' ? 'Done' :
                   statusKey === 'active' ? 'In Progress' : 'Upcoming'}
                </Badge>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
})
