// src/lib/lead-devices/manifest.ts
// Pure rules for a device's identity and manifest. Used by the upload route, the external intake and the page.
import { PUBLIC_HTTPS_ORIGIN } from './public-origin'

export const BRANDS = ['neuro_progeny', 'wnw'] as const
export const TYPES = ['quiz', 'lead_magnet', 'webinar', 'tool', 'form', 'booking'] as const
export type Brand = (typeof BRANDS)[number]
export type DeviceType = (typeof TYPES)[number]

export interface Labelled { key: string; label: string }
export interface HotLeadRule { outcomes?: string[]; answers?: Record<string, string> }
export interface DeviceManifest {
  description: string | null
  outcomes: Labelled[]
  questions: Labelled[]
  fields: string[]
  result_consent_text: string
  email_consent_text: string
  sms_consent_text: string
  asset_url: string | null
  hot_lead_rule: HotLeadRule | null
  script_allowlist: string[]
  embed_origins: string[]
}

export interface DeviceRow {
  id: string
  org_id: string
  slug: string
  name: string
  brand: Brand
  type: DeviceType
  hosting: 'hub' | 'external'
  content: 'html' | 'form'
  status: 'draft' | 'live' | 'paused'
  manifest: DeviceManifest
  pipeline_id: string | null
  live_version_id: string | null
  assets: Record<string, any>
  provisioned_at: string | null
  provision_error: string | null
  test_drive_passed_at: string | null
  went_live_at: string | null
}

export const DEVICE_COLUMNS = 'id, org_id, slug, name, brand, type, hosting, content, status, manifest, pipeline_id, live_version_id, assets, provisioned_at, provision_error, test_drive_passed_at, went_live_at'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED = new Set(['api', 'favicon', 'health', 'lead-device', 'robots', 'sitemap'])
const OUTCOME_KEY = /^[a-z0-9_-]{1,25}$/
const QUESTION_KEY = /^[A-Za-z0-9_.-]{1,80}$/
const MAX_TEXT = 1000

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Campaign source keys allow 80 characters, so a slug stops at 50 and an outcome key at 25. */
export function slugProblem(slug: unknown): string | null {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return 'A device address uses lower case letters, numbers and single hyphens.'
  if (slug.length > 50) return 'A device address can be at most 50 characters.'
  if (RESERVED.has(slug)) return 'That device address is reserved. Choose another.'
  return null
}

export function brandName(brand: Brand): string {
  return brand === 'wnw' ? 'Waynesville Neuro Wellness' : 'Neuro Progeny'
}

export const defaultResultText = () => 'Email me my result.'
export const defaultEmailText = (b: Brand) => `Also email me news and offers from ${brandName(b)}. I can unsubscribe at any time.`
export const defaultSmsText = (b: Brand) => `Text me reminders and offers from ${brandName(b)}. Message and data rates may apply. Reply STOP to opt out.`

function labelled(raw: unknown, keyOk: RegExp, lower: boolean): Labelled[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Labelled[] = []
  for (const r of raw) {
    const k = typeof r?.key === 'string' ? (lower ? r.key.trim().toLowerCase() : r.key.trim()) : ''
    if (!keyOk.test(k) || seen.has(k)) continue
    seen.add(k)
    out.push({ key: k, label: text(r?.label, 200) ?? k })
  }
  return out.slice(0, 50)
}

function origins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.filter((o): o is string => typeof o === 'string' && PUBLIC_HTTPS_ORIGIN.test(o)))).slice(0, 20)
}

/** Whatever was sent becomes a manifest of known fields. Anything else is dropped, never stored. */
export function cleanManifest(raw: any, brand: Brand): DeviceManifest {
  const asset = text(raw?.asset_url, 2000)
  const hot = raw?.hot_lead_rule && typeof raw.hot_lead_rule === 'object' ? raw.hot_lead_rule : null
  const hotOutcomes = Array.isArray(hot?.outcomes) ? hot.outcomes.filter((o: unknown) => typeof o === 'string').map((o: string) => o.toLowerCase()).slice(0, 50) : []
  const hotAnswers = hot?.answers && typeof hot.answers === 'object' && !Array.isArray(hot.answers)
    ? Object.fromEntries(Object.entries(hot.answers).filter(([k, v]) => QUESTION_KEY.test(k) && typeof v === 'string').slice(0, 20)) as Record<string, string>
    : {}
  return {
    description: text(raw?.description, 4000),
    outcomes: labelled(raw?.outcomes, OUTCOME_KEY, true),
    questions: labelled(raw?.questions, QUESTION_KEY, false),
    fields: Array.isArray(raw?.fields) ? raw.fields.filter((f: unknown) => typeof f === 'string').map((f: string) => f.slice(0, 80)).slice(0, 50) : [],
    result_consent_text: text(raw?.result_consent_text) ?? defaultResultText(),
    email_consent_text: text(raw?.email_consent_text) ?? defaultEmailText(brand),
    sms_consent_text: text(raw?.sms_consent_text) ?? defaultSmsText(brand),
    asset_url: asset && /^https:\/\//i.test(asset) ? asset : null,
    hot_lead_rule: hotOutcomes.length || Object.keys(hotAnswers).length ? { outcomes: hotOutcomes, answers: hotAnswers } : null,
    script_allowlist: origins(raw?.script_allowlist),
    embed_origins: origins(raw?.embed_origins),
  }
}

export function sourceKey(slug: string, outcome?: string | null): string {
  return outcome ? `ld:${slug}:${outcome}` : `ld:${slug}`
}
export const deviceTag = (slug: string) => `device:${slug}`
export const outcomeTag = (slug: string, outcome: string) => `device:${slug}:${outcome}`

export function hotLeadMatches(rule: HotLeadRule | null | undefined, outcome: string | null, answers: Record<string, unknown>): boolean {
  if (!rule) return false
  if (outcome && (rule.outcomes ?? []).includes(outcome)) return true
  return Object.entries(rule.answers ?? {}).some(([k, v]) => answers[k] === v)
}

/** A submission is a test unless the device is live and this is not a preview. A test writes no contact. */
export function isTestSubmission(status: DeviceRow['status'], preview: boolean): boolean {
  return preview || status !== 'live'
}

/** The three readiness items. Going live needs every one. */
export function readiness(d: Pick<DeviceRow, 'assets' | 'test_drive_passed_at'>, testSubmissions: number) {
  return {
    test_submission: testSubmissions > 0,
    emails_approved: !!d.assets?.emails_approved_at,
    test_drive: !!d.test_drive_passed_at,
  }
}

export const UTM_CHANNELS = ['instagram', 'facebook', 'linkedin', 'podcast', 'email', 'website'] as const
