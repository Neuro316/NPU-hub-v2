// src/lib/click-to-call/verify.ts
// Verified Twilio signature for the two click-to-call webhooks (ruling 8). Always
// enforced, independent of TWILIO_VOICE_SIGNATURE_MODE, and fail closed: a missing
// base URL, a missing header, a mismatch or a thrown lookup all return null, and the
// route answers 403 before it touches the database.
//
// The signed URL is the one we handed Twilio in calls.create, built from the same
// base (voiceSignatureUrl) with its query string, so the two cannot drift.
import type { NextRequest } from 'next/server'
import { resolveVoiceWebhookAuth, voiceSignatureUrl } from '@/lib/twilio-voice-signature'
import { signatureOk } from './signature'

export interface VerifiedTwilioRequest { params: Record<string, string>; orgId: string | null }

export async function verifyTwilioWebhook(request: NextRequest, label: string): Promise<VerifiedTwilioRequest | null> {
  const params: Record<string, string> = {}
  try {
    new URLSearchParams(await request.text()).forEach((v, k) => { params[k] = v })
  } catch {
    return null
  }
  const signature = request.headers.get('x-twilio-signature') || ''
  const url = voiceSignatureUrl(`${request.nextUrl.pathname}${request.nextUrl.search}`)
  if (!url || !signature) {
    console.error(`[${label}] missing NEXT_PUBLIC_APP_URL or X-Twilio-Signature; rejecting`)
    return null
  }
  try {
    const { orgId, authToken, source } = await resolveVoiceWebhookAuth(params.To, params.From)
    if (!signatureOk(authToken, url, params, signature)) {
      console.error(`[${label}] SIGNATURE REJECTED. url=`, url, '| token_source=', source)
      return null
    }
    return { params, orgId }
  } catch (e: any) {
    console.error(`[${label}] signature check errored, rejecting:`, e?.message ?? String(e))
    return null
  }
}
