import { memo } from 'react'
import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import { ALERT_COLORS } from '@/lib/constants'
import type { Alert } from '@/lib/types'

interface Props {
  alerts: Alert[]
  onAcknowledge?: (id: number) => void
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

export default memo(function AlertConsole({ alerts, onAcknowledge }: Props) {
  const active = alerts.filter(a => !a.acknowledged)

  return (
    <Panel
      title="Alert Console"
      subtitle={`${active.length} active alert${active.length !== 1 ? 's' : ''}`}
      action={
        <a href="/alerts" className="text-xs text-teal hover:underline">
          View All
        </a>
      }
    >
      <div className="space-y-2 max-h-[250px] overflow-y-auto">
        {active.length === 0 ? (
          <div className="text-center text-muted text-sm py-6">No active alerts</div>
        ) : (
          active.map((alert) => {
            const colors = ALERT_COLORS[alert.type]
            return (
              <div
                key={alert.id}
                className={`${colors.bg} rounded-lg p-3 border-l-4 ${
                  alert.type === 'critical' ? 'border-l-coral' :
                  alert.type === 'warning' ? 'border-l-orange' : 'border-l-sky'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        bg={colors.bg}
                        text={colors.text}
                      >
                        {alert.type.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted">{timeAgo(alert.created_at)}</span>
                    </div>
                    <div className="font-medium text-sm text-text mt-1">{alert.title}</div>
                    <div className="text-xs text-text-secondary mt-0.5">{alert.description}</div>
                  </div>
                  {onAcknowledge && (
                    <button
                      onClick={() => onAcknowledge(alert.id)}
                      className="text-xs text-muted hover:text-text shrink-0 mt-1"
                      title="Acknowledge"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </Panel>
  )
})
