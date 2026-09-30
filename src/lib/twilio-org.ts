import { SupabaseClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { createAdminSupabase } from '@/lib/supabase'
import { toE164 } from '@/lib/phone'

export type NumberPurpose = 'outreach' | 'client_relations' | 'appointments' | 'inbound_main' | 'general'

/**
 * One entry of crm_twilio.numbers. The per-line keys are all optional and all
 * fall back to the org-level value (or the shipped default) when absent — see
 * resolveInboundOrgContext in inbound-voice.ts. A line with none of them set
 * behaves exactly as every line did before they existed; that is the
 * Neuro Progeny main line.
 */
export interface OrgTwilioNumber {
  phone: string
  nickname: string
  purpose: NumberPurpose
  /** Per-line voicemail greeting audio (public https URL Twilio can <Play>). */
  greeting_url?: string
  greeting_path?: string
  greeting_filename?: string
  greeting_updated_at?: string
  /** Spoken greeting when there is no audio; rendered with Polly.Joanna-Neural. */
  greeting_text?: string
  /** Seconds the browser (and the forward cell) ring before voicemail. */
  ring_timeout_seconds?: number
  /** E.164 cell to ring alongside the browser. Empty = ring the Hub only. */
  forward_number?: string
  /**
   * Record answered calls on this line, both inbound calls the team picks up
   * and outbound calls placed from the browser. Absent or false means no
   * recording, which is the behaviour every line had before this field existed.
   * Recording is owner approved; this flag is the per line switch.
   */
  record_calls?: boolean
  /**
   * Speak a recording notice to the caller before connecting. Absent or false
   * means no notice. Independent of record_calls on purpose: the owner has
   * approved recording without an announcement, so the notice is opt in per
   * line rather than implied by recording being on.
   */
  recording_notice_enabled?: boolean
  /** Notice wording. Only read when recording_notice_enabled is true. */
  recording_notice_text?: string
}

export interface OrgTwilioConfig {
  account_sid: string
  auth_token: string
  messaging_service_sid: string
  api_key: string
  api_secret: string
  twiml_app_sid: string
  numbers: OrgTwilioNumber[]
  /**
   * Explicit caller ID for OUTBOUND VOICE calls (set in CRM Settings > Twilio).
   * Voice deliberately does not use the SMS purpose routing — see
   * getVoiceCallerId. Empty means "fall back to the chain".
   */
  voice_caller_id?: string
}

/**
 * Context hints the system uses to auto-pick the right number
 */
export type SendContext =
  | 'campaign'        // bulk email/sms campaign → outreach
  | 'sequence'        // drip sequence step → outreach
  | 'cold_outreach'   // manual cold outreach → outreach
  | 'client_message'  // direct message to enrolled client → client_relations
  | 'support'         // support reply → client_relations
  | 'appointment'     // reminder, scheduling confirmation → appointments
  | 'manual'          // manual one-off from CRM → auto-detect from pipeline stage

/**
 * Maps send context to the preferred number purpose, with fallback chain
 */
const CONTEXT_TO_PURPOSE: Record<SendContext, NumberPurpose[]> = {
  campaign:       ['outreach', 'general'],
  sequence:       ['outreach', 'general'],
  cold_outreach:  ['outreach', 'general'],
  client_message: ['client_relations', 'general'],
  support:        ['client_relations', 'general'],
  appointment:    ['appointments', 'client_relations', 'general'],
  manual:         ['general'],  // resolved dynamically by pipeline stage
}

/**
 * Pipeline stages that indicate a client relationship (post-sale)
 */
const CLIENT_STAGES = ['Won', 'Enrolled', 'Fully Enrolled', 'Active', 'Completed', 'Graduated', 'Alumni', 'Deposit Paid']

/**
 * Get Twilio config for an org. Falls back to env vars if org has no config.
 */
export async function getOrgTwilioConfig(
  _supabase: SupabaseClient,
  orgId: string
): Promise<OrgTwilioConfig> {
  // Use admin client to bypass RLS on org_settings
  const admin = createAdminSupabase()
  const { data } = await admin
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'crm_twilio')
    .maybeSingle()

  const v = data?.setting_value

  if (v?.account_sid) {
    return {
      account_sid: v.account_sid,
      auth_token: v.auth_token,
      messaging_service_sid: v.messaging_service_sid,
      api_key: v.api_key || '',
      api_secret: v.api_secret || '',
      twiml_app_sid: v.twiml_app_sid || '',
      numbers: v.numbers || [],
      voice_caller_id: v.voice_caller_id || '',
    }
  }

  return {
    account_sid: process.env.TWILIO_ACCOUNT_SID || '',
    auth_token: process.env.TWILIO_AUTH_TOKEN || '',
    messaging_service_sid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    api_key: process.env.TWILIO_API_KEY || '',
    api_secret: process.env.TWILIO_API_SECRET || '',
    twiml_app_sid: process.env.TWILIO_TWIML_APP_SID || '',
    numbers: process.env.TWILIO_PHONE_NUMBER
      ? [{ phone: process.env.TWILIO_PHONE_NUMBER, nickname: 'Primary', purpose: 'general' as const }]
      : [],
  }
}

