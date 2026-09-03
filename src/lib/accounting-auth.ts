import type { createAdminSupabase } from '@/lib/supabase'

// ─── Authorisation boundary for accounting writes ───────────────────────────
//
// These routes use the SERVICE ROLE, so RLS is not consulted at all. The check
// in this file IS the boundary. Nothing here may be derived from the request
// body except `location_id`, which is an opaque id resolved server-side; both
// org ids are read from the database.
//
// ── WHY THIS READS team_profiles AND NOT profiles.role ──────────────────────
// DELIBERATE EXCEPTION, ruled 2026-09-03. This is NOT the start of
// HUB_ROLE_DECOUPLING.md Phase 1, and must not be read later as though it were.
//
// `contacts_org_rls` gates on `get_my_role()`, which reads `profiles.role` — a
// PLATFORM-WIDE column that knows nothing about per-org Hub authority. The
// operator who hit this bug (`ella@sensoriumneuro.com`) holds
// `team_profiles.role = 'super_admin'` in Sensorium, granted by Phase 0 on
// 2026-08-02. That grant exists and is correct. Her `profiles.role` is
// 'participant' and always has been.
//
// So: there is no version of this route that fixes the bug and reads
// `profiles.role`. The nine routes in §3 of the decoupling doc still read it and
// are untouched here — this is a NEW route, not a conversion, so nothing is
// migrated and nobody loses access to an existing path.
//
// The long-term fix remains Phase 3: rewrite `contacts_org_rls` and its siblings
// onto `team_profiles`. That needs platform coordination (`contacts` is read by
// the platform; `crm_messages_org_via_conversation` is platform-owned) and must
// not be started as a side effect of an accounting bug. When it lands, this
// route's check and the policy agree instead of disagreeing.
//
// ── WHY ANY ROLE, NOT admin ─────────────────────────────────────────────────
// Creating a client is ordinary module work, not a grant-making act. §12.4 of
// the decoupling doc deliberately held the same operator at `team_member` in NP
// because `admin` is the level that can mint Hub authority there, and records
// that `team_member` "still carries full module access unless `permissions`
// narrows it". Requiring `admin` in the target org would refuse her and
// reproduce the exact failure this route exists to fix.

type Admin = ReturnType<typeof createAdminSupabase>

// Server-side only, so it cannot be forged by a caller. The durable version of
// this is a nullable `crm_org_id` column on `acct_clinics` — filed, not built
// here, because a schema change should not ride along with a fix. It is needed
// because the target CANNOT be derived from the clinic row today: all three
// clinics carry Sensorium as `acct_clinics.org_id`, including the Neuro Progeny
// one, so that column names the OWNING org and never the CRM target.
export const NP_ORG_ID = '00000000-0000-0000-0000-000000000001'

export const NP_PIPELINE_ID = 'pipeline-1771530511407'

// Both of these must match a stage `name` in org_settings.crm_pipelines for
// org 0000…01, pipeline-1771530511407, EXACTLY — trailing spaces included.
// Verified against the live config 2026-09-03 (8 stages).
export const NP_STAGE_SIGNED_UP =
  'Signed up - add user email used to sign up in Circle; dependency has to be joined circle '
// Was 'Paid', which is NOT a stage in that pipeline — the pipeline's stage 2 is
// 'Paid/ payment plan'. Every successful move-to-Paid wrote an off-pipeline
// value that renders in no column. Exactly one contact reached it.
export const NP_STAGE_PAID = 'Paid/ payment plan'

export type AcctAuthOk = {
  ok: true
  actingOrgId: string
  /** Org the CRM contact lands in, or null when this clinic does not enrol. */
  targetOrgId: string | null
  clinicId: string | null
}
export type AcctAuthErr = { ok: false; status: number; error: string }
export type AcctAuth = AcctAuthOk | AcctAuthErr

async function orgName(admin: Admin, orgId: string): Promise<string> {
  const { data } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
  return data?.name || orgId
}

