// src/lib/drafts/rules.ts
// Drafts and review, PR 1 (Running List q10 support drafts, the shared core q35 Part 2 will reuse). Pure: no imports,
// so the harness (scripts/drafts/drafts-tamper.cjs) runs it directly.
//
// Cameron's rules (2026-11-18): drafts are Gmail drafts and the Hub never sends; the Hub stores only a pointer to the
// draft, never its text; after a draft is sent the Hub stores one lesson sentence, never email text; private
// mailboxes stay owner-only. The hard stop (docs/plans/support-drafts.md B3): clinical, legal and financial
// questions are never drafted.

export type DraftKind = 'support' | 'followup'
export type DraftStatus = 'drafted' | 'approved' | 'edited' | 'rejected' | 'sent' | 'needs_person'
export const STATUSES: DraftStatus[] = ['drafted', 'approved', 'edited', 'rejected', 'sent', 'needs_person']

/** org_settings 'hub_drafts_mode': only the exact value 'on' (or { mode: 'on' }) turns drafting on. Anything else is off. */
export function draftsOn(raw: unknown): boolean {
  if (raw === 'on') return true
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).mode === 'on'
}

/** The only triage category drafted. */
export const DRAFT_CATEGORIES = ['participant_support']

// ── who never gets a draft (plan A1: our own replies and automated notices) ───────────────────────────────────
export const OUR_DOMAINS = ['neuroprogeny.com']
const AUTOMATED = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|mailer-daemon|postmaster|bounce|alerts?)([._+-]|@)|@(.*\.)?(zoom\.us|circle\.so|zoomgov\.com|calendly\.com|stripe\.com|google\.com)$/i

export type SkipReason = 'own_sender' | 'automated_sender' | 'thanks_only' | 'already_replied' | 'already_drafted' | 'not_support' | 'no_sender'
export function senderSkip(from: string | null | undefined, ourMailboxes: string[]): SkipReason | null {
  const a = String(from ?? '').trim().toLowerCase()
  if (!a.includes('@')) return 'no_sender'
  if (ourMailboxes.map((m) => m.toLowerCase()).includes(a) || OUR_DOMAINS.some((d) => a.endsWith(`@${d}`))) return 'own_sender'
  if (AUTOMATED.test(a)) return 'automated_sender'
  return null
}

/** The new part of a reply: quoted history ("On ... wrote:", lines starting with ">") is cut off. */
export function newPart(body: string): string {
  const lines = String(body ?? '').split('\n')
  const out: string[] = []
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue
    if (/^\s*On .{3,200}wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^\s*From: .+@.+/i.test(l)) break
    out.push(l)
  }
  return out.join('\n').trim()
}

/** A thank-you or reaction with no question: short, grateful, and nothing asked. */
export function thanksOnly(body: string): boolean {
  const t = newPart(body).replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (t.includes('?')) return false
  if (t.length > 400) return false
  return /\b(thank(s| you)?|thx|appreciate|much appreciated|great|awesome|perfect|sounds good|got it|will do|see you)\b/i.test(t)
}

