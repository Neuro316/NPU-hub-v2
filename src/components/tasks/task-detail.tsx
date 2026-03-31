'use client'

import { useState, useEffect } from 'react'
import type { KanbanTask, KanbanColumn, TaskComment, Subtask, TaskActivity, Project, TaskDependency, TaskAttachment } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { X, Trash2, MessageSquare, Plus, Link2, Calendar, User, Flag, Eye, FileText, ExternalLink, Clock, Zap, AlertTriangle, ListChecks, CheckSquare, Square, Activity, ChevronDown, ChevronUp, Lock, FolderOpen, Loader2 } from 'lucide-react'
import { LinkTaskModal } from './link-task-modal'
import { TaskAttachments } from './task-attachments'
import { notifyTaskAssigned, notifyTaskMoved, notifyRACIAssigned } from '@/lib/slack-notifications'

interface TaskDetailProps {
  task: KanbanTask | null
  columns: KanbanColumn[]
  onClose: () => void
  onUpdate: (id: string, updates: Partial<KanbanTask>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  fetchComments: (taskId: string) => Promise<TaskComment[]>
  addComment: (taskId: string, author: string, content: string) => Promise<any>
  // Phase 1: Subtasks
  fetchSubtasks: (taskId: string) => Promise<Subtask[]>
  addSubtask: (taskId: string, title: string) => Promise<any>
  updateSubtask: (id: string, updates: Partial<Subtask>, taskId?: string) => Promise<any>
  deleteSubtask: (id: string, taskId?: string, title?: string) => Promise<any>
  // Phase 1: Activity
  fetchActivity: (taskId: string) => Promise<TaskActivity[]>
  currentUser: string
  teamMembers: string[]
  orgId: string
  projects?: Project[]
  allTasks?: KanbanTask[]
  fetchLinkedSubtasks?: (taskId: string) => Promise<KanbanTask[]>
  linkTaskAsSubtask?: (parentId: string, childId: string) => Promise<any>
  unlinkSubtask?: (childId: string, parentId: string) => Promise<any>
  fetchAttachments?: (taskId: string) => Promise<TaskAttachment[]>
  uploadAttachments?: (taskId: string, files: FileList) => Promise<any>
  deleteAttachment?: (attachmentId: string, taskId: string) => Promise<any>
  downloadAttachment?: (attachment: TaskAttachment) => Promise<void>
}

const RACI_ROLES = [
  { key: 'raci_responsible', label: 'Responsible', short: 'R', color: '#2563EB', desc: 'Does the work' },
  { key: 'raci_accountable', label: 'Accountable', short: 'A', color: '#DC2626', desc: 'Ultimately answerable' },
  { key: 'raci_consulted', label: 'Consulted', short: 'C', color: '#D97706', desc: 'Input sought' },
  { key: 'raci_informed', label: 'Informed', short: 'I', color: '#6B7280', desc: 'Kept updated' },
]

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'created this task',
  field_change: 'changed',
  subtask_added: 'added subtask',
  subtask_completed: 'completed subtask',
  subtask_uncompleted: 'unchecked subtask',
  subtask_removed: 'removed subtask',
  comment_added: 'commented',
}

