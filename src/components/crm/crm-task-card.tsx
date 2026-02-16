'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Task Card — Matches hub TaskCard style + RACI + hub sync
// Import: { CrmTaskCard, CrmTaskDetail } from '@/components/crm/crm-task-card'
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Clock, MessageSquare, Link2, GripVertical, CheckSquare, Square, X, Plus, ExternalLink, Calendar, AlertCircle, Timer } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import type { CrmTask, TeamMember } from '@/types/crm'

type RaciRole = 'responsible' | 'accountable' | 'consulted' | 'informed'

interface ChecklistItem { id: string; text: string; done: boolean }

const RACI_CFG: Record<RaciRole, { short: string; color: string; bg: string }> = {
  responsible: { short: 'R', color: '#2A9D8F', bg: '#2A9D8F1a' },
  accountable: { short: 'A', color: '#386797', bg: '#3867971a' },
  consulted: { short: 'C', color: '#d97706', bg: '#d977061a' },
  informed: { short: 'I', color: '#9CA3AF', bg: '#9CA3AF1a' },
}

// ─── Compact Card (Kanban board) — matches hub task-card.tsx ───

export function CrmTaskCard({ task, teamMembers, onClick, onDragStart }: {
  task: CrmTask
  teamMembers: TeamMember[]
  onClick: () => void
  onDragStart?: (e: React.DragEvent) => void
}) {
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
  const checklist = (task.checklist as ChecklistItem[] | undefined) || []
  const labels = (task.labels as string[] | undefined) || []
  const checkDone = checklist.filter(c => c.done).length
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  const accountable = teamMembers.find(m => m.id === task.raci_accountable)
  const responsible = (task.raci_responsible || []).map(id => teamMembers.find(m => m.id === id)).filter(Boolean)

  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      className="bg-white rounded-lg border border-gray-100 p-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group">
      {/* Priority + Assignee */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: priority.bg, color: priority.color }}>
          {priority.label}
        </span>
        {/* RACI avatars */}
        <div className="flex -space-x-1.5">
          {accountable && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white"
              style={{ background: RACI_CFG.accountable.bg }}
              title={`A: ${accountable.display_name}`}>
              <span className="text-[7px] font-bold" style={{ color: RACI_CFG.accountable.color }}>
                {accountable.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            </div>
          )}
          {responsible.slice(0, 2).map(m => m && (
            <div key={m.id} className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white"
              style={{ background: RACI_CFG.responsible.bg }}
              title={`R: ${m.display_name}`}>
              <span className="text-[7px] font-bold" style={{ color: RACI_CFG.responsible.color }}>
                {m.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs font-semibold text-np-dark leading-snug mb-1.5">{task.title}</p>
      {task.description && <p className="text-[10px] text-gray-400 line-clamp-2 leading-snug mb-2">{task.description}</p>}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {labels.slice(0, 3).map(l => (
            <span key={l} className="px-1.5 py-0.5 bg-gray-50 text-[8px] font-medium text-gray-500 rounded">{l}</span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 text-[9px] text-gray-400">
        {task.due_date && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Clock className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {isOverdue && ' !'}
          </span>
        )}
        {checklist.length > 0 && (
          <span className={`flex items-center gap-0.5 ${checkDone === checklist.length ? 'text-green-500' : ''}`}>
            <CheckSquare className="w-3 h-3" /> {checkDone}/{checklist.length}
          </span>
        )}
        {task.estimated_minutes && (
          <span className="flex items-center gap-0.5"><Timer className="w-3 h-3" />{task.estimated_minutes}m</span>
        )}
        {task.hub_task_id && (
          <span className="flex items-center gap-0.5 text-gray-300"><ExternalLink className="w-3 h-3" /> Synced</span>
        )}
      </div>
    </div>
  )
}

// ─── Detail Modal — with full RACI matrix ───

export function CrmTaskDetail({ task, teamMembers, onUpdate, onClose }: {
  task: CrmTask
  teamMembers: TeamMember[]
  onUpdate: (id: string, updates: Partial<CrmTask>) => void
  onClose: () => void
}) {
  const supabase = createClient()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [pri, setPri] = useState(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [status, setStatus] = useState(task.status)
  const [checklist, setChecklist] = useState<ChecklistItem[]>((task.checklist as ChecklistItem[]) || [])
  const [labels, setLabels] = useState<string[]>((task.labels as string[]) || [])
  const [newCheck, setNewCheck] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [estMin, setEstMin] = useState(task.estimated_minutes || 0)
  const [actMin, setActMin] = useState(task.actual_minutes || 0)

  // RACI
  const [responsible, setResponsible] = useState<string[]>(task.raci_responsible || [])
  const [accountable, setAccountable] = useState<string | null>(task.raci_accountable || null)
  const [consulted, setConsulted] = useState<string[]>(task.raci_consulted || [])
  const [informed, setInformed] = useState<string[]>(task.raci_informed || [])

  async function save() {
    const updates: any = {
      title, description: description || null, priority: pri, status,
      due_date: dueDate || null, checklist, labels,
      estimated_minutes: estMin || null, actual_minutes: actMin || null,
      raci_responsible: responsible, raci_accountable: accountable,
      raci_consulted: consulted, raci_informed: informed,
    }
    const { error } = await supabase.from('tasks').update(updates).eq('id', task.id)
    if (!error) { onUpdate(task.id, updates); setEditing(false) }
  }

  async function syncToHub() {
    const res = await fetch('/api/tasks/sync-to-hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: task.id }),
    })
    const data = await res.json()
    if (data.hub_task_id) onUpdate(task.id, { hub_task_id: data.hub_task_id, last_synced_at: new Date().toISOString() } as any)
  }

  function toggleRaci(role: RaciRole, memberId: string) {
    if (role === 'accountable') setAccountable(p => p === memberId ? null : memberId)
    else if (role === 'responsible') setResponsible(p => p.includes(memberId) ? p.filter(id => id !== memberId) : [...p, memberId])
    else if (role === 'consulted') setConsulted(p => p.includes(memberId) ? p.filter(id => id !== memberId) : [...p, memberId])
    else setInformed(p => p.includes(memberId) ? p.filter(id => id !== memberId) : [...p, memberId])
  }

  function getMemberRoles(id: string): RaciRole[] {
    const r: RaciRole[] = []
    if (responsible.includes(id)) r.push('responsible')
    if (accountable === id) r.push('accountable')
    if (consulted.includes(id)) r.push('consulted')
    if (informed.includes(id)) r.push('informed')
    return r
  }

  const priority = PRIORITY_CONFIG[pri] || PRIORITY_CONFIG.medium
  const checkDone = checklist.filter(c => c.done).length
  const isOverdue = dueDate && status !== 'done' && new Date(dueDate) < new Date()

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3 border-b border-gray-100">
          <div className="flex-1">
            {editing ? (
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="text-sm font-bold text-np-dark bg-transparent border-b-2 border-np-blue outline-none w-full" autoFocus />
            ) : (
              <h2 className="text-sm font-bold text-np-dark">{title}</h2>
            )}
            {task.contact && <p className="text-[10px] text-gray-400 mt-0.5">{(task.contact as any)?.first_name} {(task.contact as any)?.last_name}</p>}
          </div>
          <div className="flex gap-1.5">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="px-2.5 py-1 text-[10px] font-medium text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5">Edit</button>
            ) : (
              <button onClick={save} className="px-2.5 py-1 text-[10px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark">Save</button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-50 rounded"><X size={14} className="text-gray-400" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Status row */}
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Status</label>
              {editing ? (
                <select value={status} onChange={e => setStatus(e.target.value as any)}
                  className="px-2 py-1 text-[10px] border border-gray-100 rounded-md text-np-dark">
                  <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
                </select>
              ) : <span className="text-xs font-medium text-np-dark capitalize">{status.replace('_', ' ')}</span>}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Priority</label>
              {editing ? (
                <select value={pri} onChange={e => setPri(e.target.value as any)}
                  className="px-2 py-1 text-[10px] border border-gray-100 rounded-md text-np-dark">
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              ) : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: priority.bg, color: priority.color }}>{priority.label}</span>}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Due</label>
              {editing ? (
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="px-2 py-1 text-[10px] border border-gray-100 rounded-md text-np-dark" />
              ) : (
                <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-600'}`}>
                  {dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None'}
                </span>
              )}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Time</label>
              {editing ? (
                <div className="flex items-center gap-1">
                  <input type="number" value={estMin} onChange={e => setEstMin(+e.target.value)} className="w-12 px-1.5 py-1 text-[10px] border border-gray-100 rounded-md" placeholder="Est" />
                  <span className="text-[9px] text-gray-300">/</span>
                  <input type="number" value={actMin} onChange={e => setActMin(+e.target.value)} className="w-12 px-1.5 py-1 text-[10px] border border-gray-100 rounded-md" placeholder="Act" />
                  <span className="text-[8px] text-gray-400">min</span>
                </div>
              ) : <span className="text-xs text-gray-600">{actMin || 0}m / {estMin || 0}m</span>}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Description</label>
            {editing ? (
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-100 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-np-blue/30" placeholder="Description..." />
            ) : <p className="text-xs text-gray-600 whitespace-pre-wrap">{description || 'No description'}</p>}
          </div>

          {/* RACI Matrix */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">RACI Assignments</label>
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left text-[8px] font-semibold text-gray-400 p-2">Member</th>
                    {Object.entries(RACI_CFG).map(([k, v]) => (
                      <th key={k} className="text-center text-[8px] font-bold p-2" style={{ color: v.color, width: 50 }}>{v.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map(m => {
                    const roles = getMemberRoles(m.id)
                    return (
                      <tr key={m.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-np-blue/10 flex items-center justify-center">
                              <span className="text-[7px] font-bold text-np-blue">{m.display_name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
                            </div>
                            <span className="text-[10px] font-medium text-np-dark">{m.display_name}</span>
                          </div>
                        </td>
                        {(['responsible', 'accountable', 'consulted', 'informed'] as RaciRole[]).map(role => {
                          const active = roles.includes(role)
                          const cfg = RACI_CFG[role]
                          return (
                            <td key={role} className="text-center p-2">
                              <button onClick={() => editing && toggleRaci(role, m.id)} disabled={!editing}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                  active ? '' : editing ? 'border border-dashed border-gray-200 hover:border-gray-300' : ''
                                }`}
                                style={active ? { background: cfg.bg, color: cfg.color } : {}}>
                                {active && <span className="text-[8px] font-bold">{cfg.short}</span>}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Labels */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Labels</label>
            <div className="flex flex-wrap gap-1">
              {labels.map(l => (
                <span key={l} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-50 text-[9px] font-medium text-gray-500 rounded">
                  {l}
                  {editing && <button onClick={() => setLabels(p => p.filter(x => x !== l))}><X size={8} className="text-gray-400" /></button>}
                </span>
              ))}
              {editing && (
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newLabel.trim()) { setLabels(p => [...p, newLabel.trim()]); setNewLabel('') } }}
                  placeholder="+ label" className="w-20 px-1.5 py-0.5 text-[9px] border border-dashed border-gray-200 rounded bg-white focus:outline-none" />
              )}
            </div>
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Checklist {checklist.length > 0 && `(${checkDone}/${checklist.length})`}</label>
              {checklist.length > 0 && (
                <div className="w-20 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(checkDone / checklist.length) * 100}%` }} />
                </div>
              )}
            </div>
            <div className="space-y-1">
              {checklist.map(item => (
                <div key={item.id} className="flex items-center gap-1.5 group">
                  <button onClick={() => setChecklist(p => p.map(c => c.id === item.id ? { ...c, done: !c.done } : c))}>
                    {item.done ? <CheckSquare size={14} className="text-green-500" /> : <Square size={14} className="text-gray-300" />}
                  </button>
                  <span className={`flex-1 text-[10px] ${item.done ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{item.text}</span>
                  {editing && <button onClick={() => setChecklist(p => p.filter(c => c.id !== item.id))} className="opacity-0 group-hover:opacity-100"><X size={10} className="text-gray-400" /></button>}
                </div>
              ))}
              {editing && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Plus size={14} className="text-gray-300" />
                  <input value={newCheck} onChange={e => setNewCheck(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newCheck.trim()) { setChecklist(p => [...p, { id: `chk-${Date.now()}`, text: newCheck.trim(), done: false }]); setNewCheck('') } }}
                    placeholder="Add item..." className="flex-1 text-[10px] bg-transparent border-b border-dashed border-gray-200 py-0.5 focus:outline-none focus:border-np-blue" />
                </div>
              )}
            </div>
          </div>

          {/* Hub sync */}
          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ExternalLink size={12} className="text-gray-300" />
              <span className="text-[9px] text-gray-400">
                {task.hub_task_id ? `Synced to Hub · ${task.last_synced_at ? new Date(task.last_synced_at as string).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}` : 'Not synced to Hub Board'}
              </span>
            </div>
            <button onClick={syncToHub}
              className="px-2.5 py-1 text-[9px] font-medium text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5">
              {task.hub_task_id ? 'Re-sync' : 'Sync to Hub'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
