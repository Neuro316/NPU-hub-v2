// src/lib/agent/claims.ts
// The deterministic claims check every agent-drafted message passes (ruling 5 of
// docs/plans/hub-agent-build-rulings.md), on top of the model following
// docs/marketing/voice-and-claims-guide.md. Pure: no database, no network.
//
// A draft that fails is still saved, marked "needs review", and gets a task naming
// each issue. Nothing here blocks a save; it decides what a person must look at.
//
// GUIDE_VERSION must equal the version line of the guide, and every banned phrase id
// below must appear in the guide's banned list. scripts/agent/claims-tamper.cjs checks
// both, so the guide and this file cannot drift apart silently.
import { SMS_STOP_LINE, htmlToText } from '@/lib/marketing/render'

export const GUIDE_VERSION = '2026-10-01.1'
export const PROGRAM_NAME = 'Consistent Performance Protocol'
/** Two SMS segments. Stricter than the route's hard limit on purpose. */
export const SMS_MAX = 320
/** Room left for names and other merge values, the same allowance the sequences route uses. */
export const SMS_MERGE_ALLOWANCE = 60
export const SUBJECT_MAX = 70

const EM_DASH = new RegExp(`${String.fromCharCode(0x2014)}|&mdash;|&#8212;|&#x2014;`, 'i')

export interface BannedPhrase { id: string; pattern: RegExp; why: string }

export const BANNED: BannedPhrase[] = [
  { id: 'meltdown', pattern: /\bmelt[\s-]?downs?\b/i, why: 'Say "reactions".' },
  { id: 'certified', pattern: /\bcertif(?:y|ies|ied|ying|ication|ications|icate|icates)\b/i, why: 'Training courses never certify anyone.' },
  { id: 'treatment', pattern: /\b(?:treat|treats|treated|treating|treatment|treatments)\b/i, why: 'This is capacity training, not treatment.' },
  { id: 'therapy', pattern: /\btherap(?:y|ies|eutic|ist|ists)\b/i, why: 'This is capacity training, not therapy.' },
  { id: 'cure', pattern: /\bcur(?:e|es|ed|ing)\b/i, why: 'No treatment or outcome claims.' },
  { id: 'heal', pattern: /\bheal(?:s|ed|ing)?\b/i, why: 'No treatment language.' },
  { id: 'diagnosis', pattern: /\bdiagnos(?:e|es|ed|ing|is|tic|tics)\b/i, why: 'No diagnostic claims.' },
  { id: 'disorder', pattern: /\bdisorders?\b/i, why: 'Capacity over pathology.' },
  { id: 'broken', pattern: /\bbroken\b/i, why: 'Nothing is broken; all behavior is adaptive.' },
  { id: 'fix_person', pattern: /\bfix(?:es|ed|ing)?\s+(?:you|your|yourself|it|this|anxiety|stress)\b/i, why: 'Nothing needs fixing; capacity grows.' },
  { id: 'guarantee', pattern: /\bguarantee(?:s|d)?\b/i, why: 'No outcome promises or guarantees.' },
  { id: 'proven', pattern: /\bproven\s+to\b/i, why: 'No outcome promises.' },
  { id: 'will_outcome', pattern: /\bwill\s+(?:fix|cure|eliminate|end|resolve|heal)\b/i, why: 'No outcome promises.' },
  { id: 'sympathovagal', pattern: /\bsympatho-?vagal\b/i, why: 'Never describe LF/HF this way.' },
  { id: 'hrv_score', pattern: /\bHRV\s+scores?\b/i, why: 'HRV is a mirror, not a score.' },
  { id: 'medical_advice', pattern: /\b(?:stop|reduce|change|start|skip)\s+(?:taking\s+)?(?:your\s+)?(?:medications?|meds|prescriptions?)\b/i, why: 'No medical advice.' },
]

const PROGRAM_VARIANT = /\bconsistent[\s-]+performance[\s-]+(?:protocol|program|programme|course|method|system|training)\b/gi

export type ClaimCode = 'em_dash' | 'banned_phrase' | 'program_name' | 'sms_length' | 'subject_length' | 'subject_missing'
export interface ClaimIssue { code: ClaimCode; id: string; detail: string }
export interface ClaimsInput { channel: 'email' | 'sms'; kind: 'marketing' | 'service'; subject?: string | null; body: string }
export interface ClaimsResult { ok: boolean; guideVersion: string; issues: ClaimIssue[] }

export function checkClaims(i: ClaimsInput): ClaimsResult {
  const issues: ClaimIssue[] = []
  const subject = (i.subject ?? '').trim()
  const text = i.channel === 'email' ? htmlToText(i.body) : i.body
  const all = `${subject}\n${text}`

  if (EM_DASH.test(subject) || EM_DASH.test(i.body)) issues.push({ code: 'em_dash', id: 'em_dash', detail: 'Remove the em dash; use a comma, a full stop or a colon.' })
  for (const b of BANNED) {
    const m = all.match(b.pattern)
    if (m) issues.push({ code: 'banned_phrase', id: b.id, detail: `"${m[0]}": ${b.why}` })
  }
  for (const m of all.match(PROGRAM_VARIANT) ?? []) {
    if (m !== PROGRAM_NAME) issues.push({ code: 'program_name', id: 'program_name', detail: `"${m}" should read "${PROGRAM_NAME}".` })
  }
  if (i.channel === 'sms') {
    const len = i.body.length + (i.kind === 'marketing' ? SMS_STOP_LINE.length + 1 : 0) + SMS_MERGE_ALLOWANCE
    if (len > SMS_MAX) issues.push({ code: 'sms_length', id: 'sms_length', detail: `About ${len} characters once names and the opt out line are added; keep it under ${SMS_MAX}.` })
  } else {
    if (!subject) issues.push({ code: 'subject_missing', id: 'subject_missing', detail: 'An email needs a subject line.' })
    else if (subject.length > SUBJECT_MAX) issues.push({ code: 'subject_length', id: 'subject_length', detail: `The subject is ${subject.length} characters; keep it under ${SUBJECT_MAX}.` })
  }
  return { ok: issues.length === 0, guideVersion: GUIDE_VERSION, issues }
}
