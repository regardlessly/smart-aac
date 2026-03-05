import { memo } from 'react'
import Panel from '@/components/ui/Panel'
import { HEATMAP_COLORS } from '@/lib/constants'
import type { RoomHeatmap as RoomHeatmapType } from '@/lib/types'

interface Props {
  rooms: RoomHeatmapType[]
}

export default memo(function RoomHeatmap({ rooms }: Props) {
  return (
    <Panel
      title="Room Occupancy Heatmap"
      subtitle={`${rooms.filter(r => r.occupancy > 0).length} of ${rooms.length} rooms active`}
      action={
        <a href="/heatmap" className="text-xs text-teal hover:underline">
          Full View
        </a>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        {rooms.map((room) => {
          const colors = HEATMAP_COLORS[room.color_level]
          const pct = Math.round((room.occupancy / room.max_capacity) * 100)
          return (
            <div
              key={room.id}
              className={`${colors.bg} rounded-lg p-3 border border-border transition-all hover:shadow-sm`}
            >
              <div className="text-xs font-medium text-text truncate">{room.name}</div>
              <div className={`text-xl font-bold ${colors.text} mt-1`}>
                {room.occupancy}
                <span className="text-xs font-normal text-muted">/{room.max_capacity}</span>
              </div>
              {room.occupancy > 0 && (
                <div className="text-[10px] text-muted mt-0.5">
                  {room.identified > 0 && <span>{room.identified} known</span>}
                  {room.identified > 0 && room.strangers > 0 && <span> · </span>}
                  {room.strangers > 0 && <span>{room.strangers} unknown</span>}
                </div>
              )}
              {/* Mini progress bar */}
              <div className="mt-1.5 h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    room.color_level === 'high' ? 'bg-coral' :
                    room.color_level === 'medium' ? 'bg-amber' :
                    room.color_level === 'low' ? 'bg-green' : 'bg-gray-300'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-muted mt-1">{pct}% capacity</div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
        {(['empty', 'low', 'medium', 'high'] as const).map((level) => (
          <div key={level} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${HEATMAP_COLORS[level].bg} border border-border`} />
            <span className="text-[10px] text-muted">{HEATMAP_COLORS[level].label}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
})
