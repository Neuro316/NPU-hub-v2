'use client'

import { useState, useEffect } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { STATUS_CONFIG } from '@/lib/types/journey'
import { X, Plus, Trash2, Link2, FolderOpen, Mail, ExternalLink, FileText, Upload, Zap, Hand, RefreshCw } from 'lucide-react'

const SECTION_LABELS = [
  'Paid Traffic', 'Organic', 'Lead Magnet', 'Email', 'Landing Page',
  'Quiz / Assessment', 'Nurture', 'Sales Page', 'Discovery Call', 'Payment',
  'Welcome', 'Setup', 'Orientation', 'VR Session', 'Curriculum',
  'Daily Practice', 'Community', 'Coaching', 'Assessment', 'Certificate',
  'Follow-Up', 'Testimonial', 'Alumni', 'Referral', 'Newsletter',
  'Blog', 'Social Media', 'Podcast', 'Webinar', 'Retargeting',
]

const AUTOMATION_OPTIONS = [
  { value: 'manual', label: 'Manual', icon: Hand, color: '#9CA3AF' },
  { value: 'automated', label: 'Automated', icon: Zap, color: '#F59E0B' },
  { value: 'hybrid', label: 'Manual/Auto', icon: RefreshCw, color: '#06B6D4' },
]

interface Asset {
  name: string
  type: 'link' | 'file' | 'drive' | 'email'
  url: string
  description: string
  status: 'missing' | 'mvp' | 'polished'
}

interface CardFields {
  section_label?: string
  automation?: string
  drive_folder?: string
  linked_tasks?: string[]
  assets?: Asset[]
  email_template?: string
  notes?: string
}

interface CardDetailPanelProps {
  card: JourneyCard | null
  phases: JourneyPhase[]
  onClose: () => void
  onUpdate: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDelete: (id: string) => Promise<any>
}

