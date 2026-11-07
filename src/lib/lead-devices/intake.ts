// src/lib/lead-devices/intake.ts
// One path for every submission, from the Hub lead form and from an external site.
//
// A test submission (the device is not live, or this is a preview) is stored on its device and nothing else
// happens: no contact, no consent, no tag, no pipeline, no campaign, no text. Lists read contacts, so a test
// that touched a contact would reach a list even with is_test set on its own row.
//
// Nothing here logs an answer, a name, an address or consent text: only ids and error codes.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'
import { settleSubmittedPhone, smsConsentBlock, type SettledPhone } from '@/lib/marketing/submitted-phone'
import {
  deviceTag, hotLeadMatches, isTestSubmission, outcomeTag, sourceKey, type DeviceRow,
} from './manifest'

/** Cameron's auth user: the only person who may switch a device live, and who is texted about hot leads. */
export const CAMERON_USER_ID = '22456608-5f7d-495e-af02-7037fea125cc'
export const NEURO_PROGENY_ORG = '00000000-0000-0000-0000-000000000001'

const EMAIL = /^[^@\s:]+@[^@\s]+\.[a-z]{2,}$/i
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_.-]{1,120}$/
const MAX_ANSWERS_CHARS = 64_000

export interface OfferedConsent { channel: 'email' | 'sms'; kind: 'marketing' | 'service'; granted: boolean; text: string }

export interface SubmissionInput {
  channel: 'hosted' | 'form' | 'external'
  idempotencyKey: string
  email: string | null
  firstName: string
  phone: string | null
  outcome: string | null
  answers: Record<string, unknown>
  consents: OfferedConsent[]
  utm: Record<string, string> | null
  pageUrl: string | null
  submittedAt: string | null
  ipHash: string | null
  userAgent: string | null
  versionId: string | null
  preview: boolean
}

export type SubmissionResult =
  | { ok: true; id: string; duplicate: boolean; test: boolean }
  | { ok: false; status: number; error: string }

export function ipHash(ip: string, orgId: string): string {
  return createHash('sha256').update(`${ip}|${orgId}`).digest('hex')
}

/** Pure: the consents offered on the Hub lead form. Only exactly true counts as ticked; the text is the manifest's. */
export function hostedConsents(device: Pick<DeviceRow, 'manifest'>, sent: any): OfferedConsent[] {
  const m = device.manifest
  return [
    { channel: 'email', kind: 'service', granted: sent?.result === true, text: m.result_consent_text },
    { channel: 'email', kind: 'marketing', granted: sent?.email === true, text: m.email_consent_text },
    { channel: 'sms', kind: 'marketing', granted: sent?.sms === true, text: m.sms_consent_text },
  ]
}

/** Pure: the Hub lead form's rules. First name, email and the result box are required; phone is optional. */
export function checkHostedLead(b: any): { ok: true; firstName: string; email: string; phone: string | null } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const firstName = typeof b?.first_name === 'string' ? b.first_name.trim().slice(0, 120) : ''
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : ''
  const rawPhone = typeof b?.phone === 'string' ? b.phone.trim() : ''
  const phone = rawPhone ? toE164(rawPhone) || null : null
  if (!firstName) errors.first_name = 'Please enter your first name.'
  if (!EMAIL.test(email)) errors.email = 'Please enter a valid email address.'
  if (rawPhone && !phone) errors.phone = 'Please enter a valid phone number, or leave it blank.'
  if (b?.consent?.result !== true) errors.result = 'Please tick this box so we can email your result.'
  if (b?.consent?.sms === true && !phone) errors.sms = 'Add a phone number to agree to text messages.'
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, firstName, email, phone }
}

/** Pure: an external submission as sent, or the fields that do not fit. */
export function checkExternalSubmission(s: any): { ok: true; email: string | null; phone: string | null; firstName: string; consents: OfferedConsent[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const email = typeof s?.email === 'string' && s.email.trim() ? s.email.trim().toLowerCase() : null
  const rawPhone = typeof s?.phone === 'string' ? s.phone.trim() : ''
  const phone = rawPhone ? toE164(rawPhone) || null : null
  if (email && !EMAIL.test(email)) errors.email = 'That email address does not look valid.'
  if (rawPhone && !phone) errors.phone = 'That phone number does not look valid.'
  if (!email && !phone) errors.email = 'Send an email or a phone number.'
  if (typeof s?.idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(s.idempotency_key)) errors.idempotency_key = 'Send an idempotency_key: letters, numbers and : _ . - only, up to 120 characters.'
  if (!s?.consent || typeof s.consent !== 'object') errors.consent = 'Send consent, with what the person actually ticked.'
  const consents: OfferedConsent[] = []
  const add = (channel: 'email' | 'sms', granted: unknown, text: unknown, have: unknown) => {
    const shown = typeof text === 'string' ? text.trim() : ''
    if (granted === true && !shown) errors[`consent.${channel}_text`] = 'A ticked box needs the exact text the person saw.'
    if (granted === true && !have) errors[`consent.${channel}`] = `A ${channel} consent needs a ${channel === 'email' ? 'email address' : 'phone number'}.`
    if (shown) consents.push({ channel, kind: 'marketing', granted: granted === true, text: shown.slice(0, 2000) })
  }
  add('email', s?.consent?.email, s?.consent?.email_text, email)
  add('sms', s?.consent?.sms, s?.consent?.sms_text, phone)
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, email, phone, firstName: typeof s?.first_name === 'string' ? s.first_name.trim().slice(0, 120) : '', consents }
}

