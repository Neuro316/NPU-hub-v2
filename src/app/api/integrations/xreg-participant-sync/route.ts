// src/app/api/integrations/xreg-participant-sync/route.ts
// ═══════════════════════════════════════════════════════════════════════════
// xRegulation → Hub Participant Sync (CRON)
//
// ⚠⚠ DISABLED BY RULING, NOT FIXED. Addendum C §KF, Cameron, 2026-09-26.
//
// The first query below selects `enrollment_track`, which is not a column on
// np_hrv_participant_map (it belongs to np_client_records), so every run since
// the route was written has returned 500 at that line and nothing downstream
// has ever executed. THE ONE-WORD FIX IS THE WRONG FIX: the moment that select
// succeeds, this cron begins creating CRM contacts and rewriting participant_id
// on the map from 65 rows of unconfirmed `auto_backfill` data, every 30 minutes.
// §JM rules that auto_backfill "is not a trust level, it is the absence of one".
//
// So the route now REFUSES explicitly (DISABLED_BY_RULING_KF below), and its
// */30 schedule was removed from vercel.json in the same change. A cron that
// 500s is indistinguishable from a cron somebody turned off; a refusal that
// names its ruling is a decision. Do NOT correct the column name.
//
// Re-enable condition, as ruled: trust ruled (§JM, done) AND the map confirmed
// by hand (not done). Both, not either. And before flipping the constant, decide
// what the two np_hrv_participant_map.participant_id writers below should do --
// they would repoint an `inferred` or `confirmed` row by an email match.
//
// Original design (kept for the day it is re-enabled):
// Reads np_hrv_participant_map, syncs each external participant into Hub CRM.
//
// For each xReg participant:
//   1. Skip internal team emails
//   2. Lookup contact by email
//      - EXISTS → update neuroreport_linked fields
//      - NEW    → create contact + create profile (silent) + generate invite link
//   3. Upsert np_client_record (for enrolled/mastermind tracks)
//   4. Write np_onboarding_log entry
//   (the email-keyed np_hrv_sessions backlink is disabled by §KJ; see below)
//
// Auth: Authorization: Bearer CRON_SECRET header
//
// Manual trigger: GET /api/integrations/xreg-participant-sync
//   with ?dry_run=true to preview without writing
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runOnboardingPipeline, NP_ORG_ID, NP_PIPELINE_ID, SITE_URL } from '@/lib/onboarding-pipeline'

// ⚠ Flip to false ONLY when both re-enable conditions in the header hold, and
// restore the vercel.json schedule in the same commit. Kept as a constant rather
// than dead code so the disable is greppable and the flip is one visible line.
const DISABLED_BY_RULING_KF = true

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const INTERNAL_EMAILS = new Set([
  'cameron@neuroprogeny.com',
  'shane@neuroprogeny.com',
  'laura@neuroprogeny.com',
  'paul@neuroprogeny.com',
  'admin@sensoriumneuro.com',
  'admin@neuroprogeny.com',
])

