'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, ProgressBar, BadgePill, Avatar, PriorityBadge } from '@/components/shared/meeting-rock-ui'
import { ROCK_STATUS_CONFIG } from '@/lib/types/rocks'
import type { RockStatus } from '@/lib/types/rocks'
import type { KanbanTask } from '@/lib/types/tasks'
import {
  ChevronLeft, Plus, Sparkles, Clock, Loader2, Target
} from 'lucide-react'

export default function RockDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { currentOrg } = useWorkspace()
  const { rocks, updateRock, fetchData: refetchRocks } = useRockData()
  const { members } = useTeamData()
  const supabase = createClient()

  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'remaining' | 'done'>('all')
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [doneColumnIds, setDoneColumnIds] = useState<Set<string>>(new Set())
  const [defaultColumnId, setDefaultColumnId] = useState<string>('')

  const rock = rocks.find(r => r.id === id)

  const loadTasks = useCallback(async () => {
    if (!id || !currentOrg) return
    setLoading(true)

    // Get columns for status mapping
    const { data: cols } = await supabase
      .from('kanban_columns')
      .select('id, title, sort_order')
      .eq('org_id', currentOrg.id)
      .order('sort_order')

    if (cols) {
      setDoneColumnIds(new Set(
        cols.filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')).map(c => c.id)
      ))
      // Default column = first column (usually "To Do")
      if (cols.length > 0) setDefaultColumnId(cols[0].id)
    }

    const { data } = await supabase
      .from('kanban_tasks')
      .select('*')
      .eq('rock_id', id)
      .order('sort_order')

    if (data) setTasks(data)
    setLoading(false)
  }, [id, currentOrg?.id])

  useEffect(() => { loadTasks() }, [loadTasks])

  const getTaskStatus = (t: KanbanTask): 'done' | 'in_progress' | 'todo' => {
    if (doneColumnIds.has(t.column_id)) return 'done'
    return 'todo'
  }

  const filteredTasks = tasks.filter(t => {
    const st = getTaskStatus(t)
    if (filter === 'remaining') return st !== 'done'
    if (filter === 'done') return st === 'done'
    return true
  })

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !currentOrg || !defaultColumnId) return
    setAddingTask(true)
    const { error } = await supabase.from('kanban_tasks').insert({
      org_id: currentOrg.id,
      column_id: defaultColumnId,
      title: newTaskTitle.trim(),
      rock_id: id,
      source: 'rock',
      priority: 'medium',
      visibility: 'everyone',
      sort_order: tasks.length,
    })
    if (!error) {
      setNewTaskTitle('')
      loadTasks()
      refetchRocks()
    } else {
      console.error('Add task error:', error)
    }
    setAddingTask(false)
  }

  const handleStatusChange = async (newStatus: RockStatus) => {
    if (!rock) return
    await updateRock(rock.id, { status: newStatus })
    refetchRocks()
  }

  if (!rock && !loading) {
    return (
      <div className="text-center py-16">
        <Target size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">Rock not found</p>
        <button onClick={() => router.push('/rocks')} className="text-xs text-np-blue mt-2">← Back to Rocks</button>
      </div>
    )
  }

  if (loading || !rock) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  }

  const statusCfg = ROCK_STATUS_CONFIG[rock.status as RockStatus] || ROCK_STATUS_CONFIG.on_track

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <button onClick={() => router.push('/rocks')}
        className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark transition-colors">
        <ChevronLeft size={14} /> Back to Rocks
      </button>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <StatusDot status={rock.status} />
          <h2 className="text-base font-bold text-np-dark flex-1">{rock.title}</h2>
          <select value={rock.status}
            onChange={e => handleStatusChange(e.target.value as RockStatus)}
            className="text-[10px] font-semibold px-2 py-1 rounded-lg border focus:outline-none focus:ring-1 focus:ring-teal/30"
            style={{ color: statusCfg.color, background: statusCfg.bg, borderColor: statusCfg.color + '40' }}>
            <option value="on_track">On Track</option>
            <option value="at_risk">At Risk</option>
            <option value="off_track">Off Track</option>
            <option value="complete">Complete</option>
          </select>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Avatar initials={rock.owner_initials || '??'} size={22} color={rock.color} />
            <span className="text-xs text-np-dark">{rock.owner_name}</span>
          </div>
          <span className="text-[11px] text-gray-400">
            Due: {rock.due_date ? new Date(rock.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date'}
          </span>
          <span className="text-xs font-bold text-np-dark">{rock.progress_pct}%</span>
        </div>

        {/* Progress bar */}
        <ProgressBar pct={rock.progress_pct} height={10} />

        {rock.description && (
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">{rock.description}</p>
        )}
      </div>

      {/* Tasks section */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-np-dark">Tasks ({tasks.length})</span>
          <div className="flex gap-1.5">
            <button onClick={() => { setAddingTask(false); setNewTaskTitle(''); setAddingTask(true) }}
              className="flex items-center gap-1 px-3 py-1.5 bg-np-blue text-white text-[11px] font-semibold rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={11} /> Add Task
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-3">
          {(['all', 'remaining', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
                filter === f ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {f === 'all' ? `All (${tasks.length})` : f === 'remaining' ? `Remaining (${tasks.filter(t => !doneColumnIds.has(t.column_id)).length})` : `Done (${tasks.filter(t => doneColumnIds.has(t.column_id)).length})`}
            </button>
          ))}
        </div>

        {/* Inline add task */}
        {addingTask && (
          <div className="flex items-center gap-2 mb-3 p-2 bg-np-light rounded-lg border border-gray-100">
            <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle('') } }}
              autoFocus placeholder="Task title..."
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            <button onClick={handleAddTask} disabled={!newTaskTitle.trim()}
              className="px-2.5 py-1.5 bg-np-blue text-white text-[10px] font-semibold rounded-md disabled:opacity-50">
              Add
            </button>
            <button onClick={() => { setAddingTask(false); setNewTaskTitle('') }}
              className="px-2 py-1.5 text-[10px] text-gray-400">Cancel</button>
          </div>
        )}

        {/* Task list */}
        <div>
          {filteredTasks.map(t => {
            const st = getTaskStatus(t)
            const statusIcon = st === 'done' ? '✓' : '○'
            const statusColor = st === 'done' ? '#16A34A' : '#9CA3AF'
            const assignee = members.find(m => m.user_id === t.assignee || m.id === t.assignee)
            const initials = assignee ? assignee.display_name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() : ''

            return (
              <div key={t.id} className="flex items-center gap-2 py-2 border-b border-gray-100/70 last:border-0">
                <span className="text-sm font-semibold w-5 text-center" style={{ color: statusColor }}>{statusIcon}</span>
                <span className={`text-xs flex-1 ${st === 'done' ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                  {t.title}
                </span>
                <PriorityBadge priority={t.priority} />
                {initials && <Avatar initials={initials} size={20} />}
                {t.due_date && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={9} />{new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            )
          })}
          {filteredTasks.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">
              {filter === 'all' ? 'No tasks linked to this rock. Add one above.' : `No ${filter} tasks.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
