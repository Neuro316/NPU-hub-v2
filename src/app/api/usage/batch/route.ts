import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// POST /api/usage/batch — receives batched usage events from sendBeacon
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const events = body.events

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true })
    }

    // Cap batch size to prevent abuse
    const capped = events.slice(0, 50)
    const supabase = createAdminSupabase()

    await supabase.from('usage_events').insert(capped)

    return NextResponse.json({ ok: true, count: capped.length })
  } catch {
    // Never fail — telemetry endpoint must be silent
    return NextResponse.json({ ok: true })
  }
}
