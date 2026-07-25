# HANDOFF — Hub Bulk Campaigns build session

> Companion to `HUB_Bulk_Campaigns_Design.md` (the full spec). This is the marching-orders summary for
> the next code session. Written to resume cold.

**Repo in scope: `NPU-hub-v2` ONLY (`Neuro316/NPU-hub-v2`). Out of scope: `npu-platform-v2`,
`neuroreport-app` — do not edit them.** All three share the DB `htfrfaxlcuyawtlztxxm`, so a migration
here is visible there, but code changes stay in this repo. Manual mode: migrations are proposed and
applied one at a time with review, never auto.

---

## Start here
Read `docs/HUB_Bulk_Campaigns_Design.md`. This handoff is the summary; that doc is the spec.

## The one thing that reframes the project
`contacts.email_consent` is `NOT NULL DEFAULT false`. The 232 false values are the import default,
**not opt-outs** — proven by: the `contact_consents` audit table is empty, every bulk-import cohort is
uniformly false (xregulation 0/24, media_appearance 0/17, Import 0/11, scraped socials 0/1), and the
reachable audience is only ~12 email / ~9 SMS. **Do not flip them to true** — that manufactures consent
and would destroy Resend domain reputation for the ~12 legitimate recipients. The real unblock is
consent capture (G1), arguably its own project. Everything else can be built safely first.

## Do NOT rebuild — reuse these (verified live 2026-07-25)
- `email_campaigns` table — email campaign shell already exists (audience filters, status, scheduling,
  counters). Extend with a `channel` discriminator; do not recreate.
- `stage_email_sends` + `src/app/api/crm/stage-emails/route.ts` — the migration-077 claim-before-send
  guard. This IS the send primitive; `campaign_recipients` mirrors it (claim, stale-release, durable skip).
- `src/app/api/sequences/process-step/route.ts` — cron worker template for the campaign processor.
- `src/lib/twilio-org.ts` — `SendContext='campaign'` already routes to the outreach number; reuse
  `getOrgTwilioConfig` + `src/lib/twilio.ts sendSms`.
- `email_sends` — the ledger scoring reads at `src/lib/crm-server.ts:419`.

## Build order (safe -> gated)
1. **G3 malformed-email sweep + G2 `contact_consents` ledger** (booleans become a cache kept in sync by
   trigger). Small, needs no audience.
2. **Resend adapter (`src/lib/resend.ts`) + ledger wiring + open/click/bounce webhooks.** Fixes the live
   0%-engagement bug; migrate stage-emails and sequences onto it for one email path. NOTE: email
   currently goes through a Google Apps Script / Gmail webhook, not Resend — this is a real adapter swap.
3. **`assertSendable(channel, contact, orgId)` single chokepoint + DB backstop trigger** on
   `campaign_recipients`. Route all three send surfaces (campaign, sequence, stage-email) through it.
4. **`campaigns` + `campaign_recipients` + `/api/campaigns/process` cron**, reusing the 077 patterns.
5. **AI composer + voice linter.** The linter MUST have a test that proves it rejects a bad draft
   (em dash, pathologizing phrase, reading level above grade 9). A guard never watched to fire is not a guard.
6. **G1 consent capture** (opt-in page, double opt-in, consent-at-source). The actual reach unlock;
   separate project. Everything above is inert-for-reach until it lands but valuable regardless.

## DB guardrails specific to this project
- `org_members` and 12 other tables use `organization_id`; `contacts` uses `org_id`. Check per table
  before writing either — a misnamed key reads back `undefined` and the feature silently renders nothing.
- New tables born locked (migration 030): add explicit `grant` next to RLS. New functions born
  PUBLIC-executable (031): `revoke execute ... from public` is not optional.
- Grant / constraint / policy checks: `pg_catalog`, never `information_schema`.
- Migration numbering collides across repos (Hub 084 != platform 084). Take max of BOTH ledgers. There
  is also an uncommitted `supabase/migrations/084_v_platform_signups.sql` in the Hub tree to reconcile
  before writing the next migration number.

## Consent is the non-negotiable
Per channel (email consent != SMS consent), enforced structurally in TWO layers: the app chokepoint
(`assertSendable`) AND a DB trigger that rejects a `-> sending` transition without cached consent for
that channel. Every email carries a working unsubscribe that writes an opt-out; Twilio STOP and hard
bounces write opt-outs too. Consent lives in `contact_consents(channel)`; the booleans on `contacts`
are a cache of latest ledger state, never the source of truth.

## Voice rules (any AI-drafted copy)
Complete flowing sentences; no em dashes; capacity over pathology, no negation-of-brokenness; mechanism
before modality; 9th-grade reading level; HRV as mirror not score (never "sympathovagal balance");
questions orient forward and time-anchored. Enforced by system prompt AND post-generation linter.

## Provenance
Design + this handoff produced in a read-only investigation session on 2026-07-25. Committed on branch
`docs/hub-bulk-campaigns-design`. No code or migration was applied.