export function TaskDetail({
  task, columns, onClose, onUpdate, onDelete,
  fetchComments, addComment,
  fetchSubtasks, addSubtask, updateSubtask, deleteSubtask,
  fetchActivity,
  currentUser, teamMembers, orgId, projects, allTasks,
  fetchLinkedSubtasks, linkTaskAsSubtask, unlinkSubtask,
  fetchAttachments, uploadAttachments, deleteAttachment, downloadAttachment,
}: TaskDetailProps) {
  const tasks = allTasks || []
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<KanbanTask['priority']>('medium')
  const [columnId, setColumnId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<KanbanTask['visibility']>('everyone')
  const [projectId, setProjectId] = useState<string>('')
  const [fields, setFields] = useState<Record<string, any>>({})
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)

  // RACI + intelligence fields
  const [raciResponsible, setRaciResponsible] = useState('')
  const [raciAccountable, setRaciAccountable] = useState('')
  const [raciConsulted, setRaciConsulted] = useState('')
  const [raciInformed, setRaciInformed] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [actualHours, setActualHours] = useState('')
  const [rockTags, setRockTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactName, setContactName] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [showContactPicker, setShowContactPicker] = useState(false)

  // Phase 1: Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [loadingSubtasks, setLoadingSubtasks] = useState(false)
  const [subtasksExpanded, setSubtasksExpanded] = useState(true)

  // Phase 1: Activity
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityExpanded, setActivityExpanded] = useState(false)

  // Dependencies
  const [depBlocks, setDepBlocks] = useState<TaskDependency[]>([])
  const [depBlockedBy, setDepBlockedBy] = useState<TaskDependency[]>([])
  const [depsExpanded, setDepsExpanded] = useState(true)
  const [addingDepType, setAddingDepType] = useState<'blocks' | 'blocked_by' | 'related' | null>(null)
  const [depSearch, setDepSearch] = useState('')

  // Linked subtasks
  const [linkedSubtasks, setLinkedSubtasks] = useState<KanbanTask[]>([])
  const [showLinkTaskModal, setShowLinkTaskModal] = useState(false)

  // Attachments
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setAssignee(task.assignee || '')
      setPriority(task.priority)
      setColumnId(task.column_id)
      setDueDate(task.due_date || '')
      setVisibility(task.visibility)
      setProjectId(task.project_id || '')
      setFields(task.custom_fields || {})
      // RACI
      setRaciResponsible(task.raci_responsible || task.custom_fields?.raci_responsible || '')
      setRaciAccountable(task.raci_accountable || task.custom_fields?.raci_accountable || '')
      setRaciConsulted(task.raci_consulted?.[0] || task.custom_fields?.raci_consulted || '')
      setRaciInformed(task.raci_informed?.[0] || task.custom_fields?.raci_informed || '')
      setEstimatedHours(task.estimated_hours?.toString() || '')
      setActualHours(task.actual_hours?.toString() || '')
      setRockTags(task.rock_tags || [])
      setContactId(task.contact_id || null)
      setContactName('')
      setNewTag('')
      setShowContactPicker(false)
      // Load contact name if linked
      if (task.contact_id) {
        import('@/lib/supabase-browser').then(({ createClient }) => {
          createClient().from('contacts').select('first_name, last_name').eq('id', task.contact_id!).maybeSingle()
            .then(({ data }) => { if (data) setContactName(`${data.first_name || ''} ${data.last_name || ''}`.trim()) })
        })
      }
      loadComments(task.id)
      loadSubtasks(task.id)
      loadActivity(task.id)
      loadDependencies(task.id)
      if (fetchLinkedSubtasks) fetchLinkedSubtasks(task.id).then(setLinkedSubtasks)
      if (fetchAttachments) fetchAttachments(task.id).then(setAttachments)
    }
  }, [task])

  const loadComments = async (taskId: string) => {
    setLoadingComments(true)
    const data = await fetchComments(taskId)
    setComments(data)
    setLoadingComments(false)
  }

  const loadSubtasks = async (taskId: string) => {
    setLoadingSubtasks(true)
    const data = await fetchSubtasks(taskId)
    setSubtasks(data)
    setLoadingSubtasks(false)
  }

  const loadActivity = async (taskId: string) => {
    setLoadingActivity(true)
    const data = await fetchActivity(taskId)
    setActivities(data)
    setLoadingActivity(false)
  }

  const loadDependencies = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/dependencies?task_id=${taskId}`)
      const data = await res.json()
      setDepBlocks(data.blocks || [])
      setDepBlockedBy(data.blocked_by || [])
    } catch {}
  }

  const handleAddDependency = async (targetTaskId: string) => {
    if (!task || !addingDepType) return
    // Determine direction based on type
    const blocker = addingDepType === 'blocked_by' ? targetTaskId : task.id
    const blocked = addingDepType === 'blocked_by' ? task.id : targetTaskId
    const depType = addingDepType === 'related' ? 'related' : 'blocks'
    const res = await fetch('/api/tasks/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_task_id: blocker, blocked_task_id: blocked, dependency_type: depType }),
    })
    const data = await res.json()
    if (data.error) { alert(data.error); return }
    setAddingDepType(null)
    setDepSearch('')
    loadDependencies(task.id)
  }

  const handleRemoveDependency = async (depId: string) => {
    if (!task) return
    await fetch(`/api/tasks/dependencies?id=${depId}`, { method: 'DELETE' })
    loadDependencies(task.id)
  }

  if (!task) return null

  const save = async (field: string, value: any) => {
    await onUpdate(task.id, { [field]: value })
  }

  const saveFields = async (updates: Record<string, any>) => {
    const merged = { ...fields, ...updates }
    setFields(merged)
    await save('custom_fields', merged)
  }

  // Sync subtask counts to parent task custom_fields for card display
  const syncSubtaskCounts = async (list: Subtask[]) => {
    const total = list.length
    const done = list.filter(s => s.completed).length
    await saveFields({ subtask_count: total, subtask_completed: done })
  }

  const saveRaci = async (role: string, value: string) => {
    if (role === 'raci_consulted' || role === 'raci_informed') {
      await onUpdate(task.id, {
        [role]: value ? [value] : [],
        custom_fields: { ...fields, [role]: value },
      })
    } else {
      await onUpdate(task.id, {
        [role]: value || null,
        custom_fields: { ...fields, [role]: value },
      })
    }
    setFields(prev => ({ ...prev, [role]: value }))
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return
    await addComment(task.id, currentUser, newComment.trim())
    setNewComment('')
    loadComments(task.id)
    saveFields({ comment_count: (fields.comment_count || 0) + 1 })
    loadActivity(task.id)
  }

  const handleAddSubtask = async () => {
    if (!newSubtask.trim()) return
    await addSubtask(task.id, newSubtask.trim())
    setNewSubtask('')
    const updated = await fetchSubtasks(task.id)
    setSubtasks(updated)
    syncSubtaskCounts(updated)
    loadActivity(task.id)
  }

  const handleToggleSubtask = async (st: Subtask) => {
    await updateSubtask(st.id, { completed: !st.completed }, task.id)
    const updated = subtasks.map(s => s.id === st.id ? { ...s, completed: !s.completed } : s)
    setSubtasks(updated)
    syncSubtaskCounts(updated)
    loadActivity(task.id)
  }

  const handleDeleteSubtask = async (st: Subtask) => {
    await deleteSubtask(st.id, task.id, st.title)
    const updated = subtasks.filter(s => s.id !== st.id)
    setSubtasks(updated)
    syncSubtaskCounts(updated)
    loadActivity(task.id)
  }

  const handleDelete = async () => {
    if (confirm('Delete this task?')) {
      await onDelete(task.id)
      onClose()
    }
  }

  const currentCol = columns.find(c => c.id === columnId)
  const subtaskDone = subtasks.filter(s => s.completed).length
  const subtaskPct = subtasks.length > 0 ? Math.round((subtaskDone / subtasks.length) * 100) : 0
  const isPrivate = visibility === 'private'

  return (<>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentCol?.color || '#6B7280' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: currentCol?.color }}>
              {currentCol?.title}
            </span>
            {isPrivate && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 flex items-center gap-0.5">
                <Lock className="w-3 h-3" /> Personal
              </span>
            )}
            {task.ai_generated && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5">
                <Zap className="w-3 h-3" /> AI Generated
              </span>
            )}
            {task.milestone && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                &#9670; Milestone
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleDelete} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* Tags */}
            <div>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {rockTags.map((tag, i) => (
                  <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 flex items-center gap-1">
                    {tag}
                    <button onClick={() => {
                      const updated = rockTags.filter((_, idx) => idx !== i)
                      setRockTags(updated)
                      save('rock_tags', updated)
                    }} className="text-violet-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input value={newTag} onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newTag.trim()) {
                        e.preventDefault()
                        const updated = [...rockTags, newTag.trim()]
                        setRockTags(updated)
                        save('rock_tags', updated)
                        setNewTag('')
                      }
                    }}
                    placeholder="+ Add tag"
                    className="text-[10px] border border-dashed border-gray-300 rounded-full px-2.5 py-0.5 w-24 focus:outline-none focus:border-violet-400 placeholder-gray-400" />
                </div>
              </div>
            </div>

            {/* Linked Contact */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact:</span>
              {contactId && contactName ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-np-blue">{contactName}</span>
                  <button onClick={() => { setContactId(null); setContactName(''); save('contact_id', null); onUpdate(task!.id, { custom_fields: { ...task!.custom_fields, contact_name: null } } as any) }}
                    className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
              ) : showContactPicker ? (
                <div className="relative flex-1">
                  <input value={contactSearch} onChange={async (e) => {
                    setContactSearch(e.target.value)
                    if (e.target.value.trim().length >= 2) {
                      const { createClient } = await import('@/lib/supabase-browser')
                      const { data } = await createClient().from('contacts').select('id, first_name, last_name')
                        .eq('org_id', orgId).is('archived_at', null)
                        .or(`first_name.ilike.%${e.target.value}%,last_name.ilike.%${e.target.value}%`)
                        .limit(8)
                      setContactResults(data || [])
                    } else { setContactResults([]) }
                  }}
                    placeholder="Search contacts..."
                    className="w-full text-[10px] border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" autoFocus />
                  {contactResults.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-100 rounded-lg shadow-lg z-50 max-h-32 overflow-y-auto">
                      {contactResults.map((c: any) => (
                        <button key={c.id} onClick={() => {
                          setContactId(c.id); setContactName(`${c.first_name || ''} ${c.last_name || ''}`.trim())
                          const name = `${c.first_name || ''} ${c.last_name || ''}`.trim()
                          save('contact_id', c.id); onUpdate(task!.id, { custom_fields: { ...task!.custom_fields, contact_name: name } } as any)
                          setShowContactPicker(false); setContactSearch(''); setContactResults([])
                        }}
                          className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-gray-50 truncate">
                          {c.first_name} {c.last_name}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowContactPicker(false); setContactSearch(''); setContactResults([]) }}
                    className="absolute right-1 top-1 text-gray-400"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <button onClick={() => setShowContactPicker(true)}
                  className="text-[10px] text-np-blue hover:underline">+ Link contact</button>
              )}
            </div>

            {/* Title */}
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => title !== task.title && save('title', title)}
              className="text-xl font-bold text-np-dark w-full bg-transparent focus:outline-none border-b-2 border-transparent focus:border-np-blue pb-1"
            />

            {/* Project */}
            {projects && projects.length > 0 && (
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <FolderOpen className="w-3 h-3 inline mr-0.5" /> Project
                </label>
                <select value={projectId}
                  onChange={e => {
                    const newProjId = e.target.value || null
                    setProjectId(e.target.value)
                    save('project_id', newProjId)
                  }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">No Project</option>
                  {projects.filter(p => p.status === 'active').map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Column + Priority + Assignee row */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <Flag className="w-3 h-3 inline mr-0.5" /> Column
                </label>
                <select value={columnId}
                  onChange={e => {
                    const newColId = e.target.value
                    const fromCol = columns.find(c => c.id === columnId)?.title || ''
                    const toCol = columns.find(c => c.id === newColId)?.title || ''
                    setColumnId(newColId)
                    save('column_id', newColId)
                    if (newColId !== task.column_id) {
                      const raciRoles = {
                        responsible: raciResponsible,
                        accountable: raciAccountable,
                        consulted: raciConsulted,
                        informed: raciInformed,
                      }
                      notifyTaskMoved(orgId, task.title, task.id, fromCol, toCol, currentUser, assignee, raciRoles)
                    }
                  }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Priority</label>
                <div className="flex gap-1">
                  {(Object.keys(PRIORITY_CONFIG) as Array<keyof typeof PRIORITY_CONFIG>).map(key => (
                    <button key={key} onClick={() => { setPriority(key); save('priority', key) }}
                      className="text-[9px] font-bold px-2 py-1.5 rounded-md border-2 transition-all flex-1"
                      style={{
                        backgroundColor: PRIORITY_CONFIG[key].bg,
                        color: PRIORITY_CONFIG[key].color,
                        borderColor: priority === key ? PRIORITY_CONFIG[key].color : 'transparent',
                      }}>
                      {PRIORITY_CONFIG[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <User className="w-3 h-3 inline mr-0.5" /> Assignee
                </label>
                <select value={assignee}
                  onChange={e => {
                    const newAssignee = e.target.value
                    setAssignee(newAssignee)
                    save('assignee', newAssignee)
                    if (newAssignee && newAssignee !== task.assignee) {
                      notifyTaskAssigned(orgId, task.title, task.id, newAssignee, currentUser)
                    }
                  }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">Unassigned</option>
                  {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Due Date + Time Tracking */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <Calendar className="w-3 h-3 inline mr-0.5" /> Due Date
                </label>
                <input type="date" value={dueDate}
                  onChange={e => { setDueDate(e.target.value); save('due_date', e.target.value || null) }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <Clock className="w-3 h-3 inline mr-0.5" /> Est. Hours
                </label>
                <input type="number" step="0.5" min="0" value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                  onBlur={() => save('estimated_hours', estimatedHours ? parseFloat(estimatedHours) : null)}
                  placeholder="0"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  <Clock className="w-3 h-3 inline mr-0.5" /> Actual Hours
                </label>
                <input type="number" step="0.5" min="0" value={actualHours}
                  onChange={e => setActualHours(e.target.value)}
                  onBlur={() => save('actual_hours', actualHours ? parseFloat(actualHours) : null)}
                  placeholder="0"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
            </div>

            {/* Visibility */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                <Eye className="w-3 h-3 inline mr-0.5" /> Visibility
              </label>
              <select value={visibility}
                onChange={e => {
                  const newVis = e.target.value as KanbanTask['visibility']
                  setVisibility(newVis)
                  save('visibility', newVis)
                }}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                <option value="everyone">Everyone</option>
                <option value="private">Personal (only me)</option>
                <option value="specific">Specific People</option>
              </select>
              {isPrivate && (
                <p className="text-[9px] text-violet-500 mt-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Only you can see this task
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Description</label>
              <textarea value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() => description !== (task.description || '') && save('description', description)}
                spellCheck autoCapitalize="sentences" autoCorrect="on"
                placeholder="Describe this task..." rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
            </div>

            {/* ═══ SUBTASKS / CHECKLIST ═══ */}
            {(() => {
              const linkedDone = linkedSubtasks.filter(t => {
                const doneCol = columns.find(c => c.title.toLowerCase().includes('done'))
                return t.column_id === doneCol?.id
              }).length
              const totalDone = subtaskDone + linkedDone
              const totalAll = subtasks.length + linkedSubtasks.length
              const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
              return (
                <div>
                  <button onClick={() => setSubtasksExpanded(!subtasksExpanded)} className="flex items-center gap-1.5 w-full mb-2">
                    <ListChecks className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      Subtasks ({totalDone}/{totalAll})
                    </span>
                    {totalAll > 0 && (
                      <div className="flex-1 max-w-[120px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300"
                          style={{ width: pct + '%', backgroundColor: pct === 100 ? '#10B981' : '#3B82F6' }} />
                      </div>
                    )}
                    {subtasksExpanded ? <ChevronUp className="w-3 h-3 text-gray-300 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-300 ml-auto" />}
                  </button>

                  {subtasksExpanded && (
                    <div className="space-y-1.5 mb-2">
                      {/* Inline subtasks */}
                      {loadingSubtasks ? (
                        <p className="text-xs text-gray-400 pl-5">Loading...</p>
                      ) : (
                        subtasks.map(st => (
                          <div key={st.id} className="flex items-center gap-2 group/st px-1 py-1 rounded hover:bg-gray-50">
                            <button onClick={() => handleToggleSubtask(st)} className="flex-shrink-0">
                              {st.completed ? <CheckSquare className="w-4 h-4 text-green-500" /> : <Square className="w-4 h-4 text-gray-300 hover:text-np-blue" />}
                            </button>
                            <span className={`text-xs flex-1 ${st.completed ? 'line-through text-gray-400' : 'text-np-dark'}`}>{st.title}</span>
                            <button onClick={() => handleDeleteSubtask(st)} className="opacity-0 group-hover/st:opacity-100 text-gray-300 hover:text-red-400 transition-opacity">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}

                      {/* Linked task cards */}
                      {linkedSubtasks.map(lt => {
                        const ltDone = columns.find(c => c.title.toLowerCase().includes('done'))?.id === lt.column_id
                        return (
                          <div key={lt.id} className={`border rounded-lg p-2.5 transition-all ${ltDone ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Link2 className="w-3 h-3 text-blue-600" />
                              <span className="text-[9px] font-bold text-blue-700 uppercase">Linked Task</span>
                              {ltDone && <span className="text-[9px] font-bold text-green-600 ml-auto">Done</span>}
                            </div>
                            <p className="text-xs font-medium text-np-dark mb-1">{lt.title}</p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500">
                              {lt.assignee && <span>{lt.assignee}</span>}
                              <span>{columns.find(c => c.id === lt.column_id)?.title}</span>
                              {lt.priority && (
                                <span className="px-1 py-0.5 rounded text-[9px] font-medium"
                                  style={{ backgroundColor: PRIORITY_CONFIG[lt.priority]?.bg, color: PRIORITY_CONFIG[lt.priority]?.color }}>
                                  {PRIORITY_CONFIG[lt.priority]?.label}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => { onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('openTaskDetail', { detail: lt })), 100) }}
                                className="text-[10px] px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-100 font-medium">
                                View Card
                              </button>
                              {unlinkSubtask && (
                                <button onClick={() => unlinkSubtask(lt.id, task!.id).then(() => fetchLinkedSubtasks?.(task!.id).then(d => setLinkedSubtasks(d || [])))}
                                  className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 font-medium">
                                  Unlink
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {subtasks.length === 0 && linkedSubtasks.length === 0 && !newSubtask && (
                        <p className="text-xs text-gray-400 pl-5">No subtasks yet</p>
                      )}

                      {/* Add inline subtask */}
                      <div className="flex items-center gap-2 pl-1 pt-1">
                        <Plus className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && newSubtask.trim()) handleAddSubtask(); if (e.key === 'Escape') setNewSubtask('') }}
                          placeholder="Add subtask..." spellCheck autoCapitalize="sentences"
                          className="flex-1 text-xs border-none focus:outline-none placeholder-gray-300 bg-transparent" />
                      </div>

                      {/* Link existing task */}
                      {linkTaskAsSubtask && (
                        <button onClick={() => setShowLinkTaskModal(true)}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-blue-300 text-blue-700 text-[10px] font-medium rounded-lg hover:bg-blue-50 transition-colors">
                          <Link2 className="w-3.5 h-3.5" /> Link Existing Task as Subtask
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* RACI Assignment */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">RACI Assignment</label>
              <div className="grid grid-cols-4 gap-2">
                {RACI_ROLES.map(role => {
                  const stateMap: Record<string, [string, (v: string) => void]> = {
                    raci_responsible: [raciResponsible, setRaciResponsible],
                    raci_accountable: [raciAccountable, setRaciAccountable],
                    raci_consulted: [raciConsulted, setRaciConsulted],
                    raci_informed: [raciInformed, setRaciInformed],
                  }
                  const [val, setVal] = stateMap[role.key]

                  return (
                    <div key={role.key}>
                      <label className="flex items-center gap-1 mb-1">
                        <span className="w-4 h-4 rounded text-[9px] font-bold text-white flex items-center justify-center"
                          style={{ background: role.color }}>{role.short}</span>
                        <span className="text-[9px] font-semibold" style={{ color: role.color }}>{role.label}</span>
                      </label>
                      <select
                        value={val}
                        onChange={e => {
                          const newPerson = e.target.value
                          setVal(newPerson)
                          saveRaci(role.key, newPerson)
                          if (newPerson && newPerson !== val) {
                            notifyRACIAssigned(orgId, task.title, task.id, role.label.toLowerCase(), newPerson, currentUser)
                          }
                        }}
                        className="w-full text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                        <option value="">--</option>
                        {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <p className="text-[8px] text-gray-400 mt-0.5">{role.desc}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* File Attachments */}
            {uploadAttachments && deleteAttachment && downloadAttachment && (
              <TaskAttachments
                taskId={task.id}
                attachments={attachments}
                onUpload={async (files) => {
                  const result = await uploadAttachments(task.id, files)
                  if (result.errors) alert(result.errors.join('\n'))
                  if (fetchAttachments) setAttachments(await fetchAttachments(task.id))
                }}
                onDelete={async (id) => {
                  if (!confirm('Delete this attachment?')) return
                  await deleteAttachment(id, task.id)
                  if (fetchAttachments) setAttachments(await fetchAttachments(task.id))
                }}
                onDownload={downloadAttachment}
              />
            )}

            {/* Linked Resources */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                <Link2 className="w-3 h-3 inline mr-0.5" /> Linked URLs
              </label>
              <div className="space-y-2">
                {['Google Sheet', 'Google Doc', 'Drive Folder', 'Other URL'].map(resType => {
                  const key = resType.toLowerCase().replace(/\s+/g, '_')
                  return (
                    <div key={key} className="flex gap-2">
                      <span className="text-[10px] text-gray-500 w-20 pt-1.5 flex-shrink-0">{resType}</span>
                      <input
                        value={fields[key] || ''}
                        onChange={e => saveFields({ [key]: e.target.value })}
                        placeholder="https://..."
                        className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                      {fields[key] && (
                        <a href={fields[key]} target="_blank" rel="noopener"
                          className="text-gray-400 hover:text-np-blue pt-1"><ExternalLink className="w-3.5 h-3.5" /></a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Comments */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-2">
                <MessageSquare className="w-3 h-3" /> Comments ({comments.length})
              </label>

              <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                {loadingComments ? (
                  <p className="text-xs text-gray-400">Loading...</p>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-gray-400">No comments yet</p>
                ) : comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-np-dark">{c.author}</span>
                      <span className="text-[9px] text-gray-400">
                        {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{c.content}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment() } }}
                  placeholder="Add a comment..."
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                <button onClick={handleAddComment}
                  className="text-xs bg-np-blue text-white px-3 py-2 rounded-lg font-medium hover:bg-np-blue/90">
                  Post
                </button>
              </div>
            </div>

            {/* ═══ DEPENDENCIES ═══ */}
            <div>
              <button onClick={() => setDepsExpanded(!depsExpanded)} className="flex items-center gap-1.5 w-full mb-3">
                <Link2 className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Dependencies ({depBlocks.length + depBlockedBy.length})
                </span>
                {depsExpanded ? <ChevronUp className="w-3 h-3 text-gray-300 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-300 ml-auto" />}
              </button>
              {depsExpanded && (
                <div className="space-y-4">

                  {/* THIS TASK BLOCKS */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">This task blocks</p>
                      <button onClick={() => setAddingDepType('blocks')} className="text-[10px] text-blue-600 hover:text-blue-700 font-medium">
                        + Add task that must wait for this
                      </button>
                    </div>
                    {depBlocks.length > 0 ? (
                      <div className="space-y-1.5">
                        {depBlocks.map(dep => (
                          <div key={dep.id} className="bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-2">
                            <Lock className="w-3 h-3 text-red-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-np-dark truncate">{(dep as any).blocked_task?.title || 'Unknown'}</p>
                              <p className="text-[9px] text-gray-400">
                                {(dep as any).blocked_task?.assignee || 'Unassigned'} · {columns.find(c => c.id === (dep as any).blocked_task?.column_id)?.title || ''}
                              </p>
                            </div>
                            <button onClick={() => handleRemoveDependency(dep.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-400 italic">No tasks waiting on this one</p>
                    )}
                  </div>

                  {/* BLOCKED BY */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">Blocked by</p>
                      <button onClick={() => setAddingDepType('blocked_by')} className="text-[10px] text-blue-600 hover:text-blue-700 font-medium">
                        + Add task this must wait for
                      </button>
                    </div>
                    {depBlockedBy.length > 0 ? (
                      <div className="space-y-1.5">
                        {depBlockedBy.map(dep => (
                          <div key={dep.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2 flex items-center gap-2">
                            <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-np-dark truncate">{(dep as any).blocker_task?.title || 'Unknown'}</p>
                              <p className="text-[9px] text-gray-400">
                                {(dep as any).blocker_task?.assignee || 'Unassigned'} · {columns.find(c => c.id === (dep as any).blocker_task?.column_id)?.title || ''}
                              </p>
                            </div>
                            <button onClick={() => handleRemoveDependency(dep.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-400 italic">No blockers — ready to start!</p>
                    )}
                  </div>

                  {/* RELATED TASKS */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">Related tasks</p>
                      <button onClick={() => setAddingDepType('related')} className="text-[10px] text-blue-600 hover:text-blue-700 font-medium">
                        + Add related task
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 italic">Link tasks for reference (no blocking)</p>
                  </div>

                  {/* Search panel — shared for all three add types */}
                  {addingDepType && (
                    <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold text-blue-700 mb-1.5">
                        {addingDepType === 'blocks' ? 'Select task that must wait for this one:' :
                         addingDepType === 'blocked_by' ? 'Select task this one must wait for:' :
                         'Select related task:'}
                      </p>
                      <input value={depSearch} onChange={e => setDepSearch(e.target.value)}
                        placeholder="Search tasks..."
                        spellCheck={false} autoComplete="off"
                        className="w-full text-[10px] border border-gray-200 rounded px-2 py-1.5 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300" autoFocus />
                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                        {depSearch.trim() && tasks
                          .filter(t => t.id !== task?.id && t.title.toLowerCase().includes(depSearch.toLowerCase()))
                          .slice(0, 10)
                          .map(t => (
                            <button key={t.id} onClick={() => handleAddDependency(t.id)}
                              className="w-full text-left text-[10px] px-2 py-1.5 rounded hover:bg-blue-100 truncate text-np-dark">
                              {t.title} <span className="text-gray-400">· {columns.find(c => c.id === t.column_id)?.title}</span>
                            </button>
                          ))
                        }
                      </div>
                      <button onClick={() => { setAddingDepType(null); setDepSearch('') }}
                        className="text-[9px] text-gray-500 mt-1.5 hover:text-gray-700">Cancel</button>
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* ═══ ACTIVITY FEED ═══ */}
            <div>
              <button
                onClick={() => setActivityExpanded(!activityExpanded)}
                className="flex items-center gap-1.5 w-full mb-2"
              >
                <Activity className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Activity ({activities.length})
                </span>
                {activityExpanded ? <ChevronUp className="w-3 h-3 text-gray-300 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-300 ml-auto" />}
              </button>

              {activityExpanded && (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {loadingActivity ? (
                    <p className="text-xs text-gray-400">Loading...</p>
                  ) : activities.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-5">No activity yet</p>
                  ) : (
                    activities.map(a => (
                      <div key={a.id} className="flex items-start gap-2 text-[10px] text-gray-500 pl-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                        <div className="flex-1">
                          <span className="font-semibold text-np-dark">{a.user_name || 'System'}</span>
                          {' '}{ACTIVITY_LABELS[a.action] || a.action}
                          {a.field && <span className="font-medium"> {a.field}</span>}
                          {a.old_value && a.new_value && (
                            <span>
                              {' '}from <span className="line-through text-gray-400">{a.old_value}</span>
                              {' '}to <span className="font-medium text-np-dark">{a.new_value}</span>
                            </span>
                          )}
                          {!a.old_value && a.new_value && a.action !== 'created' && (
                            <span className="font-medium text-np-dark"> {a.new_value}</span>
                          )}
                          <span className="text-gray-400 ml-1.5">
                            {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 text-[10px] text-gray-400">
          Created {new Date(task.created_at).toLocaleDateString()} &middot; Updated {new Date(task.updated_at).toLocaleDateString()}
          {task.ai_generated && ' \u00b7 AI Generated'}
          {task.approved_at && ` \u00b7 Approved ${new Date(task.approved_at).toLocaleDateString()}`}
          {isPrivate && ' \u00b7 Personal task'}
        </div>
      </div>
    </div>

    {/* Link Task Modal */}
    {showLinkTaskModal && task && linkTaskAsSubtask && (
      <LinkTaskModal
        isOpen={showLinkTaskModal}
        onClose={() => setShowLinkTaskModal(false)}
        currentTask={task}
        allTasks={tasks}
        columns={columns}
        onLink={async (childId) => {
          await linkTaskAsSubtask(task.id, childId)
          if (fetchLinkedSubtasks) {
            const updated = await fetchLinkedSubtasks(task.id)
            setLinkedSubtasks(updated)
          }
        }}
      />
    )}
  </>
  )
}
