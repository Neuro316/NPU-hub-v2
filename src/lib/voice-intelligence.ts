// src/lib/voice-intelligence.ts
// Transcripts of ANSWERED calls, through Twilio Voice Intelligence.
//
// Flow:
//   1. recording-ready gets a <Dial> recording (record-from-answer-dual) and
//      calls requestCallTranscript. The call log row goes to
//      transcription_status 'pending'. The Service has AutoTranscribe off, so
//      only recordings the Hub asks for are transcribed.
//   2. Twilio POSTs /api/twilio/intelligence when the transcript is ready.
//      handleIntelligenceCallback verifies the signature, reads the transcript
//      and its sentences, and writes the speaker-labeled text and status onto the
//      call log row named by the transcript's customer_key (the call_logs id).
//
// Voicemails do NOT come through here. They keep Twilio's built-in <Record>
// transcription (/api/twilio/transcription), unchanged.
//
// Channels of a <Dial> dual recording: channel 1 is the PARENT leg, channel 2 the
// CHILD leg. Outbound from the browser, the parent is the Hub user and the child
// is the contact. Inbound, the parent is the caller (the contact) and the child is
// whoever answered for the Hub (browser or forwarded cell).
//
// No relative imports: scripts/tests/voice-intelligence.test.mjs loads this file
// directly under node's type stripping.
import twilio from 'twilio'
import { createHash } from 'node:crypto'

export const INTELLIGENCE_API = 'https://intelligence.twilio.com/v2'
export const HUB_SPEAKER_LABEL = 'You'

export type CallDirection = 'inbound' | 'outbound'

export interface TwilioCreds { accountSid: string; authToken: string }

/** Which recording channel carries the Hub user and which the contact. */
export function channelSpeakers(direction: CallDirection): { hub: 1 | 2; contact: 1 | 2 } {
  return direction === 'outbound' ? { hub: 1, contact: 2 } : { hub: 2, contact: 1 }
}

export interface TranscriptSentence {
  media_channel?: number | string | null
  transcript?: string | null
  start_time?: number | string | null
  sentence_index?: number | string | null
}

/**
 * One block of text, one paragraph per speaker turn:
 *   You: Hi Sharon, thanks for making the time.
 *   Sharon McCoy: Of course.
 * Consecutive sentences on the same channel are joined into one turn.
 */
export function formatSpeakerTranscript(
  sentences: TranscriptSentence[],
  direction: CallDirection,
  contactLabel: string
): string {
  const { hub } = channelSpeakers(direction)
  const ordered = [...sentences]
    .filter(s => String(s.transcript ?? '').trim())
    .sort((a, b) =>
      (Number(a.start_time ?? 0) - Number(b.start_time ?? 0)) ||
      (Number(a.sentence_index ?? 0) - Number(b.sentence_index ?? 0)))
  const turns: { label: string; text: string[] }[] = []
  for (const s of ordered) {
    const label = Number(s.media_channel) === hub ? HUB_SPEAKER_LABEL : (contactLabel || 'Contact')
    const text = String(s.transcript).trim()
    const last = turns[turns.length - 1]
    if (last && last.label === label) last.text.push(text)
    else turns.push({ label, text: [text] })
  }
  return turns.map(t => `${t.label}: ${t.text.join(' ')}`).join('\n\n')
}

const basicAuth = (c: TwilioCreds) =>
  'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')

/**
 * Ask Voice Intelligence to transcribe one recording. customer_key carries the
 * call_logs id so the completion callback can find the row without a lookup.
 */
