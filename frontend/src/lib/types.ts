export interface DashboardStats {
  seniors_present: number
  seniors_max: number
  unidentified_count: number
  active_rooms: { count: number; total: number }
  todays_activities: number
  alert_count: number
  last_sync: string
}

export interface Senior {
  id: number
  name: string
  nric_last4: string
  photo_path: string | null
  registered_at: string
  is_active: boolean
}

export interface SeniorPresence {
  id: number
  senior_id: number | null
  senior_name: string | null
  room_id: number | null
  room_name: string | null
  camera_id: number | null
  arrived_at: string
  last_seen_at: string
  status: 'identified' | 'unidentified'
  is_current: boolean
}

export interface Room {
  id: number
  name: string
  max_capacity: number
  moderate_threshold: number | null
  current_occupancy: number
}

export interface RoomHeatmap {
  id: number
  name: string
  occupancy: number
  max_capacity: number
  moderate_threshold: number | null
  identified: number
  strangers: number
  color_level: 'empty' | 'low' | 'medium' | 'high'
}

export interface Activity {
  id: number
  name: string
  room_id: number
  room_name: string
  scheduled_time: string
  end_time: string
  status: 'done' | 'active' | 'upcoming'
  attendee_count: number
}

// Odoo aac_activities response
export interface AacActivitySlot {
  slot_id?: number
  date?: string
  day?: string
  time?: string
  name?: string
  venue?: string | false
  seats_available?: number
  vacancies?: number
  total_register?: number
  total_confirm?: number
  total_attended?: number
  registered?: boolean
  make_attendance?: boolean
}

export interface AacActivity {
  id?: number
  name?: string
  desc?: string | false
  description?: string
  date_begin?: string
  date_end?: string
  from_time?: string
  to_time?: string
  status?: string
  state?: string
  fee?: number
  regular_event?: boolean
  slot_ids?: AacActivitySlot[]
  venue_ids?: Array<{ id: number; name: string | false }>
  event_type?: Array<{ id: number; name: string }>
  event_domain?: Array<{ id: number; name: string }>
  spoken_language?: Array<{ id: number; name: string }>
  tag?: Array<{ id: number; name: string }>
  e_image_url?: string
  note?: string | false
  zoom_link?: string | false
  [key: string]: unknown
}

export type AacActivitiesResponse = AacActivity[] | { activities: AacActivity[]; [key: string]: unknown }

export interface Alert {
  id: number
  type: 'critical' | 'warning' | 'info'
  title: string
  description: string
  camera_id: number | null
  camera_name: string | null
  created_at: string
  acknowledged: boolean
}

export interface AlertCounts {
  critical: number
  warning: number
  info: number
  total: number
}

export interface AlertsPage {
  alerts: Alert[]
  total: number
  page: number
  per_page: number
  pages: number
}

export interface KioskEvent {
  id: number
  senior_id: number
  senior_name: string
  event_type: 'check_in' | 'activity_register'
  activity_id: number | null
  activity_name: string | null
  timestamp: string
}

export interface Camera {
  id: number
  name: string
  rtsp_url: string | null
  channel: number | null
  location: string
  room_id: number | null
  room_name: string | null
  enabled: boolean
}

export interface CCTVSnapshot {
  id: number
  camera_id: number
  camera_name: string
  timestamp: string
  identified_count: number
  unidentified_count: number
  snapshot_b64: string | null
}

export interface RosterMember {
  name: string
  senior_id: number | null
  first_seen: string | null
  last_seen: string | null
  status: 'active' | 'inactive'
  location: string | null
  camera_location: string | null
}

export interface SSEEvent {
  type: 'snapshot' | 'detection' | 'alert' | 'heartbeat' | 'sync_progress' | 'sync_complete'
  camera_id?: number
  camera_name?: string
  person?: string
  person_type?: 'known' | 'unknown'
  confidence?: number
  timestamp?: string
  crop?: string | null
  [key: string]: unknown
}

