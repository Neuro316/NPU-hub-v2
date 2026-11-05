// src/lib/resources/suggest.ts
// "Suggested from your call" for Send resources: which library files fit what was said on
// the contact's latest transcribed call, and a short personal note. Pure rules plus the
// orchestration, with the transcript lookup and the Claude call injected, so
// scripts/tests/resource-suggestions.test.mjs loads this file directly. No imports on
// purpose: node's type stripping cannot resolve '@/'.
//
// Privacy (ruled 2026-11-04): Claude receives only the transcript text (speaker labels cut
// to the contact's first name, emails, phone numbers and links redacted), the contact's
// first name and each resource's id, title and description. Nothing here stores or logs
// the prompt or the reply. A person still reviews everything and presses Send.

/** Transcripts older than this are not used. */
export const TRANSCRIPT_DAYS = 7
/** Characters of transcript sent; a long call keeps its opening, where needs come up. */
export const MAX_TRANSCRIPT_CHARS = 30_000
export const MAX_SUGGESTED = 5
export const MAX_NOTE_CHARS = 600
export const STANDARD_CLOSING = 'Reply here anytime with questions.'
/** The hub side of the transcript, as formatSpeakerTranscript writes it. */
export const HUB_LABEL = 'You'

export interface SuggestResource { id: string; name: string; description: string | null }
export interface Suggestion { resource_ids: string[]; note: string | null }
export interface ModelInput { transcript: string; contactFirstName: string; resources: SuggestResource[] }

/** The contact's turns relabelled with their first name only (the stored transcript labels
 *  them with the full name), and emails, phone numbers and links redacted. */
export function cleanTranscript(raw: string, contactFirstName: string): string {
  const first = contactFirstName.trim() || 'Caller'
  const turns = raw.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => {
    const m = p.match(/^([^:\n]{1,80}):\s([\s\S]*)$/)
    if (!m) return p
    return `${m[1].trim() === HUB_LABEL ? HUB_LABEL : first}: ${m[2]}`
  })
  return turns.join('\n\n')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]')
    .slice(0, MAX_TRANSCRIPT_CHARS)
    .trim()
}

/** No em or en dashes in the note: " — " and "—" read as a comma, "–" as a hyphen. */
export function noDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ', ').replace(/–/g, '-').replace(/,\s*,/g, ',')
}

/** The drafted note: Claude's 2 to 3 personal sentences, then the standard closing line and
 *  the sender's first name. */
export function composeNote(personal: string, senderFirstName: string): string {
  const body = noDashes(personal.replace(/\s+/g, ' ').trim())
  return [body, STANDARD_CLOSING, senderFirstName.trim()].filter(Boolean).join('\n\n')
}

/** The model's JSON, kept only where it is valid: resource ids only from the available list
 *  (unknown ids dropped, duplicates removed, at most MAX_SUGGESTED), the note trimmed and
 *  dash-free, or null when missing or too long. */
export function validateSuggestion(raw: unknown, available: SuggestResource[]): { resource_ids: string[]; personal: string | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const allowed = new Set(available.map(a => a.id))
  const ids: string[] = []
  for (const v of Array.isArray(r.resource_ids) ? r.resource_ids : []) {
    if (typeof v === 'string' && allowed.has(v) && !ids.includes(v)) ids.push(v)
    if (ids.length >= MAX_SUGGESTED) break
  }
  let personal = typeof r.note === 'string' ? noDashes(r.note.replace(/\s+/g, ' ').trim()) : ''
  if (personal.length > MAX_NOTE_CHARS) personal = ''
  return { resource_ids: ids, personal: personal || null }
}

export interface SuggestDeps {
  /** The latest completed transcript with this contact in the last TRANSCRIPT_DAYS, or null. */
  findTranscript(): Promise<{ text: string; at: string } | null>
  /** One Claude request; returns the parsed JSON, or throws. */
  callModel(input: ModelInput): Promise<unknown>
}

/** The suggestion for one contact, or null whenever there is nothing to suggest from or the
 *  model fails: the panel then works exactly as without suggestions. */
export async function suggestFromCall(
  opts: { contactFirstName: string; senderFirstName: string; resources: SuggestResource[] },
  deps: SuggestDeps,
): Promise<(Suggestion & { call_at: string }) | null> {
  if (!opts.resources.length) return null
  const found = await deps.findTranscript().catch(() => null)
  const transcript = found ? cleanTranscript(found.text, opts.contactFirstName) : ''
  if (!found || !transcript) return null
  let raw: unknown
  try {
    raw = await deps.callModel({ transcript, contactFirstName: opts.contactFirstName.trim() || 'there', resources: opts.resources })
  } catch {
    return null
  }
  const v = validateSuggestion(raw, opts.resources)
  if (!v || (!v.resource_ids.length && !v.personal)) return null
  return {
    resource_ids: v.resource_ids,
    note: v.personal ? composeNote(v.personal, opts.senderFirstName) : null,
    call_at: found.at,
  }
}
