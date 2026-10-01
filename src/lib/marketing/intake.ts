// src/lib/marketing/intake.ts
// Pure validation of a public form submission against its stored definition
// (form_definitions). The definition is the authority: field labels, which field is
// the email or the phone, and the EXACT consent text shown. The client sends only
// values and the ids of the consent boxes it ticked; consent text never comes from
// the client, so what is recorded is what the form displayed.
import { toE164 } from '@/lib/phone'

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select'
export type MapsTo = 'email' | 'phone' | 'first_name' | 'last_name'

export interface FormField { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; maps_to?: MapsTo }
export interface FormConsent { id: string; channel: 'email' | 'sms'; kind: 'marketing' | 'service'; text: string; required?: boolean }
export interface FormDefinition { fields: FormField[]; consents: FormConsent[] }

export interface IntakeOk {
  ok: true
  email: string | null
  phone: string | null
  first: string
  last: string
  values: Record<string, string>
  consents: FormConsent[]
}
export interface IntakeErr { ok: false; errors: Record<string, string> }

export const MAX_VALUE = 500
const EMAIL = /^[^@\s:]+@[^@\s]+\.[a-z]{2,}$/i

export function validateIntake(def: FormDefinition, values: unknown, ticked: unknown): IntakeOk | IntakeErr {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>
  const t = new Set(Array.isArray(ticked) ? ticked.filter((x) => typeof x === 'string') : [])
  const errors: Record<string, string> = {}
  const out: Record<string, string> = {}
  let email: string | null = null, phone: string | null = null, first = '', last = ''

  for (const f of def.fields ?? []) {
    const raw = typeof v[f.key] === 'string' ? (v[f.key] as string).trim() : ''
    if (!raw) { if (f.required) errors[f.key] = `Please fill in ${f.label}.`; continue }
    if (raw.length > MAX_VALUE) { errors[f.key] = `${f.label} is too long.`; continue }
    if (f.type === 'email' && !EMAIL.test(raw)) { errors[f.key] = 'Please enter a valid email address.'; continue }
    if (f.type === 'tel' && !toE164(raw)) { errors[f.key] = 'Please enter a valid phone number.'; continue }
    if (f.type === 'select' && f.options && !f.options.includes(raw)) { errors[f.key] = `Please choose one of the options for ${f.label}.`; continue }
    out[f.key] = raw
    if (f.maps_to === 'email') email = raw.toLowerCase()
    if (f.maps_to === 'phone') phone = toE164(raw)
    if (f.maps_to === 'first_name') first = raw
    if (f.maps_to === 'last_name') last = raw
  }
  const consents: FormConsent[] = []
  for (const c of def.consents ?? []) {
    if (t.has(c.id)) consents.push(c)
    else if (c.required) errors[`consent:${c.id}`] = 'Please tick this box to continue.'
  }
  for (const c of consents) {
    if (c.channel === 'email' && !email) errors[`consent:${c.id}`] = 'Add an email address to agree to email.'
    if (c.channel === 'sms' && !phone) errors[`consent:${c.id}`] = 'Add a phone number to agree to text messages.'
  }
  if (!email && !phone && !Object.keys(errors).length) errors._form = 'Please give us an email address or a phone number.'
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, email, phone, first, last, values: out, consents }
}

/** Pure: a form definition is publishable only if it can produce a contact and its consent text is complete. */
export function definitionProblems(def: FormDefinition): string[] {
  const p: string[] = []
  const keys = new Set<string>()
  for (const f of def.fields ?? []) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key)) p.push(`field key "${f.key}" must be lower case letters, numbers and underscores`)
    if (keys.has(f.key)) p.push(`field key "${f.key}" is used twice`)
    keys.add(f.key)
    if (!f.label?.trim()) p.push(`field "${f.key}" needs a label`)
  }
  if (!(def.fields ?? []).some((f) => f.maps_to === 'email' || f.maps_to === 'phone')) p.push('the form needs an email or a phone field')
  for (const c of def.consents ?? []) {
    if (!c.text?.trim()) p.push(`consent "${c.id}" needs the exact text the visitor will see`)
    if (c.channel === 'sms' && !(def.fields ?? []).some((f) => f.maps_to === 'phone')) p.push(`consent "${c.id}" is for text messages but the form has no phone field`)
  }
  return p
}
