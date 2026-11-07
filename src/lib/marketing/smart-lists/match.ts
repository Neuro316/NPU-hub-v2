// src/lib/marketing/smart-lists/match.ts
// Smart lists: the field catalog and the matcher. Pure, so the page, the routes and the harness
// (scripts/marketing/smart-list-tamper.cjs) all run the same rules. Membership is never stored:
// a list is evaluated from public.hub_contact_facts on each read, so it is always current.
//
// A list must never send to more people than it says. So an empty list matches nobody, an unknown
// field matches nobody, and a field with no data source yet matches nobody whichever way the rule
// is written ("webinar attended: no" does not mean everyone).

export interface Purchase { key: string; name: string; at: string | null }

export interface ContactFacts {
  contact_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  tags: string[] | null
  source: string | null
  contact_type: string | null
  partnership_type: string | null
  pipeline_id: string | null
  pipeline_name: string | null
  pipeline_stage: string | null
  brand: string | null
  created_at: string
  last_activity_at: string | null
  last_open_at: string | null
  last_click_at: string | null
  booked_at: string | null
  booking_types: string[] | null
  client_reasons: string[] | null
  email_allowed: boolean
  texting_allowed: boolean
  purchases: Purchase[] | null
  lead_devices?: string[] | null
  quiz_archetypes?: string[] | null
}

export type FieldType = 'bool' | 'days' | 'choices' | 'text' | 'purchase'
export type Op = 'is' | 'lte' | 'gte' | 'in' | 'any' | 'none' | 'contains'

export interface FieldDef {
  key: string
  label: string
  group: string
  type: FieldType
  ops: Op[]
  /** Set when nothing records this yet: the list shows "no data source yet" and the rule matches nobody. */
  noDataSource?: string
}

export const FIELDS: FieldDef[] = [
  { key: 'contact_type', label: 'Relationship type', group: 'Relationship', type: 'choices', ops: ['in'] },
  { key: 'partnership', label: 'Has a partnership type', group: 'Relationship', type: 'bool', ops: ['is'] },
  { key: 'current_client', label: 'Current client', group: 'Relationship', type: 'bool', ops: ['is'] },
  { key: 'brand', label: 'Brand', group: 'Brand', type: 'choices', ops: ['in'] },
  { key: 'tags', label: 'Tags (interest and others)', group: 'Tags', type: 'choices', ops: ['any', 'none'] },
  { key: 'quiz_archetype', label: 'Quiz archetype', group: 'Tags', type: 'choices', ops: ['in'] },
  { key: 'source', label: 'Source', group: 'Source', type: 'choices', ops: ['in'] },
  { key: 'lead_device', label: 'Lead device', group: 'Source', type: 'choices', ops: ['in'] },
  { key: 'pipeline', label: 'Pipeline', group: 'Pipeline', type: 'choices', ops: ['in'] },
  { key: 'stage', label: 'Stage', group: 'Pipeline', type: 'choices', ops: ['in'] },
  { key: 'created_days', label: 'Created within (days)', group: 'Engagement', type: 'days', ops: ['lte'] },
  { key: 'opened_days', label: 'Opened an email within (days)', group: 'Engagement', type: 'days', ops: ['lte'] },
  { key: 'clicked_days', label: 'Clicked an email within (days)', group: 'Engagement', type: 'days', ops: ['lte'] },
  { key: 'booked', label: 'Has a booking', group: 'Engagement', type: 'bool', ops: ['is'] },
  { key: 'booking_type', label: 'Booking type contains', group: 'Engagement', type: 'text', ops: ['contains'] },
  { key: 'attended', label: 'Attended a booking', group: 'Engagement', type: 'bool', ops: ['is'], noDataSource: 'Nothing records attendance yet (metrics gap G2).' },
  { key: 'no_show', label: 'No-show', group: 'Engagement', type: 'bool', ops: ['is'], noDataSource: 'Nothing records no-shows yet (metrics gap G2).' },
  { key: 'webinar_registered', label: 'Registered for a webinar', group: 'Engagement', type: 'bool', ops: ['is'], noDataSource: 'Webinars are not recorded yet.' },
  { key: 'webinar_attended', label: 'Attended a webinar', group: 'Engagement', type: 'bool', ops: ['is'], noDataSource: 'Webinars are not recorded yet.' },
  { key: 'inactive_days', label: 'Inactive for at least (days)', group: 'Engagement', type: 'days', ops: ['gte'] },
  { key: 'email_allowed', label: 'Marketing email allowed', group: 'Consent', type: 'bool', ops: ['is'] },
  { key: 'texting_allowed', label: 'Texting allowed', group: 'Consent', type: 'bool', ops: ['is'] },
  { key: 'purchased', label: 'Has bought anything', group: 'Purchases', type: 'bool', ops: ['is'] },
  { key: 'purchase', label: 'Bought product', group: 'Purchases', type: 'purchase', ops: ['any', 'none'] },
]

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

export interface Rule {
  field: string
  op: Op
  value: unknown
  /** Purchase rules only: the date range, as yyyy-mm-dd. */
  since?: string
  until?: string
}
export interface Definition { match: 'all' | 'any'; rules: Rule[] }

const DAY = 86_400_000
const daysSince = (iso: string | null, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY : Infinity)
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

function purchasesInRange(f: ContactFacts, r: Rule): Purchase[] {
  const since = r.since ? new Date(r.since).getTime() : -Infinity
  const until = r.until ? new Date(r.until).getTime() + DAY : Infinity
  return (f.purchases ?? []).filter((p) => {
    if (!r.since && !r.until) return true
    const t = p.at ? new Date(p.at).getTime() : NaN
    return t >= since && t < until
  })
}

