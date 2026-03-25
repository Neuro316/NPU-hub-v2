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
  project_id: string | null       // Phase 2: project grouping
  title: string
  description: string | null
  assignee: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date: string | null
  visibility: 'everyone' | 'private' | 'specific'
  sort_order: number
  custom_fields: Record<string, any>
  created_by: string | null
  owner_id: string | null
  rock_id: string | null
  source: string | null
  // RACI columns
  raci_responsible: string | null
  raci_accountable: string | null
  raci_consulted: string[]
  raci_informed: string[]
  // Task intelligence columns
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

// Phase 1: Subtasks
export interface Subtask {
  id: string
  task_id: string
  org_id: string
  title: string
  completed: boolean
  sort_order: number
  assignee_id: string | null
  created_at: string
  updated_at: string
}

// Phase 1: Activity Feed
export interface TaskActivity {
  id: string
  task_id: string
  org_id: string
  user_id: string | null
  user_name: string | null
  action: string
  field: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
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

// Phase 2: Projects
export interface Project {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string
  icon: string
  status: 'active' | 'on_hold' | 'completed' | 'archived'
  owner_id: string | null
  owner_name: string | null
  shipit_project_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectProgress {
  project_id: string
  total_tasks: number
  completed_tasks: number
  percentage: number
}

export interface ProjectJourneyLink {
  id: string
  org_id: string
  project_id: string
  journey_phase_id: string
  created_at: string
}

// Phase 2: Saved Views
export interface SavedView {
  id: string
  org_id: string
  user_id: string | null
  name: string
  filters_json: ViewFilters
  view_type: 'kanban' | 'list' | 'timeline' | 'workload'
  sort_json: Record<string, any>
  shared: boolean
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface ViewFilters {
  project_id?: string | null
  assignee?: string | null
  priority?: string | null
  status?: string | null        // column title
  due_date_from?: string | null
  due_date_to?: string | null
  search?: string | null
  tags?: string[]
  show_completed?: boolean
}

export const PRIORITY_CONFIG = {
  low: { label: 'Low', color: '#9CA3AF', bg: '#F3F4F6' },
  medium: { label: 'Medium', color: '#3B82F6', bg: '#DBEAFE' },
  high: { label: 'High', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'Urgent', color: '#EF4444', bg: '#FEE2E2' },
} as const

export const PROJECT_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Orange', value: '#F59E0B' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Slate', value: '#64748B' },
  { name: 'Amber', value: '#D97706' },
] as const

export const PROJECT_STATUS_CONFIG = {
  active: { label: 'Active', color: '#10B981', bg: '#D1FAE5' },
  on_hold: { label: 'On Hold', color: '#F59E0B', bg: '#FEF3C7' },
  completed: { label: 'Completed', color: '#3B82F6', bg: '#DBEAFE' },
  archived: { label: 'Archived', color: '#9CA3AF', bg: '#F3F4F6' },
} as const
