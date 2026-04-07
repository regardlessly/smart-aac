import { memo, useMemo } from 'react'
import Panel from '@/components/ui/Panel'
import type { Camera, CCTVSnapshot } from '@/lib/types'

interface Props {
  cameras: Camera[]
  snapshots: CCTVSnapshot[]
}

export default memo(function CCTVGrid({ cameras, snapshots }: Props) {
  const snapshotMap = useMemo(
    () => new Map(snapshots.map(s => [s.camera_id, s])),
    [snapshots]
  )

  return (
    <Panel
      title="CCTV Feeds"
      subtitle={`${cameras.filter(c => c.enabled).length} of ${cameras.length} cameras active`}
      action={
        <a href="/cctv" className="text-xs text-primary hover:underline">
          Full Screen
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {cameras.map((cam) => {
          const snap = snapshotMap.get(cam.id)
          return (
            <div key={cam.id} className="rounded-lg overflow-hidden border border-border bg-gray-900">
              {/* Feed area */}
              <div className="aspect-video relative bg-navy-dark flex items-center justify-center">
                {snap?.snapshot_b64 ? (
                  <img
                    src={`data:image/jpeg;base64,${snap.snapshot_b64}`}
                    alt={cam.name}
                    className="w-full h-full object-cover"
                    width={640}
                    height={360}
                    loading="lazy"
                  />
                ) : (
                  <div className="text-gray-600 text-sm">
                    {cam.enabled ? 'Awaiting capture...' : 'Offline'}
                  </div>
                )}
                {/* Camera label overlay */}
                <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded">
                  {cam.name}
                </div>
                {/* Status dot */}
                <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                  cam.enabled ? 'bg-green animate-pulse-dot' : 'bg-gray-500'
                }`} />
              </div>
              {/* Info bar */}
              {snap && (
                <div className="bg-navy-dark px-2 py-1.5 flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">{cam.room_name || cam.location}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-green">
                      {snap.identified_count} ID
                    </span>
                    {snap.unidentified_count > 0 && (
                      <span className="text-coral">
                        {snap.unidentified_count} UNK
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
})
