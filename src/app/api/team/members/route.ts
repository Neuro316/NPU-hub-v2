// /api/team/members  Team management writes (team_profiles), moved off the browser (2026-11-08, hub_232).
//   POST   { org_id, member: {...} }   add a member (status 'invited' unless given)
//   PATCH  { id, updates: {...} }      change a member
//   DELETE { id }                      remove a member
//
// team_profiles grants Hub access (withStaff, requireOrgMember, accounting), so it can never vouch for itself: an
// org admin here is decided WITHOUT it (strictOrgAdmin: org_members owner/admin, or profiles admin/superadmin with
// an org_members row). Admins may set the fields below on any row of their org; anyone may change only the
// harmless profile fields of their OWN row. user_id and org_id are never taken from the request. Only a platform
// superadmin may grant super_admin.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { strictOrgAdmin } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

const ROLES = ['super_admin', 'admin', 'team_member', 'facilitator', 'participant']
const STATUSES = ['active', 'inactive', 'invited', 'pending']
const ADMIN_FIELDS = ['display_name', 'email', 'role', 'job_title', 'avatar_url', 'slack_user_id', 'slack_display_name', 'phone', 'status', 'permissions']
const SELF_FIELDS = ['display_name', 'job_title', 'avatar_url', 'slack_user_id', 'slack_display_name', 'phone']
const IGNORED = ['id', 'org_id', 'user_id', 'created_at', 'updated_at']
const UUID = /^[0-9a-f-]{36}$/i

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

async function caller() {
  const { data: { user } } = await createServerSupabase().auth.getUser()
  if (!user) return null
  const db = createAdminSupabase()
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return { userId: user.id, db, platformSuperadmin: (p as any)?.role === 'superadmin' }
}

/** The allowed fields of a patch, validated; a string error when something is not allowed. */
function pick(input: unknown, fields: string[], platformSuperadmin: boolean): Record<string, unknown> | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Nothing to save.'
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (IGNORED.includes(k)) continue
    if (!fields.includes(k)) return `${k} cannot be changed here.`
    if (k === 'role' && (typeof v !== 'string' || !ROLES.includes(v))) return 'Unknown role.'
    if (k === 'role' && v === 'super_admin' && !platformSuperadmin) return 'Only a platform superadmin can grant super admin.'
    if (k === 'status' && (typeof v !== 'string' || !STATUSES.includes(v))) return 'Unknown status.'
    if (k === 'permissions') {
      if (v !== null && (typeof v !== 'object' || Array.isArray(v))) return 'Invalid permissions.'
    } else if (v !== null && typeof v !== 'string') return `${k} must be text.`
    if (typeof v === 'string' && v.length > 500) return `${k} is too long.`
    out[k] = v
  }
  return out
}

export async function POST(req: NextRequest) {
  const c = await caller()
  if (!c) return json({ error: 'Sign in again to continue.' }, 401)
  const body = await req.json().catch(() => ({} as any))
  const orgId = body?.org_id
  if (typeof orgId !== 'string' || !UUID.test(orgId)) return json({ error: 'org_id required' }, 400)
  if (!(await strictOrgAdmin(c.db, c.userId, orgId))) return json({ error: 'Only org admins can add members.' }, 403)
  const fields = pick(body?.member, ADMIN_FIELDS, c.platformSuperadmin)
  if (typeof fields === 'string') return json({ error: fields }, 400)
  const { data, error } = await c.db.from('team_profiles').insert({ status: 'invited', ...fields, org_id: orgId }).select().single()
  if (error) {
    console.error(`[team/members] add org=${orgId} failed: ${error.code ?? 'unknown'}`)
    return json({ error: 'The member could not be added.' }, 500)
  }
  return json({ data })
}

export async function PATCH(req: NextRequest) {
  const c = await caller()
  if (!c) return json({ error: 'Sign in again to continue.' }, 401)
  const body = await req.json().catch(() => ({} as any))
  const id = body?.id
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'id required' }, 400)
  const { data: row } = await c.db.from('team_profiles').select('id, org_id, user_id').eq('id', id).maybeSingle()
  if (!row) return json({ error: 'Not found.' }, 404)
  const admin = await strictOrgAdmin(c.db, c.userId, (row as any).org_id)
  const own = (row as any).user_id === c.userId
  if (!admin && !own) return json({ error: 'Only org admins can change other members.' }, 403)
  const fields = pick(body?.updates, admin ? ADMIN_FIELDS : SELF_FIELDS, c.platformSuperadmin)
  if (typeof fields === 'string') return json({ error: fields }, admin ? 400 : 403)
  const { data, error } = await c.db.from('team_profiles').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) {
    console.error(`[team/members] update ${id} failed: ${error.code ?? 'unknown'}`)
    return json({ error: 'The member could not be saved.' }, 500)
  }
  return json({ data })
}

export async function DELETE(req: NextRequest) {
  const c = await caller()
  if (!c) return json({ error: 'Sign in again to continue.' }, 401)
  const body = await req.json().catch(() => ({} as any))
  const id = body?.id
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'id required' }, 400)
  const { data: row } = await c.db.from('team_profiles').select('id, org_id').eq('id', id).maybeSingle()
  if (!row) return json({ error: 'Not found.' }, 404)
  if (!(await strictOrgAdmin(c.db, c.userId, (row as any).org_id))) return json({ error: 'Only org admins can remove members.' }, 403)
  const { error } = await c.db.from('team_profiles').delete().eq('id', id)
  if (error) {
    console.error(`[team/members] delete ${id} failed: ${error.code ?? 'unknown'}`)
    return json({ error: 'The member could not be removed.' }, 500)
  }
  return json({ ok: true })
}
