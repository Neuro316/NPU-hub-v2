// src/lib/click-to-call/server.ts
// Reads the facts the click-to-call gate decides on, and writes the attempt log.
// Every read fails closed: an error throws, and the route answers 503 without
// dialing, unlike isDNC, which lets a call through when its read fails.
//
// The log (ruling 9, no new table): one crm_activity_log row per attempt,
// event_type 'click_to_call', actor_id = the staff member, ref -> call_logs. The
// call itself is a call_logs row with direction 'outbound', which is what the
// Conversations timeline shows and what ring-complete never raises entry events for.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrgTwilioConfig, getVoiceCallerId, createOrgTwilioClient, type OrgTwilioConfig } from '@/lib/twilio-org'
import { toE164, formatUsPhone } from '@/lib/phone'
import { parseC2CFlags, last10, pickLine, eligibleLines, type Facts, type RegistryLine, type AccountNumber, type EligibleLine } from './logic'

export const C2C_EVENT = 'click_to_call'

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

export interface Gathered { facts: Facts; orgId: string | null; config: OrgTwilioConfig | null }

export async function gatherFacts(
  db: SupabaseClient,
  caller: { userId: string; orgIds: string[] },
  conversationId: string,
  now: Date,
): Promise<Gathered> {
  const base: Facts = {
    callerOrgIds: caller.orgIds, conversation: null, contact: null, flags: { enabled: false, live: false },
    dncListHit: false, suppressed: false, staffPhone: null, onAllowlist: false, attempts: [], line: null,
    defaultTz: null, now,
  }
  const conv = must(await db.from('conversations').select('id, org_id, contact_id, line_e164')
    .eq('id', conversationId).maybeSingle(), 'conversation') as Facts['conversation']
  // Not found or another org's: stop before reading anything of that org.
  if (!conv || !caller.orgIds.includes(conv.org_id)) return { facts: { ...base, conversation: conv }, orgId: null, config: null }
  const orgId = conv.org_id

  const [contactR, flagsR, staffR, policyR, attemptsR, config] = await Promise.all([
    conv.contact_id
      ? db.from('contacts').select('id, first_name, last_name, phone, email, do_not_contact, timezone')
        .eq('id', conv.contact_id).eq('org_id', orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'click_to_call').maybeSingle(),
    db.from('team_profiles').select('phone').eq('user_id', caller.userId).eq('org_id', orgId).eq('status', 'active').limit(1),
    db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_send_policy').maybeSingle(),
    db.from('crm_activity_log').select('created_at').eq('actor_id', caller.userId).eq('event_type', C2C_EVENT)
      .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()).limit(500),
    getOrgTwilioConfig(db, orgId),
  ])
  const contact = must(contactR as any, 'contact') as (Facts['contact'] & { email: string | null }) | null
  const flags = parseC2CFlags((must(flagsR as any, 'flags') as any)?.setting_value)
  const staffPhone = ((must(staffR as any, 'staff profile') as any[]) ?? [])[0]?.phone ?? null
  const defaultTz = (must(policyR as any, 'send policy') as any)?.setting_value?.default_timezone ?? null
  const attempts = ((must(attemptsR as any, 'attempts') as any[]) ?? []).map((r) => String(r.created_at))
  const line = pickLine(config.numbers || [], conv.line_e164, getVoiceCallerId(config))

  let dncListHit = false, suppressed = false, onAllowlist = false
  const phone10 = last10(contact?.phone)
  if (contact && phone10) {
    const e164 = toE164(String(contact.phone))
    const variants = Array.from(new Set([String(contact.phone).trim(), e164, phone10, `1${phone10}`, formatUsPhone(e164)].filter(Boolean)))
    const email = (contact.email || '').trim().toLowerCase()
    const [dncR, supR, allowR] = await Promise.all([
      db.from('do_not_contact_list').select('phone, email').eq('org_id', orgId).limit(5000),
      db.from('suppressions').select('address').eq('org_id', orgId).eq('channel', 'sms').is('lifted_at', null).in('address', variants).limit(1),
      db.from('campaign_test_contacts').select('phone').eq('org_id', orgId).not('phone', 'is', null),
    ])
    dncListHit = ((must(dncR as any, 'do-not-contact list') as any[]) ?? []).some((r) =>
      (r.phone && last10(r.phone) === phone10) || (email && String(r.email || '').trim().toLowerCase() === email))
    suppressed = ((must(supR as any, 'suppressions') as any[]) ?? []).length > 0
    onAllowlist = ((must(allowR as any, 'test list') as any[]) ?? []).some((r) => last10(r.phone) === phone10)
  }

  return {
    facts: { ...base, conversation: conv, contact, flags, dncListHit, suppressed, staffPhone, onAllowlist, attempts, line, defaultTz },
    orgId, config,
  }
}

