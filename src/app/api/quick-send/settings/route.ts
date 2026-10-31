// src/app/api/quick-send/settings/route.ts
// The org's Quick Send sender (org_settings 'crm_quick_send'). Admins only.
//
// POST { org_id, from_email, from_name }
//
// Read-merge-write, so keys this form does not know about are kept.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { QUICK_SEND_SETTING_KEY, isValidEmail } from '@/lib/quick-send'
import { loadSettings } from '@/lib/quick-send-server'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (!isOrgAdmin(ctx, orgId)) return forbidden('Only an admin can change the Quick Send sender.')

  const fromEmail = typeof body?.from_email === 'string' ? body.from_email.trim().toLowerCase() : ''
  const fromName = typeof body?.from_name === 'string' ? body.from_name.replace(/[<>"\r\n]/g, '').trim().slice(0, 80) : ''
  if (!isValidEmail(fromEmail)) return bad('Enter a valid From address.')

  const { raw } = await loadSettings(ctx.db, orgId)
  const value = { ...raw, from_email: fromEmail, from_name: fromName || null, updated_by: ctx.userId, updated_at: new Date().toISOString() }
  const { error } = await ctx.db.from('org_settings').upsert(
    { org_id: orgId, setting_key: QUICK_SEND_SETTING_KEY, setting_value: value, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,setting_key' },
  )
  if (error) return NextResponse.json({ error: `The sender could not be saved: ${error.message}` }, { status: 500 })
  const { settings } = await loadSettings(ctx.db, orgId)
  return NextResponse.json({ ok: true, settings })
})
