'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { SSEEvent } from '@/lib/types'
import { getToken } from '@/lib/auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''
const MAX_BACKOFF = 30000 // 30s max between reconnects

export function useSSE(onEvent?: (event: SSEEvent) => void) {
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  const backoffRef = useRef(2000)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    // Clear any pending reconnect timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }

    const token = getToken()
    if (!token) {
      setConnected(false)
      return
    }

    const url = `${BASE_URL}/api/events?token=${encodeURIComponent(token)}`
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      backoffRef.current = 2000 // Reset backoff on success
    }

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent
        onEventRef.current?.(data)
      } catch {
        // heartbeat or malformed
      }
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
      sourceRef.current = null
      // Exponential backoff: 2s → 4s → 8s → 16s → 30s max
      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF)
      timerRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }
    }
  }, [connect])

  return { connected }
}
