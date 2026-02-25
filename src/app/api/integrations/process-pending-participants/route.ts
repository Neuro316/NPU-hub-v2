// src/app/api/integrations/process-pending-participants/route.ts
// ═══════════════════════════════════════════════════════════════
// Process Pending Participant Queue
//
// The database trigger (handle_contact_tag_change) can't create
// auth.users records, so it queues them in pending_participant_creation.
// This route processes that queue using the admin Supabase client.
//
// Called by: cron job (every 5 min) or manually from admin panel
// Auth: service role key or authenticated super_admin
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // Auth: either internal cron key or super_admin session
    const cronKey = req.headers.get('x-cron-key')
    const isCron = cronKey === process.env.CRON_SECRET

    if (!isCron) {
      // Check if caller is super_admin via auth header
      const authHeader = req.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
      if (authErr || !user) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      }

      // Verify super_admin role
      const { data: member } = await supabase
        .from('org_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'super_admin')
        .limit(1)
        .single()

      if (!member) {
        return NextResponse.json({ error: 'Requires super_admin role' }, { status: 403 })
      }
    }

    // ─── Fetch unprocessed queue ───
    const { data: pending, error: fetchErr } = await supabase
      .from('pending_participant_creation')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true })
      .limit(50)

    if (fetchErr) throw fetchErr

    if (!pending?.length) {
      return NextResponse.json({ message: 'No pending participants', processed: 0 })
    }

    let processed = 0
    let errors = 0
    const results: any[] = []

    for (const item of pending) {
      try {
        // Check if profile already exists (might have been created since queueing)
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', item.email)
          .limit(1)
          .single()

        let profileId: string

        if (existingProfile) {
          profileId = existingProfile.id

          // Ensure participant role (don't downgrade admins/facilitators)
          await supabase
            .from('profiles')
            .update({ role: 'participant' })
            .eq('id', profileId)
            .not('role', 'in', '("superadmin","admin","facilitator")')

        } else {
          // Create new auth user
          const { data: authUser, error: createErr } = await supabase.auth.admin.createUser({
            email: item.email,
            email_confirm: true,
            user_metadata: {
              full_name: item.full_name || '',
            },
          })

          if (createErr) {
            throw new Error(`Failed to create auth user: ${createErr.message}`)
          }

          profileId = authUser.user.id

          // Upsert profile
          await supabase.from('profiles').upsert({
            id: profileId,
            email: item.email,
            full_name: item.full_name || '',
            role: 'participant',
          })
        }

        // Mark as processed
        await supabase
          .from('pending_participant_creation')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            profile_id: profileId,
          })
          .eq('id', item.id)

        // Audit log
        await supabase.from('integration_audit_log').insert({
          source: 'university',
          action: 'participant_created',
          contact_id: item.contact_id,
          org_id: item.org_id,
          payload: {
            email: item.email,
            profile_id: profileId,
            enrollment_type: item.enrollment_type,
            source_tag: item.source_tag,
            was_existing: !!existingProfile,
          },
          result: 'success',
        })

        results.push({ email: item.email, status: 'processed', profile_id: profileId })
        processed++

      } catch (err: any) {
        // Mark error but don't block other items
        await supabase
          .from('pending_participant_creation')
          .update({
            error_message: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        await supabase.from('integration_audit_log').insert({
          source: 'university',
          action: 'participant_created',
          contact_id: item.contact_id,
          org_id: item.org_id,
          payload: { email: item.email },
          result: 'error',
          error_message: err.message,
        })

        results.push({ email: item.email, status: 'error', message: err.message })
        errors++
      }
    }

    return NextResponse.json({
      message: `Processed ${processed} participants, ${errors} errors`,
      processed,
      errors,
      results,
    })

  } catch (err: any) {
    console.error('Process pending participants error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
