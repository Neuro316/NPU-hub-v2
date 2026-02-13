'use client'

import { useState, useEffect, useRef } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { STATUS_CONFIG } from '@/lib/types/journey'
import { X, Plus, Trash2, Link2, FolderOpen, Mail, ExternalLink, FileText, Zap, Hand, RefreshCw, Copy, Link, Upload, Send, MessageSquare, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

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
  type: 'link' | 'file' | 'drive' | 'email' | 'upload'
  url: string
  description: string
  status: 'missing' | 'mvp' | 'polished'
  selected?: boolean
}

interface CardFields {
  section_label?: string
  automation?: string
  drive_folder?: string
  linked_tasks?: string[]
  assets?: Asset[]
  notes?: string
  mirror_id?: string
}

interface CardDetailPanelProps {
  card: JourneyCard | null
  phases: JourneyPhase[]
  onClose: () => void
  onUpdate: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  onDuplicate?: (card: JourneyCard, targetPhaseId: string, targetRow: number) => Promise<any>
  orgId?: string
}

export function CardDetailPanel({ card, phases, onClose, onUpdate, onDelete, onDuplicate, orgId }: CardDetailPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<JourneyCard['status']>('not_started')
  const [phaseId, setPhaseId] = useState('')
  const [fields, setFields] = useState<CardFields>({})
  const [addingAsset, setAddingAsset] = useState(false)
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({ type: 'link', status: 'missing' })
  const [newTask, setNewTask] = useState('')
  const [showDuplicate, setShowDuplicate] = useState(false)
  const [dupPhaseId, setDupPhaseId] = useState('')
  const [dupRow, setDupRow] = useState(0)
  const [sendingSlack, setSendingSlack] = useState(false)
  const [slackSent, setSlackSent] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Send Resources state
  const [showSendResources, setShowSendResources] = useState(false)
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [personalNote, setPersonalNote] = useState('')
  const [sendingResources, setSendingResources] = useState(false)
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setDescription(card.description || '')
      setStatus(card.status)
      setPhaseId(card.phase_id)
      setFields(card.custom_fields || {})
      setDupPhaseId(card.phase_id)
      setShowDuplicate(false)
      setSlackSent(false)
      setShowSendResources(false)
      setSendStatus('idle')
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

  // Assets
  const handleAddAsset = () => {
    if (!newAsset.name) return
    const assets = [...(fields.assets || []), { ...newAsset, selected: false } as Asset]
    saveFields({ assets })
    setNewAsset({ type: 'link', status: 'missing' })
    setAddingAsset(false)
  }

  const handleRemoveAsset = (idx: number) => {
    const assets = (fields.assets || []).filter((_, i) => i !== idx)
    saveFields({ assets })
  }

  const handleToggleAsset = (idx: number) => {
    const assets = (fields.assets || []).map((a, i) =>
      i === idx ? { ...a, selected: !a.selected } : a
    )
    saveFields({ assets })
  }

  const handleSelectAll = () => {
    const allSelected = (fields.assets || []).every(a => a.selected)
    const assets = (fields.assets || []).map(a => ({ ...a, selected: !allSelected }))
    saveFields({ assets })
  }

  // File upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const asset: Asset = {
      name: file.name,
      type: 'upload',
      url: url,
      description: `${(file.size / 1024).toFixed(0)} KB`,
      status: 'polished',
      selected: false,
    }
    const assets = [...(fields.assets || []), asset]
    saveFields({ assets })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Tasks
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

  // Duplicate
  const handleDuplicate = async () => {
    if (onDuplicate) {
      await onDuplicate(card, dupPhaseId, dupRow)
    }
    setShowDuplicate(false)
  }

  // Send selected assets via Slack (copy to clipboard)
  const handleSendSlack = async () => {
    const selected = (fields.assets || []).filter(a => a.selected)
    if (selected.length === 0) return
    setSendingSlack(true)
    const message = `*${card.title}*\n` +
      selected.map(a => `  ${a.name}: ${a.url || 'No URL'}`).join('\n')
    try {
      await navigator.clipboard.writeText(message)
      setSlackSent(true)
      setTimeout(() => setSlackSent(false), 3000)
    } catch {
      alert('Slack message copied:\n\n' + message)
    }
    setSendingSlack(false)
  }

  // Send Resources via Apps Script email
  const handleSendResources = async () => {
    if (!recipientName.trim()) { setSendError('Enter recipient name'); return }
    if (!recipientEmail.trim() || !recipientEmail.includes('@')) { setSendError('Enter valid email'); return }

    const selected = (fields.assets || []).filter(a => a.selected && a.url)
    if (selected.length === 0) { setSendError('Select resources with URLs'); return }

    setSendingResources(true)
    setSendStatus('sending')
    setSendError('')

    const resources = selected.map(a => ({
      name: a.name,
      url: a.url,
      type: a.type === 'upload' ? 'file' : 'asset',
    }))

    try {
      const res = await fetch('/api/send-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          personalNote: personalNote.trim(),
          resources,
          cardName: card.title,
          senderName: 'Cameron Allen',
          senderEmail: 'cameron.allen@neuroprogeny.com',
          orgId: orgId || '',
          useSenderFromSettings: true,
        }),
      })

      const result = await res.json()

      if (result.success) {
        setSendStatus('success')
        setTimeout(() => {
          setRecipientName('')
          setRecipientEmail('')
          setPersonalNote('')
          setSendStatus('idle')
          setShowSendResources(false)
        }, 2000)
      } else {
        setSendStatus('error')
        setSendError(result.error || 'Failed to send')
      }
    } catch (err: any) {
      setSendStatus('error')
      setSendError(err.message || 'Connection error')
    }
    setSendingResources(false)
  }

  const handleDeleteCard = async () => {
    if (confirm('Delete this card?')) {
      await onDelete(card.id)
      onClose()
    }
  }

  const currentPhase = phases.find(p => p.id === phaseId)
  const selectedCount = (fields.assets || []).filter(a => a.selected).length
  const selectedWithUrls = (fields.assets || []).filter(a => a.selected && a.url).length

  const assetStatusColors: Record<string, { bg: string; color: string; label: string }> = {
    missing: { bg: '#FEE2E2', color: '#EF4444', label: 'Missing' },
    mvp: { bg: '#FEF3C7', color: '#F59E0B', label: 'MVP' },
    polished: { bg: '#D1FAE5', color: '#10B981', label: 'Polished' },
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-gray-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-[3px]" style={{ borderBottomColor: currentPhase?.color || '#386797' }}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentPhase?.color }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: currentPhase?.color }}>
              {currentPhase?.label}
            </span>
            {fields.mirror_id && (
              <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                <Copy className="w-2.5 h-2.5" /> Mirror
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDuplicate(!showDuplicate)} className="text-[10px] text-gray-400 font-medium hover:text-np-blue flex items-center gap-0.5">
              <Copy className="w-3 h-3" /> Clone
            </button>
            <button onClick={handleDeleteCard} className="text-gray-300 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clone row */}
        {showDuplicate && (
          <div className="px-5 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <select value={dupPhaseId} onChange={e => setDupPhaseId(e.target.value)}
              className="text-[10px] border border-gray-200 rounded px-2 py-1">
              {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select value={dupRow} onChange={e => setDupRow(Number(e.target.value))}
              className="text-[10px] border border-gray-200 rounded px-2 py-1">
              {[0, 1, 2, 3, 4].map(r => <option key={r} value={r}>Row {r + 1}</option>)}
            </select>
            <button onClick={handleDuplicate} className="text-[10px] bg-np-blue text-white px-2 py-1 rounded font-medium">Duplicate</button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-4">
            {/* Title */}
            <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => save('title', title)}
              className="w-full text-lg font-bold text-np-dark border-0 border-b-2 border-transparent focus:border-np-blue/30 focus:outline-none pb-1 bg-transparent placeholder-gray-300"
              placeholder="Card title" />

            {/* Description */}
            <textarea value={description} onChange={e => setDescription(e.target.value)} onBlur={() => save('description', description)}
              rows={2} placeholder="Describe this step..."
              className="w-full text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />

            {/* Status + Section + Automation */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Status</label>
                <select value={status} onChange={e => { setStatus(e.target.value as any); save('status', e.target.value) }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Section</label>
                <select value={fields.section_label || ''} onChange={e => saveFields({ section_label: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none">
                  <option value="">None</option>
                  {SECTION_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Automation</label>
                <div className="flex gap-1">
                  {AUTOMATION_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    const isActive = fields.automation === opt.value
                    return (
                      <button key={opt.value} onClick={() => saveFields({ automation: opt.value })}
                        className={`flex-1 flex flex-col items-center py-1.5 rounded-lg border text-[8px] font-bold ${isActive ? 'border-gray-300' : 'border-gray-100 text-gray-400'}`}
                        style={isActive ? { color: opt.color, backgroundColor: opt.color + '10' } : {}}>
                        <Icon className="w-3 h-3 mb-0.5" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Drive Folder */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                <FolderOpen className="w-3 h-3" /> Drive Folder
              </label>
              <div className="flex gap-1.5">
                <input value={fields.drive_folder || ''} onChange={e => saveFields({ drive_folder: e.target.value })}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                {fields.drive_folder ? (
                  <a href={fields.drive_folder} target="_blank" rel="noopener"
                    className="flex items-center gap-1 text-[10px] bg-np-blue text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-np-blue/90">
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/google', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ orgId: orgId || '', action: 'createFolder', folderName: card.title, parentType: 'journey' }),
                        })
                        const data = await res.json()
                        if (data?.success && data.folderUrl) {
                          saveFields({ drive_folder: data.folderUrl })
                        }
                      } catch {}
                    }}
                    className="flex items-center gap-1 text-[10px] bg-green-500 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-green-600 whitespace-nowrap">
                    <Plus className="w-3 h-3" /> Create
                  </button>
                )}
              </div>
            </div>

            {/* Assets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Assets & Files
                </label>
                <div className="flex gap-2">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="text-[10px] text-gray-500 font-medium hover:text-np-blue flex items-center gap-0.5">
                    <Upload className="w-3 h-3" /> Upload
                  </button>
                  <button onClick={() => setAddingAsset(true)}
                    className="text-[10px] text-np-blue font-medium hover:underline flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />

              {/* Action bar when assets selected */}
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 mb-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-gray-500 font-medium">{selectedCount} selected</span>
                  <button onClick={handleSelectAll} className="text-[9px] text-np-blue font-medium hover:underline">
                    {(fields.assets || []).every(a => a.selected) ? 'Deselect All' : 'Select All'}
                  </button>
                  <div className="flex-1" />
                  <button onClick={handleSendSlack} disabled={sendingSlack}
                    className="flex items-center gap-1 text-[10px] font-medium bg-[#4A154B] text-white px-2.5 py-1 rounded hover:opacity-90 disabled:opacity-50">
                    <MessageSquare className="w-3 h-3" />
                    {slackSent ? 'Copied!' : 'Slack'}
                  </button>
                  <button onClick={() => setShowSendResources(!showSendResources)}
                    className={`flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded ${showSendResources ? 'bg-np-blue text-white' : 'bg-red-500 text-white hover:opacity-90'}`}>
                    <Mail className="w-3 h-3" />
                    Email ({selectedWithUrls})
                    {showSendResources ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              )}

              {/* Send Resources Widget */}
              {showSendResources && selectedCount > 0 && (
                <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-np-blue uppercase tracking-wider">Send Resources to Contact</span>
                    <button onClick={() => setShowSendResources(false)} className="text-[9px] text-gray-400 hover:text-gray-600">Close</button>
                  </div>

                  {/* Selected resources preview */}
                  <div className="bg-white rounded-lg p-2 max-h-24 overflow-y-auto">
                    {(fields.assets || []).filter(a => a.selected && a.url).map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5 py-0.5">
                        <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                        <span className="text-[10px] text-gray-700 truncate">{a.name}</span>
                        <span className="text-[8px] text-gray-400 flex-shrink-0">{a.type}</span>
                      </div>
                    ))}
                    {(fields.assets || []).filter(a => a.selected && !a.url).length > 0 && (
                      <p className="text-[9px] text-orange-500 mt-1">
                        {(fields.assets || []).filter(a => a.selected && !a.url).length} selected items have no URL and will be skipped
                      </p>
                    )}
                  </div>

                  {/* Recipient fields */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Recipient Name</label>
                      <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
                        placeholder="John Smith"
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Email</label>
                      <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                        placeholder="john@example.com" type="email"
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                    </div>
                  </div>

                  {/* Personal note */}
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Personal Note (optional)</label>
                    <textarea value={personalNote} onChange={e => setPersonalNote(e.target.value)}
                      placeholder="Here are the resources we discussed..."
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
                  </div>

                  {/* Error message */}
                  {sendError && <p className="text-[10px] text-red-500">{sendError}</p>}

                  {/* Send button + status */}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-400">
                      {sendStatus === 'success' ? 'Email delivered!' :
                       sendStatus === 'sending' ? `Sending to ${recipientEmail}...` :
                       'From: cameron.allen@neuroprogeny.com'}
                    </span>
                    <button onClick={handleSendResources} disabled={sendingResources || sendStatus === 'success'}
                      className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                        sendStatus === 'success' ? 'bg-green-500 text-white' :
                        sendStatus === 'error' ? 'bg-orange-500 text-white' :
                        'bg-np-blue text-white hover:bg-np-blue/90'
                      }`}>
                      {sendStatus === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                       sendStatus === 'success' ? <Check className="w-3 h-3" /> :
                       <Send className="w-3 h-3" />}
                      {sendStatus === 'success' ? 'Sent!' :
                       sendStatus === 'sending' ? 'Sending...' :
                       `Send ${selectedWithUrls} Resources`}
                    </button>
                  </div>
                </div>
              )}

              {/* Asset List */}
              <div className="space-y-1.5">
                {(fields.assets || []).map((asset, idx) => {
                  const astatus = assetStatusColors[asset.status] || assetStatusColors.missing
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={asset.selected || false}
                        onChange={() => handleToggleAsset(idx)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-np-blue focus:ring-np-blue/30 flex-shrink-0"
                      />
                      <span className="text-sm flex-shrink-0">
                        {asset.type === 'email' ? 'EM' : asset.type === 'drive' ? 'DR' : asset.type === 'upload' ? 'UP' : asset.type === 'file' ? 'FI' : 'LN'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{asset.name}</p>
                        {asset.description && <p className="text-[9px] text-gray-400 truncate">{asset.description}</p>}
                      </div>
                      <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ backgroundColor: astatus.bg, color: astatus.color }}>{astatus.label}</span>
                      {asset.url && asset.type !== 'email' && (
                        <a href={asset.url} target="_blank" rel="noopener" className="text-gray-400 hover:text-np-blue flex-shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button onClick={() => handleRemoveAsset(idx)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
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
                    <input value={newAsset.name || ''} onChange={e => setNewAsset(p => ({ ...p, name: e.target.value }))}
                      placeholder="Asset name" className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" autoFocus />
                    <select value={newAsset.type} onChange={e => setNewAsset(p => ({ ...p, type: e.target.value as any }))}
                      className="text-xs border border-gray-200 rounded px-2 py-1.5">
                      <option value="link">LN Link</option>
                      <option value="drive">DR Drive</option>
                      <option value="file">FI File</option>
                      <option value="email">EM Email</option>
                    </select>
                  </div>
                  <input value={newAsset.url || ''} onChange={e => setNewAsset(p => ({ ...p, url: e.target.value }))}
                    placeholder={newAsset.type === 'email' ? 'Email body / template text' : 'https://...'}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                  <input value={newAsset.description || ''} onChange={e => setNewAsset(p => ({ ...p, description: e.target.value }))}
                    placeholder="Brief description (optional)"
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                  <div className="flex items-center gap-2">
                    <select value={newAsset.status} onChange={e => setNewAsset(p => ({ ...p, status: e.target.value as any }))}
                      className="text-xs border border-gray-200 rounded px-2 py-1.5">
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
                    <button onClick={() => handleRemoveTask(idx)} className="text-gray-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <input value={newTask} onChange={e => setNewTask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddTask() }}
                    placeholder="Link a task..."
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                  <button onClick={handleAddTask} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Notes</label>
              <textarea value={fields.notes || ''}
                onChange={e => setFields(prev => ({ ...prev, notes: e.target.value }))}
                onBlur={() => saveFields({ notes: fields.notes })}
                placeholder="Internal notes, reminders, next steps..."
                rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
          <span>Created {new Date(card.created_at).toLocaleDateString()}</span>
          <div className="flex items-center gap-3">
            {(fields.assets || []).length > 0 && <span>{(fields.assets || []).length} assets</span>}
            {(fields.linked_tasks || []).length > 0 && <span>{(fields.linked_tasks || []).length} tasks</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
