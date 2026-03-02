export interface KanbanColumn {
  id: string
  org_id: string
  title: string
  color: string
  sort_order: number
}

export interface KanbanTask {
  id: string
  org_id: string
  column_id: string
  title: string
  description: string | null
  assignee: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date: string | null
  visibility: 'everyone' | 'private' | 'specific'
  sort_order: number
  custom_fields: Record<string, any>
  created_by: string | null
  rock_id: string | null
  source: string | null
  // New RACI columns
  raci_responsible: string | null
  raci_accountable: string | null
  raci_consulted: string[]
  raci_informed: string[]
  // New task intelligence columns
  rock_tags: string[]
  estimated_hours: number | null
  actual_hours: number | null
  depends_on: string[]
  blocked_by: string[]
  sequence_order: number | null
  milestone: boolean
  ai_generated: boolean
  approved_at: string | null
  approved_by: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TaskComment {
  id: string
  task_id: string
  org_id: string
  author: string
  content: string
  created_at: string
}

export interface CardTaskLink {
  id: string
  org_id: string
  card_id: string
  task_id: string
}

export const PRIORITY_CONFIG = {
  low: { label: 'Low', color: '#9CA3AF', bg: '#F3F4F6' },
  medium: { label: 'Medium', color: '#3B82F6', bg: '#DBEAFE' },
  high: { label: 'High', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'Urgent', color: '#EF4444', bg: '#FEE2E2' },
} as const
