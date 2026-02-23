export type RockStatus = 'on_track' | 'at_risk' | 'off_track' | 'complete'

export interface Rock {
  id: string
  org_id: string
  title: string
  description: string | null
  owner_id: string | null
  status: RockStatus
  quarter: string | null
  due_date: string | null
  color: string
  core_value: string | null
  created_at: string
  updated_at: string
  // Joined / computed fields
  owner_name?: string
  owner_initials?: string
  task_count?: number
  tasks_done?: number
}

export interface RockWithProgress extends Rock {
  progress_pct: number
  task_count: number
  tasks_done: number
}

export const ROCK_STATUS_CONFIG: Record<RockStatus, { label: string; color: string; bg: string }> = {
  on_track: { label: 'On Track', color: '#16A34A', bg: '#F0FDF4' },
  at_risk: { label: 'At Risk', color: '#EA580C', bg: '#FFF7ED' },
  off_track: { label: 'Off Track', color: '#DC2626', bg: '#FEF2F2' },
  complete: { label: 'Complete', color: '#16A34A', bg: '#F0FDF4' },
}

export const DEFAULT_ROCK_COLORS = [
  '#2A9D8F', '#7C3AED', '#C4704B', '#2563EB', '#D4A54A',
  '#E4405F', '#EA580C', '#16A34A', '#386797', '#F59E0B',
]
