// src/lib/touchpoints/run.ts
// One touchpoint monitor run for one org (Running List q35, Part 1). Server only (service role).
//   1. the contacts that may be raised: not merged or archived, not do-not-contact, not test (the shared test filter:
//      a "test" tag, campaign_test_contacts, the exclusion list), and not staff (an active staff member's profile
//      email, or a connected mailbox's address)
//   2. detect (detect.ts), then raise new situations: one row in hub_touchpoint_situations (hub_245) and ONE card in
//      the board column "Follow-ups to review" (made here on first use, placed before Action Steps)
//   3. clear open situations that cleared on their own: the row gets cleared_at and the reason, the card moves to Done
//      with "Cleared on its own: <what happened>"
//   4. once a day, the first run at or after 8 AM ET: the 7-day counts and one automation-first suggestion per
//      situation with 3 or more, as ONE Slack DM to each recipient (the lead-alert Slack path), claimed first so it
//      is never sent twice in a day
// Until hub_245 is applied the table is missing and the run does nothing (it reports table_missing).
import type { SupabaseClient } from '@supabase/supabase-js'
import { detect, courseworkCleared, type Contact, type Found } from './detect'
import {
  CLEARED, LOOKBACK_DAYS, NO_LONGER, PLAIN, SITUATIONS, digestDue, digestText, nyDayHour, severity, toRaise, whyLine, type SituationKind,
} from './rules'

export const REVIEW_COLUMN = 'Follow-ups to review'
export const TABLE = 'hub_touchpoint_situations'
/** Cameron and Shane (Hub profiles): the daily suggestion goes to both. */
export const DIGEST_RECIPIENTS = ['22456608-5f7d-495e-af02-7037fea125cc', 'ec05f3ea-99b3-455a-aefc-378f2e07d82a']
const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString()
const fail = (what: string, e: { code?: string } | null) => new Error(`${what}: ${e?.code ?? 'unknown'}`)
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const MISSING = ['42P01', 'PGRST205']
/** team_profiles roles that make a person staff (the same list as api-guard's STAFF_TEAM_ROLES). */
const STAFF_TEAM_ROLES = ['super_admin', 'admin', 'team_member']

export interface RunDeps {
  db: SupabaseClient
  orgId: string
  now: number
  enrolledPipeline: string
  owner: string
  hubUrl: string
  isTest: (c: { id: string; email?: string | null; phone?: string | null; tags?: string[] | null }) => boolean
  slack: (orgId: string, userId: string, text: string) => Promise<{ ok: boolean; code: string | null }>
}
export interface RunOut { skipped?: string; raised: number; cleared: number; digest: string | null; counts: Record<string, number> }

/** The contacts that may be raised, by id. */
export async function eligibleContacts(d: RunDeps): Promise<{ contacts: Map<string, Contact>; names: Map<string, string> }> {
  const { db, orgId } = d
  const staff = new Set<string>()
  const { data: tps, error } = await db.from('team_profiles').select('user_id, role').eq('org_id', orgId).eq('status', 'active')
  if (error) throw fail('team_profiles', error)
  const staffIds = ((tps ?? []) as any[]).filter((t) => STAFF_TEAM_ROLES.includes(t.role)).map((t) => t.user_id)
  if (staffIds.length) {
    const { data: ps, error: pErr } = await db.from('profiles').select('email').in('id', staffIds)
    if (pErr) throw fail('profiles', pErr)
    for (const p of (ps ?? []) as any[]) if (lower(p.email)) staff.add(lower(p.email))
  }
  const { data: boxes, error: bErr } = await db.from('hub_mail_connections').select('email_address')
  if (bErr) throw fail('hub_mail_connections', bErr)
  for (const b of (boxes ?? []) as any[]) if (lower(b.email_address)) staff.add(lower(b.email_address))

  const contacts = new Map<string, Contact>(), names = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error: cErr } = await db.from('contacts').select('id, first_name, last_name, email, phone, tags, do_not_contact')
      .eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null).range(from, from + 999)
    if (cErr) throw fail('contacts', cErr)
    for (const c of (data ?? []) as any[]) {
      if (c.do_not_contact || d.isTest(c) || staff.has(lower(c.email))) continue
      contacts.set(c.id, { id: c.id, email: c.email ?? null })
      names.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Unnamed contact')
    }
    if ((data ?? []).length < 1000) break
  }
  return { contacts, names }
}

