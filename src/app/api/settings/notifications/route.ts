// /api/settings/notifications?org_id=  Hub › Settings › Notifications (Running List q22). Org admins only
// (strictOrgAdmin, which does not trust team_profiles), service role behind it.
//   GET  the rules (defaults filled in), the mode, and the org's active staff to choose recipients from
//   PUT  { org_id, mode, rules }: every recipient must be active staff of the org. Live cannot be switched on here:
//        it is a separate go after Cameron sees a preview (set by the Hub chat). A live org can be turned down.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, strictOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { loadSettings, DEFAULT_OWNER } from '@/lib/notify/settings'
import { NOTIFICATION_TYPES, parseSettings } from '@/lib/notify/rules'

export const dynamic = 'force-dynamic'

async function staff(db: any, orgId: string) {
  const { data } = await db.from('team_profiles').select('user_id, display_name, role').eq('org_id', orgId).eq('status', 'active')
    .in('role', ['super_admin', 'admin', 'team_member'])
  return ((data ?? []) as any[]).filter((t) => t.user_id).map((t) => ({ user_id: t.user_id as string, name: (t.display_name as string) || 'Team member' }))
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  if (!(await strictOrgAdmin(ctx.db, ctx.userId, orgId))) return forbidden('Only org admins can change notifications.')
  const s = await loadSettings(ctx.db, orgId)
  return NextResponse.json({ mode: s.mode, rules: s.rules, types: NOTIFICATION_TYPES, staff: await staff(ctx.db, orgId) })
})

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as any))
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (!(await strictOrgAdmin(ctx.db, ctx.userId, orgId))) return forbidden('Only org admins can change notifications.')
  const current = await loadSettings(ctx.db, orgId)
  const next = parseSettings({ mode: body?.mode, rules: body?.rules }, DEFAULT_OWNER)
  if (next.mode === 'live' && current.mode !== 'live') return bad('Live is a separate go after a preview. Choose Off or Preview here.')
  const allowed = new Set((await staff(ctx.db, orgId)).map((s) => s.user_id))
  for (const [key, r] of Object.entries(next.rules)) {
    if (r.recipient && !allowed.has(r.recipient)) return bad(`The recipient for ${key} is not active staff of this organization.`)
  }
  const { error } = await ctx.db.from('org_settings').upsert({ org_id: orgId, setting_key: 'hub_notifications', setting_value: next, updated_at: new Date().toISOString() }, { onConflict: 'org_id,setting_key' })
  if (error) return NextResponse.json({ error: 'Notifications could not be saved. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true, mode: next.mode, rules: next.rules })
})
