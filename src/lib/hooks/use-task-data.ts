'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type {
  KanbanColumn, KanbanTask, TaskComment, CardTaskLink,
  Subtask, TaskActivity, Project, SavedView, ViewFilters,
  ProjectProgress
} from '@/lib/types/tasks'

// Fields worth logging in the activity feed
const TRACKED_FIELDS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  assignee: 'Assignee',
  priority: 'Priority',
  due_date: 'Due date',
  column_id: 'Status',
  estimated_hours: 'Est. hours',
  actual_hours: 'Actual hours',
  raci_responsible: 'Responsible',
  raci_accountable: 'Accountable',
  visibility: 'Visibility',
  project_id: 'Project',
}

export function useTaskData() {
  const { currentOrg, user } = useWorkspace()
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const userId = user?.id || null
  const currentUserName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Unknown'

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [colRes, taskRes, projRes, viewRes] = await Promise.all([
      supabase.from('kanban_columns').select('*').eq('org_id', currentOrg.id).order('sort_order'),
      supabase.from('kanban_tasks').select('*').eq('org_id', currentOrg.id).order('sort_order'),
      supabase.from('projects').select('*').eq('org_id', currentOrg.id).order('name'),
      supabase.from('saved_views').select('*').eq('org_id', currentOrg.id).order('name'),
    ])

    if (colRes.data) setColumns(colRes.data)
    if (taskRes.data) setTasks(taskRes.data)
    if (projRes.data) setProjects(projRes.data)
    if (viewRes.data) setSavedViews(viewRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Activity Logging ─────────────────────────────────────
  const logActivity = async (
    taskId: string,
    action: string,
    field?: string,
    oldValue?: string | null,
    newValue?: string | null
  ) => {
    if (!currentOrg) return
    await supabase.from('task_activity').insert({
      task_id: taskId,
      org_id: currentOrg.id,
      user_id: userId || null,
      user_name: currentUserName,
      action,
      field: field || null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
    })
  }

  const fetchActivity = async (taskId: string): Promise<TaskActivity[]> => {
    const { data } = await supabase
      .from('task_activity')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(50)
    return data || []
  }

  // ─── Columns ──────────────────────────────────────────────
  const addColumn = async (title: string, color: string) => {
    if (!currentOrg) return
    const maxOrder = columns.length > 0 ? Math.max(...columns.map(c => c.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('kanban_columns')
      .insert({ org_id: currentOrg.id, title, color, sort_order: maxOrder })
      .select().single()
    if (data && !error) setColumns(prev => [...prev, data])
    return { data, error }
  }

  const updateColumn = async (id: string, updates: Partial<KanbanColumn>) => {
    const { data, error } = await supabase
      .from('kanban_columns').update(updates).eq('id', id).select().single()
    if (data && !error) setColumns(prev => prev.map(c => c.id === id ? data : c))
    return { data, error }
  }

  const deleteColumn = async (id: string) => {
    const { error } = await supabase.from('kanban_columns').delete().eq('id', id)
    if (!error) {
      setColumns(prev => prev.filter(c => c.id !== id))
      setTasks(prev => prev.filter(t => t.column_id !== id))
    }
    return { error }
  }

  // ─── Tasks ────────────────────────────────────────────────
  const addTask = async (columnId: string, title: string, extraFields?: Partial<KanbanTask>) => {
    if (!currentOrg) return
    const colTasks = tasks.filter(t => t.column_id === columnId)
    const maxOrder = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('kanban_tasks')
      .insert({
        org_id: currentOrg.id,
        column_id: columnId,
        title,
        sort_order: maxOrder,
        owner_id: userId,
        created_by: userId,
        ...extraFields,
      })
      .select().single()
    if (data && !error) {
      setTasks(prev => [...prev, data])
      logActivity(data.id, 'created')
      if (extraFields?.assignee) {
        logActivity(data.id, 'field_change', 'assignee', undefined, extraFields.assignee)
      }
      if (extraFields?.visibility === 'private') {
        logActivity(data.id, 'field_change', 'Visibility', undefined, 'private')
      }
      if (extraFields?.project_id) {
        const proj = projects.find(p => p.id === extraFields.project_id)
        logActivity(data.id, 'field_change', 'Project', undefined, proj?.name || 'Project')
      }
    }
    return { data, error }
  }

  const updateTask = async (id: string, updates: Partial<KanbanTask>) => {
    const existing = tasks.find(t => t.id === id)

    const { data, error } = await supabase
      .from('kanban_tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data && !error) {
      setTasks(prev => prev.map(t => t.id === id ? data : t))

      // Auto-log tracked field changes
      if (existing) {
        for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
          if (field in updates) {
            const oldVal = (existing as any)[field]
            const newVal = (updates as any)[field]
            const oldStr = oldVal != null ? String(oldVal) : null
            const newStr = newVal != null ? String(newVal) : null
            if (oldStr !== newStr) {
              let displayOld = oldStr
              let displayNew = newStr
              if (field === 'column_id') {
                displayOld = columns.find(c => c.id === oldStr)?.title || oldStr
                displayNew = columns.find(c => c.id === newStr)?.title || newStr
              }
              if (field === 'project_id') {
                displayOld = oldStr ? (projects.find(p => p.id === oldStr)?.name || oldStr) : 'None'
                displayNew = newStr ? (projects.find(p => p.id === newStr)?.name || newStr) : 'None'
              }
              logActivity(id, 'field_change', label, displayOld, displayNew)
            }
          }
        }
      }
      // Auto-update linked journey cards when task moves to Done
      if (updates.column_id && data) {
        const doneCol = columns.find(c => c.title.toLowerCase() === 'done')
        if (updates.column_id === doneCol?.id) {
          try {
            const links = await fetchCardLinks(id)
            for (const link of links) {
              const { data: allCardLinks } = await supabase
                .from('card_task_links').select('task_id').eq('card_id', link.card_id)
              if (allCardLinks) {
                const allDone = allCardLinks.every(cl => {
                  if (cl.task_id === id) return true
                  const t = tasks.find(x => x.id === cl.task_id)
                  return t?.column_id === doneCol.id
                })
                if (allDone) {
                  await supabase.from('journey_cards')
                    .update({ status: 'done', updated_at: new Date().toISOString() })
                    .eq('id', link.card_id)
                }
              }
            }
          } catch {} // non-blocking
        }
      }
    }
    return { data, error }
  }

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('kanban_tasks').delete().eq('id', id)
    if (!error) setTasks(prev => prev.filter(t => t.id !== id))
    return { error }
  }

  const moveTask = async (taskId: string, newColumnId: string, newSortOrder: number) => {
    return updateTask(taskId, { column_id: newColumnId, sort_order: newSortOrder } as any)
  }

  // ─── Subtasks ─────────────────────────────────────────────
  const fetchSubtasks = async (taskId: string): Promise<Subtask[]> => {
    const { data } = await supabase
      .from('subtasks')
      .select('*')
      .eq('task_id', taskId)
      .order('sort_order')
    return data || []
  }

  const addSubtask = async (taskId: string, title: string) => {
    if (!currentOrg) return
    const existing = await fetchSubtasks(taskId)
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('subtasks')
      .insert({
        task_id: taskId,
        org_id: currentOrg.id,
        title,
        sort_order: maxOrder,
      })
      .select().single()
    if (data && !error) {
      logActivity(taskId, 'subtask_added', undefined, undefined, title)
    }
    return { data, error }
  }

  const updateSubtask = async (id: string, updates: Partial<Subtask>, taskId?: string) => {
    const { data, error } = await supabase
      .from('subtasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()
    if (data && !error && taskId && 'completed' in updates) {
      logActivity(taskId, updates.completed ? 'subtask_completed' : 'subtask_uncompleted', undefined, undefined, data.title)
    }
    return { data, error }
  }

  const deleteSubtask = async (id: string, taskId?: string, title?: string) => {
    const { error } = await supabase.from('subtasks').delete().eq('id', id)
    if (!error && taskId) {
      logActivity(taskId, 'subtask_removed', undefined, title || undefined, undefined)
    }
    return { error }
  }

  // ─── Comments ─────────────────────────────────────────────
  const fetchComments = async (taskId: string): Promise<TaskComment[]> => {
    const { data } = await supabase
      .from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true })
    return data || []
  }

  const addComment = async (taskId: string, author: string, content: string) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ task_id: taskId, org_id: currentOrg.id, author, content })
      .select().single()
    if (data && !error) {
      logActivity(taskId, 'comment_added', undefined, undefined, author)
    }
    return { data, error }
  }

  // ─── Card-Task Links ──────────────────────────────────────
  const fetchCardLinks = async (taskId: string): Promise<CardTaskLink[]> => {
    const { data } = await supabase
      .from('card_task_links').select('*').eq('task_id', taskId)
    return data || []
  }

  const linkCardToTask = async (cardId: string, taskId: string) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('card_task_links')
      .insert({ org_id: currentOrg.id, card_id: cardId, task_id: taskId })
      .select().single()
    return { data, error }
  }

  const unlinkCardFromTask = async (linkId: string) => {
    const { error } = await supabase.from('card_task_links').delete().eq('id', linkId)
    return { error }
  }

  // ─── Projects (Phase 2) ───────────────────────────────────
  const addProject = async (name: string, extras?: Partial<Project>) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('projects')
      .insert({
        org_id: currentOrg.id,
        name,
        owner_id: userId,
        owner_name: currentUserName,
        ...extras,
      })
      .select().single()
    if (data && !error) setProjects(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return { data, error }
  }

  const updateProject = async (id: string, updates: Partial<Project>) => {
    const { data, error } = await supabase
      .from('projects')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data && !error) setProjects(prev => prev.map(p => p.id === id ? data : p))
    return { data, error }
  }

  const deleteProject = async (id: string) => {
    // Unlink tasks from this project first (set project_id to null)
    await supabase.from('kanban_tasks').update({ project_id: null }).eq('project_id', id)
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (!error) {
      setProjects(prev => prev.filter(p => p.id !== id))
      setTasks(prev => prev.map(t => t.project_id === id ? { ...t, project_id: null } : t))
    }
    return { error }
  }

  // ─── Saved Views (Phase 2) ────────────────────────────────
  const addSavedView = async (name: string, filters: ViewFilters, shared?: boolean) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('saved_views')
      .insert({
        org_id: currentOrg.id,
        user_id: userId,
        name,
        filters_json: filters,
        shared: shared || false,
      })
      .select().single()
    if (data && !error) setSavedViews(prev => [...prev, data])
    return { data, error }
  }

  const updateSavedView = async (id: string, updates: Partial<SavedView>) => {
    const { data, error } = await supabase
      .from('saved_views')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data && !error) setSavedViews(prev => prev.map(v => v.id === id ? data : v))
    return { data, error }
  }

  const deleteSavedView = async (id: string) => {
    const { error } = await supabase.from('saved_views').delete().eq('id', id)
    if (!error) setSavedViews(prev => prev.filter(v => v.id !== id))
    return { error }
  }

  // ─── Filter Helper ────────────────────────────────────────
  const filterTasks = (allTasks: KanbanTask[], filters: ViewFilters): KanbanTask[] => {
    return allTasks.filter(t => {
      if (filters.project_id && t.project_id !== filters.project_id) return false
      if (filters.project_id === null && t.project_id !== null) return false // "No Project" filter
      if (filters.assignee && t.assignee !== filters.assignee) return false
      if (filters.priority && t.priority !== filters.priority) return false
      if (filters.search) {
        const s = filters.search.toLowerCase()
        const match = t.title.toLowerCase().includes(s)
          || t.description?.toLowerCase().includes(s)
          || t.assignee?.toLowerCase().includes(s)
          || t.rock_tags?.some(tag => tag.toLowerCase().includes(s))
        if (!match) return false
      }
      if (filters.due_date_from && t.due_date && t.due_date < filters.due_date_from) return false
      if (filters.due_date_to && t.due_date && t.due_date > filters.due_date_to) return false
      if (filters.tags && filters.tags.length > 0) {
        if (!t.rock_tags?.some(tag => filters.tags!.includes(tag))) return false
      }
      return true
    })
  }

  // ─── Project Progress ─────────────────────────────────────
  const getProjectProgress = useCallback((projectId: string): ProjectProgress => {
    const projectTasks = tasks.filter(t => t.project_id === projectId)
    const doneColumn = columns.find(c => c.title.toLowerCase() === 'done')
    const completed = doneColumn
      ? projectTasks.filter(t => t.column_id === doneColumn.id).length
      : 0
    return {
      project_id: projectId,
      total_tasks: projectTasks.length,
      completed_tasks: completed,
      percentage: projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0,
    }
  }, [tasks, columns])

  const getAllProjectProgress = useCallback((): Record<string, ProjectProgress> => {
    const map: Record<string, ProjectProgress> = {}
    for (const p of projects) {
      map[p.id] = getProjectProgress(p.id)
    }
    return map
  }, [projects, getProjectProgress])

  // ─── ShipIt → Project Creation ──────────────────────────────
  const createProjectFromShipIt = async (
    shipitId: string,
    name: string,
    description: string | null,
    shipDate: string | null,
    sectionData: Record<string, string>
  ): Promise<{ projectId: string | null; tasksCreated: number }> => {
    if (!currentOrg) return { projectId: null, tasksCreated: 0 }

    // 1. Create project
    const projResult = await addProject(name, { description, status: 'active', color: '#3B82F6' })
    const projectId = projResult?.data?.id
    if (!projectId) return { projectId: null, tasksCreated: 0 }

    // 2. Bidirectional link
    await supabase.from('shipit_projects').update({ project_id: projectId }).eq('id', shipitId)
    await supabase.from('projects').update({ shipit_project_id: shipitId }).eq('id', projectId)
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, shipit_project_id: shipitId } : p))

    // 3. Find target column
    const targetColumn = columns.find(c => c.title.toLowerCase() === 'to do') || columns[0]
    if (!targetColumn) return { projectId, tasksCreated: 0 }

    let tasksCreated = 0

    // 4. Parse milestones from "The Actual Work" section
    const milestones = sectionData['milestones'] || ''
    const milestoneLines = milestones.split('\n')
      .map(l => l.replace(/^\d+[\.\)\-]\s*/, '').trim())
      .filter(l => l.length > 0)
    for (const title of milestoneLines) {
      await addTask(targetColumn.id, title, {
        project_id: projectId,
        milestone: true,
        due_date: shipDate,
        source: 'shipit',
      } as Partial<KanbanTask>)
      tasksCreated++
    }

    // 5. Parse blockers
    for (const field of ['waiting', 'missing', 'one-blocker']) {
      const text = sectionData[field]?.trim()
      if (!text) continue
      const lines = text.split('\n').map(l => l.replace(/^[\-\*]\s*/, '').trim()).filter(l => l.length > 0)
      for (const title of lines) {
        await addTask(targetColumn.id, `[Blocker] ${title}`, {
          project_id: projectId,
          priority: 'high',
          source: 'shipit',
        } as Partial<KanbanTask>)
        tasksCreated++
      }
    }

    // 6. Parse 30-minute action if present
    const quickAction = sectionData['thirty-min']?.trim()
    if (quickAction) {
      await addTask(targetColumn.id, quickAction, {
        project_id: projectId,
        priority: 'urgent',
        source: 'shipit',
      } as Partial<KanbanTask>)
      tasksCreated++
    }

    return { projectId, tasksCreated }
  }

  return {
    columns, tasks, projects, savedViews, loading,
    userId,
    currentUserName,
    refresh: fetchData,
    addColumn, updateColumn, deleteColumn,
    addTask, updateTask, deleteTask, moveTask,
    fetchSubtasks, addSubtask, updateSubtask, deleteSubtask,
    fetchActivity, logActivity,
    fetchComments, addComment,
    fetchCardLinks, linkCardToTask, unlinkCardFromTask,
    // Phase 2
    addProject, updateProject, deleteProject,
    addSavedView, updateSavedView, deleteSavedView,
    filterTasks,
    // Project integration
    getProjectProgress, getAllProjectProgress, createProjectFromShipIt,
  }
}
