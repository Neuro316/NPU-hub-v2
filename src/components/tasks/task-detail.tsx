'use client'

import { useState, useEffect } from 'react'
import type { KanbanTask, KanbanColumn, TaskComment, Subtask, TaskActivity, Project } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { X, Trash2, MessageSquare, Plus, Link2, Calendar, User, Flag, Eye, FileText, ExternalLink, Clock, Zap, AlertTriangle, ListChecks, CheckSquare, Square, Activity, ChevronDown, ChevronUp, Lock, FolderOpen } from 'lucide-react'
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
  currentUser, teamMembers, orgId, projects,
}: TaskDetailProps) {
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

  // Phase 1: Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [loadingSubtasks, setLoadingSubtasks] = useState(false)
  const [subtasksExpanded, setSubtasksExpanded] = useState(true)

  // Phase 1: Activity
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityExpanded, setActivityExpanded] = useState(false)

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
      loadComments(task.id)
      loadSubtasks(task.id)
      loadActivity(task.id)
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

  return (
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

            {/* Rock Tags */}
            {rockTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rockTags.map((tag, i) => (
                  <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    &#127919; {tag}
                  </span>
                ))}
              </div>
            )}

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

            {/* Visibility + Sequence */}
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  Sequence #
                </label>
                <input type="number" min="1"
                  value={task.sequence_order ?? ''}
                  onChange={e => save('sequence_order', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="--"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
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
            <div>
              <button
                onClick={() => setSubtasksExpanded(!subtasksExpanded)}
                className="flex items-center gap-1.5 w-full mb-2 group"
              >
                <ListChecks className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Subtasks ({subtaskDone}/{subtasks.length})
                </span>
                {subtasks.length > 0 && (
                  <div className="flex-1 max-w-[120px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: subtaskPct + '%',
                        backgroundColor: subtaskPct === 100 ? '#10B981' : '#3B82F6',
                      }}
                    />
                  </div>
                )}
                {subtasksExpanded ? <ChevronUp className="w-3 h-3 text-gray-300 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-300 ml-auto" />}
              </button>

              {subtasksExpanded && (
                <div className="space-y-1 mb-2">
                  {loadingSubtasks ? (
                    <p className="text-xs text-gray-400">Loading...</p>
                  ) : subtasks.length === 0 && !newSubtask ? (
                    <p className="text-xs text-gray-400 pl-5">No subtasks yet</p>
                  ) : (
                    subtasks.map(st => (
                      <div key={st.id} className="flex items-center gap-2 group/st px-1 py-1 rounded hover:bg-gray-50">
                        <button onClick={() => handleToggleSubtask(st)} className="flex-shrink-0">
                          {st.completed
                            ? <CheckSquare className="w-4 h-4 text-green-500" />
                            : <Square className="w-4 h-4 text-gray-300 hover:text-np-blue" />
                          }
                        </button>
                        <span className={`text-xs flex-1 ${st.completed ? 'line-through text-gray-400' : 'text-np-dark'}`}>
                          {st.title}
                        </span>
                        <button
                          onClick={() => handleDeleteSubtask(st)}
                          className="opacity-0 group-hover/st:opacity-100 text-gray-300 hover:text-red-400 transition-opacity"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add subtask input */}
                  <div className="flex items-center gap-2 pl-1 pt-1">
                    <Plus className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    <input
                      value={newSubtask}
                      onChange={e => setNewSubtask(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newSubtask.trim()) handleAddSubtask()
                        if (e.key === 'Escape') setNewSubtask('')
                      }}
                      placeholder="Add subtask..."
                      className="flex-1 text-xs border-none focus:outline-none placeholder-gray-300 bg-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

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

            {/* Linked Resources */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                <Link2 className="w-3 h-3 inline mr-0.5" /> Linked Resources
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
  )
}
