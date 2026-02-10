'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { KanbanColumn, KanbanTask, TaskComment, CardTaskLink } from '@/lib/types/tasks'

export function useTaskData() {
  const { currentOrg } = useWorkspace()
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [colRes, taskRes] = await Promise.all([
      supabase.from('kanban_columns').select('*').eq('org_id', currentOrg.id).order('sort_order'),
      supabase.from('kanban_tasks').select('*').eq('org_id', currentOrg.id).order('sort_order'),
    ])

    if (colRes.data) setColumns(colRes.data)
    if (taskRes.data) setTasks(taskRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  // Columns
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

  // Tasks
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
        ...extraFields,
      })
      .select().single()
    if (data && !error) setTasks(prev => [...prev, data])
    return { data, error }
  }

  const updateTask = async (id: string, updates: Partial<KanbanTask>) => {
    const { data, error } = await supabase
      .from('kanban_tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data && !error) setTasks(prev => prev.map(t => t.id === id ? data : t))
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

  // Comments
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
    return { data, error }
  }

  // Card-Task Links
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

  return {
    columns, tasks, loading,
    refresh: fetchData,
    addColumn, updateColumn, deleteColumn,
    addTask, updateTask, deleteTask, moveTask,
    fetchComments, addComment,
    fetchCardLinks, linkCardToTask, unlinkCardFromTask,
  }
}