export interface User {
  id: number
  odoo_uid: string
  name: string
  email: string
  is_manager: boolean
  is_volunteer: boolean
  last_login: string | null
}

export interface LoginResponse {
  token: string
  user: User
}

// ── Report Types ──

export interface RoomOccupancyRoom {
  id: number
  name: string
}

export interface RoomOccupancyPoint {
  date: string
  [key: string]: string | number
}

export interface RoomOccupancySummary {
  peak_day: string
  peak_count: number
  busiest_room: string
  avg_per_day: number
}

export interface RoomOccupancyData {
  rooms: RoomOccupancyRoom[]
  series: RoomOccupancyPoint[]
  summary: RoomOccupancySummary
}

export interface MemberSummary {
  senior_id: number
  senior_name: string
  registered_at: string | null
  total_visits: number
  avg_duration: string
  last_seen_room: string | null
  last_seen_at: string | null
}

export interface WeekEntry {
  week: number
  label: string
  start: string
  end: string
  days_visited: number
  rooms: string[]
}

export interface MemberWeeklyData {
  senior: { id: number; name: string }
  month: string
  weeks: WeekEntry[]
  total_days: number
}

export interface DurationEntry {
  room_id: number
  room_name: string
  duration_seconds: number
  duration_formatted: string
  session_count: number
  first_arrival: string | null
}

export interface MemberDurationData {
  senior: { id: number; name: string }
  date: string
  entries: DurationEntry[]
  total_duration: string
  total_sessions: number
}

// ── Member Calendar ──

export interface CalendarDay {
  date: string
  total_seconds: number
}

export interface CalendarSummary {
  days_present: number
  total_hours: string
  max_day: { date: string; hours: string } | null
}

export interface MemberCalendarData {
  senior: { id: number; name: string }
  month: string
  days: CalendarDay[]
  summary: CalendarSummary
}

// ── Favourite Rooms ──

export interface FavouriteRoom {
  room_id: number | null
  room_name: string
  total_seconds: number
  duration_formatted: string
  days_count: number
  percentage: number
}

export interface MemberFavouriteRoomsData {
  senior: { id: number; name: string }
  month: string
  rooms: FavouriteRoom[]
  total_duration: string
}

// ── Attendance Trend ──

export interface TrendWeek {
  iso_week: string
  week_label: string
  start_date: string
  total_seconds: number
  hours: number
  days_present: number
}

export interface TrendSummary {
  avg_weekly_hours: number
  trend: 'increasing' | 'stable' | 'declining'
  total_weeks: number
}

export interface MemberAttendanceTrendData {
  senior: { id: number; name: string }
  months: number
  weeks: TrendWeek[]
  summary: TrendSummary
}

// ── Peer Presence ──

export interface PeerEntry {
  senior_id: number
  senior_name: string
  co_occurrence_count: number
  common_rooms: string[]
}

export interface MemberPeersData {
  senior: { id: number; name: string }
  month: string
  peers: PeerEntry[]
  total_peers: number
}

// ── Daily Attendance ──

export interface DailyAttendee {
  senior_id: number
  senior_name: string
  first_seen: string | null
  last_seen: string | null
  rooms: string[]
  duration_seconds: number
  duration_formatted: string
  session_count: number
  status: 'present' | 'departed'
}

export interface DailyAttendanceSummary {
  total_seniors: number
  still_present: number
  avg_duration: string
  total_duration: string
}

export interface DailyAttendanceData {
  date: string
  attendees: DailyAttendee[]
  summary: DailyAttendanceSummary
}

export interface FRStatus {
  status: 'running' | 'stopped' | 'error'
  uptime_seconds?: number
  total_captures?: number
  total_analyses?: number
  total_detections?: number
  known_persons_detected?: Record<string, number>
  unknown_persons_count?: number
  total_embeddings?: number
  cameras?: string[]
}
