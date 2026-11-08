// src/lib/lead-alerts/sources.ts
// Where speed-to-lead finds new leads, and how it reads the facts for one alert at send time.
//
// READS ONLY. University tables (profiles, nr_bookings, nr_booking_leads, nr_appointment_types,
// nr_booking_pipeline_routes) are read and never written. Nothing here logs a name, an email, a phone or an answer:
// error messages carry table names and codes only.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadFacts, LeadSource } from './compose'
import { answerList } from '../bookings/placement'

export interface Candidate {
  source: LeadSource
  source_id: string
  contact_id: string | null
  occurred_at: string
  starts_at: string | null
}

const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)

/** A live contact in the org with this email, or null. */
export async function contactByEmail(db: SupabaseClient, orgId: string, email: string | null): Promise<string | null> {
  const e = (email ?? '').trim().toLowerCase()
  if (!e || !e.includes('@')) return null
  const { data, error } = await db.from('contacts').select('id').eq('org_id', orgId).ilike('email', e.replace(/[\\%_]/g, (c) => '\\' + c))
    .is('merged_into_id', null).is('archived_at', null).order('created_at', { ascending: true }).limit(1)
  if (error) throw fail('contacts', error)
  return (data?.[0] as any)?.id ?? null
}

/** Real (not test) lead device submissions. */
async function leadDevices(db: SupabaseClient, orgId: string, since: string): Promise<Candidate[]> {
  const { data, error } = await db.from('lead_device_submissions').select('id, contact_id, created_at')
    .eq('org_id', orgId).eq('is_test', false).gte('created_at', since).order('created_at', { ascending: true }).limit(200)
  if (error) throw fail('lead_device_submissions', error)
  return (data ?? []).map((r: any) => ({ source: 'lead_device', source_id: r.id, contact_id: r.contact_id ?? null, occurred_at: r.created_at, starts_at: null }))
}

async function forms(db: SupabaseClient, orgId: string, since: string): Promise<Candidate[]> {
  const { data, error } = await db.from('form_submissions').select('id, contact_id, created_at')
    .eq('org_id', orgId).gte('created_at', since).order('created_at', { ascending: true }).limit(200)
  if (error) throw fail('form_submissions', error)
  return (data ?? []).map((r: any) => ({ source: 'form', source_id: r.id, contact_id: r.contact_id ?? null, occurred_at: r.created_at, starts_at: null }))
}

/**
 * The org's discovery booking types: a name containing "discovery", or a type the Hub routes into a pipeline
 * (nr_booking_pipeline_routes, the lead-facing booking links). Probes and coaching sessions are neither.
 */
export async function discoveryTypeIds(db: SupabaseClient, orgId: string): Promise<string[]> {
  const [{ data: types, error: tErr }, { data: routes, error: rErr }] = await Promise.all([
    db.from('nr_appointment_types').select('id, name').eq('org_id', orgId),
    db.from('nr_booking_pipeline_routes').select('appointment_type_id'),
  ])
  if (tErr) throw fail('nr_appointment_types', tErr)
  if (rErr) throw fail('nr_booking_pipeline_routes', rErr)
  const routed = new Set((routes ?? []).map((r: any) => r.appointment_type_id as string))
  return (types ?? []).filter((t: any) => /discovery/i.test(t.name ?? '') || routed.has(t.id)).map((t: any) => t.id as string)
}

async function bookings(db: SupabaseClient, orgId: string, since: string): Promise<Candidate[]> {
  const typeIds = await discoveryTypeIds(db, orgId)
  if (!typeIds.length) return []
  const { data, error } = await db.from('nr_bookings').select('id, created_at, starts_at, status')
    .eq('org_id', orgId).in('appointment_type_id', typeIds).gte('created_at', since).neq('status', 'cancelled')
    .order('created_at', { ascending: true }).limit(200)
  if (error) throw fail('nr_bookings', error)
  // the contact is resolved at send time (the booking sync may create it in the meantime)
  return (data ?? []).map((r: any) => ({ source: 'booking', source_id: r.id, contact_id: null, occurred_at: r.created_at, starts_at: r.starts_at ?? null }))
}

/** New University accounts (participants) in this org, or with no org yet. */
export async function universitySignups(db: SupabaseClient, orgId: string, since: string): Promise<Array<Candidate & { email: string | null }>> {
  const { data, error } = await db.from('profiles').select('id, email, created_at, organization_id')
    .eq('role', 'participant').gte('created_at', since).order('created_at', { ascending: true }).limit(200)
  if (error) throw fail('profiles', error)
  return (data ?? []).filter((r: any) => !r.organization_id || r.organization_id === orgId)
    .map((r: any) => ({ source: 'university_signup' as const, source_id: r.id, contact_id: null, occurred_at: r.created_at, starts_at: null, email: r.email ?? null }))
}

export async function collect(db: SupabaseClient, orgId: string, since: string): Promise<Candidate[]> {
  const [a, b, c, d] = await Promise.all([leadDevices(db, orgId, since), forms(db, orgId, since), bookings(db, orgId, since), universitySignups(db, orgId, since)])
  return [...a, ...b, ...c, ...d.map(({ email: _e, ...x }) => x)]
}

