'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, MeetingActionItem, IdsItem } from '@/lib/types/meetings'
import {
  ChevronLeft, ChevronDown, Clock, Check, Loader2, Target, Play, Timer, Plus, X,
  Mic, MicOff, Calendar, ArrowRight, Edit3, RotateCcw, Trash2, ThumbsUp,
  CheckCircle2, AlertTriangle, HelpCircle, Send
} from 'lucide-react'

/* ─── Timer ─── */
function STimer({ dur, active }: { dur: number; active: boolean }) {
  const [el, setEl] = useState(0); const ref = useRef<NodeJS.Timeout | null>(null)
  const tot = dur * 60; const rem = tot - el
  useEffect(() => { setEl(0) }, [dur])
  useEffect(() => {
    if (active) ref.current = setInterval(() => setEl(p => p + 1), 1000)
    else if (ref.current) clearInterval(ref.current)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [active])
  const fmt = (s: number) => { const a = Math.abs(s); return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${(a % 60).toString().padStart(2, '0')}` }
  const pct = tot > 0 ? Math.max(0, rem / tot) : 0
  let c = '#16A34A', bg = '#F0FDF4'
  if (rem <= 0) { c = '#DC2626'; bg = '#FEF2F2' } else if (pct < 0.25) { c = '#D97706'; bg = '#FFFBEB' }
  return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold tabular-nums" style={{ background: bg, color: c }}><Timer size={10} />{fmt(rem)}</span>
}

/* ─── Voice ─── */
function useVoice(cb: (t: string) => void) {
  const [on, setOn] = useState(false); const r = useRef<any>(null)
  const toggle = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return
    if (on && r.current) { r.current.stop(); setOn(false); return }
    const x = new SR(); x.continuous = false; x.interimResults = false; x.lang = 'en-US'
    x.onresult = (e: any) => { cb(e.results[0]?.[0]?.transcript || ''); setOn(false) }
    x.onerror = () => setOn(false); x.onend = () => setOn(false); r.current = x; x.start(); setOn(true)
  }, [on, cb]); return { on, toggle }
}

/* ═══ IDS TABLE — Full 7-column Mentor format ═══ */
function IdsTable({ items, onUpdate, onRemove }: {
  items: IdsItem[]; onUpdate: (id: string, u: Partial<IdsItem>) => void; onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const sc: Record<string, { bg: string; fg: string; label: string }> = {
    identified: { bg: '#FEF3C7', fg: '#D97706', label: 'IDENTIFIED' },
    discussed: { bg: '#DBEAFE', fg: '#2563EB', label: 'DISCUSSED' },
    solved: { bg: '#D1FAE5', fg: '#059669', label: 'SOLVED' },
  }
  const advance = (s: IdsItem['status']): IdsItem['status'] => s === 'identified' ? 'discussed' : s === 'discussed' ? 'solved' : 'solved'

  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={11} className="text-fire" />
        <span className="text-[9px] font-bold text-fire uppercase tracking-wider">IDS Capture List ({items.length})</span>
        <div className="flex gap-2 ml-auto text-[9px]">
          <span className="text-green-500 font-semibold">{items.filter(i => i.status === 'solved').length} solved</span>
          <span className="text-amber-500 font-semibold">{items.filter(i => i.status !== 'solved').length} open</span>
        </div>
      </div>
      {/* Header */}
      <div className="hidden sm:grid grid-cols-12 gap-1 px-2 py-1.5 text-[8px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 rounded-lg">
        <div className="col-span-1">Status</div><div className="col-span-2">Category</div><div className="col-span-3">Description</div>
        <div className="col-span-2">Action Items</div><div className="col-span-1">Due</div><div className="col-span-2">Owner</div><div className="col-span-1"></div>
      </div>
      {/* Rows */}
      {items.map(item => {
        const s = sc[item.status] || sc.identified; const isExp = expanded === item.id
        return (
          <div key={item.id} className="rounded-xl border border-gray-100 overflow-hidden bg-white">
            <div className="grid grid-cols-12 gap-1 items-center px-2 py-2.5 cursor-pointer hover:bg-gray-50/50" onClick={() => setExpanded(isExp ? null : item.id)}>
              <div className="col-span-1"><button onClick={e => { e.stopPropagation(); onUpdate(item.id, { status: advance(item.status) }) }} className="px-1.5 py-0.5 rounded-full text-[7px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.label.slice(0, 4)}</button></div>
              <div className="col-span-2"><input value={item.issue_category} onChange={e => onUpdate(item.id, { issue_category: e.target.value })} onClick={e => e.stopPropagation()} placeholder="Category" className="w-full text-[10px] font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1" /></div>
              <div className="col-span-3 text-[10px] text-gray-600 truncate">{item.description || '—'}</div>
              <div className="col-span-2 text-[10px] text-gray-500 truncate">{item.action_items_text || '—'}</div>
              <div className="col-span-1"><input value={item.due_date} onChange={e => onUpdate(item.id, { due_date: e.target.value })} onClick={e => e.stopPropagation()} placeholder="Due" className="w-full text-[9px] text-gray-400 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-0.5" /></div>
              <div className="col-span-2"><input value={item.owner_name} onChange={e => onUpdate(item.id, { owner_name: e.target.value })} onClick={e => e.stopPropagation()} placeholder="Owner" className="w-full text-[10px] font-medium text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1" /></div>
              <div className="col-span-1 flex items-center gap-1 justify-end">
                <ChevronDown size={10} className={`text-gray-300 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                <button onClick={e => { e.stopPropagation(); onRemove(item.id) }} className="text-gray-200 hover:text-red-400 p-0.5"><X size={10} /></button>
              </div>
            </div>
            {isExp && (
              <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100 bg-gray-50/30">
                <div><label className="text-[8px] font-bold text-gray-400 uppercase">Description</label>
                  <textarea value={item.description} onChange={e => onUpdate(item.id, { description: e.target.value })} rows={2} className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-white focus:outline-none resize-none" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[8px] font-bold text-gray-400 uppercase">Dependencies / Context</label>
                    <textarea value={item.dependencies_context} onChange={e => onUpdate(item.id, { dependencies_context: e.target.value })} rows={2} className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-white focus:outline-none resize-none" /></div>
                  <div><label className="text-[8px] font-bold text-gray-400 uppercase">Decisions Needed</label>
                    <textarea value={item.decisions_needed} onChange={e => onUpdate(item.id, { decisions_needed: e.target.value })} rows={2} className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-white focus:outline-none resize-none" /></div>
                </div>
                <div><label className="text-[8px] font-bold text-gray-400 uppercase">Action Items</label>
                  <textarea value={item.action_items_text} onChange={e => onUpdate(item.id, { action_items_text: e.target.value })} rows={2} placeholder="Concrete next steps..." className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-white focus:outline-none resize-none" /></div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ═══ END REVIEW ═══ */
function EndReview({ deferredActions, newActions, idsItems, onApprove, onDefer, onDelete, onScheduleNext }: {
  deferredActions: MeetingActionItem[]; newActions: MeetingActionItem[]; idsItems: IdsItem[]
  onApprove: (id: string) => void; onDefer: (id: string) => void; onDelete: (id: string) => void; onScheduleNext: () => void
}) {
  const approved = [...deferredActions, ...newActions].filter(a => a.status === 'approved')
  const pendingDeferred = deferredActions.filter(a => a.status === 'pending' || a.status === 'deferred')
  const pendingNew = newActions.filter(a => a.status === 'pending')
  const openIds = idsItems.filter(i => i.status !== 'solved')

  const ActionRow = ({ a }: { a: MeetingActionItem }) => (
    <div className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-100">
      <span className="text-xs text-np-dark font-medium flex-1">{a.title}</span>
      {a.owner_name && <span className="text-[9px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg shrink-0">{a.owner_name}</span>}
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => onApprove(a.id)} title="Approve → Task Manager" className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-50 text-green-600 hover:bg-green-100"><ThumbsUp size={13} /></button>
        <button onClick={() => onDefer(a.id)} title="Defer → Next meeting" className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-100"><RotateCcw size={13} /></button>
        <button onClick={() => onDelete(a.id)} title="Reject" className="w-8 h-8 rounded-lg flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-400"><Trash2 size={13} /></button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3"><CheckCircle2 size={28} className="text-green-500" /></div>
        <h3 className="text-sm font-bold text-np-dark">Meeting Complete</h3>
        <p className="text-xs text-gray-400 mt-1">Review each item — approve, defer, or reject</p>
      </div>
      {idsItems.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4">
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">IDS Summary</span>
          <div className="flex gap-3 mt-2"><span className="text-[10px] font-semibold text-green-600">{idsItems.filter(i => i.status === 'solved').length} solved</span><span className="text-[10px] font-semibold text-amber-600">{openIds.length} open</span></div>
          {openIds.length > 0 && <div className="mt-2 space-y-1">{openIds.map(i => <div key={i.id} className="text-[10px] text-amber-700 flex items-center gap-1"><AlertTriangle size={9} /> {i.issue_category || i.description}</div>)}</div>}
        </div>
      )}
      {pendingDeferred.length > 0 && <div><span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">🔄 Deferred From Previous ({pendingDeferred.length})</span><div className="mt-2 space-y-2">{pendingDeferred.map(a => <ActionRow key={a.id} a={a} />)}</div></div>}
      {pendingNew.length > 0 && <div><span className="text-[9px] font-bold text-np-blue uppercase tracking-wider">✏️ New Action Items ({pendingNew.length})</span><div className="mt-2 space-y-2">{pendingNew.map(a => <ActionRow key={a.id} a={a} />)}</div></div>}
      {approved.length > 0 && <div><span className="text-[9px] font-bold text-green-600 uppercase tracking-wider">✅ Approved → Tasks ({approved.length})</span><div className="mt-1.5 space-y-1">{approved.map(a => <div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px] text-gray-400"><Check size={10} className="text-green-500" /><span className="line-through">{a.title}</span></div>)}</div></div>}
      <button onClick={onScheduleNext} className="w-full flex items-center justify-center gap-2 py-3.5 bg-np-blue/5 text-np-blue text-xs font-semibold rounded-xl border border-np-blue/20 hover:bg-np-blue/10"><Calendar size={13} /> Schedule Next Meeting</button>
    </div>
  )
}

/* ═══ SCHEDULE NEXT ═══ */
function SchedModal({ deferred, onSched, onClose }: { deferred: MeetingActionItem[]; onSched: (d: string, t: string) => void; onClose: () => void }) {
  const [d, setD] = useState(''); const [t, setT] = useState('09:00')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-np-dark mb-4">Schedule Next Meeting</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Date</label><input type="date" value={d} onChange={e => setD(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Time</label><input type="time" value={t} onChange={e => setT(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
        </div>
        {deferred.length > 0 && <div className="bg-amber-50 rounded-xl p-3 mb-4"><span className="text-[9px] font-bold text-amber-600 uppercase">Deferred Items ({deferred.length})</span><div className="mt-1 space-y-0.5">{deferred.map(a => <div key={a.id} className="text-[10px] text-amber-700 flex items-center gap-1"><ArrowRight size={8} />{a.title}</div>)}</div></div>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button><button onClick={() => d && onSched(d, t)} disabled={!d} className="px-5 py-2 bg-np-blue text-white text-xs font-semibold rounded-xl disabled:opacity-40">Schedule</button></div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   MAIN DETAIL PAGE
   ══════════════════════════════════════════════════════════ */
export default function MeetingDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { currentOrg } = useWorkspace()
  const { rocks } = useRockData()
  const { members } = useTeamData()
  const supabase = createClient()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([])
  const [loading, setLoading] = useState(true)
  const [openSec, setOpenSec] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [showSched, setShowSched] = useState(false)
  const [prevActions, setPrevActions] = useState<MeetingActionItem[]>([])
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})
  const [secIdsText, setSecIdsText] = useState('')
  const [secActionText, setSecActionText] = useState('')
  const { on: vOnIds, toggle: vTogIds } = useVoice(t => setSecIdsText(p => p ? p + ' ' + t : t))
  const { on: vOnAct, toggle: vTogAct } = useVoice(t => setSecActionText(p => p ? p + ' ' + t : t))

  const load = useCallback(async () => {
    if (!id) return; setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) setMeeting({ ...m, agenda: m.agenda || [], action_items: m.action_items || [], ids_items: m.ids_items || [] })
    const { data: att } = await supabase.from('meeting_attendees').select('*, team_profiles:user_id(display_name)').eq('meeting_id', id)
    if (att) setAttendees(att.map((a: any) => ({ ...a, display_name: a.team_profiles?.display_name || 'Unknown' })))
    const { data: revs } = await supabase.from('meeting_rock_reviews').select('*').eq('meeting_id', id)
    if (revs) { const map: Record<string, string> = {}; revs.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' }); setRockReviews(map) }
    if (m?.prev_meeting_id) {
      const { data: prev } = await supabase.from('meetings').select('action_items, agenda').eq('id', m.prev_meeting_id).single()
      if (prev?.action_items) {
        const allPrev = prev.action_items as MeetingActionItem[]
        setPrevActions(allPrev.filter((a: any) => a.status === 'deferred'))
        const agenda = m.agenda || []
        const todoIdx = agenda.findIndex((s: any) => s.section.toLowerCase().includes('to-do') || s.section.toLowerCase().includes('todo'))
        if (todoIdx >= 0 && (!agenda[todoIdx].talking_points || agenda[todoIdx].talking_points.length === 0)) {
          const prevItems = allPrev.filter((a: any) => a.status !== 'deleted')
          if (prevItems.length > 0) {
            const updated = [...agenda]
            updated[todoIdx] = { ...updated[todoIdx], talking_points: prevItems.map((a: any) => {
              const icon = a.status === 'approved' ? '✅' : a.status === 'deferred' ? '🔄' : '⬜'
              const owner = a.owner_name ? ` (${a.owner_name})` : ''
              return `${icon} ${a.title}${owner}`
            })}
            if (prev.agenda) { (prev.agenda as AgendaSection[]).forEach((ps: AgendaSection) => {
              const mi = updated.findIndex(s => s.section === ps.section)
              if (mi >= 0 && ps.notes && !updated[mi].notes) updated[mi] = { ...updated[mi], notes: `[Previous] ${ps.notes}` }
            })}
            await supabase.from('meetings').update({ agenda: updated, updated_at: new Date().toISOString() }).eq('id', m.id)
            m.agenda = updated
            setMeeting({ ...m, agenda: updated, action_items: m.action_items || [], ids_items: m.ids_items || [] })
          }
        }
      }
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async (u: Partial<Meeting>) => { if (!meeting) return; setMeeting(p => p ? { ...p, ...u } : p); await supabase.from('meetings').update({ ...u, updated_at: new Date().toISOString() }).eq('id', meeting.id) }
  const startMeeting = () => { save({ status: 'in_progress' }); setOpenSec(0) }
  const endMeeting = () => { save({ status: 'completed' }); setOpenSec(null) }
  const toggleSec = (i: number) => { if (meeting?.status !== 'in_progress' && meeting?.status !== 'completed') return; setOpenSec(openSec === i ? null : i) }
  const checkSec = (i: number) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], completed: !a[i].completed }; save({ agenda: a }); if (a[i].completed) { const nx = a.findIndex((s, j) => j > i && !s.completed); if (nx >= 0) setOpenSec(nx) } }
  const updateNotes = (i: number, n: string) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], notes: n }; save({ agenda: a }) }

  const addIdsItem = () => {
    if (!secIdsText.trim() || !meeting) return
    const item: IdsItem = { id: crypto.randomUUID(), issue_category: '', description: secIdsText.trim(), dependencies_context: '', decisions_needed: '', action_items_text: '', due_date: '', owner: '', owner_name: '', status: 'identified', resolution: '', created_at: new Date().toISOString() }
    save({ ids_items: [...(meeting.ids_items || []), item] }); setSecIdsText('')
  }
  const addActionItem = () => {
    if (!secActionText.trim() || !meeting) return
    const item: MeetingActionItem = { id: crypto.randomUUID(), title: secActionText.trim(), owner: '', owner_name: '', due_date: '', status: 'pending', task_id: null }
    save({ action_items: [...(meeting.action_items || []), item] }); setSecActionText('')
  }
  const updateIds = (itemId: string, u: Partial<IdsItem>) => { if (!meeting) return; save({ ids_items: (meeting.ids_items || []).map(i => i.id === itemId ? { ...i, ...u } : i) }) }
  const removeIds = (itemId: string) => { if (!meeting) return; save({ ids_items: (meeting.ids_items || []).filter(i => i.id !== itemId) }) }
  const approveAction = async (aid: string) => {
    if (!meeting || !currentOrg) return; const action = (meeting.action_items || []).find(a => a.id === aid); if (!action) return
    const { data: cols } = await supabase.from('kanban_columns').select('id').eq('org_id', currentOrg.id).order('sort_order').limit(1)
    if (cols?.length) { const { data: task } = await supabase.from('kanban_tasks').insert({ org_id: currentOrg.id, column_id: cols[0].id, title: action.title, source: 'meeting', priority: 'medium', visibility: 'everyone', sort_order: 0, assignee: action.owner || null, custom_fields: { meeting_id: meeting.id } }).select().single(); if (task) save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'approved' as const, task_id: task.id } : a) }) }
  }
  const deferAction = (aid: string) => { if (!meeting) return; save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'deferred' as const } : a) }) }
  const deleteAction = (aid: string) => { if (!meeting) return; save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'deleted' as const } : a) }) }

  const scheduleNext = async (date: string, time: string) => {
    if (!meeting || !currentOrg) return
    const deferredItems = (meeting.action_items || []).filter(a => a.status === 'deferred')
    const templateAgenda = MEETING_TEMPLATES[meeting.template as MeetingTemplate]?.defaultAgenda || meeting.agenda || []
    const freshAgenda = templateAgenda.map(s => ({ ...s, notes: '', completed: false, talking_points: [] as string[] }))
    let finalAgenda = [...freshAgenda]
    if (deferredItems.length > 0) { const ei = finalAgenda.findIndex(s => s.section.toLowerCase().includes('deferred')); if (ei >= 0) finalAgenda[ei] = { ...finalAgenda[ei], talking_points: deferredItems.map(d => `🔄 ${d.title}`) }; else finalAgenda.unshift({ section: 'Review Deferred Items', duration_min: 10, notes: '', completed: false, talking_points: deferredItems.map(d => `🔄 ${d.title}`) }) }
    const { data: nm } = await supabase.from('meetings').insert({ org_id: currentOrg.id, title: meeting.title, template: meeting.template, scheduled_at: new Date(`${date}T${time}:00`).toISOString(), duration_minutes: meeting.duration_minutes, status: 'scheduled', prev_meeting_id: meeting.id, agenda: finalAgenda, action_items: deferredItems.map(d => ({ ...d, status: 'pending' })) }).select().single()
    if (nm) { await supabase.from('meetings').update({ next_meeting_id: nm.id }).eq('id', meeting.id); if (attendees.length > 0) await supabase.from('meeting_attendees').insert(attendees.map(a => ({ meeting_id: nm.id, user_id: a.user_id }))); setShowSched(false); router.push(`/meetings/${nm.id}`) }
  }

  const editSecName = (i: number, n: string) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], section: n }; save({ agenda: a }) }
  const editSecTime = (i: number, m: number) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], duration_min: Math.max(1, m) }; save({ agenda: a }) }
  const addSec = () => { if (!meeting) return; save({ agenda: [...(meeting.agenda || []), { section: 'New Section', duration_min: 10, notes: '', completed: false }] }) }
  const rmSec = (i: number) => { if (!meeting) return; save({ agenda: (meeting.agenda || []).filter((_, j) => j !== i) }) }
  const saveRockReview = async (rockId: string, status: string) => { if (!meeting) return; setRockReviews(prev => ({ ...prev, [rockId]: status })); await supabase.from('meeting_rock_reviews').upsert({ meeting_id: meeting.id, rock_id: rockId, status_at_review: status }, { onConflict: 'meeting_id,rock_id' }) }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const live = meeting.status === 'in_progress'; const done = meeting.status === 'completed'
  const allActs = (meeting.action_items || []).filter(a => a.status !== 'deleted')
  const deferredIds = new Set(prevActions.map(a => a.id))
  const deferredActs = allActs.filter(a => deferredIds.has(a.id))
  const newActs = allActs.filter(a => !deferredIds.has(a.id))
  const ids = meeting.ids_items || []
  const isRock = (s: AgendaSection) => s.section.toLowerCase().includes('rock')

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl mx-auto pb-16">
      <button onClick={() => router.push('/meetings')} className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark"><ChevronLeft size={14} /> Meetings</button>

      {/* ═══ HEADER ═══ */}
      <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
        <div className="flex items-center gap-3">
          {live && <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shrink-0" />}
          <BadgePill text={tmpl.label} color={tmpl.color} />
          <h1 className="text-base font-bold text-np-dark flex-1">{meeting.title}</h1>
          {meeting.status === 'scheduled' && <>
            <button onClick={() => setEditing(!editing)} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-gray-400 hover:text-np-dark rounded-lg hover:bg-gray-50"><Edit3 size={10} /> {editing ? 'Done' : 'Edit'}</button>
            <button onClick={startMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 shadow-sm"><Play size={11} /> Start</button>
          </>}
          {live && <button onClick={endMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-np-dark text-white text-xs font-semibold rounded-xl"><Check size={11} /> End Meeting</button>}
        </div>
        <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><Clock size={9} />{meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No date'} · {meeting.duration_minutes}m</span>
          {attendees.length > 0 && <AvatarStack list={attendees.map(a => ({ initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() }))} />}
          {ids.length > 0 && <span className="text-fire font-semibold">{ids.filter(i => i.status !== 'solved').length} IDS</span>}
          {allActs.filter(a => a.status === 'pending').length > 0 && <span className="text-np-blue font-semibold">{allActs.filter(a => a.status === 'pending').length} actions</span>}
        </div>
      </div>

      {/* ═══ AGENDA ACCORDION ═══ */}
      <div className="space-y-1.5">
        {(meeting.agenda || []).map((sec, i) => {
          const open = openSec === i; const secIsRock = isRock(sec)
          return (
            <div key={i} className={`bg-white rounded-xl border overflow-hidden transition-all ${open ? 'border-np-blue/20 shadow-sm' : 'border-gray-100'}`}>
              <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none" onClick={() => toggleSec(i)}>
                {(live || done) && <button onClick={e => { e.stopPropagation(); checkSec(i) }} className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 ${sec.completed ? 'bg-green-500 border-green-500' : 'border-gray-200 hover:border-np-blue'}`}>{sec.completed && <Check size={11} className="text-white" strokeWidth={3} />}</button>}
                {editing ? <input value={sec.section} onClick={e => e.stopPropagation()} onChange={e => editSecName(i, e.target.value)} className="flex-1 text-sm font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg" />
                  : <span className={`text-sm font-semibold flex-1 ${sec.completed ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{sec.section}</span>}
                {sec.prompts && sec.prompts.length > 0 && !open && <HelpCircle size={11} className="text-violet-300" />}
                {live && open && <STimer dur={sec.duration_min} active={open} />}
                {editing ? <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}><button onClick={() => editSecTime(i, sec.duration_min - 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">−</button><span className="text-[10px] font-bold text-gray-500 w-7 text-center">{sec.duration_min}m</span><button onClick={() => editSecTime(i, sec.duration_min + 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">+</button><button onClick={() => rmSec(i)} className="ml-1 text-gray-300 hover:text-red-400"><X size={11} /></button></div>
                  : <span className="text-[10px] text-gray-400 font-medium shrink-0">{sec.duration_min} min</span>}
                <ChevronDown size={13} className={`text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
              </div>

              {open && (
                <div className="border-t border-gray-100 space-y-0">
                  {sec.prompts && sec.prompts.length > 0 && <div className="px-5 py-3 bg-violet-50/40 border-b border-violet-100/50"><span className="text-[8px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1"><HelpCircle size={9} /> Facilitator Prompts</span><div className="mt-1.5 space-y-1">{sec.prompts.map((q, j) => <div key={j} className="text-[11px] text-violet-700 font-medium flex items-start gap-2"><span className="text-violet-400 shrink-0">Q{j + 1}.</span><span>{q}</span></div>)}</div></div>}
                  {sec.talking_points && sec.talking_points.length > 0 && <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100/50"><span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Discussion Points</span><div className="mt-1.5 space-y-1">{sec.talking_points.map((tp, j) => <div key={j} className="text-[11px] text-np-dark flex items-start gap-2"><span className="text-gray-300 mt-0.5 shrink-0">•</span><span>{tp}</span></div>)}</div></div>}
                  {secIsRock && rocks.length > 0 && <div className="px-5 py-3 border-b border-gray-100/50 space-y-1">{rocks.map(r => <div key={r.id} className="flex items-center gap-2 py-1.5"><StatusDot status={rockReviews[r.id] || r.status} /><span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span><ProgressBar pct={r.progress_pct} className="max-w-[80px]" /><span className="text-[10px] font-bold text-gray-500 w-7 text-right">{r.progress_pct}%</span>{live && <select value={rockReviews[r.id] || r.status} onChange={e => saveRockReview(r.id, e.target.value)} className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none"><option value="on_track">On Track</option><option value="at_risk">At Risk</option><option value="off_track">Off Track</option></select>}</div>)}</div>}

                  {/* ── Notes ── */}
                  <div className="px-5 py-3 border-b border-gray-100/50">
                    <label className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Section Notes</label>
                    <textarea value={sec.notes} onChange={e => updateNotes(i, e.target.value)} placeholder="Notes for this section..." rows={3} className="w-full mt-1 text-xs text-gray-600 bg-gray-50/50 rounded-lg p-3 border border-gray-100 focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none placeholder-gray-300" />
                  </div>

                  {/* ── IDS Capture ── */}
                  {live && <div className="px-5 py-3 border-b border-gray-100/50">
                    <label className="text-[8px] font-bold text-fire uppercase tracking-wider flex items-center gap-1"><AlertTriangle size={8} /> Capture IDS Issue</label>
                    <div className="flex gap-1.5 mt-1">
                      <div className="relative flex-1"><input value={secIdsText} onChange={e => setSecIdsText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addIdsItem() } }} placeholder="Type an issue and press Enter..." className="w-full px-3 py-2 text-xs border border-fire/20 rounded-lg bg-fire/[0.02] focus:outline-none focus:ring-1 focus:ring-fire/20 pr-8" /><button onClick={vTogIds} className={`absolute right-2 top-1/2 -translate-y-1/2 ${vOnIds ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-fire'}`}>{vOnIds ? <MicOff size={11} /> : <Mic size={11} />}</button></div>
                      <button onClick={addIdsItem} disabled={!secIdsText.trim()} className="px-2.5 py-2 bg-fire/10 text-fire rounded-lg disabled:opacity-30 hover:bg-fire/20"><Plus size={13} /></button>
                    </div>
                    {vOnIds && <p className="text-[9px] text-red-500 mt-0.5 animate-pulse">🎤 Listening...</p>}
                  </div>}

                  {/* ── Action Item Capture ── */}
                  {live && <div className="px-5 py-3">
                    <label className="text-[8px] font-bold text-np-blue uppercase tracking-wider flex items-center gap-1"><Check size={8} /> Capture Action Item</label>
                    <div className="flex gap-1.5 mt-1">
                      <div className="relative flex-1"><input value={secActionText} onChange={e => setSecActionText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addActionItem() } }} placeholder="Action item and press Enter..." className="w-full px-3 py-2 text-xs border border-np-blue/20 rounded-lg bg-np-blue/[0.02] focus:outline-none focus:ring-1 focus:ring-np-blue/20 pr-8" /><button onClick={vTogAct} className={`absolute right-2 top-1/2 -translate-y-1/2 ${vOnAct ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-np-blue'}`}>{vOnAct ? <MicOff size={11} /> : <Mic size={11} />}</button></div>
                      <button onClick={addActionItem} disabled={!secActionText.trim()} className="px-2.5 py-2 bg-np-blue/10 text-np-blue rounded-lg disabled:opacity-30 hover:bg-np-blue/20"><Plus size={13} /></button>
                    </div>
                    {vOnAct && <p className="text-[9px] text-red-500 mt-0.5 animate-pulse">🎤 Listening...</p>}
                  </div>}
                </div>
              )}
            </div>
          )
        })}
        {editing && <button onClick={addSec} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30">+ Add Section</button>}
      </div>

      {/* ═══ IDS TABLE — 7 columns ═══ */}
      {(live || done) && ids.length > 0 && <div className="bg-white rounded-2xl border border-fire/10 px-5 py-4"><IdsTable items={ids} onUpdate={updateIds} onRemove={removeIds} /></div>}

      {/* ═══ ACTION ITEMS SUMMARY (live) ═══ */}
      {live && allActs.filter(a => a.status === 'pending').length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Action Items ({allActs.filter(a => a.status === 'pending').length})</span>
          <div className="mt-2 space-y-1">
            {deferredActs.filter(a => a.status === 'pending').map(a => <div key={a.id} className="flex items-center gap-2 text-[11px] py-1.5"><RotateCcw size={9} className="text-amber-500 shrink-0" /><span className="text-np-dark flex-1">{a.title}</span><span className="text-[9px] text-amber-400">deferred</span><button onClick={() => deleteAction(a.id)} className="text-gray-200 hover:text-red-400"><X size={10} /></button></div>)}
            {newActs.filter(a => a.status === 'pending').map(a => <div key={a.id} className="flex items-center gap-2 text-[11px] py-1.5"><Check size={9} className="text-np-blue shrink-0" /><span className="text-np-dark flex-1">{a.title}</span><button onClick={() => deleteAction(a.id)} className="text-gray-200 hover:text-red-400"><X size={10} /></button></div>)}
          </div>
        </div>
      )}

      {/* ═══ END REVIEW ═══ */}
      {done && <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5"><EndReview deferredActions={deferredActs} newActions={newActs} idsItems={ids} onApprove={approveAction} onDefer={deferAction} onDelete={deleteAction} onScheduleNext={() => setShowSched(true)} /></div>}

      {showSched && <SchedModal deferred={allActs.filter(a => a.status === 'deferred')} onSched={scheduleNext} onClose={() => setShowSched(false)} />}
    </div>
  )
}
