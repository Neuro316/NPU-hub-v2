// src/lib/bookings/sync.ts
// Build 1: University bookings into Hub pipelines (docs/plans/hub-booking-routes-rulings.md).
//
// Every booking whose appointment type has a row in nr_booking_pipeline_routes is synced
// once, keyed on the booking id (hub_booking_syncs):
//   first sight  find the contact by email, then phone (the duplicate sweep's rules),
//                or create it (source university_booking) when the route allows; place it
//                at the route's stage, never backward; store the answers; timeline entry
//   later runs   a new time (reschedule) or a cancellation rewrites the stored booking
//                and adds a timeline entry. The stage is never moved again.
// Platform tables are read only. Logs and run details carry ids, counts and codes, never
// names, addresses or answers.
import type { SupabaseClient } from '@supabase/supabase-js'
import { findContactByPhoneNormalized } from '@/lib/crm-server'
import { isUsableEmail } from '@/lib/contacts/match'
import { answerList, decidePlacement, type Pipeline } from './placement'

/** Bookings changed within this window are looked at on each run. */
const LOOKBACK_DAYS = 30
const MAX_BOOKINGS = 500

export interface Route {
  id: string
  appointment_type_id: string
  org_id: string
  pipeline_id: string
  pipeline_name: string | null
  stage_name: string
  move_earlier_stages_only: boolean
  create_contact_if_missing: boolean
}

interface Booking {
  id: string
  org_id: string
  appointment_type_id: string
  participant_id: string | null
  lead_id: string | null
  starts_at: string
  ends_at: string | null
  status: string
  timezone_booked: string | null
  intake_answers: Record<string, unknown> | null
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

function splitName(name: string | null | undefined) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return { first_name: parts[0] || 'Guest', last_name: parts.slice(1).join(' ') }
}

function when(iso: string, tz: string | null) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}

/** Guest details: the booking lead, else the linked participant's profile. */
async function guestFor(db: SupabaseClient, b: Booking) {
  if (b.lead_id) {
    const { data } = await db.from('nr_booking_leads').select('name, email, phone, linked_participant_id').eq('id', b.lead_id).maybeSingle()
    if (data) return { name: data.name as string, email: data.email as string | null, phone: data.phone as string | null }
  }
  if (b.participant_id) {
    const { data } = await db.from('profiles').select('full_name, email, phone').eq('id', b.participant_id).maybeSingle()
    if (data) return { name: data.full_name as string | null, email: data.email as string | null, phone: data.phone as string | null }
  }
  return null
}

const CONTACT_COLS = 'id, org_id, pipeline_id, pipeline_stage, merged_into_id'

async function findContact(db: SupabaseClient, orgId: string, email: string | null, phone: string | null) {
  if (email && isUsableEmail(email)) {
    const { data } = await db.from('contacts').select(CONTACT_COLS)
      .eq('org_id', orgId).ilike('email', escapeLike(email.trim())).is('merged_into_id', null)
      .order('created_at', { ascending: true }).limit(1)
    if (data?.[0]) return data[0]
  }
  if (phone && phone.replace(/\D/g, '').length >= 10) {
    const c = await findContactByPhoneNormalized(db, orgId, phone)
    if (c && !c.merged_into_id) return { id: c.id, org_id: c.org_id, pipeline_id: c.pipeline_id, pipeline_stage: c.pipeline_stage, merged_into_id: null }
  }
  return null
}

/** The contact a stored sync points at, following a merge. */
async function liveContact(db: SupabaseClient, id: string) {
  let cur = id
  for (let i = 0; i < 5; i++) {
    const { data } = await db.from('contacts').select('id, merged_into_id').eq('id', cur).maybeSingle()
    if (!data) return null
    if (!data.merged_into_id) return data.id as string
    cur = data.merged_into_id
  }
  return null
}

async function timeline(db: SupabaseClient, orgId: string, contactId: string, event_type: string, title: string, description: string, metadata: Record<string, unknown>) {
  const { error } = await db.from('contact_timeline').insert({
    org_id: orgId, contact_id: contactId, event_type, title, description, metadata,
    source_table: 'nr_bookings', source_id: metadata.booking_id as string, actor_type: 'system',
    occurred_at: new Date().toISOString(),
  })
  if (error) console.error(`[booking-sync] timeline ${event_type} failed: ${error.code ?? 'unknown'}`)
}

