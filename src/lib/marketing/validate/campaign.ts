// src/lib/marketing/validate/campaign.ts
// The one set of checks for a funnel campaign. POST /api/marketing/campaigns and the
// Campaign Builder agent both call this (agent ruling 3), so the agent cannot save a
// campaign a person could not. Lookups are injected; the screen passes the database,
// in the same order the route always queried it.
import type { SupabaseClient } from '@supabase/supabase-js'

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived']

export interface CampaignLookup {
  /** Is this id a row of that table in the caller's org? */
  inOrg(table: string, id: string): Promise<boolean>
  /** The pipeline a stage belongs to, or undefined when the stage is not found. */
  stagePipeline(stageId: string): Promise<string | undefined>
}

export type CampaignCheck = { ok: true; name: string } | { ok: false; message: string }

export async function checkCampaign(b: any, lookup: CampaignLookup): Promise<CampaignCheck> {
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name) return { ok: false, message: 'Give the campaign a name.' }
  if (b.status && !CAMPAIGN_STATUSES.includes(b.status)) return { ok: false, message: 'That status is not one the Hub recognises.' }
  // every referenced id must belong to this org
  const checks: Array<[string, string, unknown]> = [
    ['pipelines', 'entry_pipeline_id', b.entry_pipeline_id], ['pipeline_stages', 'entry_stage_id', b.entry_stage_id],
    ['pipeline_stages', 'goal_stage_id', b.goal_stage_id], ['sequences', 'sequence_id', b.sequence_id],
    ['campaigns', 'planning_campaign_id', b.planning_campaign_id],
  ]
  for (const [table, field, id] of checks) {
    if (id == null || id === '') continue
    if (!(await lookup.inOrg(table, id as string))) {
      return { ok: false, message: `The ${field.replace(/_id$/, '').replace(/_/g, ' ')} was not found in this organization.` }
    }
  }
  if (b.entry_stage_id && (await lookup.stagePipeline(b.entry_stage_id)) !== b.entry_pipeline_id) {
    return { ok: false, message: 'The entry stage must belong to the entry pipeline.' }
  }
  return { ok: true, name }
}

export function dbCampaignLookup(db: SupabaseClient, org: string): CampaignLookup {
  return {
    async inOrg(table, id) {
      const { data } = await db.from(table).select('id').eq('id', id).eq('org_id', org).maybeSingle()
      return !!data
    },
    async stagePipeline(stageId) {
      const { data: st } = await db.from('pipeline_stages').select('pipeline_id').eq('id', stageId).maybeSingle()
      return (st as any)?.pipeline_id
    },
  }
}
