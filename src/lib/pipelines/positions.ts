// src/lib/pipelines/positions.ts
// Pipeline membership and stage, from contact_pipeline_positions (hub_229). The ONLY source: a contact can be in
// many pipelines, one row per pipeline, and a move in one pipeline never touches another.
//
// contacts.pipeline_id / pipeline_stage are legacy. The Hub never writes them and does not read them for
// membership. Other apps still write them; a database trigger turns those writes into position moves.
// contacts.pipeline (the client track: new_lead / mastermind / enrolled) is a different field and is not this.
//
// Reads work with any client that can see the rows: staff read positions, pipelines and pipeline_stages under
// RLS, and the service role reads everything. Writes go through the hub_pipeline_* RPCs, which only the service
// role may call, so client code writes through /api/crm/pipeline-positions (see ./client.ts).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StageRef {
  id: string
  /** pipeline_stages.legacy_key: the stage's id in org_settings.crm_pipelines */
  key: string
  name: string
  position: number
  color: string | null
  is_closed_won: boolean
  is_closed_lost: boolean
}

export interface PipelineRef {
  id: string
  /** pipelines.legacy_key: the pipeline's id in org_settings.crm_pipelines, used by older tables and routes */
  key: string
  name: string
  position: number
  stages: StageRef[]
}

export interface Position {
  contact_id: string
  pipeline_id: string
  pipeline_key: string
  pipeline_name: string
  stage_id: string
  stage_name: string
  stage_color: string | null
  stage_position: number
  is_closed_won: boolean
  is_closed_lost: boolean
  moved_at: string
  source: string
}

const CHUNK = 150
const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** Live pipelines of an org with their live stages, in display order. */
export async function loadPipelines(db: SupabaseClient, orgId: string): Promise<PipelineRef[]> {
  const [{ data: ps, error: pErr }, { data: ss, error: sErr }] = await Promise.all([
    db.from('pipelines').select('id, legacy_key, name, position').eq('org_id', orgId).is('archived_at', null).order('position'),
    db.from('pipeline_stages').select('id, pipeline_id, legacy_key, name, position, color, is_closed_won, is_closed_lost')
      .eq('org_id', orgId).is('archived_at', null).order('position'),
  ])
  if (pErr || sErr) throw new Error(`pipelines read: ${(pErr ?? sErr)?.code ?? 'unknown'}`)
  const stages = new Map<string, StageRef[]>()
  for (const s of (ss ?? []) as any[]) {
    const list = stages.get(s.pipeline_id) ?? []
    list.push({ id: s.id, key: s.legacy_key, name: s.name, position: s.position, color: s.color ?? null, is_closed_won: !!s.is_closed_won, is_closed_lost: !!s.is_closed_lost })
    stages.set(s.pipeline_id, list)
  }
  return ((ps ?? []) as any[]).map((p) => ({ id: p.id, key: p.legacy_key, name: p.name, position: p.position, stages: stages.get(p.id) ?? [] }))
}

/** Pure: join raw position rows to the pipelines they belong to. Rows in an archived pipeline or stage are dropped. */
export function enrichPositions(rows: Array<{ contact_id: string; pipeline_id: string; stage_id: string; moved_at: string; source: string }>, pipelines: PipelineRef[]): Position[] {
  const byId = new Map(pipelines.map((p) => [p.id, p]))
  const out: Position[] = []
  for (const r of rows) {
    const p = byId.get(r.pipeline_id)
    const s = p?.stages.find((x) => x.id === r.stage_id)
    if (!p || !s) continue
    out.push({
      contact_id: r.contact_id, pipeline_id: p.id, pipeline_key: p.key, pipeline_name: p.name,
      stage_id: s.id, stage_name: s.name, stage_color: s.color, stage_position: s.position,
      is_closed_won: s.is_closed_won, is_closed_lost: s.is_closed_lost, moved_at: r.moved_at, source: r.source,
    })
  }
  return out.sort((a, b) => (byId.get(a.pipeline_id)!.position - byId.get(b.pipeline_id)!.position) || a.contact_id.localeCompare(b.contact_id))
}

/**
 * Positions in an org: for some contacts, for one pipeline, or (neither given) for the whole org.
 * Pass pipelines when you already have them, to save a read.
 */
export async function loadPositions(db: SupabaseClient, orgId: string, opts: { contactIds?: string[]; pipelineId?: string; pipelines?: PipelineRef[] } = {}): Promise<Position[]> {
  const pipelines = opts.pipelines ?? await loadPipelines(db, orgId)
  const base = () => {
    let q = db.from('contact_pipeline_positions').select('contact_id, pipeline_id, stage_id, moved_at, source').eq('org_id', orgId)
    if (opts.pipelineId) q = q.eq('pipeline_id', opts.pipelineId)
    return q
  }
  const rows: any[] = []
  if (opts.contactIds) {
    const ids = Array.from(new Set(opts.contactIds.filter(Boolean)))
    for (const g of chunks(ids, CHUNK)) {
      const { data, error } = await base().in('contact_id', g)
      if (error) throw new Error(`positions read: ${error.code ?? 'unknown'}`)
      rows.push(...(data ?? []))
    }
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await base().order('contact_id').range(from, from + 999)
      if (error) throw new Error(`positions read: ${error.code ?? 'unknown'}`)
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
  }
  return enrichPositions(rows, pipelines)
}

