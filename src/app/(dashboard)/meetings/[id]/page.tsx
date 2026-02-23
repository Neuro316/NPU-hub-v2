'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, MeetingActionItem } from '@/lib/types/meetings'
import {
  ChevronLeft, ChevronDown, Clock, Check, Loader2, Target, Play, Timer, Plus, X,
  Sparkles, Mic, MicOff, Calendar, ArrowRight, Edit3, RotateCcw, Trash2,
  ThumbsUp, CheckCircle2, Shield
} from 'lucide-react'

/* ─── Timer ─── */
function STimer({ dur, active }: { dur: number; active: boolean }) {
  const [el, setEl] = useState(0); const ref = useRef<NodeJS.Timeout | null>(null)
  const tot = dur * 60; const rem = tot - el; const pct = tot > 0 ? Math.max(0, rem / tot) : 0
  useEffect(() => { setEl(0) }, [dur])
  useEffect(() => {
    if (active) ref.current = setInterval(() => setEl(p => p + 1), 1000)
    else if (ref.current) clearInterval(ref.current)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [active])
  const fmt = (s: number) => { const a = Math.abs(s); return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${(a % 60).toString().padStart(2, '0')}` }
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

/* ─── End-of-Meeting Review ─── */
function EndReview({ actions, onApprove, onDefer, onDelete, onScheduleNext }: {
  actions: MeetingActionItem[]
  onApprove: (id: string) => void; onDefer: (id: string) => void; onDelete: (id: string) => void
  onScheduleNext: () => void
}) {
  const approved = actions.filter(a => a.status === 'approved')
  const deferred = actions.filter(a => a.status === 'deferred')
  const pending = actions.filter(a => a.status === 'pending')

  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3"><CheckCircle2 size={28} className="text-green-500" /></div>
        <h3 className="text-sm font-bold text-np-dark">Meeting Complete</h3>
        <p className="text-xs text-gray-400 mt-1">Review each action item — approve, defer, or delete</p>
      </div>

      {pending.length > 0 && (
        <div>
          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Needs Review ({pending.length})</span>
          <div className="mt-2 space-y-2">{pending.map(a => (
            <div key={a.id} className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-100">
              <span className="text-xs text-np-dark font-medium flex-1">{a.title}</span>
              {a.owner_name && <span className="text-[9px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg shrink-0">{a.owner_name}</span>}
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => onApprove(a.id)} title="Approve → Task Manager"
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-50 text-green-600 hover:bg-green-100 transition-colors"><ThumbsUp size={13} /></button>
                <button onClick={() => onDefer(a.id)} title="Defer → Next meeting"
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"><RotateCcw size={13} /></button>
                <button onClick={() => onDelete(a.id)} title="Delete"
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}</div>
        </div>
      )}

      {approved.length > 0 && (
        <div>
          <span className="text-[9px] font-bold text-green-600 uppercase tracking-wider">Approved → Tasks ({approved.length})</span>
          <div className="mt-1.5 space-y-1">{approved.map(a => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px] text-gray-400"><Check size={10} className="text-green-500" /> <span className="line-through">{a.title}</span></div>
          ))}</div>
        </div>
      )}

      {deferred.length > 0 && (
        <div>
          <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">Deferred → Next ({deferred.length})</span>
          <div className="mt-1.5 space-y-1">{deferred.map(a => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px] text-amber-600"><RotateCcw size={10} /> {a.title}</div>
          ))}</div>
        </div>
      )}

      <button onClick={onScheduleNext}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-np-blue/5 text-np-blue text-xs font-semibold rounded-xl border border-np-blue/20 hover:bg-np-blue/10 transition-colors">
        <Calendar size={13} /> Schedule Next Meeting
      </button>
    </div>
  )
}

/* ─── Schedule Next Modal ─── */
function ScheduleNextModal({ deferred, onSchedule, onClose }: {
  deferred: MeetingActionItem[]; onSchedule: (date: string, time: string) => void; onClose: () => void
}) {
  const [d, setD] = useState(''); const [t, setT] = useState('09:00')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-np-dark mb-4">Schedule Next Meeting</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Date</label><input type="date" value={d} onChange={e => setD(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Time</label><input type="time" value={t} onChange={e => setT(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
        </div>
        {deferred.length > 0 && (
          <div className="bg-amber-50 rounded-xl p-3 mb-4">
            <span className="text-[9px] font-bold text-amber-600 uppercase">Deferred Items Carry Forward ({deferred.length})</span>
            <div className="mt-1 space-y-0.5">{deferred.map(a => <div key={a.id} className="text-[10px] text-amber-700 flex items-center gap-1"><ArrowRight size={8} /> {a.title}</div>)}</div>
          </div>
        )}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button><button onClick={() => d && onSchedule(d, t)} disabled={!d} className="px-5 py-2 bg-np-blue text-white text-xs font-semibold rounded-xl disabled:opacity-40">Schedule</button></div>
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
  const [capText, setCapText] = useState('')
  const [editing, setEditing] = useState(false)
  const [showSched, setShowSched] = useState(false)
  const [prevActions, setPrevActions] = useState<MeetingActionItem[]>([])
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})
  const capRef = useRef<HTMLInputElement>(null)
  const { on: vOn, toggle: vTog } = useVoice(t => setCapText(p => p ? p + ' ' + t : t))

  const load = useCallback(async () => {
    if (!id) return; setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) setMeeting({ ...m, agenda: m.agenda || [], action_items: m.action_items || [] })
    const { data: att } = await supabase.from('meeting_attendees').select('*, team_profiles:user_id(display_name)').eq('meeting_id', id)
    if (att) setAttendees(att.map((a: any) => ({ ...a, display_name: a.team_profiles?.display_name || 'Unknown' })))
    const { data: revs } = await supabase.from('meeting_rock_reviews').select('*').eq('meeting_id', id)
    if (revs) { const map: Record<string, string> = {}; revs.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' }); setRockReviews(map) }
    // Load previous meeting actions
    if (m?.prev_meeting_id) {
      const { data: prev } = await supabase.from('meetings').select('action_items').eq('id', m.prev_meeting_id).single()
      if (prev?.action_items) setPrevActions(prev.action_items.filter((a: any) => a.status === 'deferred'))
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async (u: Partial<Meeting>) => {
    if (!meeting) return
    setMeeting(p => p ? { ...p, ...u } : p)
    await supabase.from('meetings').update({ ...u, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const startMeeting = () => { save({ status: 'in_progress' }); setOpenSec(0) }
  const endMeeting = () => { save({ status: 'completed' }); setOpenSec(null) }

  const toggleSection = (i: number) => {
    if (meeting?.status !== 'in_progress' && meeting?.status !== 'completed') return
    setOpenSec(openSec === i ? null : i)
  }

  const checkSection = (i: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[i] = { ...agenda[i], completed: !agenda[i].completed }
    save({ agenda })
    // Auto-advance to next unchecked
    if (agenda[i].completed) {
      const next = agenda.findIndex((s, j) => j > i && !s.completed)
      if (next >= 0) setOpenSec(next)
    }
  }

  const updateNotes = (i: number, notes: string) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[i] = { ...agenda[i], notes }
    save({ agenda })
  }

  // ── Capture action item ──
  const captureItem = () => {
    if (!capText.trim() || !meeting) return
    const newItem: MeetingActionItem = {
      id: crypto.randomUUID(), title: capText.trim(),
      owner: '', owner_name: '', due_date: '', status: 'pending', task_id: null,
    }
    save({ action_items: [...(meeting.action_items || []), newItem] })
    setCapText(''); capRef.current?.focus()
  }

  // ── Review actions: approve / defer / delete ──
  const approveAction = async (actionId: string) => {
    if (!meeting || !currentOrg) return
    const action = (meeting.action_items || []).find(a => a.id === actionId); if (!action) return
    // Create task in kanban
    const { data: cols } = await supabase.from('kanban_columns').select('id').eq('org_id', currentOrg.id).order('sort_order').limit(1)
    if (cols?.length) {
      const { data: task } = await supabase.from('kanban_tasks').insert({
        org_id: currentOrg.id, column_id: cols[0].id, title: action.title,
        source: 'meeting', priority: 'medium', visibility: 'everyone', sort_order: 0,
        assignee: action.owner || null,
        custom_fields: { meeting_id: meeting.id },
      }).select().single()
      if (task) {
        save({ action_items: (meeting.action_items || []).map(a => a.id === actionId ? { ...a, status: 'approved' as const, task_id: task.id } : a) })
      }
    }
  }

  const deferAction = (actionId: string) => {
    if (!meeting) return
    save({ action_items: (meeting.action_items || []).map(a => a.id === actionId ? { ...a, status: 'deferred' as const } : a) })
  }

  const deleteAction = (actionId: string) => {
    if (!meeting) return
    save({ action_items: (meeting.action_items || []).map(a => a.id === actionId ? { ...a, status: 'deleted' as const } : a) })
  }

  // ── Schedule next meeting ──
  const scheduleNext = async (date: string, time: string) => {
    if (!meeting || !currentOrg) return
    const deferredItems = (meeting.action_items || []).filter(a => a.status === 'deferred')
    const { data: nm } = await supabase.from('meetings').insert({
      org_id: currentOrg.id, title: meeting.title, template: meeting.template,
      scheduled_at: new Date(`${date}T${time}:00`).toISOString(),
      duration_minutes: meeting.duration_minutes, status: 'scheduled',
      prev_meeting_id: meeting.id,
      agenda: [
        { section: 'Review Deferred Items', duration_min: 10, notes: '', completed: false, talking_points: deferredItems.map(d => d.title) },
        ...(meeting.agenda || []).filter(s => !s.section.toLowerCase().includes('review deferred')),
      ],
      action_items: deferredItems.map(d => ({ ...d, status: 'pending' })),
    }).select().single()
    if (nm) {
      await supabase.from('meetings').update({ next_meeting_id: nm.id }).eq('id', meeting.id)
      if (attendees.length > 0) await supabase.from('meeting_attendees').insert(attendees.map(a => ({ meeting_id: nm.id, user_id: a.user_id })))
      setShowSched(false); router.push(`/meetings/${nm.id}`)
    }
  }

  // ── Edit mode helpers ──
  const editSecName = (i: number, n: string) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], section: n }; save({ agenda: a }) }
  const editSecTime = (i: number, m: number) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], duration_min: Math.max(1, m) }; save({ agenda: a }) }
  const addSec = () => { if (!meeting) return; save({ agenda: [...(meeting.agenda || []), { section: 'New Section', duration_min: 10, notes: '', completed: false, talking_points: [] }] }) }
  const rmSec = (i: number) => { if (!meeting) return; save({ agenda: (meeting.agenda || []).filter((_, j) => j !== i) }) }

  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return
    setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert({ meeting_id: meeting.id, rock_id: rockId, status_at_review: status }, { onConflict: 'meeting_id,rock_id' })
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const live = meeting.status === 'in_progress'
  const done = meeting.status === 'completed'
  const acts = (meeting.action_items || []).filter(a => a.status !== 'deleted')
  const isRock = (s: AgendaSection) => s.section.toLowerCase().includes('rock')
  const isDeferred = (s: AgendaSection) => s.section.toLowerCase().includes('deferred')

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl mx-auto pb-32">
      <button onClick={() => router.push('/meetings')} className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark"><ChevronLeft size={14} /> Meetings</button>

      {/* ═══ HEADER ═══ */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3">
            {live && <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shrink-0" />}
            <BadgePill text={tmpl.label} color={tmpl.color} />
            <h1 className="text-base font-bold text-np-dark flex-1">{meeting.title}</h1>
            {meeting.status === 'scheduled' && (
              <>
                <button onClick={() => setEditing(!editing)} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-gray-400 hover:text-np-dark rounded-lg hover:bg-gray-50"><Edit3 size={10} /> {editing ? 'Done' : 'Edit'}</button>
                <button onClick={startMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 shadow-sm"><Play size={11} /> Start</button>
              </>
            )}
            {live && <button onClick={endMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-np-dark text-white text-xs font-semibold rounded-xl"><Check size={11} /> End Meeting</button>}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><Clock size={9} />{meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No date'} · {meeting.duration_minutes}m</span>
            {attendees.length > 0 && <AvatarStack list={attendees.map(a => ({ initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() }))} />}
            {acts.filter(a => a.status === 'pending').length > 0 && <span className="text-amber-500 font-semibold">{acts.filter(a => a.status === 'pending').length} action items</span>}
          </div>
        </div>

        {/* ═══ CAPTURE BAR — always visible during live meeting ═══ */}
        {live && (
          <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-100">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input ref={capRef} value={capText} onChange={e => setCapText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) captureItem() }}
                  placeholder="✏️ Type an action item and press Enter..."
                  className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-np-blue/20 pr-12 transition-all" />
                <button onClick={vTog} className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors ${vOn ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-np-blue'}`}>
                  {vOn ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </div>
              <button onClick={captureItem} disabled={!capText.trim()}
                className="px-4 py-3 bg-np-blue text-white rounded-xl disabled:opacity-30 hover:bg-np-dark shrink-0"><Plus size={16} /></button>
            </div>
            {vOn && <p className="text-[10px] text-red-500 mt-1 animate-pulse">🎤 Listening...</p>}
          </div>
        )}
      </div>

      {/* ═══ PREVIOUS DEFERRED ITEMS ═══ */}
      {prevActions.length > 0 && !done && (
        <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-5 py-3">
          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Deferred From Last Meeting</span>
          <div className="mt-1.5 space-y-1">{prevActions.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] text-amber-800"><ArrowRight size={9} className="shrink-0" /> {a.title}</div>
          ))}</div>
        </div>
      )}

      {/* ═══ AGENDA ACCORDION ═══ */}
      <div className="space-y-1.5">
        {(meeting.agenda || []).map((sec, i) => {
          const open = openSec === i
          const secIsRock = isRock(sec); const secIsDeferred = isDeferred(sec)

          return (
            <div key={i} className={`bg-white rounded-xl border overflow-hidden transition-all ${open ? 'border-np-blue/20 shadow-sm' : 'border-gray-100'}`}>
              {/* Section header row */}
              <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none" onClick={() => toggleSection(i)}>
                {(live || done) && (
                  <button onClick={e => { e.stopPropagation(); checkSection(i) }}
                    className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition-colors ${sec.completed ? 'bg-green-500 border-green-500' : 'border-gray-200 hover:border-np-blue'}`}>
                    {sec.completed && <Check size={11} className="text-white" strokeWidth={3} />}
                  </button>
                )}

                {editing ? (
                  <input value={sec.section} onClick={e => e.stopPropagation()} onChange={e => editSecName(i, e.target.value)}
                    className="flex-1 text-sm font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg" />
                ) : (
                  <span className={`text-sm font-semibold flex-1 ${sec.completed ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{sec.section}</span>
                )}

                {sec.talking_points && sec.talking_points.length > 0 && !open && (
                  <span className="text-[9px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{sec.talking_points.length} points</span>
                )}

                {live && open && <STimer dur={sec.duration_min} active={open} />}

                {editing ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => editSecTime(i, sec.duration_min - 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">−</button>
                    <span className="text-[10px] font-bold text-gray-500 w-7 text-center">{sec.duration_min}m</span>
                    <button onClick={() => editSecTime(i, sec.duration_min + 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">+</button>
                    <button onClick={() => rmSec(i)} className="ml-1 text-gray-300 hover:text-red-400"><X size={11} /></button>
                  </div>
                ) : (
                  <span className="text-[10px] text-gray-400 font-medium shrink-0">{sec.duration_min} min</span>
                )}

                <ChevronDown size={13} className={`text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
              </div>

              {/* ── Expanded section content ── */}
              {open && (
                <div className="border-t border-gray-100">
                  {/* Talking points (AI-populated) */}
                  {sec.talking_points && sec.talking_points.length > 0 && (
                    <div className="px-5 py-3 bg-violet-50/30">
                      <span className="text-[8px] font-bold text-violet-400 uppercase tracking-wider">Discussion Points</span>
                      <div className="mt-1.5 space-y-1">
                        {sec.talking_points.map((tp, j) => (
                          <div key={j} className="flex items-start gap-2 text-[11px] text-np-dark">
                            <span className="text-violet-300 mt-0.5 shrink-0">•</span>
                            <span>{tp}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deferred items from previous meeting */}
                  {secIsDeferred && prevActions.length > 0 && (
                    <div className="px-5 py-3 bg-amber-50/30">
                      {prevActions.map(a => (
                        <div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <span className="text-amber-500 font-semibold">→</span>
                          <span className="text-np-dark flex-1">{a.title}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rock review */}
                  {secIsRock && rocks.length > 0 && (
                    <div className="px-5 py-3 space-y-1">
                      {rocks.map(r => (
                        <div key={r.id} className="flex items-center gap-2 py-1.5">
                          <StatusDot status={rockReviews[r.id] || r.status} />
                          <span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span>
                          <ProgressBar pct={r.progress_pct} className="max-w-[80px]" />
                          <span className="text-[10px] font-bold text-gray-500 w-7 text-right">{r.progress_pct}%</span>
                          {live && (
                            <select value={rockReviews[r.id] || r.status} onChange={e => saveRockReview(r.id, e.target.value)}
                              className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none">
                              <option value="on_track">On Track</option><option value="at_risk">At Risk</option><option value="off_track">Off Track</option>
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Section notes */}
                  <div className="px-5 py-3">
                    <textarea value={sec.notes} onChange={e => updateNotes(i, e.target.value)}
                      placeholder="Meeting notes for this section..."
                      rows={3} className="w-full text-xs text-gray-600 bg-gray-50/50 rounded-lg p-3 border border-gray-100 focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none placeholder-gray-300" />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {editing && <button onClick={addSec} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">+ Add Section</button>}
      </div>

      {/* ═══ LIVE CAPTURED ITEMS ═══ */}
      {live && acts.filter(a => a.status === 'pending').length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Captured ({acts.filter(a => a.status === 'pending').length})</span>
          <div className="mt-2 space-y-1">{acts.filter(a => a.status === 'pending').map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] py-1.5">
              <Check size={9} className="text-np-blue shrink-0" />
              <span className="text-np-dark flex-1">{a.title}</span>
              <button onClick={() => deleteAction(a.id)} className="text-gray-200 hover:text-red-400"><X size={10} /></button>
            </div>
          ))}</div>
        </div>
      )}

      {/* ═══ END-OF-MEETING REVIEW ═══ */}
      {done && (
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
          <EndReview actions={acts} onApprove={approveAction} onDefer={deferAction} onDelete={deleteAction} onScheduleNext={() => setShowSched(true)} />
        </div>
      )}

      {/* ═══ FIXED CAPTURE BAR (bottom) ═══ */}
      {live && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-gray-200 px-6 py-3 shadow-lg">
          <div className="max-w-3xl mx-auto flex gap-2">
            <div className="relative flex-1">
              <input value={capText} onChange={e => setCapText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) captureItem() }}
                placeholder="✏️ Capture action item..."
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-np-blue/20 pr-12" />
              <button onClick={vTog} className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg ${vOn ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-np-blue'}`}>
                {vOn ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
            </div>
            <button onClick={captureItem} disabled={!capText.trim()} className="px-4 py-3 bg-np-blue text-white rounded-xl disabled:opacity-30 hover:bg-np-dark shrink-0"><Plus size={16} /></button>
          </div>
        </div>
      )}

      {showSched && <ScheduleNextModal deferred={acts.filter(a => a.status === 'deferred')} onSchedule={scheduleNext} onClose={() => setShowSched(false)} />}
    </div>
  )
}
