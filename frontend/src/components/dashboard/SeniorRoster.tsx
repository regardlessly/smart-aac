import { memo, useMemo } from 'react'
import Link from 'next/link'
import Panel from '@/components/ui/Panel'
import type { RosterMember } from '@/lib/types'

interface Props {
  roster: RosterMember[]
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default memo(function SeniorRoster({ roster }: Props) {
  // Only show seniors detected today (those with last_seen)
  const todayRoster = useMemo(() =>
    roster.filter(m => m.last_seen),
  [roster])

  const { activeCount, inactiveCount } = useMemo(() => ({
    activeCount: todayRoster.filter(m => m.status === 'active').length,
    inactiveCount: todayRoster.filter(m => m.status === 'inactive').length,
  }), [todayRoster])

  return (
    <Panel
      title="Senior Roster"
      subtitle={`${todayRoster.length} attended today — ${activeCount} active, ${inactiveCount} departed`}
      action={
        <Link href="/members" className="text-xs text-primary hover:underline">
          View All
        </Link>
      }
    >
      <div className="overflow-y-auto max-h-[300px] -mx-4 -mb-4">
        <table className="w-full text-sm">
          <thead className="bg-surface sticky top-0">
            <tr className="text-left text-xs text-muted uppercase tracking-wide">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Last Seen</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {todayRoster.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted text-sm">
                  No seniors detected today
                </td>
              </tr>
            ) : null}
            {todayRoster.map((member) => (
              <tr
                key={member.name}
                className="hover:bg-surface/50 transition-colors"
              >
                <td className="px-4 py-2.5">
                  {member.senior_id ? (
                    <Link
                      href={`/members/${member.senior_id}`}
                      className="flex items-center gap-2 hover:text-primary transition-colors"
                    >
                      <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {member.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </span>
                      <span className="font-medium text-text hover:text-primary">
                        {member.name}
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {member.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </span>
                      <span className="font-medium text-text">{member.name}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {member.last_seen ? (
                    <span title={formatTime(member.last_seen)}>
                      {timeAgo(member.last_seen)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {member.location || '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      member.status === 'active'
                        ? 'bg-green-light text-green'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        member.status === 'active'
                          ? 'bg-green'
                          : 'bg-gray-400'
                      }`}
                    />
                    {member.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
})
