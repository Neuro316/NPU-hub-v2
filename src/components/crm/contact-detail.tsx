'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  X, Phone, Mail, MessageCircle, Tag, Clock, CheckCircle2, AlertTriangle,
  TrendingUp, Send, Pencil, Trash2, Plus, User, Activity, Brain,
  Route, Target, Calendar, FileText, Sparkles, ChevronRight, Heart,
  ArrowRightLeft, GraduationCap, BarChart3
} from 'lucide-react'
import {
  fetchContact, updateContact, fetchNotes, createNote,
  fetchActivityLog, fetchTasks, createTask, updateTask, fetchLifecycleEvents,
  fetchCallLogs, fetchConversations, fetchMessages
} from '@/lib/crm-client'
import type { CrmContact, ContactNote, CrmTask, CallLog, ActivityLogEntry } from '@/types/crm'
import { ContactCommsButtons } from '@/components/crm/twilio-comms'

interface TimelineEvent {
  id: string
  event_type: string
  title: string
  description?: string
  metadata?: Record<string, any>
  occurred_at: string
}

const EVENT_ICONS: Record<string, any> = {
  call_completed: Phone, sms_sent: Send, sms_received: MessageCircle,
  email_sent: Mail, email_opened: Mail, pipeline_changed: ArrowRightLeft,
  task_created: CheckCircle2, task_completed: CheckCircle2,
  note_added: FileText, quiz_completed: Brain, mastermind_enrolled: GraduationCap,
  lifecycle_event: Activity, health_score_changed: Heart,
  tag_added: Tag, tag_removed: Tag,
}

const EVENT_COLORS: Record<string, string> = {
  call_completed: '#8b5cf6', sms_sent: '#3b82f6', sms_received: '#10b981',
  email_sent: '#f59e0b', pipeline_changed: '#ec4899', task_created: '#6b7280',
  task_completed: '#22c55e', note_added: '#64748b', quiz_completed: '#386797',
  mastermind_enrolled: '#059669', health_score_changed: '#ef4444',
}

const HEALTH_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  thriving: { color: '#22c55e', bg: '#f0fdf4', label: 'Thriving' },
  stable: { color: '#3b82f6', bg: '#eff6ff', label: 'Stable' },
  at_risk: { color: '#f59e0b', bg: '#fffbeb', label: 'At Risk' },
  critical: { color: '#ef4444', bg: '#fef2f2', label: 'Critical' },
}

const MASTERMIND_STATUS: Record<string, { color: string; label: string }> = {
  prospect: { color: '#6b7280', label: 'Prospect' },
  enrolled: { color: '#3b82f6', label: 'Enrolled' },
  active: { color: '#22c55e', label: 'Active' },
  completed: { color: '#8b5cf6', label: 'Completed' },
  graduated: { color: '#059669', label: 'Graduated' },
  alumni: { color: '#64748b', label: 'Alumni' },
}

interface ContactDetailProps {
  contactId: string | null
  onClose: () => void
  onUpdate?: () => void
}