async function contactFacts(db: SupabaseClient, contactId: string | null) {
  if (!contactId) return null
  const { data, error } = await db.from('contacts').select('id, first_name, last_name, email, phone, tags, merged_into_id').eq('id', contactId).maybeSingle()
  if (error) throw fail('contacts', error)
  if (!data) return null
  // a merged contact's card is the winner's
  if ((data as any).merged_into_id) return contactFacts(db, (data as any).merged_into_id)
  return data as any
}

export const TEST_TAG = 'quarantine:test-record'

/**
 * The facts for one alert, read now. null when the source row is gone. `test` is true when the contact is tagged
 * as a test record, so the alert is skipped rather than sent.
 */
export async function loadFacts(db: SupabaseClient, a: { org_id: string; source: LeadSource; source_id: string; contact_id: string | null; starts_at: string | null }):
  Promise<{ facts: LeadFacts; test: boolean } | null> {
  const name = (f?: string | null, l?: string | null) => [f, l].filter((x) => x && String(x).trim()).join(' ') || null
  let facts: LeadFacts
  let contactId = a.contact_id
  if (a.source === 'lead_device') {
    const { data: s, error } = await db.from('lead_device_submissions').select('device_id, contact_id, first_name, last_name, email, phone, outcome_label')
      .eq('id', a.source_id).maybeSingle()
    if (error) throw fail('lead_device_submissions', error)
    if (!s) return null
    const { data: dev } = await db.from('lead_devices').select('name').eq('id', (s as any).device_id).maybeSingle()
    contactId = (s as any).contact_id ?? contactId
    facts = { source: a.source, name: name((s as any).first_name, (s as any).last_name), label: (dev as any)?.name ?? null, outcome: (s as any).outcome_label ?? null,
      email: (s as any).email ?? null, phone: (s as any).phone ?? null, startsAt: null, contactId }
  } else if (a.source === 'form') {
    const { data: s, error } = await db.from('form_submissions').select('form_id, contact_id').eq('id', a.source_id).maybeSingle()
    if (error) throw fail('form_submissions', error)
    if (!s) return null
    const { data: form } = await db.from('form_definitions').select('name').eq('id', (s as any).form_id).maybeSingle()
    contactId = (s as any).contact_id ?? contactId
    facts = { source: a.source, name: null, label: (form as any)?.name ?? null, outcome: null, email: null, phone: null, startsAt: null, contactId }
  } else if (a.source === 'booking') {
    const { data: b, error } = await db.from('nr_bookings').select('appointment_type_id, lead_id, participant_id, starts_at, status, intake_answers').eq('id', a.source_id).maybeSingle()
    if (error) throw fail('nr_bookings', error)
    if (!b) return null
    const [{ data: type }, { data: lead }, { data: prof }, { data: sync }] = await Promise.all([
      db.from('nr_appointment_types').select('name, intake_questions').eq('id', (b as any).appointment_type_id).maybeSingle(),
      (b as any).lead_id ? db.from('nr_booking_leads').select('name, email, phone').eq('id', (b as any).lead_id).maybeSingle() : Promise.resolve({ data: null }),
      (b as any).participant_id ? db.from('profiles').select('full_name, email, phone').eq('id', (b as any).participant_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from('hub_booking_syncs').select('contact_id').eq('booking_id', a.source_id).maybeSingle(),
    ])
    const who: any = lead ?? (prof ? { name: (prof as any).full_name, email: (prof as any).email, phone: (prof as any).phone } : null)
    contactId = (sync as any)?.contact_id ?? contactId ?? await contactByEmail(db, a.org_id, who?.email ?? null)
    facts = { source: a.source, name: who?.name ?? null, label: (type as any)?.name ?? null, outcome: null, email: who?.email ?? null, phone: who?.phone ?? null,
      startsAt: (b as any).starts_at ?? a.starts_at, contactId,
      answers: answerList((type as any)?.intake_questions, (b as any).intake_answers ?? null).filter((x) => x.answer).map(({ label, answer }) => ({ label, answer })) }
  } else if (a.source === 'university_signup') {
    const { data: p, error } = await db.from('profiles').select('full_name, email, phone').eq('id', a.source_id).maybeSingle()
    if (error) throw fail('profiles', error)
    if (!p) return null
    contactId = contactId ?? await contactByEmail(db, a.org_id, (p as any).email ?? null)
    facts = { source: a.source, name: (p as any).full_name ?? null, label: null, outcome: null, email: (p as any).email ?? null, phone: (p as any).phone ?? null, startsAt: null, contactId }
  } else {
    facts = { source: 'test', name: 'Speed-to-lead test', label: null, outcome: null, email: null, phone: null, startsAt: null, contactId: null }
    return { facts, test: false }
  }
  // the card fills what the source left blank; the source's own words win
  const c = await contactFacts(db, contactId)
  if (c) {
    facts.contactId = c.id
    facts.name = facts.name ?? name(c.first_name, c.last_name)
    facts.email = facts.email ?? c.email ?? null
    facts.phone = facts.phone ?? c.phone ?? null
  }
  return { facts, test: !!c && Array.isArray(c.tags) && c.tags.includes(TEST_TAG) }
}
