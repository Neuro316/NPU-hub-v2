// ═══════════════════════════════════════════════════════════════
// Supabase helpers for API routes (CRM module compatibility)
// ═══════════════════════════════════════════════════════════════

import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function createServerSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // @ts-ignore - cookies() may be sync or async depending on Next.js version
          return typeof cookieStore.then === 'function' ? [] : cookieStore.getAll()
        },
        setAll() {},
      },
    }
  )
}

// Every request this client makes bypasses the Next.js Data Cache. Without it, a POST
// that repeats with an identical body (an rpc such as process_entry_events or
// gate_check) inside a GET route handler is answered from the cache and never reaches
// the database: measured 2026-10-01, three entry-events cron runs and one database
// call, with a queued event left unprocessed. force-dynamic does not prevent it.
// Service-role reads must always be fresh, so the whole factory is no-store.
export function createAdminSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) } }
  )
}
