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

export function createAdminSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
