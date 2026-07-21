import { SupabaseClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { createAdminSupabase } from '@/lib/supabase'

export type NumberPurpose = 'outreach' | 'client_relations' | 'appointments' | 'inbound_main' | 'general'

export interface OrgTwilioConfig {
  account_sid: string
  auth_token: string
  messaging_service_sid: string
  api_key: string
  api_secret: string
  twiml_app_sid: string
  numbers: { phone: string; nickname: string; purpose: NumberPurpose }[]
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
 * Send SMS using org-specific Twilio config with smart number routing
 */
export async function sendOrgSms(
  config: OrgTwilioConfig,
  to: string,
  body: string,
  context: SendContext = 'manual',
  pipelineStage?: string | null
) {
  const client = createOrgTwilioClient(config)
  const fromNumber = pickNumber(config, context, pipelineStage)

  const params: any = { to, body }

  if (config.messaging_service_sid) {
    params.messagingServiceSid = config.messaging_service_sid
  } else if (fromNumber) {
    params.from = fromNumber
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  if (appUrl) {
    params.statusCallback = `${appUrl}/api/twilio/message-status`
  }

  return client.messages.create(params)
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