// ── the hard stop (plan B3), deterministic, before any model call ────────────────────────────────────────────
export type StopClass = 'clinical' | 'legal' | 'financial' | 'crisis'
export const HARD_STOP: Record<StopClass, RegExp> = {
  clinical: /\b(diagnos\w*|symptom\w*|medication\w*|meds|prescri\w*|doctor\w*|physician\w*|psychiatr\w*|therapist\w*|seizure\w*|pain|injur\w*|pregnan\w*|side effects?|panic attacks?|dizz\w*|faint\w*|hospital\w*|clinical|blood pressure|heart rate)\b/i,
  legal: /\b(lawyer\w*|attorney\w*|legal\w*|lawsuit\w*|sue|suing|liabilit\w*|contract\w*|complaint\w*|gdpr|hipaa|subpoena)\b/i,
  financial: /\b(refund\w*|money back|chargebacks?|charged?|charges|invoice\w*|billing|bill|payments?|payment plans?|price\w*|pricing|cost\w*|afford\w*|discount\w*|cancel\w*|credit card|card|receipt\w*|tax)\b/i,
  crisis: /\b(suicid\w*|kill myself|self-?harm|hurt myself|overdose\w*|emergency|911|988|abuse\w*|unsafe|crisis|can'?t go on)\b/i,
}
export const STOP_ORDER: StopClass[] = ['crisis', 'clinical', 'legal', 'financial']
export function hardStop(...texts: Array<string | null | undefined>): StopClass | null {
  const t = texts.filter(Boolean).join('\n')
  for (const c of STOP_ORDER) if (HARD_STOP[c].test(t)) return c
  return null
}
export const STOP_TEXT: Record<StopClass, string> = {
  clinical: 'a clinical or health question',
  legal: 'a legal question',
  financial: 'a payment, price or refund question',
  crisis: 'possible crisis language',
}
export const needsPersonText = (c: StopClass) => `Needs a person: ${STOP_TEXT[c]}`

// ── untrusted input (hub_217 ruling 5) ───────────────────────────────────────────────────────────────────────
export function fence(s: string): string {
  return String(s ?? '').replace(/<\/?email_data/gi, '[email_data')
}

// ── the voice (fixed style block; the voice guide and campaign copy are added by compose) ──────────────────────
export const SIGN_OFF = 'Warmly,\nCameron'
export const STYLE = [
  'Write as Cameron Allen, founder of Neuro Progeny, to one person. Warm, direct and plain.',
  'Plain words, short paragraphs, one idea per sentence, ninth grade reading level.',
  'Never use an em dash or an en dash. Use a comma, a full stop or a colon.',
  'Never give clinical, medical, legal or financial advice, prices or refunds. If the email needs any of these, set hard_stop.',
  'Answer only what was asked. If you do not know a fact (a date, a link, a time), say Cameron will confirm it rather than inventing it.',
  `End with exactly this sign-off on its own lines:\n${SIGN_OFF}`,
].join('\n')

export interface Composed { subject: string; body: string }
export type ComposeOut = { ok: true; draft: Composed } | { ok: false; stop: StopClass } | { ok: false; skip: 'thanks_only' | 'invalid' }

const DASH = /[\u2013\u2014]/g
/** The model's JSON, kept only when it is a usable draft. A hard stop from the model wins. The body is screened again. */
export function validateCompose(raw: unknown, fallbackSubject: string): ComposeOut {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, skip: 'invalid' }
  const r = raw as Record<string, unknown>
  const stop = STOP_ORDER.find((c) => c === r.hard_stop)
  if (stop) return { ok: false, stop }
  if (r.hard_stop !== 'none') return { ok: false, skip: 'invalid' }
  if (r.is_question === false) return { ok: false, skip: 'thanks_only' }
  const body = typeof r.body === 'string' ? r.body.replace(DASH, ',').trim().slice(0, 4000) : ''
  if (body.length < 20) return { ok: false, skip: 'invalid' }
  const out = hardStop(body)
  if (out) return { ok: false, stop: out }
  const subject = (typeof r.subject === 'string' && r.subject.trim() ? r.subject : fallbackSubject).replace(DASH, ',').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  return { ok: true, draft: { subject, body: body.includes('Cameron') ? body : `${body}\n\n${SIGN_OFF}` } }
}

export const replySubject = (s: string | null | undefined) => {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
  return /^re:/i.test(t) ? t : `Re: ${t || 'your message'}`
}

// ── the draft's shape: counts only, never text (what the learning loop compares when Gmail no longer has the draft) ─
export interface Shape { words: number; paragraphs: number; questions: number; links: number; greeting: 'hi_name' | 'hi' | 'other' | 'none'; signoff: boolean }
export function shapeOf(body: string, firstName: string | null = null): Shape {
  const t = String(body ?? '')
  const first = t.trim().split('\n')[0] ?? ''
  const greeting = /^(hi|hello|hey|dear)\b/i.test(first) ? (firstName && first.toLowerCase().includes(firstName.toLowerCase()) ? 'hi_name' : 'hi') : first ? 'other' : 'none'
  return {
    words: (t.match(/\S+/g) ?? []).length,
    paragraphs: t.split(/\n\s*\n/).filter((p) => p.trim()).length,
    questions: (t.match(/\?/g) ?? []).length,
    links: (t.match(/https?:\/\//g) ?? []).length,
    greeting,
    signoff: /\bCameron\b/.test(t.split('\n').slice(-3).join(' ')),
  }
}

// ── the lesson: one sentence, at most 200 characters, carrying no email text ─────────────────────────────────
export const LESSON_MAX = 200
const words = (s: string) => String(s ?? '').toLowerCase().match(/[a-z0-9']+/g) ?? []
/** true when `lesson` repeats any run of 6 words from `source` (email text leaking into the lesson). */
export function quotes(lesson: string, source: string, run = 6): boolean {
  const src = words(source)
  if (src.length < run) return false
  const grams = new Set<string>()
  for (let i = 0; i + run <= src.length; i++) grams.add(src.slice(i, i + run).join(' '))
  const l = words(lesson)
  for (let i = 0; i + run <= l.length; i++) if (grams.has(l.slice(i, i + run).join(' '))) return true
  return false
}
export function validateLesson(raw: unknown, ...sources: string[]): string | null {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).lesson : raw
  if (typeof v !== 'string') return null
  let s = v.replace(/\s+/g, ' ').replace(DASH, ',').trim()
  if (!s) return null
  const firstSentence = s.match(/^.*?[.!?](\s|$)/)
  if (firstSentence) s = firstSentence[0].trim()
  if (s.length > LESSON_MAX) s = s.slice(0, LESSON_MAX - 1).replace(/\s+\S*$/, '') + '.'
  // no addresses, links or quoted email text
  if (/@|https?:\/\/|www\./i.test(s)) return null
  if (sources.some((src) => quotes(s, src))) return null
  return s.length <= LESSON_MAX ? s : null
}

/** Gmail links (opened in the browser; the Hub itself never sends). */
export const draftUrl = (mailbox: string, draftMessageId: string | null, threadId: string) => draftMessageId
  ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#drafts?compose=${encodeURIComponent(draftMessageId)}`
  : `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(threadId)}`
