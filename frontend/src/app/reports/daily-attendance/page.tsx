'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { api } from '@/lib/api'
import type { DailyAttendanceData } from '@/lib/types'

export default function DailyAttendancePage() {
  const [data, setData] = useState<DailyAttendanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.dailyAttendance({ date: selectedDate })
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { fetchData() }, [fetchData])

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-SG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  }

  return (
    <div className="flex h-screen" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto" style={{ backgroundColor: '#fff' }}>
        <TopBar connected={false} />
        <main className="p-6 space-y-6">
          {/* Report Tabs */}
          <div className="flex items-center gap-1 border-b" style={{ borderColor: '#efefef' }}>
            <a
              href="/reports"
              className="px-4 py-2.5 text-sm font-medium transition-colors"
              style={{ color: '#666', borderBottom: '2px solid transparent' }}
            >
              Room Occupancy
            </a>
            <span
              className="px-4 py-2.5 text-sm font-bold"
              style={{ color: '#1155cc', borderBottom: '2px solid #1155cc' }}
            >
              Daily Attendance
            </span>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[30px] font-bold" style={{ color: '#000' }}>
                Daily Attendance Report
              </h1>
              <p className="text-sm mt-1" style={{ color: '#666' }}>
                {formatDateDisplay(selectedDate)}
              </p>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{
                border: '1px solid #efefef',
                color: '#000',
                backgroundColor: '#fff',
              }}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm" style={{ color: '#666' }}>Loading attendance data...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-sm font-medium" style={{ color: '#cc1111' }}>{error}</p>
              <button
                onClick={fetchData}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: '#1155cc' }}
              >
                Retry
              </button>
            </div>
          ) : data ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <SummaryCard
                  label="Total Seniors"
                  value={String(data.summary.total_seniors)}
                />
                <SummaryCard
                  label="Still Present"
                  value={String(data.summary.still_present)}
                  highlight={data.summary.still_present > 0}
                />
                <SummaryCard
                  label="Avg Duration"
                  value={data.summary.avg_duration}
                />
                <SummaryCard
                  label="Total Duration"
                  value={data.summary.total_duration}
                />
              </div>

              {/* Attendance Table */}
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #efefef' }}>
                <div className="px-5 py-4" style={{ backgroundColor: '#fff', borderBottom: '1px solid #efefef' }}>
                  <h2 className="text-[20px] font-bold" style={{ color: '#000' }}>
                    Seniors Detected
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                    {data.attendees.length} senior{data.attendees.length !== 1 ? 's' : ''} captured today
                  </p>
                </div>

                {data.attendees.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-sm" style={{ color: '#666' }}>No seniors detected on this date</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr style={{ backgroundColor: '#efefef' }}>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>Name</th>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>First Seen</th>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>Last Seen</th>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>Rooms</th>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>Duration</th>
                        <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: '#000' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attendees.map((a) => (
                        <tr
                          key={a.senior_id}
                          className="transition-colors"
                          style={{ borderBottom: '1px solid #efefef' }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                        >
                          <td className="px-5 py-3">
                            <span className="text-sm font-bold" style={{ color: '#000' }}>
                              {a.senior_name}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-sm" style={{ color: '#000' }}>
                              {a.first_seen || '—'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-sm" style={{ color: '#000' }}>
                              {a.last_seen || '—'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1">
                              {a.rooms.map(r => (
                                <span
                                  key={r}
                                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: '#cfe2f3', color: '#1155cc' }}
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-sm font-medium" style={{ color: '#000' }}>
                              {a.duration_formatted}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className="text-xs font-bold px-2.5 py-1 rounded-full"
                              style={a.status === 'present'
                                ? { backgroundColor: '#d4edda', color: '#155724' }
                                : { backgroundColor: '#efefef', color: '#666' }
                              }
                            >
                              {a.status === 'present' ? 'Present' : 'Departed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, highlight }: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{
        backgroundColor: highlight ? '#cfe2f3' : '#efefef',
        border: highlight ? '1px solid #1155cc' : '1px solid #efefef',
      }}
    >
      <div
        className="text-2xl font-bold"
        style={{ color: highlight ? '#1155cc' : '#000' }}
      >
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: '#666' }}>
        {label}
      </div>
    </div>
  )
}
