import { memo } from 'react'
import Panel from '@/components/ui/Panel'
import { LOCKER_COLORS } from '@/lib/constants'
import type { Locker } from '@/lib/types'

interface Props {
  lockers: Locker[]
}

export default memo(function LockerStatus({ lockers }: Props) {
  const available = lockers.filter(l => l.status === 'available').length
  const inUse = lockers.filter(l => l.status === 'in_use').length

  return (
    <Panel
      title="Smart Lockers"
      subtitle={`${available} available, ${inUse} in use`}
      action={
        <a href="/lockers" className="text-xs text-teal hover:underline">
          Manage
        </a>
      }
    >
      <div className="grid grid-cols-5 gap-2">
        {lockers.map((locker) => {
          const colors = LOCKER_COLORS[locker.status]
          return (
            <div
              key={locker.id}
              className={`${colors.bg} border ${colors.border} rounded-lg p-2 text-center transition-all hover:shadow-sm`}
              title={locker.equipment_description || locker.status}
            >
              <div className="text-xs font-bold text-text">{locker.locker_number}</div>
              <div className="text-[10px] text-muted mt-0.5 capitalize">
                {locker.status.replace('_', ' ')}
              </div>
              {locker.assigned_to_name && (
                <div className="text-[9px] text-text-secondary mt-0.5 truncate">
                  {locker.assigned_to_name}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
        {(['available', 'in_use', 'reserved'] as const).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${LOCKER_COLORS[status].bg} border ${LOCKER_COLORS[status].border}`} />
            <span className="text-[10px] text-muted capitalize">{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
})
