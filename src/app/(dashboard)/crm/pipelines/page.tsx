'use client'

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import ContactDetail from '@/components/crm/contact-detail'
import {
  Plus, MoreHorizontal, ChevronDown, GripVertical,
  X, DollarSign, Trash2, Settings, BarChart3,
  Clock, TrendingUp, Target, Percent, Save, User, ArrowRightLeft, LayoutGrid, Sliders, Mail
} from 'lucide-react'
import { fetchContacts, createContact, removeFromPipeline as removeFromPipelineApi } from '@/lib/crm-client'
import { findPipeline, firstStage, loadPipelines, loadPositions, type PipelineRef, type Position, type StageRef } from '@/lib/pipelines/positions'
import { apiSetStage, fetchContactPositions } from '@/lib/pipelines/client'
import { useToast } from '@/components/ui/toast'
import type { CrmContact } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { readOrgSettingValue } from '@/lib/org-settings-client'
import { ContactCommsButtons } from '@/components/crm/twilio-comms'
import { LeadValueEditor, formatUsdFull, formatUsdCompact } from '@/components/crm/lead-value'

interface StageEmail {
  id: string
  recipient: 'client' | 'internal'
  team_id?: string | null   // when recipient==='internal'
  subject: string
  body: string
}

interface PipelineStageConfig {
  id: string; name: string; color: string; is_closed_won?: boolean; is_closed_lost?: boolean; position: number
  stage_emails?: StageEmail[]
}

// One card's deal in one pipeline (hub_pipeline_deals, via /api/crm/pipeline-deals).
interface PipelineDeal {
  contact_id: string
  pipeline_key: string
  value: number | null
  entered_at: string
  stage_changed_at: string
  won_at: string | null
  lost_at: string | null
}

const toDeal = (d: any): PipelineDeal => ({ ...d, value: d.value === null || d.value === undefined ? null : Number(d.value) })

interface PipelineCustomField {
  id: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'currency' | 'url'
  options?: string[]
  required?: boolean
  show_on_card?: boolean
  placeholder?: string
}

interface PipelineConfig {
  id: string
  name: string
  description?: string
  stages: PipelineStageConfig[]
  is_default?: boolean
  card_config?: CardConfig
  custom_fields?: PipelineCustomField[]
}

export interface CardConfig {
  template: 'marketing' | 'clinical' | 'mastermind' | 'minimal' | 'custom'
  sections: {
    contact_info: boolean
    address: boolean
    social_attribution: boolean
    demographics: boolean
    professional: boolean
    emergency_contact: boolean
    consent_billing: boolean
    minor_guardian: boolean
    intelligence_ai: boolean
    // On the board card itself. Absent means on, so every pipeline, including
    // one whose card settings were saved before these existed, shows them.
    recent_notes?: boolean
    open_tasks?: boolean
  }
}

const BOARD_SECTION_LABELS: Record<'recent_notes' | 'open_tasks', string> = {
  recent_notes: 'Recent notes',
  open_tasks: 'Open tasks',
}
const boardSectionOn = (cfg: CardConfig | undefined, key: 'recent_notes' | 'open_tasks') => cfg?.sections?.[key] !== false

// Recent notes and open tasks for one card (/api/crm/pipeline-card-activity).
interface CardActivity {
  notes: { id: string; body: string; created_at: string }[]
  notes_total: number
  tasks: { id: string; title: string; due_date: string | null }[]
  tasks_total: number
}

