// PUT /api/scheduling/settings {timezone, earliest_start, school_year_end}
// The caller's own settings row, created on first save.
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { SETTINGS_FIELDS, Invalid } from '@/lib/scheduling/rules'

export const dynamic = 'force-dynamic'

export const PUT = withStaff(async (req, ctx) => {
  const body = await req.json().catch(() => ({}))
  let row
  try { row = SETTINGS_FIELDS(body) } catch (e) { if (e instanceof Invalid) return bad(e.message); throw e }
  const { data, error } = await ctx.db.from('hub_sched_settings')
    .upsert({ ...row, owner_user_id: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: 'owner_user_id' })
    .select('*').single()
  if (error) return NextResponse.json({ error: 'Settings could not be saved.' }, { status: 500 })
  return NextResponse.json({ settings: data })
})
