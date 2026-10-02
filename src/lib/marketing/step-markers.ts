// src/lib/marketing/step-markers.ts
// The "AI draft, needs review" marker follows the STEP, not its position (agent ruling 14).
//
// The sequence save path keeps row ids by position on purpose: the send dedupe key includes the
// step id, so a new id would let an already-sent step go out again. That means content moves
// between rows when a step is deleted or reordered, and a marker stored on the row would stay
// behind. So the marker is worked out for each incoming step from the row it CAME FROM:
//   1. the id the editor sent, if that row is in this sequence
//   2. otherwise an unused row with identical content (the content hash), for a client that
//      does not send ids
//   3. otherwise none: the content is new, written by a person, so it carries no marker
// and then:
//   unchanged content   keeps the source's marker exactly (unreviewed stays unreviewed)
//   changed content     an AI step edited on its screen counts as reviewed (ruling 14)
// Pure, so it can be tested without a database.

export interface StepContent {
  channel: string; delay_minutes: number; subject: string | null; body: string | null
  kind: string | null; step_type: string; asset_id: string | null
}
export interface ExistingStep extends StepContent { id: string; ai_run_id: string | null; ai_reviewed_at: string | null }
export interface Marker { ai_run_id: string | null; ai_reviewed_at: string | null }

export const contentKey = (s: StepContent) => JSON.stringify([s.channel, Number(s.delay_minutes) || 0, s.subject ?? null, s.body ?? null,
  s.kind ?? null, s.step_type, s.asset_id ?? null])

export function carryMarkers(existing: ExistingStep[], incoming: Array<{ id?: unknown; row: StepContent }>, now: string): Marker[] {
  const byId = new Map(existing.map((e) => [e.id, e]))
  const used = new Set<string>()
  // pass 1: explicit ids claim their rows first, so a content match cannot take a row an id names
  const source: Array<ExistingStep | null> = incoming.map((x) => {
    const e = typeof x.id === 'string' ? byId.get(x.id) : undefined
    if (e && !used.has(e.id)) { used.add(e.id); return e }
    return null
  })
  // pass 2: steps without a usable id match an unused row with identical content
  incoming.forEach((x, i) => {
    if (source[i]) return
    const k = contentKey(x.row)
    const e = existing.find((r) => !used.has(r.id) && contentKey(r) === k)
    if (e) { used.add(e.id); source[i] = e }
  })
  return incoming.map((x, i) => {
    const s = source[i]
    if (!s || !s.ai_run_id) return { ai_run_id: null, ai_reviewed_at: null }
    if (contentKey(s) === contentKey(x.row)) return { ai_run_id: s.ai_run_id, ai_reviewed_at: s.ai_reviewed_at }
    return { ai_run_id: s.ai_run_id, ai_reviewed_at: s.ai_reviewed_at ?? now }
  })
}
