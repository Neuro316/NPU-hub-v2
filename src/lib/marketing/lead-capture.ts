// src/lib/marketing/lead-capture.ts
// POST /api/public/lead-capture: sign-ups from static partner pages that are not Hub forms. Today one source,
// "holiday-checklist", from https://waynesvilleneuro.com/holiday (the "Holidayproof Your Nervous System" checklist).
//
// Why not /api/intake: that route is form-definition driven (a published form_definitions row, the intake flag and the
// HUB_INTAKE_ALLOWED_ORIGINS env value) and is pinned byte for byte by scripts/agent/flag-off-parity.cjs. This path
// reuses its pieces instead: the same contact match and create (public.hub_intake_contact), the same phone rule
// (settleSubmittedPhone: a blank phone is filled, a number already there is never overwritten) and the same pipeline
// placement (hub_pipeline_place, forward only).
//
// Each source is declared here, in code: its allowed origins, org, pipeline, stage NAME (resolved to an id at run time,
// never guessed), tag and timeline title. An unknown source is refused.
//
// Logs ids and codes only: never a name, an address or a number.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'
import { lastTen, settleSubmittedPhone } from '@/lib/marketing/submitted-phone'
import { loadPipelines, notePlacementFailure, placeContact, resolveStage } from '@/lib/pipelines/positions'

export interface LeadSource {
  origins: string[]
  org: string
  pipelineId: string
  stageName: string
  tag: string
  timelineTitle: string
  sourceKey: string
}

export const LEAD_SOURCES: Record<string, LeadSource> = {
  'holiday-checklist': {
    origins: ['https://waynesvilleneuro.com', 'https://www.waynesvilleneuro.com'],
    org: '00000000-0000-0000-0000-000000000001',
    pipelineId: 'befd90ed-f791-4c7d-a065-e2765a065029', // Waynesville Neuro Wellness
    stageName: 'Requested online resource',
    tag: 'Holidayproof checklist',
    timelineTitle: 'Downloaded Holidayproof Your Nervous System checklist from waynesvilleneuro.com',
    sourceKey: 'website:wnw-holiday-checklist',
  },
}

export const RATE_WINDOW_MINUTES = 10
export const RATE_PER_IP = 5
export const TIMELINE_EVENT = 'online_resource_requested'
const MAX = 200
const EMAIL = /^[^@\s:]+@[^@\s]+\.[a-z]{2,}$/i

/** Pure: every origin any source accepts. */
export const allOrigins = (): string[] => Array.from(new Set(Object.values(LEAD_SOURCES).flatMap((s) => s.origins)))

/** Pure: CORS headers for an allowed origin, or null. A request with no Origin is refused: browsers always send one. */
export function corsFor(origin: string | null): Record<string, string> | null {
  if (!origin || !allOrigins().includes(origin)) return null
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' }
}

/** Pure: a filled honeypot. */
export function isBot(body: any): boolean {
  const b = body?.bot
  if (b == null) return false
  return typeof b === 'string' ? b.trim() !== '' : true
}

export interface LeadOk { ok: true; source: string; def: LeadSource; email: string; phone: string | null; first: string; last: string; resource: string }
export interface LeadErr { ok: false; status: number; error: string; fields?: Record<string, string> }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Pure: a US number with 10 digits (or 11 starting with 1), or a + international number of 8 to 15 digits. */
export function cleanPhone(raw: string): string | null {
  const e = toE164(raw)
  if (!e) return null
  const digits = e.slice(1)
  if (e.startsWith('+1')) return digits.length === 11 ? e : null
  return raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 ? e : null
}

/** Pure: validate the body for a request from origin. */
export function validateLead(body: any, origin: string | null): LeadOk | LeadErr {
  const source = str(body?.source)
  const def = LEAD_SOURCES[source]
  if (!def) return { ok: false, status: 400, error: 'Unknown source.', fields: { source: 'Unknown source.' } }
  if (!origin || !def.origins.includes(origin)) return { ok: false, status: 403, error: 'This page may not send that source.' }
  const fields: Record<string, string> = {}
  const name = str(body?.name), email = str(body?.email).toLowerCase(), phoneRaw = str(body?.phone), resource = str(body?.resource)
  if (name.length > MAX) fields.name = 'Name is too long.'
  if (!email) fields.email = 'Please enter your email address.'
  else if (email.length > MAX || !EMAIL.test(email)) fields.email = 'Please enter a valid email address.'
  let phone: string | null = null
  if (phoneRaw) {
    phone = phoneRaw.length > 40 ? null : cleanPhone(phoneRaw)
    if (!phone) fields.phone = 'Please enter a valid phone number.'
  }
  if (Object.keys(fields).length) return { ok: false, status: 400, error: 'Please check the highlighted fields.', fields }
  const parts = name.split(/\s+/).filter(Boolean)
  return { ok: true, source, def, email, phone, first: parts[0] ?? '', last: parts.slice(1).join(' '), resource: resource.slice(0, MAX) }
}

/** Pure: the name fields to write on a matched contact. Only blanks (or the placeholder "Unknown") are filled. */
export function nameFill(current: { first_name?: string | null; last_name?: string | null }, first: string, last: string): Record<string, string> {
  const out: Record<string, string> = {}
  const cf = String(current.first_name ?? '').trim(), cl = String(current.last_name ?? '').trim()
  if (first && (!cf || cf === 'Unknown')) out.first_name = first
  if (last && !cl) out.last_name = last
  return out
}

