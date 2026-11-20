// src/lib/touchpoints/run.ts
// One touchpoint monitor run for one org (Running List q35, Part 1). Server only (service role).
//   1. the contacts that may be raised: not merged or archived, not do-not-contact, not test (the shared test filter:
//      a "test" tag, campaign_test_contacts, the exclusion list), and not staff under any known address or phone
//      (staffAddresses). Contacts sharing an email or a phone are one person: at most one card per person per kind,
//      on the contact with the most recent activity (collapseDuplicates)
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
/** cleared_reason for a situation whose contact is now known to be staff, or a duplicate of another contact. */
export const STAFF_OR_DUPLICATE = 'staff_or_duplicate'
/** team_profiles roles that make a person staff (the same list as api-guard's STAFF_TEAM_ROLES). */
const STAFF_TEAM_ROLES = ['super_admin', 'admin', 'team_member']
/** org_members roles that make a platform admin staff of the Hub org the run is for. */
const HUB_ORG_ADMIN_ROLES = ['owner', 'admin']

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

export type Excluded = 'staff' | 'duplicate'
export interface Eligible {
  /** contacts detection looks at: not merged, archived, do-not-contact, test or staff (duplicates are kept, see dupes) */
  contacts: Map<string, Contact>
  names: Map<string, string>
  /** every contact in the org that is staff, or a duplicate that is not its person's primary contact */
  excluded: Map<string, Excluded>
  /** contact id -> the primary contact of its person (only for contacts that have duplicates) */
  primaryOf: Map<string, string>
  /** primary contact id -> the other contact ids of the same person */
  duplicatesOf: Map<string, string[]>
}

const last10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const altEmails = (cf: unknown) => {
  const v = cf && typeof cf === 'object' ? (cf as Record<string, unknown>).alt_emails : null
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(lower).filter((x) => x.includes('@')) : []
}
const activity = (c: any) => Math.max(...['last_contacted_at', 'last_call_at', 'last_text_at', 'last_email_at', 'updated_at', 'created_at'].map((k) => Date.parse(c[k] ?? '') || 0))

/**
 * Every address and phone that belongs to staff, built once per run. A person is staff when an ACTIVE team_profiles
 * row (any org) names them, and any of these is theirs: the team_profiles email or phone, their profile email or
 * phone, their auth user email (auth.users, through the service client), or a connected mailbox address. A platform
 * profile is staff too when its role is superadmin, or its role is admin AND it is an active owner or admin of THIS Hub
 * org (org_members, organization_id = the run's org). An admin of any other org is not staff: a client who runs their
 * own University org is an admin there (one was cleared as staff on 2026-11-20 until this rule was narrowed).
 */
export async function staffAddresses(db: SupabaseClient, orgId: string): Promise<{ emails: Set<string>; phones: Set<string> }> {
  const emails = new Set<string>(), phones = new Set<string>()
  const addE = (e: unknown) => { if (lower(e).includes('@')) emails.add(lower(e)) }
  const addP = (p: unknown) => { if (last10(p)) phones.add(last10(p)) }
  const { data: tps, error } = await db.from('team_profiles').select('user_id, role, email, phone').eq('status', 'active')
  if (error) throw fail('team_profiles', error)
  const staffTps = ((tps ?? []) as any[]).filter((t) => STAFF_TEAM_ROLES.includes(t.role))
  for (const t of staffTps) { addE(t.email); addP(t.phone) }
  const ids = Array.from(new Set(staffTps.map((t) => t.user_id).filter(Boolean)))
  const { data: ps, error: pErr } = ids.length ? await db.from('profiles').select('id, email, phone').in('id', ids) : { data: [], error: null } as any
  if (pErr) throw fail('profiles', pErr)
  for (const p of (ps ?? []) as any[]) { addE(p.email); addP(p.phone) }
  // platform profiles: a superadmin is staff; an admin is staff ONLY as an owner or admin of THIS Hub org (an active
  // org_members row). An admin of another org, such as a client who runs their own University org, is not staff.
  const { data: admins, error: aErr } = await db.from('profiles').select('id, email, phone, role').in('role', ['admin', 'superadmin'])
  if (aErr) throw fail('profiles admins', aErr)
  const adminIds = ((admins ?? []) as any[]).filter((p) => p.role === 'admin').map((p) => p.id)
  const hubAdmins = new Set<string>()
  if (adminIds.length) {
    const { data: om, error: oErr } = await db.from('org_members').select('user_id').eq('organization_id', orgId).eq('status', 'active')
      .in('role', HUB_ORG_ADMIN_ROLES).in('user_id', adminIds)
    if (oErr) throw fail('org_members', oErr)
    for (const m of (om ?? []) as any[]) hubAdmins.add(m.user_id)
  }
  for (const p of (admins ?? []) as any[]) {
    if (p.role !== 'superadmin' && !hubAdmins.has(p.id)) continue
    addE(p.email); addP(p.phone); if (p.id && !ids.includes(p.id)) ids.push(p.id)
  }
  for (const id of ids) {
    const r = await (db as any).auth?.admin?.getUserById?.(id)
    addE(r?.data?.user?.email)
    addP(r?.data?.user?.phone)
  }
  const { data: boxes, error: bErr } = await db.from('hub_mail_connections').select('email_address')
  if (bErr) throw fail('hub_mail_connections', bErr)
  for (const b of (boxes ?? []) as any[]) addE(b.email_address)
  return { emails, phones }
}

