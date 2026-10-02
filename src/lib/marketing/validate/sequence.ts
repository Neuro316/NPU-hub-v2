// src/lib/marketing/validate/sequence.ts
// The one set of checks for a campaign's step list. POST /api/marketing/sequences and the
// Campaign Builder agent both call this (agent ruling 3). Steps are numbered 0..n in the
// order given.
import { SMS_PART_MAX } from '@/lib/sms-split'
import { SMS_STOP_LINE } from '@/lib/marketing/render'

export const MAX_STEPS = 30

export interface StepRow {
  step_order: number
  channel: 'email' | 'sms' | 'wait'
  delay_minutes: number
  subject: string | null
  body: string | null
  kind: 'marketing' | 'service' | null
  step_type: 'message' | 'deliver_asset'
  asset_id: string | null
}

export type HeadCheck = { ok: true; name: string; steps: any[] } | { ok: false; message: string }
export type StepsCheck = { ok: true; rows: StepRow[] } | { ok: false; message: string }

/** The name and the step count, checked before anything is read from the database. */
export function checkSequenceHead(b: any): HeadCheck {
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name) return { ok: false, message: 'Give the sequence a name.' }
  const steps: any[] = Array.isArray(b.steps) ? b.steps : []
  if (steps.length > MAX_STEPS) return { ok: false, message: `A sequence can have at most ${MAX_STEPS} steps.` }
  return { ok: true, name, steps }
}

/** Each step, against the ids of this org's University assets. */
export function checkSteps(steps: any[], assetIds: Set<string>): StepsCheck {
  const rows: StepRow[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] ?? {}
    const n = `Step ${i + 1}`
    const channel = s.channel
    if (!['email', 'sms', 'wait'].includes(channel)) return { ok: false, message: `${n} needs a channel: email, text message, or wait.` }
    const delay = Number.isFinite(Number(s.delay_minutes)) ? Math.max(0, Math.round(Number(s.delay_minutes))) : 0
    const stepType = s.step_type === 'deliver_asset' ? 'deliver_asset' : 'message'
    const kind = channel === 'wait' ? null : (s.kind === 'service' ? 'service' : 'marketing')
    const body = typeof s.body === 'string' ? s.body : ''
    if (channel !== 'wait') {
      if (!body.trim() && stepType === 'message') return { ok: false, message: `${n} needs a message.` }
      if (channel === 'email' && !String(s.subject || '').trim()) return { ok: false, message: `${n} needs a subject line.` }
      // leave room for the STOP line marketing texts get, and for names merged in
      if (channel === 'sms' && body.length + (kind === 'marketing' ? SMS_STOP_LINE.length + 1 : 0) + 60 > SMS_PART_MAX) {
        return { ok: false, message: `${n} is too long for one text message once names and the opt out line are added.` }
      }
    }
    if (stepType === 'deliver_asset' && !assetIds.has(s.asset_id)) return { ok: false, message: `${n} delivers a University asset, so choose one from the list.` }
    rows.push({ step_order: i, channel, delay_minutes: delay, subject: channel === 'email' ? String(s.subject).trim() : null,
      body: channel === 'wait' ? null : body, kind, step_type: stepType, asset_id: stepType === 'deliver_asset' ? s.asset_id : null })
  }
  return { ok: true, rows }
}