export const ipHashOf = (ip: string, org: string) => createHash('sha256').update(`lead-capture|${ip}|${org}`).digest('hex')

/** Too many accepted sign-ups from this address in the window (counted on the timeline rows this path writes). */
export async function rateLimited(db: SupabaseClient, org: string, ipHash: string, now = Date.now()): Promise<boolean> {
  const since = new Date(now - RATE_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await db.from('contact_timeline').select('id', { count: 'exact', head: true })
    .eq('org_id', org).eq('event_type', TIMELINE_EVENT).eq('metadata->>ip_hash', ipHash).gte('occurred_at', since)
  if (error) { console.error(`[lead-capture] rate check failed: ${error.code ?? 'unknown'}`); return false }
  return (count ?? 0) >= RATE_PER_IP
}

/** Pure: an ilike pattern that matches the value exactly, case-insensitively (% _ and \\ escaped). */
export const likeExact = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

const live = (q: any) => q.is('merged_into_id', null).is('archived_at', null)

/** The contact for this sign-up: matched by email, then by phone, else created. Returns its id and whether it is new. */
export async function matchOrCreate(db: SupabaseClient, l: LeadOk): Promise<{ id: string; created: boolean }> {
  const org = l.def.org
  const { data: byEmail, error: eErr } = await live(db.from('contacts').select('id').eq('org_id', org).ilike('email', likeExact(l.email)))
    .order('created_at').limit(1)
  if (eErr) throw new Error(`email match: ${eErr.code ?? 'unknown'}`)
  if (byEmail?.length) return { id: (byEmail[0] as any).id, created: false }
  if (l.phone) {
    const digits = lastTen(l.phone)
    const { data: rows, error: pErr } = await live(db.from('contacts').select('id, phone, created_at').eq('org_id', org)
      .like('phone', `%${digits.slice(-4)}%`)).order('created_at').limit(200)
    if (pErr) throw new Error(`phone match: ${pErr.code ?? 'unknown'}`)
    const hit = ((rows ?? []) as any[]).find((r) => lastTen(r.phone) === digits)
    if (hit) return { id: hit.id, created: false }
  }
  const { data: id, error } = await db.rpc('hub_intake_contact', {
    p_org: org, p_email: l.email, p_phone: l.phone, p_first: l.first, p_last: l.last, p_source_key: l.def.sourceKey, p_utm: null,
  })
  if (error || !id) throw new Error(`create: ${error?.code ?? 'no id'}`)
  return { id: id as string, created: true }
}

export interface CaptureResult { contactId: string; created: boolean; placed: string }

/** Everything after validation. Throws only when no contact could be matched or created. */
export async function captureLead(db: SupabaseClient, l: LeadOk, ipHash: string): Promise<CaptureResult> {
  const { id, created } = await matchOrCreate(db, l)
  const where = `the ${l.source} sign-up`

  // Fill blanks only: never overwrite a name, a phone or an email already on the card.
  if (!created) {
    const { data: cur } = await db.from('contacts').select('first_name, last_name, email').eq('id', id).maybeSingle()
    const patch: Record<string, string> = cur ? nameFill(cur as any, l.first, l.last) : {}
    if (cur && !String((cur as any).email ?? '').trim()) patch.email = l.email
    if (Object.keys(patch).length) {
      const { error } = await db.from('contacts').update(patch).eq('id', id)
      if (error) console.error(`[lead-capture] contact=${id} fill failed: ${error.code ?? 'unknown'}`)
    }
  }
  await settleSubmittedPhone(db, id, l.phone, where)

  const { data: tagRow } = await db.from('contacts').select('tags').eq('id', id).maybeSingle()
  const tags: string[] = Array.isArray((tagRow as any)?.tags) ? (tagRow as any).tags : []
  if (!tags.includes(l.def.tag)) {
    const { error } = await db.from('contacts').update({ tags: [...tags, l.def.tag] }).eq('id', id)
    if (error) console.error(`[lead-capture] contact=${id} tag failed: ${error.code ?? 'unknown'}`)
  }

  let placed = 'failed'
  try {
    const stage = resolveStage(await loadPipelines(db, l.def.org), l.def.pipelineId, l.def.stageName)
    if (!stage) {
      placed = 'stage_unknown'
      await notePlacementFailure(db, l.def.org, id, where, `stage "${l.def.stageName}" was not found in the pipeline`)
    } else {
      const r = await placeContact(db, id, stage.id, true, `lead_capture:${l.source}`)
      placed = r.placed ? 'placed' : (r.reason ?? 'unknown')
    }
  } catch (e: any) {
    console.error(`[lead-capture] contact=${id} placement failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    await notePlacementFailure(db, l.def.org, id, where, 'the pipeline could not be updated')
  }

  const { error: tErr } = await db.from('contact_timeline').insert({
    org_id: l.def.org, contact_id: id, event_type: TIMELINE_EVENT, title: l.def.timelineTitle,
    metadata: { source: l.source, resource: l.resource || null, ip_hash: ipHash, created, placement: placed },
    actor_type: 'system', occurred_at: new Date().toISOString(),
  })
  if (tErr) console.error(`[lead-capture] contact=${id} timeline failed: ${tErr.code ?? 'unknown'}`)
  return { contactId: id, created, placed }
}
