'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
<<<<<<< ours
import { Plus, CheckCircle2, Clock, AlertTriangle, Search, Brain, X, Upload, Paperclip } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { fetchTasks, createTask, updateTask, fetchTeamMembers } from '@/lib/crm-client'
import type { CrmTask, TeamMember } from '@/types/crm'
import { createClient } from '@/lib/supabase-browser'
=======
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Users,
  Search, Brain, X, Columns, Paperclip
} from 'lucide-react'
import { fetchTasks, createTask, updateTask, fetchTeamMembers, fetchKanbanColumns } from '@/lib/crm-client'
import type { CrmTask, TeamMember } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'
>>>>>>> theirs

const PRIORITY_CONFIG = {
  urgent: { color: '#dc2626', bg: '#fef2f2', label: 'Urgent' },
  high: { color: '#d97706', bg: '#fffbeb', label: 'High' },
  medium: { color: '#2563eb', bg: '#eff6ff', label: 'Medium' },
  low: { color: '#6b7280', bg: '#f3f4f6', label: 'Low' },
}
const STATUS_CONFIG = {
  todo: { color: '#6b7280', label: 'To Do' },
  in_progress: { color: '#2563eb', label: 'In Progress' },
  done: { color: '#059669', label: 'Done' },
  cancelled: { color: '#9ca3af', label: 'Cancelled' },
}

<<<<<<< ours
function TaskRow({ task, onComplete, onStatusChange }: { task: CrmTask; onComplete: () => void; onStatusChange: (s: string) => void }) {
=======
function TaskRow({ task, onComplete, onStatusChange }: {
  task: CrmTask; onComplete: () => void; onStatusChange: (s: string) => void
}) {
>>>>>>> theirs
  const pri = PRIORITY_CONFIG[task.priority]
  const sta = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]
  const contactName = task.contact ? `${(task.contact as any).first_name} ${(task.contact as any).last_name}` : null
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
<<<<<<< ours
  const raci = (task as any).custom_fields || {}

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors ${task.status === 'done' ? 'opacity-50' : ''}`}>
      <button onClick={onComplete} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${task.status === 'done' ? 'bg-green-500 border-green-500' : 'border-gray-100 hover:border-np-blue'}`}>
=======
  const raci = task.custom_fields?.raci as Record<string, string> | undefined
  const kanbanCol = task.custom_fields?.kanban_column as string | undefined

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors ${task.status === 'done' ? 'opacity-50' : ''}`}>
      <button onClick={onComplete}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${task.status === 'done' ? 'bg-green-500 border-green-500' : 'border-gray-100 hover:border-np-blue'}`}>
