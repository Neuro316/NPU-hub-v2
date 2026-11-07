// src/app/api/integrations/neuroreport/sync/route.ts
// ═══════════════════════════════════════════════════════════════
// NeuroReport → NPU Hub CRM Sync Endpoint
// 
// Called by NeuroReport when xRegulation participants are created
// or assessed. Matches by email (primary) or name (fallback),
// creates new contacts if no match, sets Data API Connected flag.
//
// Auth: x-api-key header (stored in org_settings)
// Scope: Only xRegulation program participants
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadPipelines, loadPositions, findPipeline, placeContact, positionsByContact } from '@/lib/pipelines/positions'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Neuro Progeny org ID
const NP_ORG_ID = '00000000-0000-0000-0000-000000000001'
// The Enrolled pipeline (legacy key) and the stage a new NeuroReport contact is placed at, in that pipeline only.
const NP_PIPELINE_KEY = 'pipeline-1771530511407'
// "Signed up" is the Enrolled pipeline's first stage, named by its key because its name is long and editable
// (Cameron, 2026-11-07). The translation trigger maps a legacy 'Signed up' write to the same stage.
const NEW_CONTACT_STAGE_KEY = 'stage-1772022700334'

interface SyncParticipant {
  first_name: string
  last_name: string
  email?: string
  phone?: string
  neuroreport_patient_id: string
  program: string
  assessment_date?: string
  assessment_type?: 'pre' | 'post' | 'follow_up'
}

interface SyncResult {
  email?: string
  name: string
  status: 'created' | 'linked' | 'already_linked' | 'error' | 'rejected'
  contact_id?: string
  message: string
}