function matchRule(r: Rule, f: ContactFacts, now: number): boolean {
  const def = BY_KEY.get(r.field)
  if (!def) return false
  if (def.noDataSource) return false
  if (!def.ops.includes(r.op)) return false
  const yes = r.value === true
  switch (r.field) {
    case 'contact_type': return asList(r.value).includes(f.contact_type ?? '')
    case 'partnership': return !!f.partnership_type === yes
    case 'current_client': return ((f.client_reasons ?? []).length > 0) === yes
    case 'brand': return asList(r.value).includes(f.brand ?? '')
    case 'tags': {
      const hit = asList(r.value).some((t) => (f.tags ?? []).includes(t))
      return r.op === 'any' ? hit : !hit
    }
    case 'source': return asList(r.value).includes(f.source ?? '')
    case 'lead_device': return asList(r.value).some((v) => (f.lead_devices ?? []).includes(v))
    case 'quiz_archetype': return asList(r.value).some((v) => (f.quiz_archetypes ?? []).includes(v))
    case 'pipeline': return asList(r.value).includes(f.pipeline_id ?? '')
    case 'stage': return asList(r.value).includes(f.pipeline_stage ?? '')
    case 'created_days': return daysSince(f.created_at, now) <= Number(r.value)
    case 'opened_days': return daysSince(f.last_open_at, now) <= Number(r.value)
    case 'clicked_days': return daysSince(f.last_click_at, now) <= Number(r.value)
    case 'booked': return !!f.booked_at === yes
    case 'booking_type': {
      const want = String(r.value ?? '').trim().toLowerCase()
      return !!want && (f.booking_types ?? []).some((t) => t.toLowerCase().includes(want))
    }
    // a contact never touched counts from the day it was created
    case 'inactive_days': return daysSince(f.last_activity_at ?? f.created_at, now) >= Number(r.value)
    case 'email_allowed': return f.email_allowed === yes
    case 'texting_allowed': return f.texting_allowed === yes
    case 'purchased': return ((f.purchases ?? []).length > 0) === yes
    case 'purchase': {
      const want = asList(r.value)
      const hit = purchasesInRange(f, r).some((p) => want.includes(p.key))
      return r.op === 'any' ? hit : !hit
    }
    default: return false
  }
}

export function matches(d: Definition, f: ContactFacts, now: number): boolean {
  if (!d || !Array.isArray(d.rules) || d.rules.length === 0) return false
  return d.match === 'any' ? d.rules.some((r) => matchRule(r, f, now)) : d.rules.every((r) => matchRule(r, f, now))
}

export function members(d: Definition, facts: ContactFacts[], now: number): ContactFacts[] {
  return facts.filter((f) => matches(d, f, now))
}

/** Why a list can't be fully trusted yet: the note of each rule on a field with no source. */
export function missingSources(d: Definition): string[] {
  const notes = (d?.rules ?? []).map((r) => BY_KEY.get(r.field)?.noDataSource).filter((n): n is string => !!n)
  return Array.from(new Set(notes))
}

/** Checks a definition from a request. Returns the clean definition, or a message for the person. */
export function checkDefinition(raw: any): { ok: true; definition: Definition } | { ok: false; message: string } {
  if (!raw || !['all', 'any'].includes(raw.match) || !Array.isArray(raw.rules)) return { ok: false, message: 'The list filters could not be read.' }
  if (raw.rules.length > 30) return { ok: false, message: 'A list can have at most 30 filters.' }
  const rules: Rule[] = []
  for (const r of raw.rules) {
    const def = BY_KEY.get(r?.field)
    if (!def) return { ok: false, message: 'One filter uses a field that does not exist.' }
    if (!def.ops.includes(r.op)) return { ok: false, message: `The filter "${def.label}" has an option that does not apply to it.` }
    if (def.type === 'bool' && typeof r.value !== 'boolean') return { ok: false, message: `Choose yes or no for "${def.label}".` }
    if (def.type === 'days' && !(Number(r.value) >= 0)) return { ok: false, message: `Enter a number of days for "${def.label}".` }
    if ((def.type === 'choices' || def.type === 'purchase') && !Array.isArray(r.value)) return { ok: false, message: `Choose at least one value for "${def.label}".` }
    if (def.type === 'text' && typeof r.value !== 'string') return { ok: false, message: `Enter some text for "${def.label}".` }
    const clean: Rule = { field: r.field, op: r.op, value: r.value }
    if (def.type === 'purchase') {
      if (typeof r.since === 'string' && r.since) clean.since = r.since
      if (typeof r.until === 'string' && r.until) clean.until = r.until
    }
    rules.push(clean)
  }
  return { ok: true, definition: { match: raw.match, rules } }
}

/** The values the filter editor offers, drawn from the contacts themselves. */
export function filterOptions(facts: ContactFacts[]) {
  const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x))).sort()
  const pipelines = new Map<string, string>()
  const products = new Map<string, string>()
  for (const f of facts) {
    if (f.pipeline_id) pipelines.set(f.pipeline_id, f.pipeline_name ?? f.pipeline_id)
    for (const p of f.purchases ?? []) products.set(p.key, p.name)
  }
  return {
    contact_type: uniq(facts.map((f) => f.contact_type)),
    brand: ['np', 'wnw'],
    tags: uniq(facts.flatMap((f) => f.tags ?? [])),
    source: uniq(facts.map((f) => f.source)),
    lead_device: uniq(facts.flatMap((f) => f.lead_devices ?? [])),
    quiz_archetype: uniq(facts.flatMap((f) => f.quiz_archetypes ?? [])),
    stage: uniq(facts.map((f) => f.pipeline_stage)),
    pipeline: Array.from(pipelines, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    purchase: Array.from(products, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}
