'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, ProgressBar, BadgePill, Avatar, PriorityBadge } from '@/components/shared/meeting-rock-ui'
import { ROCK_STATUS_CONFIG, DEFAULT_ROCK_COLORS } from '@/lib/types/rocks'
import type { Rock, RockStatus } from '@/lib/types/rocks'
import { createClient } from '@/lib/supabase-browser'
import type { KanbanTask } from '@/lib/types/tasks'
import {
  Plus, ChevronRight, ArrowRight, Target, X, Loader2
} from 'lucide-react'

export default function RocksPage() {
  const { currentOrg } = useWorkspace()
  const { rocks, loading, addRock, fetchData } = useRockData()
  const { members } = useTeamData()
  const router = useRouter()
  const supabase = createClient()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<KanbanTask[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', owner_id: '', quarter: 'Q1 2026',
    due_date: '', color: DEFAULT_ROCK_COLORS[0],
  })
  // Track done column IDs for task status display
  const [doneColumnIds, setDoneColumnIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentOrg) return
    supabase.from('kanban_columns').select('id, title').eq('org_id', currentOrg.id)
      .then(({ data }) => {
        if (data) setDoneColumnIds(new Set(
          data.filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')).map(c => c.id)
        ))
      })
  }, [currentOrg?.id])

  const toggleExpand = async (rockId: string) => {
    if (expandedId === rockId) {
      setExpandedId(null)
      setExpandedTasks([])
      return
    }
    setExpandedId(rockId)
    const { data } = await supabase
      .from('kanban_tasks')
      .select('*')
      .eq('rock_id', rockId)
      .order('sort_order')
    setExpandedTasks(data || [])
  }

  const handleCreate = async () => {
    if (!form.title.trim()) return
    setCreating(true)
    try {
      await addRock({
        title: form.title.trim(),
        description: form.description || null,
        owner_id: form.owner_id || null,
        quarter: form.quarter || null,
        due_date: form.due_date || null,
        color: form.color,
        status: 'on_track',
      })
      setShowCreate(false)
      setForm({ title: '', description: '', owner_id: '', quarter: 'Q1 2026', due_date: '', color: DEFAULT_ROCK_COLORS[0] })
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  const getTaskStatus = (t: KanbanTask) => {
    if (doneColumnIds.has(t.column_id)) return 'done'
    return 'active'
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Quarterly Rocks</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {rocks[0]?.quarter || 'Q1 2026'} · {rocks.length} rock{rocks.length !== 1 ? 's' : ''} · {currentOrg?.name}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors">
          <Plus size={13} /> New Rock
        </button>
      </div>

      {/* Rock list */}
      {rocks.length > 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {rocks.map(r => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id}>
                {/* Rock row */}
                <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/70 cursor-pointer transition-colors ${isExpanded ? 'bg-np-light' : 'hover:bg-gray-50/50'}`}>
                  <button onClick={() => toggleExpand(r.id)} className="p-0 bg-transparent border-none cursor-pointer">
                    <ChevronRight size={13} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <StatusDot status={r.status} />
                  <span onClick={() => router.push(`/rocks/${r.id}`)}
                    className="text-xs font-semibold text-np-dark truncate cursor-pointer hover:text-np-blue transition-colors"
                    style={{ flex: '0 0 180px' }}>
                    {r.title}
                  </span>
                  <Avatar initials={r.owner_initials || '??'} size={22} color={r.color} />
                  <div className="flex-1 flex items-center gap-2">
                    <ProgressBar pct={r.progress_pct} />
                    <span className="text-[11px] font-bold text-np-dark w-8 text-right">{r.progress_pct}%</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{r.tasks_done}/{r.task_count}</span>
                  <span className="text-[10px] text-gray-400">{r.due_date ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}</span>
                </div>

                {/* Expanded task preview */}
                {isExpanded && (
                  <div className="bg-np-light px-4 py-2 pl-12 border-b border-gray-100">
                    {expandedTasks.length === 0 && (
                      <p className="text-[11px] text-gray-400 py-2">No tasks linked to this rock yet.</p>
                    )}
                    {expandedTasks.slice(0, 4).map(t => {
                      const st = getTaskStatus(t)
                      return (
                        <div key={t.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <span className="font-semibold" style={{ color: st === 'done' ? '#16A34A' : '#2A9D8F' }}>
                            {st === 'done' ? '✓' : '◐'}
                          </span>
                          <span className={`flex-1 ${st === 'done' ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                            {t.title}
                          </span>
                          <PriorityBadge priority={t.priority} />
                        </div>
                      )
                    })}
                    {expandedTasks.length > 4 && (
                      <button onClick={() => router.push(`/rocks/${r.id}`)}
                        className="text-[10px] text-np-blue font-semibold flex items-center gap-1 mt-1 bg-transparent border-none cursor-pointer hover:text-np-dark">
                        View all {expandedTasks.length} tasks <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-16">
          <Target size={40} className="mx-auto text-gray-200 mb-3" />
          <h2 className="text-sm font-semibold text-np-dark">No rocks yet</h2>
          <p className="text-xs text-gray-400 mt-1">Create your first quarterly rock to start tracking progress.</p>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">New Rock</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Rock Title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Charlotte Location Launch"
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>

              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What does success look like?"
                  rows={2}
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Owner</label>
                  <select value={form.owner_id} onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.user_id || m.id} value={m.user_id || ''}>{m.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Quarter</label>
                  <select value={form.quarter} onChange={e => setForm(p => ({ ...p, quarter: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                    {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'].map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Color</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {DEFAULT_ROCK_COLORS.slice(0, 5).map(c => (
                      <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                        className="w-6 h-6 rounded-full transition-transform"
                        style={{
                          background: c,
                          border: form.color === c ? '2px solid #3E3E3E' : '2px solid transparent',
                          transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                        }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title.trim() || creating}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors disabled:opacity-50">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Target size={12} />}
                Create Rock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
