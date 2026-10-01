// src/lib/marketing/validate/form.ts
// The one set of checks for a form definition. POST /api/marketing/forms and the Campaign
// Builder agent both call this (agent ruling 3). Publishing runs definitionProblems first,
// so a published form can always produce a contact and always holds the exact consent text
// it will display.
import { definitionProblems, type FormDefinition } from '@/lib/marketing/intake'
import { SOURCE_KEY } from './route'

export const FORM_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const FORM_STATUSES = ['draft', 'published', 'archived']
export const DEFAULT_SUCCESS = 'Thank you. Your details have been received.'

export interface FormFields {
  slug: string; name: string; status: string; fields: unknown[]; consents: unknown[]; source_key: string; success_message: string
}
export type FormCheck = { ok: true; row: FormFields } | { ok: false; message: string; extra?: Record<string, unknown> }

export function checkForm(b: any): FormCheck {
  const slug = typeof b?.slug === 'string' ? b.slug.trim().toLowerCase() : ''
  if (!FORM_SLUG.test(slug) || slug.length > 60) return { ok: false, message: 'The form address uses lower case letters, numbers, and single dashes.' }
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return { ok: false, message: 'Give the form a name.' }
  const status = FORM_STATUSES.includes(b.status) ? b.status : 'draft'
  const def: FormDefinition = { fields: Array.isArray(b.fields) ? b.fields : [], consents: Array.isArray(b.consents) ? b.consents : [] }
  if (status === 'published') {
    const problems = definitionProblems(def)
    if (problems.length) return { ok: false, message: 'This form cannot be published yet.', extra: { problems } }
  }
  const source = typeof b.source_key === 'string' && b.source_key.trim() ? b.source_key.trim().toLowerCase() : `form:${slug}`
  if (!SOURCE_KEY.test(source)) return { ok: false, message: 'The source key uses lower case letters, numbers, and the characters . _ : -' }
  return { ok: true, row: { slug, name, status, fields: def.fields, consents: def.consents, source_key: source,
    success_message: typeof b.success_message === 'string' && b.success_message.trim() ? b.success_message.trim() : DEFAULT_SUCCESS } }
}
