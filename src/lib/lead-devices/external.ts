// src/lib/lead-devices/external.ts
// POST /api/intake with Authorization: Bearer LEAD_INTAKE_SECRET: a device hosted on another site. The first
// submission from an unknown slug registers it in draft. The secret is compared in constant time, refuses when
// unset or short, and is never logged. Contract: docs/INTEGRATION_CONTRACT.md.
import { createHash, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BRANDS, TYPES, DEVICE_COLUMNS, cleanManifest, slugProblem, type DeviceRow } from './manifest'
import { NEURO_PROGENY_ORG, checkAnswers, checkExternalSubmission, cleanUtm, processSubmission } from './intake'
import { provisionDevice } from './provision'

export function isLeadIntakeCaller(auth: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.LEAD_INTAKE_SECRET
  if (!auth || !secret || secret.trim().length < 32) return false
  const got = createHash('sha256').update(auth).digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(got, want)
}

export type ExternalResult = { status: number; body: Record<string, unknown> }

export async function externalIntake(db: SupabaseClient, body: any): Promise<ExternalResult> {
  const dev = body?.device
  const problem = slugProblem(dev?.slug)
  if (!dev || problem) return { status: 400, body: { error: problem ?? 'Send a device.', fields: { 'device.slug': problem ?? 'Required.' } } }
  const s = body?.submission
  const check = checkExternalSubmission(s)
  if (!check.ok) return { status: 400, body: { error: 'Some fields do not fit.', fields: check.errors } }
  const answers = checkAnswers(s?.answers)
  if (!answers) return { status: 400, body: { error: 'answers must be an object of a sensible size.' } }

  const read = () => db.from('lead_devices').select(DEVICE_COLUMNS).eq('slug', dev.slug).maybeSingle()
  const { data: found, error: readErr } = await read()
  if (readErr) return { status: 500, body: { error: 'Retry with the same key.' } }
  let device = found as unknown as DeviceRow | null

  if (!device) {
    const name = typeof dev.name === 'string' ? dev.name.trim().slice(0, 200) : ''
    if (!name || !BRANDS.includes(dev.brand) || !TYPES.includes(dev.type)) {
      return { status: 400, body: { error: 'The first submission from a new device needs its name, brand and type.' } }
    }
    const { data: made, error } = await db.from('lead_devices').insert({
      org_id: NEURO_PROGENY_ORG, slug: dev.slug, name, brand: dev.brand, type: dev.type,
      hosting: 'external', content: 'form', status: 'draft', manifest: cleanManifest(dev, dev.brand),
    }).select(DEVICE_COLUMNS).single()
    if (error?.code === '23505') device = (await read()).data as unknown as DeviceRow | null
    else if (error || !made) return { status: 500, body: { error: 'Retry with the same key.' } }
    else {
      device = made as unknown as DeviceRow
      await provisionDevice(db, device, null)
      device = ((await read()).data as unknown as DeviceRow | null) ?? device
    }
  }
  if (!device) return { status: 500, body: { error: 'Retry with the same key.' } }
  if (device.hosting !== 'external') return { status: 409, body: { error: 'That slug belongs to a device hosted by the Hub.' } }

  const result = await processSubmission(db, device, {
    channel: 'external', idempotencyKey: s.idempotency_key,
    email: check.email, firstName: check.firstName, lastName: check.lastName, phone: check.phone,
    outcome: typeof s.outcome === 'string' ? s.outcome : null,
    answers, consents: check.consents, utm: cleanUtm(s.utm),
    pageUrl: typeof s.page_url === 'string' ? s.page_url.slice(0, 2000) : null,
    submittedAt: typeof s.submitted_at === 'string' && !Number.isNaN(Date.parse(s.submitted_at)) ? new Date(s.submitted_at).toISOString() : null,
    ipHash: null, userAgent: null, versionId: null, preview: false,
  })
  if (!result.ok) return { status: result.status, body: { error: 'Retry with the same key.' } }
  return { status: 200, body: { ok: true, ...(result.duplicate ? { duplicate: true } : {}), test: result.test, device_status: device.status } }
}
