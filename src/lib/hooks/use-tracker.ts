'use client'

// ═══════════════════════════════════════════════════════════════
// Usage Tracker — Client-side telemetry for NPU Hub
// Tracks: page views, feature clicks, errors, searches, time on page
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

// ─── Device detection ───
function getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

// ─── Category mapping from path ───
function getCategory(path: string): string {
  if (path.startsWith('/crm')) return 'crm'
  if (path.startsWith('/ehr')) return 'ehr'
  if (path.startsWith('/social') || path.startsWith('/media')) return 'content'
  if (path.startsWith('/settings') || path.startsWith('/team') || path.startsWith('/integrations') || path.startsWith('/auditor') || path.startsWith('/activity-log')) return 'admin'
  if (path.startsWith('/campaigns') || path.startsWith('/journeys') || path.startsWith('/analytics')) return 'marketing'
  if (path.startsWith('/tasks') || path.startsWith('/sops') || path.startsWith('/tickets')) return 'operations'
  if (path === '/') return 'dashboard'
  return 'other'
}

// ─── Event queue for batching ───
interface QueuedEvent {
  event_type: string
  event_category: string
  event_target: string
  event_data: Record<string, unknown>
  duration_ms?: number
  device_type: string
  occurred_at: string
}

let eventQueue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

async function flushQueue(orgId: string, userId: string) {
  if (eventQueue.length === 0) return
  const batch = [...eventQueue]
  eventQueue = []

  const supabase = createClient()
  const rows = batch.map(e => ({
    org_id: orgId,
    user_id: userId,
    ...e,
  }))

  try {
    await supabase.from('usage_events').insert(rows)
  } catch (err) {
    // Silent fail — telemetry should never break the app
    console.debug('Usage tracking flush failed:', err)
  }
}

function queueEvent(event: QueuedEvent, orgId: string, userId: string) {
  eventQueue.push(event)

  // Flush every 10 events or every 30 seconds
  if (eventQueue.length >= 10) {
    flushQueue(orgId, userId)
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushQueue(orgId, userId)
      flushTimer = null
    }, 30000)
  }
}

// ─── Main tracking hook — drop into dashboard layout ───
export function useTracker() {
  const pathname = usePathname()
  const { currentOrg, user } = useWorkspace()
  const pageEnteredAt = useRef<number>(Date.now())
  const lastPath = useRef<string>('')

  const orgId = currentOrg?.id
  const userId = user?.id

  // Track page view + time on previous page
  useEffect(() => {
    if (!orgId || !userId || !pathname) return

    // Log time on previous page
    if (lastPath.current && lastPath.current !== pathname) {
      const duration = Date.now() - pageEnteredAt.current
      queueEvent({
        event_type: 'page_exit',
        event_category: getCategory(lastPath.current),
        event_target: lastPath.current,
        event_data: {},
        duration_ms: duration,
        device_type: getDeviceType(),
        occurred_at: new Date().toISOString(),
      }, orgId, userId)
    }

    // Log new page view
    queueEvent({
      event_type: 'page_view',
      event_category: getCategory(pathname),
      event_target: pathname,
      event_data: {
        referrer: lastPath.current || null,
      },
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
    }, orgId, userId)

    lastPath.current = pathname
    pageEnteredAt.current = Date.now()
  }, [pathname, orgId, userId])

  // Track login event (once per session)
  useEffect(() => {
    if (!orgId || !userId) return
    const sessionKey = `tracked_login_${userId}`
    if (sessionStorage.getItem(sessionKey)) return

    queueEvent({
      event_type: 'login',
      event_category: 'auth',
      event_target: '/',
      event_data: {
        device: getDeviceType(),
        screen_width: typeof window !== 'undefined' ? window.innerWidth : 0,
      },
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
    }, orgId, userId)

    sessionStorage.setItem(sessionKey, '1')
  }, [orgId, userId])

  // Flush on page unload
  useEffect(() => {
    if (!orgId || !userId) return

    const handleUnload = () => {
      // Log final page time
      if (lastPath.current) {
        eventQueue.push({
          event_type: 'page_exit',
          event_category: getCategory(lastPath.current),
          event_target: lastPath.current,
          event_data: {},
          duration_ms: Date.now() - pageEnteredAt.current,
          device_type: getDeviceType(),
          occurred_at: new Date().toISOString(),
        })
      }

      // Use sendBeacon for reliable delivery on close
      if (eventQueue.length > 0 && navigator.sendBeacon) {
        const rows = eventQueue.map(e => ({ org_id: orgId, user_id: userId, ...e }))
        // Can't use supabase client in sendBeacon, so fire-and-forget via API
        navigator.sendBeacon('/api/usage/batch', JSON.stringify({ events: rows }))
        eventQueue = []
      }
    }

    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [orgId, userId])

  // Global error tracking
  useEffect(() => {
    if (!orgId || !userId) return

    const handleError = (event: ErrorEvent) => {
      queueEvent({
        event_type: 'error',
        event_category: 'client',
        event_target: pathname || '/',
        event_data: {
          message: event.message,
          source: event.filename,
          line: event.lineno,
          col: event.colno,
        },
        device_type: getDeviceType(),
        occurred_at: new Date().toISOString(),
      }, orgId, userId)
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      queueEvent({
        event_type: 'error',
        event_category: 'client',
        event_target: pathname || '/',
        event_data: {
          message: String(event.reason),
          type: 'unhandled_promise',
        },
        device_type: getDeviceType(),
        occurred_at: new Date().toISOString(),
      }, orgId, userId)
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [orgId, userId, pathname])

  // ─── Manual tracking functions ───
  const trackFeature = useCallback((featureName: string, data?: Record<string, unknown>) => {
    if (!orgId || !userId) return
    queueEvent({
      event_type: 'feature_click',
      event_category: getCategory(pathname || '/'),
      event_target: featureName,
      event_data: { page: pathname, ...data },
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
    }, orgId, userId)
  }, [orgId, userId, pathname])

  const trackSearch = useCallback((query: string, resultCount?: number) => {
    if (!orgId || !userId) return
    queueEvent({
      event_type: 'search',
      event_category: getCategory(pathname || '/'),
      event_target: pathname || '/',
      event_data: { query, result_count: resultCount, page: pathname },
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
    }, orgId, userId)
  }, [orgId, userId, pathname])

  const trackAI = useCallback((aiFeature: string, data?: Record<string, unknown>) => {
    if (!orgId || !userId) return
    queueEvent({
      event_type: 'ai_usage',
      event_category: 'ai',
      event_target: aiFeature,
      event_data: { page: pathname, ...data },
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
    }, orgId, userId)
  }, [orgId, userId, pathname])

  return { trackFeature, trackSearch, trackAI }
}