export default function ContactDetail({ contactId, onClose, onUpdate }: ContactDetailProps) {
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [tab, setTab] = useState<'overview' | 'timeline' | 'tasks' | 'notes' | 'comms'>('overview')
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [calls, setCalls] = useState<CallLog[]>([])
  const [newNote, setNewNote] = useState('')
  const [newTag, setNewTag] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showTaskCreate, setShowTaskCreate] = useState(false)
  const [taskCreating, setTaskCreating] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', due_date: '', kanban_column: '' })

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    try {
      // Load contact first - this is required
      const c = await fetchContact(contactId)
      setContact(c)

      // Load supplemental data independently - don't block on failures
      fetchNotes(contactId).then(setNotes).catch(e => console.warn('Notes load skipped:', e))
      fetchTasks({ contact_id: contactId }).then(setTasks).catch(e => console.warn('Tasks load skipped:', e))
      fetchCallLogs(contactId, 10).then(setCalls).catch(e => console.warn('Calls load skipped:', e))

      // Timeline
      try {
        const { createClient } = await import('@/lib/supabase-browser')
        const sb = createClient()
        const { data } = await sb
          .from('contact_timeline')
          .select('*')
          .eq('contact_id', contactId)
          .order('occurred_at', { ascending: false })
          .limit(50)
        setTimeline(data || [])
      } catch (e) { console.warn('Timeline load skipped:', e) }
    } catch (e) { console.error('ContactDetail load error:', e) }
    setLoading(false)
  }, [contactId])

  useEffect(() => { load() }, [load])

  if (!contactId) return null

  const health = HEALTH_CONFIG[contact?.health_tier || 'stable'] || HEALTH_CONFIG.stable
  const mastermind = contact?.mastermind_status ? MASTERMIND_STATUS[contact.mastermind_status] : null

  const handleAddNote = async () => {
    if (!newNote.trim() || !contact) return
    await createNote({ contact_id: contact.id, org_id: contact.org_id, body: newNote, type: 'manual' })
    setNewNote('')
    load()
  }

  const handleAddTag = async () => {
    if (!newTag.trim() || !contact) return
    const tags = [...(contact.tags || []), newTag.trim()]
    await updateContact(contact.id, { tags })
    setNewTag('')
    load()
    onUpdate?.()
  }

  const removeTag = async (tag: string) => {
    if (!contact) return
    const tags = (contact.tags || []).filter(t => t !== tag)
    await updateContact(contact.id, { tags })
    load()
    onUpdate?.()
  }

  const handleCreateTask = async () => {
    if (!taskForm.title.trim() || !contact) return
    setTaskCreating(true)
    try {
      const customFields: Record<string, any> = {}
      if (taskForm.kanban_column) customFields.kanban_column = taskForm.kanban_column
      const created = await createTask({
        org_id: contact.org_id, title: taskForm.title, description: taskForm.description || undefined,
        priority: taskForm.priority as any, status: 'todo', due_date: taskForm.due_date || undefined,
        contact_id: contact.id, source: 'manual', created_by: contact.org_id,
        custom_fields: Object.keys(customFields).length ? customFields : undefined,
      })
      setTasks(prev => [created, ...prev])
      setTaskForm({ title: '', description: '', priority: 'medium', due_date: '', kanban_column: '' })
      setShowTaskCreate(false)
    } catch (e) { console.error(e); alert('Failed to create task') }
    finally { setTaskCreating(false) }
  }

  const handleToggleTask = async (task: CrmTask) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    try {
      await updateTask(task.id, { status: newStatus })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    } catch (e) { console.error(e) }
  }

  const handleChangeTaskStatus = async (taskId: string, status: string) => {
    try {
      await updateTask(taskId, { status: status as any })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: status as any } : t))
    } catch (e) { console.error(e) }
  }

  const TABS = [
    { key: 'overview', label: 'Overview', icon: User },
    { key: 'timeline', label: 'Timeline', icon: Activity },
    { key: 'tasks', label: 'Tasks', icon: CheckCircle2 },
    { key: 'notes', label: 'Notes', icon: FileText },
    { key: 'comms', label: 'Comms', icon: MessageCircle },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white shadow-2xl border-l border-gray-100 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-gray-400">Loading contact...</div>
          </div>
        ) : contact ? (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-np-blue flex items-center justify-center text-white font-bold text-sm">
                    {contact.first_name[0]}{contact.last_name[0]}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-np-dark">{contact.first_name} {contact.last_name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {contact.pipeline_stage && (
                        <span className="text-[9px] font-bold bg-np-blue/10 text-np-blue px-1.5 py-0.5 rounded">{contact.pipeline_stage}</span>
                      )}
                      {mastermind && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: mastermind.color + '18', color: mastermind.color }}>
                          {mastermind.label}
                        </span>
                      )}
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: health.bg, color: health.color }}>
                        {health.label} ({contact.health_score || 50})
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
              </div>

              {/* Quick contacts */}
              <div className="flex gap-2 mt-3 flex-wrap">
                <ContactCommsButtons contact={contact} size="md" />
                {contact.phone && <span className="text-[9px] text-gray-400 self-center">{contact.phone}</span>}
                {contact.email && <span className="text-[9px] text-gray-400 self-center">{contact.email}</span>}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mt-2.5">
                {(contact.tags || []).map(tag => (
                  <span key={tag} className="flex items-center gap-0.5 text-[9px] font-medium bg-np-blue/8 text-np-blue px-2 py-0.5 rounded-full group">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="opacity-0 group-hover:opacity-100 hover:text-red-500">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input value={newTag} onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="+ tag" className="text-[9px] w-14 bg-transparent border-none outline-none placeholder-gray-300" />
                </div>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex gap-0.5 px-3 py-1.5 border-b border-gray-100 flex-shrink-0 bg-gray-50/50">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                    tab === t.key ? 'bg-white shadow-sm text-np-blue' : 'text-gray-500 hover:text-np-dark'
                  }`}>
                  <t.icon className="w-3 h-3" /> {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* OVERVIEW TAB */}
              {tab === 'overview' && (
                <>
                  {/* Attribution */}
                  {(contact.acquisition_source || contact.acquisition_campaign) && (
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-3 border border-purple-100/50">
                      <h4 className="text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Route className="w-3 h-3" /> Acquisition Path
                      </h4>
                      <div className="space-y-1">
                        {contact.acquisition_source && (
                          <div className="text-[10px]"><span className="text-gray-400">Source:</span> <span className="font-medium text-np-dark">{contact.acquisition_source}</span></div>
                        )}
                        {contact.acquisition_campaign && (
                          <div className="text-[10px]"><span className="text-gray-400">Campaign:</span> <span className="font-medium text-np-dark">{contact.acquisition_campaign}</span></div>
                        )}
                        {contact.acquisition_utm && (
                          <div className="text-[10px]"><span className="text-gray-400">UTM:</span> <span className="font-mono text-gray-500">{JSON.stringify(contact.acquisition_utm)}</span></div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mastermind Progress */}
                  {contact.mastermind_user_id && (
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-3 border border-emerald-100/50">
                      <h4 className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <GraduationCap className="w-3 h-3" /> Mastermind Program
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{
                          backgroundColor: (mastermind?.color || '#6b7280') + '18',
                          color: mastermind?.color || '#6b7280'
                        }}>
                          {mastermind?.label || 'Unknown'}
                        </span>
                        <Link href={`/crm/contacts?id=${contact.id}&view=mastermind`}
                          className="text-[10px] text-emerald-600 hover:underline flex items-center gap-0.5">
                          View program data <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Pipeline + Stage */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Target className="w-3 h-3" /> Pipeline
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {['New Lead', 'Contacted', 'Qualified', 'Discovery', 'Proposal', 'Enrolled', 'Active', 'Graduated'].map(stage => (
                        <button key={stage}
                          onClick={() => updateContact(contact.id, { pipeline_stage: stage }).then(() => { load(); onUpdate?.() })}
                          className={`text-[9px] font-medium px-2.5 py-1 rounded-full border transition-all ${
                            contact.pipeline_stage === stage
                              ? 'bg-np-blue text-white border-np-blue'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-np-blue/30'
                          }`}>
                          {stage}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity Summary */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Recent Activity
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                        <p className="text-lg font-bold text-np-dark">{calls.length}</p>
                        <p className="text-[9px] text-gray-400">Calls</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                        <p className="text-lg font-bold text-np-dark">{tasks.length}</p>
                        <p className="text-[9px] text-gray-400">Tasks</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                        <p className="text-lg font-bold text-np-dark">{notes.length}</p>
                        <p className="text-[9px] text-gray-400">Notes</p>
                      </div>
                    </div>
                  </div>

                  {/* Custom Fields */}
                  {contact.custom_fields && Object.keys(contact.custom_fields).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Custom Fields</h4>
                      <div className="space-y-1">
                        {Object.entries(contact.custom_fields).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{key}:</span>
                            <span className="font-medium text-np-dark">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lifecycle Events */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lifecycle</h4>
                    <div className="text-[10px] text-gray-500">
                      Created {new Date(contact.created_at).toLocaleDateString()}
                      {contact.last_contacted_at && (
                        <span> · Last contact {new Date(contact.last_contacted_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* TIMELINE TAB */}
              {tab === 'timeline' && (
                <div className="space-y-0">
                  {timeline.length === 0 ? (
                    <p className="text-center text-[10px] text-gray-400 py-8">No activity yet</p>
                  ) : timeline.map((ev, i) => {
                    const Icon = EVENT_ICONS[ev.event_type] || Activity
                    const color = EVENT_COLORS[ev.event_type] || '#94a3b8'
                    return (
                      <div key={ev.id} className="flex gap-3 pb-4 relative">
                        {i < timeline.length - 1 && (
                          <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-100" />
                        )}
                        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10"
                          style={{ backgroundColor: color + '18' }}>
                          <Icon className="w-3 h-3" style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-np-dark">{ev.title}</p>
                          {ev.description && (
                            <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{ev.description}</p>
                          )}
                          <p className="text-[9px] text-gray-300 mt-0.5">
                            {new Date(ev.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* TASKS TAB */}
              {tab === 'tasks' && (
                <>
                  {/* Create Task */}
                  {showTaskCreate ? (
                    <div className="border border-gray-100 rounded-lg p-3 mb-3 bg-gray-50/50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">New Task</p>
                        <button onClick={() => setShowTaskCreate(false)} className="p-0.5 hover:bg-gray-100 rounded"><X className="w-3 h-3 text-gray-400" /></button>
                      </div>
                      <input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))}
                        placeholder="Task title..." autoFocus
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-100 rounded-md mb-2 focus:outline-none focus:ring-1 focus:ring-teal/30" />
                      <textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))}
                        rows={2} placeholder="Description (optional)"
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-100 rounded-md mb-2 focus:outline-none focus:ring-1 focus:ring-teal/30" />
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <select value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value }))}
                          className="px-2 py-1.5 text-[10px] border border-gray-100 rounded-md">
                          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                        </select>
                        <input type="date" value={taskForm.due_date} onChange={e => setTaskForm(p => ({ ...p, due_date: e.target.value }))}
                          className="px-2 py-1.5 text-[10px] border border-gray-100 rounded-md" />
                        <select value={taskForm.kanban_column} onChange={e => setTaskForm(p => ({ ...p, kanban_column: e.target.value }))}
                          className="px-2 py-1.5 text-[10px] border border-gray-100 rounded-md">
                          <option value="">No Column</option><option value="To Do">To Do</option><option value="In Progress">In Progress</option><option value="Review">Review</option><option value="Done">Done</option>
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setShowTaskCreate(false)} className="px-2 py-1 text-[10px] text-gray-400">Cancel</button>
                        <button onClick={handleCreateTask} disabled={!taskForm.title.trim() || taskCreating}
                          className="px-3 py-1.5 bg-np-blue text-white text-[10px] font-medium rounded-md disabled:opacity-40 hover:bg-np-dark transition-colors">
                          {taskCreating ? 'Creating...' : 'Create'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowTaskCreate(true)}
                      className="flex items-center gap-1.5 px-3 py-2 w-full border border-dashed border-gray-200 rounded-lg text-[10px] text-gray-400 hover:border-np-blue hover:text-np-blue transition-colors mb-3">
                      <Plus className="w-3 h-3" /> Add Task
                    </button>
                  )}

                  {/* Task List */}
                  <div className="space-y-1.5">
                    {tasks.map(task => {
                      const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
                      const priColors: Record<string,string> = { urgent: '#dc2626', high: '#d97706', medium: '#2563eb', low: '#6b7280' }
                      const raci = task.custom_fields?.raci as Record<string,string> | undefined
                      const kanban = task.custom_fields?.kanban_column as string | undefined
                      const files = (task.custom_fields?.files as any[]) || []
                      return (
                        <div key={task.id} className={`px-3 py-2.5 rounded-lg border border-gray-100 hover:border-np-blue/20 transition-all ${task.status === 'done' ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleToggleTask(task)}
                              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${task.status === 'done' ? 'border-green-500 bg-green-500' : 'border-gray-300 hover:border-np-blue'}`}>
                              {task.status === 'done' && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                            </button>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: priColors[task.priority] || '#6b7280' }} />
                            <div className="flex-1 min-w-0">
                              <p className={`text-[11px] font-medium ${task.status === 'done' ? 'line-through text-gray-400' : 'text-np-dark'}`}>{task.title}</p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {task.due_date && (
                                  <span className={`text-[9px] flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                                    <Calendar className="w-2.5 h-2.5" /> {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{isOverdue && ' !'}
                                  </span>
                                )}
                                {kanban && <span className="text-[8px] px-1 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">{kanban}</span>}
                                {raci?.responsible && <span className="text-[8px] px-1 py-0.5 rounded bg-teal/10 text-teal font-medium">R: {raci.responsible.slice(0,8)}</span>}
                                {files.length > 0 && <span className="text-[8px] px-1 py-0.5 rounded bg-gray-50 text-gray-400">{files.length} file{files.length>1?'s':''}</span>}
                              </div>
                            </div>
                            <select value={task.status} onChange={e => handleChangeTaskStatus(task.id, e.target.value)}
                              className="text-[9px] bg-gray-50 border-none rounded px-1.5 py-0.5 font-medium text-gray-500">
                              <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
                            </select>
                          </div>
                          {task.description && <p className="text-[10px] text-gray-400 mt-1 ml-8">{task.description}</p>}
                        </div>
                      )
                    })}
                  </div>
                  {tasks.length === 0 && !showTaskCreate && <p className="text-center text-[10px] text-gray-400 py-8">No tasks for this contact</p>}
                </>
              )}

              {/* NOTES TAB */}
              {tab === 'notes' && (
                <>
                  <div className="flex gap-2 mb-3">
                    <input value={newNote} onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                      placeholder="Add a note..."
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    <button onClick={handleAddNote} disabled={!newNote.trim()}
                      className="px-3 py-2 bg-np-blue text-white rounded-lg text-xs disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {notes.map(note => (
                      <div key={note.id} className="bg-gray-50 rounded-xl px-3 py-2.5">
                        <p className="text-[11px] text-np-dark whitespace-pre-wrap">{note.body}</p>
                        <p className="text-[9px] text-gray-300 mt-1">
                          {new Date(note.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                  {notes.length === 0 && !newNote && <p className="text-center text-[10px] text-gray-400 py-6">No notes yet</p>}
                </>
              )}

              {/* COMMS TAB */}
              {tab === 'comms' && (
                <div className="space-y-2">
                  {calls.map(call => (
                    <div key={call.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        call.direction === 'inbound' ? 'bg-green-100' : 'bg-blue-100'
                      }`}>
                        <Phone className={`w-3.5 h-3.5 ${call.direction === 'inbound' ? 'text-green-600' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-np-dark">
                          {call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call
                          {(call.duration_seconds ?? 0) > 0 && ` · ${Math.floor((call.duration_seconds ?? 0) / 60)}:${String((call.duration_seconds ?? 0) % 60).padStart(2, '0')}`}
                        </p>
                        {call.ai_summary && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{call.ai_summary}</p>}
                        <p className="text-[9px] text-gray-300 mt-0.5">{new Date(call.started_at).toLocaleString()}</p>
                      </div>
                      {call.sentiment && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                          call.sentiment === 'positive' ? 'bg-green-50 text-green-600' :
                          call.sentiment === 'negative' ? 'bg-red-50 text-red-600' :
                          call.sentiment === 'concerned' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'
                        }`}>{call.sentiment}</span>
                      )}
                    </div>
                  ))}
                  {calls.length === 0 && <p className="text-center text-[10px] text-gray-400 py-8">No communications yet</p>}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-sm">Contact not found</p>
          </div>
        )}
      </div>
    </div>
  )
}
