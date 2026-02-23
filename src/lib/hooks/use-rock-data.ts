'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { Rock, RockWithProgress } from '@/lib/types/rocks'

export function useRockData() {
  const { currentOrg } = useWorkspace()
  const [rocks, setRocks] = useState<RockWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const { data: rockData } = await supabase
      .from('rocks')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false })

    if (rockData) {
      // Get task counts per rock
      const rockIds = rockData.map(r => r.id)
      let tasksByRock: Record<string, { total: number; done: number }> = {}

      if (rockIds.length > 0) {
        const { data: tasks } = await supabase
          .from('kanban_tasks')
          .select('rock_id, column_id')
          .in('rock_id', rockIds)

        // We need to know which columns are "done" — check column names
        const { data: columns } = await supabase
          .from('kanban_columns')
          .select('id, title')
          .eq('org_id', currentOrg.id)

        const doneColumnIds = new Set(
          (columns || [])
            .filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete'))
            .map(c => c.id)
        )

        ;(tasks || []).forEach(t => {
          if (!t.rock_id) return
          if (!tasksByRock[t.rock_id]) tasksByRock[t.rock_id] = { total: 0, done: 0 }
          tasksByRock[t.rock_id].total++
          if (doneColumnIds.has(t.column_id)) tasksByRock[t.rock_id].done++
        })
      }

      // Get owner names
      const ownerIds = Array.from(new Set(rockData.filter(r => r.owner_id).map(r => r.owner_id!)))
      let ownerMap: Record<string, { name: string; initials: string }> = {}

      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('team_profiles')
          .select('user_id, display_name')
          .in('user_id', ownerIds)

        ;(profiles || []).forEach(p => {
          const parts = (p.display_name || '').split(' ')
          ownerMap[p.user_id] = {
            name: p.display_name || 'Unassigned',
            initials: parts.map((w: string) => w[0] || '').join('').slice(0, 2).toUpperCase(),
          }
        })
      }

      setRocks(rockData.map(r => {
        const counts = tasksByRock[r.id] || { total: 0, done: 0 }
        const owner = r.owner_id ? ownerMap[r.owner_id] : null
        return {
          ...r,
          owner_name: owner?.name || 'Unassigned',
          owner_initials: owner?.initials || '??',
          task_count: counts.total,
          tasks_done: counts.done,
          progress_pct: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
        }
      }))
    }

    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const addRock = async (rock: Partial<Rock>) => {
    if (!currentOrg) return null
    const { data, error } = await supabase
      .from('rocks')
      .insert({ ...rock, org_id: currentOrg.id })
      .select()
      .single()

    if (error) { console.error('Create rock error:', error); return null }
    await fetchData()
    return data
  }

  const updateRock = async (id: string, updates: Partial<Rock>) => {
    const { error } = await supabase
      .from('rocks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) { console.error('Update rock error:', error); return }

    setRocks(prev => prev.map(r =>
      r.id === id ? { ...r, ...updates } as RockWithProgress : r
    ))
  }

  const deleteRock = async (id: string) => {
    // Unlink tasks first (set rock_id to null, don't delete them)
    await supabase.from('kanban_tasks').update({ rock_id: null }).eq('rock_id', id)
    const { error } = await supabase.from('rocks').delete().eq('id', id)
    if (error) { console.error('Delete rock error:', error); return }
    setRocks(prev => prev.filter(r => r.id !== id))
  }

  return { rocks, loading, fetchData, addRock, updateRock, deleteRock }
}
