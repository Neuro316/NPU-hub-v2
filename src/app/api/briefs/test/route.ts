// POST /api/briefs/test  { date?: 'tomorrow' }
// Superadmin only. Builds the morning brief and SENDS it now to the configured recipient (org_settings
// 'hub_sched_agent'.recipient_user_id), whatever the hour and whether or not the agent is on. Writes no
// hub_brief_runs row, so the real 8 AM brief still goes out. { date: 'tomorrow' } builds tomorrow's (ET) brief
// as a preview. Answers { slack, sms, chars }: codes and a length, never the text.
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { realSenders } from '@/lib/lead-alerts/senders'
import { sendBriefNow } from '@/lib/briefs/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a superadmin can send a test brief.')
  const body = await req.json().catch(() => ({}))
  const date = body?.date
  if (date !== undefined && date !== 'today' && date !== 'tomorrow') return bad("date must be 'today' or 'tomorrow'.")
  if (body?.kind !== undefined && body.kind !== 'morning') return bad("Only the morning brief exists.")
  try {
    const r = await sendBriefNow({ db: ctx.db, now: () => new Date(), senders: realSenders }, { tomorrow: date === 'tomorrow' })
    if ('error' in r) return NextResponse.json({ error: 'No recipient is configured in hub_sched_agent.' }, { status: 409 })
    return NextResponse.json(r)
  } catch (e) {
    console.error(`[briefs/test] failed: ${String((e as Error)?.message ?? 'error').replace(/[^\w-]/g, '').slice(0, 60)}`)
    return NextResponse.json({ error: 'The brief could not be built.' }, { status: 500 })
  }
})
