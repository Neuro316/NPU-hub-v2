// src/lib/onboarding-pipeline.ts
// ═══════════════════════════════════════════════════════════════════════════
// Neuro Progeny — Unified Onboarding Pipeline
//
// Single source of truth for all client onboarding across:
//   - Paywall (Stripe webhook)
//   - Manual add-client (admin)
//   - xReg sync (cron)
//
// Sequence (in order):
//   1.  Normalize email
//   2.  Lookup or create contact in CRM
//   3.  Lookup or create profile (auth account)
//   4.  Link contact.mastermind_user_id → profile
//   5.  Create enrollment record (if track requires it)
//   6.  Assign cohort_members (if cohort provided)
//   7.  Auto-join cohort channels
//   8.  Upsert np_hrv_participant_map (pre-links xReg)
//   9.  Backlink existing np_hrv_sessions by email → participant_id
//   10. Create np_client_record stub (Enrolled + Mastermind only)
//   11. Write np_onboarding_log (full audit)
//
// Email is the single linking key between all systems.
// If email differs between xReg and Hub, a manual intervention flag is set.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── Constants ─────────────────────────────────────────────────────────────

export const NP_ORG_ID   = process.env.NP_ORG_ID   || 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629'
export const NP_PIPELINE_ID = process.env.NP_PIPELINE_ID || 'pipeline-1771530511407'
export const SITE_URL    = process.env.NEXT_PUBLIC_SITE_URL || 'https://university.neuroprogeny.com'

// Emails that belong to internal team — never create CRM contacts for these
const INTERNAL_EMAILS = new Set([
  'cameron@neuroprogeny.com',
  'shane@neuroprogeny.com',
  'laura@neuroprogeny.com',
  'paul@neuroprogeny.com',
  'admin@sensoriumneuro.com',
  'admin@neuroprogeny.com',
])

// Pipeline stage mapping per track — used as fallback only if pipeline lookup fails
const STAGE_MAP: Record<string, string> = {
  subscribed:    'Subscribed',
  enrolled:      'Enrolled',
  mastermind:    'Awareness',
  discovery:     'Discovery',
  application:   'Application',
  payment_plan:  'Payment plan',
  new_lead:      'New Lead',
}

// Look up stage 1 of the active pipeline from org_settings
async function resolveFirstStage(db: any, pipelineId: string, fallback: string): Promise<string> {
  try {
    const { data } = await db
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', NP_ORG_ID)
      .eq('setting_key', 'crm_pipelines')
      .single()
    if (!data?.setting_value?.pipelines) return fallback
    const pipelines: any[] = data.setting_value.pipelines
    const pipeline = pipelineId
      ? pipelines.find((p: any) => p.id === pipelineId)
      : pipelines.find((p: any) => p.is_default) || pipelines[0]
    if (!pipeline?.stages?.length) return fallback
    // Return stage at position 0
    const sorted = [...pipeline.stages].sort((a: any, b: any) => a.position - b.position)
    return sorted[0].name || fallback
  } catch {
    return fallback
  }
}

