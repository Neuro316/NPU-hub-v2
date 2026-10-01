// src/lib/marketing/db-errors.ts
// Turns a Postgres constraint failure into a sentence a person can act on, without
// showing SQL, table internals or data. Anything that is not a constraint failure gets
// the caller's own message.

const KNOWN: Record<string, string> = {
  sequences_created_by_fkey: 'your team member record could not be matched to this organization',
  sequences_org_id_fkey: 'the organization could not be found',
  sequences_campaign_id_fkey: 'the campaign could not be found; it may have been removed',
  sequence_steps_asset_id_fkey: 'one step points at a University asset that no longer exists; choose another asset',
  sequence_steps_sequence_id_fkey: 'the step list could not be found; reload the page and save again',
  sequence_steps_channel_check: 'one step has a channel the Hub does not support',
  funnel_campaigns_goal_stage_id_fkey: 'the goal stage no longer exists; choose another stage',
  funnel_campaigns_entry_pipeline_id_entry_stage_id_fkey: 'the entry stage is not part of the chosen pipeline',
  funnel_campaigns_sequence_id_fkey: 'the campaign\'s step list could not be found',
  funnel_campaigns_planning_campaign_id_fkey: 'the linked marketing campaign no longer exists',
  campaign_routes_campaign_id_fkey: 'the campaign could not be found; it may have been removed',
  form_definitions_slug_key: 'another form already uses that address',
}

const BY_CODE: Record<string, string> = {
  '23503': 'something it links to could not be found',
  '23505': 'the same thing already exists',
  '23514': 'a value is not one the Hub accepts',
  '23502': 'a required value is missing',
}

/** Null when the error is not a constraint failure; otherwise a plain sentence. */
export function constraintMessage(error: { code?: string; message?: string } | null | undefined, action: string): string | null {
  if (!error?.code || !BY_CODE[error.code]) return null
  const name = /constraint "([a-z0-9_]+)"/.exec(error.message ?? '')?.[1]
  const why = (name && KNOWN[name]) || BY_CODE[error.code]
  return `${action} could not be saved because ${why}.`
}
