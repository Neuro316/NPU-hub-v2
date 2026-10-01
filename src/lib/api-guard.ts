// src/lib/api-guard.ts
// The auth wrapper for service-role routes added by the marketing build.
//
// The route uses the service role (which bypasses RLS), so THIS check is the
// boundary: the caller is authenticated from the cookie session, and the orgs they
// may act in come from ACTIVE team_profiles membership (ruling 17), never from the
// request body and never from profiles.organization_id. `isSuperadmin` is read from
// profiles.role and is used only for the live-send switch and the flags (ruling 10).
//
// A route that returns 401 directly avoids the redirect trap recorded in CURRENT.md:
// middleware 307s an unauthenticated API call to /login and fetch() reads the login
// page as a 200. These routes answer JSON 401 and 403 themselves.
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'

export interface StaffContext {
  userId: string
  orgIds: string[]
  /** team_profiles.role per org: super_admin | admin | team_member | facilitator | participant */
  orgRoles: Record<string, string>
  isSuperadmin: boolean
  db: SupabaseClient
}

export type StaffHandler<P> = (req: NextRequest, ctx: StaffContext, params: P) => Promise<Response>

export function withStaff<P = Record<string, string>>(handler: StaffHandler<P>) {
  return async (req: NextRequest, route: { params: P }): Promise<Response> => {
    const { data: { user } } = await createServerSupabase().auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in again to continue.' }, { status: 401 })
    const db = createAdminSupabase()
    const [{ data: tps, error: tErr }, { data: prof }] = await Promise.all([
      db.from('team_profiles').select('org_id, role').eq('user_id', user.id).eq('status', 'active'),
      db.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    ])
    if (tErr) return NextResponse.json({ error: 'Your access could not be checked. Try again.' }, { status: 503 })
    const orgRoles: Record<string, string> = {}
    for (const t of tps ?? []) orgRoles[(t as any).org_id] = String((t as any).role ?? 'team_member')
    const orgIds = Object.keys(orgRoles)
    if (!orgIds.length) return NextResponse.json({ error: 'You are not a team member of any organization.' }, { status: 403 })
    return handler(req, { userId: user.id, orgIds, orgRoles, isSuperadmin: prof?.role === 'superadmin', db }, route?.params ?? ({} as P))
  }
}

/** The org the caller asked for, if they are a member of it; otherwise a 403 response. */
export function requireOrg(ctx: StaffContext, orgId: unknown): string | Response {
  if (typeof orgId !== 'string' || !ctx.orgIds.includes(orgId)) {
    return NextResponse.json({ error: 'You do not have access to that organization.' }, { status: 403 })
  }
  return orgId
}

/** Members whose team role is admin or super_admin in that org, or a platform superadmin. */
export function isOrgAdmin(ctx: StaffContext, orgId: string): boolean {
  return ctx.isSuperadmin || ['admin', 'super_admin'].includes(ctx.orgRoles[orgId] ?? '')
}

export const forbidden = (msg: string) => NextResponse.json({ error: msg }, { status: 403 })
export const bad = (msg: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error: msg, ...extra }, { status: 400 })