/** The review column, made on first use and placed directly before Action Steps. */
export async function ensureReviewColumn(db: SupabaseClient, orgId: string): Promise<string> {
  const { data: cols, error } = await db.from('kanban_columns').select('id, title, sort_order').eq('org_id', orgId)
  if (error) throw fail('kanban_columns', error)
  const list = (cols ?? []) as any[]
  const have = list.find((c) => c.title === REVIEW_COLUMN)
  if (have) return have.id
  const action = list.find((c) => c.title === 'Action Steps')
  const at = action ? Number(action.sort_order ?? 0) : list.reduce((m, c) => Math.max(m, Number(c.sort_order ?? 0) + 1), 0)
  for (const c of list.filter((x) => Number(x.sort_order ?? 0) >= at).sort((a, b) => b.sort_order - a.sort_order)) {
    const { error: uErr } = await db.from('kanban_columns').update({ sort_order: Number(c.sort_order) + 1 }).eq('id', c.id)
    if (uErr) throw fail('kanban_columns move', uErr)
  }
  const { data: made, error: iErr } = await db.from('kanban_columns').insert({ org_id: orgId, title: REVIEW_COLUMN, sort_order: at }).select('id').single()
  if (iErr || !made) throw fail('kanban_columns insert', iErr)
  return (made as any).id
}

async function columnId(db: SupabaseClient, orgId: string, title: string): Promise<string | null> {
  const { data } = await db.from('kanban_columns').select('id').eq('org_id', orgId).eq('title', title).limit(1)
  return (data as any[] | null)?.[0]?.id ?? null
}

async function raise(d: RunDeps, s: Found, name: string, colId: string, ownerName: string | null): Promise<boolean> {
  const { db, orgId, now } = d
  const sev = severity(s.kind, now - Date.parse(s.since))
  const { data: row, error } = await db.from(TABLE).insert({
    org_id: orgId, contact_id: s.contactId, kind: s.kind, situation_key: s.key, waiting_since: s.since, opened_at: iso(now), severity: sev, detail: s.detail,
  }).select('id').single()
  if (error?.code === '23505') return false // raised before, or one already open for this contact and situation
  if (error || !row) throw fail('situation write', error)
  const why = whyLine(s.kind, now - Date.parse(s.since))
  const { data: card, error: kErr } = await db.from('kanban_tasks').insert({
    org_id: orgId, column_id: colId, title: `${name}: ${PLAIN[s.kind]}`.slice(0, 200),
    description: `${why}\n\nOpen the contact: ${d.hubUrl}/crm/contacts?id=${s.contactId}\n\nRaised by the touchpoint monitor. This card moves to Done on its own when the situation clears.`,
    priority: sev === 'high' ? 'high' : 'medium', due_date: nyDayHour(now).day, assignee: ownerName, owner_id: d.owner, source: 'touchpoint',
    visibility: 'everyone', sort_order: 0, ai_generated: false, custom_fields: { contact_id: s.contactId, situation_id: (row as any).id, kind: s.kind },
  }).select('id').single()
  if (kErr || !card) { console.error(`[touchpoints] card failed: ${kErr?.code ?? 'unknown'}`); return true }
  await db.from(TABLE).update({ task_id: (card as any).id, updated_at: iso(now) }).eq('id', (row as any).id)
  return true
}

async function clear(d: RunDeps, row: any, reason: string, doneCol: string | null, trashCol: string | null) {
  const { db, now } = d
  const { error } = await db.from(TABLE).update({ cleared_at: iso(now), cleared_reason: reason.slice(0, 200), updated_at: iso(now) }).eq('id', row.id).is('cleared_at', null)
  if (error) throw fail('situation clear', error)
  if (!row.task_id) return
  const { data: card } = await db.from('kanban_tasks').select('id, column_id, description').eq('id', row.task_id).maybeSingle()
  if (!card || (trashCol && (card as any).column_id === trashCol)) return
  const patch: Record<string, unknown> = { description: `${(card as any).description ?? ''}\n\nCleared on its own: ${reason}.`.trim(), completed_at: iso(now), updated_at: iso(now) }
  if (doneCol) patch.column_id = doneCol
  const { error: kErr } = await db.from('kanban_tasks').update(patch).eq('id', row.task_id)
  if (kErr) console.error(`[touchpoints] card move failed: ${kErr.code ?? 'unknown'}`)
}

/** The reason an open situation cleared, or null while it still holds. */
export function clearReason(row: { contact_id: string; kind: SituationKind; situation_key: string; detail: any }, foundKeys: Set<string>, found: Found[], resolved: Map<string, string>): string | null {
  if (foundKeys.has(row.situation_key)) return null
  if (row.kind === 'coursework_quiet') {
    const anchor = String(row.detail?.last_activity_at ?? '')
    const back = courseworkCleared(resolved, row.contact_id, anchor)
      ?? (found.some((f) => f.kind === 'coursework_quiet' && f.contactId === row.contact_id && Date.parse(f.since) > Date.parse(anchor)) ? CLEARED.coursework_quiet : null)
    return back ?? NO_LONGER
  }
  return resolved.get(row.situation_key) ?? NO_LONGER
}

