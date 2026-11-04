// src/lib/bookings/placement.ts
// The booking sync's pure rules (no imports, so scripts/bookings/placement-check.mjs can
// run them directly): where a contact goes, and the answers as shown on the card.

interface Question { key: string; label?: string }
export interface Stage { name: string; is_closed_won?: boolean; is_closed_lost?: boolean }
export interface Pipeline { id: string; name: string; stages?: Stage[] }

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
 * Where the contact should go. Never backward when the route says so, and a contact
 * already on another live pipeline's board is left there (moving would take it off).
 */
export function decidePlacement(
  pipelines: Pipeline[], route: { pipeline_id: string; stage_name: string; move_earlier_stages_only: boolean },
  contact: { pipeline_id: string | null; pipeline_stage: string | null },
): { placement: Placement; stage?: string } {
  const pipeline = pipelines.find(p => p.id === route.pipeline_id)
  const stages = pipeline?.stages ?? []
  const target = stages.findIndex(s => norm(s.name) === norm(route.stage_name))
  if (!pipeline || target < 0) return { placement: 'none' }
  const stage = stages[target].name
  if (contact.pipeline_id && contact.pipeline_id !== route.pipeline_id && pipelines.some(p => p.id === contact.pipeline_id)) {
    return { placement: 'other_pipeline' }
  }
  if (contact.pipeline_id !== route.pipeline_id) return { placement: 'entered', stage }
  const current = stages.findIndex(s => norm(s.name) === norm(contact.pipeline_stage))
  if (current === target || (route.move_earlier_stages_only && current > target)) return { placement: 'kept' }
  return { placement: 'moved', stage }
}
