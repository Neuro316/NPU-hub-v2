// PUT /api/settings/credential { org_id, setting_key, field, value }
// Write-only: saves one credential field (Slack bot token, Twilio auth token, AI keys, ...). Ruled 2026-11-08.
// Org admins only (team admin/super_admin, or platform superadmin). A Vault field goes to Vault and is blanked in
// org_settings; slack_config.webhook_url stays in org_settings (service role). An empty value clears it.
// Nothing is ever returned but { ok, set }, and nothing is logged but ids and the key and field names.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { isCredentialField } from '@/lib/org-vault-fields'
import { writeOrgCredential } from '@/lib/org-vault'

export const dynamic = 'force-dynamic'

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as any))
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (!isOrgAdmin(ctx, orgId)) return forbidden('Only org admins can change credentials.')
  const key = body?.setting_key, field = body?.field, value = body?.value
  if (typeof key !== 'string' || typeof field !== 'string' || !isCredentialField(key, field)) return bad('Not a credential field.')
  if (typeof value !== 'string' || value.length > 4000) return bad('Value must be text.')
  try {
    await writeOrgCredential(ctx.db, orgId, key, field, value)
    console.info(`[settings/credential] org=${orgId} ${key}.${field} ${value.trim() ? 'set' : 'cleared'} by ${ctx.userId}`)
    return NextResponse.json({ ok: true, set: !!value.trim() })
  } catch (e: any) {
    console.error(`[settings/credential] org=${orgId} ${key}.${field} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    return NextResponse.json({ error: 'The credential could not be saved. Try again.' }, { status: 500 })
  }
})
