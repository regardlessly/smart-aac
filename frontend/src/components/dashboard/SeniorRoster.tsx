import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import type { SeniorPresence } from '@/lib/types'

interface Props {
  presences: SeniorPresence[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SeniorRoster({ presences }: Props) {
  const identified = presences.filter(p => p.status === 'identified')
  const unidentified = presences.filter(p => p.status === 'unidentified')

  return (
    <Panel
      title="Senior Roster"
      subtitle={`${identified.length} identified, ${unidentified.length} unidentified`}
      action={
        <a href="/seniors" className="text-xs text-teal hover:underline">
          View All
        </a>
      }
    >
      <div className="overflow-y-auto max-h-[300px] -mx-4 -mb-4">
        <table className="w-full text-sm">
          <thead className="bg-surface sticky top-0">
            <tr className="text-left text-xs text-muted uppercase tracking-wide">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">NRIC</th>
              <th className="px-4 py-2 font-medium">Room</th>
              <th className="px-4 py-2 font-medium">Since</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {identified.map((p) => (
              <tr key={p.id} className="hover:bg-surface/50">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-teal/10 rounded-full flex items-center justify-center text-teal text-xs font-medium">
                      {p.senior_name?.charAt(0) || '?'}
                    </div>
                    <span className="font-medium text-text">{p.senior_name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-muted font-mono text-xs">
                  ****{presences.find(pr => pr.id === p.id)?.senior_id ? 'A' : ''}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{p.room_name || '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{formatTime(p.arrived_at)}</td>
                <td className="px-4 py-2.5">
                  <Badge bg="bg-green-light" text="text-green">Present</Badge>
                </td>
              </tr>
            ))}
            {unidentified.map((p) => (
              <tr key={p.id} className="hover:bg-surface/50 bg-coral-light/20">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-coral/10 rounded-full flex items-center justify-center text-coral text-xs font-medium">
                      ?
                    </div>
                    <span className="font-medium text-coral">Unidentified</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-muted">—</td>
                <td className="px-4 py-2.5 text-text-secondary">{p.room_name || '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{formatTime(p.arrived_at)}</td>
                <td className="px-4 py-2.5">
                  <Badge bg="bg-coral-light" text="text-coral">Unknown</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
