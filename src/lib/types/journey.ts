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
  status: 'not_started' | 'in_progress' | 'done'
  row_index: number
  sort_order: number
  custom_fields: Record<string, any>
  created_at: string
  updated_at: string
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

export const STATUS_CONFIG = {
  not_started: { label: 'Not Started', color: '#9CA3AF', bg: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#F59E0B', bg: '#FEF3C7' },
  done: { label: 'Done', color: '#10B981', bg: '#D1FAE5' },
} as const