/** Pure: answers must be a plain object of a sane size. Null means refuse. */
export function checkAnswers(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  return JSON.stringify(raw).length > MAX_ANSWERS_CHARS ? null : (raw as Record<string, unknown>)
}

/** Pure: only utm_source style values of a sane length are kept, under either spelling. */
export function cleanUtm(raw: any): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, string> = {}
  for (const k of ['source', 'medium', 'campaign', 'content']) {
    const v = raw[k] ?? raw[`utm_${k}`]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200)
  }
  return Object.keys(out).length ? out : null
}

async function placeInPipeline(db: SupabaseClient, device: DeviceRow, contactId: string) {
  if (!device.pipeline_id) return
  const { data: pipeline } = await db.from('pipelines').select('id, legacy_key').eq('id', device.pipeline_id).maybeSingle()
  if (!pipeline) return
  const { data: stages } = await db.from('pipeline_stages').select('id, name, position').eq('pipeline_id', device.pipeline_id).is('archived_at', null).order('position')
  const stage = (stages ?? []).find((s: any) => /^new lead$/i.test(s.name)) ?? (stages ?? [])[0]
  if (!stage) return
  // A person already on a pipeline keeps their place there; this one is added alongside it.
  const { error: pErr } = await db.from('contact_pipeline_positions').upsert(
    { contact_id: contactId, org_id: device.org_id, pipeline_id: device.pipeline_id, stage_id: (stage as any).id, source: `lead_device:${device.slug}` },
    { onConflict: 'contact_id,pipeline_id', ignoreDuplicates: true })
  if (pErr) console.error(`[lead-device] device=${device.id} position failed: ${pErr.code ?? 'unknown'}`)
  const { error: cErr } = await db.from('contacts').update({ pipeline_id: (pipeline as any).legacy_key, pipeline_stage: (stage as any).name })
    .eq('id', contactId).is('pipeline_id', null)
  if (cErr) console.error(`[lead-device] device=${device.id} placement failed: ${cErr.code ?? 'unknown'}`)
}

async function recordConsents(db: SupabaseClient, device: DeviceRow, contactId: string, input: SubmissionInput, submissionId: string, settled: SettledPhone) {
  const { data: who } = await db.from('contacts').select('email').eq('id', contactId).maybeSingle()
  const out: Array<OfferedConsent & { recorded: boolean; skipped?: string }> = []
  for (const c of input.consents) {
    if (!c.granted) { out.push({ ...c, recorded: false }); continue }
    if (c.channel === 'sms') {
      const blocked = await smsConsentBlock(db, device.org_id, settled, input.phone)
      if (blocked) { out.push({ ...c, recorded: false, skipped: blocked }); continue }
    }
    if (c.channel === 'email' && String((who as any)?.email ?? '').trim().toLowerCase() !== input.email) { out.push({ ...c, recorded: false, skipped: 'email_differs' }); continue }
    // A public form can be filled in with someone else's details, so it adds a consent but never reverses an opt-out.
    const { data: st } = await db.rpc('consent_state', { p_contact: contactId, p_channel: c.channel, p_kind: c.kind })
    if (String((st as any)?.reason ?? '').endsWith('_revoked')) { out.push({ ...c, recorded: false, skipped: 'opted_out' }); continue }
    const { error } = await db.rpc('record_consent', {
      p_contact: contactId, p_channel: c.channel, p_kind: c.kind, p_action: 'granted', p_basis: 'express_consent',
      p_source: `lead_device:${device.slug}`, p_text_shown: c.text,
      p_evidence: { device_id: device.id, version_id: input.versionId, submission_id: submissionId, channel: input.channel, ip_hash: input.ipHash, user_agent: input.userAgent, ...(c.channel === 'sms' && settled.filled ? { phone_filled: true } : {}) },
    })
    if (error) console.error(`[lead-device] submission=${submissionId} consent failed: ${error.code ?? 'unknown'}`)
    out.push({ ...c, recorded: !error, ...(error ? { skipped: 'write_failed' } : {}) })
  }
  return out
}