export async function runTouchpoints(d: RunDeps): Promise<RunOut> {
  const { db, orgId, now } = d
  const out: RunOut = { raised: 0, cleared: 0, digest: null, counts: {} }
  const { data: open, error } = await db.from(TABLE).select('id, contact_id, kind, situation_key, waiting_since, severity, detail, task_id')
    .eq('org_id', orgId).is('cleared_at', null)
  if (error && MISSING.includes(error.code ?? '')) return { ...out, skipped: 'table_missing' }
  if (error) throw fail('situations read', error)
  const openRows = (open ?? []) as any[]

  const { contacts, names } = await eligibleContacts(d)
  const oldestOpen = openRows.reduce((m, r) => Math.min(m, Date.parse(r.waiting_since) || m), now)
  const from = Math.min(now - LOOKBACK_DAYS * DAY, oldestOpen - DAY)
  const { found, resolved } = await detect({ db, orgId, now, from, enrolledPipeline: d.enrolledPipeline, contacts })
  const foundKeys = new Set(found.map((f) => f.key))

  // clear first, so a contact whose old situation cleared can be raised again for a new one
  const [doneCol, trashCol] = await Promise.all([columnId(db, orgId, 'Done'), columnId(db, orgId, 'Trash')])
  const stillOpen = new Set<string>()
  for (const r of openRows) {
    const reason = clearReason(r, foundKeys, found, resolved)
    if (reason === null) {
      stillOpen.add(`${r.contact_id}:${r.kind}`)
      const f = found.find((x) => x.key === r.situation_key)!
      const sev = severity(r.kind, now - Date.parse(f.since))
      if (sev !== r.severity) await db.from(TABLE).update({ severity: sev, updated_at: iso(now) }).eq('id', r.id)
      continue
    }
    await clear(d, r, reason, doneCol, trashCol)
    out.cleared++
  }

  // raise: never a key seen before (open or cleared), one open per contact and situation, new ones inside the lookback
  const candidates = found.filter((f) => Date.parse(f.since) >= now - LOOKBACK_DAYS * DAY && contacts.has(f.contactId))
  if (candidates.length) {
    const { data: seen, error: sErr } = await db.from(TABLE).select('situation_key').eq('org_id', orgId).in('situation_key', candidates.map((c) => c.key))
    if (sErr) throw fail('situations keys', sErr)
    const known = new Set(((seen ?? []) as any[]).map((r) => r.situation_key as string))
    const list = toRaise(candidates, known, stillOpen)
    if (list.length) {
      const col = await ensureReviewColumn(db, orgId)
      const { data: who } = await db.from('team_profiles').select('display_name').eq('org_id', orgId).eq('user_id', d.owner).maybeSingle()
      for (const s of list) if (await raise(d, s, names.get(s.contactId) ?? 'Contact', col, (who as any)?.display_name ?? null)) out.raised++
    }
  }

  out.digest = await dailyDigest(d, out)
  return out
}

/** Once a day, first run at or after 8 AM ET: claim the day, count the last 7 days, and DM each recipient. */
export async function dailyDigest(d: RunDeps, out: RunOut): Promise<string | null> {
  const { db, orgId, now } = d
  const { data: claims, error } = await db.from('job_runs').select('detail').eq('job', 'touchpoints-digest').gte('started_at', iso(now - 2 * DAY))
  if (error) throw fail('digest claims', error)
  const day = digestDue(now, ((claims ?? []) as any[]).filter((c) => c.detail?.org_id === orgId).map((c) => String(c.detail?.day ?? '')))
  if (!day) return null
  const { data: rows, error: rErr } = await db.from(TABLE).select('kind').eq('org_id', orgId).gte('opened_at', iso(now - 7 * DAY))
  if (rErr) throw fail('digest counts', rErr)
  for (const k of SITUATIONS) out.counts[k] = 0
  for (const r of (rows ?? []) as any[]) out.counts[r.kind] = (out.counts[r.kind] ?? 0) + 1
  const text = digestText(out.counts as Record<SituationKind, number>)
  // the claim comes BEFORE the send, so a second run the same day never sends again
  const { data: claim, error: cErr } = await db.from('job_runs').insert({ job: 'touchpoints-digest', started_at: iso(now), detail: { org_id: orgId, day, sent: !!text } }).select('id').single()
  if (cErr || !claim) throw fail('digest claim', cErr)
  const results: Record<string, string> = {}
  if (text) for (const u of DIGEST_RECIPIENTS) { const r = await d.slack(orgId, u, text); results[u.slice(0, 8)] = r.ok ? 'sent' : r.code ?? 'failed' }
  await db.from('job_runs').update({ finished_at: iso(now), ok: true, rows_touched: text ? DIGEST_RECIPIENTS.length : 0, detail: { org_id: orgId, day, sent: !!text, results } }).eq('id', (claim as any).id)
  return text ? `sent ${day}` : `nothing to send ${day}`
}