export async function requestCallTranscript(opts: {
  creds: TwilioCreds
  serviceSid: string
  recordingSid: string
  callLogId: string
  direction: CallDirection
  contactLabel: string
  fetchImpl?: typeof fetch
}): Promise<{ ok: true; transcriptSid: string } | { ok: false; error: string }> {
  const f = opts.fetchImpl ?? fetch
  const { hub, contact } = channelSpeakers(opts.direction)
  const channel = {
    media_properties: { source_sid: opts.recordingSid },
    participants: [
      { user_id: 'hub', channel_participant: hub, full_name: HUB_SPEAKER_LABEL, role: 'Agent' },
      { user_id: 'contact', channel_participant: contact, full_name: opts.contactLabel || 'Contact', role: 'Customer' },
    ],
  }
  try {
    const res = await f(`${INTELLIGENCE_API}/Transcripts`, {
      method: 'POST',
      headers: { Authorization: basicAuth(opts.creds), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ServiceSid: opts.serviceSid,
        Channel: JSON.stringify(channel),
        CustomerKey: opts.callLogId,
      }).toString(),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || !j?.sid) return { ok: false, error: `Twilio ${res.status}: ${j?.message || 'no transcript sid'}` }
    return { ok: true, transcriptSid: j.sid }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

/**
 * Twilio's X-Twilio-Signature check for this webhook, fail closed.
 * A JSON body is signed over the URL that carries bodySHA256 (the hash of the
 * body); a form body is signed over the URL plus its params, the classic scheme.
 */
export function verifyTwilioSignature(
  authToken: string, signature: string, url: string, rawBody: string, contentType: string
): boolean {
  if (!authToken || !signature || !url) return false
  try {
    if (/[?&]bodySHA256=/.test(url)) {
      return twilio.validateRequestWithBody(authToken, signature, url, rawBody)
    }
    const params: Record<string, string> = {}
    if (contentType.includes('application/x-www-form-urlencoded')) {
      new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v })
    }
    return twilio.validateRequest(authToken, signature, url, params)
  } catch {
    return false
  }
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

export interface CallLogForTranscript {
  id: string
  direction: CallDirection
  /** The Twilio account of the row's org, so a callback can't write across accounts. */
  account_sid: string
  contact_label: string
}

export interface IntelligenceDeps {
  /** Auth token of the Hub org whose Twilio account this is, or null. */
  authTokenForAccount(accountSid: string): Promise<string | null>
  /** GET a Voice Intelligence URL with the account's credentials. */
  getJson(url: string, creds: TwilioCreds): Promise<any>
  findCallLog(id: string): Promise<CallLogForTranscript | null>
  /** Rows updated. */
  updateCallLog(id: string, fields: { transcript: string | null; transcription_status: 'completed' | 'failed' }): Promise<number>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FAILED_STATES = new Set(['failed', 'canceled', 'cancelled', 'error'])
const MAX_SENTENCE_PAGES = 50

function parsePayload(rawBody: string, contentType: string): Record<string, any> {
  if (contentType.includes('application/json') || rawBody.trim().startsWith('{')) {
    try { return JSON.parse(rawBody) || {} } catch { return {} }
  }
  const out: Record<string, string> = {}
  new URLSearchParams(rawBody).forEach((v, k) => { out[k] = v })
  return out
}

/** The completion webhook. Returns the HTTP status and JSON body to send. */
export async function handleIntelligenceCallback(
  req: { rawBody: string; contentType: string; url: string; signature: string },
  deps: IntelligenceDeps
): Promise<{ status: number; body: Record<string, unknown> }> {
  const p = parsePayload(req.rawBody, req.contentType)
  const accountSid = String(p.account_sid ?? p.AccountSid ?? '')
  const transcriptSid = String(p.transcript_sid ?? p.TranscriptSid ?? '')
  if (!accountSid || !transcriptSid) return { status: 400, body: { error: 'Missing account_sid or transcript_sid' } }

  // Verify before reading anything else: a forged callback could otherwise
  // write text onto a client's call.
  const authToken = await deps.authTokenForAccount(accountSid)
  if (!authToken || !verifyTwilioSignature(authToken, req.signature, req.url, req.rawBody, req.contentType)) {
    return { status: 403, body: { error: 'Forbidden' } }
  }
  const creds = { accountSid, authToken }

  const transcript = await deps.getJson(`${INTELLIGENCE_API}/Transcripts/${encodeURIComponent(transcriptSid)}`, creds)
  const callLogId = String(transcript?.customer_key ?? p.customer_key ?? '')
  if (!UUID.test(callLogId)) return { status: 200, body: { ok: true, matched: false, reason: 'no customer_key' } }

  const log = await deps.findCallLog(callLogId)
  if (!log) return { status: 200, body: { ok: true, matched: false } }
  if (log.account_sid !== accountSid) return { status: 200, body: { ok: true, matched: false, reason: 'account mismatch' } }

  const state = String(transcript?.status ?? '').toLowerCase()
  if (FAILED_STATES.has(state)) {
    const n = await deps.updateCallLog(log.id, { transcript: null, transcription_status: 'failed' })
    return { status: 200, body: { ok: true, call_log_id: log.id, transcription_status: 'failed', rows_updated: n } }
  }
  if (state && state !== 'completed') {
    // Still queued or in progress; Twilio calls again when it is done.
    return { status: 202, body: { ok: true, call_log_id: log.id, pending: state } }
  }

  const sentences: TranscriptSentence[] = []
  let next: string | null = `${INTELLIGENCE_API}/Transcripts/${encodeURIComponent(transcriptSid)}/Sentences?PageSize=1000`
  for (let page = 0; next && page < MAX_SENTENCE_PAGES; page++) {
    const j: any = await deps.getJson(next, creds)
    sentences.push(...(Array.isArray(j?.sentences) ? j.sentences : []))
    next = j?.meta?.next_page_url || null
  }
  const text = formatSpeakerTranscript(sentences, log.direction, log.contact_label) || 'No speech was detected on this call.'
  const n = await deps.updateCallLog(log.id, { transcript: text, transcription_status: 'completed' })
  return { status: 200, body: { ok: true, call_log_id: log.id, transcription_status: 'completed', rows_updated: n } }
}
