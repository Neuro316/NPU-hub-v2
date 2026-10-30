// src/app/api/crm/pipeline-deals/remove/route.ts
// "Remove from pipeline" on a board card. Clears the contact's placement and deletes
// its deal row for that pipeline (hub_214). The contact itself is kept.
//
// POST { contact_id, pipeline_key }
//
// Removal is not a loss: the deal row is deleted rather than marked lost, so Win Rate
// and the other summary cards simply stop counting the card.
//
// contact_timeline: trg_pipeline_timeline writes the 'pipeline_changed' entry
// ("Pipeline: X → None") when the stage changes. A card with no stage would get no
// entry from the trigger, so this route writes one in the same shape.
//
// Service role, so withStaff is the boundary. The org comes from the CONTACT.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id
  const pipelineKey = body?.pipeline_key
  if (typeof contactId !== 'string' || typeof pipelineKey !== 'string' || !pipelineKey) {
    return bad('contact_id and pipeline_key are required')
  }

  const { data: contact, error: cErr } = await ctx.db.from('contacts')
    .select('id, org_id, pipeline_id, pipeline_stage').eq('id', contactId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId
  if (contact.pipeline_id !== pipelineKey) {
    return NextResponse.json({ error: 'This contact is no longer in that pipeline. Reload the board.' }, { status: 409 })
  }

  const { data: setting } = await ctx.db.from('org_settings').select('setting_value')
    .eq('org_id', orgId).eq('setting_key', 'crm_pipelines').maybeSingle()
  const pipelines: any[] = Array.isArray(setting?.setting_value?.pipelines) ? setting!.setting_value.pipelines : []
  const pipelineName: string = pipelines.find(p => p?.id === pipelineKey)?.name || 'pipeline'

  // Guarded on the placement read above, so a concurrent move is not undone.
  const { data: cleared, error: uErr } = await ctx.db.from('contacts')
    .update({ pipeline_id: null, pipeline_stage: null })
    .eq('id', contactId).eq('pipeline_id', pipelineKey).select('id')
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
  if (!cleared?.length) {
    return NextResponse.json({ error: 'This contact is no longer in that pipeline. Reload the board.' }, { status: 409 })
  }

  const { error: dErr } = await ctx.db.from('hub_pipeline_deals')
    .delete().eq('contact_id', contactId).eq('pipeline_key', pipelineKey)
  if (dErr) {
    return NextResponse.json({ error: `Removed from ${pipelineName}, but its lead value could not be cleared: ${dErr.message}` }, { status: 500 })
  }

  if (!contact.pipeline_stage) {
    await ctx.db.from('contact_timeline').insert({
      org_id: orgId, contact_id: contactId, event_type: 'pipeline_changed',
      title: `Removed from ${pipelineName}`,
      metadata: { from: null, to: null, pipeline_key: pipelineKey },
      occurred_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({ ok: true })
})
