import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { ADMIN_ROLES } from '@/lib/org-settings-keys'
import { carriesCredential, credentialFields } from '@/lib/org-vault-fields'

/**
 * PUT /api/settings — upsert a single org_settings row (service role).
 * Body: { org_id, setting_key, setting_value }
 * A value carrying a credential field is refused: credentials go through PUT /api/settings/credential (2026-11-08).
 * The stored credential fields of the key are kept as they are (a settings screen saves the rest without them), so
 * this is the route for saving the non-credential fields of a credential-bearing key (slack_config, crm_twilio, ...).
 */
export async function PUT(req: NextRequest) {
  try {
    const admin = createAdminSupabase()

    // Verify the caller is authenticated
    const supabaseUser = createServerSupabase()
    const { data: { user } } = await supabaseUser.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { org_id, setting_key, setting_value } = body

    if (!org_id || !setting_key) {
      return NextResponse.json({ error: 'org_id and setting_key are required' }, { status: 400 })
    }
    if (carriesCredential(setting_key, setting_value)) {
      return NextResponse.json({ error: 'Credentials are saved separately (write-only). Leave them blank here.' }, { status: 400 })
    }

    // Verify user belongs to this org.
    // NOTE: the column is organization_id. The previous `.eq('org_id', org_id)`
    // always errored (no such column), so membership was always null and every
    // caller fell through to the team_profiles branch below — which the orphan
    // profiles minted by the workspace-context auto-join satisfied. (NPU R0.4)
    const { data: membership } = await admin
      .from('org_members')
      .select('id, role')
      .eq('organization_id', org_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }

    // All org_settings writes require an org admin: a platform admin/superadmin, or (2026-11-08, matching
    // /api/settings/read and hub_232) an active team admin/super_admin of this org.
    const [{ data: profile }, { data: teamAdmin }] = await Promise.all([
      admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      admin.from('team_profiles').select('id').eq('user_id', user.id).eq('org_id', org_id).eq('status', 'active')
        .in('role', ['admin', 'super_admin']).limit(1),
    ])

    if (!(profile && ADMIN_ROLES.has(profile.role)) && !teamAdmin?.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // keep the stored credential fields (never sent by a browser)
    let value = setting_value
    const keep = credentialFields(setting_key)
    if (keep.length && value && typeof value === 'object' && !Array.isArray(value)) {
      const { data: cur, error: cErr } = await admin.from('org_settings').select('setting_value').eq('org_id', org_id).eq('setting_key', setting_key).maybeSingle()
      if (cErr) return NextResponse.json({ error: 'The setting could not be read.' }, { status: 500 })
      const stored = (cur as any)?.setting_value
      value = { ...value }
      for (const f of keep) if (stored && typeof stored === 'object' && f in stored) value[f] = stored[f]
    }

    // Upsert with service role (bypasses RLS)
    const { error } = await admin.from('org_settings').upsert(
      { org_id, setting_key, setting_value: value },
      { onConflict: 'org_id,setting_key' }
    )

    if (error) {
      console.error(`[API settings] upsert ${setting_key} failed: ${error.code ?? 'unknown'}`)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error(`[API settings] failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
