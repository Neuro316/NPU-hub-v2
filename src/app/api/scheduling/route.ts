// GET /api/scheduling
// Everything on the signed-in user's Rules page, and nothing of anyone else's: every
// query is filtered to owner_user_id = the caller. Reply rules and the mailbox list
// cover only mailboxes the caller connected.
import { NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req, ctx) => {
  const own = (table: string, columns = '*') => ctx.db.from(table).select(columns).eq('owner_user_id', ctx.userId)
  const [settings, windows, blocked, kidsHome, recurring, overrides, oneOff, senders, replyRules, exceptions, mailboxes] = await Promise.all([
    own('hub_sched_settings').maybeSingle(),
    own('hub_sched_category_windows').order('category').order('day_kind').order('start_time'),
    own('hub_sched_blocked_windows').order('day_kind').order('start_time'),
    own('hub_sched_kids_home_dates').order('date'),
    own('hub_sched_recurring_blocks').order('name'),
    own('hub_sched_recurring_overrides').order('date'),
    own('hub_sched_one_off_blocks').order('starts_at', { ascending: false }).limit(200),
    own('hub_sched_trusted_senders').order('display_name'),
    own('hub_sched_reply_rules'),
    own('hub_sched_exception_requests').order('created_at', { ascending: false }).limit(100),
    own('hub_mail_connections', 'id, email_address, status').order('email_address'),
  ])
  const failed = [settings, windows, blocked, kidsHome, recurring, overrides, oneOff, senders, replyRules, exceptions, mailboxes].find(r => r.error)
  if (failed) return NextResponse.json({ error: 'Your scheduling rules could not be loaded.' }, { status: 500 })
  return NextResponse.json({
    settings: settings.data,
    category_windows: windows.data,
    blocked_windows: blocked.data,
    kids_home_dates: kidsHome.data,
    recurring_blocks: recurring.data,
    recurring_overrides: overrides.data,
    one_off_blocks: oneOff.data,
    trusted_senders: senders.data,
    reply_rules: replyRules.data,
    exception_requests: exceptions.data,
    mailboxes: mailboxes.data,
  })
})