/** An active Hub grant in `orgId`, at any role. */
async function hasHubGrant(admin: Admin, userId: string, orgId: string): Promise<boolean> {
  const { data } = await admin
    .from('team_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  return !!data
}

/**
 * Resolves the acting and target orgs from `locationId` alone and checks the
 * caller holds a Hub grant in BOTH. Fails closed at every step.
 *
 * The 403s name which side is missing and which org, because the UI in front of
 * this route fails OPEN — `supabase-middleware.ts` only redirects on
 * status='pending', and `use-permissions.tsx:76,82` returns true when there is
 * no team_profiles row. So a user with no grant still sees the button. An
 * opaque refusal there is indistinguishable from the RLS error this replaces.
 * The messages name only the caller's own missing grant; nothing about anyone
 * else's authority is disclosed.
 */
export async function authorizeAccountingWrite(
  admin: Admin,
  userId: string,
  locationId: string
): Promise<AcctAuth> {
  if (!locationId) return { ok: false, status: 400, error: 'location_id is required' }

  // 2. Resolve the location server-side. `location_id` is opaque — it names no org.
  const { data: location } = await admin
    .from('acct_locations')
    .select('id, org_id, clinic_id')
    .eq('id', locationId)
    .maybeSingle()
  if (!location) return { ok: false, status: 404, error: 'Location not found' }

  const actingOrgId: string = location.org_id
  if (!actingOrgId) return { ok: false, status: 409, error: 'Location has no organization' }

  type Clinic = { id: string; org_id: string; is_neuro_progeny: boolean | null }
  let clinic: Clinic | null = null
  if (location.clinic_id) {
    const { data } = await admin
      .from('acct_clinics')
      .select('id, org_id, is_neuro_progeny')
      .eq('id', location.clinic_id)
      .maybeSingle()
    clinic = (data as Clinic | null) ?? null
    if (!clinic) return { ok: false, status: 404, error: 'Clinic not found' }

    // 3. Consistency — refuse rather than pick one.
    if (clinic.org_id !== actingOrgId) {
      return {
        ok: false,
        status: 409,
        error: 'This location and its clinic belong to different organizations. Refusing to guess which one owns the record.',
      }
    }
  }

  // 4. Acting-org authority.
  if (!(await hasHubGrant(admin, userId, actingOrgId))) {
    return {
      ok: false,
      status: 403,
      error: `You do not have an active team profile in ${await orgName(admin, actingOrgId)}, which owns this location. Ask a Hub admin for that organization to add one.`,
    }
  }

  // 5. Derive the target org server-side. Never from the body.
  const targetOrgId = clinic?.is_neuro_progeny === true ? NP_ORG_ID : null

  // 6. Target-org authority. Checked BEFORE any write, so a refusal never
  //    leaves a half-created client behind.
  if (targetOrgId && !(await hasHubGrant(admin, userId, targetOrgId))) {
    return {
      ok: false,
      status: 403,
      error: `This clinic enrols its clients into ${await orgName(admin, targetOrgId)}, and you do not have an active team profile there. Ask a Hub admin for that organization to add one.`,
    }
  }

  return { ok: true, actingOrgId, targetOrgId, clinicId: clinic?.id ?? null }
}

/** Splits a free-text client name the way the accounting form collects it. */
export function splitName(name: string): { first: string; last: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] || name || 'Unknown', last: parts.slice(1).join(' ') || '' }
}

export type EnrolFields = {
  name: string
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
}

/**
 * Creates the CRM contact for an accounting client and links it back, checking
 * BOTH writes. Returns the contact id, or a message describing what failed.
 *
 * The link-back is the write that used to be `page.tsx:1651` — fired with no
 * `.select()` and no error check. It is verified by row count here: a zero-row
 * UPDATE returns no error, so counting rows is the only way to know it landed.
 */
export async function enrolContact(
  admin: Admin,
  clientId: string,
  targetOrgId: string,
  f: EnrolFields
): Promise<{ contactId: string } | { error: string }> {
  const { first, last } = splitName(f.name)
  const { data: contact, error: insErr } = await admin
    .from('contacts')
    .insert({
      org_id: targetOrgId,
      first_name: first,
      last_name: last,
      email: f.email || null,
      phone: f.phone || null,
      date_of_birth: f.date_of_birth || null,
      address_street: f.address_street || null,
      address_city: f.address_city || null,
      address_state: f.address_state || null,
      address_zip: f.address_zip || null,
      pipeline_id: NP_PIPELINE_ID,
      pipeline_stage: NP_STAGE_SIGNED_UP,
      tags: [],
      sms_consent: false,
      do_not_contact: false,
    })
    .select('id')
    .single()

  if (insErr || !contact?.id) {
    return { error: `CRM contact could not be created: ${insErr?.message || 'no id returned'}` }
  }

  const { data: linked, error: linkErr } = await admin
    .from('acct_clients')
    .update({ enrolled_contact_id: contact.id })
    .eq('id', clientId)
    .select('id')

  if (linkErr) {
    return { error: `Contact ${contact.id} was created but could not be linked to the client: ${linkErr.message}` }
  }
  if (!linked || linked.length === 0) {
    return { error: `Contact ${contact.id} was created but the link to the client matched 0 rows. The client is enrolled in the CRM but the accounting record does not point at it.` }
  }

  return { contactId: contact.id }
}
