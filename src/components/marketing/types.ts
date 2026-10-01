// Shapes returned by GET /api/marketing/overview.
import type { SourceStatus } from '@/lib/marketing/ui-logic'
export interface FunnelCampaign {
  id: string; org_id: string; name: string; description: string | null
  status: 'draft' | 'active' | 'paused' | 'archived'
  entry_pipeline_id: string | null; entry_stage_id: string | null; goal_stage_id: string | null
  sequence_id: string | null; live_enabled: boolean; live_enabled_at: string | null
  planning_campaign_id: string | null; created_at: string
}
export interface Pipeline { id: string; name: string; legacy_key: string; position: number; archived_at: string | null }
export interface Stage { id: string; pipeline_id: string; name: string; position: number; color: string | null; archived_at: string | null }
export interface Step {
  id?: string; sequence_id?: string; step_order?: number
  channel: 'email' | 'sms' | 'wait'; delay_minutes: number; subject: string | null; body: string | null
  kind: 'marketing' | 'service' | null; step_type: 'message' | 'deliver_asset'; asset_id: string | null
}
export interface Route { id: string; source_key: string; campaign_id: string; active: boolean; priority: number }
export interface Asset { id: string; title: string; description: string | null; path: string; active: boolean }
export interface FormDef {
  id: string; slug: string; name: string; status: 'draft' | 'published' | 'archived'; version: number
  fields: any[]; consents: any[]; source_key: string; success_message: string
}
export interface Flags { engine: boolean; gate_live_sends: boolean; provider_email: boolean; provider_sms: boolean; intake: boolean; deliver_asset: boolean; mirror_legacy_stage: boolean }
export interface Overview {
  campaigns: FunnelCampaign[]; pipelines: Pipeline[]; stages: Stage[]
  sequences: Array<{ id: string; name: string; campaign_id: string | null }>
  steps: Step[]; routes: Route[]
  enrollment_counts: Record<string, Record<string, number>>; stage_counts: Record<string, number>
  forms: FormDef[]; assets: Asset[]; test_contacts: Array<{ id: string; email: string | null; phone: string | null; label: string }>
  flags: Flags; policy: Record<string, any> | null; sender_problem: string | null; unsubscribe_ready: boolean; can_go_live: boolean
  sources?: SourceStatus
}
