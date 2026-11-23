// src/lib/mail/also-visible.ts
// Settings, Mailboxes: the owner's "Also visible to" list (hub_249). Server only. The route
// (src/app/api/mail/connections/route.ts) calls these. A listed user sees the mailbox exactly as the owner does
// (ownerEquivalent, src/lib/mail/access.ts), but only the OWNER may change the list (isOwner). Each change is logged in
// job_runs (job 'mailbox-also-visible-to': who, mailbox, user, added or removed).
import { NextResponse } from 'next/server'
import { forbidden, bad, type StaffContext } from '@/lib/api-guard'
import { loadVisible, CONNECTION_COLUMNS, type MailConnectionRow } from '@/lib/mail/google'
import { isOwner, withAlso } from '@/lib/mail/access'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF_TEAM_ROLES = ['super_admin', 'admin', 'team_member']
export const AUDIT_JOB = 'mailbox-also-visible-to'

export interface Person { user_id: string; name: string }

/** Active staff of the org (team_profiles), by name: the people an owner may list. */
export async function staffOf(ctx: StaffContext, orgId: string): Promise<Person[]> {
  const { data } = await ctx.db.from('team_profiles').select('user_id, display_name, role, status').eq('org_id', orgId).eq('status', 'active')
  return ((data ?? []) as any[]).filter((t) => t.user_id && STAFF_TEAM_ROLES.includes(t.role))
    .map((t) => ({ user_id: t.user_id as string, name: String(t.display_name ?? '').trim() || 'Unnamed teammate' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function view(row: MailConnectionRow, userId: string, staff: Person[] | null) {
  const owner = isOwner({ userId }, row)
  const listed = row.also_visible_to ?? []
  return {
    id: row.id,
    email_address: row.email_address,
    visibility: row.visibility,
    status: row.status,
    connected_at: row.connected_at,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    is_owner: owner,
    // the list and the people to choose from: the owner only
    also_visible_to: owner && staff ? listed.map((id) => ({ user_id: id, name: staff.find((p) => p.user_id === id)?.name ?? 'Former teammate' })) : undefined,
    can_list: owner && staff ? staff.filter((p) => p.user_id !== row.owner_user_id && !listed.includes(p.user_id)) : undefined,
  }
}

/** The owner's list change. Pure checks first; nothing is written unless the caller owns the mailbox. */
export async function changeList(ctx: StaffContext, body: any): Promise<Response> {
  const adding = typeof body.add_viewer === 'string'
  const target = adding ? body.add_viewer : body.remove_viewer
  if (typeof target !== 'string' || !UUID.test(target)) return bad('Choose a teammate.')
  const row = await loadVisible(ctx, body.id)
  if (!row) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  if (!isOwner(ctx, row)) return forbidden('Only the person who connected this mailbox can change who sees it.')
  if (!Array.isArray(row.also_visible_to)) return NextResponse.json({ error: 'This needs the hub_249 migration, which is not applied yet.' }, { status: 503 })
  if (target === row.owner_user_id) return bad('The owner already sees this mailbox.')
  const current = row.also_visible_to
  if (adding && !(await staffOf(ctx, row.org_id)).some((p) => p.user_id === target)) return bad('Only active staff of this organization can be added.')
  const next = adding ? Array.from(new Set([...current, target])) : current.filter((id) => id !== target)
  const { data, error } = await withAlso(CONNECTION_COLUMNS, (cols) => ctx.db.from('hub_mail_connections').update({ also_visible_to: next })
    .eq('id', row.id).eq('owner_user_id', ctx.userId).select(cols).single())
  if (error || !data) return NextResponse.json({ error: 'The list could not be saved.' }, { status: 500 })
  const now = new Date().toISOString()
  const { error: aErr } = await ctx.db.from('job_runs').insert({ job: AUDIT_JOB, started_at: now, finished_at: now, ok: true, rows_touched: 1,
    detail: { by: ctx.userId, connection_id: row.id, user_id: target, change: adding ? 'added' : 'removed' } })
  if (aErr) console.error(`[mail/connections] audit failed: ${aErr.code ?? 'unknown'}`)
  return NextResponse.json({ connection: view(data as MailConnectionRow, ctx.userId, await staffOf(ctx, row.org_id)) })
}

