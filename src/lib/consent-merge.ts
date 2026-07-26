// ─── Consent reconciliation for contact merges ───────────────────────────────
//
// WHY THIS IS NOT IN THE MERGE ROUTE'S winner_updates PATH
//
// /api/contacts/merge deliberately delegates field-level "merge toward the fuller
// record" to the review UI: the caller passes winner_updates, the route applies
// them. Consent is the ONE exception, because consent is a safety invariant
// rather than a presentation choice.
//
// Delegating it meant the UI simply never passed the consent fields, so the
// survivor silently kept its own values and the loser's recorded decision was
// abandoned. The failure was asymmetric: an unprovenanced `true` on the survivor
// always beat an evidenced `false` on the loser, so EVERY merge failed toward
// permission.
//
// Live consequence, one real person: Melissa Allen declined SMS at checkout on
// 2026-07-15 with a timestamp, and her surviving record read sms_consent = true
// until it was corrected by hand on 2026-07-25.
//
// The evidence was never destroyed — the loser row survives the soft merge, and
// contact_merge_log.merge_details carries a full loser_snapshot — but stranded
// evidence that nothing reads is indistinguishable from lost evidence at send time.
//
// THIS IS INTERIM. Once consent_events (design §4.2) lands, consent stops being a
// field on the row: the merge repoints ledger rows to the winner, the derived-flag
// trigger recomputes from the union of both histories, and most-restrictive-wins
// falls out for free with no reconciliation code at all. DELETE this module at
// that point rather than porting it.

/** Consent fields a merge caller may never set. Blocked in the route. */
export const CONSENT_FIELDS = [
  'email_consent', 'sms_consent',
  'email_consent_at', 'sms_consent_at',
  'terms_accepted', 'terms_accepted_at',
  'email_unsubscribed_at',
] as const;

export type ConsentRow = Record<string, unknown>;

export interface ConsentResolution {
  resolved: {
    email_consent: boolean;
    sms_consent: boolean;
    terms_accepted: boolean;
    email_consent_at: string | null;
    sms_consent_at: string | null;
    terms_accepted_at: string | null;
    email_unsubscribed_at: string | null;
  };
  audit: Record<string, unknown>;
}

/**
 * Most-restrictive-wins consent reconciliation across a merge pair.
 *
 * Booleans are AND-ed per channel, so a `false` on either side survives and an
 * unprovenanced true can no longer overwrite an evidenced revoke. Evidence
 * timestamps are coalesced (winner first) because restrictiveness governs the
 * VALUE while provenance is additive and must never be the casualty.
 *
 * `nowIso` is injectable so tests are deterministic.
 */
export function resolveConsent(
  winner: ConsentRow,
  loser: ConsentRow,
  nowIso: string = new Date().toISOString(),
): ConsentResolution {
  const bool = (v: unknown) => v === true;
  const pick = (a: unknown, b: unknown) => (a ?? b ?? null) as string | null;

  const resolved = {
    // AND, not OR. This single operator is the fix.
    email_consent: bool(winner.email_consent) && bool(loser.email_consent),
    sms_consent: bool(winner.sms_consent) && bool(loser.sms_consent),
    // terms_accepted is an attestation, not a permission: it records that someone
    // accepted terms at some point, so it is OR-ed and its evidence kept.
    terms_accepted: bool(winner.terms_accepted) || bool(loser.terms_accepted),
    email_consent_at: pick(winner.email_consent_at, loser.email_consent_at),
    sms_consent_at: pick(winner.sms_consent_at, loser.sms_consent_at),
    terms_accepted_at: pick(winner.terms_accepted_at, loser.terms_accepted_at),
    // An unsubscribe is a revoke. A merge never discards one.
    email_unsubscribed_at: pick(winner.email_unsubscribed_at, loser.email_unsubscribed_at),
  };

  const snap = (r: ConsentRow) =>
    Object.fromEntries(CONSENT_FIELDS.map(f => [f, r[f] ?? null]));

  return {
    resolved,
    audit: {
      rule: 'most_restrictive_wins',
      applied_at: nowIso,
      note: 'Per-channel booleans AND-ed; terms_accepted OR-ed; evidence timestamps coalesced, winner first.',
      inputs: { winner: snap(winner), loser: snap(loser) },
      resolved,
      changed_from_winner: CONSENT_FIELDS.filter(
        f => (winner[f] ?? null) !== ((resolved as ConsentRow)[f] ?? null),
      ),
    },
  };
}
