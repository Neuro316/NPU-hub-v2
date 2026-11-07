// src/lib/bookings/placement.ts
// The booking sync's pure rules (no imports, so scripts/bookings/placement-check.mjs can
// run them directly): which stage a route points at, what a placement did, and the answers
// as shown on the card.
//
// Membership and stage live in contact_pipeline_positions. A booking places the guest in the
// route's pipeline only (hub_pipeline_place decides "never backward" against the guest's
// position in that pipeline); every other pipeline the guest is in is left as it is.

interface Question { key: string; label?: string }
export interface Stage { id: string; name: string }
/** A live pipeline: id is the uuid, key the legacy key that nr_booking_pipeline_routes.pipeline_id stores. */
export interface Pipeline { id: string; key: string; name: string; stages: Stage[] }

/** As hub_booking_syncs.placement records it. 'other_pipeline' is kept for older rows; it is no longer produced. */
export type Placement = 'moved' | 'entered' | 'kept' | 'other_pipeline' | 'none'

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** One entry per question, in the type's order, worded as asked; stray keys after. */
export function answerList(questions: unknown, answers: Record<string, unknown> | null) {
  const qs: Question[] = Array.isArray(questions) ? questions.filter((q: any) => q && typeof q.key === 'string') : []
  const a = answers && typeof answers === 'object' ? answers : {}
  const show = (v: unknown) => v == null ? '' : Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const out = qs.map(q => ({ key: q.key, label: String(q.label || q.key), answer: show(a[q.key]) }))
  for (const k of Object.keys(a)) if (!qs.some(q => q.key === k)) out.push({ key: k, label: k, answer: show(a[k]) })
  return out
}

/**
 * The stage a route points at: its pipeline by legacy key (or uuid), then the stage by exact
 * name, else the single stage whose name matches ignoring case and outer spaces (routes saved
 * before names were checked exactly). Two such matches, or none, is unknown: nothing is guessed.
 */
export function routeStage(
  pipelines: Pipeline[], route: { pipeline_id: string; stage_name: string },
): { ok: true; pipeline: Pipeline; stage: Stage } | { ok: false; reason: 'pipeline_unknown' | 'stage_unknown' } {
  const pipeline = pipelines.find(p => p.id === route.pipeline_id) ?? pipelines.find(p => p.key === route.pipeline_id)
  if (!pipeline) return { ok: false, reason: 'pipeline_unknown' }
  const exact = pipeline.stages.find(s => s.name === route.stage_name)
  if (exact) return { ok: true, pipeline, stage: exact }
  const loose = pipeline.stages.filter(s => norm(s.name) === norm(route.stage_name))
  if (loose.length !== 1) return { ok: false, reason: 'stage_unknown' }
  return { ok: true, pipeline, stage: loose[0] }
}

/** What hub_pipeline_place did, in the sync's words. */
export function placementOf(result: { placed: boolean; moved?: boolean; reason?: string }): Placement {
  if (result.placed) return result.moved ? 'moved' : 'entered'
  if (result.reason === 'already_there' || result.reason === 'already_further') return 'kept'
  return 'none'
}