>>>>>>> theirs
        {task.status === 'done' && <CheckCircle2 size={12} className="text-white" />}
      </button>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pri.color }} title={pri.label} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${task.status === 'done' ? 'line-through text-gray-400' : 'text-np-dark'}`}>{task.title}</p>
<<<<<<< ours
        <div className="flex items-center gap-2 mt-0.5">
          {contactName && <Link href={`/crm/contacts?id=${task.contact_id}`} className="text-[10px] text-np-blue hover:underline">{contactName}</Link>}
          {task.source !== 'manual' && <span className="text-[9px] px-1 py-0.5 rounded bg-np-blue/8 text-np-blue font-medium flex items-center gap-0.5"><Brain size={7} /> {task.source}</span>}
          {raci.raci_responsible && <span className="text-[9px] text-gray-400">R: {raci.raci_responsible}</span>}
          {raci.kanban_column && <span className="text-[9px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">{raci.kanban_column}</span>}
        </div>
      </div>
      <select value={task.status} onChange={e => onStatusChange(e.target.value)} className="text-[10px] bg-gray-50 border-none rounded-md px-2 py-1 font-medium" style={{ color: sta.color }}>
        <option value="todo">To Do</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <span className="text-[10px] text-gray-400 w-24 truncate text-right">{(task.assigned_member as any)?.display_name || '--'}</span>
      <span className={`text-[10px] w-20 text-right ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
        {task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
        {isOverdue && ' ⚠'}
=======
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {contactName && <Link href={`/crm/contacts?id=${task.contact_id}`} className="text-[10px] text-np-blue hover:underline">{contactName}</Link>}
          {task.source !== 'manual' && <span className="text-[9px] px-1 py-0.5 rounded bg-np-blue/8 text-np-blue font-medium flex items-center gap-0.5"><Brain size={7} /> {task.source}</span>}
          {kanbanCol && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium flex items-center gap-0.5"><Columns size={7} /> {kanbanCol}</span>}
          {raci?.responsible && <span className="text-[9px] px-1 py-0.5 rounded bg-teal/10 text-teal font-medium">R: {raci.responsible.slice(0,8)}</span>}
        </div>
      </div>
      <select value={task.status} onChange={e => onStatusChange(e.target.value)}
        className="text-[10px] bg-gray-50 border-none rounded-md px-2 py-1 font-medium" style={{ color: sta.color }}>
        <option value="todo">To Do</option><option value="in_progress">In Progress</option>
        <option value="done">Done</option><option value="cancelled">Cancelled</option>
      </select>
      <span className="text-[10px] text-gray-400 w-24 truncate text-right">{(task.assigned_member as any)?.display_name || '--'}</span>
      <span className={`text-[10px] w-20 text-right ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
        {task.due_date ? new Date(task.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '--'}{isOverdue && ' !'}
>>>>>>> theirs
      </span>
    </div>
  )
}

const EMPTY_TASK = { title: '', description: '', priority: 'medium' as const, due_date: '', assigned_to: '', contact_id: '', raci_responsible: '', raci_accountable: '', raci_consulted: '', raci_informed: '', kanban_column: '' }

export default function TasksPage() {
  const { currentOrg, user } = useWorkspace()
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
<<<<<<< ours
  const [form, setForm] = useState(EMPTY_TASK)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [kanbanColumns, setKanbanColumns] = useState<{id:string,title:string}[]>([])
  const [saving, setSaving] = useState(false)
  const [files, setFiles] = useState<File[]>([])
=======
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [kanbanCols, setKanbanCols] = useState<{id:string;name:string}[]>([])
  const [creating, setCreating] = useState(false)

  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium' as const, due_date: '',
    assigned_to: '', kanban_column: '',
    raci_responsible: '', raci_accountable: '', raci_consulted: '', raci_informed: '',
  })

  useEffect(() => {
    fetchTeamMembers().then(setTeamMembers).catch(console.error)
    if (currentOrg) fetchKanbanColumns(currentOrg.id).then(setKanbanCols).catch(console.error)
  }, [currentOrg])
>>>>>>> theirs

  useEffect(() => {
    const filters: any = {}
    if (statusFilter) filters.status = statusFilter
    fetchTasks(filters).then(setTasks).catch(console.error).finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => {
    fetchTeamMembers().then(setTeamMembers).catch(console.error)
    // Load kanban columns for dropdown
    if (currentOrg) {
      createClient().from('kanban_columns').select('id,title').eq('org_id', currentOrg.id).order('sort_order')
        .then(({ data }) => setKanbanColumns(data || []))
    }
  }, [currentOrg?.id])

  const handleComplete = async (task: CrmTask) => {
    const s = task.status === 'done' ? 'todo' : 'done'
<<<<<<< ours
    await updateTask(task.id, { status: s }).catch(console.error)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: s } : t))
  }

  const handleStatusChange = async (id: string, status: string) => {
    await updateTask(id, { status: status as any }).catch(console.error)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: status as any } : t))
=======
    try { await updateTask(task.id, { status: s }); setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: s } : t)) } catch (e) { console.error(e) }
  }
  const handleStatusChange = async (id: string, status: string) => {
    try { await updateTask(id, { status: status as any }); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: status as any } : t)) } catch (e) { console.error(e) }
>>>>>>> theirs
  }

  const handleCreate = async () => {
    if (!form.title || !currentOrg) return
<<<<<<< ours
    setSaving(true)
    try {
      const customFields: Record<string, any> = {}
      if (form.raci_responsible) customFields.raci_responsible = form.raci_responsible
      if (form.raci_accountable) customFields.raci_accountable = form.raci_accountable
      if (form.raci_consulted) customFields.raci_consulted = form.raci_consulted
      if (form.raci_informed) customFields.raci_informed = form.raci_informed
      if (form.kanban_column) customFields.kanban_column = form.kanban_column

      // Handle file uploads
      if (files.length > 0) {
        const sb = createClient()
        const uploaded: { name: string; url: string }[] = []
        for (const file of files) {
          const path = `${currentOrg.id}/tasks/${Date.now()}-${file.name}`
          const { error } = await sb.storage.from('attachments').upload(path, file)
          if (!error) {
            const { data } = sb.storage.from('attachments').getPublicUrl(path)
            uploaded.push({ name: file.name, url: data.publicUrl })
          }
        }
        if (uploaded.length > 0) customFields.attachments = uploaded
      }
=======
    setCreating(true)
    try {
      const customFields: Record<string,any> = {}
      if (form.kanban_column) customFields.kanban_column = form.kanban_column
      const raci: Record<string,string> = {}
      if (form.raci_responsible) raci.responsible = form.raci_responsible
      if (form.raci_accountable) raci.accountable = form.raci_accountable
      if (form.raci_consulted) raci.consulted = form.raci_consulted
      if (form.raci_informed) raci.informed = form.raci_informed
      if (Object.keys(raci).length) customFields.raci = raci
>>>>>>> theirs

      const created = await createTask({
        org_id: currentOrg.id,
        title: form.title,
<<<<<<< ours
        description: form.description || null,
        priority: form.priority,
        status: 'todo',
        source: 'manual',
        assigned_to: form.assigned_to || user?.id || '',
        contact_id: form.contact_id || null,
        due_date: form.due_date || null,
        custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined,
      } as any)
      setTasks(prev => [created, ...prev])
      setShowCreate(false); setForm(EMPTY_TASK); setFiles([])
    } catch (e) { console.error(e); alert('Failed to create task') } finally { setSaving(false) }
=======
        description: form.description || undefined,
        priority: form.priority,
        status: 'todo',
        due_date: form.due_date || undefined,
        assigned_to: form.assigned_to || user?.id || '',
        source: 'manual',
        created_by: user?.id,
        custom_fields: Object.keys(customFields).length ? customFields : undefined,
      })
      setTasks(prev => [created, ...prev])
      setShowCreate(false)
      setForm({ title:'', description:'', priority:'medium', due_date:'', assigned_to:'', kanban_column:'', raci_responsible:'', raci_accountable:'', raci_consulted:'', raci_informed:'' })
    } catch (e) { console.error(e); alert('Failed to create task') }
    finally { setCreating(false) }
>>>>>>> theirs
  }

  const filtered = tasks.filter(t => {
    if (priorityFilter && t.priority !== priorityFilter) return false
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const overdue = filtered.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date())

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
<<<<<<< ours
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks..." className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
        </div>
        <div className="flex gap-1">
          {['', 'todo', 'in_progress', 'done'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'}`}>
=======
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
        </div>
        <div className="flex gap-1">
          {['','todo','in_progress','done'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${statusFilter===s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'}`}>
>>>>>>> theirs
              {s ? STATUS_CONFIG[s as keyof typeof STATUS_CONFIG]?.label : 'All'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
<<<<<<< ours
          {['', 'urgent', 'high', 'medium', 'low'].map(p => (
            <button key={p} onClick={() => setPriorityFilter(p)} className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${priorityFilter === p ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'}`}>
=======
          {['','urgent','high','medium','low'].map(p => (
            <button key={p} onClick={() => setPriorityFilter(p)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${priorityFilter===p ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'}`}>
>>>>>>> theirs
              {p || 'Priority'}
            </button>
          ))}
        </div>
<<<<<<< ours
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
=======
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
>>>>>>> theirs
          <Plus size={13} /> Add Task
        </button>
      </div>

      {overdue.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={14} className="text-red-500" />
          <span className="text-xs font-medium text-red-700">{overdue.length} overdue task{overdue.length > 1 ? 's' : ''}</span>
        </div>
      )}

      <div className="flex gap-3">
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs"><span className="text-gray-400">Open: </span><span className="font-bold text-np-dark">{filtered.filter(t => t.status==='todo'||t.status==='in_progress').length}</span></div>
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs"><span className="text-gray-400">Done: </span><span className="font-bold text-green-600">{filtered.filter(t => t.status==='done').length}</span></div>
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs"><span className="text-gray-400">AI-Created: </span><span className="font-bold text-np-blue">{filtered.filter(t => t.source!=='manual').length}</span></div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
          <div className="w-5" /><div className="w-2" />
          <span className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Task</span>
          <span className="w-24 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Status</span>
          <span className="w-24 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-right">Assigned</span>
          <span className="w-20 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-right">Due</span>
        </div>
        {loading ? <div className="py-8 text-center text-xs text-gray-400">Loading tasks...</div>
        : filtered.length === 0 ? <div className="py-12 text-center"><CheckCircle2 size={32} className="mx-auto text-gray-400/30 mb-3" /><p className="text-sm text-gray-400">No tasks found</p></div>
        : filtered.map(t => <TaskRow key={t.id} task={t} onComplete={() => handleComplete(t)} onStatusChange={s => handleStatusChange(t.id, s)} />)}
      </div>

<<<<<<< ours
      {/* ═══ Create Task Modal ═══ */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto">
=======
      {/* ── Create Task Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
>>>>>>> theirs
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Task</h3>
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_TASK); setFiles([]) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div>
<<<<<<< ours
                <label className="text-[10px] font-semibold uppercase text-gray-400">Title *</label>
                <input value={form.title} onChange={e => setForm(p=>({...p,title:e.target.value}))} placeholder="Follow up with client" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-gray-400">Description</label>
                <textarea value={form.description} onChange={e => setForm(p=>({...p,description:e.target.value}))} placeholder="Details..." rows={3} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] font-semibold uppercase text-gray-400">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p=>({...p,priority:e.target.value as any}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div><label className="text-[10px] font-semibold uppercase text-gray-400">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p=>({...p,due_date:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                </div>
                <div><label className="text-[10px] font-semibold uppercase text-gray-400">Assigned To</label>
                  <select value={form.assigned_to} onChange={e => setForm(p=>({...p,assigned_to:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="">Unassigned</option>
                    {teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </select>
                </div>
              </div>

              {/* Kanban Column */}
              {kanbanColumns.length > 0 && (
                <div>
                  <label className="text-[10px] font-semibold uppercase text-gray-400">Kanban Column</label>
                  <select value={form.kanban_column} onChange={e => setForm(p=>({...p,kanban_column:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="">None</option>
                    {kanbanColumns.map(c => <option key={c.id} value={c.title}>{c.title}</option>)}
                  </select>
                </div>
              )}

              {/* RACI Roles */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">RACI Roles</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] text-gray-400">Responsible</label>
                    <select value={form.raci_responsible} onChange={e => setForm(p=>({...p,raci_responsible:e.target.value}))} className="w-full mt-1 px-3 py-1.5 text-xs border border-gray-100 rounded-lg">
                      <option value="">--</option>
                      {teamMembers.map(m => <option key={m.id} value={m.display_name}>{m.display_name}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[10px] text-gray-400">Accountable</label>
                    <select value={form.raci_accountable} onChange={e => setForm(p=>({...p,raci_accountable:e.target.value}))} className="w-full mt-1 px-3 py-1.5 text-xs border border-gray-100 rounded-lg">
                      <option value="">--</option>
                      {teamMembers.map(m => <option key={m.id} value={m.display_name}>{m.display_name}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[10px] text-gray-400">Consulted</label>
                    <select value={form.raci_consulted} onChange={e => setForm(p=>({...p,raci_consulted:e.target.value}))} className="w-full mt-1 px-3 py-1.5 text-xs border border-gray-100 rounded-lg">
                      <option value="">--</option>
                      {teamMembers.map(m => <option key={m.id} value={m.display_name}>{m.display_name}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[10px] text-gray-400">Informed</label>
                    <select value={form.raci_informed} onChange={e => setForm(p=>({...p,raci_informed:e.target.value}))} className="w-full mt-1 px-3 py-1.5 text-xs border border-gray-100 rounded-lg">
                      <option value="">--</option>
                      {teamMembers.map(m => <option key={m.id} value={m.display_name}>{m.display_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* File Upload */}
              <div className="pt-2 border-t border-gray-100">
                <label className="text-[10px] font-semibold uppercase text-gray-400">Attachments</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 text-[10px] text-np-dark">
                      <Paperclip size={10} /> {f.name}
                      <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={9} /></button>
                    </span>
                  ))}
                  <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-gray-200 text-[10px] text-gray-400 hover:text-np-blue hover:border-np-blue/30 cursor-pointer transition-colors">
                    <Upload size={10} /> Upload
                    <input type="file" multiple className="hidden" onChange={e => { if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]) }} />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_TASK); setFiles([]) }} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title||saving} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
                {saving ? 'Saving...' : 'Create Task'}
=======
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Title *</label>
                <input value={form.title} onChange={e => setForm(p=>({...p,title:e.target.value}))} placeholder="Follow up with lead"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</label>
                <textarea value={form.description} onChange={e => setForm(p=>({...p,description:e.target.value}))} rows={2} placeholder="Optional details..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p=>({...p,priority:e.target.value as any}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p=>({...p,due_date:e.target.value}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assigned To</label>
                  <select value={form.assigned_to} onChange={e => setForm(p=>({...p,assigned_to:e.target.value}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="">Self</option>{teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </select></div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Kanban Column</label>
                <select value={form.kanban_column} onChange={e => setForm(p=>({...p,kanban_column:e.target.value}))}
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                  <option value="">None</option>{kanbanCols.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              {/* RACI */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">RACI Roles</p>
                <div className="grid grid-cols-2 gap-2">
                  {([['raci_responsible','Responsible'],['raci_accountable','Accountable'],['raci_consulted','Consulted'],['raci_informed','Informed']] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="text-[9px] font-medium text-gray-400">{label}</label>
                      <select value={(form as any)[key]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))}
                        className="w-full mt-0.5 px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg">
                        <option value="">None</option>{teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title || creating}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-np-dark transition-colors">
                {creating ? 'Creating...' : 'Create Task'}
>>>>>>> theirs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
