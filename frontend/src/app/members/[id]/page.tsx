'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import Panel from '@/components/ui/Panel'
import StatCard from '@/components/dashboard/StatCard'
import { api } from '@/lib/api'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type {
  MemberSummary,
  MemberWeeklyData,
  MemberDurationData,
  MemberCalendarData,
  MemberFavouriteRoomsData,
  MemberAttendanceTrendData,
  MemberPeersData,
} from '@/lib/types'

const ROOM_COLORS = [
  '#0d9488', '#0ea5e9', '#eab308', '#ef4444',
  '#8b5cf6', '#f97316', '#22c55e', '#ec4899',
]

type TabKey = 'weekly' | 'duration' | 'calendar' | 'favouriteRooms' | 'trend' | 'peers'

export default function MemberDetailPage() {
  const params = useParams()
  const memberId = Number(params.id)

  const [summary, setSummary] = useState<MemberSummary | null>(null)
  const [weeklyData, setWeeklyData] = useState<MemberWeeklyData | null>(null)
  const [durationData, setDurationData] = useState<MemberDurationData | null>(null)
  const [calendarData, setCalendarData] = useState<MemberCalendarData | null>(null)
  const [favouriteRoomsData, setFavouriteRoomsData] = useState<MemberFavouriteRoomsData | null>(null)
  const [trendData, setTrendData] = useState<MemberAttendanceTrendData | null>(null)
  const [peersData, setPeersData] = useState<MemberPeersData | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('weekly')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth)
  const [durationDate, setDurationDate] = useState(now.toISOString().slice(0, 10))
  const [calendarMonth, setCalendarMonth] = useState(defaultMonth)
  const [favRoomsMonth, setFavRoomsMonth] = useState(defaultMonth)
  const [trendMonths, setTrendMonths] = useState(3)
  const [peersMonth, setPeersMonth] = useState(defaultMonth)

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.memberSummary(memberId)
      setSummary(data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [memberId])

  const fetchWeekly = useCallback(async () => {
    try { setWeeklyData(await api.memberWeekly(memberId, { month })) }
    catch { /* ignore */ }
  }, [memberId, month])

  const fetchDuration = useCallback(async () => {
    try { setDurationData(await api.memberDuration(memberId, { date: durationDate })) }
    catch { /* ignore */ }
  }, [memberId, durationDate])

  const fetchCalendar = useCallback(async () => {
    try { setCalendarData(await api.memberCalendar(memberId, { month: calendarMonth })) }
    catch { /* ignore */ }
  }, [memberId, calendarMonth])

  const fetchFavouriteRooms = useCallback(async () => {
    try { setFavouriteRoomsData(await api.memberFavouriteRooms(memberId, { month: favRoomsMonth })) }
    catch { /* ignore */ }
  }, [memberId, favRoomsMonth])

  const fetchTrend = useCallback(async () => {
    try { setTrendData(await api.memberAttendanceTrend(memberId, { months: trendMonths })) }
    catch { /* ignore */ }
  }, [memberId, trendMonths])

  const fetchPeers = useCallback(async () => {
    try { setPeersData(await api.memberPeers(memberId, { month: peersMonth })) }
    catch { /* ignore */ }
  }, [memberId, peersMonth])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { if (activeTab === 'weekly') fetchWeekly() }, [activeTab, fetchWeekly])
  useEffect(() => { if (activeTab === 'duration') fetchDuration() }, [activeTab, fetchDuration])
  useEffect(() => { if (activeTab === 'calendar') fetchCalendar() }, [activeTab, fetchCalendar])
  useEffect(() => { if (activeTab === 'favouriteRooms') fetchFavouriteRooms() }, [activeTab, fetchFavouriteRooms])
  useEffect(() => { if (activeTab === 'trend') fetchTrend() }, [activeTab, fetchTrend])
  useEffect(() => { if (activeTab === 'peers') fetchPeers() }, [activeTab, fetchPeers])

  const formatTimeAgo = (isoStr: string | null) => {
    if (!isoStr) return '—'
    const d = new Date(isoStr)
    const diff = Math.floor((Date.now() - d.getTime()) / 1000)
    const time = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })
    if (diff < 60) return `just now (${time})`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago (${time})`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago (${time})`
    const dateStr = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
    return `${Math.floor(diff / 86400)}d ago (${dateStr})`
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'weekly', label: '📊 Weekly' },
    { key: 'duration', label: '⏱ Duration' },
    { key: 'calendar', label: '📅 Calendar' },
    { key: 'favouriteRooms', label: '🏠 Rooms' },
    { key: 'trend', label: '📈 Trend' },
    { key: 'peers', label: '👥 Peers' },
  ]

  const exportPDF = useCallback(async () => {
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')

      // Pre-fetch any data that hasn't loaded yet
      const results = await Promise.all([
        weeklyData ?? api.memberWeekly(memberId, { month }),
        durationData ?? api.memberDuration(memberId, { date: durationDate }),
        calendarData ?? api.memberCalendar(memberId, { month: calendarMonth }),
        favouriteRoomsData ?? api.memberFavouriteRooms(memberId, { month: favRoomsMonth }),
        trendData ?? api.memberAttendanceTrend(memberId, { months: trendMonths }),
        peersData ?? api.memberPeers(memberId, { month: peersMonth }),
      ])
      const [wd, dd, cd, fd, td, pd] = results as [
        MemberWeeklyData, MemberDurationData, MemberCalendarData,
        MemberFavouriteRoomsData, MemberAttendanceTrendData, MemberPeersData
      ]

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const m = 14 // margin
      const cw = pw - m * 2 // content width
      const teal: [number, number, number] = [13, 148, 136]
      const gray: [number, number, number] = [120, 120, 120]
      const dark: [number, number, number] = [30, 30, 30]
      const lightGray: [number, number, number] = [229, 231, 235]
      let y = 0

      const fmtHours = (s: number) => {
        const h = Math.floor(s / 3600)
        const mn = Math.floor((s % 3600) / 60)
        return h > 0 ? `${h}h ${mn}m` : `${mn}m`
      }

      const ensureSpace = (needed: number) => {
        if (y + needed > ph - m) { pdf.addPage(); y = m }
      }

      const drawSectionTitle = (title: string) => {
        ensureSpace(14)
        pdf.setFontSize(14)
        pdf.setTextColor(...teal)
        pdf.setFont('helvetica', 'bold')
        pdf.text(title, m, y + 5)
        y += 4
        pdf.setDrawColor(...teal)
        pdf.setLineWidth(0.5)
        pdf.line(m, y + 3, m + cw, y + 3)
        y += 8
      }

      const drawTableHeader = (cols: { label: string; x: number; w: number; align?: 'center' | 'right' }[]) => {
        pdf.setFillColor(245, 247, 250)
        pdf.rect(m, y - 1, cw, 7, 'F')
        pdf.setFontSize(8)
        pdf.setTextColor(...gray)
        pdf.setFont('helvetica', 'bold')
        cols.forEach(c => {
          if (c.align === 'center') pdf.text(c.label, c.x + c.w / 2, y + 4, { align: 'center' })
          else if (c.align === 'right') pdf.text(c.label, c.x + c.w, y + 4, { align: 'right' })
          else pdf.text(c.label, c.x, y + 4)
        })
        y += 8
      }

      // ─── PAGE 1: Header + Summary ─────────────────────
      y = m + 4
      pdf.setFontSize(20)
      pdf.setTextColor(...teal)
      pdf.setFont('helvetica', 'bold')
      pdf.text(summary?.senior_name ?? 'Member Report', m, y + 6)
      y += 10
      pdf.setFontSize(9)
      pdf.setTextColor(...gray)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, m, y + 4)
      y += 10

      // Summary cards
      if (summary) {
        const cardW = (cw - 6) / 3
        const cards = [
          { label: 'Total Visits', value: `${summary.total_visits} days` },
          { label: 'Avg Duration', value: summary.avg_duration },
          { label: 'Last Seen', value: summary.last_seen_room ?? '—' },
        ]
        cards.forEach((c, i) => {
          const cx = m + i * (cardW + 3)
          pdf.setFillColor(240, 253, 250)
          pdf.roundedRect(cx, y, cardW, 18, 2, 2, 'F')
          pdf.setFontSize(8)
          pdf.setTextColor(...gray)
          pdf.setFont('helvetica', 'normal')
          pdf.text(c.label, cx + 4, y + 6)
          pdf.setFontSize(13)
          pdf.setTextColor(...dark)
          pdf.setFont('helvetica', 'bold')
          pdf.text(c.value, cx + 4, y + 14)
        })
        y += 24
      }

      // ─── WEEKLY VISITS ────────────────────────────────
      drawSectionTitle('Weekly Visits')
      if (wd.weeks.length > 0) {
        const cols = [
          { label: 'Week', x: m, w: 20 },
          { label: 'Period', x: m + 22, w: 50 },
          { label: 'Days', x: m + 74, w: 20, align: 'center' as const },
          { label: 'Rooms Visited', x: m + 96, w: 80 },
        ]
        drawTableHeader(cols)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        wd.weeks.forEach(w => {
          ensureSpace(7)
          pdf.setTextColor(...dark)
          pdf.text(w.label, m, y + 4)
          pdf.setTextColor(...gray)
          pdf.text(`${w.start} – ${w.end}`, m + 22, y + 4)
          // Days badge
          if (w.days_visited > 0) {
            pdf.setFillColor(...teal)
            pdf.roundedRect(m + 78, y, 10, 5.5, 1.5, 1.5, 'F')
            pdf.setTextColor(255, 255, 255)
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'bold')
            pdf.text(String(w.days_visited), m + 83, y + 4, { align: 'center' })
          } else {
            pdf.setFillColor(230, 230, 230)
            pdf.roundedRect(m + 78, y, 10, 5.5, 1.5, 1.5, 'F')
            pdf.setTextColor(160, 160, 160)
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'bold')
            pdf.text('0', m + 83, y + 4, { align: 'center' })
          }
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(9)
          pdf.setTextColor(...gray)
          pdf.text(w.rooms.length > 0 ? w.rooms.join(', ') : '—', m + 96, y + 4)
          y += 7
        })
        // Total row
        ensureSpace(8)
        pdf.setDrawColor(...lightGray)
        pdf.setLineWidth(0.3)
        pdf.line(m, y, m + cw, y)
        y += 1
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.setTextColor(...dark)
        pdf.text('Total', m, y + 4)
        pdf.setFillColor(...teal)
        pdf.roundedRect(m + 78, y, 10, 5.5, 1.5, 1.5, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFontSize(8)
        pdf.text(String(wd.total_days), m + 83, y + 4, { align: 'center' })
        y += 10

        // Mini bar chart
        ensureSpace(22)
        pdf.setFontSize(7)
        pdf.setTextColor(...gray)
        pdf.setFont('helvetica', 'normal')
        pdf.text('Weekly trend', m, y + 3)
        y += 5
        const barH = 14
        const barW = Math.min((cw - 4) / wd.weeks.length - 2, 20)
        const maxD = Math.max(...wd.weeks.map(w => w.days_visited), 1)
        wd.weeks.forEach((w, i) => {
          const bx = m + i * (barW + 3)
          const h = (w.days_visited / maxD) * barH
          // bar bg
          pdf.setFillColor(220, 252, 246)
          pdf.roundedRect(bx, y + barH - h, barW, h || 1, 1, 1, 'F')
          if (w.days_visited > 0) {
            pdf.setFillColor(...teal)
            pdf.roundedRect(bx, y + barH - h, barW, h, 1, 1, 'F')
          }
          // value above bar
          pdf.setFontSize(7)
          pdf.setTextColor(...dark)
          pdf.setFont('helvetica', 'bold')
          pdf.text(String(w.days_visited), bx + barW / 2, y + barH - h - 1.5, { align: 'center' })
          // label below
          pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(...gray)
          pdf.setFontSize(6)
          pdf.text(w.label, bx + barW / 2, y + barH + 3.5, { align: 'center' })
        })
        y += barH + 8
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No data for this month.', m, y + 4); y += 10
      }

      // ─── DURATION ─────────────────────────────────────
      y += 4
      drawSectionTitle('Duration Details')
      if (dd.entries.length > 0) {
        pdf.setFontSize(8)
        pdf.setTextColor(...gray)
        pdf.setFont('helvetica', 'normal')
        pdf.text(`Presence on ${new Date(dd.date).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`, m, y + 3)
        y += 7

        const cols = [
          { label: 'Room', x: m, w: 60 },
          { label: 'Duration', x: m + 62, w: 40 },
        ]
        drawTableHeader(cols)
        pdf.setFontSize(9)
        const maxSec = Math.max(...dd.entries.map(e => e.duration_seconds), 1)
        dd.entries.forEach(e => {
          ensureSpace(10)
          pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(...dark)
          pdf.text(e.room_name, m, y + 4)
          pdf.setTextColor(...teal)
          pdf.setFont('helvetica', 'bold')
          pdf.text(e.duration_formatted, m + 62, y + 4)
          // Duration bar
          const barPct = (e.duration_seconds / maxSec)
          pdf.setFillColor(220, 252, 246)
          pdf.roundedRect(m + 100, y + 0.5, 80, 4, 1, 1, 'F')
          pdf.setFillColor(...teal)
          pdf.roundedRect(m + 100, y + 0.5, 80 * barPct, 4, 1, 1, 'F')
          y += 7
        })
        // Total
        ensureSpace(8)
        pdf.setDrawColor(...lightGray); pdf.setLineWidth(0.3); pdf.line(m, y, m + cw, y); y += 1
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
        pdf.setTextColor(...dark); pdf.text('Total', m, y + 4)
        pdf.setTextColor(...teal); pdf.text(dd.total_duration, m + 62, y + 4)
        y += 10
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No presence recorded on this date.', m, y + 4); y += 10
      }

      // ─── CALENDAR ─────────────────────────────────────
      pdf.addPage(); y = m
      drawSectionTitle('Attendance Calendar')
      if (cd.days.length > 0) {
        const [cYear, cMon] = cd.month.split('-').map(Number)
        const firstDay = new Date(cYear, cMon - 1, 1)
        const daysInMonth = new Date(cYear, cMon, 0).getDate()
        let startWd = firstDay.getDay() - 1
        if (startWd < 0) startWd = 6

        const dayMap = new Map<number, number>()
        cd.days.forEach(d => { dayMap.set(parseInt(d.date.split('-')[2], 10), d.total_seconds) })
        const maxSecs = Math.max(...cd.days.map(d => d.total_seconds), 1)

        // Month label
        pdf.setFontSize(10); pdf.setTextColor(...dark); pdf.setFont('helvetica', 'bold')
        pdf.text(`${firstDay.toLocaleString('en', { month: 'long' })} ${cYear}`, m, y + 4); y += 8

        // Day headers
        const cellW = cw / 7
        const cellH = 10
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        pdf.setFontSize(7); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'bold')
        dayNames.forEach((d, i) => { pdf.text(d, m + i * cellW + cellW / 2, y + 3, { align: 'center' }) })
        y += 5

        // Calendar grid
        let col = startWd
        let row = 0
        for (let d = 1; d <= daysInMonth; d++) {
          const cx = m + col * cellW
          const cy = y + row * cellH
          ensureSpace(cellH + 2)
          const secs = dayMap.get(d) || 0
          const ratio = secs / maxSecs

          // Cell background
          if (secs === 0) {
            pdf.setFillColor(245, 245, 245)
          } else if (ratio < 0.25) {
            pdf.setFillColor(204, 251, 241) // teal-100
          } else if (ratio < 0.5) {
            pdf.setFillColor(94, 234, 212) // teal-300
          } else if (ratio < 0.75) {
            pdf.setFillColor(20, 184, 166) // teal-500
          } else {
            pdf.setFillColor(13, 148, 136) // teal-600
          }
          pdf.roundedRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1, 1, 1, 'F')

          // Day number
          const isHighRatio = ratio >= 0.5
          pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(isHighRatio && secs > 0 ? 255 : 50, isHighRatio && secs > 0 ? 255 : 50, isHighRatio && secs > 0 ? 255 : 50)
          pdf.text(String(d), cx + cellW / 2, cy + 4, { align: 'center' })
          // Hours
          if (secs > 0) {
            pdf.setFontSize(5.5); pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(isHighRatio ? 220 : 13, isHighRatio ? 255 : 148, isHighRatio ? 240 : 136)
            pdf.text(fmtHours(secs), cx + cellW / 2, cy + 7.5, { align: 'center' })
          }

          col++
          if (col >= 7) { col = 0; row++ }
        }
        y += (row + (col > 0 ? 1 : 0)) * cellH + 4

        // Legend
        ensureSpace(10)
        pdf.setFontSize(6); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
        pdf.text('Less', m, y + 3)
        const legendColors: [number, number, number][] = [[245, 245, 245], [204, 251, 241], [94, 234, 212], [20, 184, 166], [13, 148, 136]]
        legendColors.forEach((c, i) => { pdf.setFillColor(...c); pdf.roundedRect(m + 12 + i * 7, y, 5, 5, 1, 1, 'F') })
        pdf.text('More', m + 12 + 5 * 7 + 2, y + 3)

        // Summary
        pdf.setFontSize(8); pdf.text(
          `${cd.summary.days_present} days present  ·  ${cd.summary.total_hours} total${cd.summary.max_day ? `  ·  Best: ${new Date(cd.summary.max_day.date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} (${cd.summary.max_day.hours})` : ''}`,
          m + 60, y + 3
        )
        y += 10
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No attendance recorded this month.', m, y + 4); y += 10
      }

      // ─── FAVOURITE ROOMS ──────────────────────────────
      y += 4
      drawSectionTitle('Favourite Rooms')
      if (fd.rooms.length > 0) {
        pdf.setFontSize(8); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
        pdf.text(`Total: ${fd.total_duration}`, m, y + 3); y += 7

        const roomColors: [number, number, number][] = [
          [13,148,136], [14,165,233], [234,179,8], [239,68,68],
          [139,92,246], [249,115,22], [34,197,94], [236,72,153],
        ]
        fd.rooms.forEach((r, i) => {
          ensureSpace(12)
          const color = roomColors[i % roomColors.length]
          // Color dot
          pdf.setFillColor(...color)
          pdf.circle(m + 2, y + 3, 1.5, 'F')
          // Room name
          pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...dark)
          pdf.text(r.room_name, m + 6, y + 4)
          // Percentage
          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...gray)
          pdf.text(`${r.percentage}%`, m + 60, y + 4)
          // Duration + days
          pdf.setFontSize(8)
          pdf.text(`${r.duration_formatted}  ·  ${r.days_count} days`, m + 76, y + 4)
          // Progress bar
          y += 6
          pdf.setFillColor(235, 235, 235)
          pdf.roundedRect(m + 6, y, cw - 8, 3, 1, 1, 'F')
          pdf.setFillColor(...color)
          pdf.roundedRect(m + 6, y, (cw - 8) * (r.percentage / 100), 3, 1, 1, 'F')
          y += 6
        })
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No room data this month.', m, y + 4); y += 10
      }

      // ─── ATTENDANCE TREND ─────────────────────────────
      pdf.addPage(); y = m
      drawSectionTitle('Attendance Trend')
      if (td.weeks.length > 0) {
        // Line chart area
        const chartX = m + 10
        const chartY = y + 2
        const chartW = cw - 14
        const chartH = 50
        const maxH = Math.max(...td.weeks.map(w => w.hours), 1)

        // Y-axis grid lines
        pdf.setDrawColor(235, 235, 235); pdf.setLineWidth(0.2)
        for (let g = 0; g <= 4; g++) {
          const gy = chartY + chartH - (g / 4) * chartH
          pdf.line(chartX, gy, chartX + chartW, gy)
          pdf.setFontSize(6); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
          pdf.text(`${((maxH * g) / 4).toFixed(0)}h`, chartX - 3, gy + 1, { align: 'right' })
        }

        // Plot line + dots
        const points = td.weeks.map((w, i) => ({
          x: chartX + (i / Math.max(td.weeks.length - 1, 1)) * chartW,
          y: chartY + chartH - (w.hours / maxH) * chartH,
          label: w.week_label,
          hours: w.hours,
        }))

        pdf.setDrawColor(...teal); pdf.setLineWidth(0.6)
        for (let i = 1; i < points.length; i++) {
          pdf.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y)
        }
        points.forEach(p => {
          pdf.setFillColor(...teal); pdf.circle(p.x, p.y, 1.2, 'F')
        })
        // X labels (show every 2nd if too many)
        const step = td.weeks.length > 8 ? 2 : 1
        points.forEach((p, i) => {
          if (i % step === 0) {
            pdf.setFontSize(5.5); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
            pdf.text(p.label, p.x, chartY + chartH + 4, { align: 'center' })
          }
        })
        y = chartY + chartH + 10

        // Summary
        ensureSpace(10)
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...dark)
        pdf.text(`Avg weekly: `, m, y + 4)
        pdf.setFont('helvetica', 'bold'); pdf.text(`${td.summary.avg_weekly_hours}h`, m + 22, y + 4)
        pdf.setFont('helvetica', 'normal'); pdf.text('Trend: ', m + 36, y + 4)
        if (td.summary.trend === 'increasing') { pdf.setTextColor(34, 197, 94); pdf.setFont('helvetica', 'bold'); pdf.text('↑ Increasing', m + 48, y + 4) }
        else if (td.summary.trend === 'declining') { pdf.setTextColor(239, 68, 68); pdf.setFont('helvetica', 'bold'); pdf.text('↓ Declining', m + 48, y + 4) }
        else { pdf.setTextColor(...gray); pdf.setFont('helvetica', 'bold'); pdf.text('→ Stable', m + 48, y + 4) }
        const avgDays = td.weeks.length > 0 ? (td.weeks.reduce((a, w) => a + w.days_present, 0) / td.weeks.length).toFixed(1) : '0'
        pdf.setTextColor(...dark); pdf.setFont('helvetica', 'normal')
        pdf.text(`Days/week: ${avgDays}`, m + 78, y + 4)
        y += 12
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No data in this period.', m, y + 4); y += 10
      }

      // ─── PEERS ────────────────────────────────────────
      y += 4
      drawSectionTitle('Frequent Companions')
      if (pd.peers.length > 0) {
        pdf.setFontSize(8); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
        pdf.text(`${pd.total_peers} members shared room time`, m, y + 3); y += 7

        const maxCount = Math.max(...pd.peers.map(p => p.co_occurrence_count), 1)
        const peerColors: [number, number, number][] = [
          [13,148,136], [14,165,233], [234,179,8], [239,68,68],
          [139,92,246], [249,115,22], [34,197,94], [236,72,153],
        ]
        pd.peers.forEach((p, i) => {
          ensureSpace(11)
          const color = peerColors[i % peerColors.length]
          // Rank
          pdf.setFontSize(7); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
          pdf.text(`${i + 1}.`, m, y + 4)
          // Avatar circle
          pdf.setFillColor(...color)
          pdf.circle(m + 8, y + 3, 3, 'F')
          const initials = p.senior_name.split(' ').map(w => w[0]).join('').slice(0, 2)
          pdf.setFontSize(5); pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold')
          pdf.text(initials, m + 8, y + 4, { align: 'center' })
          // Name
          pdf.setFontSize(9); pdf.setTextColor(...dark); pdf.setFont('helvetica', 'bold')
          pdf.text(p.senior_name, m + 14, y + 4)
          // Count badge
          pdf.setTextColor(...teal); pdf.setFontSize(8)
          pdf.text(`${p.co_occurrence_count} times`, m + cw - 2, y + 4, { align: 'right' })
          // Bar + rooms
          y += 6
          const barPct = p.co_occurrence_count / maxCount
          pdf.setFillColor(235, 235, 235)
          pdf.roundedRect(m + 14, y, cw * 0.5, 2, 0.5, 0.5, 'F')
          pdf.setFillColor(13, 148, 136, 0.5)
          pdf.roundedRect(m + 14, y, cw * 0.5 * barPct, 2, 0.5, 0.5, 'F')
          // Common rooms
          pdf.setFontSize(6); pdf.setTextColor(...gray); pdf.setFont('helvetica', 'normal')
          pdf.text(p.common_rooms.join(', '), m + 14 + cw * 0.5 + 3, y + 2)
          y += 5
        })
      } else {
        pdf.setFontSize(9); pdf.setTextColor(...gray); pdf.text('No shared room activity found.', m, y + 4); y += 10
      }

      // Footer on last page
      pdf.setFontSize(7); pdf.setTextColor(180, 180, 180); pdf.setFont('helvetica', 'italic')
      pdf.text('Smart AAC — Member Report', pw / 2, ph - 5, { align: 'center' })

      // Download
      const memberName = (summary?.senior_name ?? 'member').replace(/\s+/g, '_')
      pdf.save(`${memberName}_report.pdf`)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [memberId, summary, weeklyData, durationData, calendarData, favouriteRoomsData, trendData, peersData, month, durationDate, calendarMonth, favRoomsMonth, trendMonths, peersMonth])

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-60 overflow-y-auto">
        <TopBar />
        <main className="p-6 space-y-6">
          {/* Back link + Header */}
          <div>
            <Link
              href="/members"
              className="text-sm text-muted hover:text-teal transition-colors inline-flex items-center gap-1 mb-3"
            >
              ← Back to Members
            </Link>

            {loading ? (
              <div className="animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-32" />
              </div>
            ) : summary ? (
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-full bg-teal/10 text-teal flex items-center justify-center text-lg font-bold shrink-0">
                  {summary.senior_name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </span>
                <div>
                  <h1 className="text-2xl font-bold text-text">
                    {summary.senior_name}
                  </h1>
                </div>
              </div>
            ) : (
              <p className="text-muted">Member not found</p>
            )}
          </div>

          {/* Summary stat cards */}
          {summary && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Total Visits"
                value={`${summary.total_visits} days`}
                icon="📅"
                color="text-teal"
                bgColor="bg-teal/10"
              />
              <StatCard
                label="Avg Duration"
                value={summary.avg_duration}
                icon="⏱"
                color="text-sky"
                bgColor="bg-sky-light"
              />
              <StatCard
                label="Last Seen"
                value={summary.last_seen_room ? summary.last_seen_room : '—'}
                subtitle={formatTimeAgo(summary.last_seen_at)}
                icon="📍"
                color="text-green"
                bgColor="bg-green-light"
              />
            </div>
          )}

          {/* Tabs + Export button */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-surface rounded-lg p-1 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === t.key
                      ? 'bg-panel text-text shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              onClick={exportPDF}
              disabled={exporting || !summary}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              {exporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting…
                </>
              ) : (
                <>📄 Export PDF</>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="space-y-4">
            {activeTab === 'weekly' && (
              <WeeklyTab data={weeklyData} month={month} onMonthChange={setMonth} />
            )}
            {activeTab === 'duration' && (
              <DurationTab data={durationData} date={durationDate} onDateChange={setDurationDate} />
            )}
            {activeTab === 'calendar' && (
              <CalendarTab data={calendarData} month={calendarMonth} onMonthChange={setCalendarMonth} />
            )}
            {activeTab === 'favouriteRooms' && (
              <FavouriteRoomsTab data={favouriteRoomsData} month={favRoomsMonth} onMonthChange={setFavRoomsMonth} />
            )}
            {activeTab === 'trend' && (
              <TrendTab data={trendData} months={trendMonths} onMonthsChange={setTrendMonths} />
            )}
            {activeTab === 'peers' && (
              <PeersTab data={peersData} month={peersMonth} onMonthChange={setPeersMonth} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

/* ── Weekly Visits Tab ─────────────────────────────────────────── */

function WeeklyTab({
  data,
  month,
  onMonthChange,
}: {
  data: MemberWeeklyData | null
  month: string
  onMonthChange: (m: string) => void
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Month:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      <Panel title="Weekly Participation" subtitle="Days visited per week">
        {!data ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.weeks.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No data for this month.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="pb-2 pr-4 font-medium">Week</th>
                    <th className="pb-2 pr-4 font-medium">Period</th>
                    <th className="pb-2 pr-4 font-medium text-center">Days Visited</th>
                    <th className="pb-2 font-medium">Rooms Visited</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.week} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-text">{w.label}</td>
                      <td className="py-2.5 pr-4 text-muted">{w.start} – {w.end}</td>
                      <td className="py-2.5 pr-4 text-center">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${
                          w.days_visited > 0 ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-400'
                        }`}>
                          {w.days_visited}
                        </span>
                      </td>
                      <td className="py-2.5 text-muted">{w.rooms.length > 0 ? w.rooms.join(', ') : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <td className="py-2.5 pr-4 font-bold text-text">Total</td>
                    <td className="py-2.5 pr-4"></td>
                    <td className="py-2.5 pr-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold bg-teal text-white">
                        {data.total_days}
                      </span>
                    </td>
                    <td className="py-2.5"></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted mb-2">Weekly trend</p>
              <div className="flex items-end gap-2 h-20">
                {data.weeks.map((w) => {
                  const maxDays = Math.max(...data.weeks.map((wk) => wk.days_visited), 1)
                  const pct = (w.days_visited / maxDays) * 100
                  return (
                    <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-medium text-text">{w.days_visited}</span>
                      <div className="w-full bg-teal/20 rounded-t" style={{ height: `${Math.max(pct, 4)}%` }}>
                        <div className="w-full bg-teal rounded-t h-full" style={{ opacity: w.days_visited > 0 ? 1 : 0.2 }} />
                      </div>
                      <span className="text-[10px] text-muted">{w.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  )
}

/* ── Duration Tab ──────────────────────────────────────────────── */

function DurationTab({
  data,
  date,
  onDateChange,
}: {
  data: MemberDurationData | null
  date: string
  onDateChange: (d: string) => void
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Date:</label>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      <Panel
        title="Duration Details"
        subtitle={data ? `Presence on ${new Date(data.date).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}` : 'Loading...'}
      >
        {!data ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.entries.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No presence recorded on this date.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="pb-2 pr-4 font-medium">Room</th>
                    <th className="pb-2 pr-4 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.room_id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-text">{e.room_name}</td>
                      <td className="py-2.5 pr-4">
                        <span className="text-teal font-semibold">{e.duration_formatted}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <td className="py-2.5 pr-4 font-bold text-text">Total</td>
                    <td className="py-2.5 pr-4">
                      <span className="text-teal font-bold">{data.total_duration}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted mb-2">Duration by room</p>
              <div className="space-y-2">
                {data.entries.map((e) => {
                  const maxSec = Math.max(...data.entries.map((en) => en.duration_seconds), 1)
                  const pct = (e.duration_seconds / maxSec) * 100
                  return (
                    <div key={e.room_id} className="flex items-center gap-3">
                      <span className="text-xs text-muted w-28 truncate">{e.room_name}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-text w-16 text-right">{e.duration_formatted}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  )
}

/* ── Calendar Tab ──────────────────────────────────────────────── */

function CalendarTab({
  data,
  month,
  onMonthChange,
}: {
  data: MemberCalendarData | null
  month: string
  onMonthChange: (m: string) => void
}) {
  const calendarGrid = useMemo(() => {
    if (!data) return null
    const [year, mon] = data.month.split('-').map(Number)
    const firstDay = new Date(year, mon - 1, 1)
    const daysInMonth = new Date(year, mon, 0).getDate()

    // Monday = 0 ... Sunday = 6
    let startWeekday = firstDay.getDay() - 1
    if (startWeekday < 0) startWeekday = 6

    // Build day-to-seconds map
    const dayMap = new Map<number, number>()
    for (const d of data.days) {
      const dayNum = parseInt(d.date.split('-')[2], 10)
      dayMap.set(dayNum, d.total_seconds)
    }
    const maxSecs = Math.max(...data.days.map((d) => d.total_seconds), 1)

    // Build cells: empty slots + day cells
    const cells: { day: number; seconds: number }[] = []
    for (let i = 0; i < startWeekday; i++) cells.push({ day: 0, seconds: 0 })
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, seconds: dayMap.get(d) || 0 })

    return { cells, maxSecs, daysInMonth }
  }, [data])

  const getIntensityClass = (seconds: number, maxSecs: number) => {
    if (seconds === 0) return 'bg-gray-100'
    const ratio = seconds / maxSecs
    if (ratio < 0.25) return 'bg-teal/20'
    if (ratio < 0.5) return 'bg-teal/40'
    if (ratio < 0.75) return 'bg-teal/60'
    return 'bg-teal'
  }

  const formatHours = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Month:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      <Panel title="Attendance Calendar" subtitle={data ? `${data.summary.days_present} days present` : 'Loading...'}>
        {!data || !calendarGrid ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.days.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No attendance recorded this month.</p>
        ) : (
          <>
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-center text-[11px] text-muted font-medium py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1.5">
              {calendarGrid.cells.map((cell, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-colors ${
                    cell.day === 0
                      ? ''
                      : `${getIntensityClass(cell.seconds, calendarGrid.maxSecs)} ${
                          cell.seconds > 0 ? 'text-white font-medium' : 'text-muted'
                        }`
                  }`}
                  title={cell.day > 0 && cell.seconds > 0 ? formatHours(cell.seconds) : undefined}
                >
                  {cell.day > 0 && (
                    <>
                      <span className={cell.seconds > 0 && cell.seconds / calendarGrid.maxSecs >= 0.5 ? 'text-white' : 'text-text'}>{cell.day}</span>
                      {cell.seconds > 0 && (
                        <span className={`text-[9px] ${cell.seconds / calendarGrid.maxSecs >= 0.5 ? 'text-white/80' : 'text-teal'}`}>
                          {formatHours(cell.seconds)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Legend + Summary */}
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">Less</span>
                <div className="w-4 h-4 rounded bg-gray-100" />
                <div className="w-4 h-4 rounded bg-teal/20" />
                <div className="w-4 h-4 rounded bg-teal/40" />
                <div className="w-4 h-4 rounded bg-teal/60" />
                <div className="w-4 h-4 rounded bg-teal" />
                <span className="text-[10px] text-muted">More</span>
              </div>
              <div className="text-xs text-muted">
                {data.summary.days_present} days · {data.summary.total_hours} total
                {data.summary.max_day && (
                  <> · Best: {new Date(data.summary.max_day.date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} ({data.summary.max_day.hours})</>
                )}
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  )
}

/* ── Favourite Rooms Tab ───────────────────────────────────────── */

function FavouriteRoomsTab({
  data,
  month,
  onMonthChange,
}: {
  data: MemberFavouriteRoomsData | null
  month: string
  onMonthChange: (m: string) => void
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Month:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      <Panel title="Favourite Rooms" subtitle={data ? `Total: ${data.total_duration}` : 'Loading...'}>
        {!data ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.rooms.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No room data this month.</p>
        ) : (
          <div className="flex flex-col md:flex-row gap-6">
            {/* Pie chart */}
            <div className="w-full md:w-64 h-64 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.rooms}
                    dataKey="total_seconds"
                    nameKey="room_name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {data.rooms.map((_, i) => (
                      <Cell key={i} fill={ROOM_COLORS[i % ROOM_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | undefined) => {
                      const v = value ?? 0
                      const h = Math.floor(v / 3600)
                      const m = Math.floor((v % 3600) / 60)
                      return `${h}h ${m}m`
                    }}
                    contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Room list */}
            <div className="flex-1 space-y-3">
              {data.rooms.map((r, i) => (
                <div key={r.room_id ?? 'unknown'} className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text truncate">{r.room_name}</span>
                      <span className="text-sm text-muted ml-2 shrink-0">{r.percentage}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${r.percentage}%`,
                            backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted shrink-0 w-20 text-right">
                        {r.duration_formatted} · {r.days_count}d
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}

/* ── Attendance Trend Tab ──────────────────────────────────────── */

function TrendTab({
  data,
  months,
  onMonthsChange,
}: {
  data: MemberAttendanceTrendData | null
  months: number
  onMonthsChange: (m: number) => void
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Range:</label>
        <select
          value={months}
          onChange={(e) => onMonthsChange(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        >
          <option value={1}>Last 1 month</option>
          <option value={2}>Last 2 months</option>
          <option value={3}>Last 3 months</option>
        </select>
      </div>

      <Panel
        title="Attendance Trend"
        subtitle={data ? `${data.summary.total_weeks} weeks tracked` : 'Loading...'}
      >
        {!data ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.weeks.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No data in this period.</p>
        ) : (
          <>
            {/* Line chart */}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.weeks} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week_label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: number | undefined) => [`${value ?? 0}h`, 'Hours']}
                    labelFormatter={(label) => `Week: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#0d9488' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary */}
            <div className="mt-4 pt-4 border-t border-border flex items-center gap-6">
              <div className="text-sm">
                <span className="text-muted">Avg weekly: </span>
                <span className="font-semibold text-text">{data.summary.avg_weekly_hours}h</span>
              </div>
              <div className="text-sm flex items-center gap-1.5">
                <span className="text-muted">Trend: </span>
                {data.summary.trend === 'increasing' && (
                  <span className="text-green font-semibold">↑ Increasing</span>
                )}
                {data.summary.trend === 'stable' && (
                  <span className="text-muted font-semibold">→ Stable</span>
                )}
                {data.summary.trend === 'declining' && (
                  <span className="text-coral font-semibold">↓ Declining</span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-muted">Days per week: </span>
                <span className="font-semibold text-text">
                  {data.weeks.length > 0
                    ? (data.weeks.reduce((a, w) => a + w.days_present, 0) / data.weeks.length).toFixed(1)
                    : '0'}
                </span>
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  )
}

/* ── Peers Tab ─────────────────────────────────────────────────── */

function PeersTab({
  data,
  month,
  onMonthChange,
}: {
  data: MemberPeersData | null
  month: string
  onMonthChange: (m: string) => void
}) {
  const maxCount = useMemo(() => {
    if (!data || data.peers.length === 0) return 1
    return Math.max(...data.peers.map((p) => p.co_occurrence_count))
  }, [data])

  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Month:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-panel text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      <Panel
        title="Frequent Companions"
        subtitle={data ? `${data.total_peers} members shared room time` : 'Loading...'}
      >
        {!data ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : data.peers.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No shared room activity found this month.</p>
        ) : (
          <div className="space-y-3">
            {data.peers.map((p, i) => {
              const pct = (p.co_occurrence_count / maxCount) * 100
              const initials = p.senior_name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
              return (
                <div key={p.senior_id} className="flex items-center gap-3">
                  {/* Rank */}
                  <span className="text-xs text-muted w-5 text-right shrink-0">
                    {i + 1}.
                  </span>

                  {/* Avatar */}
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }}
                  >
                    {initials}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text truncate">{p.senior_name}</span>
                      <span className="text-xs font-bold text-teal ml-2 shrink-0">
                        {p.co_occurrence_count} times
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal/50 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted shrink-0 truncate max-w-[160px]">
                        {p.common_rooms.join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}