export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── §KF refusal. Auth above is kept so an unauthenticated caller still gets
  // 401 and cannot use this route to learn anything. ─────────────────────
  if (DISABLED_BY_RULING_KF) {
    return NextResponse.json({
      disabled: true,
      reason:   'disabled_by_ruling_KF',
      detail:   'Addendum C §KF, Cameron, 2026-09-26: this sync is disabled by ruling, not fixed. '
              + 'Its first query names a phantom column and has never succeeded; correcting it would '
              + 'start rewriting the CRM from 65 unconfirmed auto_backfill map rows every 30 minutes.',
      re_enable_condition: 'trust ruled (§JM, done) AND np_hrv_participant_map confirmed by hand '
              + '(not done). Both. Then flip DISABLED_BY_RULING_KF and restore the vercel.json schedule.',
    }, { status: 503 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true'
  const supabase = adminSupabase()

  // ── Fetch all xReg participants ───────────────────────────────────────
  const { data: xregParticipants, error: fetchErr } = await supabase
    .from('np_hrv_participant_map')
    .select('id, xreg_user_id, xreg_user_email, xreg_user_name, participant_id, enrollment_track')
    .not('xreg_user_email', 'is', null)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!xregParticipants?.length) {
    return NextResponse.json({ message: 'No xReg participants found', synced: 0 })
  }

  // ── Filter out internal team ──────────────────────────────────────────
  const external = xregParticipants.filter(
    p => p.xreg_user_email && !INTERNAL_EMAILS.has(p.xreg_user_email.toLowerCase())
  )

  // ── Get existing contacts to separate new vs. update ─────────────────
  const emails = external.map(p => p.xreg_user_email!.toLowerCase())

  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, email, mastermind_user_id, tags, pipeline_stage, source')
    .in('email', emails)
    .eq('org_id', NP_ORG_ID)

  const contactsByEmail = new Map(
    (existingContacts || []).map(c => [c.email?.toLowerCase(), c])
  )

  // ── Process each participant ──────────────────────────────────────────
  const results: any[] = []
  let created  = 0
  let updated  = 0
  let skipped  = 0
  let errored  = 0
  const inviteLinks: Array<{ email: string; link: string }> = []

  for (const p of external) {
    const email = p.xreg_user_email!.toLowerCase()
    const existing = contactsByEmail.get(email)

    if (dryRun) {
      results.push({
        email,
        name:   p.xreg_user_name,
        action: existing ? 'would_update' : 'would_create',
      })
      continue
    }

    if (existing) {
      // ── UPDATE: contact exists — sync xReg fields ──────────────────
      try {
        await supabase.from('contacts').update({
          neuroreport_linked:    true,
          neuroreport_linked_at: new Date().toISOString(),
          neuroreport_program:   'xRegulation',
          source:                existing.source ?? 'xregulation',
          xreg_user_id:          p.xreg_user_id || null,
        }).eq('id', existing.id).eq('org_id', NP_ORG_ID)

        // ⚠ DISABLED BY RULING, NOT DELETED. Addendum C §KJ, Cameron, 2026-09-26. This wrote
        // `np_hrv_sessions.participant_id` keyed on `xreg_user_email = email`, claiming a person's
        // physiology from an email match. §JM's Shane finding measured that key wrong for the first
        // person checked. Sessions now join through `np_hrv_participant_map` on `xreg_user_id`.
        // One of FIVE identical writers (§KJ): this, the pipeline's STEP 7 in both repos, and both
        // `/api/invite` sites in the platform. Re-enabling any one re-opens the email key for everybody.

        // ⚠ DISABLED, SAME RULING, DIFFERENT TABLE. This set `np_hrv_participant_map.participant_id`
        // from an email match. It is a MAP writer, not a session writer, and §KJ names it separately:
        // an `.update()` leaves `trust` alone, so it would repoint an existing `inferred` or
        // `confirmed` row by the disqualified key. Whoever re-enables §KF's cron decides what this
        // becomes; it is not restored by flipping DISABLED_BY_RULING_KF alone.

        results.push({
          email, status: 'updated', contact_id: existing.id,
          // ⚠ Named so a reader does not take the absence of a link count as "there were none".
          sessions_backlink: 'disabled_by_ruling_KJ',
          map_link:          'disabled_by_ruling_KJ',
        })
        updated++
      } catch (e: any) {
        results.push({ email, status: 'error', error: e.message })
        errored++
      }
    } else {
      // ── CREATE: new participant — run full onboarding pipeline ─────
      // Determine track: default to 'subscribed' for xReg-only users
      // (they haven't paid for a cohort yet — just have xReg access)
      const track = (p.enrollment_track as any) || 'subscribed'

      try {
        const nameParts = (p.xreg_user_name || '').trim().split(/\s+/)
        const firstName = nameParts[0] || ''
        const lastName  = nameParts.slice(1).join(' ') || ''

        const result = await runOnboardingPipeline(
          {
            email,
            firstName,
            lastName,
            track,
            source:          'xreg_cron',
            xregUserId:      p.xreg_user_id || undefined,
            createAccount:   true,
            sendInviteEmail: false,  // silent create — cron shouldn't spam emails
            extraTags:       ['xRegulation'],
            skipEcrStub:     track === 'subscribed',
          },
          supabase
        )

        if (result.inviteLink) {
          inviteLinks.push({ email, link: result.inviteLink })
        }

        results.push({
          email,
          name:          p.xreg_user_name,
          status:        result.success ? 'created' : 'partial',
          contact_id:    result.contactId,
          profile_id:    result.profileId,
          invite_link:   result.inviteLink ? '[generated]' : null,
          errors:        result.errors,
          requires_manual: result.requiresManualIntervention,
          manual_reason:   result.manualInterventionReason,
          // ⚠ ALWAYS this value since §KJ -- see the note on the update branch above.
          map_link:        'disabled_by_ruling_KJ',
        })

        // ⚠ DISABLED BY RULING, NOT DELETED. Addendum C §KJ, Cameron, 2026-09-26. This set
        // `np_hrv_participant_map.participant_id` for the newly created profile, keyed on
        // `xreg_user_email = email`. Same map-writer note as the update branch: it would bind a
        // vendor account to a person by the disqualified key and leave `trust` untouched.

        if (result.success) created++
        else { errored++; }
      } catch (e: any) {
        results.push({ email, status: 'error', error: e.message })
        errored++
      }
    }
  }

  const summary = {
    dry_run:  dryRun,
    total:    external.length,
    created,
    updated,
    skipped,
    errored,
    invite_links_generated: inviteLinks.length,
    results,
    // Invite links returned separately so admin can batch-send if needed
    invite_links: inviteLinks,
  }

  console.log(`[xreg-sync] Complete: ${created} created, ${updated} updated, ${errored} errors`)

  return NextResponse.json(summary)
}