/**
 * Create a Twilio client for a specific org
 */
export function createOrgTwilioClient(config: OrgTwilioConfig) {
  return twilio(config.account_sid, config.auth_token)
}

/**
 * Resolve the auth token to validate an INBOUND webhook signature, keyed on the
 * receiving ("To") number. Multi-tenant: one webhook URL serves all orgs, so we
 * map the number -> org via crm_twilio_numbers, then use that org's per-org
 * auth_token (falling back to the global env token when the number is unmapped
 * or the org has no dedicated credentials).
 *
 * The "To" value is attacker-controllable, but it only selects WHICH token the
 * signature is checked against — a forger still cannot produce a valid signature
 * without possessing that token. This performs a read only; callers must reject
 * (403) on validation failure BEFORE any write.
 */
export async function resolveInboundTwilioAuth(
  toE164: string
): Promise<{ orgId: string | null; authToken: string }> {
  const admin = createAdminSupabase()
  let orgId: string | null = null

  if (toE164) {
    const { data } = await admin
      .from('crm_twilio_numbers')
      .select('org_id')
      .eq('phone_e164', toE164)
      .maybeSingle()
    orgId = data?.org_id ?? null
  }

  if (orgId) {
    const config = await getOrgTwilioConfig(admin, orgId)
    if (config.auth_token) return { orgId, authToken: config.auth_token }
  }

  return { orgId, authToken: process.env.TWILIO_AUTH_TOKEN || '' }
}

/**
 * Pick the right number based on send context and optional pipeline stage
 */
export function pickNumber(
  config: OrgTwilioConfig,
  context: SendContext = 'manual',
  pipelineStage?: string | null
): string | undefined {
  if (!config.numbers?.length) return undefined

  // For manual sends, resolve context from pipeline stage
  let resolvedContext = context
  if (context === 'manual' && pipelineStage) {
    resolvedContext = CLIENT_STAGES.includes(pipelineStage) ? 'client_message' : 'cold_outreach'
  }

  // Walk the fallback chain
  const chain = CONTEXT_TO_PURPOSE[resolvedContext] || ['general']
  for (const purpose of chain) {
    const match = config.numbers.find(n => n.purpose === purpose)
    if (match) return match.phone
  }

  // Last resort: first number
  return config.numbers[0]?.phone
}

/**
 * Find the org's number entry for an E.164 (or formatted) value. Compares after
 * toE164 on both sides so a number typed as "(828) 900-9821" in Settings still
 * matches the "+18289009821" Twilio sends. Returns undefined when the value is
 * not one of the org's numbers — callers must treat that as "not a line".
 */
