// src/lib/touchpoints/text-alerts.ts
// Unanswered text alerts (rules set by Cameron, 2026-11-23), part of the q35 touchpoint run (every 30 minutes).
//
//   waiting   a person's inbound text (crm_messages, either org line) with no reply since, for 60 minutes or more. A reply
//             is the one touch rule's text or call (src/lib/touch/first-touch.ts): an outbound text the provider accepted,
//             or an outbound call, to that person, on any line. The clock starts at the FIRST inbound after the last
//             reply, so a new text after a reply starts a fresh clock (a new situation key).
//   who       eligibleContacts (run.ts): never test, staff, do-not-contact, merged, archived or excluded contacts; the
//             contacts of one person (shared email or phone) are one thread, on the primary contact.
//   when      nothing before 8 AM ET (the digest's nyDayHour). Overnight texts are in the first post after 8.
//   post      nothing waiting: no post. Otherwise ONE Slack message to #np-follow-ups listing every waiting thread,
//             newest first, each New (first time listed) or Still waiting.
//   state     one hub_touchpoint_situations row per waiting thread, kind text_waiting_1h (hub_248). detail holds ids,
//             the line name and times only. alerted_at is set once the thread was in a post that Slack accepted; a row
//             without it is New. The row clears as soon as the thread is answered.
//   pause     org_settings 'hub_text_alerts' = {"enabled": false} pauses the alert: nothing posted, nothing written,
//             skipped 'paused'. Missing, or any other value, means on.
//   timeline  on a thread's first alert, one contact_timeline entry text_waiting_alert (line, waited minutes; no text).
// The message text is read ONLY to build the 120 character preview in the Slack post. It is never stored or logged.
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTouches } from '@/lib/touch/first-touch'
import { conversationHref } from '@/lib/comms/conversation-link'
import { DIGEST_HOUR_ET, LOOKBACK_DAYS, nyDayHour, waited } from './rules'
import { liveResolutions } from '@/lib/resolve/check'

export const TEXT_WAIT_KIND = 'text_waiting_1h'
export const TEXT_WAIT_MS = 60 * 60_000
/** #np-follow-ups (private). */
export const FOLLOW_UPS_CHANNEL = 'C0CM32JD6BS'
export const PREVIEW_MAX = 120
const TABLE = 'hub_touchpoint_situations'
const DAY = 86_400_000
const CHECK_VIOLATION = '23514'
const iso = (t: number) => new Date(t).toISOString()
const fail = (what: string, e: { code?: string } | null) => new Error(`${what}: ${e?.code ?? 'unknown'}`)
const at = (m: { created_at: string }) => Date.parse(m.created_at)

export interface Line { phone: string; nickname: string }
export interface TextAlertDeps {
  db: SupabaseClient
  orgId: string
  now: number
  hubUrl: string
  slackChannel: (orgId: string, channel: string, text: string) => Promise<{ ok: boolean; code: string | null }>
  lines: (orgId: string) => Promise<Line[]>
  /** compute the message only: no post, no writes */
  dry?: boolean
}
export interface TextPeople {
  contacts: Map<string, unknown>
  names: Map<string, string>
  excluded: Map<string, string>
  primaryOf: Map<string, string>
}
export interface Waiting {
  contactId: string
  key: string
  messageId: string
  conversationId: string
  since: string
  line: string
  who: string
  preview: string
}
export interface TextAlertOut { skipped?: string; waiting: number; new: number; cleared: number; posted: boolean; code: string | null; message: string | null }

const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '')

/** The line's name: its nickname in the org's Twilio numbers, else the last 4 digits of the number. */
export function lineName(lines: Line[], e164: string | null | undefined): string {
  const want = digits(e164).slice(-10)
  const hit = want ? lines.find((l) => digits(l.phone).slice(-10) === want) : undefined
  if (hit?.nickname?.trim()) return hit.nickname.trim()
  return want ? `line ending ${want.slice(-4)}` : 'unknown line'
}

