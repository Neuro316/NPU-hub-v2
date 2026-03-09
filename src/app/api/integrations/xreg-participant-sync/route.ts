// src/app/api/integrations/xreg-participant-sync/route.ts
// ═══════════════════════════════════════════════════════════════════════════
// xRegulation → Hub Participant Sync (CRON)
//
// Runs on a schedule (Vercel cron or external trigger).
// Reads np_hrv_participant_map, syncs each external participant into Hub CRM.
//
// For each xReg participant:
//   1. Skip internal team emails
//   2. Lookup contact by email
//      - EXISTS → update neuroreport_linked fields, backlink sessions
//      - NEW    → create contact + create profile (silent) + generate invite link
//   3. Upsert np_client_record (for enrolled/mastermind tracks)
//   4. Write np_onboarding_log entry
//
// Auth: Authorization: Bearer CRON_SECRET header
//
// Manual trigger: GET /api/integrations/xreg-participant-sync
//   with ?dry_run=true to preview without writing
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runOnboardingPipeline, NP_ORG_ID, NP_PIPELINE_ID, SITE_URL } from '@/lib/onboarding-pipeline'

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

        // Backlink any orphaned sessions if profile exists
        if (existing.mastermind_user_id) {
          await supabase
            .from('np_hrv_sessions')
            .update({ participant_id: existing.mastermind_user_id })
            .eq('xreg_user_email', email)
            .is('participant_id', null)
        }

        // Update np_hrv_participant_map with profile link if we have it
        if (existing.mastermind_user_id && !p.participant_id) {
          await supabase.from('np_hrv_participant_map')
            .update({ participant_id: existing.mastermind_user_id })
            .eq('xreg_user_email', email)
        }

        results.push({ email, status: 'updated', contact_id: existing.id })
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
        })

        // Update participant_map with new profile_id
        if (result.profileId) {
          await supabase.from('np_hrv_participant_map')
            .update({ participant_id: result.profileId })
            .eq('xreg_user_email', email)
        }

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
