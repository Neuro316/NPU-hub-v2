'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Task Card + Detail — RACI, checklist, labels, file upload,
// media library, sendable resources
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Clock, CheckSquare, Square, X, Plus, ExternalLink, Timer,
  Upload, FileText, Trash2, Loader2, Paperclip, Download,
  Image as ImageIcon, FolderOpen, Send, Check
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import type { CrmTask, TeamMember } from '@/types/crm'

interface ChecklistItem { id: string; text: string; done: boolean }
interface TaskAttachment {
  id: string; name: string; file_url: string;
  file_type?: string; file_size?: number; uploaded_at?: string;
  sendable?: boolean
}
interface MediaAsset {
  id: string; name: string; url: string; mime_type: string | null;
  file_size: number | null; thumbnail_url: string | null
}

const RACI_LABELS = {
  accountable: { short: 'A', label: 'Accountable', color: '#386797', bg: '#3867971a', desc: 'Final decision maker' },
  responsible: { short: 'R', label: 'Responsible', color: '#2A9D8F', bg: '#2A9D8F1a', desc: 'Does the work' },
  consulted: { short: 'C', label: 'Consulted', color: '#d97706', bg: '#d977061a', desc: 'Provides input' },
  informed: { short: 'I', label: 'Informed', color: '#9CA3AF', bg: '#9CA3AF1a', desc: 'Kept in the loop' },
}

// ─── Compact Card ───

