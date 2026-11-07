// src/app/api/crm/pipeline-deals/remove/route.ts
// "Remove from pipeline" on a board card. Removes the contact's position in THAT one
// pipeline (contact_pipeline_positions, hub_229) and deletes its deal row there
// (hub_214). The contact's places in other pipelines, and the contact itself, are kept.
//
// POST { contact_id, pipeline_key }   pipeline_key is the pipeline's legacy key (its uuid is accepted too)
//
// Removal is not a loss: the deal row is deleted rather than marked lost, so Win Rate
// and the other summary cards simply stop counting the card.
//
// contact_timeline: the hub_pipeline_remove RPC writes the history entry naming the
// pipeline, so this route writes none.
//
// contacts.pipeline_id / pipeline_stage are legacy and are neither read nor written.
//
// Service role, so withStaff is the boundary. The org comes from the CONTACT.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { findPipeline, loadPipelines, removeFromPipeline } from '@/lib/pipelines/positions'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id
  const rawKey = body?.pipeline_key
  if (typeof contactId !== 'string' || typeof rawKey !== 'string' || !rawKey) {
    return bad('contact_id and pipeline_key are required')
  }

  const { data: contact, error: cErr } = await ctx.db.from('contacts')
    .select('id, org_id').eq('id', contactId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId

  let pipeline
  try {
    pipeline = findPipeline(await loadPipelines(ctx.db, orgId), rawKey)
  } catch (e) {
    console.error(`[pipeline-deals/remove] pipelines org=${orgId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'Pipelines could not be read. Try again.' }, { status: 500 })
  }
  if (!pipeline) return bad('That pipeline does not exist in this organization.')

  let removed: boolean
  try {
    removed = await removeFromPipeline(ctx.db, contactId, pipeline.id, ctx.userId, 'board')
  } catch (e) {
    console.error(`[pipeline-deals/remove] contact=${contactId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'The contact could not be removed from that pipeline. Try again.' }, { status: 500 })
  }
  if (!removed) {
    return NextResponse.json({ error: 'This contact is no longer in that pipeline. Reload the board.' }, { status: 409 })
  }

  const { error: dErr } = await ctx.db.from('hub_pipeline_deals')
    .delete().eq('contact_id', contactId).eq('pipeline_key', pipeline.key)
  if (dErr) {
    console.error(`[pipeline-deals/remove] deal contact=${contactId} failed: ${dErr.code ?? 'unknown'}`)
    return NextResponse.json({ error: `Removed from ${pipeline.name}, but its lead value could not be cleared. Try again.` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
})
