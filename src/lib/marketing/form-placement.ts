// src/lib/marketing/form-placement.ts
// Website and Hub form leads into a pipeline (Running List q08, Hub half). The public intake route
// (src/app/api/intake/route.ts) creates or matches the contact and enrolls campaigns, but never places a pipeline
// card, and that route stays byte-identical (scripts/agent/flag-off-parity.cjs pins it). This runs beside it from
// /api/cron/form-placement: every ACCEPTED submission of a form that has a route places its contact at the route's
// stage, forward only, with the source shown on the card through the stage move's source (form:<slug>).
//
//   routes   org_settings 'hub_form_routes' = { "<form slug>": { "pipeline": "<legacy key or uuid>", "stage": "<name>" } }
//            A form with no route places nothing. Malformed entries are dropped, never guessed.
//   who      only a contact CREATED by the submission (contacts.created_at at or after the submission). An existing
//            client or lead who signs up for the newsletter keeps their place and is not added to Sales as a lead.
//   repeat   hub_pipeline_place is forward-only and answers already_there, so a run that sees a submission again
//            changes nothing.
// Logs ids and codes only: never a name, an address or a value from the form.
import type { SupabaseClient } from '@supabase/supabase-js'
import { placeByName } from '@/lib/pipelines/positions'

export interface FormRoute { pipeline: string; stage: string }

/** Pure: the routes in org_settings 'hub_form_routes'. */
export function parseFormRoutes(raw: unknown): Map<string, FormRoute> {
  const out = new Map<string, FormRoute>()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [slug, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const pipeline = typeof r.pipeline === 'string' ? r.pipeline.trim() : ''
    const stage = typeof r.stage === 'string' ? r.stage.trim() : ''
    if (pipeline && stage) out.set(slug, { pipeline, stage })
  }
  return out
}

export interface Submission { id: string; org_id: string; contact_id: string | null; outcome: string; created_at: string; form_slug: string }

/** Pure: should this submission place its contact, and where. */
export function placementFor(s: Submission, contactCreatedAt: string | null, routes: Map<string, FormRoute>): FormRoute | null {
  if (s.outcome !== 'accepted' || !s.contact_id || !contactCreatedAt) return null
  const route = routes.get(s.form_slug)
  if (!route) return null
  // created by this submission: the contact row is no older than the submission (a minute's grace for clock skew)
  if (Date.parse(contactCreatedAt) < Date.parse(s.created_at) - 60_000) return null
  return route
}

export const LOOKBACK_HOURS = 48

export async function runFormPlacement(db: SupabaseClient, now: Date, deadline: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = { seen: 0, placed: 0, kept: 0, skipped: 0, failed: 0 }
  const { data: settings, error: sErr } = await db.from('org_settings').select('org_id, setting_value').eq('setting_key', 'hub_form_routes')
  if (sErr) throw new Error(`routes read: ${sErr.code ?? 'unknown'}`)
  for (const row of (settings ?? []) as any[]) {
    const routes = parseFormRoutes(row.setting_value)
    if (!routes.size) continue
    const { data: forms, error: fErr } = await db.from('form_definitions').select('id, slug').eq('org_id', row.org_id).in('slug', Array.from(routes.keys()))
    if (fErr) throw new Error(`forms read: ${fErr.code ?? 'unknown'}`)
    const slugOf = new Map(((forms ?? []) as any[]).map((f) => [f.id as string, f.slug as string]))
    if (!slugOf.size) continue
    const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString()
    const { data: subs, error } = await db.from('form_submissions').select('id, org_id, form_id, contact_id, outcome, created_at')
      .eq('org_id', row.org_id).in('form_id', Array.from(slugOf.keys())).eq('outcome', 'accepted').gte('created_at', since).limit(500)
    if (error) throw new Error(`submissions read: ${error.code ?? 'unknown'}`)
    for (const s of (subs ?? []) as any[]) {
      if (Date.now() > deadline) return counts
      counts.seen++
      const sub: Submission = { ...s, form_slug: slugOf.get(s.form_id) ?? '' }
      const { data: c } = s.contact_id ? await db.from('contacts').select('created_at, merged_into_id').eq('id', s.contact_id).maybeSingle() : { data: null }
      const route = placementFor(sub, (c as any)?.created_at ?? null, routes)
      if (!route) { counts.skipped++; continue }
      try {
        const r = await placeByName(db, row.org_id, s.contact_id, route.pipeline, route.stage, true, `form:${sub.form_slug}`)
        if (r.placed) counts.placed++
        else if (r.reason === 'already_there' || r.reason === 'already_further') counts.kept++
        else { counts.failed++; console.warn(`[form-placement] submission=${s.id} placed nothing: ${r.reason ?? 'unknown'}`) }
      } catch (e: any) {
        counts.failed++
        console.error(`[form-placement] submission=${s.id} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
      }
    }
  }
  return counts
}
