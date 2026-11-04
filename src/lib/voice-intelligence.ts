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
  end_time?: number | string | null
  sentence_index?: number | string | null
}

// ── Who said it: measured from the recording itself ─────────────────────────
//
// Voice Intelligence's media_channel did not separate the speakers: on Cameron's
// test calls (2026-10-31) the contact's "Hello?", which is only on channel 2 of
// the dual-channel recording, came back labeled as the Hub user, so every line
// read "You:". The recording is the ground truth, so each sentence is labeled by
// which channel is clearly louder while it is spoken. media_channel is only the
// fallback, for a mono recording or a sentence where neither side dominates.

/** RMS loudness per window, one array per channel (index 0 is channel 1). */
export interface ChannelLevels { windowSec: number; channels: number[][] }

/** Below this RMS (full scale 1.0) a window is treated as silence. */
export const SPEECH_RMS = 0.004
/** One channel must be this many times louder than the other to win. */
export const DOMINANCE = 2

/**
 * Per-window loudness of a 16-bit PCM WAV with two or more channels.
 * Null for anything else (mono, compressed, malformed): the caller falls back.
 */
export function wavChannelLevels(bytes: Uint8Array, windowSec = 0.1): ChannelLevels | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let channels = 0, rate = 0, bits = 0, format = 0, dataAt = -1, dataLen = 0
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = dv.getUint32(o + 4, true)
    if (id === 'fmt ' && o + 24 <= bytes.length) {
      format = dv.getUint16(o + 8, true)
      channels = dv.getUint16(o + 10, true)
      rate = dv.getUint32(o + 12, true)
      bits = dv.getUint16(o + 22, true)
    } else if (id === 'data') {
      dataAt = o + 8
      dataLen = Math.min(size, bytes.length - dataAt)
      break
    }
    o += 8 + size + (size % 2)
  }
  // 1 = PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (PCM inside, for these files).
  if ((format !== 1 && format !== 0xfffe) || bits !== 16 || channels < 2 || !rate || dataAt < 0) return null
  const frameBytes = channels * 2
  const frames = Math.floor(dataLen / frameBytes)
  const per = Math.max(1, Math.round(rate * windowSec))
  const out: number[][] = Array.from({ length: channels }, () => [])
  for (let start = 0; start < frames; start += per) {
    const end = Math.min(frames, start + per)
    for (let c = 0; c < channels; c++) {
      let sum = 0
      for (let f = start; f < end; f++) {
        const v = dv.getInt16(dataAt + f * frameBytes + c * 2, true) / 32768
        sum += v * v
      }
      out[c].push(Math.sqrt(sum / (end - start)))
    }
  }
  return { windowSec: per / rate, channels: out }
}

/** The channel (1 or 2) clearly speaking during this sentence, or null. */
export function loudestChannel(s: TranscriptSentence, levels: ChannelLevels): 1 | 2 | null {
  if (levels.channels.length < 2) return null
  const start = Number(s.start_time ?? NaN)
  if (!Number.isFinite(start)) return null
  const endRaw = Number(s.end_time ?? NaN)
  const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start + 1
  const from = Math.max(0, Math.floor(start / levels.windowSec))
  const to = Math.max(from + 1, Math.ceil(end / levels.windowSec))
  const mean = (ch: number[]) => {
    const w = ch.slice(from, to)
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0
  }
  const a = mean(levels.channels[0]), b = mean(levels.channels[1])
  if (Math.max(a, b) < SPEECH_RMS) return null
  if (a >= b * DOMINANCE) return 1
  if (b >= a * DOMINANCE) return 2
  return null
}

/**
 * media_channel as 1 or 2. Twilio documents it as defaulting to 0, so a
 * transcript that uses 0 at all is read as 0-based.
 */
function reportedChannel(s: TranscriptSentence, zeroBased: boolean): number {
  const n = Number(s.media_channel)
  return zeroBased ? n + 1 : n
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
  contactLabel: string,
  levels: ChannelLevels | null = null
): string {
  const { hub } = channelSpeakers(direction)
  const zeroBased = sentences.some(s => s.media_channel !== null && s.media_channel !== undefined && Number(s.media_channel) === 0)
  const channelOf = (s: TranscriptSentence) =>
    (levels ? loudestChannel(s, levels) : null) ?? reportedChannel(s, zeroBased)
  const ordered = [...sentences]
    .filter(s => String(s.transcript ?? '').trim())
    .sort((a, b) =>
      (Number(a.start_time ?? 0) - Number(b.start_time ?? 0)) ||
      (Number(a.sentence_index ?? 0) - Number(b.sentence_index ?? 0)))
  const turns: { label: string; text: string[] }[] = []
  for (const s of ordered) {
    const label = channelOf(s) === hub ? HUB_SPEAKER_LABEL : (contactLabel || 'Contact')
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
  recording_sid?: string | null
}

export interface IntelligenceDeps {
  /** Auth token of the Hub org whose Twilio account this is, or null. */
  authTokenForAccount(accountSid: string): Promise<string | null>
  /** GET a Voice Intelligence URL with the account's credentials. */
  getJson(url: string, creds: TwilioCreds): Promise<any>
  findCallLog(id: string): Promise<CallLogForTranscript | null>
  /**
   * Loudness per channel of the call's recording (dual-channel WAV), so each
   * sentence is labeled by who is actually speaking. Null or a throw falls back
   * to Twilio's media_channel.
   */
  channelLevels?(recordingSid: string, creds: TwilioCreds): Promise<ChannelLevels | null>
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
  const recordingSid = String(transcript?.channel?.media_properties?.source_sid || log.recording_sid || '')
  let levels: ChannelLevels | null = null
  if (deps.channelLevels && /^RE[0-9a-f]{32}$/i.test(recordingSid)) {
    try { levels = await deps.channelLevels(recordingSid, creds) } catch { levels = null }
  }
  const text = formatSpeakerTranscript(sentences, log.direction, log.contact_label, levels) || 'No speech was detected on this call.'
  const n = await deps.updateCallLog(log.id, { transcript: text, transcription_status: 'completed' })
  return { status: 200, body: { ok: true, call_log_id: log.id, transcription_status: 'completed', rows_updated: n } }
}
