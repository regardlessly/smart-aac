import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import { STATUS_COLORS } from '@/lib/constants'
import type { Activity } from '@/lib/types'

interface Props {
  activities: Activity[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ActivitiesPanel({ activities }: Props) {
  return (
    <Panel
      title="Today's Activities"
      subtitle={`${activities.length} scheduled`}
      action={
        <a href="/activities" className="text-xs text-teal hover:underline">
          Schedule
        </a>
      }
    >
      <div className="space-y-2 max-h-[250px] overflow-y-auto">
        {activities.map((act) => {
          const colors = STATUS_COLORS[act.status]
          return (
            <div
              key={act.id}
              className={`flex items-center gap-3 p-3 rounded-lg border border-border ${
                act.status === 'active' ? 'bg-green-light/30' : 'bg-surface'
              }`}
            >
              <div className="text-center shrink-0 w-14">
                <div className="text-xs font-medium text-text">
                  {formatTime(act.scheduled_time)}
                </div>
                <div className="text-[10px] text-muted">
                  {formatTime(act.end_time)}
                </div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-text truncate">{act.name}</div>
                <div className="text-xs text-muted">{act.room_name}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge bg={colors.bg} text={colors.text}>
                  {act.status === 'done' ? 'Done' :
                   act.status === 'active' ? 'In Progress' : 'Upcoming'}
                </Badge>
                {act.attendee_count > 0 && (
                  <span className="text-[10px] text-muted">{act.attendee_count} pax</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