// Tags applied per track
const TRACK_TAGS: Record<string, string[]> = {
  subscribed: ['Subscribed'],
  enrolled:   ['Enrolled'],
  mastermind: ['Mastermind', 'Enrolled'],
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type EnrollmentTrack = 'subscribed' | 'enrolled' | 'mastermind'

export interface OnboardingParams {
  // Identity
  email: string
  firstName?: string
  lastName?: string
  fullName?: string         // used if first/last not available

  // Track
  track: EnrollmentTrack
  source: 'stripe' | 'admin' | 'xreg_cron' | 'neuroreport'

  // University enrollment
  enrollmentId?: string     // UUID from enrollments table (if already created)
  cohortId?: string
  cohortName?: string

  // xReg
  xregUserId?: string
  xregEmail?: string        // may differ from primary email — flagged if so

  // Optional extras
  phone?: string
  occupation?: string
  addressCity?: string
  addressState?: string
  dateOfBirth?: string
  notes?: string

  // Flags
  createAccount?: boolean   // whether to send invite email
  sendInviteEmail?: boolean // if createAccount=true, send email or just create silently
  skipEcrStub?: boolean     // override to not create np_client_record stub
  callerUserId?: string     // admin who triggered this (for audit)
  extraTags?: string[]
}

export interface OnboardingResult {
  success: boolean
  contactId:  string | null
  profileId:  string | null
  recordId:   string | null
  inviteLink: string | null
  steps:      StepResult[]
  errors:     string[]
  requiresManualIntervention: boolean
  manualInterventionReason?:  string
}

interface StepResult {
  step:    string
  action:  string
  id?:     string
  count?:  number
  note?:   string
  error?:  string
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function runOnboardingPipeline(
  params: OnboardingParams,
  supabase?: SupabaseClient
): Promise<OnboardingResult> {

  const db = supabase ?? createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const steps:  StepResult[] = []
  const errors: string[]     = []
  let contactId:  string | null = null
  let profileId:  string | null = null
  let recordId:   string | null = null
  let inviteLink: string | null = null
  let requiresManualIntervention = false
  let manualInterventionReason: string | undefined

  // ── Normalize email ────────────────────────────────────────────────────
  const email = params.email.trim().toLowerCase()

  if (!email) {
    return { success: false, contactId: null, profileId: null, recordId: null,
      inviteLink: null, steps, errors: ['Email is required'], requiresManualIntervention: false }
  }

  if (INTERNAL_EMAILS.has(email)) {
    return { success: false, contactId: null, profileId: null, recordId: null,
      inviteLink: null, steps, errors: ['Internal email — skipped'], requiresManualIntervention: false }
  }

  // Derive name parts
  let firstName = (params.firstName || '').trim()
  let lastName  = (params.lastName  || '').trim()
  if (!firstName && !lastName && params.fullName) {
    const parts = params.fullName.trim().split(/\s+/)
    firstName = parts[0] || ''
    lastName  = parts.slice(1).join(' ') || ''
  }
  if (!firstName) firstName = email.split('@')[0] || 'Contact'
  const fullName = [firstName, lastName].filter(Boolean).join(' ')

  const track        = params.track
  const pipelineStage = await resolveFirstStage(db, params.pipelineId || NP_PIPELINE_ID, STAGE_MAP[track] || 'New Lead')
  const trackTags    = TRACK_TAGS[track] || []
  const allTags      = Array.from(new Set([...trackTags, ...(params.extraTags || [])]))

  // ── STEP 1: Contact ────────────────────────────────────────────────────
  try {
    const { data: existing } = await db
      .from('contacts')
      .select('id, tags, auto_tags, pipeline_stage, mastermind_user_id, xreg_user_id')
      .eq('org_id', NP_ORG_ID)
      .ilike('email', email)
      .maybeSingle()

    if (existing) {
      contactId = existing.id
      const mergedTags     = Array.from(new Set([...(existing.tags || []),     ...allTags]))
      const mergedAutoTags = Array.from(new Set([...(existing.auto_tags || []), ...allTags]))
      const updates: Record<string, any> = {
        tags:           mergedTags,
        auto_tags:      mergedAutoTags,
        pipeline:       track,
        pipeline_stage: pipelineStage,
        updated_at:     new Date().toISOString(),
      }
      if (firstName)         updates.first_name  = firstName
      if (lastName)          updates.last_name   = lastName
      if (params.phone)      updates.phone       = params.phone
      if (params.occupation) updates.occupation  = params.occupation
      if (params.addressCity)  updates.address_city  = params.addressCity
      if (params.addressState) updates.address_state = params.addressState
      if (params.xregUserId)   updates.xreg_user_id  = params.xregUserId

      await db.from('contacts').update(updates).eq('id', existing.id)
      steps.push({ step: 'contact', action: 'updated', id: existing.id })
    } else {
      const insert: Record<string, any> = {
        org_id:         NP_ORG_ID,
        first_name:     firstName,
        last_name:      lastName,
        email,
        pipeline_id:    NP_PIPELINE_ID,
        pipeline:       track,
        pipeline_stage: pipelineStage,
        tags:           allTags,
        auto_tags:      allTags,
        source:         params.source,
        enrollment_type: track,
      }
      if (params.phone)        insert.phone        = params.phone
      if (params.occupation)   insert.occupation   = params.occupation
      if (params.addressCity)  insert.address_city = params.addressCity
      if (params.addressState) insert.address_state = params.addressState
      if (params.notes)        insert.notes        = params.notes
      if (params.dateOfBirth)  insert.date_of_birth = params.dateOfBirth
      if (params.xregUserId)   insert.xreg_user_id = params.xregUserId

      const { data: newContact, error: insertErr } = await db
        .from('contacts')
        .insert(insert)
        .select('id')
        .single()

      if (insertErr) {
        errors.push(`Contact create failed: ${insertErr.message}`)
        steps.push({ step: 'contact', action: 'create_failed', error: insertErr.message })
      } else {
        contactId = newContact.id
        steps.push({ step: 'contact', action: 'created', id: newContact.id })
      }
    }
  } catch (e: any) {
    errors.push(`Contact step error: ${e.message}`)
    steps.push({ step: 'contact', action: 'error', error: e.message })
  }

  // ── STEP 2: Profile (auth account) ────────────────────────────────────
  if (params.createAccount !== false) {
    try {
      // Use profiles table lookup first (no listUsers() call)
      const { data: existingProfile } = await db
        .from('profiles')
        .select('id, email')
        .ilike('email', email)
        .maybeSingle()

      if (existingProfile) {
        profileId = existingProfile.id
        steps.push({ step: 'profile', action: 'exists', id: profileId! })
      } else {
        // Create auth user
        if (params.sendInviteEmail !== false) {
          // Send invite email
          const { data: authData, error: authErr } = await db.auth.admin.inviteUserByEmail(
            email,
            {
              data: { full_name: fullName, role: 'participant' },
              redirectTo: `${SITE_URL}/dashboard`,
            }
          )

          if (authErr) {
            // Already invited — find by checking profiles again or scanning auth
            if (authErr.message?.includes('already') || authErr.message?.includes('registered')) {
              // Try getUserByEmail (not listUsers)
              const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 })
              const found = (users || []).find((u: any) => u.email?.toLowerCase() === email)
              if (found) {
                profileId = found.id
                steps.push({ step: 'profile', action: 'auth_exists_recovered', id: profileId! })
              }
            } else {
              errors.push(`Invite failed: ${authErr.message}`)
              steps.push({ step: 'profile', action: 'invite_failed', error: authErr.message })
            }
          } else if (authData?.user) {
            profileId = authData.user.id
            steps.push({ step: 'profile', action: 'created_invited', id: profileId! })
          }
        } else {
          // Create silently (no email, returns magic link)
          const { data: authData, error: authErr } = await db.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { full_name: fullName, role: 'participant' },
          })
          if (authErr) {
            errors.push(`Silent create failed: ${authErr.message}`)
            steps.push({ step: 'profile', action: 'create_failed', error: authErr.message })
          } else if (authData?.user) {
            profileId = authData.user.id
            steps.push({ step: 'profile', action: 'created_silent', id: profileId! })
          }
        }

        // Upsert profiles record
        if (profileId) {
          const profilePayload: Record<string, any> = {
            id:        profileId,
            email,
            full_name: fullName,
            role:      'participant',
          }
          if (params.occupation)   profilePayload.occupation      = params.occupation
          if (params.addressCity)  profilePayload.location_city   = params.addressCity
          if (params.addressState) profilePayload.location_state  = params.addressState
          if (params.dateOfBirth)  profilePayload.date_of_birth   = params.dateOfBirth

          await db.from('profiles').upsert(profilePayload, { onConflict: 'id' })

          // Generate magic link for manual sharing
          const { data: linkData } = await db.auth.admin.generateLink({
            type: 'magiclink',
            email,
            options: { redirectTo: `${SITE_URL}/dashboard` },
          })
          inviteLink = linkData?.properties?.action_link || null
        }
      }
    } catch (e: any) {
      errors.push(`Profile step error: ${e.message}`)
      steps.push({ step: 'profile', action: 'error', error: e.message })
    }
  }

  // ── STEP 3: Link contact → profile ────────────────────────────────────
  if (contactId && profileId) {
    try {
      await db.from('contacts')
        .update({ mastermind_user_id: profileId })
        .eq('id', contactId)
      steps.push({ step: 'link', action: 'contact_linked_to_profile' })
    } catch (e: any) {
      steps.push({ step: 'link', action: 'link_warning', error: (e as any).message })
    }
  }

  // ── STEP 4: Cohort assignment ──────────────────────────────────────────
  if (params.cohortId && profileId) {
    try {
      const { data: existingMember } = await db
        .from('cohort_members')
        .select('id')
        .eq('cohort_id', params.cohortId)
        .eq('user_id', profileId)
        .maybeSingle()

      if (!existingMember) {
        const { error: memberErr } = await db.from('cohort_members').insert({
          cohort_id:  params.cohortId,
          user_id:    profileId,
          role:       'participant',
          joined_at:  new Date().toISOString(),
        })
        if (memberErr) {
          steps.push({ step: 'cohort_member', action: 'assign_failed', error: memberErr.message })
        } else {
          steps.push({ step: 'cohort_member', action: 'assigned', id: params.cohortId })
        }
      } else {
        steps.push({ step: 'cohort_member', action: 'already_member' })
      }
    } catch (e: any) {
      steps.push({ step: 'cohort_member', action: 'error', error: (e as any).message })
    }
  }

  // ── STEP 5: Auto-join cohort channels ─────────────────────────────────
  if (params.cohortId && profileId) {
    try {
      const { data: channels } = await db
        .from('channels')
        .select('id')
        .eq('cohort_id', params.cohortId)

      if (channels && channels.length > 0) {
        for (const ch of channels) {
          await db.from('channel_members').upsert(
            { channel_id: ch.id, user_id: profileId },
            { onConflict: 'channel_id,user_id' }
          )
        }
        steps.push({ step: 'channels', action: 'joined', count: channels.length })
      }
    } catch (e: any) {
      steps.push({ step: 'channels', action: 'error', error: (e as any).message })
    }
  }

  // ── STEP 6: np_hrv_participant_map — pre-link xReg ─────────────────────
  // This ensures xReg knows about this participant before they open the app.
  // When they log into xReg with the same email, sessions auto-link.
  try {
    const xregEmail = (params.xregEmail || email).toLowerCase()
    const { error: mapErr } = await db
      .from('np_hrv_participant_map')
      .upsert({
        xreg_user_email: xregEmail,
        xreg_user_name:  fullName,
        participant_id:  profileId || null,
        org_id:          NP_ORG_ID,
        enrollment_track: track,
        synced_at:       new Date().toISOString(),
      }, { onConflict: 'xreg_user_email' })

    if (mapErr) {
      steps.push({ step: 'xreg_map', action: 'upsert_failed', error: mapErr.message })
    } else {
      steps.push({ step: 'xreg_map', action: 'upserted' })
    }

    // Flag if xReg email differs from primary email
    if (params.xregEmail && params.xregEmail.toLowerCase() !== email) {
      requiresManualIntervention = true
      manualInterventionReason = `xReg email (${params.xregEmail}) differs from enrollment email (${email}). Sessions may not auto-link.`
      steps.push({ step: 'xreg_map', action: 'email_mismatch_flagged', note: manualInterventionReason })
    }
  } catch (e: any) {
    // np_hrv_participant_map may not have org_id column — gracefully skip
    steps.push({ step: 'xreg_map', action: 'skipped', note: (e as any).message })
  }

  // ── STEP 7: Backlink existing xReg sessions → profile ─────────────────
  if (profileId) {
    try {
      const { data: linked } = await db
        .from('np_hrv_sessions')
        .update({ participant_id: profileId })
        .eq('xreg_user_email', email)
        .is('participant_id', null)
        .select('id')

      if (linked && linked.length > 0) {
        steps.push({ step: 'xreg_sessions_backlink', action: 'linked', count: linked.length })
      } else {
        steps.push({ step: 'xreg_sessions_backlink', action: 'none_pending' })
      }
    } catch (e: any) {
      steps.push({ step: 'xreg_sessions_backlink', action: 'error', error: (e as any).message })
    }
  }

  // ── STEP 8: NP Client Record stub ─────────────────────────────────────
  // Only created for Enrolled and Mastermind tracks (not Subscribed)
  if (!params.skipEcrStub && (track === 'enrolled' || track === 'mastermind') && contactId) {
    try {
      const { data: existing } = await db
        .from('np_client_records')
        .select('id')
        .eq('org_id', NP_ORG_ID)
        .eq('contact_id', contactId)
        .maybeSingle()

      if (existing) {
        recordId = existing.id
        steps.push({ step: 'np_client_record', action: 'exists', id: existing.id })
      } else {
        const recordPayload: Record<string, any> = {
          org_id:           NP_ORG_ID,
          contact_id:       contactId,
          profile_id:       profileId || null,
          xreg_email:       email,
          xreg_user_id:     params.xregUserId || null,
          enrollment_track: track,
          enrollment_id:    params.enrollmentId || null,
          cohort_id:        params.cohortId || null,
          cohort_name:      params.cohortName || null,
          status:           'active',
          created_by:       params.callerUserId || null,
        }

        // Mastermind gets equipment tracking in assessments
        if (track === 'mastermind') {
          recordPayload.assessments = {
            nsci:            { status: 'pending', sent_at: null, completed_at: null },
            core_narratives: { status: 'pending', sent_at: null, completed_at: null },
            hrv_baseline:    { status: 'pending', sent_at: null, completed_at: null },
            intake_form:     { status: 'pending', sent_at: null, completed_at: null },
            consent_form:    { status: 'pending', sent_at: null, completed_at: null },
            qeeg:            { status: 'pending', sent_at: null, completed_at: null },
            fna:             { status: 'pending', sent_at: null, completed_at: null },
          }
        }

        const { data: newRecord, error: recordErr } = await db
          .from('np_client_records')
          .insert(recordPayload)
          .select('id')
          .single()

        if (recordErr) {
          steps.push({ step: 'np_client_record', action: 'create_failed', error: recordErr.message })
        } else {
          recordId = newRecord.id
          steps.push({ step: 'np_client_record', action: 'created', id: newRecord.id })
        }
      }
    } catch (e: any) {
      steps.push({ step: 'np_client_record', action: 'error', error: (e as any).message })
    }
  }

  // ── STEP 9: Audit log ─────────────────────────────────────────────────
  try {
    await db.from('np_onboarding_log').insert({
      org_id:        NP_ORG_ID,
      email,
      event_type:    params.source === 'stripe' ? 'paywall_purchase'
                   : params.source === 'admin'  ? 'manual_add'
                   : params.source === 'xreg_cron' ? 'xreg_sync'
                   : 'other',
      track,
      source:        params.source,
      contact_id:    contactId || null,
      profile_id:    profileId || null,
      record_id:     recordId  || null,
      enrollment_id: params.enrollmentId || null,
      steps:         steps,
      errors:        errors.length > 0 ? errors : [],
      success:       errors.length === 0,
    })
  } catch (_) {
    // Non-fatal — audit log failure doesn't break onboarding
  }

  return {
    success:    errors.length === 0,
    contactId,
    profileId,
    recordId,
    inviteLink,
    steps,
    errors,
    requiresManualIntervention,
    manualInterventionReason,
  }
}
