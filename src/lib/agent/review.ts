// src/lib/agent/review.ts
// The plan as a person reviews it before anything is built (ruling 14): ids replaced by the
// names they stand for. Pure.
import type { Plan } from './tools/draft'
import type { HubSetup } from './tools/read'
import { describeSource } from '@/lib/marketing/ui-logic'

export function planForReview(plan: Plan, setup: HubSetup) {
  const stage = (id: string | null) => (id ? setup.stages.find((s) => s.id === id)?.name ?? 'unknown stage' : null)
  const pipeline = (id: string | null) => (id ? setup.pipelines.find((p) => p.id === id)?.name ?? 'unknown pipeline' : null)
  const forms = [...setup.forms.map((f) => ({ source_key: f.source_key, name: f.name })), ...plan.forms.map((f) => ({ source_key: f.source_key, name: f.name }))]
  return {
    campaign: plan.campaign && { name: plan.campaign.name, description: plan.campaign.description,
      entry_pipeline: pipeline(plan.campaign.entry_pipeline_id), entry_stage: stage(plan.campaign.entry_stage_id), goal_stage: stage(plan.campaign.goal_stage_id) },
    sequence: plan.sequence && { name: plan.sequence.name, steps: plan.sequence.steps.map((s) => ({
      ...s, asset: s.asset_id ? setup.assets.find((a) => a.id === s.asset_id)?.title ?? null : null,
      needs_review: plan.review.find((r) => r.step === s.step_order + 1)?.issues ?? [] })) },
    sources: plan.routes.map((r) => ({ source_key: r.source_key, label: describeSource(r.source_key, forms, setup.stages) })),
    forms: plan.forms.map((f) => ({ slug: f.slug, name: f.name, fields: f.fields, consents: f.consents })),
    pages: plan.pages.map((p) => ({ slug: p.slug, title: p.title, blocks: p.blocks, form_slug: p.form_slug })),
    tasks: plan.tasks,
    edit_of: plan.edit_of,
    summary: plan.summary,
  }
}
