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
  ChevronLeft, Plus, Sparkles, Clock, Loader2, Target,
  Brain, AlertTriangle, Check, ChevronDown, User, X, ArrowRight,
  Link2, Zap, Shield, ExternalLink
} from 'lucide-react'

/* ═══════════════════════════════════════════════
   RACI DISPLAY — compact row for task list
   ═══════════════════════════════════════════════ */
function RaciPills({ fields }: { fields: Record<string, any> }) {
  const roles = [
    { key: 'raci_responsible', label: 'R', color: '#2563EB' },
    { key: 'raci_accountable', label: 'A', color: '#DC2626' },
    { key: 'raci_consulted', label: 'C', color: '#D97706' },
    { key: 'raci_informed', label: 'I', color: '#6B7280' },
  ]
  const active = roles.filter(r => fields?.[r.key])
  if (active.length === 0) return null

  return (
    <div className="flex gap-0.5">
      {active.map(r => (
        <span key={r.key} className="text-[8px] font-bold w-3.5 h-3.5 rounded flex items-center justify-center text-white"
          style={{ background: r.color }} title={`${r.label}: ${fields[r.key]}`}>
          {r.label}
        </span>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   RACI ASSIGNMENT FORM — used in add task + edit
   ═══════════════════════════════════════════════ */
function RaciForm({ raci, teamMembers, onChange }: {
  raci: Record<string, string>
  teamMembers: { user_id: string | null; display_name: string }[]
  onChange: (raci: Record<string, string>) => void
}) {
  const roles = [
    { key: 'responsible', label: 'Responsible', hint: 'Does the work', color: '#2563EB' },
    { key: 'accountable', label: 'Accountable', hint: 'Owns the outcome', color: '#DC2626' },
    { key: 'consulted', label: 'Consulted', hint: 'Input sought', color: '#D97706' },
    { key: 'informed', label: 'Informed', hint: 'Kept updated', color: '#6B7280' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2">
      {roles.map(role => (
        <div key={role.key}>
          <label className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider mb-0.5">
            <span className="w-3 h-3 rounded text-[7px] font-bold text-white flex items-center justify-center"
              style={{ background: role.color }}>{role.label[0]}</span>
            <span style={{ color: role.color }}>{role.label}</span>
          </label>
          <select value={raci[role.key] || ''}
            onChange={e => onChange({ ...raci, [role.key]: e.target.value })}
            className="w-full text-[10px] border border-gray-200 rounded-md px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            <option value="">--</option>
            {teamMembers.filter(m => m.display_name).map(m => (
              <option key={m.user_id || m.display_name} value={m.display_name}>{m.display_name}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   AI ROCK ADVISOR PANEL
   ═══════════════════════════════════════════════ */
interface RockAnalysis {
  dependencies: Array<{ rock_title: string; rock_index: number; relationship: string; explanation: string }>
  risk_assessment: { level: string; factors: string[]; mitigation: string }
  recommended_tasks: Array<{
    title: string; priority: string
    raci: { responsible: string | null; accountable: string | null; consulted: string | null; informed: string | null }
    rationale: string
  }>
  insights: string
}

function AiAdvisorPanel({ analysis, loading, onAddTask, onSaveDeps, depsLoading, onClose }: {
  analysis: RockAnalysis | null; loading: boolean
  onAddTask: (title: string, priority: string, raci: Record<string, string | null>) => void
  onSaveDeps: (deps: RockAnalysis['dependencies']) => void
  depsLoading: boolean
  onClose: () => void
}) {
  if (loading) {
    return (
      <div className="bg-violet/5 border border-violet/20 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Loader2 size={14} className="animate-spin text-violet" />
          <span className="text-xs font-bold text-violet">AI Analyzing Rock...</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-violet/10 rounded animate-pulse" style={{ width: `${70 + i * 10}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (!analysis) return null

  const riskColors: Record<string, { bg: string; text: string }> = {
    low: { bg: '#D1FAE5', text: '#059669' },
    medium: { bg: '#FEF3C7', text: '#D97706' },
    high: { bg: '#FEE2E2', text: '#DC2626' },
  }
  const risk = riskColors[analysis.risk_assessment?.level] || riskColors.medium

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet" />
          <span className="text-xs font-bold text-np-dark">AI Rock Advisor</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={12} /></button>
      </div>

      <div className="p-5 space-y-4">
        {/* Insights */}
        <div className="bg-violet/5 border border-violet/10 rounded-lg p-3">
          <span className="text-[10px] font-bold text-violet uppercase tracking-wider">Strategic Insight</span>
          <p className="text-xs text-np-dark mt-1 leading-relaxed">{analysis.insights}</p>
        </div>

        {/* Risk Assessment */}
        <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: risk.bg + '40' }}>
          <AlertTriangle size={14} style={{ color: risk.text }} className="mt-0.5 shrink-0" />
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: risk.text }}>
              {analysis.risk_assessment.level} Risk
            </span>
            <ul className="mt-1 space-y-0.5">
              {analysis.risk_assessment.factors?.map((f, i) => (
                <li key={i} className="text-[11px] text-np-dark">• {f}</li>
              ))}
            </ul>
            {analysis.risk_assessment.mitigation && (
              <p className="text-[11px] text-gray-500 mt-1.5 italic">💡 {analysis.risk_assessment.mitigation}</p>
            )}
          </div>
        </div>

        {/* Dependencies — with Save button */}
        {analysis.dependencies?.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Link2 size={10} /> Dependencies
              </span>
              <button onClick={() => onSaveDeps(analysis.dependencies)} disabled={depsLoading}
                className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold text-teal bg-teal/5 hover:bg-teal/10 rounded border border-teal/20 disabled:opacity-50">
                {depsLoading ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                Save to Journey
              </button>
            </div>
            <div className="space-y-1">
              {analysis.dependencies.map((dep, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] p-2 bg-np-light rounded-lg">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    dep.relationship === 'blocks' ? 'bg-red-100 text-red-600' :
                    dep.relationship === 'depends_on' ? 'bg-amber-100 text-amber-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>{dep.relationship.replace('_', ' ').toUpperCase()}</span>
                  <span className="font-medium text-np-dark">{dep.rock_title}</span>
                  <span className="text-gray-400 flex-1 truncate">— {dep.explanation}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended Tasks with RACI */}
        {analysis.recommended_tasks?.length > 0 && (
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Zap size={10} /> Recommended Tasks (with RACI)
            </span>
            <div className="mt-1.5 space-y-1.5">
              {analysis.recommended_tasks.map((task, i) => (
                <div key={i} className="p-2.5 bg-np-light rounded-lg border border-gray-100">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-np-dark">{task.title}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{task.rationale}</div>
                    </div>
                    <PriorityBadge priority={task.priority} />
                    <button onClick={() => onAddTask(task.title, task.priority, task.raci as Record<string, string | null>)}
                      className="flex items-center gap-1 px-2 py-1 bg-np-blue text-white text-[10px] font-semibold rounded-md hover:bg-np-dark transition-colors shrink-0">
                      <Plus size={9} /> Add
                    </button>
                  </div>
                  {/* RACI preview */}
                  <div className="flex gap-3 mt-1.5 pt-1.5 border-t border-gray-100/70">
                    {[
                      { key: 'responsible', label: 'R', color: '#2563EB' },
                      { key: 'accountable', label: 'A', color: '#DC2626' },
                      { key: 'consulted', label: 'C', color: '#D97706' },
                      { key: 'informed', label: 'I', color: '#6B7280' },
                    ].map(r => task.raci?.[r.key as keyof typeof task.raci] ? (
                      <span key={r.key} className="text-[9px] flex items-center gap-0.5">
                        <span className="w-3 h-3 rounded text-[7px] font-bold text-white flex items-center justify-center"
                          style={{ background: r.color }}>{r.label}</span>
                        <span className="text-gray-500">{String(task.raci[r.key as keyof typeof task.raci]).split(' ')[0]}</span>
                      </span>
                    ) : null)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */
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
  const [newTaskPriority, setNewTaskPriority] = useState('medium')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskRaci, setNewTaskRaci] = useState<Record<string, string>>({})
  const [showRaci, setShowRaci] = useState(false)
  const [doneColumnIds, setDoneColumnIds] = useState<Set<string>>(new Set())
  const [defaultColumnId, setDefaultColumnId] = useState<string>('')

  // AI Advisor
  const [showAdvisor, setShowAdvisor] = useState(false)
  const [advisorLoading, setAdvisorLoading] = useState(false)
  const [analysis, setAnalysis] = useState<RockAnalysis | null>(null)
  const [depsLoading, setDepsLoading] = useState(false)

  // Owner editing
  const [editingOwner, setEditingOwner] = useState(false)

  // Task assignee editing
  const [editingTaskAssignee, setEditingTaskAssignee] = useState<string | null>(null)

  const rock = rocks.find(r => r.id === id)

  const loadTasks = useCallback(async () => {
    if (!id || !currentOrg) return
    setLoading(true)

    const { data: cols } = await supabase
      .from('kanban_columns')
      .select('id, title, sort_order')
      .eq('org_id', currentOrg.id)
      .order('sort_order')

    if (cols) {
      setDoneColumnIds(new Set(
        cols.filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')).map(c => c.id)
      ))
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

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = () => { setEditingOwner(false); setEditingTaskAssignee(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const getTaskStatus = (t: KanbanTask): 'done' | 'todo' => {
    return doneColumnIds.has(t.column_id) ? 'done' : 'todo'
  }

  const filteredTasks = tasks.filter(t => {
    const st = getTaskStatus(t)
    if (filter === 'remaining') return st !== 'done'
    if (filter === 'done') return st === 'done'
    return true
  })

  const handleAddTask = async (title?: string, priority?: string, raci?: Record<string, string | null>) => {
    const taskTitle = title || newTaskTitle.trim()
    const taskPriority = priority || newTaskPriority
    if (!taskTitle || !currentOrg || !defaultColumnId) return

    // Resolve assignee: use Responsible from RACI, or explicit assignee
    let assigneeId = newTaskAssignee || ''
    const raciData = raci || newTaskRaci
    if (!assigneeId && raciData.responsible) {
      const match = members.find(m =>
        m.display_name?.toLowerCase().includes(String(raciData.responsible).toLowerCase())
      )
      if (match) assigneeId = match.user_id || ''
    }

    // Build custom_fields with RACI
    const customFields: Record<string, any> = {}
    if (raciData.responsible) customFields.raci_responsible = raciData.responsible
    if (raciData.accountable) customFields.raci_accountable = raciData.accountable
    if (raciData.consulted) customFields.raci_consulted = raciData.consulted
    if (raciData.informed) customFields.raci_informed = raciData.informed

    setAddingTask(false)
    const { error } = await supabase.from('kanban_tasks').insert({
      org_id: currentOrg.id,
      column_id: defaultColumnId,
      title: taskTitle,
      rock_id: id,
      source: 'rock',
      priority: taskPriority,
      assignee: assigneeId || null,
      visibility: 'everyone',
      sort_order: tasks.length,
      custom_fields: Object.keys(customFields).length > 0 ? customFields : {},
    })
    if (!error) {
      setNewTaskTitle('')
      setNewTaskPriority('medium')
      setNewTaskAssignee('')
      setNewTaskRaci({})
      setShowRaci(false)
      loadTasks()
      refetchRocks()
    } else {
      console.error('Add task error:', error)
    }
  }

  const handleStatusChange = async (newStatus: RockStatus) => {
    if (!rock) return
    await updateRock(rock.id, { status: newStatus })
    refetchRocks()
  }

  const handleOwnerChange = async (newOwnerId: string) => {
    if (!rock) return
    await updateRock(rock.id, { owner_id: newOwnerId || null })
    refetchRocks()
    setEditingOwner(false)
  }

  const handleTaskAssigneeChange = async (taskId: string, assigneeId: string) => {
    await supabase.from('kanban_tasks').update({ assignee: assigneeId || null }).eq('id', taskId)
    loadTasks()
    setEditingTaskAssignee(null)
  }

  const saveDependencies = async (deps: RockAnalysis['dependencies']) => {
    if (!rock || !currentOrg) return
    setDepsLoading(true)
    try {
      // Match dependency rock titles to actual rock IDs
      for (const dep of deps) {
        const targetRock = rocks.find(r =>
          r.title.toLowerCase() === dep.rock_title.toLowerCase() && r.id !== rock.id
        )
        if (!targetRock) continue

        await supabase.from('rock_dependencies').upsert({
          org_id: currentOrg.id,
          source_rock_id: rock.id,
          target_rock_id: targetRock.id,
          relationship: dep.relationship,
          notes: dep.explanation,
        }, { onConflict: 'source_rock_id,target_rock_id' })
      }
    } catch (e) {
      console.error('Save deps error:', e)
    }
    setDepsLoading(false)
  }

  const runAiAdvisor = async () => {
    if (!rock) return
    setShowAdvisor(true)
    setAdvisorLoading(true)
    try {
      const taskData = tasks.map(t => ({
        title: t.title,
        priority: t.priority,
        done: doneColumnIds.has(t.column_id),
        assignee_name: members.find(m => m.user_id === t.assignee)?.display_name || null,
      }))

      const res = await fetch('/api/ai/rock-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rock: {
            title: rock.title, description: rock.description, status: rock.status,
            owner_name: rock.owner_name, progress_pct: rock.progress_pct, due_date: rock.due_date,
          },
          allRocks: rocks.map(r => ({
            title: r.title, status: r.status, progress_pct: r.progress_pct, owner_name: r.owner_name,
          })),
          existingTasks: taskData,
          teamMembers: members.map(m => ({ display_name: m.display_name, job_title: m.job_title, role: m.role })),
        }),
      })
      const data = await res.json()
      if (data.analysis) setAnalysis(data.analysis)
    } catch (e) {
      console.error('AI advisor error:', e)
    }
    setAdvisorLoading(false)
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
          {/* Owner — clickable to change */}
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setEditingOwner(!editingOwner)}
              className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors">
              <Avatar initials={rock.owner_initials || '??'} size={22} color={rock.color} />
              <span className="text-xs text-np-dark">{rock.owner_name || 'Unassigned'}</span>
              <ChevronDown size={10} className="text-gray-400" />
            </button>
            {editingOwner && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-20 py-1 min-w-[180px]">
                <button onClick={() => handleOwnerChange('')}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Unassigned</button>
                {members.filter(m => m.user_id).map(m => (
                  <button key={m.user_id} onClick={() => handleOwnerChange(m.user_id as string)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${
                      rock.owner_id === m.user_id ? 'text-np-blue font-semibold bg-np-blue/5' : 'text-np-dark'
                    }`}>
                    <Avatar initials={m.display_name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()} size={18} />
                    {m.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-[11px] text-gray-400">
            Due: {rock.due_date ? new Date(rock.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date'}
          </span>
          <span className="text-xs font-bold text-np-dark">{rock.progress_pct}%</span>

          <button onClick={runAiAdvisor}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-violet bg-violet/5 hover:bg-violet/10 rounded-lg border border-violet/20 transition-colors">
            <Brain size={11} /> AI Advisor
          </button>
        </div>

        <ProgressBar pct={rock.progress_pct} height={10} />
        {rock.description && <p className="text-xs text-gray-500 mt-3 leading-relaxed">{rock.description}</p>}
      </div>

      {/* AI Advisor Panel */}
      {showAdvisor && (
        <AiAdvisorPanel
          analysis={analysis}
          loading={advisorLoading}
          onAddTask={(title, priority, raci) => handleAddTask(title, priority, raci)}
          onSaveDeps={saveDependencies}
          depsLoading={depsLoading}
          onClose={() => { setShowAdvisor(false); setAnalysis(null) }}
        />
      )}

      {/* Tasks section */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-np-dark">Tasks ({tasks.length})</span>
          <div className="flex gap-1.5">
            <button onClick={() => router.push('/tasks')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
              <ExternalLink size={10} /> Open Task Manager
            </button>
            <button onClick={() => { setNewTaskTitle(''); setNewTaskPriority('medium'); setNewTaskAssignee(''); setNewTaskRaci({}); setShowRaci(false); setAddingTask(true) }}
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

        {/* Inline add task — with RACI */}
        {addingTask && (
          <div className="mb-3 p-3 bg-np-light rounded-lg border border-gray-100 space-y-2">
            <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAddTask(); if (e.key === 'Escape') setAddingTask(false) }}
              autoFocus placeholder="Task title..."
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            <div className="flex items-center gap-2">
              <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value)}
                className="px-2 py-1.5 text-[10px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
                className="px-2 py-1.5 text-[10px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30 flex-1">
                <option value="">Assign to...</option>
                {members.filter(m => m.user_id).map(m => (
                  <option key={m.user_id} value={m.user_id!}>{m.display_name}</option>
                ))}
              </select>
              <button onClick={() => setShowRaci(!showRaci)}
                className={`px-2 py-1.5 text-[10px] font-semibold rounded-md border transition-colors ${
                  showRaci ? 'bg-violet/10 text-violet border-violet/30' : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}>
                RACI
              </button>
              <button onClick={() => handleAddTask()} disabled={!newTaskTitle.trim()}
                className="px-3 py-1.5 bg-np-blue text-white text-[10px] font-semibold rounded-md disabled:opacity-50 hover:bg-np-dark transition-colors">
                Add
              </button>
              <button onClick={() => setAddingTask(false)} className="px-2 py-1.5 text-[10px] text-gray-400">Cancel</button>
            </div>
            {showRaci && (
              <div className="pt-2 border-t border-gray-200">
                <RaciForm raci={newTaskRaci} teamMembers={members} onChange={setNewTaskRaci} />
              </div>
            )}
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
              <div key={t.id} className="flex items-center gap-2 py-2 border-b border-gray-100/70 last:border-0 group">
                <span className="text-sm font-semibold w-5 text-center" style={{ color: statusColor }}>{statusIcon}</span>

                {/* Task title — click to open in Task Manager */}
                <button onClick={() => router.push(`/tasks?task=${t.id}`)}
                  className={`text-xs text-left flex-1 hover:text-np-blue hover:underline transition-colors ${
                    st === 'done' ? 'text-gray-400 line-through' : 'text-np-dark'
                  }`}>
                  {t.title}
                </button>

                {/* RACI pills */}
                <RaciPills fields={t.custom_fields} />

                <PriorityBadge priority={t.priority} />

                {/* Assignee — click to change */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setEditingTaskAssignee(editingTaskAssignee === t.id ? null : t.id)}
                    className="flex items-center gap-1 hover:bg-gray-50 rounded px-1 py-0.5 transition-colors">
                    {initials ? (
                      <Avatar initials={initials} size={20} />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <User size={9} className="text-gray-300" />
                      </div>
                    )}
                  </button>
                  {editingTaskAssignee === t.id && (
                    <div className="absolute top-full right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-20 py-1 min-w-[160px]">
                      <button onClick={() => handleTaskAssigneeChange(t.id, '')}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Unassigned</button>
                      {members.filter(m => m.user_id).map(m => (
                        <button key={m.user_id} onClick={() => handleTaskAssigneeChange(t.id, m.user_id as string)}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${
                            t.assignee === m.user_id ? 'text-np-blue font-semibold bg-np-blue/5' : 'text-np-dark'
                          }`}>
                          <Avatar initials={m.display_name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()} size={16} />
                          {m.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Open in Task Manager */}
                <button onClick={() => router.push(`/tasks?task=${t.id}`)}
                  title="Open in Task Manager"
                  className="text-gray-300 hover:text-np-blue opacity-0 group-hover:opacity-100 transition-all">
                  <ExternalLink size={11} />
                </button>

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
              {filter === 'all' ? 'No tasks linked to this rock. Add one above or use AI Advisor.' : `No ${filter} tasks.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