/** Insert the attempt row. Returns its id; throws if it cannot be written, so nothing is dialed unlogged. */
export async function logAttempt(
  db: SupabaseClient,
  row: { orgId: string; contactId: string; actorId: string; callLogId?: string | null; data: Record<string, unknown> },
): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await db.from('crm_activity_log').insert({
    org_id: row.orgId, contact_id: row.contactId, actor_id: row.actorId, event_type: C2C_EVENT,
    ref_table: row.callLogId ? 'call_logs' : null, ref_id: row.callLogId ?? null,
    event_data: { requested_at: now, ...row.data }, occurred_at: now, created_at: now,
  }).select('id').single()
  if (error || !data) throw new Error(`attempt log: ${error?.message ?? 'no row'}`)
  return (data as any).id as string
}

/** Merge fields into an attempt row's event_data (read then write; callbacks for one call are sequential). */
export async function mergeAttempt(db: SupabaseClient, where: { id?: string; callLogId?: string }, patch: Record<string, unknown>) {
  let q = db.from('crm_activity_log').select('id, event_data').eq('event_type', C2C_EVENT)
  q = where.id ? q.eq('id', where.id) : q.eq('ref_table', 'call_logs').eq('ref_id', where.callLogId!)
  const { data, error } = await q.limit(1).maybeSingle()
  if (error || !data) { console.error('[click-to-call] attempt row not found for merge', where, error?.message); return }
  const { error: uErr } = await db.from('crm_activity_log')
    .update({ event_data: { ...((data as any).event_data || {}), ...patch } }).eq('id', (data as any).id)
  if (uErr) console.error('[click-to-call] attempt merge failed', uErr.message)
}

// ── Line picker ─────────────────────────────────────────────────────────────────
// The Twilio account's own number list is the only record of which numbers still
// exist and can place voice calls. Cached per org for a minute so switching
// conversations does not call Twilio every time. null means Twilio could not be
// asked: the picker then offers no alternative lines and refuses any override.
const ACCOUNT_TTL_MS = 60_000
const accountCache = new Map<string, { at: number; numbers: AccountNumber[] }>()

export async function accountNumbers(orgId: string, config: OrgTwilioConfig): Promise<AccountNumber[] | null> {
  const hit = accountCache.get(orgId)
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.numbers
  if (!config.account_sid || !config.auth_token) return null
  try {
    const list = await createOrgTwilioClient(config).incomingPhoneNumbers.list({ limit: 200 })
    const numbers = list.map((n: any) => ({ phoneNumber: String(n.phoneNumber || ''), voice: n.capabilities?.voice === true }))
    accountCache.set(orgId, { at: Date.now(), numbers })
    return numbers
  } catch (e: any) {
    console.error('[click-to-call] Twilio number list failed:', e?.code, e?.message)
    return null
  }
}

/** The org's eligible lines, for the preflight. Throws on a database error (fails closed). */
export async function loadEligibleLines(db: SupabaseClient, orgId: string, config: OrgTwilioConfig): Promise<EligibleLine[]> {
  const { data, error } = await db.from('crm_twilio_numbers').select('id, org_id, phone_e164, friendly_name').eq('org_id', orgId)
  if (error) throw new Error(`lines: ${error.message}`)
  return eligibleLines(orgId, (data ?? []) as RegistryLine[], config.numbers || [], await accountNumbers(orgId, config))
}

/** One line by id, deliberately NOT filtered by org, so a forged id is refused by name. */
export async function loadLineRow(db: SupabaseClient, lineId: string): Promise<RegistryLine | null> {
  const { data, error } = await db.from('crm_twilio_numbers').select('id, org_id, phone_e164, friendly_name').eq('id', lineId).maybeSingle()
  if (error) throw new Error(`line: ${error.message}`)
  return (data as RegistryLine | null) ?? null
}
