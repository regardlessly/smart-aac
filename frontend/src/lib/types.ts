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
  camera_id: number | null
  max_capacity: number
  current_occupancy: number
}

export interface RoomHeatmap {
  id: number
  name: string
  occupancy: number
  max_capacity: number
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

export interface Alert {
  id: number
  type: 'critical' | 'warning' | 'info'
  title: string
  description: string
  camera_id: number | null
  created_at: string
  acknowledged: boolean
}

export interface AlertCounts {
  critical: number
  warning: number
  info: number
  total: number
}

export interface Locker {
  id: number
  locker_number: string
  status: 'available' | 'in_use' | 'reserved'
  assigned_to: number | null
  assigned_to_name: string | null
  equipment_description: string | null
}

export interface KioskEvent {
  id: number
  senior_id: number
  senior_name: string
  event_type: 'check_in' | 'locker_open' | 'activity_register'
  activity_id: number | null
  activity_name: string | null
  locker_id: number | null
  locker_number: string | null
  timestamp: string
}

export interface Camera {
  id: number
  name: string
  rtsp_url: string | null
  channel: number | null
  location: string
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

export interface SSEEvent {
  type: 'snapshot' | 'detection' | 'alert' | 'heartbeat'
  [key: string]: unknown
}
