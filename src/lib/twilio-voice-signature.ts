// ═══════════════════════════════════════════════════════════════
// Twilio signature helpers for the VOICE webhooks.
//
// The SMS routes (inbound-sms, message-status) already validate. They resolve
// the per org auth token from a single number field, because on an SMS callback
// exactly one field holds one of our own numbers: `To` inbound, `From` on a
// status callback.
//
// Voice is not that simple, which is why this module exists:
//
//   inbound call        To   = our line           From = the caller
//   outbound recording  To   = the contact        From = our line
//
// So a single field cannot resolve the org for every voice callback. Try `To`
// first, then `From`, and report which one won so a rejection log can say
// whether the org was identified at all or the global env token was used.
// ═══════════════════════════════════════════════════════════════

import { resolveInboundTwilioAuth } from './twilio-org'

/** Which token the caller ended up validating against. */
export type VoiceAuthSource = 'org_via_to' | 'org_via_from' | 'env_fallback' | 'none'

export interface VoiceWebhookAuth {
  orgId: string | null
  authToken: string
  source: VoiceAuthSource
}

/**
 * Resolve the auth token for a voice callback, trying the `To` number and then
 * the `From` number.
 *
 * resolveInboundTwilioAuth already falls back to process.env.TWILIO_AUTH_TOKEN
 * when it cannot map a number to an org, so a non-empty token here does not by
 * itself prove the org was identified. `source` is what tells them apart.
 */
export async function resolveVoiceWebhookAuth(
  to: string | undefined,
  from: string | undefined
): Promise<VoiceWebhookAuth> {
  const envToken = process.env.TWILIO_AUTH_TOKEN || ''

  const viaTo = await resolveInboundTwilioAuth(to || '')
  if (viaTo.orgId && viaTo.authToken) {
    return { orgId: viaTo.orgId, authToken: viaTo.authToken, source: 'org_via_to' }
  }

  const viaFrom = await resolveInboundTwilioAuth(from || '')
  if (viaFrom.orgId && viaFrom.authToken) {
    return { orgId: viaFrom.orgId, authToken: viaFrom.authToken, source: 'org_via_from' }
  }

  // Neither number mapped to an org with a stored token. The env token is the
  // single account most deployments use, so it is the right last resort, but the
  // caller should log that this is what happened.
  if (envToken) return { orgId: null, authToken: envToken, source: 'env_fallback' }
  return { orgId: null, authToken: '', source: 'none' }
}

/**
 * The URL a signature must be computed against.
 *
 * Reconstructed from NEXT_PUBLIC_APP_URL, NOT from x-forwarded-host. Behind
 * Vercel's proxy the handler never sees the URL Twilio actually called, and
 * trusting the forwarded host would make a misconfigured NEXT_PUBLIC_APP_URL
 * validate anyway, so the drift would never be noticed. message-status makes the
 * same choice for the same reason and logs both URLs on rejection.
 *
 * Returns '' when no base URL is configured, which callers must treat as a
 * reason to reject rather than to skip verification.
 */
export function voiceSignatureUrl(pathname: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  if (!base) return ''
  return `${base.replace(/\/+$/, '')}${pathname}`
}

/**
 * Signature enforcement mode for the voice webhooks that are being migrated.
 *
 * 'log'     verify, log a mismatch, and CONTINUE. Default, so turning
 *           validation on cannot take inbound calls down.
 * 'enforce' reject a mismatch with 403.
 *
 * inbound-call is the route that runs in 'log' first: it is the entry point for
 * every inbound call on both lines, so a URL or token mismatch there would mean
 * silence on the main line rather than a failed background callback. Watch the
 * logs, confirm zero mismatches across both lines, then set 'enforce'.
 */
export type VoiceSignatureMode = 'log' | 'enforce'

export function voiceSignatureMode(): VoiceSignatureMode {
  return process.env.TWILIO_VOICE_SIGNATURE_MODE === 'enforce' ? 'enforce' : 'log'
}
