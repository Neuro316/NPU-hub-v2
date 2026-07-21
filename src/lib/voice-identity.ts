// src/lib/voice-identity.ts
// THE single source of truth for the browser-receiver's Twilio client identity.
//
// WHY THIS FILE EXISTS:
//   The original inbound TwiML dialed <Client>crm-browser-client</Client> — an
//   identity no browser ever registered as. It rang nobody for 30s on every
//   inbound call. The bug was not the string; it was that TWO places each spelled
//   the string themselves and nothing forced them to agree.
//
//   So: the receiver-token route and the inbound TwiML both import receiverIdentity()
//   and NEITHER spells an identity literal. A mismatch is now impossible without
//   editing this file, where the coupling is documented.
//
// Design (Option A, shared org identity — chosen 2026-07-21):
//   One identity per ORG, not per user. Twilio forks an incoming call to EVERY
//   Device registered under the same identity and the first to accept wins, so a
//   shared identity gives multi-staff ringing with no presence tracking and no
//   config list. The target is derivable from the receiving number alone (number
//   -> org -> identity), which is what makes it work for a new org the moment its
//   number is added.
//
//   Deliberately distinct from the `user-{userId}` namespace that OUTBOUND browser
//   calling already uses (voice/token/route.ts), so the two can never collide.
//
//   "Who answered" is recovered separately — the accepting browser reports itself
//   against the call row — precisely because this identity is not per-user.

/** Twilio client identity for an org's inbound browser receiver. */
export function receiverIdentity(orgId: string): string {
  return `org-${orgId}`;
}

/** Inverse of receiverIdentity — returns null for anything else (e.g. `user-…`). */
export function orgIdFromReceiverIdentity(identity: string): string | null {
  const m = /^org-([0-9a-fA-F-]{36})$/.exec((identity || '').trim());
  return m ? m[1] : null;
}