// "Oct 28". A due date saved from a date picker is stored as midnight UTC, so it
// is read as that calendar day rather than shifted into the previous local day.
function dueDay(ts: string): Date {
  const d = new Date(ts)
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
    ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function CardActivitySections({ activity, showNotes, showTasks, onMore }: {
  activity: CardActivity | undefined
  showNotes: boolean
  showTasks: boolean
  onMore: () => void
}) {
  if (!activity) return null
  const notes = showNotes ? activity.notes : []
  const tasks = showTasks ? activity.tasks : []
  if (!notes.length && !tasks.length) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const more = (n: number) => n > 0 && (
    <button onClick={e => { e.stopPropagation(); onMore() }} className="text-[9px] text-np-blue hover:underline">+{n} more</button>
  )
  return (
    <div className="mt-2 pt-2 border-t border-gray-50 space-y-1.5">
      {notes.length > 0 && (
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-300">Recent notes</p>
          {notes.map(n => (
            <p key={n.id} className="text-[9px] text-gray-500 truncate" title={n.body}>
              <span className="text-gray-400">{shortDate(new Date(n.created_at))}</span> {n.body}
            </p>
          ))}
          {more(activity.notes_total - notes.length)}
        </div>
      )}
      {tasks.length > 0 && (
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-300">Open tasks</p>
          {tasks.map(t => {
            const due = t.due_date ? dueDay(t.due_date) : null
            const overdue = !!due && due < today
            return (
              <p key={t.id} className="text-[9px] text-gray-500 truncate" title={t.title}>
                <span className={overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}>{due ? shortDate(due) : 'No date'}</span> {t.title}
              </p>
            )
          })}
          {more(activity.tasks_total - tasks.length)}
        </div>
      )}
    </div>
  )
}

const CARD_CONFIG_TEMPLATES: Record<string, CardConfig> = {
  marketing: { template: 'marketing', sections: { contact_info: true, address: false, social_attribution: true, demographics: false, professional: true, emergency_contact: false, consent_billing: false, minor_guardian: false, intelligence_ai: true } },
  clinical:  { template: 'clinical',  sections: { contact_info: true, address: true,  social_attribution: false, demographics: true,  professional: false, emergency_contact: true,  consent_billing: true,  minor_guardian: true,  intelligence_ai: false } },
  mastermind:{ template: 'mastermind',sections: { contact_info: true, address: false, social_attribution: true,  demographics: false, professional: true,  emergency_contact: false, consent_billing: true,  minor_guardian: false, intelligence_ai: true  } },
  minimal:   { template: 'minimal',   sections: { contact_info: true, address: false, social_attribution: false, demographics: false, professional: false, emergency_contact: false, consent_billing: false, minor_guardian: false, intelligence_ai: false } },
}

const SECTION_LABELS: Record<string, string> = {
  contact_info: 'Contact Info',
  address: 'Address',
  social_attribution: 'Social & Attribution',
  demographics: 'Demographics',
  professional: 'Professional',
  emergency_contact: 'Emergency Contact',
  consent_billing: 'Consent & Billing',
  minor_guardian: 'Minor / Guardian',
  intelligence_ai: 'Intelligence & AI Notes',
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

// A board column's key. Some pipelines (Mastermind, Subscribed) store their stages with no id, so the id alone
// cannot tell columns apart: undefined === undefined would put every card in the first column. The fallback is the
// same 'name:<stage>' form sync_pipelines_from_settings gives those stages as their legacy key.
const colKey = (s: { id?: string | null; name: string }): string => s.id || `name:${s.name}`

// A card shows the contact's place in THIS board's pipeline only (contact_pipeline_positions).
// contacts.pipeline_id / pipeline_stage are legacy and are not read.
function ContactCard({ contact, position, currentStageId, stages, pipelines, activePipelineId, customFields, dealValue, onSaveValue, onMove, onAddToPipeline, loadMemberships, onRemovePipeline, onOpenContact, activity, showNotes, showTasks }: {
  contact: CrmContact
  position: Position | undefined
  /** the config id of the column the card sits in */
  currentStageId: string | null
  dealValue: number | null
  onSaveValue: (value: number | null) => Promise<void>
  stages: PipelineStageConfig[]
  pipelines: PipelineConfig[]
  activePipelineId: string
  customFields: PipelineCustomField[]
  onMove: (stage: PipelineStageConfig) => void
  onAddToPipeline: (pipelineKey: string) => void
  /** legacy keys of every pipeline the contact is in */
  loadMemberships: () => Promise<string[]>
  onRemovePipeline: () => void
  onOpenContact: (id: string) => void
  activity?: CardActivity
  showNotes: boolean
  showTasks: boolean
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [menuSection, setMenuSection] = useState<'main'|'stage'|'pipeline'>('main')
  // Pipelines the contact is already in, read when the add menu opens. null while loading.
  const [memberKeys, setMemberKeys] = useState<string[] | null>(null)
  const openPipelineMenu = () => {
    setMenuSection('pipeline')
    setMemberKeys(null)
    loadMemberships().then(setMemberKeys).catch(() => setMemberKeys([activePipelineId]))
  }
  // The menu is rendered in a portal at fixed coords so it escapes the column's
  // overflow-y-auto — otherwise a tall stage submenu on a lower card is clipped
  // and its stage buttons become unclickable.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const initials = `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase()
  const [editingValue, setEditingValue] = useState(false)
  const daysSince = contact.last_contacted_at ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000) : null
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const closeMenu = () => { setShowMenu(false); setMenuSection('main'); setMenuPos(null) }
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      // Clamp so the menu at its TALLEST section (stage list = back + header +
      // capped max-h-60 ≈ 300px) stays fully on screen even for a card low in
      // the viewport or near the right edge. Clamping to the max height means a
      // low card's menu simply opens higher rather than running off the bottom.
      const MENU_W = 192, MENU_MAX_H = 300, PAD = 8
      const left = Math.min(Math.max(PAD, r.right - MENU_W), window.innerWidth - MENU_W - PAD)
      const top = Math.max(PAD, Math.min(r.bottom + 4, window.innerHeight - MENU_MAX_H - PAD))
      setMenuPos({ top, left })
    }
    setMenuSection('main')
    setShowMenu(true)
  }

  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu() }
    // Fixed-positioned menu won't follow a scroll, so close it on scroll/resize.
    const dismiss = () => closeMenu()
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [showMenu])

  // Get custom fields to show on card
  const cardFields = customFields.filter(f => f.show_on_card)

  return (
    <div
      draggable={!editingValue}
      onDragStart={e => { e.dataTransfer.setData('contactId', contact.id); e.dataTransfer.effectAllowed = 'move' }}
      className="group relative bg-white rounded-lg border border-gray-100/60 p-3 hover:shadow-md hover:border-np-blue/30 transition-all cursor-grab active:cursor-grabbing active:opacity-70"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal/80 to-np-dark/80 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{initials}</div>
        <div className="flex-1 min-w-0">
          <button onClick={e => { e.stopPropagation(); onOpenContact(contact.id) }} className="text-xs font-semibold text-np-dark hover:text-np-blue truncate block text-left w-full">{contact.first_name} {contact.last_name}</button>
          {contact.custom_fields?.company && <p className="text-[10px] text-gray-400 truncate">{contact.custom_fields.company as string}</p>}
          {contact.email && <p className="text-[9px] text-gray-400 truncate">{contact.email}</p>}
        </div>
        <button ref={btnRef} onClick={e => { e.stopPropagation(); showMenu ? closeMenu() : openMenu() }} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-50 transition-all"><MoreHorizontal size={12} className="text-gray-400" /></button>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {position && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-teal/10 text-teal">{position.stage_name}</span>}
        {contact.tags?.slice(0,2).map(t => <span key={t} className="text-[8px] font-semibold px-1 py-0.5 rounded-full bg-np-blue/8 text-np-blue">{t}</span>)}
        
        {/* Custom field badges */}
        {cardFields.map(field => {
          const fieldValue = contact.custom_fields?.[field.id]
          if (!fieldValue) return null
          let displayValue = String(fieldValue)
          if (field.type === 'currency' && typeof fieldValue === 'number') {
            displayValue = `$${(fieldValue / 1000).toFixed(0)}k`
          } else if (field.type === 'checkbox') {
            displayValue = fieldValue ? '✓' : ''
          }
          if (!displayValue) return null
          return (
            <span key={field.id} className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600" title={field.label}>
              {displayValue}
            </span>
          )
        })}
        
        <div className="flex-1" />
        {daysSince !== null && daysSince > 7 && <span className="text-[9px] text-orange-400">{daysSince}d</span>}
        <LeadValueEditor value={dealValue} onSave={onSaveValue} onEditingChange={setEditingValue} />
      </div>
      <CardActivitySections activity={activity} showNotes={showNotes} showTasks={showTasks} onMore={() => onOpenContact(contact.id)} />
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all" onClick={e => e.stopPropagation()}>
        <ContactCommsButtons contact={contact} size="sm" />
      </div>
      {showMenu && menuPos && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          className="z-50 w-48 bg-white rounded-lg shadow-xl border border-gray-100 py-1 animate-in fade-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
          {menuSection === 'main' && <>
            <button onClick={() => { onOpenContact(contact.id); closeMenu() }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 flex items-center gap-2"><User size={11} className="text-gray-400" /> View Details</button>
            <button onClick={() => setMenuSection('stage')} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 flex items-center gap-2"><ArrowRightLeft size={11} className="text-gray-400" /> Move to Stage <ChevronDown size={9} className="ml-auto text-gray-300 -rotate-90" /></button>
            <button onClick={openPipelineMenu} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 flex items-center gap-2"><Target size={11} className="text-gray-400" /> Add to pipeline <ChevronDown size={9} className="ml-auto text-gray-300 -rotate-90" /></button>
            <div className="border-t border-gray-100 my-1" />
            <button onClick={() => { onRemovePipeline(); closeMenu() }} className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 flex items-center gap-2"><X size={11} /> Remove from Pipeline</button>
          </>}
          {menuSection === 'stage' && <>
            <button onClick={() => setMenuSection('main')} className="w-full text-left px-3 py-1.5 text-[10px] text-gray-400 hover:bg-gray-50 flex items-center gap-1"><ChevronDown size={9} className="rotate-90" /> Back</button>
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Move to Stage</p>
            {/* Capped + internally scrollable so a long stage list never overflows the viewport. */}
            <div className="max-h-60 overflow-y-auto">
              {stages.map(s => (
                <button key={colKey(s)} onClick={() => { onMove(s); closeMenu() }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 flex items-center gap-2 ${currentStageId === colKey(s) ? 'font-semibold text-np-blue' : ''}`}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />{s.name}
                  {currentStageId === colKey(s) && <span className="ml-auto text-[9px] text-gray-300 flex-shrink-0">current</span>}
                </button>
              ))}
            </div>
          </>}
          {menuSection === 'pipeline' && <>
            <button onClick={() => setMenuSection('main')} className="w-full text-left px-3 py-1.5 text-[10px] text-gray-400 hover:bg-gray-50 flex items-center gap-1"><ChevronDown size={9} className="rotate-90" /> Back</button>
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Add to pipeline</p>
            <p className="px-3 pb-1 text-[9px] text-gray-400">Adds at the first stage. This pipeline is kept.</p>
            <div className="max-h-60 overflow-y-auto">
              {pipelines.map(p => {
                const isIn = p.id === activePipelineId || !!memberKeys?.includes(p.id)
                const disabled = memberKeys === null || isIn
                return (
                  <button key={p.id} disabled={disabled} onClick={() => { onAddToPipeline(p.id); closeMenu() }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 ${disabled ? 'text-gray-400 cursor-default' : 'hover:bg-gray-50'} ${p.id === activePipelineId ? 'font-semibold' : ''}`}>
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-[9px] text-gray-300 flex-shrink-0">{memberKeys === null ? '...' : isIn ? 'In it' : `${p.stages.length} stages`}</span>
                  </button>
                )
              })}
            </div>
          </>}
        </div>,
        document.body
      )}
    </div>
  )
}

// Stage type comes from the Won / Lost flags on the stage the contact holds in this
// pipeline. A pipeline can flag more than one stage as won or lost, so every flagged stage counts.
type StageType = 'open' | 'won' | 'lost'
function stageTypeOf(st: { is_closed_won: boolean; is_closed_lost: boolean } | null | undefined): StageType {
  if (st?.is_closed_won) return 'won'
  if (st?.is_closed_lost) return 'lost'
  return 'open'
}