export function findOrgNumber(
  config: Pick<OrgTwilioConfig, 'numbers'>,
  value: string | null | undefined
): OrgTwilioNumber | undefined {
  const want = toE164(String(value || ''))
  if (!want) return undefined
  return (config.numbers || []).find(n => toE164(n.phone) === want)
}

/** Twilio error: "From" is not a sender in the given Messaging Service. */
const TWILIO_NOT_IN_MESSAGING_SERVICE = 21712

/**
 * Send SMS using org-specific Twilio config with smart number routing.
 *
 * `opts.from` pins the sender to a specific line (Conversations line dropdown).
 * When absent the routing is exactly what it always was: Messaging Service if
 * configured, else pickNumber.
 */
export async function sendOrgSms(
  config: OrgTwilioConfig,
  to: string,
  body: string,
  context: SendContext = 'manual',
  pipelineStage?: string | null,
  opts: { from?: string } = {}
) {
  const client = createOrgTwilioClient(config)
  const fromNumber = pickNumber(config, context, pipelineStage)

  const params: any = { to, body }

  if (opts.from) {
    // Explicit line. Twilio accepts From + MessagingServiceSid together only
    // when From is in the service's sender pool (otherwise error 21712). Sending
    // through the service keeps the A2P 10DLC campaign association; a From-only
    // send from a number that is NOT registered risks 30034 (unregistered)
    // filtering instead. So: try the pooled form first, and fall back to
    // From-only on 21712 below, where the risk is visible in the message row's
    // error_code rather than a hard failure at send time.
    params.from = opts.from
    if (config.messaging_service_sid) params.messagingServiceSid = config.messaging_service_sid
  } else if (config.messaging_service_sid) {
    params.messagingServiceSid = config.messaging_service_sid
  } else if (fromNumber) {
    params.from = fromNumber
  }

  // The VERCEL_URL fallback is kept deliberately — a callback to the deployment
  // URL is better than none — but it is LOGGED, because it is the exact path that
  // produces a signature mismatch: /api/twilio/message-status validates against a
  // URL rebuilt from NEXT_PUBLIC_APP_URL, so if Twilio was told the VERCEL_URL
  // instead, every callback is rejected with a 403 and delivery status silently
  // stops updating. If this line ever appears in the logs, that is the warning.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  if (appUrl) {
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      console.error(
        '[sendOrgSms] NEXT_PUBLIC_APP_URL is UNSET; falling back to VERCEL_URL for',
        'the status callback:', appUrl,
        '\n  Status callbacks will be REJECTED (403) by /api/twilio/message-status,',
        'because it validates the Twilio signature against NEXT_PUBLIC_APP_URL.',
        'Delivery status and from_e164 will stop being recorded until this is set.',
      )
    }
    params.statusCallback = `${appUrl}/api/twilio/message-status`
  } else {
    console.error(
      '[sendOrgSms] No NEXT_PUBLIC_APP_URL and no VERCEL_URL. Sending WITHOUT a',
      'status callback: no delivery outcome and no from_e164 will be recorded.',
    )
  }

  try {
    return await client.messages.create(params)
  } catch (e: any) {
    const notPooled = opts.from && params.messagingServiceSid
      && Number(e?.code) === TWILIO_NOT_IN_MESSAGING_SERVICE
    if (!notPooled) throw e
    console.warn(
      '[sendOrgSms] From', opts.from, 'is not in Messaging Service',
      config.messaging_service_sid, '(21712); retrying From-only. Add the number to',
      'the service sender pool so the send is registered 10DLC traffic (else 30034).',
    )
    const { messagingServiceSid: _omit, ...direct } = params
    return await client.messages.create(direct)
  }
}

/**
 * Generate voice token using org-specific config
 */