/** The contacts that may be raised, the staff and duplicate exclusions, and each duplicate group's primary. */
export async function eligibleContacts(d: RunDeps): Promise<Eligible> {
  const { db, orgId } = d
  const staff = await staffAddresses(db, orgId)
  const out: Eligible = { contacts: new Map(), names: new Map(), excluded: new Map(), primaryOf: new Map(), duplicatesOf: new Map() }
  const kept: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: cErr } = await db.from('contacts')
      .select('id, first_name, last_name, email, phone, tags, do_not_contact, custom_fields, last_contacted_at, last_call_at, last_text_at, last_email_at, updated_at, created_at')
      .eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null).range(from, from + 999)
    if (cErr) throw fail('contacts', cErr)
    for (const c of (data ?? []) as any[]) {
      const mails = [lower(c.email), ...altEmails(c.custom_fields)].filter((e) => e.includes('@'))
      if (mails.some((e) => staff.emails.has(e)) || (last10(c.phone) && staff.phones.has(last10(c.phone)))) { out.excluded.set(c.id, 'staff'); continue }
      if (c.do_not_contact || d.isTest(c)) continue
      kept.push({ ...c, mails })
    }
    if ((data ?? []).length < 1000) break
  }
  // duplicates: contacts sharing a normalised email or the last 10 digits of a phone are one person (union-find)
  const parent = new Map<string, string>(kept.map((c) => [c.id, c.id]))
  const root = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x }
  const owner = new Map<string, string>()
  for (const c of kept) {
    for (const k of [...c.mails.map((e: string) => `e:${e}`), ...(last10(c.phone) ? [`p:${last10(c.phone)}`] : [])]) {
      const o = owner.get(k)
      if (o) parent.set(root(c.id), root(o)); else owner.set(k, c.id)
    }
  }
  const groups = new Map<string, any[]>()
  for (const c of kept) groups.set(root(c.id), [...(groups.get(root(c.id)) ?? []), c])
  for (const list of Array.from(groups.values())) {
    // the primary is the contact with the most recent activity (ties: the lowest id, so it is stable)
    const sorted = list.slice().sort((a, b) => activity(b) - activity(a) || String(a.id).localeCompare(String(b.id)))
    const primary = sorted[0]
    for (const c of list) {
      out.contacts.set(c.id, { id: c.id, email: c.email ?? null })
      out.names.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Unnamed contact')
    }
    if (list.length < 2) continue
    out.duplicatesOf.set(primary.id, sorted.slice(1).map((c) => c.id))
    for (const c of list) {
      out.primaryOf.set(c.id, primary.id)
      if (c.id !== primary.id) out.excluded.set(c.id, 'duplicate')
    }
  }
  return out
}

/**
 * One situation per person per kind: a situation found on a duplicate moves to its person's primary contact, keeping
 * the primary's own situation when it has one, and names the other contacts in detail.duplicate_of.
 */