export function CrmTaskCard({ task, teamMembers, onClick, onDragStart }: {
  task: CrmTask; teamMembers: TeamMember[]; onClick: () => void; onDragStart?: (e: React.DragEvent) => void
}) {
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
  const checklist = (task.checklist as ChecklistItem[] | undefined) || []
  const labels = (task.labels as string[] | undefined) || []
  const checkDone = checklist.filter(c => c.done).length
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  const accountable = teamMembers.find(m => m.id === task.raci_accountable)
  const responsible = (task.raci_responsible || []).map(id => teamMembers.find(m => m.id === id)).filter(Boolean)
  const attachments = (task as any).attachments as TaskAttachment[] | undefined

  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      className="bg-white rounded-lg border border-gray-100 p-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: priority.bg, color: priority.color }}>{priority.label}</span>
        <div className="flex -space-x-1.5">
          {accountable && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white"
              style={{ background: RACI_LABELS.accountable.bg }} title={`A: ${accountable.display_name}`}>
              <span className="text-[7px] font-bold" style={{ color: RACI_LABELS.accountable.color }}>
                {accountable.display_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
          )}
          {responsible.slice(0, 2).map(m => m && (
            <div key={m.id} className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white"
              style={{ background: RACI_LABELS.responsible.bg }} title={`R: ${m.display_name}`}>
              <span className="text-[7px] font-bold" style={{ color: RACI_LABELS.responsible.color }}>
                {m.display_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs font-semibold text-np-dark leading-snug mb-1.5">{task.title}</p>
      {task.description && <p className="text-[10px] text-gray-400 line-clamp-2 leading-snug mb-2">{task.description}</p>}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {labels.slice(0, 3).map(l => <span key={l} className="px-1.5 py-0.5 bg-gray-50 text-[8px] font-medium text-gray-500 rounded">{l}</span>)}
        </div>
      )}
      <div className="flex items-center gap-2 text-[9px] text-gray-400">
        {task.due_date && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Clock className="w-3 h-3" />{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {checklist.length > 0 && (
          <span className={`flex items-center gap-0.5 ${checkDone === checklist.length ? 'text-green-500' : ''}`}>
            <CheckSquare className="w-3 h-3" /> {checkDone}/{checklist.length}
          </span>
        )}
        {task.estimated_minutes && <span className="flex items-center gap-0.5"><Timer className="w-3 h-3" />{task.estimated_minutes}m</span>}
        {attachments && attachments.length > 0 && <span className="flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{attachments.length}</span>}
        {task.hub_task_id && <span className="flex items-center gap-0.5 text-gray-300"><ExternalLink className="w-3 h-3" /> Synced</span>}
      </div>
    </div>
  )
}

// ─── Detail Modal — Create + Edit ───

interface CrmTaskDetailEditProps {
  task: CrmTask; teamMembers: TeamMember[]; onUpdate: (id: string, updates: Partial<CrmTask>) => void
  onClose: () => void; createMode?: false; onCreate?: never; contactId?: never; orgId?: never; createdBy?: never
}
interface CrmTaskDetailCreateProps {
  task?: never; teamMembers: TeamMember[]; onUpdate?: never; onClose: () => void
  createMode: true; onCreate: (task: CrmTask) => void; contactId: string; orgId: string; createdBy: string
}
type CrmTaskDetailProps = CrmTaskDetailEditProps | CrmTaskDetailCreateProps

export function CrmTaskDetail(props: CrmTaskDetailProps) {
  const { teamMembers, onClose } = props
  const isCreate = props.createMode === true
  const task = isCreate ? null : props.task
  const supabase = createClient()

  const [title, setTitle] = useState(task?.title || '')
  const [description, setDescription] = useState(task?.description || '')
  const [pri, setPri] = useState(task?.priority || 'medium')
  const [dueDate, setDueDate] = useState(task?.due_date || '')
  const [status, setStatus] = useState(task?.status || 'todo')
  const [checklist, setChecklist] = useState<ChecklistItem[]>((task?.checklist as ChecklistItem[]) || [])
  const [labels, setLabels] = useState<string[]>((task?.labels as string[]) || [])
  const [newCheck, setNewCheck] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [estMin, setEstMin] = useState(task?.estimated_minutes || 0)
  const [actMin, setActMin] = useState(task?.actual_minutes || 0)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(isCreate)

  // RACI
  const [accountable, setAccountable] = useState<string | null>(task?.raci_accountable || null)
  const [responsible, setResponsible] = useState<string[]>(task?.raci_responsible || [])
  const [consulted, setConsulted] = useState<string[]>(task?.raci_consulted || [])
  const [informed, setInformed] = useState<string[]>(task?.raci_informed || [])

  // Attachments
  const [attachments, setAttachments] = useState<TaskAttachment[]>(((task as any)?.attachments as TaskAttachment[]) || [])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Media library browser
  const [showMediaLib, setShowMediaLib] = useState(false)
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaSearch, setMediaSearch] = useState('')

  // Refs for focus
  const checkInputRef = useRef<HTMLInputElement>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

  const orgId = isCreate ? props.orgId : task?.org_id

  const toggleMulti = (arr: string[], setArr: (fn: (p: string[]) => string[]) => void, id: string) => {
    setArr(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }

  // Load media library
  const loadMediaLibrary = useCallback(async () => {
    if (!orgId) return
    setMediaLoading(true)
    const { data } = await supabase.from('media_assets')
      .select('id, name, url, mime_type, file_size, thumbnail_url')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50)
    setMediaAssets(data || [])
    setMediaLoading(false)
  }, [orgId])

  useEffect(() => {
    if (showMediaLib) loadMediaLibrary()
  }, [showMediaLib, loadMediaLibrary])

  const filteredMedia = mediaSearch
    ? mediaAssets.filter(a => a.name.toLowerCase().includes(mediaSearch.toLowerCase()))
    : mediaAssets

  async function handleFileUpload(file: File) {
    setUploading(true)
    const path = `tasks/${orgId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('pipeline-resources').upload(path, file)
    if (error) { console.error('Upload error:', error); setUploading(false); return }
    const { data: urlData } = supabase.storage.from('pipeline-resources').getPublicUrl(path)
    setAttachments(prev => [...prev, {
      id: `att-${Date.now()}`, name: file.name, file_url: urlData.publicUrl,
      file_type: file.type, file_size: file.size, uploaded_at: new Date().toISOString(),
      sendable: false,
    }])
    setUploading(false)
  }

  function attachFromMediaLibrary(asset: MediaAsset) {
    if (attachments.some(a => a.file_url === asset.url)) return
    setAttachments(prev => [...prev, {
      id: `media-${asset.id}`, name: asset.name, file_url: asset.url,
      file_type: asset.mime_type || undefined, file_size: asset.file_size || undefined,
      uploaded_at: new Date().toISOString(), sendable: false,
    }])
    setShowMediaLib(false)
  }

  function toggleSendable(id: string) {
    setAttachments(prev => prev.map(a => a.id === id ? { ...a, sendable: !a.sendable } : a))
  }

  async function sendSelectedResources() {
    const selected = attachments.filter(a => a.sendable)
    if (selected.length === 0) return
    setSending(true)
    // TODO: hook into your email send API - for now, placeholder
    try {
      await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: '', // filled by contact email
          from_email: 'cameron.allen@gmail.com',
          subject: `Resources: ${title || 'Task'}`,
          body_html: `<p>Here are the resources for your reference:</p><ul>${
            selected.map(a => `<li><a href="${a.file_url}">${a.name}</a></li>`).join('')
          }</ul>`,
          contact_id: isCreate ? props.contactId : task?.contact_id,
          org_id: orgId,
        }),
      })
      // Uncheck after send
      setAttachments(prev => prev.map(a => ({ ...a, sendable: false })))
    } catch (e) { console.error('Send error:', e) }
    setSending(false)
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  function addChecklistItem() {
    if (!newCheck.trim()) return
    setChecklist(p => [...p, { id: `chk-${Date.now()}`, text: newCheck.trim(), done: false }])
    setNewCheck('')
    setTimeout(() => checkInputRef.current?.focus(), 50)
  }

  function addLabel() {
    if (!newLabel.trim()) return
    setLabels(p => [...p, newLabel.trim()])
    setNewLabel('')
    setTimeout(() => labelInputRef.current?.focus(), 50)
  }

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const fields: any = {
      title, description: description || null, priority: pri, status,
      due_date: dueDate || null, checklist, labels, attachments,
      estimated_minutes: estMin || null, actual_minutes: actMin || null,
      raci_responsible: responsible, raci_accountable: accountable,
      raci_consulted: consulted, raci_informed: informed,
    }
    if (isCreate) {
      const { data, error } = await supabase.from('tasks').insert({
        ...fields, org_id: props.orgId, contact_id: props.contactId,
        source: 'manual', created_by: props.createdBy, assigned_to: accountable || undefined,
      }).select().single()
      if (!error && data) { props.onCreate(data as CrmTask); onClose() }
      else { console.error('Create error:', error); alert('Failed to create task') }
    } else {
      const { error } = await supabase.from('tasks').update(fields).eq('id', task!.id)
      if (!error) { props.onUpdate(task!.id, fields); setEditing(false) }
    }
    setSaving(false)
  }

  async function syncToHub() {
    if (!task) return
    const res = await fetch('/api/tasks/sync-to-hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: task.id }),
    })
    const data = await res.json()
    if (data.hub_task_id && props.onUpdate)
      props.onUpdate(task.id, { hub_task_id: data.hub_task_id, last_synced_at: new Date().toISOString() } as any)
  }

  const priority = PRIORITY_CONFIG[pri] || PRIORITY_CONFIG.medium
  const checkDone = checklist.filter(c => c.done).length
  const selectedCount = attachments.filter(a => a.sendable).length

  return (
    <div className="fixed inset-0 bg-black/30 z-[55] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex-1">
            {editing ? (
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="text-sm font-bold text-np-dark bg-transparent border-b-2 border-np-blue outline-none w-full"
                placeholder="Task title..." autoFocus />
            ) : <h2 className="text-sm font-bold text-np-dark">{title}</h2>}
            {isCreate && <p className="text-[10px] text-gray-400 mt-0.5">New task for this contact</p>}
          </div>
          <div className="flex gap-1.5 ml-3">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="px-2.5 py-1 text-[10px] font-medium text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5">Edit</button>
            ) : (
              <button onClick={save} disabled={!title.trim() || saving}
                className="px-3 py-1 text-[10px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark disabled:opacity-40">
                {saving ? 'Saving...' : isCreate ? 'Create Task' : 'Save'}
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-50 rounded"><X size={14} className="text-gray-400" /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Row 1: Status, Priority, Due, Time */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Status</label>
              {editing ? (
                <select value={status} onChange={e => setStatus(e.target.value as any)}
                  className="w-full px-2 py-1.5 text-[10px] border border-gray-200 rounded-md text-np-dark bg-white">
                  <option value="todo">To Do</option><option value="in_progress">In Progress</option>
                  <option value="done">Done</option><option value="cancelled">Cancelled</option>
                </select>
              ) : <span className="text-xs font-medium text-np-dark capitalize">{status.replace('_', ' ')}</span>}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Priority</label>
              {editing ? (
                <select value={pri} onChange={e => setPri(e.target.value as any)}
                  className="w-full px-2 py-1.5 text-[10px] border border-gray-200 rounded-md text-np-dark bg-white">
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              ) : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: priority.bg, color: priority.color }}>{priority.label}</span>}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Due</label>
              {editing ? (
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-gray-200 rounded-md text-np-dark bg-white" />
              ) : <span className="text-xs text-gray-600">{dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None'}</span>}
            </div>
            <div>
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Est/Act</label>
              {editing ? (
                <div className="flex items-center gap-1">
                  <input type="number" value={estMin || ''} onChange={e => setEstMin(+e.target.value)}
                    className="w-12 px-1.5 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white" placeholder="Est" />
                  <span className="text-[8px] text-gray-300">/</span>
                  <input type="number" value={actMin || ''} onChange={e => setActMin(+e.target.value)}
                    className="w-12 px-1.5 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white" placeholder="Act" />
                </div>
              ) : <span className="text-xs text-gray-600">{estMin || 0}m / {actMin || 0}m</span>}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Description</label>
            {editing ? (
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white" placeholder="What needs to be done..." />
            ) : <p className="text-xs text-gray-600 whitespace-pre-wrap">{description || 'No description'}</p>}
          </div>

          {/* RACI */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">RACI Assignments</label>
            <div className="space-y-2.5">
              {/* Accountable (A) */}
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-1.5 w-28 pt-1.5 flex-shrink-0">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ background: RACI_LABELS.accountable.bg, color: RACI_LABELS.accountable.color }}>A</span>
                  <div>
                    <span className="text-[10px] font-medium text-np-dark">Accountable</span>
                    <p className="text-[8px] text-gray-400 leading-tight">{RACI_LABELS.accountable.desc}</p>
                  </div>
                </div>
                {editing ? (
                  <select value={accountable || ''} onChange={e => setAccountable(e.target.value || null)}
                    className="flex-1 px-2.5 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white text-np-dark">
                    <option value="">Select team member...</option>
                    {teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}{m.job_title ? ` — ${m.job_title}` : ''}</option>)}
                  </select>
                ) : <span className="text-xs text-gray-600 pt-1.5">{teamMembers.find(m => m.id === accountable)?.display_name || 'Unassigned'}</span>}
              </div>

              {/* R, C, I — multi chip select */}
              {([
                { key: 'responsible' as const, state: responsible, setter: setResponsible, cfg: RACI_LABELS.responsible, activeColor: 'border-teal-300 bg-teal-50 text-teal-700' },
                { key: 'consulted' as const, state: consulted, setter: setConsulted, cfg: RACI_LABELS.consulted, activeColor: 'border-amber-300 bg-amber-50 text-amber-700' },
                { key: 'informed' as const, state: informed, setter: setInformed, cfg: RACI_LABELS.informed, activeColor: 'border-gray-400 bg-gray-100 text-gray-600' },
              ]).map(({ key, state, setter, cfg, activeColor }) => (
                <div key={key} className="flex items-start gap-3">
                  <div className="flex items-center gap-1.5 w-28 pt-1.5 flex-shrink-0">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                      style={{ background: cfg.bg, color: cfg.color }}>{cfg.short}</span>
                    <div>
                      <span className="text-[10px] font-medium text-np-dark">{cfg.label}</span>
                      <p className="text-[8px] text-gray-400 leading-tight">{cfg.desc}</p>
                    </div>
                  </div>
                  <div className="flex-1">
                    {editing ? (
                      <div className="flex flex-wrap gap-1">
                        {teamMembers.map(m => {
                          const sel = state.includes(m.id)
                          return (
                            <button key={m.id} type="button" onClick={() => toggleMulti(state, setter, m.id)}
                              className={`px-2 py-1 text-[9px] rounded-md border transition-all ${
                                sel ? `${activeColor} font-medium` : 'border-gray-200 text-gray-400 hover:border-gray-300 bg-white'
                              }`}>
                              {m.display_name}
                            </button>
                          )
                        })}
                        {teamMembers.length === 0 && <span className="text-[10px] text-gray-400 italic py-1">No team members</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600 pt-1.5">
                        {state.map(id => teamMembers.find(m => m.id === id)?.display_name).filter(Boolean).join(', ') || 'None'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Labels */}
          <div>
            <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Labels</label>
            <div className="flex flex-wrap items-center gap-1">
              {labels.map(l => (
                <span key={l} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-50 text-[9px] font-medium text-gray-500 rounded">
                  {l}{editing && <button type="button" onClick={() => setLabels(p => p.filter(x => x !== l))}><X size={8} className="text-gray-400" /></button>}
                </span>
              ))}
              {editing && (
                <div className="flex items-center gap-1">
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }}
                    placeholder="+ label"
                    className="w-20 px-1.5 py-1 text-[9px] border border-dashed border-gray-300 rounded bg-white focus:outline-none focus:border-np-blue focus:ring-1 focus:ring-np-blue/20 cursor-text"
                  />
                  {newLabel.trim() && (
                    <button type="button" onClick={addLabel} className="p-0.5 rounded hover:bg-gray-100">
                      <Plus size={10} className="text-np-blue" />
                    </button>
                  )}
                </div>
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
                  <button type="button" onClick={() => editing && setChecklist(p => p.map(c => c.id === item.id ? { ...c, done: !c.done } : c))}>
                    {item.done ? <CheckSquare size={14} className="text-green-500" /> : <Square size={14} className="text-gray-300" />}
                  </button>
                  <span className={`flex-1 text-[10px] ${item.done ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{item.text}</span>
                  {editing && <button type="button" onClick={() => setChecklist(p => p.filter(c => c.id !== item.id))} className="opacity-0 group-hover:opacity-100"><X size={10} className="text-gray-400" /></button>}
                </div>
              ))}
              {editing && (
                <div className="flex items-center gap-1.5 mt-1">
                  <button type="button" onClick={() => checkInputRef.current?.focus()}>
                    <Plus size={14} className="text-gray-400" />
                  </button>
                  <input
                    ref={checkInputRef}
                    type="text"
                    value={newCheck}
                    onChange={e => setNewCheck(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() } }}
                    placeholder="Add checklist item..."
                    className="flex-1 text-[10px] bg-white border border-dashed border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-np-blue focus:ring-1 focus:ring-np-blue/20 placeholder-gray-300 cursor-text"
                  />
                  {newCheck.trim() && (
                    <button type="button" onClick={addChecklistItem} className="p-0.5 rounded hover:bg-gray-100">
                      <Plus size={10} className="text-np-blue" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Attachments & Resources */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Attachments & Resources</label>
              {selectedCount > 0 && (
                <button type="button" onClick={sendSelectedResources} disabled={sending}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark disabled:opacity-40">
                  {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send {selectedCount} to Contact
                </button>
              )}
            </div>

            {attachments.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {attachments.map(att => (
                  <div key={att.id} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded-lg group">
                    {/* Sendable checkbox */}
                    <button type="button" onClick={() => toggleSendable(att.id)}
                      className="flex-shrink-0 w-4 h-4 rounded border border-gray-300 flex items-center justify-center hover:border-np-blue transition-colors"
                      title="Select to send to contact">
                      {att.sendable && <Check className="w-3 h-3 text-np-blue" />}
                    </button>
                    <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-np-dark truncate">{att.name}</p>
                      <p className="text-[8px] text-gray-400">{att.file_type?.split('/').pop()}{att.file_size ? ` · ${formatSize(att.file_size)}` : ''}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {att.file_url && <a href={att.file_url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-white"><Download className="w-3 h-3 text-gray-400" /></a>}
                      {editing && <button type="button" onClick={() => setAttachments(p => p.filter(a => a.id !== att.id))} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3 h-3 text-gray-400 hover:text-red-500" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editing && (
              <div className="space-y-2">
                <input ref={fileRef} type="file" className="hidden" multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.mp4,.zip,.csv,.txt"
                  onChange={e => { Array.from(e.target.files || []).forEach(f => handleFileUpload(f)); e.target.value = '' }} />

                <div className="flex gap-2">
                  {/* Upload from Computer */}
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-[10px] text-gray-500 hover:border-np-blue hover:text-np-blue transition-colors disabled:opacity-40">
                    {uploading ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading...</> : <><Upload className="w-3.5 h-3.5" /> From Computer</>}
                  </button>

                  {/* Attach from Media Library */}
                  <button type="button" onClick={() => setShowMediaLib(!showMediaLib)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-[10px] text-gray-500 hover:border-np-blue hover:text-np-blue transition-colors">
                    <FolderOpen className="w-3.5 h-3.5" /> Media Library
                  </button>
                </div>

                {/* Media Library Browser */}
                {showMediaLib && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-[9px] font-semibold text-gray-500 uppercase">Media Library</span>
                      <button type="button" onClick={() => setShowMediaLib(false)}><X size={12} className="text-gray-400" /></button>
                    </div>
                    <div className="px-2 py-1.5">
                      <input type="text" value={mediaSearch} onChange={e => setMediaSearch(e.target.value)}
                        placeholder="Search media..."
                        className="w-full px-2 py-1 text-[10px] border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20" />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {mediaLoading ? (
                        <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>
                      ) : filteredMedia.length === 0 ? (
                        <p className="text-center text-[10px] text-gray-400 py-4">No media found</p>
                      ) : (
                        <div className="space-y-0.5 px-1 pb-1">
                          {filteredMedia.map(asset => {
                            const alreadyAttached = attachments.some(a => a.file_url === asset.url)
                            return (
                              <button key={asset.id} type="button" onClick={() => !alreadyAttached && attachFromMediaLibrary(asset)}
                                disabled={alreadyAttached}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                                  alreadyAttached ? 'bg-green-50 opacity-60' : 'hover:bg-np-blue/5'
                                }`}>
                                {asset.thumbnail_url ? (
                                  <img src={asset.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                                    {asset.mime_type?.startsWith('image') ? <ImageIcon className="w-4 h-4 text-gray-400" /> : <FileText className="w-4 h-4 text-gray-400" />}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-medium text-np-dark truncate">{asset.name}</p>
                                  <p className="text-[8px] text-gray-400">{asset.mime_type?.split('/').pop()}{asset.file_size ? ` · ${formatSize(asset.file_size)}` : ''}</p>
                                </div>
                                {alreadyAttached && <Check className="w-3 h-3 text-green-500 flex-shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Hub sync */}
          {!isCreate && task && (
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ExternalLink size={12} className="text-gray-300" />
                <span className="text-[9px] text-gray-400">
                  {task.hub_task_id ? `Synced · ${task.last_synced_at ? new Date(task.last_synced_at as string).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}` : 'Not synced to Hub Board'}
                </span>
              </div>
              <button type="button" onClick={syncToHub} className="px-2.5 py-1 text-[9px] font-medium text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5">
                {task.hub_task_id ? 'Re-sync' : 'Sync to Hub'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