// The local shape of a position just set, until the server's row comes back.
const makePosition = (contactId: string, p: PipelineRef, s: StageRef): Position => ({
  contact_id: contactId, pipeline_id: p.id, pipeline_key: p.key, pipeline_name: p.name,
  stage_id: s.id, stage_name: s.name, stage_color: s.color, stage_position: s.position,
  is_closed_won: s.is_closed_won, is_closed_lost: s.is_closed_lost, moved_at: new Date().toISOString(), source: 'board',
})

const DAY = 86400000

function PipelineMetrics({ contacts, positions, deals }: { contacts: CrmContact[]; positions: Record<string, Position>; deals: Record<string, PipelineDeal> }) {
  const typed = contacts.map(c => ({ c, d: deals[c.id] as PipelineDeal | undefined, t: stageTypeOf(positions[c.id]) }))
  const open = typed.filter(x => x.t === 'open')
  const won = typed.filter(x => x.t === 'won')
  const lost = typed.filter(x => x.t === 'lost')
  const closedTotal = won.length + lost.length
  const winRate = closedTotal > 0 ? `${((won.length / closedTotal) * 100).toFixed(1).replace(/\.0$/, '')}%` : '--'

  const closeDays = won
    .map(x => x.d?.won_at && x.d?.entered_at ? (new Date(x.d.won_at).getTime() - new Date(x.d.entered_at).getTime()) / DAY : null)
    .filter((d): d is number => d !== null && d >= 0)
  const avgClose = closeDays.length > 0 ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null

  const valueOf = (x: { d?: PipelineDeal }) => x.d?.value ?? null
  const openValue = open.reduce((s, x) => s + (valueOf(x) ?? 0), 0)
  const wonValues = won.map(valueOf).filter((v): v is number => v !== null)
  const wonValue = wonValues.reduce((s, v) => s + v, 0)
  const avgDeal = wonValues.length > 0 ? wonValue / wonValues.length : null

  // Stale: open, and neither a stage change nor any contact activity in 14+ days.
  const now = Date.now()
  const staleCount = open.filter(x => {
    const times = [x.d?.stage_changed_at, x.c.last_contacted_at, x.d ? null : x.c.created_at]
      .filter(Boolean).map(t => new Date(t as string).getTime())
    const last = times.length ? Math.max(...times) : 0
    return now - last > 14 * DAY
  }).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><DollarSign size={12} className="text-green-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Pipeline Value</span></div>
        <p className="text-lg font-bold text-np-dark">{formatUsdCompact(openValue)}</p>
        <p className="text-[9px] text-gray-400">{formatUsdCompact(wonValue)} closed</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Percent size={12} className="text-green-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Win Rate</span></div>
        <p className="text-lg font-bold text-np-dark">{winRate}</p>
        <p className="text-[9px] text-gray-400">{won.length}W / {lost.length}L</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Clock size={12} className="text-blue-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Avg Close</span></div>
        <p className="text-lg font-bold text-np-dark">{avgClose !== null ? `${avgClose}d` : '--'}</p>
        <p className="text-[9px] text-gray-400">{closeDays.length} closed {closeDays.length === 1 ? 'deal' : 'deals'}</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><Target size={12} className="text-purple-500" /><span className="text-[9px] font-semibold uppercase text-gray-400">Avg Deal Size</span></div>
        <p className="text-lg font-bold text-np-dark">{avgDeal !== null ? formatUsdCompact(avgDeal) : '--'}</p>
        <p className="text-[9px] text-gray-400">{wonValues.length} won with a value</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-1.5 mb-1"><TrendingUp size={12} className="text-np-blue" /><span className="text-[9px] font-semibold uppercase text-gray-400">Active</span></div>
        <p className="text-lg font-bold text-np-dark">{open.length}</p>
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

function RichEmailEditor({ value, onChange, orgId }: { value: string; onChange: (html: string) => void; orgId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || '' }, [])
  const emit = () => { if (ref.current) onChange(ref.current.innerHTML) }
  const exec = (cmd: string, arg?: string) => { document.execCommand(cmd, false, arg); emit() }
  const addColor = () => { const c = prompt('Text color (e.g. #386797 or red)'); if (c) exec('foreColor', c) }
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const runAI = async () => {
    if (!aiText.trim()) return
    setAiBusy(true)
    try {
      const res = await fetch('/api/crm/email-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, instruction: aiText, current_html: ref.current?.innerHTML || '' }) })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      if (data.html && ref.current) { ref.current.innerHTML = data.html; emit(); setAiText(''); setAiOpen(false) }
    } catch (e: any) { alert('AI request failed: ' + (e?.message || e)) }
    finally { setAiBusy(false) }
  }
  const Btn = ({ onClick, title, children, active }: any) => <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick} title={title} className={`px-2 py-1 text-[11px] rounded hover:bg-gray-100 font-medium ${active?'bg-np-blue/10 text-np-blue':'text-gray-600'}`}>{children}</button>
  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 px-1 py-1 border-b border-gray-100 bg-gray-50">
        <Btn onClick={() => exec('bold')} title="Bold"><b>B</b></Btn>
        <Btn onClick={() => exec('italic')} title="Italic"><i>I</i></Btn>
        <Btn onClick={() => exec('underline')} title="Underline"><u>U</u></Btn>
        <Btn onClick={() => exec('formatBlock', '<h2>')} title="Heading">H</Btn>
        <Btn onClick={() => exec('insertUnorderedList')} title="Bullet list">• List</Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Numbered list">1. List</Btn>
        <Btn onClick={addColor} title="Text color">Color</Btn>
        <div className="flex-1" />
        <Btn onClick={() => setAiOpen(o => !o)} title="AI compose" active={aiOpen}>✨ AI</Btn>
      </div>
      {aiOpen && (
        <div className="px-2 py-2 border-b border-gray-100 bg-blue-50/40 space-y-1.5">
          <textarea value={aiText} onChange={e => setAiText(e.target.value)} placeholder="Describe the email you want — e.g. 'a warm welcome with a blue Book a Call button linking to https://... and embed this YouTube video: ...'" rows={3} className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-md resize-y bg-white" />
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-gray-400">AI replaces the whole body with email-safe HTML.</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setAiOpen(false); setAiText('') }} className="px-2 py-1 text-[11px] text-gray-400 hover:text-np-dark">Cancel</button>
              <button type="button" onClick={runAI} disabled={aiBusy || !aiText.trim()} className="px-3 py-1 text-[11px] font-semibold bg-np-blue text-white rounded-md hover:bg-np-dark disabled:opacity-50">{aiBusy ? 'Generating…' : 'Generate'}</button>
            </div>
          </div>
        </div>
      )}
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={emit} className="min-h-[140px] px-3 py-2 text-[12px] focus:outline-none" style={{ lineHeight: 1.5 }} />
    </div>
  )
}

