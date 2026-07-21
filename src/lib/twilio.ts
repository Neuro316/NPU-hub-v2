import twilio from 'twilio';
import { validateRequest } from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

// ─── Send SMS ───
export async function sendSms(to: string, body: string) {
  const message = await client.messages.create({
    to,
    body,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID!,
    statusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/message-status`,
  });
  return message;
}

// ─── Generate Voice Access Token (for browser calling) ───
export function generateVoiceToken(identity: string) {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY!,
    process.env.TWILIO_API_SECRET!,
    { identity }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!,
    incomingAllow: true,
  });

  token.addGrant(voiceGrant);
  return token.toJwt();
}

// ─── Validate Twilio webhook signature (against a specific auth token) ───
// Inbound webhooks must be validated with the auth token of the Twilio
// (sub)account that actually signed them. For per-org credentials, resolve
// that token via resolveInboundTwilioAuth() in twilio-org.ts, then pass it here.
export function validateTwilioSignatureWithToken(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!authToken || !signature) return false;
  return validateRequest(authToken, signature, url, params);
}

// ─── Validate against the global env token (backward-compatible shim) ───
// Prefer validateTwilioSignatureWithToken with a per-org token for tenant-aware
// routes. This global-token form remains for single-account callers.
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  return validateTwilioSignatureWithToken(
    process.env.TWILIO_AUTH_TOKEN || '',
    url,
    params,
    signature
  );
}

// ─── Generate TwiML for inbound calls ───
export function generateInboundCallTwiml(clientIdentity: string) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  // Record disclosure
  response.say(
    { voice: 'Polly.Joanna' },
    'This call may be recorded for quality purposes.'
  );

  // Try to connect to browser client
  const dial = response.dial({
    timeout: 30,
    action: `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/call-status`,
  });
  dial.client(clientIdentity);

  // If no answer, take voicemail
  response.say(
    { voice: 'Polly.Joanna' },
    'The person you are trying to reach is unavailable. Please leave a message after the beep.'
  );
  response.record({
    maxLength: 120,
    transcribe: false,
    recordingStatusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/recording-ready`,
  });

  return response.toString();
}

// ─── Generate TwiML for outbound calls ───
export function generateOutboundCallTwiml(to: string) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say(
    { voice: 'Polly.Joanna' },
    'This call may be recorded for quality purposes.'
  );

  const dial = response.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER!,
    record: 'record-from-answer-dual',
    recordingStatusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/recording-ready`,
  });
  dial.number(to);

  return response.toString();
}

export { client as twilioClient };
