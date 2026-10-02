// src/lib/agent/tools/read.ts
// What the Campaign Builder may see (ruling 2): pipelines and stages, entry sources and
// whether each is connected, University assets, form definitions, step types and the send
// readiness. Never a contact row, a message that was sent, consent records or the test
// allowlist (AG10). Every read names its columns; READ_COLUMNS is the complete list, and
// scripts/agent/leak-tamper.cjs fails the build if a read reaches anything else.
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSourceStatus, SOURCE_KINDS, type SourceStatus } from '@/lib/marketing/ui-logic'
import { getSendPolicy, senderProblem } from '@/lib/marketing/policy'

export const READ_COLUMNS: Record<string, string> = {
  pipelines: 'id, name',
  pipeline_stages: 'id, pipeline_id, name, position',
  university_assets: 'id, title, description',
  form_definitions: 'id, slug, name, status, source_key, consents',
  page_definitions: 'slug',
}

export interface HubSetup {
  pipelines: Array<{ id: string; name: string }>
  stages: Array<{ id: string; pipeline_id: string; name: string; position: number }>
  sources: Array<{ kind: string; label: string; connected: boolean; why: string }>
  status: SourceStatus
  assets: Array<{ id: string; title: string; description: string | null }>
  forms: Array<{ id: string; slug: string; name: string; status: string; source_key: string; consents: Array<{ channel: string; kind: string }> }>
  sender_ready: boolean
  page_slugs: string[]
}

export async function readHubSetup(db: SupabaseClient, org: string): Promise<HubSetup> {
  const [p, s, a, f, pg, wiring, twilio, policy] = await Promise.all([
    db.from('pipelines').select(READ_COLUMNS.pipelines).eq('org_id', org).is('archived_at', null).order('position'),
    db.from('pipeline_stages').select(READ_COLUMNS.pipeline_stages).eq('org_id', org).is('archived_at', null).order('position'),
    db.from('university_assets').select(READ_COLUMNS.university_assets).eq('org_id', org).eq('active', true),
    db.from('form_definitions').select(READ_COLUMNS.form_definitions).eq('org_id', org).neq('status', 'archived'),
    db.from('page_definitions').select(READ_COLUMNS.page_definitions).eq('org_id', org),
    db.rpc('entry_source_status'),
    // only the COUNT of phone lines leaves this function, never a number
    db.from('org_settings').select('setting_value').eq('org_id', org).eq('setting_key', 'crm_twilio').maybeSingle(),
    getSendPolicy(db, org),
  ])
  for (const r of [p, s, a, f, pg] as any[]) if (r.error) throw new Error(`setup read failed: ${r.error.code ?? 'unknown'}`)
  const numbers = (twilio.data as any)?.setting_value?.numbers
  const status = buildSourceStatus({
    queue: (wiring.data as any)?.queue === true, stageTrigger: (wiring.data as any)?.stage === true,
    tagTrigger: (wiring.data as any)?.tag === true, lines: Array.isArray(numbers) ? numbers.length : 0,
  })
  const group = (kind: string) => (kind === 'call_inbound' ? 'call_answered' : kind) as keyof SourceStatus
  return {
    pipelines: (p.data ?? []) as any,
    stages: (s.data ?? []) as any,
    sources: SOURCE_KINDS.map((k) => ({ kind: k.kind, label: k.label, connected: !!status[group(k.kind)]?.connected, why: status[group(k.kind)]?.why ?? '' })),
    status,
    assets: (a.data ?? []) as any,
    forms: ((f.data ?? []) as any[]).map((x) => ({ id: x.id, slug: x.slug, name: x.name, status: x.status, source_key: x.source_key,
      consents: Array.isArray(x.consents) ? x.consents.map((c: any) => ({ channel: String(c?.channel), kind: String(c?.kind) })) : [] })),
    sender_ready: policy ? senderProblem(policy) === null : false,
    page_slugs: ((pg.data ?? []) as any[]).map((x) => x.slug),
  }
}

/** The setup as the model sees it: names and ids, no wording the model does not need. */
export function setupForModel(s: HubSetup) {
  return {
    pipelines: s.pipelines.map((p) => ({ id: p.id, name: p.name,
      stages: s.stages.filter((x) => x.pipeline_id === p.id).sort((a, b) => a.position - b.position).map((x) => ({ id: x.id, name: x.name })) })),
    entry_sources: s.sources.map((x) => ({ kind: x.kind, means: x.label, connected: x.connected, note: x.why })),
    source_key_formats: {
      form: 'form:<form address>, for a form listed below or one you draft', call_missed: 'call:missed', call_inbound: 'call:answered',
      stage: 'stage:<stage id>', tag: 'tag:<tag in lower case with dashes>', import: 'import:<import name in lower case with dashes>',
      booking: 'not connected: add a task instead', quiz: 'not connected: add a task instead',
    },
    university_assets: s.assets.map((x) => ({ title: x.title, description: x.description })),
    forms: s.forms.map((x) => ({ address: x.slug, name: x.name, status: x.status, source_key: x.source_key,
      consent_boxes: x.consents.map((c) => `${c.channel} ${c.kind}`) })),
    step_types: ['email', 'sms', 'wait', 'deliver_asset (an email or text that hands out a University asset link)'],
    sender_ready: s.sender_ready,
  }
}
