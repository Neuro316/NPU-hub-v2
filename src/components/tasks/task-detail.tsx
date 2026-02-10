'use client'

import { useState, useEffect } from 'react'
import type { KanbanTask, KanbanColumn, TaskComment } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { X, Trash2, MessageSquare, Plus, Link2, Calendar, User, Flag, Eye, FileText, ExternalLink } from 'lucide-react'
import { notifyTaskAssigned, notifyTaskMoved, notifyRACIAssigned } from '@/lib/slack-notifications'

interface TaskDetailProps {
  task: KanbanTask | null
  columns: KanbanColumn[]
  onClose: () => void
  onUpdate: (id: string, updates: Partial<KanbanTask>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  fetchComments: (taskId: string) => Promise<TaskComment[]>
  addComment: (taskId: string, author: string, content: string) => Promise<any>
  currentUser: string
  teamMembers: string[]
  orgId: string
}

// Team members passed as prop

export function TaskDetail({
  task, columns, onClose, onUpdate, onDelete,
  fetchComments, addComment, currentUser, teamMembers, orgId,
}: TaskDetailProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<KanbanTask['priority']>('medium')
  const [columnId, setColumnId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<KanbanTask['visibility']>('everyone')
  const [fields, setFields] = useState<Record<string, any>>({})
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setAssignee(task.assignee || '')
      setPriority(task.priority)
      setColumnId(task.column_id)
      setDueDate(task.due_date || '')
      setVisibility(task.visibility)
      setFields(task.custom_fields || {})
      loadComments(task.id)
    }
  }, [task])

  const loadComments = async (taskId: string) => {
    setLoadingComments(true)
    const data = await fetchComments(taskId)
    setComments(data)
    setLoadingComments(false)
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

  const handleAddComment = async () => {
    if (!newComment.trim()) return
    await addComment(task.id, currentUser, newComment.trim())
    setNewComment('')
    loadComments(task.id)
    saveFields({ comment_count: (fields.comment_count || 0) + 1 })
  }

  const handleDelete = async () => {
    if (confirm('Delete this task?')) {
      await onDelete(task.id)
      onClose()
    }
  }

  const currentCol = columns.find(c => c.id === columnId)

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

            {/* Title */}
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => title !== task.title && save('title', title)}
              className="text-xl font-bold text-np-dark w-full bg-transparent focus:outline-none border-b-2 border-transparent focus:border-np-blue pb-1"
            />

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
                        responsible: fields.raci_responsible || '',
                        accountable: fields.raci_accountable || '',
                        consulted: fields.raci_consulted || '',
                        informed: fields.raci_informed || '',
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

            {/* Due Date + Visibility */}
            <div className="grid grid-cols-2 gap-3">
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
                  <Eye className="w-3 h-3 inline mr-0.5" /> Visibility
                </label>
                <select value={visibility}
                  onChange={e => { setVisibility(e.target.value as any); save('visibility', e.target.value) }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="everyone">Everyone</option>
                  <option value="private">Private</option>
                  <option value="specific">Specific People</option>
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Description</label>
              <textarea value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() => description !== (task.description || '') && save('description', description)}
                placeholder="Describe this task..." rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
            </div>

            {/* RACI */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">RACI Assignment</label>
              <div className="grid grid-cols-4 gap-2">
                {['responsible', 'accountable', 'consulted', 'informed'].map(role => (
                  <div key={role}>
                    <label className="text-[9px] text-gray-500 capitalize block mb-0.5">{role}</label>
                    <select
                      value={fields[`raci_${role}`] || ''}
                      onChange={e => {
                        const newPerson = e.target.value
                        saveFields({ [`raci_${role}`]: newPerson })
                        if (newPerson && newPerson !== fields[`raci_${role}`]) {
                          notifyRACIAssigned(orgId, task.title, task.id, role, newPerson, currentUser)
                        }
                      }}
                      className="w-full text-[10px] border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                      <option value="">--</option>
                      {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                ))}
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

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 text-[10px] text-gray-400">
          Created {new Date(task.created_at).toLocaleDateString()} · Updated {new Date(task.updated_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}
