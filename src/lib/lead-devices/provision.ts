// src/lib/lead-devices/provision.ts
// What a new device gets, in dry run: a pipeline, smart lists, and a draft campaign per outcome (or one if
// none). Safe to run again: each piece is looked up first. Campaigns stay draft, live_enabled stays false and
// routes stay off; nothing enrolls or sends until the device goes live and the campaign's own live switch is on.
//
// The campaign copy here is a short starter. The Campaign Builder can redraft it from the device's description
// and the voice guide, from the Lead Devices page, when the org's agent_enabled flag is on.
import type { SupabaseClient } from '@supabase/supabase-js'
import { brandName, outcomeTag, sourceKey, type DeviceRow, type Labelled } from './manifest'

export const LEAD_FUNNEL_STAGES = ['New lead', 'Engaged', 'Booked call', 'Purchased', 'Long-term nurture']
const STAGE_COLORS = ['#228DC4', '#2A9D8F', '#FBBF24', '#34D399', '#94A3B8']
const DAY = 24 * 60

const listBrand = (d: Pick<DeviceRow, 'brand'>) => (d.brand === 'wnw' ? 'wnw' : 'np')

/** Pure: the pipeline as the pipeline editor stores it. */
export function leadFunnelPipeline(slug: string, name: string) {
  return {
    id: `lead-device-${slug}`,
    name,
    stages: LEAD_FUNNEL_STAGES.map((stage, position) => ({
      id: `stage-${position}`, name: stage, color: STAGE_COLORS[position], position,
      is_closed_won: stage === 'Purchased', is_closed_lost: false,
    })),
  }
}

/** Pure: the starter steps: a service email with the result or asset, then two marketing emails toward a call. */
export function starterSteps(d: Pick<DeviceRow, 'name' | 'brand' | 'manifest'>, outcome: Labelled | null) {
  const what = outcome ? `your ${d.name} result: ${outcome.label}` : `your ${d.name}`
  const asset = d.manifest.asset_url ? `\n\nHere it is: ${d.manifest.asset_url}` : ''
  const brand = brandName(d.brand)
  return [
    { step_order: 0, channel: 'email', delay_minutes: 0, kind: 'service', step_type: 'message',
      subject: `Your ${d.name}`,
      body: `Hi {{first_name}},\n\nThank you for completing ${d.name}. This is ${what}.${asset}\n\n${brand}` },
    { step_order: 1, channel: 'email', delay_minutes: 2 * DAY, kind: 'marketing', step_type: 'message',
      subject: `What ${d.name} points to`,
      body: `Hi {{first_name}},\n\nA result like this is a starting point. If you would like to talk through what it means for you, you can book a call with our team.\n\n${brand}` },
    { step_order: 2, channel: 'email', delay_minutes: 5 * DAY, kind: 'marketing', step_type: 'message',
      subject: 'Would a short call help?',
      body: `Hi {{first_name}},\n\nIf you have questions after ${d.name}, a short call is the easiest way to get them answered. Reply to this email and we will find a time.\n\n${brand}` },
  ]
}

/** Pure: the Campaign Builder request for one campaign. */
export function builderPrompt(d: Pick<DeviceRow, 'name' | 'type' | 'manifest'>, outcome: Labelled | null): string {
  return [
    `Redraft this campaign for the lead device "${d.name}" (${d.type}).`,
    d.manifest.description ? `What the device is: ${d.manifest.description}` : null,
    outcome ? `This campaign is for people whose outcome was "${outcome.label}".` : null,
    d.manifest.asset_url ? `The welcome message delivers this: ${d.manifest.asset_url}` : 'The welcome message delivers their result.',
    'Write a service welcome email, then a short marketing nurture of two or three emails toward a booked call.',
    'Do not add an entry source: the device already routes people into this campaign.',
  ].filter(Boolean).join('\n').slice(0, 3900)
}

