// src/lib/inbound-voice.ts
// Shared pieces of the inbound voice flow, used by BOTH
// /api/twilio/inbound-call (the initial webhook) and
// /api/twilio/ring-complete (the ring <Dial> action handler).
//
// ── THE RULE THIS MODULE EXISTS TO ENFORCE ──────────────────────────────────
// The ring <Dial> now carries an `action`, which means Twilio ABANDONS the rest
// of the inbound-call document when the dial ends. Any voicemail verbs left
// after that <Dial> would be dead code and the caller would get dead air.
// So the voicemail TwiML lives HERE, in one function, and the action handler
// emits it for the no-answer case. Never inline voicemail verbs after a
// <Dial action=…> again — put them in appendVoicemail and call it.
//
// Why an action at all, given we previously required its ABSENCE: without it
// Twilio gives us no signal distinguishing "nobody answered" from "answered and
// then hung up", so the document continued into voicemail in BOTH cases — which
// meant hanging up in the browser dumped the caller into the greeting instead of
// ending their call. DialCallStatus is that signal, and it only exists with an
// action URL.
//
// ── MULTI-LINE ───────────────────────────────────────────────────────────────
// Each entry of crm_twilio.numbers may carry its own greeting_url,
// greeting_text, ring_timeout_seconds and forward_number. resolveInboundOrgContext
// resolves per LINE first and per ORG second, so a line with none of them set
// (the Neuro Progeny main line) behaves exactly as before. The ring <Dial> is
// built by appendRingDial so the NP TwiML can be snapshot-checked
// (scripts/np-twiml-snapshot.ts).
//
// Imports are RELATIVE (not '@/lib/...') on purpose: that snapshot script runs
// this file under plain `node`, which does not resolve the tsconfig alias.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toE164 } from './phone';
import { receiverIdentity } from './voice-identity';

export interface InboundOrgContext {
  orgId: string | null;
  /** The org number that was dialled, E.164. '' when unmatched. */
  lineE164: string;
  lineNickname: string;
  greetingUrl: string;
  /** Spoken greeting for lines with text but no audio. '' = none. */
  greetingText: string;
  /** Cell to ring alongside the browser. '' = ring the Hub only. */
  forwardNumber: string;
  /** Seconds the browser rings before the call falls to voicemail. */
  ringTimeoutSeconds: number;
}

/** Default when nothing is configured — the value shipped before the setting existed. */
export const DEFAULT_RING_TIMEOUT_SECONDS = 20;
export const MIN_RING_TIMEOUT_SECONDS = 5;
export const MAX_RING_TIMEOUT_SECONDS = 30;

/**
 * Clamp a configured ring timeout into a range that keeps the feature working.
 *
 * The floor is the point: a 0 (or 1s) timeout means the browser never really
 * rings and every call drops to voicemail — browser calling would be silently
 * disabled with the UI still claiming "Ready". The settings slider also starts
 * at MIN, but this clamp is the authority: it also covers values written to the
 * JSON by anything other than that slider, and any legacy/garbage value.
 */
export function clampRingTimeout(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_RING_TIMEOUT_SECONDS;
  return Math.min(MAX_RING_TIMEOUT_SECONDS, Math.max(MIN_RING_TIMEOUT_SECONDS, Math.round(n)));
}

/** A present, non-empty string value, else ''. */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
}

/**
 * Resolve the receiving number's org, line, greeting, ring timeout and forward
 * number. Independent of crm_twilio_numbers: matches `to` against the numbers
 * configured in org_settings.crm_twilio, comparing after toE164 on both sides.
 *
 * Per-line value wins when present; org-level value is the fallback; the
 * shipped default is the floor. An org whose numbers carry none of the per-line
 * keys resolves exactly as it did before those keys existed.
 */
export async function resolveInboundOrgContext(
  admin: SupabaseClient,
  to: string
): Promise<InboundOrgContext> {
  const ctx: InboundOrgContext = {
    orgId: null,
    lineE164: '',
    lineNickname: '',
    greetingUrl: '',
    greetingText: '',
    forwardNumber: '',
    ringTimeoutSeconds: DEFAULT_RING_TIMEOUT_SECONDS,
  };
  try {
    const want = toE164(to);
    const { data: rows } = await admin
      .from('org_settings')
      .select('org_id, setting_value')
      .eq('setting_key', 'crm_twilio');
    let line: any = null;
    const match = (rows || []).find((r: any) => {
      if (!Array.isArray(r.setting_value?.numbers)) return false;
      line = r.setting_value.numbers.find((n: any) =>
        n?.phone === to || (want && toE164(String(n?.phone || '')) === want));
      return !!line;
    });
    if (match) {
      const org = match.setting_value || {};
      ctx.orgId = match.org_id;
      ctx.lineE164 = toE164(String(line?.phone || '')) || str(line?.phone);
      ctx.lineNickname = str(line?.nickname);
      ctx.forwardNumber = str(line?.forward_number) || str(org.forward_number);
      // Absent -> clampRingTimeout returns the 20s default, so behaviour is
      // unchanged until someone actually moves a slider.
      ctx.ringTimeoutSeconds = clampRingTimeout(
        str(line?.ring_timeout_seconds) ? line.ring_timeout_seconds : org.ring_timeout_seconds
      );
      ctx.greetingText = str(line?.greeting_text);
      // Must be a URL Twilio's servers can fetch UNAUTHENTICATED — a public
      // Storage object, never the session-gated /api/comms/recording proxy
      // (Twilio would get a 401).
      const url = str(line?.greeting_url) || str(org.greeting_url);
      if (url && !/^https:\/\//i.test(url)) {
        console.warn('Ignoring non-https greeting_url:', url);
      } else {
        ctx.greetingUrl = url;
      }
    }
  } catch (e) {
    console.warn('inbound org resolution failed:', e);
  }
  return ctx;
}

