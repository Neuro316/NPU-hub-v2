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

import type { SupabaseClient } from '@supabase/supabase-js';

export interface InboundOrgContext {
  orgId: string | null;
  greetingUrl: string;
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

/**
 * Resolve the receiving number's org, its custom greeting, and the (dormant)
 * forward number. Independent of crm_twilio_numbers: matches `to` against the
 * numbers configured in org_settings.crm_twilio.
 */
export async function resolveInboundOrgContext(
  admin: SupabaseClient,
  to: string
): Promise<InboundOrgContext> {
  const ctx: InboundOrgContext = {
    orgId: null,
    greetingUrl: '',
    forwardNumber: '',
    ringTimeoutSeconds: DEFAULT_RING_TIMEOUT_SECONDS,
  };
  try {
    const { data: rows } = await admin
      .from('org_settings')
      .select('org_id, setting_value')
      .eq('setting_key', 'crm_twilio');
    const match = (rows || []).find((r: any) =>
      Array.isArray(r.setting_value?.numbers) &&
      r.setting_value.numbers.some((n: any) => n.phone === to));
    if (match) {
      ctx.orgId = match.org_id;
      ctx.forwardNumber = String(match.setting_value?.forward_number || '').trim();
      // Absent -> clampRingTimeout returns the 20s default, so behaviour is
      // unchanged until someone actually moves the slider.
      ctx.ringTimeoutSeconds = clampRingTimeout(match.setting_value?.ring_timeout_seconds);
      // Must be a URL Twilio's servers can fetch UNAUTHENTICATED — a public
      // Storage object, never the session-gated /api/comms/recording proxy
      // (Twilio would get a 401).
      const url = String(match.setting_value?.greeting_url || '').trim();
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

/**
 * Append the voicemail leg: custom <Play> greeting when one is set, default
 * <Say> otherwise, then <Record> with the recording + transcription callbacks.
 *
 * `response` is a twilio.twiml.VoiceResponse. Typed loosely so this module does
 * not need the SDK's internal types.
 */
export function appendVoicemail(
  response: any,
  opts: { greetingUrl: string; appUrl: string }
): void {
  const { greetingUrl, appUrl } = opts;

  // Degrading to <Say> rather than silence means a missing or removed greeting
  // still gives the caller a usable prompt.
  if (greetingUrl) {
    response.play(greetingUrl);
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