/** Moves the contact (the pipeline_changed timeline entry comes from trg_pipeline_timeline) and its deal row. */
async function place(db: SupabaseClient, orgId: string, contactId: string, pipelineId: string, stage: string, entered: boolean) {
  const { error } = await db.from('contacts').update({ pipeline_id: pipelineId, pipeline_stage: stage }).eq('id', contactId)
  if (error) throw new Error(`place ${error.code ?? 'unknown'}`)
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { org_id: orgId, contact_id: contactId, pipeline_key: pipelineId, stage_changed_at: now, won_at: null, lost_at: null, updated_at: now }
  if (entered) row.entered_at = now
  const { error: dErr } = await db.from('hub_pipeline_deals').upsert(row, { onConflict: 'contact_id,pipeline_key' })
  if (dErr) console.error(`[booking-sync] deal row failed: ${dErr.code ?? 'unknown'}`)
}

export interface SyncCounts {
  routes: number; seen: number; created_contacts: number; matched_contacts: number
  synced: number; rescheduled: number; cancelled: number; skipped: number; failed: number
}

export async function runBookingSync(db: SupabaseClient, deadline: number): Promise<SyncCounts> {
  const counts: SyncCounts = { routes: 0, seen: 0, created_contacts: 0, matched_contacts: 0, synced: 0, rescheduled: 0, cancelled: 0, skipped: 0, failed: 0 }

  const { data: routes, error: rErr } = await db.from('nr_booking_pipeline_routes')
    .select('id, appointment_type_id, org_id, pipeline_id, pipeline_name, stage_name, move_earlier_stages_only, create_contact_if_missing')
  if (rErr) throw new Error(`routes ${rErr.code ?? 'unknown'}`)
  counts.routes = routes?.length ?? 0
  if (!routes?.length) return counts
  const routeByType = new Map((routes as Route[]).map(r => [r.appointment_type_id, r]))

  const { data: types, error: tErr } = await db.from('nr_appointment_types')
    .select('id, org_id, name, intake_questions').in('id', Array.from(routeByType.keys()))
  if (tErr) throw new Error(`types ${tErr.code ?? 'unknown'}`)
  const typeById = new Map((types ?? []).map((t: any) => [t.id, t]))

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data: bookings, error: bErr } = await db.from('nr_bookings')
    .select('id, org_id, appointment_type_id, participant_id, lead_id, starts_at, ends_at, status, timezone_booked, intake_answers')
    .in('appointment_type_id', Array.from(routeByType.keys())).gte('updated_at', since)
    .order('updated_at', { ascending: true }).limit(MAX_BOOKINGS)
  if (bErr) throw new Error(`bookings ${bErr.code ?? 'unknown'}`)
  if (!bookings?.length) return counts

  const { data: syncs, error: sErr } = await db.from('hub_booking_syncs')
    .select('booking_id, contact_id, starts_at, status').in('booking_id', bookings.map(b => b.id))
  if (sErr) throw new Error(`syncs ${sErr.code ?? 'unknown'}`)
  const syncById = new Map((syncs ?? []).map((s: any) => [s.booking_id, s]))

  const pipelinesByOrg = new Map<string, Pipeline[]>()
  const pipelinesFor = async (orgId: string) => {
    if (!pipelinesByOrg.has(orgId)) {
      const { data } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'crm_pipelines').maybeSingle()
      const list = (data?.setting_value as any)?.pipelines
      pipelinesByOrg.set(orgId, Array.isArray(list) ? list : [])
    }
    return pipelinesByOrg.get(orgId)!
  }

  for (const b of bookings as Booking[]) {
    if (Date.now() > deadline) break
    counts.seen++
    const route = routeByType.get(b.appointment_type_id)
    const type = typeById.get(b.appointment_type_id)
    if (!route || !type || route.org_id !== b.org_id || type.org_id !== b.org_id) { counts.skipped++; continue }
    try {
      const prior = syncById.get(b.id)
      if (prior) {
        const moved = new Date(prior.starts_at).getTime() !== new Date(b.starts_at).getTime()
        const cancelledNow = b.status === 'cancelled' && prior.status !== 'cancelled'
        if (!moved && prior.status === b.status) continue
        const contactId = prior.contact_id ? await liveContact(db, prior.contact_id) : null
        const { error } = await db.from('hub_booking_syncs')
          .update({ starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, contact_id: contactId, last_synced_at: new Date().toISOString() })
          .eq('booking_id', b.id)
        if (error) throw new Error(`update ${error.code ?? 'unknown'}`)
        if (!contactId) continue
        const meta = { booking_id: b.id, appointment_type_id: b.appointment_type_id, starts_at: b.starts_at, status: b.status }
        if (cancelledNow) {
          counts.cancelled++
          await timeline(db, b.org_id, contactId, 'booking_cancelled', `Booking cancelled: ${type.name}`, `Was ${when(b.starts_at, b.timezone_booked)}`, meta)
        } else if (moved) {
          counts.rescheduled++
          await timeline(db, b.org_id, contactId, 'booking_rescheduled', `Booking rescheduled: ${type.name}`,
            `From ${when(prior.starts_at, b.timezone_booked)} to ${when(b.starts_at, b.timezone_booked)}`, { ...meta, previous_starts_at: prior.starts_at })
        }
        continue
      }

      // first sight: a booking already cancelled before we saw it brings nobody in
      if (b.status === 'cancelled') { counts.skipped++; continue }
      const guest = await guestFor(db, b)
      if (!guest) { counts.skipped++; continue }

      let contact = await findContact(db, b.org_id, guest.email, guest.phone)
      if (contact) counts.matched_contacts++
      else if (!route.create_contact_if_missing) { counts.skipped++; continue }
      else {
        const { data, error } = await db.from('contacts').insert({
          org_id: b.org_id, ...splitName(guest.name),
          email: guest.email && isUsableEmail(guest.email) ? guest.email.trim() : null,
          phone: guest.phone || null, source: 'university_booking',
        }).select(CONTACT_COLS).single()
        if (error || !data) throw new Error(`create ${error?.code ?? 'unknown'}`)
        contact = data
        counts.created_contacts++
      }

      const decision = decidePlacement(await pipelinesFor(b.org_id), route, contact)
      if (decision.stage && (decision.placement === 'entered' || decision.placement === 'moved')) {
        await place(db, b.org_id, contact.id, route.pipeline_id, decision.stage, decision.placement === 'entered')
      }

      const { error: iErr } = await db.from('hub_booking_syncs').insert({
        booking_id: b.id, org_id: b.org_id, contact_id: contact.id, route_id: route.id,
        appointment_type_id: b.appointment_type_id, appointment_type: type.name,
        starts_at: b.starts_at, ends_at: b.ends_at, status: b.status,
        answers: answerList(type.intake_questions, b.intake_answers), placement: decision.placement,
      })
      if (iErr && iErr.code !== '23505') throw new Error(`record ${iErr.code ?? 'unknown'}`)
      if (iErr) continue
      counts.synced++
      const placed = {
        entered: `Added to ${route.pipeline_name ?? 'the pipeline'} at ${decision.stage}.`,
        moved: `Moved to ${decision.stage} in ${route.pipeline_name ?? 'the pipeline'}.`,
        kept: 'Stage kept: the contact was already at or past the booking stage.',
        other_pipeline: 'Stage not changed: the contact is on another pipeline.',
        none: 'Stage not changed: the route\'s pipeline or stage no longer exists.',
      }[decision.placement]
      await timeline(db, b.org_id, contact.id, 'booking_created', `Booked: ${type.name}`,
        `${when(b.starts_at, b.timezone_booked)}. ${placed}`,
        { booking_id: b.id, appointment_type_id: b.appointment_type_id, route_id: route.id, starts_at: b.starts_at, placement: decision.placement })
    } catch (e: any) {
      counts.failed++
      console.error(`[booking-sync] booking ${b.id} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    }
  }
  return counts
}
