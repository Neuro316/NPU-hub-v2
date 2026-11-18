// src/lib/mail/search-auth.ts
// Auth for POST /api/agent/mail-search (Running List q26). Two ways in, and nothing else:
//
//   1. A signed-in session whose user is a platform superadmin. The caller is that user.
//   2. Authorization: Bearer <MAIL_SEARCH_AGENT_SECRET>, for the scheduled Morning Call Prep task. The secret maps
//      to exactly one owner, MAIL_SEARCH_AGENT_USER_ID, and the caller is that user. The token is compared in
//      constant time (sha256 of both, timingSafeEqual). An unset or short secret, an unset or malformed owner id,
//      or a wrong token is refused 401. A request that sends an Authorization header is judged ONLY by it: a bad
//      token never falls back to the cookie session.
//
// Either way the caller's orgs and superadmin flag are read here the way withStaff reads them (active
// team_profiles in a staff role, profiles.role), and the caller must be a platform superadmin, because mailbox
// visibility (src/lib/mail/google.ts canSee) is a superadmin rule.
//
// The route is listed as a public path in src/lib/supabase-middleware.ts (exact path) so the scheduled task, which
// has no cookie, is not redirected to /login. THIS wrapper is its gate. Guard G1 recognises withMailSearchAuth.
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'
import { STAFF_TEAM_ROLES, type StaffContext } from '@/lib/api-guard'

export type CallerVia = 'session' | 'agent_key'
export interface SearchCaller extends StaffContext { via: CallerVia }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MIN_SECRET_CHARS = 32

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/**
 * Pure. The owner a Bearer header maps to, or null. Fails closed on an unset or short secret, an unset or
 * malformed owner id, a missing or non-Bearer header, or a token that does not match.
 */
export function agentCaller(header: string | null, secret: string | undefined, ownerId: string | undefined): string | null {
  if (!secret || secret.trim().length < MIN_SECRET_CHARS) return null
  if (!ownerId || !UUID.test(ownerId)) return null
  const m = /^Bearer ([^\s]+)$/.exec(header ?? '')
  if (!m) return null
  return timingSafeEqual(sha(m[1]), sha(secret.trim())) ? ownerId : null
}

/** The caller's staff context, read as withStaff reads it. Null on a read error or no staff org. */
export async function staffContextFor(db: SupabaseClient, userId: string): Promise<StaffContext | null> {
  const [{ data: tps, error }, { data: prof }] = await Promise.all([
    db.from('team_profiles').select('org_id, role').eq('user_id', userId).eq('status', 'active'),
    db.from('profiles').select('role').eq('id', userId).maybeSingle(),
  ])
  if (error) return null
  const orgRoles: Record<string, string> = {}
  for (const t of (tps ?? []) as any[]) {
    const role = String(t.role ?? 'team_member')
    if (STAFF_TEAM_ROLES.includes(role)) orgRoles[t.org_id] = role
  }
  const orgIds = Object.keys(orgRoles)
  if (!orgIds.length) return null
  return { userId, orgIds, orgRoles, isSuperadmin: (prof as any)?.role === 'superadmin', db }
}

const deny = (status: number, error: string) => NextResponse.json({ error }, { status })

export function withMailSearchAuth(handler: (req: NextRequest, caller: SearchCaller) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    const db = createAdminSupabase()
    const header = req.headers.get('authorization')
    let userId: string | null
    let via: CallerVia
    if (header !== null) {
      userId = agentCaller(header, process.env.MAIL_SEARCH_AGENT_SECRET, process.env.MAIL_SEARCH_AGENT_USER_ID)
      via = 'agent_key'
      if (!userId) return deny(401, 'Not authorized.')
    } else {
      const { data: { user } } = await createServerSupabase().auth.getUser()
      if (!user) return deny(401, 'Sign in again to continue.')
      userId = user.id
      via = 'session'
    }
    const ctx = await staffContextFor(db, userId)
    if (!ctx || !ctx.isSuperadmin) return deny(403, 'Mail search is for platform superadmins.')
    return handler(req, { ...ctx, via })
  }
}
