'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { SSEEvent } from '@/lib/types'

const SSE_URL = `${process.env.NEXT_PUBLIC_API_URL || ''}/api/events`

export function useSSE(onEvent?: (event: SSEEvent) => void) {
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const source = new EventSource(SSE_URL)
    sourceRef.current = source

    source.onopen = () => setConnected(true)

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
      // Reconnect after 5s
      setTimeout(connect, 5000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      sourceRef.current?.close()
    }
  }, [connect])

  return { connected }
}