export async function POST(req: NextRequest) {
  try {
    // ─── Auth: validate API key ───
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing x-api-key header' }, { status: 401 })
    }

    const { data: keySetting } = await supabase
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', NP_ORG_ID)
      .eq('setting_key', 'neuroreport_api_key')
      .single()

    if (!keySetting || keySetting.setting_value?.key !== apiKey) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
    }

    // Update last_used timestamp
    await supabase
      .from('org_settings')
      .update({
        setting_value: {
          ...keySetting.setting_value,
          last_used: new Date().toISOString(),
        },
      })
      .eq('org_id', NP_ORG_ID)
      .eq('setting_key', 'neuroreport_api_key')

    // ─── Parse request ───
    const body = await req.json()
    const participants: SyncParticipant[] = body.participants || []

    if (!participants.length) {
      return NextResponse.json({ error: 'No participants provided' }, { status: 400 })
    }

    const results: SyncResult[] = []
    let created = 0, linked = 0, already_linked = 0, errors = 0, rejected = 0

    for (const p of participants) {
      const name = `${p.first_name} ${p.last_name}`.trim()

      try {
        // ─── Scope check: only xRegulation ───
        if (p.program?.toLowerCase() !== 'xregulation') {
          results.push({
            email: p.email,
            name,
            status: 'rejected',
            message: `Program "${p.program}" is not in scope. Only xRegulation participants are synced.`,
          })
          rejected++

          // Audit log
          await supabase.from('integration_audit_log').insert({
            source: 'neuroreport',
            action: 'sync',
            org_id: NP_ORG_ID,
            payload: { participant: p, reason: 'program_not_in_scope' },
            result: 'skipped',
          })

          continue
        }

        // ─── Try to match existing contact ───
        let matchedContact: any = null

        // Match 1: by email (case-insensitive)
        if (p.email) {
          const { data: emailMatch } = await supabase
            .from('contacts')
            .select('*')
            .eq('org_id', NP_ORG_ID)
            .ilike('email', p.email)
            .limit(1)
            .single()

          if (emailMatch) matchedContact = emailMatch
        }

        // Match 2: by first + last name (case-insensitive) if no email match
        if (!matchedContact) {
          const { data: nameMatches } = await supabase
            .from('contacts')
            .select('*')
            .eq('org_id', NP_ORG_ID)
            .ilike('first_name', p.first_name)
            .ilike('last_name', p.last_name)
            .limit(5)

          if (nameMatches?.length === 1) {
            // Exact single match — safe to link
            matchedContact = nameMatches[0]
          } else if (nameMatches && nameMatches.length > 1) {
            // Multiple name matches — log ambiguity, don't auto-link
            results.push({
              email: p.email,
              name,
              status: 'error',
              message: `Multiple contacts found with name "${name}". Manual linking required.`,
            })
            errors++

            await supabase.from('integration_audit_log').insert({
              source: 'neuroreport',
              action: 'sync',
              org_id: NP_ORG_ID,
              payload: { participant: p, matches: nameMatches.length, reason: 'ambiguous_name_match' },
              result: 'error',
              error_message: `${nameMatches.length} contacts match name "${name}"`,
            })

            continue
          }
        }

        if (matchedContact) {
          // ─── Contact exists — check if already linked ───
          if (matchedContact.neuroreport_linked && matchedContact.neuroreport_patient_id === p.neuroreport_patient_id) {
            results.push({
              email: p.email,
              name,
              status: 'already_linked',
              contact_id: matchedContact.id,
              message: 'Contact already linked to this NeuroReport patient',
            })
            already_linked++

            await supabase.from('integration_audit_log').insert({
              source: 'neuroreport',
              action: 'sync',
              contact_id: matchedContact.id,
              org_id: NP_ORG_ID,
              payload: { participant: p },
              result: 'success',
            })

            continue
          }

          // ─── Link existing contact ───
          const { error: updateErr } = await supabase
            .from('contacts')
            .update({
              neuroreport_linked: true,
              neuroreport_linked_at: new Date().toISOString(),
              neuroreport_patient_id: p.neuroreport_patient_id,
              neuroreport_program: p.program,
              // Backfill email/phone if contact was missing them
              ...(p.email && !matchedContact.email ? { email: p.email } : {}),
              ...(p.phone && !matchedContact.phone ? { phone: p.phone } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', matchedContact.id)

          if (updateErr) throw updateErr

          results.push({
            email: p.email,
            name,
            status: 'linked',
            contact_id: matchedContact.id,
            message: 'Existing contact found and linked',
          })
          linked++

          await supabase.from('integration_audit_log').insert({
            source: 'neuroreport',
            action: 'link_established',
            contact_id: matchedContact.id,
            org_id: NP_ORG_ID,
            payload: { participant: p, match_method: matchedContact.email?.toLowerCase() === p.email?.toLowerCase() ? 'email' : 'name' },
            result: 'success',
          })

        } else {
          // ─── No match — create new contact in Enrolled pipeline ───
          const { data: newContact, error: insertErr } = await supabase
            .from('contacts')
            .insert({
              org_id: NP_ORG_ID,
              first_name: p.first_name,
              last_name: p.last_name,
              email: p.email || null,
              phone: p.phone || null,
              tags: [],
              auto_tags: [],
              neuroreport_linked: true,
              neuroreport_linked_at: new Date().toISOString(),
              neuroreport_patient_id: p.neuroreport_patient_id,
              neuroreport_program: p.program,
              source: 'neuroreport',
              notes: `Auto-created from NeuroReport sync (${p.program}, ${p.assessment_type || 'assessment'} on ${p.assessment_date || 'unknown date'})`,
            })
            .select()
            .single()

          if (insertErr) throw insertErr

          try {
            const stage = findPipeline(await loadPipelines(supabase, NP_ORG_ID), NP_PIPELINE_KEY)?.stages.find(s => s.key === NEW_CONTACT_STAGE_KEY)
            const placed = stage
              ? await placeContact(supabase, newContact.id, stage.id, true, 'neuroreport_sync')
              : { placed: false, reason: 'stage_unknown' }
            if (!placed.placed) console.error(`[neuroreport-sync] contact=${newContact.id} not placed: ${placed.reason ?? 'unknown'}`)
          } catch (e: any) {
            console.error(`[neuroreport-sync] contact=${newContact.id} placement failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
          }

          results.push({
            email: p.email,
            name,
            status: 'created',
            contact_id: newContact.id,
            message: 'New contact created in Enrolled pipeline',
          })
          created++

          await supabase.from('integration_audit_log').insert({
            source: 'neuroreport',
            action: 'sync',
            contact_id: newContact.id,
            org_id: NP_ORG_ID,
            payload: { participant: p },
            result: 'success',
          })
        }

      } catch (err: any) {
        results.push({
          email: p.email,
          name,
          status: 'error',
          message: err.message || 'Unknown error',
        })
        errors++

        await supabase.from('integration_audit_log').insert({
          source: 'neuroreport',
          action: 'sync',
          org_id: NP_ORG_ID,
          payload: { participant: p },
          result: 'error',
          error_message: err.message,
        })
      }
    }

    return NextResponse.json({
      results,
      summary: {
        total: participants.length,
        created,
        linked,
        already_linked,
        rejected,
        errors,
      },
    })

  } catch (err: any) {
    console.error('NeuroReport sync error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// ─── GET: Status check — NeuroReport can verify which participants are linked ───
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing x-api-key header' }, { status: 401 })
  }

  const { data: keySetting } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', NP_ORG_ID)
    .eq('setting_key', 'neuroreport_api_key')
    .single()

  if (!keySetting || keySetting.setting_value?.key !== apiKey) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
  }

  // Return all NeuroReport-linked contacts
  const { data: linkedContacts, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, neuroreport_patient_id, neuroreport_program, neuroreport_linked_at, tags, enrollment_type')
    .eq('org_id', NP_ORG_ID)
    .eq('neuroreport_linked', true)
    .order('neuroreport_linked_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // pipeline_stage is the contact's stage in the Enrolled pipeline, from contact_pipeline_positions (null when not in it);
  // pipelines lists every pipeline the contact is in.
  let byContact = new Map<string, Awaited<ReturnType<typeof loadPositions>>>()
  try {
    byContact = positionsByContact(await loadPositions(supabase, NP_ORG_ID, { contactIds: (linkedContacts || []).map(c => c.id) }))
  } catch {
    return NextResponse.json({ error: 'Pipeline positions could not be loaded.' }, { status: 500 })
  }
  const withStages = (linkedContacts || []).map(c => {
    const mine = byContact.get(c.id) ?? []
    return {
      ...c,
      pipeline_stage: mine.find(x => x.pipeline_key === NP_PIPELINE_KEY)?.stage_name ?? null,
      pipelines: mine.map(x => ({ pipeline_key: x.pipeline_key, pipeline_name: x.pipeline_name, stage: x.stage_name })),
    }
  })

  return NextResponse.json({
    linked_contacts: withStages,
    count: withStages.length,
  })
}
