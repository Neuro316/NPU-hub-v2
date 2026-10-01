// POST /api/marketing/settings   (org admins and platform superadmins)
// Sender, reply-to, quiet hours and frequency cap, stored in org_settings key
// hub_send_policy. Defaults stay in public.hub_send_policy(); only the keys given here
// are overridden. The sender is never hardcoded anywhere else.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { senderProblem, getSendPolicy } from '@/lib/marketing/policy'

export const dynamic = 'force-dynamic'
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an admin of this organization can change sending settings.')
  const p: Record<string, unknown> = {}
  if (typeof b.from_address === 'string') p.from_address = b.from_address.trim()
  if (typeof b.from_domain === 'string') p.from_domain = b.from_domain.trim().toLowerCase()
  if (typeof b.reply_to === 'string') p.reply_to = b.reply_to.trim()
  if (b.quiet_start !== undefined) { if (!HHMM.test(b.quiet_start)) return bad('Use a 24 hour time like 08:00 for the start of the send window.'); p.quiet_start = b.quiet_start }
  if (b.quiet_end !== undefined) { if (!HHMM.test(b.quiet_end)) return bad('Use a 24 hour time like 20:00 for the end of the send window.'); p.quiet_end = b.quiet_end }
  if (b.default_timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(b.default_timezone) }) } catch { return bad('That time zone is not recognised. Use a name like America/New_York.') }
    p.default_timezone = String(b.default_timezone)
  }
  if (b.cap_count !== undefined) { const n = Number(b.cap_count); if (!Number.isInteger(n) || n < 1 || n > 20) return bad('The cap is a whole number from 1 to 20.'); p.cap_count = n }
  if (b.cap_days !== undefined) { const n = Number(b.cap_days); if (!Number.isInteger(n) || n < 1 || n > 60) return bad('The cap window is a whole number of days from 1 to 60.'); p.cap_days = n }

  const { data: cur } = await ctx.db.from('org_settings').select('setting_value').eq('org_id', org).eq('setting_key', 'hub_send_policy').maybeSingle()
  const next = { ...((cur?.setting_value as object) ?? {}), ...p }
  // judge the window as it will be stored, defaults included, so setting one end alone cannot empty it
  const effective = { ...((await getSendPolicy(ctx.db, org)) ?? {}), ...next } as Record<string, unknown>
  if (String(effective.quiet_start ?? '08:00') >= String(effective.quiet_end ?? '20:00')) return bad('The send window must start before it ends.')
  if ((next as any).from_address !== undefined || (next as any).from_domain !== undefined) {
    const problem = senderProblem({ from_address: String((next as any).from_address ?? ''), from_domain: String((next as any).from_domain ?? '') })
    if (problem && problem !== 'sender_is_placeholder') return bad('The sender address must be on the sending domain, for example News <hello@mail.example.com> on mail.example.com.', { problem })
  }
  const { error } = await ctx.db.from('org_settings').upsert({ org_id: org, setting_key: 'hub_send_policy', setting_value: next, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,setting_key' })
  if (error) return NextResponse.json({ error: 'The settings could not be saved.' }, { status: 500 })
  return NextResponse.json({ policy: await getSendPolicy(ctx.db, org) })
})