export function CardDetailPanel({ card, phases, onClose, onUpdate, onDelete }: CardDetailPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<JourneyCard['status']>('not_started')
  const [phaseId, setPhaseId] = useState('')
  const [fields, setFields] = useState<CardFields>({})
  const [addingAsset, setAddingAsset] = useState(false)
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({ type: 'link', status: 'missing' })
  const [newTask, setNewTask] = useState('')

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setDescription(card.description || '')
      setStatus(card.status)
      setPhaseId(card.phase_id)
      setFields(card.custom_fields || {})
    }
  }, [card])

  if (!card) return null

  const save = async (field: string, value: any) => {
    await onUpdate(card.id, { [field]: value })
  }

  const saveFields = async (updates: Partial<CardFields>) => {
    const merged = { ...fields, ...updates }
    setFields(merged)
    await save('custom_fields', merged)
  }

  const handleAddAsset = () => {
    if (!newAsset.name) return
    const assets = [...(fields.assets || []), newAsset as Asset]
    saveFields({ assets })
    setNewAsset({ type: 'link', status: 'missing' })
    setAddingAsset(false)
  }

  const handleRemoveAsset = (idx: number) => {
    const assets = (fields.assets || []).filter((_, i) => i !== idx)
    saveFields({ assets })
  }

  const handleAddTask = () => {
    if (!newTask.trim()) return
    const tasks = [...(fields.linked_tasks || []), newTask.trim()]
    saveFields({ linked_tasks: tasks })
    setNewTask('')
  }

  const handleRemoveTask = (idx: number) => {
    const tasks = (fields.linked_tasks || []).filter((_, i) => i !== idx)
    saveFields({ linked_tasks: tasks })
  }

  const handleDelete = async () => {
    if (confirm('Delete this card?')) {
      await onDelete(card.id)
      onClose()
    }
  }

  const currentPhase = phases.find(p => p.id === phaseId)

  const assetStatusColors = {
    missing: { bg: '#FEE2E2', color: '#EF4444', label: 'Missing' },
    mvp: { bg: '#FEF3C7', color: '#F59E0B', label: 'MVP' },
    polished: { bg: '#D1FAE5', color: '#10B981', label: 'Polished' },
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-gray-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderBottomColor: currentPhase?.color || '#386797', borderBottomWidth: 3 }}
        >
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentPhase?.color }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: currentPhase?.color }}>
              {currentPhase?.label}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Title */}
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => title !== card.title && save('title', title)}
              className="text-lg font-bold text-np-dark w-full bg-transparent focus:outline-none border-b-2 border-transparent focus:border-np-blue pb-1"
            />

            {/* Status Row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Status</label>
                <div className="flex gap-1.5">
                  {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map(key => (
                    <button
                      key={key}
                      onClick={() => { setStatus(key); save('status', key) }}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-md border-2 transition-all"
                      style={{
                        backgroundColor: STATUS_CONFIG[key].bg,
                        color: STATUS_CONFIG[key].color,
                        borderColor: status === key ? STATUS_CONFIG[key].color : 'transparent',
                      }}
                    >
                      {STATUS_CONFIG[key].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Automation</label>
                <div className="flex gap-1">
                  {AUTOMATION_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    const isActive = fields.automation === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => saveFields({ automation: opt.value })}
                        className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border-2 transition-all"
                        style={{
                          borderColor: isActive ? opt.color : 'transparent',
                          backgroundColor: isActive ? opt.color + '15' : '#F9FAFB',
                          color: isActive ? opt.color : '#9CA3AF',
                        }}
                        title={opt.label}
                      >
                        <Icon className="w-3 h-3" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Section Label + Path */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Section Label</label>
                <select
                  value={fields.section_label || ''}
                  onChange={e => saveFields({ section_label: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                >
                  <option value="">None</option>
                  {SECTION_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Path</label>
                <select
                  value={phaseId}
                  onChange={e => { setPhaseId(e.target.value); save('phase_id', e.target.value) }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                >
                  {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() => description !== card.description && save('description', description)}
                placeholder="What happens at this step..."
                rows={3}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none"
              />
            </div>

            {/* Google Drive Folder */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <FolderOpen className="w-3 h-3" /> Google Drive Folder
              </label>
              <div className="flex gap-2">
                <input
                  value={fields.drive_folder || ''}
                  onChange={e => saveFields({ drive_folder: e.target.value })}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300"
                />
                {fields.drive_folder && (
                  <a
                    href={fields.drive_folder}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-1 text-[10px] bg-np-blue text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-np-blue/90"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Assets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Assets & Files
                </label>
                <button
                  onClick={() => setAddingAsset(true)}
                  className="text-[10px] text-np-blue font-medium hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Add Asset
                </button>
              </div>

              {/* Asset List */}
              <div className="space-y-1.5">
                {(fields.assets || []).map((asset, idx) => {
                  const astatus = assetStatusColors[asset.status] || assetStatusColors.missing
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm">
                        {asset.type === 'email' ? '📧' : asset.type === 'drive' ? '📁' : asset.type === 'file' ? '📄' : '🔗'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{asset.name}</p>
                        {asset.description && (
                          <p className="text-[9px] text-gray-400 truncate">{asset.description}</p>
                        )}
                      </div>
                      <span
                        className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: astatus.bg, color: astatus.color }}
                      >
                        {astatus.label}
                      </span>
                      {asset.url && (
                        <a href={asset.type === 'email' ? `mailto:?subject=${encodeURIComponent(asset.name)}&body=${encodeURIComponent(asset.url)}` : asset.url} target="_blank" rel="noopener" className="text-gray-400 hover:text-np-blue">
                          {asset.type === 'email' ? <Mail className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
                        </a>
                      )}
                      <button onClick={() => handleRemoveAsset(idx)} className="text-gray-300 hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Add Asset Form */}
              {addingAsset && (
                <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={newAsset.name || ''}
                      onChange={e => setNewAsset(p => ({ ...p, name: e.target.value }))}
                      placeholder="Asset name"
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                      autoFocus
                    />
                    <select
                      value={newAsset.type}
                      onChange={e => setNewAsset(p => ({ ...p, type: e.target.value as any }))}
                      className="text-xs border border-gray-200 rounded px-2 py-1.5"
                    >
                      <option value="link">🔗 Link</option>
                      <option value="drive">📁 Drive</option>
                      <option value="file">📄 File</option>
                      <option value="email">📧 Email</option>
                    </select>
                  </div>
                  <input
                    value={newAsset.url || ''}
                    onChange={e => setNewAsset(p => ({ ...p, url: e.target.value }))}
                    placeholder={newAsset.type === 'email' ? 'Email body / template text' : 'https://...'}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                  />
                  <input
                    value={newAsset.description || ''}
                    onChange={e => setNewAsset(p => ({ ...p, description: e.target.value }))}
                    placeholder="Brief description (optional)"
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={newAsset.status}
                      onChange={e => setNewAsset(p => ({ ...p, status: e.target.value as any }))}
                      className="text-xs border border-gray-200 rounded px-2 py-1.5"
                    >
                      <option value="missing">Missing</option>
                      <option value="mvp">MVP</option>
                      <option value="polished">Polished</option>
                    </select>
                    <div className="flex-1" />
                    <button onClick={() => { setAddingAsset(false); setNewAsset({ type: 'link', status: 'missing' }) }} className="text-xs text-gray-400 px-2 py-1">Cancel</button>
                    <button onClick={handleAddAsset} className="text-xs bg-np-blue text-white px-3 py-1 rounded font-medium">Add</button>
                  </div>
                </div>
              )}
            </div>

            {/* Linked Tasks */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <Link2 className="w-3 h-3" /> Linked Tasks
              </label>
              <div className="space-y-1">
                {(fields.linked_tasks || []).map((task, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-gray-600 flex-1">{task}</span>
                    <button onClick={() => handleRemoveTask(idx)} className="text-gray-300 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <input
                    value={newTask}
                    onChange={e => setNewTask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddTask() }}
                    placeholder="Link a task..."
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300"
                  />
                  <button onClick={handleAddTask} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Notes</label>
              <textarea
                value={fields.notes || ''}
                onChange={e => {
                  const val = e.target.value
                  setFields(prev => ({ ...prev, notes: val }))
                }}
                onBlur={() => saveFields({ notes: fields.notes })}
                placeholder="Internal notes, reminders, next steps..."
                rows={2}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none"
              />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
          <span>Created {new Date(card.created_at).toLocaleDateString()}</span>
          <div className="flex items-center gap-3">
            {(fields.assets || []).length > 0 && (
              <span>{(fields.assets || []).length} assets</span>
            )}
            {(fields.linked_tasks || []).length > 0 && (
              <span>{(fields.linked_tasks || []).length} tasks</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