/**
 * The value of {{pipeline_stage}} for one contact: the stage in the given pipeline, or, with none given, the stage only
 * when the person is in exactly one pipeline (otherwise empty, since one stage cannot speak for several). Never throws:
 * a failed read renders the tag empty.
 */
export async function mergeStageFor(db: SupabaseClient, orgId: string, contactId: string, pipelineId?: string | null): Promise<string> {
  try {
    const rows = await loadPositions(db, orgId, { contactIds: [contactId] })
    if (pipelineId) return rows.find((p) => p.pipeline_id === pipelineId)?.stage_name ?? ''
    return rows.length === 1 ? rows[0].stage_name : ''
  } catch {
    return ''
  }
}

/** Pure: positions grouped by contact. */
export function positionsByContact(rows: Position[]): Map<string, Position[]> {
  const m = new Map<string, Position[]>()
  for (const r of rows) {
    const list = m.get(r.contact_id) ?? []
    list.push(r)
    m.set(r.contact_id, list)
  }
  return m
}

/** Pure: a pipeline by its uuid or its legacy key. */
export function findPipeline(pipelines: PipelineRef[], idOrKey: string | null | undefined): PipelineRef | null {
  if (!idOrKey) return null
  return pipelines.find((p) => p.id === idOrKey) ?? pipelines.find((p) => p.key === idOrKey) ?? null
}

/** Pure: a stage by exact name (or id) in a pipeline given by uuid or legacy key. Nothing is guessed: no match is null. */
export function resolveStage(pipelines: PipelineRef[], pipelineIdOrKey: string | null | undefined, stage: string | null | undefined): StageRef | null {
  const p = findPipeline(pipelines, pipelineIdOrKey)
  if (!p || !stage) return null
  return p.stages.find((s) => s.id === stage) ?? p.stages.find((s) => s.name === stage) ?? null
}

/** Pure: the first live stage of a pipeline, the default when a person is added with no stage chosen. */
export const firstStage = (p: PipelineRef | null | undefined): StageRef | null => p?.stages[0] ?? null

// ── Writes (service role only) ───────────────────────────────────────────────────────────────────────────────

export type PlaceResult = { placed: boolean; reason?: string; pipeline_id?: string; stage_id?: string; moved?: boolean }

/** Sets the contact's stage in that stage's pipeline, adding them to it if needed. Other pipelines are untouched. */
export async function setStage(db: SupabaseClient, contactId: string, stageId: string, actor: string | null, source: string): Promise<void> {
  const { error } = await db.rpc('hub_pipeline_set_stage', { p_contact: contactId, p_stage: stageId, p_actor: actor, p_source: source })
  if (error) throw new Error(`set stage: ${error.code ?? 'unknown'}`)
}

/** Removes the contact from one pipeline. Other pipelines are untouched. True when a row was removed. */
export async function removeFromPipeline(db: SupabaseClient, contactId: string, pipelineId: string, actor: string | null, source: string): Promise<boolean> {
  const { data, error } = await db.rpc('hub_pipeline_remove', { p_contact: contactId, p_pipeline: pipelineId, p_actor: actor, p_source: source })
  if (error) throw new Error(`remove from pipeline: ${error.code ?? 'unknown'}`)
  return data === true
}

/**
 * A route's placement (booking, quiz, form, lead device, onboarding). Adds the contact to the stage's pipeline if they
 * are not in it; if they are and onlyForward is true, moves them only when their current stage comes earlier.
 * Other pipelines are untouched.
 */
export async function placeContact(db: SupabaseClient, contactId: string, stageId: string, onlyForward: boolean, source: string): Promise<PlaceResult> {
  const { data, error } = await db.rpc('hub_pipeline_place', { p_contact: contactId, p_stage: stageId, p_only_forward: onlyForward, p_source: source })
  if (error) throw new Error(`place: ${error.code ?? 'unknown'}`)
  return (data ?? { placed: false, reason: 'no_result' }) as PlaceResult
}

/**
 * A placement named the old way, by pipeline legacy key (or uuid) and stage name, as booking and quiz routes store it.
 * An unknown pipeline or stage places nothing and says why; nothing is guessed.
 */
export async function placeByName(db: SupabaseClient, orgId: string, contactId: string, pipeline: string, stageName: string, onlyForward: boolean, source: string, pipelines?: PipelineRef[]): Promise<PlaceResult> {
  const list = pipelines ?? await loadPipelines(db, orgId)
  if (!findPipeline(list, pipeline)) return { placed: false, reason: 'pipeline_unknown' }
  const stage = resolveStage(list, pipeline, stageName)
  if (!stage) return { placed: false, reason: 'stage_unknown' }
  return placeContact(db, contactId, stage.id, onlyForward, source)
}
