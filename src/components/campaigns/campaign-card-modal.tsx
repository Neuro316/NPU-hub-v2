'use client'

import { useState, useEffect } from 'react'
import { X, Trash2, Plus, CheckSquare, Square, Link2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import type { JourneyCard, CampaignPhase, ChecklistItem, Tester } from '@/lib/types/journey'
import { CARD_STATUS_CONFIG } from '@/lib/types/journey'

interface Props {
  card: JourneyCard
  phases: CampaignPhase[]
  orgId: string
  onUpdate: (updates: Partial<JourneyCard>) => void
  onDelete: () => void
  onClose: () => void
}

export function CampaignCardModal({ card, phases, orgId, onUpdate, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description || '')
  const [status, setStatus] = useState(card.status)
  const [phase, setPhase] = useState((card as any).campaign_phase || '')
  const [assignee, setAssignee] = useState(card.custom_fields?.assignee || '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>((card as any).checklist || [])
  const [testers, setTesters] = useState<Tester[]>((card as any).testers || [])
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>((card as any).asset_urls || {})
  const [newCheckItem, setNewCheckItem] = useState('')
  const [newTester, setNewTester] = useState('')
  const [team, setTeam] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    supabase.from('team_profiles').select('id, display_name').eq('org_id', orgId).eq('status', 'active').order('display_name')
      .then(({ data }) => setTeam(data || []))
  }, [orgId])

  const save = () => {
    onUpdate({
      title, description, status,
      campaign_phase: phase,
      checklist, testers, asset_urls: assetUrls,
      custom_fields: { ...card.custom_fields, assignee },
    } as any)
  }

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return
    setChecklist(prev => [...prev, { id: Date.now().toString(), text: newCheckItem.trim(), done: false }])
    setNewCheckItem('')
  }

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(c => c.id === id ? { ...c, done: !c.done } : c))
  }

  const removeCheck = (id: string) => {
    setChecklist(prev => prev.filter(c => c.id !== id))
  }

  const addTester = () => {
    if (!newTester.trim()) return
    setTesters(prev => [...prev, { name: newTester.trim(), signedOff: false }])
    setNewTester('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="text-sm font-bold text-np-dark">Edit Card</h3>
          <div className="flex gap-1">
            <button onClick={() => { if (confirm('Delete this card?')) onDelete() }} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={save}
            spellCheck autoCapitalize="sentences" placeholder="Card title"
            className="w-full text-sm font-bold border-b-2 border-transparent focus:border-np-blue/30 focus:outline-none pb-1" />

          {/* Phase + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Phase</label>
              <select value={phase} onChange={e => { setPhase(e.target.value); setTimeout(save, 0) }}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2">
                {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Status</label>
              <select value={status} onChange={e => { setStatus(e.target.value as any); setTimeout(save, 0) }}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2">
                {Object.entries(CARD_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} onBlur={save}
              spellCheck autoCapitalize="sentences" rows={2} placeholder="What needs to happen..."
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none" />
          </div>

          {/* Assignee */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Assignee</label>
            <select value={assignee} onChange={e => { setAssignee(e.target.value); setTimeout(save, 0) }}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2">
              <option value="">Unassigned</option>
              {team.map(t => <option key={t.id} value={t.display_name}>{t.display_name}</option>)}
            </select>
          </div>

          {/* Asset URLs */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Assets & Links</label>
            <div className="space-y-1.5">
              {['media_url', 'copy_doc', 'landing_page', 'tracking_pixel'].map(key => (
                <input key={key} value={assetUrls[key] || ''} onChange={e => setAssetUrls(prev => ({ ...prev, [key]: e.target.value }))} onBlur={save}
                  placeholder={key === 'media_url' ? 'Creative asset URL' : key === 'copy_doc' ? 'Copy doc URL' : key === 'landing_page' ? 'Landing page URL' : 'Tracking pixel ID'}
                  className="w-full text-[10px] border border-gray-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              ))}
            </div>
          </div>

          {/* Checklist */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">
              Checklist ({checklist.filter(c => c.done).length}/{checklist.length})
            </label>
            <div className="space-y-1">
              {checklist.map(item => (
                <div key={item.id} className="flex items-center gap-2 group">
                  <button onClick={() => { toggleCheck(item.id); setTimeout(save, 0) }}>
                    {item.done ? <CheckSquare className="w-4 h-4 text-green-500" /> : <Square className="w-4 h-4 text-gray-300" />}
                  </button>
                  <span className={`text-xs flex-1 ${item.done ? 'line-through text-gray-400' : 'text-np-dark'}`}>{item.text}</span>
                  <button onClick={() => { removeCheck(item.id); setTimeout(save, 0) }} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex gap-1">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { addCheckItem(); setTimeout(save, 100) } }}
                  placeholder="Add checklist item..." spellCheck
                  className="flex-1 text-[10px] border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
            </div>
          </div>

          {/* Testers (always shown) */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase block mb-1">Testers / QA Sign-off</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {testers.map((t, i) => (
                <button key={i} onClick={() => { setTesters(prev => prev.map((x, idx) => idx === i ? { ...x, signedOff: !x.signedOff } : x)); setTimeout(save, 0) }}
                  className={`text-[9px] font-medium px-2 py-1 rounded flex items-center gap-1 ${t.signedOff ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {t.name} {t.signedOff ? '✓' : '⏳'}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <select value={newTester} onChange={e => setNewTester(e.target.value)}
                className="flex-1 text-[10px] border border-gray-200 rounded px-2 py-1.5">
                <option value="">Add tester...</option>
                {team.filter(t => !testers.some(x => x.name === t.display_name)).map(t => (
                  <option key={t.id} value={t.display_name}>{t.display_name}</option>
                ))}
              </select>
              {newTester && (
                <button onClick={() => { addTester(); setTimeout(save, 100) }}
                  className="text-[10px] bg-np-blue text-white px-2 py-1 rounded">Add</button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex justify-end">
          <button onClick={() => { save(); onClose() }}
            className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
