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
