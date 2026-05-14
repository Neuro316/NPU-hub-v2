export interface JourneyPhase {
  id: string
  org_id: string
  phase_key: string
  label: string
  color: string
  sort_order: number
}

export interface JourneyCard {
  id: string
  org_id: string
  phase_id: string
  title: string
  description: string
  status: string
  row_index: number
  sort_order: number
  custom_fields: Record<string, any>
  created_at: string
  updated_at: string
  position_x?: number
  position_y?: number
  // Campaign extensions
  campaign_id?: string | null
  campaign_phase?: string | null
  checklist?: ChecklistItem[]
  testers?: Tester[]
  asset_urls?: Record<string, string>
  tracking_ids?: Record<string, string>
}

export interface JourneyConnection {
  id: string
  org_id: string
  source_card_id: string
  target_card_id: string
  label?: string
  connection_type: 'flow' | 'convergence' | 'branch'
}

export interface JourneyCardAsset {
  id: string
  card_id: string
  org_id: string
  name: string
  asset_type: string
  url: string | null
  notes: string | null
  sort_order: number
}

export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: '#9CA3AF', bg: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#F59E0B', bg: '#FEF3C7' },
  done: { label: 'Done', color: '#10B981', bg: '#D1FAE5' },
  review: { label: 'Review', color: '#3b82f6', bg: '#DBEAFE' },
  approved: { label: 'Approved', color: '#10B981', bg: '#D1FAE5' },
  live: { label: 'Live', color: '#10B981', bg: '#D1FAE5' },
}

// Campaign phase card extensions
export interface CampaignPhase {
  id: string
  name: string
  color: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Tester {
  name: string
  signedOff: boolean
}

export type CardStatus = 'not_started' | 'in_progress' | 'review' | 'approved' | 'live' | 'done'

export const CARD_STATUS_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  not_started: { label: 'Not Started', color: '#64748b', emoji: '⬜' },
  in_progress: { label: 'In Progress', color: '#FBBF24', emoji: '🟡' },
  review: { label: 'Review', color: '#3b82f6', emoji: '🔵' },
  approved: { label: 'Approved', color: '#10b981', emoji: '✅' },
  live: { label: 'Live', color: '#10b981', emoji: '🟢' },
  done: { label: 'Done', color: '#10b981', emoji: '✅' },
}

export const DEFAULT_CAMPAIGN_PHASES: CampaignPhase[] = [
  { id: 'ideation', name: 'Ideation', color: '#8b5cf6' },
  { id: 'strategy', name: 'Strategy', color: '#3b82f6' },
  { id: 'creative', name: 'Creative', color: '#f59e0b' },
  { id: 'copy', name: 'Copy', color: '#10b981' },
  { id: 'landing', name: 'Landing Page', color: '#2A9D8F' },
  { id: 'tracking', name: 'Tracking', color: '#476B8E' },
  { id: 'build', name: 'Build', color: '#64748b' },
  { id: 'qa', name: 'QA / Test', color: '#e11d48' },
  { id: 'launch', name: 'Launch', color: '#EA580C' },
  { id: 'optimize', name: 'Optimize', color: '#FBBF24' },
  { id: 'report', name: 'Report', color: '#52B788' },
]

export const PHASE_COLORS: Record<string, string> = {
  awareness: '#8B5CF6',
  consideration: '#3B82F6',
  decision: '#10B981',
  onboarding: '#F59E0B',
  program: '#EF4444',
  outcomes: '#386797',
}
