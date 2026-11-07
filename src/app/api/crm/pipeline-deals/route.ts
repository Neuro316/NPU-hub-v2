// src/app/api/crm/pipeline-deals/route.ts
// Lead value and close timing for cards on the CRM pipeline board (hub_214).
// A deal is one contact's placement in one pipeline: (contact_id, pipeline_key),
// where pipeline_key is the stable pipeline id from org_settings.crm_pipelines.
//
// GET  ?org_id=&pipeline_key=   every deal row for that pipeline
// POST { contact_id, pipeline_key, value?, touch?, entered_pipeline? }
//   value             number >= 0, or null to clear. Omit to leave it as is.
//   touch             the card just changed stage: stamp stage_changed_at and set
//                     won_at / lost_at from the flags of the contact's stage IN THIS
//                     pipeline (contact_pipeline_positions, hub_229)
//   entered_pipeline  the card just came into this pipeline: entered_at = now
//
// Writes are service role only (the table grants authenticated SELECT and nothing
// else), so withStaff is the boundary. The org comes from the CONTACT, never the
// body, and won/lost comes from the contact's position in this pipeline and that
// stage's flags, never the client. contacts.pipeline_id / pipeline_stage are legacy
// and are not read.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { findPipeline, loadPipelines, type PipelineRef } from '@/lib/pipelines/positions'

const MAX_VALUE = 9_999_999_999.99
const COLS = 'contact_id, pipeline_key, value, entered_at, stage_changed_at, won_at, lost_at'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const sp = req.nextUrl.searchParams
  const orgId = requireOrg(ctx, sp.get('org_id'))
  if (orgId instanceof Response) return orgId
  const pipelineKey = sp.get('pipeline_key')
  if (!pipelineKey) return bad('pipeline_key is required')

  const { data, error } = await ctx.db.from('hub_pipeline_deals').select(COLS)
    .eq('org_id', orgId).eq('pipeline_key', pipelineKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deals: data ?? [] })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id
  const rawKey = body?.pipeline_key
  if (typeof contactId !== 'string' || typeof rawKey !== 'string' || !rawKey) {
    return bad('contact_id and pipeline_key are required')
  }

  const hasValue = body && Object.prototype.hasOwnProperty.call(body, 'value')
  let value: number | null | undefined
  if (hasValue) {
    if (body.value === null || body.value === '') value = null
    else {
      const n = Number(body.value)
      if (!Number.isFinite(n) || n < 0 || n > MAX_VALUE) return bad('Enter an amount between $0 and $9,999,999,999.')
      value = Math.round(n * 100) / 100
    }
  }
  const touch = body?.touch === true
  const enteredPipeline = body?.entered_pipeline === true

  const { data: contact, error: cErr } = await ctx.db.from('contacts')
    .select('id, org_id, created_at').eq('id', contactId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId

  let pipelines: PipelineRef[]
  try { pipelines = await loadPipelines(ctx.db, orgId) } catch (e) {
    console.error(`[pipeline-deals] pipelines org=${orgId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'Pipelines could not be read. Try again.' }, { status: 500 })
  }
  const pipeline = findPipeline(pipelines, rawKey)
  if (!pipeline) return bad('That pipeline does not exist in this organization.')
  // Deals stay keyed by the pipeline's legacy key, even if the caller sent the uuid.
  const pipelineKey = pipeline.key

  const { data: existing } = await ctx.db.from('hub_pipeline_deals').select(COLS)
    .eq('contact_id', contactId).eq('pipeline_key', pipelineKey).maybeSingle()

  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    org_id: orgId, contact_id: contactId, pipeline_key: pipelineKey,
    updated_at: now, updated_by: ctx.userId,
  }
  if (hasValue) row.value = value
  if (enteredPipeline) row.entered_at = now
  else if (!existing) row.entered_at = contact.created_at || now

  if (touch || !existing) {
    // The contact's stage in THIS pipeline. Their places in other pipelines don't count.
    const { data: pos, error: pErr } = await ctx.db.from('contact_pipeline_positions').select('stage_id')
      .eq('contact_id', contactId).eq('pipeline_id', pipeline.id).maybeSingle()
    if (pErr) {
      console.error(`[pipeline-deals] position contact=${contactId} failed: ${pErr.code ?? 'unknown'}`)
      return NextResponse.json({ error: 'The stage could not be read. Try again.' }, { status: 500 })
    }
    const stage = pos ? pipeline.stages.find(s => s.id === (pos as any).stage_id) ?? null : null
    const won = !!stage?.is_closed_won
    const lost = !won && !!stage?.is_closed_lost
    if (touch) row.stage_changed_at = now
    else row.stage_changed_at = row.entered_at
    row.won_at = won ? (existing?.won_at ?? now) : null
    row.lost_at = lost ? (existing?.lost_at ?? now) : null
  }

  const { data, error } = await ctx.db.from('hub_pipeline_deals')
    .upsert(row, { onConflict: 'contact_id,pipeline_key' }).select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deal: data })
})
