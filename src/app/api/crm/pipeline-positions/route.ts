// src/app/api/crm/pipeline-positions/route.ts
// A contact's place in each pipeline (contact_pipeline_positions, hub_229). The board, the contact card and the
// contact list write through here; a change in one pipeline never touches the contact's other pipelines.
//
// GET    ?org_id=&contact_id=     that contact's positions
// GET    ?org_id=&pipeline_id=    every position in one pipeline (a board)
// GET    ?org_id=                 every position in the org (lists and filters)
// POST   { contact_id, stage_id }  set the stage in that stage's pipeline, adding the contact to it if needed
// DELETE { contact_id, pipeline_id } remove the contact from that one pipeline
//
// Service role, so withStaff is the boundary. The org comes from the CONTACT, never the body, and the stage must be
// in the contact's org (the RPC refuses otherwise). Nothing here logs a name or any contact data.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { loadPositions, removeFromPipeline, setStage } from '@/lib/pipelines/positions'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function contactOrg(ctx: any, contactId: string): Promise<string | Response> {
  const { data, error } = await ctx.db.from('contacts').select('org_id, merged_into_id').eq('id', contactId).maybeSingle()
  if (error) return NextResponse.json({ error: 'The contact could not be read. Try again.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'That contact was not found.' }, { status: 404 })
  return requireOrg(ctx, (data as any).org_id)
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const sp = req.nextUrl.searchParams
  const orgId = requireOrg(ctx, sp.get('org_id'))
  if (orgId instanceof Response) return orgId
  const contactId = sp.get('contact_id')
  const pipelineId = sp.get('pipeline_id')
  if (contactId && !UUID.test(contactId)) return bad('contact_id is not valid')
  if (pipelineId && !UUID.test(pipelineId)) return bad('pipeline_id is not valid')
  try {
    const positions = await loadPositions(ctx.db, orgId, { contactIds: contactId ? [contactId] : undefined, pipelineId: pipelineId ?? undefined })
    return NextResponse.json({ positions })
  } catch (e) {
    console.error(`[pipeline-positions] read org=${orgId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'Pipelines could not be read. Try again.' }, { status: 500 })
  }
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id, stageId = body?.stage_id
  if (typeof contactId !== 'string' || !UUID.test(contactId)) return bad('contact_id is required')
  if (typeof stageId !== 'string' || !UUID.test(stageId)) return bad('stage_id is required')
  const org = await contactOrg(ctx, contactId)
  if (org instanceof Response) return org
  try {
    await setStage(ctx.db, contactId, stageId, ctx.userId, typeof body?.source === 'string' ? body.source.slice(0, 40) : 'manual')
    const positions = await loadPositions(ctx.db, org, { contactIds: [contactId] })
    return NextResponse.json({ ok: true, positions })
  } catch (e) {
    console.error(`[pipeline-positions] set contact=${contactId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'The stage could not be changed. Try again.' }, { status: 500 })
  }
})

export const DELETE = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id, pipelineId = body?.pipeline_id
  if (typeof contactId !== 'string' || !UUID.test(contactId)) return bad('contact_id is required')
  if (typeof pipelineId !== 'string' || !UUID.test(pipelineId)) return bad('pipeline_id is required')
  const org = await contactOrg(ctx, contactId)
  if (org instanceof Response) return org
  try {
    const removed = await removeFromPipeline(ctx.db, contactId, pipelineId, ctx.userId, 'manual')
    const positions = await loadPositions(ctx.db, org, { contactIds: [contactId] })
    return NextResponse.json({ ok: true, removed, positions })
  } catch (e) {
    console.error(`[pipeline-positions] remove contact=${contactId} failed: ${(e as Error).message}`)
    return NextResponse.json({ error: 'The contact could not be removed from that pipeline. Try again.' }, { status: 500 })
  }
})