/** The first characters of their text, on one line, Slack control characters escaped, at most PREVIEW_MAX characters. */
export function preview(body: unknown): string {
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim()
  const cut = flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 3).trimEnd()}...` : flat
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** How long, in minutes up to two hours, then hours, then days. */
export function waitedFor(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 120) return `${min} min`
  return waited(ms)
}

/** The one Slack message, newest first; null when nothing is waiting. */
export function alertText(list: Array<Waiting & { isNew: boolean }>, now: number, hubUrl: string): string | null {
  if (!list.length) return null
  const sorted = list.slice().sort((a, b) => Date.parse(b.since) - Date.parse(a.since))
  const n = sorted.length
  const lines = sorted.map((w) => {
    const label = w.isNew ? 'New' : 'Still waiting'
    const href = `${hubUrl}${conversationHref(w.conversationId)}`
    return `*${label}* · ${w.who} · ${w.line} · waiting ${waitedFor(now - Date.parse(w.since))}\n> ${w.preview || '(no text)'}\n<${href}|Open the thread> · <${href}&resolve=1|No reply needed>`
  })
  return [`${n} text${n === 1 ? '' : 's'} waiting on a reply for an hour or more`, ...lines].join('\n\n')
}

/** Every thread waiting 60 minutes or more on a reply, one per person (on the primary contact). Reads only. */
export async function findWaiting(d: TextAlertDeps, people: TextPeople): Promise<Waiting[]> {
  const { db, orgId, now } = d
  const from = iso(now - LOOKBACK_DAYS * DAY)
  const { data: convs, error } = await db.from('conversations').select('id, contact_id, line_e164').eq('org_id', orgId).gte('last_message_at', from)
  if (error) throw fail('conversations', error)
  const mine = ((convs ?? []) as any[]).filter((c) => people.contacts.has(c.contact_id))
  if (!mine.length) return []
  const convOf = new Map(mine.map((c) => [c.id as string, c]))
  // the body is read for the Slack preview only
  const { data: msgs, error: mErr } = await db.from('crm_messages').select('id, conversation_id, created_at, to_e164, from_e164, body')
    .eq('direction', 'inbound').in('conversation_id', Array.from(convOf.keys())).gte('created_at', from)
  if (mErr) throw fail('crm_messages', mErr)
  const person = (contactId: string) => people.primaryOf.get(contactId) ?? contactId
  const inbound = new Map<string, any[]>()
  for (const m of (msgs ?? []) as any[]) {
    const p = person(convOf.get(m.conversation_id).contact_id)
    inbound.set(p, [...(inbound.get(p) ?? []), m])
  }
  if (!inbound.size) return []
  // replies: the one touch rule's texts and calls, to any contact of the person
  const leads = Array.from(people.contacts.keys()).filter((id) => inbound.has(person(id)))
  const touches = (await loadTouches(db, leads.map((id) => ({ id, email: null, since: from }))))
    .filter((t) => t.kind === 'text' || t.kind === 'call')
  const lastReply = new Map<string, number>()
  for (const t of touches) { const p = person(t.contactId); if (t.at <= now) lastReply.set(p, Math.max(lastReply.get(p) ?? 0, t.at)) }
  const lines = await d.lines(orgId)
  const out: Waiting[] = []
  for (const [p, list] of Array.from(inbound.entries())) {
    if (people.excluded.has(p)) continue
    const sorted = list.slice().sort((a, b) => at(a) - at(b))
    const after = sorted.filter((m) => at(m) > (lastReply.get(p) ?? 0))
    if (!after.length) continue
    const first = after[0]
    if (now - at(first) < TEXT_WAIT_MS) continue
    const latest = after[after.length - 1]
    const name = people.names.get(p)
    out.push({
      contactId: p, key: `${p}:${TEXT_WAIT_KIND}:${first.id}`.slice(0, 200), messageId: first.id, conversationId: latest.conversation_id,
      since: first.created_at, line: lineName(lines, latest.to_e164 ?? convOf.get(latest.conversation_id)?.line_e164),
      who: name && name !== 'Unnamed contact' ? name : String(latest.from_e164 ?? 'Unknown number'), preview: preview(latest.body),
    })
  }
  return out
}

/** org_settings 'hub_text_alerts': paused ONLY when its value is exactly { enabled: false }. Missing or anything else is on. */
export function textAlertsPaused(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).enabled === false
}
export async function readPause(db: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_text_alerts').maybeSingle()
  if (error) return false
  return textAlertsPaused((data as any)?.setting_value)
}

/** One alert pass: clear answered threads, list the waiting ones in ONE post, mark them alerted, write first-alert timeline. */
export async function textAlerts(d: TextAlertDeps, people: TextPeople): Promise<TextAlertOut> {
  const { db, orgId, now } = d
  const out: TextAlertOut = { waiting: 0, new: 0, cleared: 0, posted: false, code: null, message: null }
  if (await readPause(db, orgId)) return { ...out, skipped: 'paused' }
  if (nyDayHour(now).hour < DIGEST_HOUR_ET) return { ...out, skipped: 'before_8am_et' }
  // a contact marked No reply needed (text_waiting or all) is not listed, and its open row clears below
  const found = await findWaiting(d, people)
  const resolved = await liveResolutions(db, found.map((w) => w.contactId), 'text_waiting', now)
  const waiting = found.filter((w) => !resolved.has(w.contactId))
  out.waiting = waiting.length
  const { data: open, error } = await db.from(TABLE).select('id, contact_id, situation_key, detail').eq('org_id', orgId).eq('kind', TEXT_WAIT_KIND).is('cleared_at', null)
  if (error) throw fail('text situations read', error)
  const keys = new Set(waiting.map((w) => w.key))
  const openRows = (open ?? []) as any[]

  // clear: a listed thread that is no longer waiting (answered, or its contact is now excluded)
  for (const r of openRows.filter((x) => !keys.has(x.situation_key))) {
    out.cleared++
    if (d.dry) continue
    const { error: cErr } = await db.from(TABLE).update({ cleared_at: iso(now), cleared_reason: 'answered by text or call, or no longer eligible', updated_at: iso(now) })
      .eq('id', r.id).is('cleared_at', null)
    if (cErr) throw fail('text situation clear', cErr)
  }

  // state for every waiting thread: its open row, or a new one (a key seen before and cleared is opened again)
  const rowOf = new Map<string, any>(openRows.filter((r) => keys.has(r.situation_key)).map((r) => [r.situation_key, r]))
  const missing = waiting.filter((w) => !rowOf.has(w.key))
  if (missing.length && !d.dry) {
    const { data: seen, error: sErr } = await db.from(TABLE).select('id, situation_key, detail').eq('org_id', orgId).in('situation_key', missing.map((w) => w.key))
    if (sErr) throw fail('text situations keys', sErr)
    for (const s of (seen ?? []) as any[]) {
      const { error: rErr } = await db.from(TABLE).update({ cleared_at: null, cleared_reason: null, updated_at: iso(now) }).eq('id', s.id)
      if (rErr) throw fail('text situation reopen', rErr)
      rowOf.set(s.situation_key, s)
    }
    for (const w of missing.filter((x) => !rowOf.has(x.key))) {
      const detail = { message_id: w.messageId, conversation_id: w.conversationId, line: w.line, received_at: w.since }
      const { data: row, error: iErr } = await db.from(TABLE).insert({
        org_id: orgId, contact_id: w.contactId, kind: TEXT_WAIT_KIND, situation_key: w.key, waiting_since: w.since, opened_at: iso(now), severity: 'low', detail,
      }).select('id, situation_key, detail').single()
      // until hub_248 widens the kind check, nothing can be tracked, so nothing is posted (it would say New every run)
      if (iErr?.code === CHECK_VIOLATION) return { ...out, skipped: 'hub_248_pending' }
      if (iErr || !row) throw fail('text situation write', iErr)
      rowOf.set(w.key, row)
    }
  }
  const list = waiting.map((w) => ({ ...w, isNew: !rowOf.get(w.key)?.detail?.alerted_at }))
  out.new = list.filter((w) => w.isNew).length
  const text = alertText(list, now, d.hubUrl)
  out.message = text
  if (!text || d.dry) return out

  const r = await d.slackChannel(orgId, FOLLOW_UPS_CHANNEL, text)
  out.posted = r.ok
  out.code = r.code
  if (!r.ok) { console.error(`[touchpoints] text alert post failed: ${r.code ?? 'unknown'}`); return out }

  // first alert only: mark the row alerted and write the timeline entry (line and minutes, never the text)
  for (const w of list.filter((x) => x.isNew)) {
    const row = rowOf.get(w.key)
    const { error: uErr } = await db.from(TABLE).update({ detail: { ...(row.detail ?? {}), alerted_at: iso(now) }, updated_at: iso(now) }).eq('id', row.id)
    if (uErr) console.error(`[touchpoints] text alert mark failed: ${uErr.code ?? 'unknown'}`)
    const minutes = Math.floor((now - Date.parse(w.since)) / 60_000)
    const { error: tErr } = await db.from('contact_timeline').insert({
      org_id: orgId, contact_id: w.contactId, event_type: 'text_waiting_alert', title: 'Text waiting on a reply',
      description: `Their text on the ${w.line} line had no reply for ${waitedFor(now - Date.parse(w.since))}. Listed in #np-follow-ups.`,
      metadata: { line: w.line, waited_minutes: minutes, situation_id: row.id }, source_table: TABLE, source_id: row.id, actor_type: 'system', occurred_at: iso(now),
    })
    if (tErr) console.error(`[touchpoints] text alert timeline failed: ${tErr.code ?? 'unknown'}`)
  }
  return out
}
