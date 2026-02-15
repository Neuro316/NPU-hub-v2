'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, MoreHorizontal, ChevronDown, GripVertical,
  X, DollarSign, Trash2, Settings, BarChart3,
  Clock, TrendingUp, Target, Percent, Save
} from 'lucide-react'
import { fetchContacts, updateContact } from '@/lib/crm-client'
import type { CrmContact } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { ContactCommsButtons } from '@/components/crm/twilio-comms'

interface PipelineStageConfig {
  id: string; name: string; color: string; is_closed_won?: boolean; is_closed_lost?: boolean; position: number
}
interface PipelineConfig {
  id: string; name: string; description?: string; stages: PipelineStageConfig[]; is_default?: boolean
}

const PRESET_COLORS = ['#228DC4','#2A9D8F','#3DB5A6','#FBBF24','#E76F51','#34D399','#F87171','#8B5CF6','#EC4899','#6366F1','#14B8A6','#F97316','#06B6D4','#84CC16']

const DEFAULT_PIPELINE: PipelineConfig = {
  id: 'default', name: 'Sales Pipeline', is_default: true,
  stages: PIPELINE_STAGES.map((s, i) => ({ id: `stage-${i}`, name: s, color: STAGE_COLORS[s] || '#94a3b8', is_closed_won: s === 'Won', is_closed_lost: s === 'Lost', position: i })),
}

const TEMPLATES: Record<string, PipelineStageConfig[]> = {
  sales: [
    { id:'s1', name:'New Lead', color:'#228DC4', position:0 },{ id:'s2', name:'Contacted', color:'#2A9D8F', position:1 },
    { id:'s3', name:'Qualified', color:'#3DB5A6', position:2 },{ id:'s4', name:'Proposal', color:'#FBBF24', position:3 },
    { id:'s5', name:'Negotiation', color:'#E76F51', position:4 },{ id:'s6', name:'Won', color:'#34D399', is_closed_won:true, position:5 },
    { id:'s7', name:'Lost', color:'#F87171', is_closed_lost:true, position:6 },
  ],
  onboarding: [
    { id:'o1', name:'Application', color:'#228DC4', position:0 },{ id:'o2', name:'Screening', color:'#2A9D8F', position:1 },
    { id:'o3', name:'Intake Call', color:'#3DB5A6', position:2 },{ id:'o4', name:'Assessment', color:'#FBBF24', position:3 },
    { id:'o5', name:'Enrolled', color:'#34D399', is_closed_won:true, position:4 },{ id:'o6', name:'Declined', color:'#F87171', is_closed_lost:true, position:5 },
  ],
  mastermind: [
    { id:'m1', name:'Awareness', color:'#228DC4', position:0 },{ id:'m2', name:'Interest', color:'#2A9D8F', position:1 },
    { id:'m3', name:'Discovery Call', color:'#3DB5A6', position:2 },{ id:'m4', name:'Application Review', color:'#FBBF24', position:3 },
    { id:'m5', name:'Deposit Paid', color:'#8B5CF6', position:4 },{ id:'m6', name:'Fully Enrolled', color:'#34D399', is_closed_won:true, position:5 },
    { id:'m7', name:'Not a Fit', color:'#F87171', is_closed_lost:true, position:6 },
  ],
  blank: [
    { id:'b1', name:'Stage 1', color:'#228DC4', position:0 },{ id:'b2', name:'Stage 2', color:'#2A9D8F', position:1 },
    { id:'b3', name:'Closed Won', color:'#34D399', is_closed_won:true, position:2 },{ id:'b4', name:'Closed Lost', color:'#F87171', is_closed_lost:true, position:3 },
  ],
}