export interface RingDialOptions {
  orgId: string;
  appUrl: string;
  ringTimeoutSeconds: number;
  /** The dialled org number (E.164). Carried to the browser as the `line` parameter. */
  lineE164: string;
  /** Cell to ring simultaneously. '' = browser only (the unchanged path). */
  forwardNumber: string;
  /** The real caller (Twilio `From`), carried to the browser when callerId is set. */
  callerE164: string;
}

/**
 * Append the ring <Dial> for an inbound call.
 *
 * Browser only (no forward_number) — the Neuro Progeny main line:
 *   <Dial timeout=N action=…/ring-complete method=POST>
 *     <Client><Identity>org-…</Identity><Parameter name="line" value=…/></Client>
 *   </Dial>
 *   NO callerId: for a <Client> leg it would overwrite From, and the browser
 *   needs From intact to show who is calling and to run the normalized match.
 *   The `line` parameter is inert (design D3): it only lets the ringing modal
 *   show which line was dialled.
 *
 * With forward_number — simultaneous ring, first to answer wins, Twilio hangs
 * up the rest:
 *   <Dial … callerId=<the dialled line>>
 *     <Client><Identity>…</Identity>
 *       <Parameter name="caller" value=<From>/><Parameter name="line" …/></Client>
 *     <Number>forward</Number>
 *   </Dial>
 *   callerId applies to the WHOLE <Dial>, so the cell shows a business call and
 *   the browser leg's From becomes the line too; the `caller` parameter carries
 *   the true caller and voice-receiver-context reads it first.
 *
 * `response` is a twilio.twiml.VoiceResponse (typed loosely, see appendVoicemail).
 */
export function appendRingDial(response: any, o: RingDialOptions): void {
  const forward = toE164(o.forwardNumber);
  const ring = response.dial({
    timeout: o.ringTimeoutSeconds,
    ...(o.appUrl ? { action: `${o.appUrl}/api/twilio/ring-complete`, method: 'POST' } : {}),
    ...(forward && o.lineE164 ? { callerId: o.lineE164 } : {}),
  });
  const client = ring.client();
  client.identity(receiverIdentity(o.orgId));
  if (forward && o.callerE164) client.parameter({ name: 'caller', value: o.callerE164 });
  if (o.lineE164) client.parameter({ name: 'line', value: o.lineE164 });
  if (forward) ring.number(forward);
}

/**
 * Append the voicemail leg: custom <Play> greeting when one is set, spoken
 * greeting_text when there is text but no audio, default <Say> otherwise, then
 * <Record> with the recording + transcription callbacks.
 *
 * `response` is a twilio.twiml.VoiceResponse. Typed loosely so this module does
 * not need the SDK's internal types.
 */
export function appendVoicemail(
  response: any,
  opts: { greetingUrl: string; greetingText?: string; appUrl: string }
): void {
  const { greetingUrl, appUrl } = opts;
  const greetingText = (opts.greetingText || '').trim();

  // Degrading to <Say> rather than silence means a missing or removed greeting
  // still gives the caller a usable prompt.
  if (greetingUrl) {
    response.play(greetingUrl);
  } else if (greetingText) {
    response.say({ voice: 'Polly.Joanna-Neural' }, greetingText);
  } else {
    response.say({ voice: 'Polly.Joanna' }, 'Please leave a message after the tone.');
  }

  response.record({
    maxLength: 120,
    playBeep: true,
    ...(appUrl ? {
      recordingStatusCallback: `${appUrl}/api/twilio/recording-ready`,
      // Twilio built-in transcription -> /transcription (v1, swappable).
      transcribe: true,
      transcribeCallback: `${appUrl}/api/twilio/transcription`,
    } : {}),
  });

  response.say({ voice: 'Polly.Joanna' }, 'We did not receive a message. Goodbye.');
}

/** Resolve the public base URL for Twilio callbacks. */
export function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
}