export function collapseDuplicates(found: Found[], e: Pick<Eligible, 'primaryOf' | 'duplicatesOf'>): Found[] {
  const out = new Map<string, Found>()
  const primaryOf = (id: string) => e.primaryOf.get(id) ?? id
  const tag = (f: Found): Found => {
    const dups = e.duplicatesOf.get(f.contactId)
    return dups?.length ? { ...f, detail: { ...f.detail, duplicate_of: dups.join(',') } } : f
  }
  // first the primary contacts' own situations, then the duplicates' (moved to the primary) where none was found
  for (const f of found) if (primaryOf(f.contactId) === f.contactId && !out.has(`${f.contactId}:${f.kind}`)) out.set(`${f.contactId}:${f.kind}`, tag(f))
  for (const f of found) {
    const primary = primaryOf(f.contactId)
    if (primary === f.contactId || out.has(`${primary}:${f.kind}`)) continue
    out.set(`${primary}:${f.kind}`, tag({ ...f, contactId: primary, key: `${primary}:${f.kind}:${f.triggerId}`.slice(0, 200) }))
  }
  return Array.from(out.values())
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

/**
 * Raises one situation: a new row, or (reopenId) the same row again when it was cleared only because its contact was
 * taken for staff or a duplicate. The key is unique per org, so a reopen updates that row rather than inserting.
 */
async function raise(d: RunDeps, s: Found, name: string, colId: string, ownerName: string | null, reopenId: string | null = null): Promise<boolean> {
  const { db, orgId, now } = d
  const sev = severity(s.kind, now - Date.parse(s.since))
  const fields = { contact_id: s.contactId, kind: s.kind, waiting_since: s.since, opened_at: iso(now), severity: sev, detail: s.detail }
  const { data: row, error } = reopenId
    ? await db.from(TABLE).update({ ...fields, cleared_at: null, cleared_reason: null, task_id: null, updated_at: iso(now) })
      .eq('id', reopenId).eq('cleared_reason', STAFF_OR_DUPLICATE).select('id').single()
    : await db.from(TABLE).insert({ org_id: orgId, situation_key: s.key, ...fields }).select('id').single()
  if (error?.code === '23505' || (reopenId && error?.code === 'PGRST116')) return false // one is already open, or nothing to reopen
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
  const note = reason === STAFF_OR_DUPLICATE ? 'this contact is staff, or a duplicate of another contact' : reason
  const patch: Record<string, unknown> = { description: `${(card as any).description ?? ''}\n\nCleared on its own: ${note}.`.trim(), completed_at: iso(now), updated_at: iso(now) }
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

  const elig = await eligibleContacts(d)
  const { contacts, names } = elig
  const oldestOpen = openRows.reduce((m, r) => Math.min(m, Date.parse(r.waiting_since) || m), now)
  const from = Math.min(now - LOOKBACK_DAYS * DAY, oldestOpen - DAY)
  const detected = await detect({ db, orgId, now, from, enrolledPipeline: d.enrolledPipeline, contacts })
  const resolved = detected.resolved
  // one situation per person per kind, on the person's primary contact (duplicates named in detail.duplicate_of)
  const found = collapseDuplicates(detected.found, elig)
  const foundKeys = new Set(found.map((f) => f.key))

  // clear first, so a contact whose old situation cleared can be raised again for a new one
  const [doneCol, trashCol] = await Promise.all([columnId(db, orgId, 'Done'), columnId(db, orgId, 'Trash')])
  const stillOpen = new Set<string>()
  for (const r of openRows) {
    // a contact that is now staff, or a duplicate that is not its person's primary contact, is cleared outright
    const reason = elig.excluded.has(r.contact_id) ? STAFF_OR_DUPLICATE : clearReason(r, foundKeys, found, resolved)
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
  const candidates = found.filter((f) => Date.parse(f.since) >= now - LOOKBACK_DAYS * DAY && contacts.has(f.contactId) && !elig.excluded.has(f.contactId))
  out.raised += await raiseCandidates(d, candidates, stillOpen, names)

  out.digest = await dailyDigest(d, out)
  return out
}

/**
 * Raises the candidates: never a key raised before (open or cleared), except one cleared only as staff_or_duplicate,
 * which reopens; one open per contact and situation.
 */
export async function raiseCandidates(d: RunDeps, candidates: Found[], stillOpen: Set<string>, names: Map<string, string>): Promise<number> {
  const { db, orgId } = d
  if (!candidates.length) return 0
  let raised = 0
  const { data: seen, error: sErr } = await db.from(TABLE).select('id, situation_key, cleared_reason').eq('org_id', orgId).in('situation_key', candidates.map((c) => c.key))
  if (sErr) throw fail('situations keys', sErr)
  // a key cleared only as staff_or_duplicate is not "raised before": its contact was wrongly taken for staff or a
  // duplicate, so it may reopen (the same row) once the contact is eligible again
  const reopenable = new Map(((seen ?? []) as any[]).filter((r) => r.cleared_reason === STAFF_OR_DUPLICATE).map((r) => [r.situation_key as string, r.id as string]))
  const known = new Set(((seen ?? []) as any[]).map((r) => r.situation_key as string).filter((k) => !reopenable.has(k)))
  const list = toRaise(candidates, known, stillOpen)
  if (list.length) {
    const col = await ensureReviewColumn(db, orgId)
    const { data: who } = await db.from('team_profiles').select('display_name').eq('org_id', orgId).eq('user_id', d.owner).maybeSingle()
    for (const s of list) if (await raise(d, s, names.get(s.contactId) ?? 'Contact', col, (who as any)?.display_name ?? null, reopenable.get(s.key) ?? null)) raised++
  }
  return raised
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