function StageEditor({ stages, team, orgId, onSave, onClose }: { stages: PipelineStageConfig[]; team: {id:string;display_name:string;email:string|null}[]; orgId?: string; onSave: (s: PipelineStageConfig[]) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<PipelineStageConfig[]>(stages.map(s => ({ ...s })))
  const [colorFor, setColorFor] = useState<string | null>(null)
  const [emailOpenFor, setEmailOpenFor] = useState<string | null>(null)
  const update = (id: string, u: Partial<PipelineStageConfig>) => setEditing(prev => prev.map(s => s.id === id ? { ...s, ...u } : s))
  const updateEmails = (stageId: string, emails: StageEmail[]) => update(stageId, { stage_emails: emails } as Partial<PipelineStageConfig>)
  const addEmail = (stage: PipelineStageConfig) => updateEmails(stage.id, [...(stage.stage_emails||[]), { id:`email-${Date.now()}`, recipient:'client', team_id:null, subject:'', body:'' }])
  const removeEmail = (stage: PipelineStageConfig, emailId: string) => updateEmails(stage.id, (stage.stage_emails||[]).filter(e => e.id !== emailId))
  const patchEmail = (stage: PipelineStageConfig, emailId: string, patch: Partial<StageEmail>) => updateEmails(stage.id, (stage.stage_emails||[]).map(e => e.id===emailId ? { ...e, ...patch } : e))
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
            <div key={stage.id}>
            <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:border-np-blue/20 transition-colors">
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
              <button onClick={() => setEmailOpenFor(emailOpenFor===stage.id?null:stage.id)} className={`p-0.5 ${(stage.stage_emails&&stage.stage_emails.length>0)?'text-np-blue':'text-gray-300'} hover:text-np-blue`} title="Stage email"><Mail size={12} /></button>
              <button onClick={() => move(stage.id,-1)} disabled={i===0} className="p-0.5 text-gray-300 hover:text-np-dark disabled:opacity-20">▲</button>
              <button onClick={() => move(stage.id,1)} disabled={i===editing.length-1} className="p-0.5 text-gray-300 hover:text-np-dark disabled:opacity-20">▼</button>
              <button onClick={() => remove(stage.id)} disabled={editing.length<=2} className="p-0.5 text-gray-300 hover:text-red-500 disabled:opacity-20"><Trash2 size={11} /></button>
            </div>
            {emailOpenFor === stage.id && (
              <div className="ml-8 mb-2 p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-3">
                {(stage.stage_emails||[]).length===0 && <p className="text-[10px] text-gray-400">No emails configured for this stage yet.</p>}
                {(stage.stage_emails||[]).map((em, ei) => (
                  <div key={em.id} className="p-2.5 bg-white rounded-md border border-gray-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Email {ei+1}</span>
                      <button onClick={() => removeEmail(stage, em.id)} className="p-0.5 text-gray-300 hover:text-red-500" title="Remove email"><Trash2 size={11} /></button>
                    </div>
                    <div className="flex gap-2 text-[11px]">
                      <label className="flex items-center gap-1"><input type="radio" name={`recip-${em.id}`} checked={em.recipient==='client'} onChange={() => patchEmail(stage, em.id, { recipient:'client', team_id:null })} /> To client</label>
                      <label className="flex items-center gap-1"><input type="radio" name={`recip-${em.id}`} checked={em.recipient==='internal'} onChange={() => patchEmail(stage, em.id, { recipient:'internal' })} /> Internal (team member)</label>
                    </div>
                    {em.recipient==='internal' && (
                      <select value={em.team_id||''} onChange={e => patchEmail(stage, em.id, { team_id: e.target.value||null })} className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-md bg-white">
                        <option value="">Select team member…</option>
                        {team.map(t => <option key={t.id} value={t.id}>{t.display_name}{t.email?` (${t.email})`:''}</option>)}
                      </select>
                    )}
                    <input value={em.subject} onChange={e => patchEmail(stage, em.id, { subject: e.target.value })} placeholder="Email subject" className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-md" />
                    <RichEmailEditor value={em.body} onChange={html => patchEmail(stage, em.id, { body: html })} orgId={orgId} />
                  </div>
                ))}
                <button onClick={() => addEmail(stage)} className="w-full py-1.5 border border-dashed border-gray-200 rounded-md text-[11px] text-gray-400 hover:text-np-blue hover:border-np-blue/40 transition-colors"><Plus size={11} className="inline mr-1" /> Add email to this stage</button>
                <p className="text-[9px] text-gray-400">Each email fires when a contact enters this stage. Merge tags: {`{{first_name}}`}, {`{{last_name}}`}. Sending is wired in the next step.</p>
              </div>
            )}
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

function CustomFieldEditor({ pipeline, onSave, onClose }: { pipeline: PipelineConfig; onSave: (fields: PipelineCustomField[]) => void; onClose: () => void }) {
  const [fields, setFields] = useState<PipelineCustomField[]>(pipeline.custom_fields || [])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const addField = () => {
    const newField: PipelineCustomField = {
      id: `field-${Date.now()}`,
      label: 'New Field',
      type: 'text',
      required: false,
      show_on_card: false,
    }
    setFields(prev => [...prev, newField])
    setExpandedId(newField.id)
  }

  const updateField = (id: string, updates: Partial<PipelineCustomField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-np-dark">Pipeline Custom Fields</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Define custom fields for <span className="font-semibold text-np-blue">{pipeline.name}</span></p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        <div className="space-y-2 mb-4">
          {fields.map(field => (
            <div key={field.id} className="border border-gray-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === field.id ? null : field.id)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sliders size={14} className="text-gray-400" />
                  <span className="text-xs font-semibold text-np-dark">{field.label}</span>
                  <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{field.type}</span>
                  {field.required && <span className="text-[8px] text-red-500 font-bold">*</span>}
                  {field.show_on_card && <span className="text-[8px] text-np-blue bg-np-blue/10 px-1.5 py-0.5 rounded">Card</span>}
                </div>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${expandedId === field.id ? 'rotate-180' : ''}`} />
              </button>

              {expandedId === field.id && (
                <div className="px-3 pb-3 pt-2 bg-gray-50/50 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Label</label>
                      <input
                        value={field.label}
                        onChange={e => updateField(field.id, { label: e.target.value })}
                        className="w-full mt-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Type</label>
                      <select
                        value={field.type}
                        onChange={e => updateField(field.id, { type: e.target.value as any })}
                        className="w-full mt-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="currency">Currency</option>
                        <option value="date">Date</option>
                        <option value="select">Dropdown</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="url">URL</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Placeholder</label>
                    <input
                      value={field.placeholder || ''}
                      onChange={e => updateField(field.id, { placeholder: e.target.value })}
                      placeholder="Optional..."
                      className="w-full mt-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                    />
                  </div>

                  {field.type === 'select' && (
                    <div>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Options (one per line)</label>
                      <textarea
                        value={(field.options || []).join('\n')}
                        onChange={e => updateField(field.id, { options: e.target.value.split('\n').filter(o => o.trim()) })}
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        rows={4}
                        className="w-full mt-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 font-mono"
                      />
                    </div>
                  )}

                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={e => updateField(field.id, { required: e.target.checked })}
                        className="w-4 h-4 accent-np-blue"
                      />
                      Required field
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.show_on_card}
                        onChange={e => updateField(field.id, { show_on_card: e.target.checked })}
                        className="w-4 h-4 accent-np-blue"
                      />
                      Show on kanban card
                    </label>
                  </div>

                  <button
                    onClick={() => removeField(field.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={12} /> Delete Field
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {fields.length === 0 && (
          <p className="text-center text-[10px] text-gray-400 py-6">No custom fields yet. Add one below.</p>
        )}

        <button
          onClick={addField}
          className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={14} /> Add Field
        </button>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={() => onSave(fields)} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors flex items-center gap-1.5">
            <Save size={12} /> Save Custom Fields
          </button>
        </div>
      </div>
    </div>
  )
}

function CardConfigEditor({ pipeline, onSave, onClose }: { pipeline: PipelineConfig; onSave: (cfg: CardConfig) => void; onClose: () => void }) {
  const [cfg, setCfg] = useState<CardConfig>(() => {
    const existing = pipeline.card_config || CARD_CONFIG_TEMPLATES.marketing
    return { ...existing, sections: { ...existing.sections } }
  })

  const setTemplate = (tpl: string) => {
    const t = CARD_CONFIG_TEMPLATES[tpl] || CARD_CONFIG_TEMPLATES.marketing
    setCfg(prev => ({ ...t, sections: { ...t.sections, recent_notes: boardSectionOn(prev, 'recent_notes'), open_tasks: boardSectionOn(prev, 'open_tasks') } }))
  }

  const toggle = (key: keyof CardConfig['sections']) =>
    setCfg(prev => ({ ...prev, template: 'custom', sections: { ...prev.sections, [key]: !prev.sections[key] } }))
  // Board sections default on, so absent counts as on. Changing them is not a
  // template change: templates do not set them.
  const toggleBoard = (key: 'recent_notes' | 'open_tasks') =>
    setCfg(prev => ({ ...prev, sections: { ...prev.sections, [key]: !boardSectionOn(prev, key) } }))

  const sectionKeys = Object.keys(SECTION_LABELS) as Array<keyof CardConfig['sections']>
  const TPL_OPTIONS: [string, string][] = [['marketing','Marketing / Outreach'],['clinical','Clinical / Research'],['mastermind','Mastermind'],['minimal','Minimal']]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-np-dark">Card Field Sections</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Control which info shows on contact cards in <span className="font-semibold text-np-blue">{pipeline.name}</span></p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Start from Template</p>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {TPL_OPTIONS.map(([k, l]) => (
            <button key={k} onClick={() => setTemplate(k)}
              className={'px-3 py-2 text-[11px] rounded-lg border transition-all text-left ' + (cfg.template === k ? 'border-np-blue bg-np-blue/5 text-np-blue font-semibold' : 'border-gray-100 text-gray-500')}>
              {l}
            </button>
          ))}
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">On the Board Card</p>
        <div className="space-y-1.5 mb-4">
          {(Object.keys(BOARD_SECTION_LABELS) as Array<'recent_notes' | 'open_tasks'>).map(key => {
            const on = boardSectionOn(cfg, key)
            return (
              <button key={key} onClick={() => toggleBoard(key)}
                className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ' + (on ? 'border-np-blue/30 bg-np-blue/5' : 'border-gray-100 bg-gray-50/50')}>
                <div className={'w-8 h-4 rounded-full relative flex-shrink-0 transition-colors ' + (on ? 'bg-np-blue' : 'bg-gray-200')}>
                  <div className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all" style={{ left: on ? '17px' : '2px' }} />
                </div>
                <span className={'text-xs font-medium ' + (on ? 'text-np-dark' : 'text-gray-400')}>{BOARD_SECTION_LABELS[key]}</span>
              </button>
            )
          })}
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Field Sections</p>
        <div className="space-y-1.5 mb-5">
          {sectionKeys.map(key => (
            <button key={key} onClick={() => toggle(key)}
              className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ' + (cfg.sections[key] ? 'border-np-blue/30 bg-np-blue/5' : 'border-gray-100 bg-gray-50/50')}>
              <div className={'w-8 h-4 rounded-full relative flex-shrink-0 transition-colors ' + (cfg.sections[key] ? 'bg-np-blue' : 'bg-gray-200')}>
                <div className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all" style={{ left: cfg.sections[key] ? '17px' : '2px' }} />
              </div>
              <span className={'text-xs font-medium ' + (cfg.sections[key] ? 'text-np-dark' : 'text-gray-400')}>{SECTION_LABELS[key]}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={() => onSave(cfg)} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors flex items-center gap-1.5">
            <Save size={12} /> Save Card Config
          </button>
        </div>
      </div>
    </div>
  )
}

function RemoveFromPipelineModal({ contactName, pipelineName, busy, onConfirm, onClose }: { contactName: string; pipelineName: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { if (!busy) onClose() }}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-base font-bold text-np-dark">Remove from pipeline?</h3><button onClick={onClose} disabled={busy} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button></div>
        <p className="text-xs text-gray-600"><span className="font-semibold text-np-dark">{contactName}</span> will be removed from <span className="font-semibold text-np-dark">{pipelineName}</span>, along with its lead value in this pipeline.</p>
        <p className="text-xs text-gray-500 mt-2">The contact is not deleted. It stays in Contacts with its notes, tasks and history.</p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="px-4 py-2 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-40 transition-colors">{busy ? 'Removing...' : 'Remove'}</button>
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
          <button onClick={() => { if(!name.trim()) return; onSave({ id:`pipeline-${Date.now()}`, name:name.trim(), description:desc.trim()||undefined, stages:TEMPLATES[tpl], card_config: CARD_CONFIG_TEMPLATES[tpl==='blank'?'minimal':tpl] || CARD_CONFIG_TEMPLATES.marketing }) }} disabled={!name.trim()}
            className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">Create Pipeline</button>
        </div>
      </div>
    </div>
  )
}

// Adds a person to THIS pipeline at the chosen stage (first by default): a new contact, or one
// already in Contacts. It creates a position in this pipeline and touches no other pipeline.
function AddContactModal({ pipeline, stages, onBoard, onAdded, onClose }: {
  pipeline: PipelineConfig
  /** this pipeline's columns that can take a card, in order */
  stages: { cfg: PipelineStageConfig; ref: StageRef }[]
  onBoard: Set<string>
  onAdded: (contact: CrmContact, positions: Position[], stage: StageRef) => void
  onClose: () => void
}) {
  const { currentOrg } = useWorkspace()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [stageId, setStageId] = useState(stages[0]?.ref.id || '')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CrmContact[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<CrmContact | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const stage = stages.find(s => s.ref.id === stageId)?.ref || null

  useEffect(() => {
    if (mode !== 'existing' || !currentOrg) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      fetchContacts({ org_id: currentOrg.id, q: term, limit: 8 })
        .then(r => { if (!cancelled) setResults(r.contacts) })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, mode, currentOrg?.id])

  const canSave = !!stage && !saving && (mode === 'new' ? !!firstName.trim() : !!picked && !onBoard.has(picked.id))

  const handleAdd = async () => {
    if (!canSave || !stage || !currentOrg) return
    setSaving(true); setError('')
    let contact: CrmContact | null = picked
    try {
      if (mode === 'new') {
        contact = await createContact({
          org_id: currentOrg.id,
          first_name: firstName.trim(),
          last_name: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        })
      }
    } catch (e) {
      console.error('[Pipelines] create contact failed')
      setError('The contact could not be created. Try again.')
      setSaving(false)
      return
    }
    if (!contact) { setSaving(false); return }
    try {
      const positions = await apiSetStage(contact.id, stage.id, 'board')
      onAdded(contact, positions, stage)
      onClose()
    } catch (e: any) {
      setError(mode === 'new'
        ? `The contact was created but not added to ${pipeline.name}. Find them in Contacts and add them again.`
        : (e?.message || 'Could not add to this pipeline. Try again.'))
      setSaving(false)
    }
  }

  const input = 'w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30'
  const label = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-np-dark">Add to pipeline</h3>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">Adds to <span className="font-semibold text-np-blue">{pipeline.name}</span>. Other pipelines are not changed.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        {stages.length === 0 ? (
          <p className="text-xs text-gray-500">This pipeline has no stages ready yet. Save its stages, then reload the page.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {([['new', 'New contact'], ['existing', 'Existing contact']] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setMode(k); setError('') }}
                  className={`px-3 py-2 text-xs rounded-lg border transition-all ${mode === k ? 'border-np-blue bg-np-blue/5 text-np-blue font-medium' : 'border-gray-100 text-gray-500'}`}>{l}</button>
              ))}
            </div>

            <div>
              <label className={label}>Stage</label>
              <select value={stageId} onChange={e => setStageId(e.target.value)} className={input + ' bg-white'}>
                {stages.map(s => <option key={s.ref.id} value={s.ref.id}>{s.cfg.name}</option>)}
              </select>
            </div>

            {mode === 'new' ? <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={label}>First name *</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className={input} autoFocus />
                </div>
                <div>
                  <label className={label}>Last name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" className={input} />
                </div>
              </div>
              <div>
                <label className={label}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" className={input} />
              </div>
              <div>
                <label className={label}>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" className={input} />
              </div>
            </> : <>
              <div>
                <label className={label}>Find a contact</label>
                <input value={q} onChange={e => { setQ(e.target.value); setPicked(null) }} placeholder="Name, email or phone" className={input} autoFocus />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                {q.trim().length < 2 && <p className="px-3 py-3 text-[11px] text-gray-400">Type at least 2 letters.</p>}
                {q.trim().length >= 2 && searching && <p className="px-3 py-3 text-[11px] text-gray-400">Searching...</p>}
                {q.trim().length >= 2 && !searching && results.length === 0 && <p className="px-3 py-3 text-[11px] text-gray-400">No contacts found.</p>}
                {!searching && results.map(c => {
                  const already = onBoard.has(c.id)
                  const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'No name'
                  return (
                    <button key={c.id} disabled={already} onClick={() => setPicked(c)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 ${picked?.id === c.id ? 'bg-np-blue/5' : already ? '' : 'hover:bg-gray-50'}`}>
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs truncate ${already ? 'text-gray-400' : 'text-np-dark font-medium'}`}>{name}</p>
                        {c.email && <p className="text-[10px] text-gray-400 truncate">{c.email}</p>}
                      </div>
                      {already && <span className="text-[9px] text-gray-400 flex-shrink-0">On this board</span>}
                      {picked?.id === c.id && <span className="text-[9px] text-np-blue font-semibold flex-shrink-0">Selected</span>}
                    </button>
                  )
                })}
              </div>
            </>}
            {error && <p className="text-[11px] text-red-500">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
          <button onClick={handleAdd} disabled={!canSave}
            className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
            {saving ? 'Adding...' : mode === 'new' ? 'Create and add' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CONTACT_CHUNK = 150

// Board membership and stage come ONLY from contact_pipeline_positions (hub_229): a contact is on
// every board of a pipeline they hold a position in, in the column of their stage in THAT pipeline.
// A move, add or removal here changes that one pipeline's position and no other.
// contacts.pipeline_id / pipeline_stage are legacy: this page neither reads nor writes them.
// Pipeline definitions still come from org_settings crm_pipelines (the editor saves there and a
// trigger syncs the pipelines / pipeline_stages tables); positions use the tables' uuids, matched
// to the config by legacy key.
export default function PipelinesPage() {
  const { currentOrg } = useWorkspace()
  // Contacts on the active board, and their position in the active pipeline, keyed by contact id.
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [team, setTeam] = useState<{id:string;display_name:string;email:string|null}[]>([])
  const [loading, setLoading] = useState(true)
  const [boardError, setBoardError] = useState('')
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([DEFAULT_PIPELINE])
  const [activePipelineId, setActivePipelineId] = useState('default')
  // The pipelines / pipeline_stages tables (uuids), reloaded after the config is saved.
  const [refs, setRefs] = useState<PipelineRef[]>([])
  const [refsLoaded, setRefsLoaded] = useState(false)
  const [refsVersion, setRefsVersion] = useState(0)
  const [boardVersion, setBoardVersion] = useState(0)
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [showStageEditor, setShowStageEditor] = useState(false)
  const [showNewPipeline, setShowNewPipeline] = useState(false)
  const [showCardConfig, setShowCardConfig] = useState(false)
  const [showCustomFieldEditor, setShowCustomFieldEditor] = useState(false)
  const [showNewContact, setShowNewContact] = useState(false)
  const [showMetrics, setShowMetrics] = useState(true)
  const [removeTarget, setRemoveTarget] = useState<CrmContact | null>(null)
  const [removing, setRemoving] = useState(false)
  const toast = useToast()
  // Deals for the active pipeline, keyed by contact id.
  const [deals, setDeals] = useState<Record<string, PipelineDeal>>({})
  // Recent notes and open tasks for the active pipeline's cards, keyed by contact id.
  const [activity, setActivity] = useState<Record<string, CardActivity>>({})
  // The open contact's positions in every pipeline, so a change made in the detail view can be
  // told apart per pipeline.
  const detailBefore = useRef<Position[] | null>(null)
  const shownBoard = useRef<string | null>(null)
  const activePipeline = pipelines.find(p => p.id === activePipelineId) || pipelines[0]
  const activeRef = findPipeline(refs, activePipeline?.id)

  // A config column's stage in the tables: by its legacy key, else by its exact name.
  const stageRefFor = (cfg: PipelineStageConfig, ref: PipelineRef | null = activeRef): StageRef | null =>
    ref ? (ref.stages.find(s => s.key === cfg.id) ?? ref.stages.find(s => s.name === cfg.name) ?? null) : null
  const columns = activePipeline.stages.map(cfg => ({ cfg, ref: stageRefFor(cfg) }))
  const addableStages = columns.filter((c): c is { cfg: PipelineStageConfig; ref: StageRef } => !!c.ref)

  useEffect(() => {
    if (!currentOrg) return
    const load = async () => {
      try {
        const value: any = await readOrgSettingValue(currentOrg.id, 'crm_pipelines')
        if (value?.pipelines) {
          setPipelines(value.pipelines)
          setActivePipelineId(value.active || value.pipelines[0]?.id)
        }
      } catch (e) { console.error('[Pipelines] load error:', e) }
    }
    load()
  }, [currentOrg?.id])

  useEffect(() => {
    if (!currentOrg) return
    let cancelled = false
    loadPipelines(createClient(), currentOrg.id)
      .then(r => { if (!cancelled) setRefs(r) })
      .catch(e => console.error(`[Pipelines] pipelines read failed: ${(e as Error).message}`))
      .finally(() => { if (!cancelled) setRefsLoaded(true) })
    return () => { cancelled = true }
  }, [currentOrg?.id, refsVersion])

  const savePipelines = async (updated: PipelineConfig[], activeId?: string) => {
    setPipelines(updated); if (activeId) setActivePipelineId(activeId); if (!currentOrg) return
    try {
      await createClient().from('org_settings').upsert({ org_id: currentOrg.id, setting_key: 'crm_pipelines', setting_value: { pipelines: updated, active: activeId || activePipelineId } }, { onConflict: 'org_id,setting_key' })
      // The tables follow the config by trigger; read them again for the new uuids.
      setRefsVersion(v => v + 1)
    } catch (e) { console.error(e) }
  }

  // The active board: its positions, then the contacts they belong to.
  const activeRefId = activeRef?.id
  useEffect(() => {
    if (!currentOrg || !refsLoaded) return
    let cancelled = false
    const ref = findPipeline(refs, activePipeline?.id)
    // A different pipeline: drop the last board's cards rather than show them in the wrong columns.
    if (shownBoard.current !== (ref?.id ?? null)) { setPositions({}); setContacts([]); shownBoard.current = ref?.id ?? null }
    if (!ref) { setLoading(false); return }
    const load = async () => {
      const db = createClient()
      const ps = await loadPositions(db, currentOrg.id, { pipelineId: ref.id, pipelines: refs })
      const ids = ps.map(p => p.contact_id)
      const rows: CrmContact[] = []
      for (let i = 0; i < ids.length; i += CONTACT_CHUNK) {
        const { data, error } = await db.from('contacts').select('*')
          .eq('org_id', currentOrg.id).in('id', ids.slice(i, i + CONTACT_CHUNK))
          .is('merged_into_id', null).is('archived_at', null)
        if (error) throw new Error(`contacts read: ${error.code ?? 'unknown'}`)
        rows.push(...((data ?? []) as CrmContact[]))
      }
      if (cancelled) return
      rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      const map: Record<string, Position> = {}
      for (const p of ps) map[p.contact_id] = p
      setPositions(map)
      setContacts(rows)
      setBoardError('')
    }
    load()
      .catch(e => { if (!cancelled) { console.error(`[Pipelines] board read failed: ${(e as Error).message}`); setBoardError('The board could not be loaded. Reload the page.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentOrg?.id, refsLoaded, activeRefId, boardVersion])

  useEffect(() => {
    if (!currentOrg || !activePipeline?.id) return
    let cancelled = false
    setDeals({})
    fetch(`/api/crm/pipeline-deals?org_id=${currentOrg.id}&pipeline_key=${encodeURIComponent(activePipeline.id)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled || !Array.isArray(j?.deals)) return
        const map: Record<string, PipelineDeal> = {}
        for (const d of j.deals) map[d.contact_id] = toDeal(d)
        setDeals(map)
      })
      .catch(e => console.error('[Pipelines] deals load error:', e))
    return () => { cancelled = true }
  }, [currentOrg?.id, activePipeline?.id])

  // One request for the whole board. Pipelines whose cards show neither section
  // skip it entirely.
  const cardSectionsOn = boardSectionOn(activePipeline?.card_config, 'recent_notes') || boardSectionOn(activePipeline?.card_config, 'open_tasks')
  useEffect(() => {
    if (!currentOrg || !activePipeline?.id || !cardSectionsOn) { setActivity({}); return }
    let cancelled = false
    setActivity({})
    fetch(`/api/crm/pipeline-card-activity?org_id=${currentOrg.id}&pipeline_key=${encodeURIComponent(activePipeline.id)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.activity) setActivity(j.activity) })
      .catch(e => console.error('[Pipelines] card activity load error:', e))
    return () => { cancelled = true }
  }, [currentOrg?.id, activePipeline?.id, cardSectionsOn, boardVersion])

  // One card, after a note or task changed in the contact detail view.
  const refreshCardActivity = (contactId: string) => {
    if (!currentOrg || !activePipeline?.id || !cardSectionsOn) return
    fetch(`/api/crm/pipeline-card-activity?org_id=${currentOrg.id}&pipeline_key=${encodeURIComponent(activePipeline.id)}&contact_id=${contactId}`)
      .then(r => r.json())
      .then(j => {
        if (!j?.activity) return
        setActivity(a => { const n = { ...a }; if (j.activity[contactId]) n[contactId] = j.activity[contactId]; else delete n[contactId]; return n })
      })
      .catch(e => console.error('[Pipelines] card activity refresh error:', e))
  }

  const postDeal = async (payload: Record<string, unknown>): Promise<PipelineDeal> => {
    const res = await fetch('/api/crm/pipeline-deals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.deal) throw new Error(j?.error || `Request failed (${res.status})`)
    return toDeal(j.deal)
  }

  const saveDealValue = async (contactId: string, value: number | null) => {
    const prev = deals[contactId]
    const nowIso = new Date().toISOString()
    setDeals(d => ({ ...d, [contactId]: { ...(prev || { contact_id: contactId, pipeline_key: activePipelineId, entered_at: nowIso, stage_changed_at: nowIso, won_at: null, lost_at: null }), value } }))
    try {
      const deal = await postDeal({ contact_id: contactId, pipeline_key: activePipelineId, value })
      setDeals(d => ({ ...d, [contactId]: deal }))
    } catch (e: any) {
      console.error('saveDealValue failed', e)
      setDeals(d => { const n = { ...d }; if (prev) n[contactId] = prev; else delete n[contactId]; return n })
      alert(`Could not save the lead value: ${e?.message || e}`)
    }
  }

  // After a stage move or add in ONE pipeline (by legacy key): stamp the stage change and
  // won/lost locally so the summary updates at once, then take the server's row (it reads the
  // contact's position in that pipeline and the stage's flags).
  const touchDeal = (contactId: string, pipelineKey: string, t: StageType, enteredPipeline: boolean) => {
    const nowIso = new Date().toISOString()
    if (pipelineKey === activePipelineId) {
      setDeals(d => {
        const cur = d[contactId]
        return { ...d, [contactId]: {
          contact_id: contactId, pipeline_key: pipelineKey, value: cur?.value ?? null,
          entered_at: enteredPipeline || !cur ? nowIso : cur.entered_at,
          stage_changed_at: nowIso,
          won_at: t === 'won' ? (cur?.won_at ?? nowIso) : null,
          lost_at: t === 'lost' ? (cur?.lost_at ?? nowIso) : null,
        } }
      })
    }
    postDeal({ contact_id: contactId, pipeline_key: pipelineKey, touch: true, entered_pipeline: enteredPipeline })
      .then(deal => { if (pipelineKey === activePipelineId) setDeals(d => ({ ...d, [contactId]: deal })) })
      .catch(e => console.error('touchDeal failed', e))
  }

  useEffect(() => {
    if (!currentOrg) return
    createClient().from('team_profiles').select('id,display_name,email').eq('org_id', currentOrg.id).order('display_name').then(({data})=>setTeam(data||[]))
  }, [currentOrg?.id])

  // Stage emails for the stage entered in THIS pipeline: config ids (pipeline legacy key + stage
  // id), which are what the route's content lookup, its position check and the send guard (077) key on.
  const fireStageEmails = async (contactId: string, pipelineKey: string, stageCfgId: string) => {
    try {
      await fetch('/api/crm/stage-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, pipeline_id: pipelineKey, stage_id: stageCfgId }),
      })
    } catch (e) { console.error('fireStageEmails failed', e) }
  }

  // Keeps the board's copy of the active pipeline's position in step with the server's.
  const takePositions = (contactId: string, after: Position[]) => {
    const mine = activeRef ? after.find(p => p.pipeline_id === activeRef.id) : undefined
    setPositions(prev => { const n = { ...prev }; if (mine) n[contactId] = mine; else delete n[contactId]; return n })
  }

  const moveContact = async (id: string, cfg: PipelineStageConfig) => {
    const ref = activeRef, sr = stageRefFor(cfg)
    if (!ref || !sr) { toast.show('This stage is not ready yet. Reload the page and try again.', 'error'); return }
    const before = positions[id]
    if (before?.stage_id === sr.id) return
    // Optimistic UI, but surface persistence failures: a swallowed error makes a move look
    // successful while the database never changed.
    const prevPositions = positions
    setPositions(prev => ({ ...prev, [id]: makePosition(id, ref, sr) }))
    try {
      const after = await apiSetStage(id, sr.id, 'board')
      takePositions(id, after)
      touchDeal(id, ref.key, stageTypeOf(sr), !before)
      fireStageEmails(id, ref.key, cfg.id)
    } catch (e: any) {
      console.error(`[Pipelines] move contact=${id} failed`)
      setPositions(prevPositions) // roll back the optimistic move
      toast.show(`Could not move to ${cfg.name}. ${e?.message || ''}`.trim(), 'error')
    }
  }

  // Adds the contact to another pipeline at its first stage. This board's position is kept.
  const addToPipeline = async (id: string, pipelineKey: string) => {
    const ref = findPipeline(refs, pipelineKey)
    const target = pipelines.find(p => p.id === pipelineKey)
    const cfgFirst = target?.stages[0]
    const sr = (cfgFirst ? stageRefFor(cfgFirst, ref) : null) ?? firstStage(ref)
    if (!ref || !sr) { toast.show('That pipeline has no stages ready yet.', 'error'); return }
    try {
      const after = await apiSetStage(id, sr.id, 'board')
      takePositions(id, after)
      touchDeal(id, ref.key, stageTypeOf(sr), true)
      toast.show(`Added to ${ref.name}`)
    } catch (e: any) {
      console.error(`[Pipelines] add contact=${id} failed`)
      toast.show(`Could not add to ${ref.name}. ${e?.message || ''}`.trim(), 'error')
    }
  }

  const loadMemberships = async (id: string): Promise<string[]> => {
    if (!currentOrg) return []
    const ps = await fetchContactPositions(currentOrg.id, id)
    return ps.map(p => p.pipeline_key)
  }

  // Optimistic: the card, stage counts, totals and summary cards drop it at once.
  // Rolled back with the error shown if the server refuses. The route removes the position in
  // THIS pipeline only, and its deal row; the contact's other pipelines are untouched.
  const removeFromPipeline = async (contact: CrmContact) => {
    const id = contact.id, pipelineKey = activePipelineId
    const prevPositions = positions, prevDeals = deals
    setRemoving(true)
    setPositions(prev => { const n = { ...prev }; delete n[id]; return n })
    setDeals(d => { const n = { ...d }; delete n[id]; return n })
    try {
      const res = await fetch('/api/crm/pipeline-deals/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: id, pipeline_key: pipelineKey }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'Something went wrong. Try again.')
      setContacts(prev => prev.filter(c => c.id !== id))
      setRemoveTarget(null)
      toast.show(`Removed from ${activePipeline.name}`)
    } catch (e: any) {
      console.error(`[Pipelines] remove contact=${id} failed`)
      setPositions(prevPositions)
      setDeals(prevDeals)
      setRemoveTarget(null)
      toast.show(`Could not remove from ${activePipeline.name}: ${e?.message || e}`, 'error')
    } finally {
      setRemoving(false)
    }
  }

  const handleAdded = (contact: CrmContact, after: Position[], stage: StageRef) => {
    setContacts(prev => [contact, ...prev.filter(c => c.id !== contact.id)])
    takePositions(contact.id, after)
    if (activeRef) touchDeal(contact.id, activeRef.key, stageTypeOf(stage), true)
  }

  // The open contact's positions, so a change in the detail view can be compared per pipeline.
  useEffect(() => {
    detailBefore.current = null
    if (!currentOrg || !selectedContactId) return
    let cancelled = false
    fetchContactPositions(currentOrg.id, selectedContactId)
      .then(ps => { if (!cancelled) detailBefore.current = ps })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentOrg?.id, selectedContactId])

  // A stage or pipeline change made in the detail view counts as a move too, in each pipeline
  // where it happened.
  const afterDetailUpdate = async (contactId: string) => {
    if (!currentOrg) return
    refreshCardActivity(contactId)
    setBoardVersion(v => v + 1)
    const before = detailBefore.current
    if (!before) return
    try {
      const after = await fetchContactPositions(currentOrg.id, contactId)
      detailBefore.current = after
      for (const a of after) {
        const b = before.find(x => x.pipeline_id === a.pipeline_id)
        if (!b || b.stage_id !== a.stage_id) touchDeal(contactId, a.pipeline_key, stageTypeOf(a), !b)
      }
    } catch { /* the board reload still shows the truth */ }
  }

  const onBoard = new Set(Object.keys(positions))
  const pipelineContacts = contacts.filter(c => !!positions[c.id])
  const mappedStageIds = new Set(columns.map(c => c.ref?.id).filter(Boolean) as string[])
  const firstColumnKey = activePipeline.stages[0] ? colKey(activePipeline.stages[0]) : null
  const stageContacts = (cfg: PipelineStageConfig) => {
    const sr = columns.find(c => colKey(c.cfg) === colKey(cfg))?.ref
    const isFirst = colKey(cfg) === firstColumnKey
    return pipelineContacts.filter(c => {
      const p = positions[c.id]
      if (sr && p.stage_id === sr.id) return true
      // A stage with no column here (not yet in the config) parks in the first column so the card never disappears.
      return isFirst && !mappedStageIds.has(p.stage_id)
    })
  }
  const columnOf = (contactId: string): string | null => {
    const p = positions[contactId]
    const c = p ? columns.find(x => x.ref?.id === p.stage_id) : undefined
    return c ? colKey(c.cfg) : null
  }
  // null when no card in the stage has a value, so the header shows nothing rather than $0
  const stageValue = (cfg: PipelineStageConfig) => {
    const vals = stageContacts(cfg).map(c => deals[c.id]?.value ?? null).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="space-y-4 animate-in fade-in duration-300" data-help-screen="crm-pipelines">
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
                  <button data-help-id="pipelines.new" onClick={() => { setShowNewPipeline(true); setShowDropdown(false) }} className="w-full text-left px-3 py-2 text-xs text-np-blue hover:bg-np-blue/5 flex items-center gap-1.5"><Plus size={11} /> New Pipeline</button>
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400">{pipelineContacts.length} contacts</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowMetrics(!showMetrics)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${showMetrics ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-50 text-gray-400'}`}><BarChart3 size={13} /> Metrics</button>
          <button onClick={() => setShowCustomFieldEditor(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors"><Sliders size={13} /> Custom Fields</button>
          <button onClick={() => setShowCardConfig(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors"><LayoutGrid size={13} /> Card Fields</button>
          <button data-help-id="pipelines.edit-stages" onClick={() => setShowStageEditor(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors"><Settings size={13} /> Edit Stages</button>
          <button onClick={() => setShowNewContact(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors"><Plus size={13} /> Add Contact</button>
        </div>
      </div>

      {boardError && <p className="text-xs text-red-500">{boardError}</p>}
      {refsLoaded && !activeRef && !boardError && (
        <p className="text-xs text-gray-500">This pipeline is not ready yet. Save its stages, then reload the page.</p>
      )}

      {showMetrics && <PipelineMetrics contacts={pipelineContacts} positions={positions} deals={deals} />}

      <div data-help-id="pipelines.board" className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2" style={{ height: 'calc(100vh - 300px)' }}>
        {activePipeline.stages.map(stage => {
          const sc = stageContacts(stage); const sv = stageValue(stage)
          return (
            <div key={colKey(stage)} className="flex-shrink-0 w-64 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-xs font-semibold text-np-dark">{stage.name}</span>
                <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">{sc.length}</span>
                {sv !== null && <span className="text-[10px] font-medium text-green-600">· {formatUsdFull(sv)}</span>}
              </div>
              <div
                className="space-y-2 flex-1 overflow-y-auto rounded-xl bg-gray-50/50 p-2 border-2 border-dashed border-gray-100/50 transition-all duration-200"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('bg-np-blue/10', 'border-np-blue/40', 'scale-[1.01]'); e.currentTarget.classList.remove('bg-gray-50/50', 'border-gray-100/50') }}
                onDragLeave={e => { e.currentTarget.classList.remove('bg-np-blue/10', 'border-np-blue/40', 'scale-[1.01]'); e.currentTarget.classList.add('bg-gray-50/50', 'border-gray-100/50') }}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('bg-np-blue/10', 'border-np-blue/40', 'scale-[1.01]'); e.currentTarget.classList.add('bg-gray-50/50', 'border-gray-100/50'); const cid = e.dataTransfer.getData('contactId'); if (cid && positions[cid]) moveContact(cid, stage) }}
              >
                {sc.map(c => <ContactCard key={c.id} contact={c} position={positions[c.id]} currentStageId={columnOf(c.id)} stages={activePipeline.stages} pipelines={pipelines} activePipelineId={activePipelineId} customFields={activePipeline.custom_fields || []} dealValue={deals[c.id]?.value ?? null} onSaveValue={v => saveDealValue(c.id, v)} onMove={s => moveContact(c.id, s)} onAddToPipeline={key => addToPipeline(c.id, key)} loadMemberships={() => loadMemberships(c.id)} onRemovePipeline={() => setRemoveTarget(c)} onOpenContact={setSelectedContactId} activity={activity[c.id]} showNotes={boardSectionOn(activePipeline.card_config, 'recent_notes')} showTasks={boardSectionOn(activePipeline.card_config, 'open_tasks')} />)}
                {sc.length === 0 && <div className="text-center py-8 text-[10px] text-gray-400">No contacts</div>}
              </div>
            </div>
          )
        })}
      </div>

      {showStageEditor && <StageEditor stages={activePipeline.stages} team={team} orgId={currentOrg?.id} onSave={s => { savePipelines(pipelines.map(p => p.id===activePipelineId ? { ...p, stages:s } : p)); setShowStageEditor(false) }} onClose={() => setShowStageEditor(false)} />}
      {removeTarget && <RemoveFromPipelineModal contactName={`${removeTarget.first_name || ''} ${removeTarget.last_name || ''}`.trim() || 'This contact'} pipelineName={activePipeline.name} busy={removing} onConfirm={() => removeFromPipeline(removeTarget)} onClose={() => setRemoveTarget(null)} />}
      {showNewPipeline && <NewPipelineModal onSave={p => { savePipelines([...pipelines, p], p.id); setShowNewPipeline(false) }} onClose={() => setShowNewPipeline(false)} />}
      {showCardConfig && <CardConfigEditor pipeline={activePipeline} onSave={cfg => { savePipelines(pipelines.map(p => p.id===activePipelineId ? { ...p, card_config:cfg } : p)); setShowCardConfig(false) }} onClose={() => setShowCardConfig(false)} />}
      {showCustomFieldEditor && <CustomFieldEditor pipeline={activePipeline} onSave={fields => { savePipelines(pipelines.map(p => p.id===activePipelineId ? { ...p, custom_fields:fields } : p)); setShowCustomFieldEditor(false) }} onClose={() => setShowCustomFieldEditor(false)} />}
      {showNewContact && <AddContactModal pipeline={activePipeline} stages={addableStages} onBoard={onBoard} onAdded={handleAdded} onClose={() => setShowNewContact(false)} />}
      {selectedContactId && <ContactDetail contactId={selectedContactId} cardConfig={activePipeline.card_config} pipelineCustomFields={activePipeline.custom_fields}
        leadValue={{ pipelineName: activePipeline.name, value: deals[selectedContactId]?.value ?? null, onSave: v => saveDealValue(selectedContactId, v) }}
        onClose={() => setSelectedContactId(null)}
        onActivityChange={() => refreshCardActivity(selectedContactId)}
        onUpdate={() => { afterDetailUpdate(selectedContactId) }} />}
    </div>
  )
}