export function generateOrgVoiceToken(config: OrgTwilioConfig, identity: string) {
  if (!config.api_key || !config.api_secret || !config.twiml_app_sid) {
    throw new Error('Voice not configured: missing API Key, Secret, or TwiML App SID')
  }

  const AccessToken = twilio.jwt.AccessToken
  const VoiceGrant = AccessToken.VoiceGrant

  const token = new AccessToken(
    config.account_sid,
    config.api_key,
    config.api_secret,
    { identity }
  )

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: config.twiml_app_sid,
    incomingAllow: true,
  })

  token.addGrant(voiceGrant)
  return token.toJwt()
}

/**
 * Caller ID for outbound VOICE calls.
 *
 * Voice deliberately does NOT use pickNumber's pipeline-stage routing. That
 * logic is right for SMS — an outreach campaign should send from the campaign
 * number — but wrong for a phone call: someone you ring should see your main
 * line regardless of where they sit in the pipeline.
 *
 * The bug it fixes: pickNumber maps any 'manual' send whose pipeline stage is
 * not in CLIENT_STAGES to 'cold_outreach', whose chain is ['outreach','general']
 * — so calling back a contact staged e.g. "Paid/ payment plan" dialled out from
 * the campaign number instead of the main line. Contacts with a NULL stage
 * skipped that branch and got the right number, so it looked correct for
 * unknown callers and wrong for real ones.
 *
 * Resolution order:
 *   1. voice_caller_id, if set AND still one of the org's numbers (a number
 *      removed from the org must not keep being dialled from).
 *   2. purpose 'inbound_main'  — the reception line if one is designated.
 *   3. purpose 'client_relations'
 *   4. first configured number, then the env fallback.
 *
 * `context`/`pipelineStage` are accepted for signature compatibility and are
 * intentionally unused.
 */
export function getVoiceCallerId(
  config: OrgTwilioConfig,
  _context: SendContext = 'manual',
  _pipelineStage?: string | null
): string {
  const explicit = (config.voice_caller_id || '').trim()
  if (explicit && config.numbers?.some(n => n.phone === explicit)) return explicit

  const byPurpose = (p: NumberPurpose) => config.numbers?.find(n => n.purpose === p)?.phone
  return byPurpose('inbound_main')
    || byPurpose('client_relations')
    || config.numbers?.[0]?.phone
    || process.env.TWILIO_PHONE_NUMBER
    || ''
}

export { CLIENT_STAGES }

/**
 * Fetch a Twilio recording's BYTES using the owning org's credentials.
 *
 * One implementation, two callers: the authenticated playback proxy
 * (api/comms/recording/[id]) streams the body straight to the browser, and a
 * future transcription step hands the same bytes to a speech vendor. The
 * comment at the top of api/twilio/recording-ready records why that matters:
 * the earlier Deepgram integration passed the auth protected Twilio URL and got
 * a 401 on every call, which is what produced transcription_status 'failed'.
 * Never hand a vendor a URL it cannot authenticate; hand it what this returns.
 *
 * Returns a discriminated result rather than throwing, so a caller can map the
 * reason onto its own status code.
 */
export async function fetchTwilioRecording(
  orgId: string,
  recordingUrl: string
): Promise<
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string; contentLength: string | null }
  | { ok: false; reason: 'not_configured' | 'fetch_failed' }
> {
  const admin = createAdminSupabase()
  const config = await getOrgTwilioConfig(admin, orgId)
  if (!config.account_sid || !config.auth_token) return { ok: false, reason: 'not_configured' }

  const authHeader =
    'Basic ' + Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64')

  let res: Response
  try {
    res = await fetch(recordingUrl, { headers: { Authorization: authHeader } })
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  }
  if (!res.ok || !res.body) return { ok: false, reason: 'fetch_failed' }

  return {
    ok: true,
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    contentLength: res.headers.get('content-length'),
  }
}

/**
 * Build the media URL for a RecordingSid when only the SID was stored.
 * Twilio serves recording media at the account scoped Recordings path; the
 * .mp3 suffix picks the transcoded audio the browser can play.
 */
export function twilioRecordingUrlFromSid(accountSid: string, recordingSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`
}