function ContactCard({ contact, stages, onMove }: { contact: CrmContact; stages: PipelineStageConfig[]; onMove: (stage: string) => void }) {
  const [showMenu, setShowMenu] = useState(false)
  const initials = `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase()
  const value = contact.custom_fields?.value as number | undefined
  const daysSince = contact.last_contacted_at ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000) : null

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('contactId', contact.id); e.dataTransfer.effectAllowed = 'move' }}
      className="group relative bg-white rounded-lg border border-gray-100/60 p-3 hover:shadow-md hover:border-np-blue/30 transition-all cursor-grab active:cursor-grabbing active:opacity-70"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal/80 to-np-dark/80 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{initials}</div>
        <div className="flex-1 min-w-0">
          <Link href={`/crm/contacts?id=${contact.id}`} className="text-xs font-semibold text-np-dark hover:text-np-blue truncate block">{contact.first_name} {contact.last_name}</Link>
          {contact.custom_fields?.company && <p className="text-[10px] text-gray-400 truncate">{contact.custom_fields.company as string}</p>}
        </div>
        <button onClick={e => { e.stopPropagation(); setShowMenu(!showMenu) }} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-50 transition-all"><MoreHorizontal size={12} className="text-gray-400" /></button>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {contact.tags?.slice(0,2).map(t => <span key={t} className="text-[8px] font-semibold px-1 py-0.5 rounded-full bg-np-blue/8 text-np-blue">{t}</span>)}
        <div className="flex-1" />
        {daysSince !== null && daysSince > 7 && <span className="text-[9px] text-orange-400">{daysSince}d</span>}
        {value && <span className="text-[10px] font-semibold text-green-600 flex items-center gap-0.5"><DollarSign size={9} />{(value/1000).toFixed(0)}k</span>}
      </div>
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all" onClick={e => e.stopPropagation()}>
        <ContactCommsButtons contact={contact} size="sm" />
      </div>
      {showMenu && (
        <div className="absolute right-0 top-8 z-20 w-36 bg-white rounded-lg shadow-xl border border-gray-100 py-1 animate-in fade-in zoom-in-95 duration-150">
          <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Move to</p>
          {stages.map(s => (
            <button key={s.id} onClick={e => { e.stopPropagation(); onMove(s.name); setShowMenu(false) }}
              className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 transition-colors flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PipelineMetrics({ contacts, stages }: { contacts: CrmContact[]; stages: PipelineStageConfig[] }) {
  const wonStage = stages.find(s => s.is_closed_won)
  const lostStage = stages.find(s => s.is_closed_lost)
  const wonContacts = wonStage ? contacts.filter(c => c.pipeline_stage === wonStage.name) : []
  const lostContacts = lostStage ? contacts.filter(c => c.pipeline_stage === lostStage.name) : []
  const closedTotal = wonContacts.length + lostContacts.length
  const winRate = closedTotal > 0 ? ((wonContacts.length / closedTotal) * 100).toFixed(1) : '--'
  const closeTimes = wonContacts.map(c => { if (!c.created_at || !c.updated_at) return null; return (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86400000 }).filter((d): d is number => d !== null && d > 0)
  const avgCloseTime = closeTimes.length > 0 ? Math.round(closeTimes.reduce((a,b)=>a+b,0)/closeTimes.length) : null
  const totalValue = contacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const wonValue = wonContacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const staleCount = contacts.filter(c => c.pipeline_stage !== wonStage?.name && c.pipeline_stage !== lostStage?.name && c.last_contacted_at && (Date.now() - new Date(c.last_contacted_at).getTime()) > 14*86400000).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Percent size={12} className="text-green-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Win Rate</span></div>
        <p className="text-lg font-bold text-np-dark">{winRate}%</p>
        <p className="text-[9px] text-gray-400">{wonContacts.length}W / {lostContacts.length}L</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Clock size={12} className="text-blue-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Avg Close</span></div>
        <p className="text-lg font-bold text-np-dark">{avgCloseTime !== null ? `${avgCloseTime}d` : '--'}</p>
        <p className="text-[9px] text-gray-400">{closeTimes.length} closed deals</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><DollarSign size={12} className="text-green-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Pipeline Value</span></div>
        <p className="text-lg font-bold text-np-dark">${(totalValue/1000).toFixed(0)}k</p>
        <p className="text-[9px] text-gray-400">${(wonValue/1000).toFixed(0)}k closed</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Target size={12} className="text-purple-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Avg Deal Size</span></div>
        <p className="text-lg font-bold text-np-dark">{wonContacts.length > 0 ? `$${(wonValue/wonContacts.length/1000).toFixed(1)}k` : '--'}</p>
        <p className="text-[9px] text-gray-400">per closed deal</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><TrendingUp size={12} className="text-np-blue" /><span className="text-[9px] font-semibold uppercase text-gray-400">Active</span></div>
        <p className="text-lg font-bold text-np-dark">{contacts.length - wonContacts.length - lostContacts.length}</p>
        <p className="text-[9px] text-gray-400">{contacts.length} total</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Clock size={12} className="text-orange-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Stale 14d+</span></div>
        <p className="text-lg font-bold text-np-dark">{staleCount}</p>
        <p className="text-[9px] text-gray-400">need follow-up</p>
      </div>
    </div>
  )
}

function StageEditor({ stages, onSave, onClose }: { stages: PipelineStageConfig[]; onSave: (s: PipelineStageConfig[]) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<PipelineStageConfig[]>(stages.map(s => ({ ...s })))
  const [colorFor, setColorFor] = useState<string | null>(null)
  const update = (id: string, u: Partial<PipelineStageConfig>) => setEditing(prev => prev.map(s => s.id === id ? { ...s, ...u } : s))
  const remove = (id: string) => { if (editing.length <= 2) return; setEditing(prev => prev.filter(s => s.id !== id).map((s,i) => ({ ...s, position:i }))) }
  const move = (id: string, dir: -1|1) => setEditing(prev => {
    const idx = prev.findIndex(s => s.id === id); if ((dir===-1&&idx===0)||(dir===1&&idx===prev.length-1)) return prev
    const a = [...prev]; const [item] = a.splice(idx,1); a.splice(idx+dir,0,item); return a.map((s,i) => ({ ...s, position:i }))
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4"><h3 className="text-base font-bold text-np-dark">Edit Pipeline Stages</h3><button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button></div>
        <div className="space-y-2 mb-4">
          {editing.map((stage, i) => (
            <div key={stage.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:border-np-blue/20 transition-colors">
              <GripVertical size={12} className="text-gray-300" />
              <div className="relative">
                <button onClick={() => setColorFor(colorFor===stage.id?null:stage.id)} className="w-6 h-6 rounded-full border-2 border-white shadow-sm" style={{ background: stage.color }} />
                {colorFor === stage.id && (
                  <div className="absolute left-0 top-8 z-30 bg-white rounded-lg shadow-xl border border-gray-100 p-2 grid grid-cols-7 gap-1">
                    {PRESET_COLORS.map(c => <button key={c} onClick={() => { update(stage.id, { color:c }); setColorFor(null) }} className="w-5 h-5 rounded-full border border-gray-100 hover:scale-110 transition-transform" style={{ background:c }} />)}
                  </div>
                )}
              </div>
              <input value={stage.name} onChange={e => update(stage.id, { name: e.target.value })} className="flex-1 text-xs font-medium px-2 py-1 border border-gray-100 rounded-md focus:outline-none focus:ring-1 focus:ring-teal/30" />
              <label className="flex items-center gap-1 text-[9px] text-gray-400"><input type="checkbox" checked={!!stage.is_closed_won} onChange={e => update(stage.id, { is_closed_won:e.target.checked, is_closed_lost:false })} className="accent-green-500 w-3 h-3" /> Won</label>
              <label className="flex items-center gap-1 text-[9px] text-gray-400"><input type="checkbox" checked={!!stage.is_closed_lost} onChange={e => update(stage.id, { is_closed_lost:e.target.checked, is_closed_won:false })} className="accent-red-500 w-3 h-3" /> Lost</label>
              <button onClick={() => move(stage.id,-1)} disabled={i===0} className="p-0.5 text-gray-300 hover:text-np-dark disabled:opacity-20">&#9650;</button>
              <button onClick={() => move(stage.id,1)} disabled={i===editing.length-1} className="p-0.5 text-gray-300 hover:text-np-dark disabled:opacity-20">&#9660;</button>
              <button onClick={() => remove(stage.id)} disabled={editing.length<=2} className="p-0.5 text-gray-300 hover:text-red-500 disabled:opacity-20"><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setEditing(prev => [...prev, { id:`stage-${Date.now()}`, name:'New Stage', color:'#94a3b8', position:prev.length }])}
          className="w-full py-2 border-2 border-dashed border-gray-100 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors"><Plus size={12} className="inline mr-1" /> Add Stage</button>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={() => onSave(editing)} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors flex items-center gap-1.5"><Save size={12} /> Save Stages</button>
        </div>
      </div>
    </div>
  )
}

function NewPipelineModal({ onSave, onClose }: { onSave: (p: PipelineConfig) => void; onClose: () => void }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [tpl, setTpl] = useState<string>('sales')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4"><h3 className="text-base font-bold text-np-dark">New Pipeline</h3><button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button></div>
        <div className="space-y-3">
          <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mastermind Enrollment" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
          <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
          <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Template</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {([['sales','Sales'],['onboarding','Onboarding'],['mastermind','Mastermind'],['blank','Blank']] as const).map(([k,l]) => (
                <button key={k} onClick={() => setTpl(k)} className={`px-3 py-2 text-xs rounded-lg border transition-all ${tpl===k ? 'border-np-blue bg-np-blue/5 text-np-blue font-medium' : 'border-gray-100 text-gray-500'}`}>{l}</button>
              ))}
            </div></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Preview</p>
            <div className="flex gap-1 flex-wrap">{TEMPLATES[tpl].map(s => <span key={s.id} className="text-[9px] font-medium px-2 py-1 rounded-full" style={{ background:s.color+'18', color:s.color }}>{s.name}</span>)}</div></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { if(!name.trim()) return; onSave({ id:`pipeline-${Date.now()}`, name:name.trim(), description:desc.trim()||undefined, stages:TEMPLATES[tpl] }) }} disabled={!name.trim()}
            className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">Create Pipeline</button>
        </div>
      </div>
    </div>
  )
}

export default function PipelinesPage() {
  const { currentOrg } = useWorkspace()
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(true)
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([DEFAULT_PIPELINE])
  const [activePipelineId, setActivePipelineId] = useState('default')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showStageEditor, setShowStageEditor] = useState(false)
  const [showNewPipeline, setShowNewPipeline] = useState(false)
  const [showMetrics, setShowMetrics] = useState(true)
  const activePipeline = pipelines.find(p => p.id === activePipelineId) || pipelines[0]

  useEffect(() => {
    if (!currentOrg) return
    const load = async () => {
      try {
        const { data } = await createClient().from('org_settings').select('setting_value').eq('org_id', currentOrg.id).eq('setting_key', 'crm_pipelines').maybeSingle()
        if (data?.setting_value?.pipelines) { setPipelines(data.setting_value.pipelines); setActivePipelineId(data.setting_value.active || data.setting_value.pipelines[0]?.id) }
      } catch (e) { console.error(e) }
    }
    load()
  }, [currentOrg?.id])

  const savePipelines = async (updated: PipelineConfig[], activeId?: string) => {
    setPipelines(updated); if (activeId) setActivePipelineId(activeId); if (!currentOrg) return
    try {
      await createClient().from('org_settings').upsert({ org_id: currentOrg.id, setting_key: 'crm_pipelines', setting_value: { pipelines: updated, active: activeId || activePipelineId } }, { onConflict: 'org_id,setting_key' })
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    fetchContacts({ limit: 500 }).then(r => setContacts(r.contacts)).catch(console.error).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const moveContact = async (id: string, stage: string) => {
    try { await updateContact(id, { pipeline_stage: stage }); setContacts(prev => prev.map(c => c.id === id ? { ...c, pipeline_stage: stage } : c)) } catch (e) { console.error(e) }
  }

  const stageContacts = (name: string) => contacts.filter(c => (c.pipeline_stage || activePipeline.stages[0]?.name || 'New Lead') === name)
  const stageValue = (name: string) => stageContacts(name).reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button onClick={() => setShowDropdown(!showDropdown)} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-lg hover:border-np-blue/30 transition-colors">
              <span className="text-sm font-bold text-np-dark">{activePipeline.name}</span><ChevronDown size={14} className="text-gray-400" />
            </button>
            {showDropdown && (
              <div className="absolute left-0 top-full mt-1 z-30 w-64 bg-white rounded-lg shadow-xl border border-gray-100 py-1 animate-in fade-in zoom-in-95 duration-150">
                {pipelines.map(p => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <button onClick={() => { setActivePipelineId(p.id); setShowDropdown(false) }} className="flex-1 text-left"><p className="text-xs font-medium text-np-dark">{p.name}</p><p className="text-[9px] text-gray-400">{p.stages.length} stages</p></button>
                    {pipelines.length > 1 && <button onClick={() => { const u = pipelines.filter(x => x.id!==p.id); savePipelines(u, u[0].id) }} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={10} /></button>}
                  </div>
                ))}
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button onClick={() => { setShowNewPipeline(true); setShowDropdown(false) }} className="w-full text-left px-3 py-2 text-xs text-np-blue hover:bg-np-blue/5 flex items-center gap-1.5"><Plus size={11} /> New Pipeline</button>
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400">{contacts.length} contacts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMetrics(!showMetrics)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${showMetrics ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-50 text-gray-400'}`}><BarChart3 size={13} /> Metrics</button>
          <button onClick={() => setShowStageEditor(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors"><Settings size={13} /> Edit Stages</button>
        </div>
      </div>

      {showMetrics && <PipelineMetrics contacts={contacts} stages={activePipeline.stages} />}

      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 380px)' }}>
        {activePipeline.stages.map(stage => {
          const sc = stageContacts(stage.name); const sv = stageValue(stage.name)
          return (
            <div key={stage.id} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-xs font-semibold text-np-dark">{stage.name}</span>
                <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">{sc.length}</span>
                <div className="flex-1" />
                {sv > 0 && <span className="text-[10px] font-medium text-green-600">${(sv/1000).toFixed(0)}k</span>}
              </div>
              <div
                className="space-y-2 min-h-[200px] rounded-xl bg-gray-50/50 p-2 border border-gray-100/30 transition-colors"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('bg-np-blue/5', 'border-np-blue/30'); e.currentTarget.classList.remove('bg-gray-50/50', 'border-gray-100/30') }}
                onDragLeave={e => { e.currentTarget.classList.remove('bg-np-blue/5', 'border-np-blue/30'); e.currentTarget.classList.add('bg-gray-50/50', 'border-gray-100/30') }}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('bg-np-blue/5', 'border-np-blue/30'); e.currentTarget.classList.add('bg-gray-50/50', 'border-gray-100/30'); const cid = e.dataTransfer.getData('contactId'); if (cid) moveContact(cid, stage.name) }}
              >
                {sc.map(c => <ContactCard key={c.id} contact={c} stages={activePipeline.stages} onMove={s => moveContact(c.id, s)} />)}
                {sc.length === 0 && <div className="text-center py-8 text-[10px] text-gray-400">No contacts</div>}
              </div>
            </div>
          )
        })}
      </div>

      {showStageEditor && <StageEditor stages={activePipeline.stages} onSave={s => { savePipelines(pipelines.map(p => p.id===activePipelineId ? { ...p, stages:s } : p)); setShowStageEditor(false) }} onClose={() => setShowStageEditor(false)} />}
      {showNewPipeline && <NewPipelineModal onSave={p => { savePipelines([...pipelines, p], p.id); setShowNewPipeline(false) }} onClose={() => setShowNewPipeline(false)} />}
    </div>
  )
}
