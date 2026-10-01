// src/lib/marketing/providers/types.ts
// The provider seam. The engine talks to these interfaces only; Resend and Twilio
// sit behind them, so a provider change is a new file here and nothing else.

export interface EmailMessage {
  orgId: string
  sendId: string            // message_sends.id, used as the provider idempotency key
  from: string
  replyTo?: string
  to: string
  subject: string
  html: string
  text: string
  /** Required for marketing; the provider refuses a marketing email without it. */
  unsubscribeUrl?: string
  kind: 'marketing' | 'service'
}

export interface SmsMessage {
  orgId: string
  sendId: string
  to: string                // E.164
  body: string
}

export type ProviderResult =
  | { ok: true; provider: string; externalId: string }
  | { ok: false; provider: string; permanent: boolean; code: string }

export interface EmailProvider {
  name: string
  send(msg: EmailMessage): Promise<ProviderResult>
}

export interface SmsProvider {
  name: string
  send(msg: SmsMessage): Promise<ProviderResult>
}