async function ensurePipeline(db: SupabaseClient, d: DeviceRow): Promise<string> {
  if (d.pipeline_id) return d.pipeline_id
  const shape = leadFunnelPipeline(d.slug, d.name)
  const { data: existing } = await db.from('pipelines').select('id').eq('org_id', d.org_id).eq('legacy_key', shape.id).maybeSingle()
  if ((existing as any)?.id) return (existing as any).id
  const { data: setting, error } = await db.from('org_settings').select('setting_value').eq('org_id', d.org_id).eq('setting_key', 'crm_pipelines').maybeSingle()
  if (error) throw new Error(`pipeline settings read: ${error.code ?? 'unknown'}`)
  const value: any = (setting as any)?.setting_value ?? { active: shape.id, pipelines: [] }
  const pipelines = Array.isArray(value.pipelines) ? value.pipelines : []
  if (!pipelines.some((p: any) => p?.id === shape.id)) pipelines.push(shape)
  // The trigger on org_settings keeps public.pipelines and pipeline_stages in step with this value.
  const { error: wErr } = await db.from('org_settings').upsert(
    { org_id: d.org_id, setting_key: 'crm_pipelines', setting_value: { ...value, pipelines }, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,setting_key' })
  if (wErr) throw new Error(`pipeline settings write: ${wErr.code ?? 'unknown'}`)
  const { data: made, error: rErr } = await db.from('pipelines').select('id').eq('org_id', d.org_id).eq('legacy_key', shape.id).maybeSingle()
  if (rErr || !(made as any)?.id) throw new Error(`pipeline not synced: ${rErr?.code ?? 'no row'}`)
  return (made as any).id
}

async function ensureList(db: SupabaseClient, d: DeviceRow, seed: string, name: string, definition: unknown, userId: string | null): Promise<string> {
  const { data: found } = await db.from('smart_lists').select('id').eq('org_id', d.org_id).eq('seed_key', seed).maybeSingle()
  if ((found as any)?.id) return (found as any).id
  const { data, error } = await db.from('smart_lists').insert({
    org_id: d.org_id, seed_key: seed, name, brand: listBrand(d), definition, created_by: userId,
    description: `Created for the lead device ${d.name}.`,
  }).select('id').single()
  if (error || !data) throw new Error(`smart list: ${error?.code ?? 'no row'}`)
  return (data as any).id
}

async function ensureCampaign(db: SupabaseClient, d: DeviceRow, outcome: Labelled | null, pipelineId: string, listId: string, userId: string | null): Promise<string> {
  const key = sourceKey(d.slug, outcome?.key)
  const { data: route } = await db.from('campaign_routes').select('campaign_id').eq('org_id', d.org_id).eq('source_key', key).limit(1)
  if ((route as any)?.[0]?.campaign_id) return (route as any)[0].campaign_id

  const { data: stages } = await db.from('pipeline_stages').select('id, name').eq('pipeline_id', pipelineId).is('archived_at', null)
  const stageNamed = (re: RegExp) => ((stages ?? []) as any[]).find((s) => re.test(s.name))?.id ?? null
  const name = outcome ? `${d.name}: ${outcome.label}` : d.name
  const { data: camp, error } = await db.from('funnel_campaigns').insert({
    org_id: d.org_id, name, status: 'draft', live_enabled: false, brand: listBrand(d), smart_list_id: listId,
    description: `Starter draft for the lead device ${d.name}. Review the emails before going live.`,
    entry_pipeline_id: pipelineId, entry_stage_id: stageNamed(/^new lead$/i), goal_stage_id: stageNamed(/^booked call$/i), goal: {}, created_by: userId,
  }).select('id').single()
  if (error || !camp) throw new Error(`campaign: ${error?.code ?? 'no row'}`)
  const campaignId = (camp as any).id

  const { data: seq, error: sErr } = await db.from('sequences').insert({ org_id: d.org_id, name, campaign_id: campaignId, is_active: true }).select('id').single()
  if (sErr || !seq) throw new Error(`sequence: ${sErr?.code ?? 'no row'}`)
  const { error: stErr } = await db.from('sequence_steps').insert(starterSteps(d, outcome).map((s) => ({ ...s, sequence_id: (seq as any).id })))
  if (stErr) throw new Error(`steps: ${stErr.code ?? 'unknown'}`)
  const { error: lErr } = await db.from('funnel_campaigns').update({ sequence_id: (seq as any).id }).eq('id', campaignId)
  if (lErr) throw new Error(`campaign link: ${lErr.code ?? 'unknown'}`)
  const { error: rErr } = await db.from('campaign_routes').insert({ org_id: d.org_id, source_key: key, campaign_id: campaignId, active: false, activate_with_campaign: false })
  if (rErr) throw new Error(`route: ${rErr.code ?? 'unknown'}`)
  return campaignId
}

/** Never throws: a failure is stored on the device, shown on its page, and can be retried from there. */
export async function provisionDevice(db: SupabaseClient, d: DeviceRow, userId: string | null): Promise<void> {
  try {
    const pipelineId = await ensurePipeline(db, d)
    const leads = await ensureList(db, d, `ld:${d.slug}:leads`, `${d.name} leads`,
      { match: 'all', rules: [{ field: 'lead_device', op: 'in', value: [d.slug] }] }, userId)
    const outcomes = d.manifest.outcomes
    const lists: Record<string, string> = { leads }
    const campaigns: Record<string, string> = {}
    if (outcomes.length) {
      for (const o of outcomes) {
        lists[o.key] = await ensureList(db, d, `ld:${d.slug}:${o.key}`, `${d.name}: ${o.label}`,
          { match: 'all', rules: [{ field: 'tags', op: 'any', value: [outcomeTag(d.slug, o.key)] }] }, userId)
        campaigns[o.key] = await ensureCampaign(db, d, o, pipelineId, lists[o.key], userId)
      }
    }
    else campaigns._none = await ensureCampaign(db, d, null, pipelineId, leads, userId)
    const { error } = await db.from('lead_devices').update({
      pipeline_id: pipelineId, assets: { ...d.assets, lists, campaigns }, provisioned_at: new Date().toISOString(), provision_error: null,
    }).eq('id', d.id)
    if (error) throw new Error(`device update: ${error.code ?? 'unknown'}`)
  } catch (e) {
    const message = (e as Error).message.slice(0, 300)
    console.error(`[lead-device] provision device=${d.id} failed: ${message}`)
    await db.from('lead_devices').update({ provision_error: message }).eq('id', d.id)
  }
}
