// src/lib/marketing/providers/types.ts
// The provider seam. The engine talks to these interfaces only; Resend and Twilio
// sit behind them, so a provider change is a new file here and nothing else.

export interface EmailMessage {
  orgId: string
  sendId: string            // message_sends.id
  /** Same on every retry of one step for one person, so the provider sends it at most once. */
  idempotencyKey: string
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
  | { ok: false; provider: string; permanent: boolean; code: string
      /** The request may have reached the provider (network error, 5xx): the message may have gone out. */
      ambiguous: boolean }

export interface EmailProvider {
  name: string
  send(msg: EmailMessage): Promise<ProviderResult>
}

export interface SmsProvider {
  name: string
  send(msg: SmsMessage): Promise<ProviderResult>
}