export async function processSubmission(db: SupabaseClient, device: DeviceRow, input: SubmissionInput): Promise<SubmissionResult> {
  const test = isTestSubmission(device.status, input.preview)
  const outcomeKey = input.outcome ? input.outcome.trim().toLowerCase() : null
  const outcomeDef = outcomeKey ? device.manifest.outcomes.find((o) => o.key === outcomeKey) ?? null : null
  const labels = Object.fromEntries(device.manifest.questions.filter((q) => q.key in input.answers).map((q) => [q.key, q.label]))

  const { data: seen, error: seenErr } = await db.from('lead_device_submissions').select('id, status, is_test')
    .eq('device_id', device.id).eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (seenErr) return { ok: false, status: 500, error: 'We could not save your details. Please try again.' }
  if ((seen as any)?.status === 'accepted') return { ok: true, id: (seen as any).id, duplicate: true, test: (seen as any).is_test }

  let id: string = (seen as any)?.id ?? ''
  if (!id) {
    const { data: row, error } = await db.from('lead_device_submissions').insert({
      org_id: device.org_id, device_id: device.id, version_id: input.versionId, channel: input.channel,
      idempotency_key: input.idempotencyKey, outcome: outcomeDef?.key ?? null, outcome_label: outcomeDef?.label ?? null,
      answers: input.answers, question_labels: labels,
      consents: input.consents, utm: input.utm, page_url: input.pageUrl, ip_hash: input.ipHash, is_test: test,
      status: 'received', submitted_at: input.submittedAt ?? new Date().toISOString(),
    }).select('id').single()
    if (error?.code === '23505') {
      const { data: again } = await db.from('lead_device_submissions').select('id, is_test')
        .eq('device_id', device.id).eq('idempotency_key', input.idempotencyKey).maybeSingle()
      return { ok: true, id: (again as any)?.id ?? '', duplicate: true, test: (again as any)?.is_test ?? test }
    }
    if (error || !row) return { ok: false, status: 500, error: 'We could not save your details. Please try again.' }
    id = (row as any).id
  }

  if (test) {
    const { error } = await db.from('lead_device_submissions').update({ status: 'accepted' }).eq('id', id)
    if (error) return { ok: false, status: 500, error: 'We could not save your details. Please try again.' }
    return { ok: true, id, duplicate: false, test: true }
  }

  const { data: contactId, error: cErr } = await db.rpc('hub_lead_device_contact', {
    p_org: device.org_id, p_email: input.email, p_phone: input.phone, p_first: input.firstName, p_last: '',
    p_slug: device.slug, p_utm: input.utm,
  })
  if (cErr || !contactId) {
    await db.from('lead_device_submissions').update({ status: 'contact_failed' }).eq('id', id)
    console.error(`[lead-device] submission=${id} contact failed: ${cErr?.code ?? 'no id'}`)
    return { ok: false, status: 500, error: 'We could not save your details. Please try again.' }
  }

  const { data: person } = await db.from('contacts').select('tags').eq('id', contactId).maybeSingle()
  const tags: string[] = (person as any)?.tags ?? []
  const wanted = [deviceTag(device.slug), ...(outcomeDef ? [outcomeTag(device.slug, outcomeDef.key)] : [])]
  const missing = wanted.filter((t) => !tags.includes(t))
  if (missing.length) {
    const { error } = await db.from('contacts').update({ tags: [...tags, ...missing] }).eq('id', contactId)
    if (error) console.error(`[lead-device] submission=${id} tags failed: ${error.code ?? 'unknown'}`)
  }

  await placeInPipeline(db, device, contactId as string)
  const settled = await settleSubmittedPhone(db, contactId as string, input.phone)
  const consents = await recordConsents(db, device, contactId as string, input, id, settled)

  const { error: rErr } = await db.rpc('route_and_enroll', {
    p_org: device.org_id, p_contact: contactId, p_source_key: sourceKey(device.slug, outcomeDef?.key), p_event_id: `lead_device:${id}`,
  })
  if (rErr) console.error(`[lead-device] submission=${id} routing failed: ${rErr.code ?? 'unknown'}`)

  if (hotLeadMatches(device.manifest.hot_lead_rule, outcomeDef?.key ?? null, input.answers)) {
    const { error } = await db.from('hub_sms_outbox').insert({
      org_id: device.org_id, user_id: CAMERON_USER_ID, source: `lead_device:${device.slug}`,
      body: `Hot lead on ${device.name}. Open the Hub to see the contact.`,
    })
    if (error) console.error(`[lead-device] submission=${id} hot lead text failed: ${error.code ?? 'unknown'}`)
  }

  const { error: doneErr } = await db.from('lead_device_submissions').update({ status: 'accepted', contact_id: contactId, consents }).eq('id', id)
  if (doneErr) console.error(`[lead-device] submission=${id} finish failed: ${doneErr.code ?? 'unknown'}`)
  return { ok: true, id, duplicate: false, test: false }
}
