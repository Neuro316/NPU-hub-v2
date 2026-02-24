'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, MeetingActionItem, IdsItem } from '@/lib/types/meetings'
import {
  ChevronLeft, ChevronDown, Clock, Check, Loader2, Target, Play, Timer, Plus, X,
  Mic, MicOff, Calendar, ArrowRight, Edit3, RotateCcw, Trash2, ThumbsUp,
  CheckCircle2, AlertTriangle, HelpCircle, Sparkles
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

const EMPTY_ACTION: () => MeetingActionItem = () => ({
  id: crypto.randomUUID(), title: '', owner: '', owner_name: '', due_date: '',
  status: 'pending', task_id: null, description: '', priority: 'medium',
  raci_responsible: '', raci_accountable: '', raci_consulted: '', raci_informed: '', task_column: '',
})

const EMPTY_IDS: (desc: string) => IdsItem = (desc) => ({
  id: crypto.randomUUID(), issue_category: '', description: desc, dependencies_context: '',
  decisions_needed: '', action_items_text: '', due_date: '', owner: '', owner_name: '',
  status: 'identified', resolution: '', created_at: new Date().toISOString(),
})

const STATUS_CFG = {
  identified: { bg: '#FEF3C7', text: '#92400E', label: 'IDENTIFIED' },
  discussed: { bg: '#DBEAFE', text: '#1E40AF', label: 'DISCUSSED' },
  solved: { bg: '#D1FAE5', text: '#065F46', label: 'SOLVED' },
} as const

const STATUS_ORDER: IdsItem['status'][] = ['identified', 'discussed', 'solved']
const nextStatus = (s: IdsItem['status']) => STATUS_ORDER[Math.min(STATUS_ORDER.indexOf(s) + 1, 2)]
const prevStatus = (s: IdsItem['status']) => STATUS_ORDER[Math.max(STATUS_ORDER.indexOf(s) - 1, 0)]

const PRIORITY_CFG = {
  low: { label: 'Low', color: '#9CA3AF', bg: '#F3F4F6' },
  medium: { label: 'Medium', color: '#3B82F6', bg: '#DBEAFE' },
  high: { label: 'High', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'Urgent', color: '#EF4444', bg: '#FEE2E2' },
} as const

/* ─── Section Timer ─── */
function STimer({ dur, active }: { dur: number; active: boolean }) {
  const [el, setEl] = useState(0)
  const ref = useRef<NodeJS.Timeout | null>(null)
  const tot = dur * 60; const rem = tot - el
  useEffect(() => { setEl(0) }, [dur])
  useEffect(() => {
    if (active) ref.current = setInterval(() => setEl(p => p + 1), 1000)
    else if (ref.current) clearInterval(ref.current)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [active])
  const fmt = (s: number) => { const a = Math.abs(s); return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${(a % 60).toString().padStart(2, '0')}` }
  const pct = tot > 0 ? Math.max(0, rem / tot) : 0
  const c = rem <= 0 ? '#DC2626' : pct < 0.25 ? '#D97706' : '#16A34A'
  const bg = rem <= 0 ? '#FEF2F2' : pct < 0.25 ? '#FFFBEB' : '#F0FDF4'
  return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold tabular-nums" style={{ background: bg, color: c }}><Timer size={10} />{fmt(rem)}</span>
}

/* ─── Voice Hook ─── */
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

// ═══════════════════════════════════════════════════════════
// IDS TABLE — Full 7 columns, inside the IDS section card
// ═══════════════════════════════════════════════════════════

function IdsTable({ items, onUpdate, onRemove, onAiFill, aiFillingId, attendees }: {
  items: IdsItem[]
  onUpdate: (id: string, u: Partial<IdsItem>) => void
  onRemove: (id: string) => void
  onAiFill?: (id: string) => void
  aiFillingId?: string | null
  attendees: MeetingAttendee[]
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (items.length === 0) return <p className="text-[11px] text-gray-400 italic py-3">No issues identified yet. Use the input below to add one.</p>

  return (
    <div className="space-y-2">
      {items.map(item => {
        const sc = STATUS_CFG[item.status]
        const isExp = expanded === item.id
        const isFilling = aiFillingId === item.id

        return (
          <div key={item.id} className={`rounded-xl border overflow-hidden transition-all ${isFilling ? 'border-violet-200 ring-1 ring-violet-100' : isExp ? 'border-gray-200' : 'border-gray-100'}`}>
            {/* Collapsed row */}
            <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50/50 bg-white" onClick={() => setExpanded(isExp ? null : item.id)}>
              {/* Status — full word, click cycles, right-click goes back */}
              <button
                onClick={e => { e.stopPropagation(); onUpdate(item.id, { status: nextStatus(item.status) }) }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onUpdate(item.id, { status: prevStatus(item.status) }) }}
                title="Click to advance · Right-click to go back"
                className="px-2 py-1 rounded-md text-[9px] font-bold tracking-wide shrink-0 transition-colors hover:opacity-80"
                style={{ background: sc.bg, color: sc.text }}
              >{sc.label}</button>
              {/* Category */}
              <input value={item.issue_category} onChange={e => onUpdate(item.id, { issue_category: e.target.value })} onClick={e => e.stopPropagation()}
                placeholder="Category" className="w-28 text-[11px] font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1 shrink-0 truncate" />
              {/* Description preview */}
              <span className="text-[11px] text-gray-500 flex-1 truncate">{item.description || 'Click to expand...'}</span>
              {/* Owner */}
              <select value={item.owner_name} onChange={e => { e.stopPropagation(); onUpdate(item.id, { owner_name: e.target.value }) }} onClick={e => e.stopPropagation()}
                className="text-[10px] text-np-dark bg-transparent focus:outline-none w-20 shrink-0">
                <option value="">Owner</option>
                {attendees.map(a => <option key={a.user_id} value={a.display_name}>{a.display_name?.split(' ')[0]}</option>)}
              </select>
              {/* AI Fill */}
              {onAiFill && (
                <button onClick={e => { e.stopPropagation(); onAiFill(item.id) }} disabled={!!aiFillingId}
                  title="AI Fill — analyze across entire platform" className={`p-1 rounded-md shrink-0 ${isFilling ? 'text-violet-500 animate-pulse' : 'text-violet-300 hover:text-violet-500 hover:bg-violet-50'}`}>
                  {isFilling ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                </button>
              )}
              <ChevronDown size={12} className={`text-gray-300 transition-transform shrink-0 ${isExp ? 'rotate-180' : ''}`} />
              <button onClick={e => { e.stopPropagation(); onRemove(item.id) }} className="text-gray-200 hover:text-red-400 shrink-0"><X size={11} /></button>
            </div>

            {/* Expanded — all 7 columns editable */}
            {isExp && (
              <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-3 space-y-3">
                {isFilling && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 rounded-lg animate-pulse">
                    <Loader2 size={12} className="text-violet-500 animate-spin" />
                    <span className="text-[11px] text-violet-600 font-medium">AI analyzing tasks, rocks, contacts, library & meeting history...</span>
                  </div>
                )}
                {/* Row 1: Description full width */}
                <div>
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Description</label>
                  <textarea value={item.description} onChange={e => onUpdate(item.id, { description: e.target.value })} rows={3}
                    placeholder="Detailed description of the issue..."
                    className="w-full mt-1 px-3 py-2 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none" />
                </div>
                {/* Row 2: Dependencies + Decisions */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Dependencies / Context</label>
                    <textarea value={item.dependencies_context} onChange={e => onUpdate(item.id, { dependencies_context: e.target.value })} rows={3}
                      placeholder="What does this depend on? Related tasks, rocks, people..."
                      className="w-full mt-1 px-3 py-2 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Decisions Needed</label>
                    <textarea value={item.decisions_needed} onChange={e => onUpdate(item.id, { decisions_needed: e.target.value })} rows={3}
                      placeholder="What choices must leadership make? Frame as clear decisions..."
                      className="w-full mt-1 px-3 py-2 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none" />
                  </div>
                </div>
                {/* Row 3: Action Items + Due Date + Owner */}
                <div className="grid grid-cols-[1fr_100px_120px] gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Action Items</label>
                    <textarea value={item.action_items_text} onChange={e => onUpdate(item.id, { action_items_text: e.target.value })} rows={2}
                      placeholder="Concrete next steps; separated by semicolons..."
                      className="w-full mt-1 px-3 py-2 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Due Date</label>
                    <input value={item.due_date} onChange={e => onUpdate(item.id, { due_date: e.target.value })}
                      placeholder="e.g. 2 weeks"
                      className="w-full mt-1 px-3 py-2 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Owner</label>
                    <select value={item.owner_name} onChange={e => onUpdate(item.id, { owner_name: e.target.value })}
                      className="w-full mt-1 px-3 py-2.5 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20">
                      <option value="">Select owner...</option>
                      {attendees.map(a => <option key={a.user_id} value={a.display_name}>{a.display_name}</option>)}
                    </select>
                  </div>
                </div>
                {/* Resolution (for solved items) */}
                {item.status === 'solved' && (
                  <div>
                    <label className="text-[9px] font-bold text-green-600 uppercase tracking-wider">Resolution</label>
                    <textarea value={item.resolution} onChange={e => onUpdate(item.id, { resolution: e.target.value })} rows={2}
                      placeholder="How was this resolved?"
                      className="w-full mt-1 px-3 py-2 text-[11px] border border-green-200 rounded-lg bg-green-50/50 focus:outline-none resize-none" />
                  </div>
                )}
                {/* AI Fill button at bottom */}
                {onAiFill && !isFilling && (
                  <button onClick={() => onAiFill(item.id)} className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-50 text-violet-600 text-[11px] font-semibold rounded-lg hover:bg-violet-100 transition-colors w-full justify-center">
                    <Sparkles size={12} /> AI Fill — Analyze across tasks, rocks, contacts & library
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ACTION REVIEW TABLE — Task card fields, approve/defer/reject
// ═══════════════════════════════════════════════════════════

function ActionReviewTable({ actions, attendees, onUpdate, onApprove, onDefer, onDelete, label, labelColor }: {
  actions: MeetingActionItem[]
  attendees: MeetingAttendee[]
  onUpdate: (id: string, u: Partial<MeetingActionItem>) => void
  onApprove: (id: string) => void
  onDefer: (id: string) => void
  onDelete: (id: string) => void
  label: string
  labelColor: string
}) {
  const pending = actions.filter(a => a.status === 'pending')
  const approved = actions.filter(a => a.status === 'approved')
  const deferred = actions.filter(a => a.status === 'deferred')
  const completed = actions.filter(a => a.status === 'completed')
  const deleted = actions.filter(a => a.status === 'deleted')

  if (actions.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>{label} ({pending.length} pending)</span>
      </div>

      {/* Pending items — editable table */}
      {pending.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_80px_80px_60px_60px_60px_60px_1fr_auto] gap-0 bg-gray-50 text-[8px] font-bold text-gray-400 uppercase tracking-wider">
            <div className="px-2 py-2 border-r border-gray-100">Title</div>
            <div className="px-2 py-2 border-r border-gray-100">Assignee</div>
            <div className="px-2 py-2 border-r border-gray-100">Due Date</div>
            <div className="px-2 py-2 border-r border-gray-100">Priority</div>
            <div className="px-1 py-2 border-r border-gray-100 text-center">R</div>
            <div className="px-1 py-2 border-r border-gray-100 text-center">A</div>
            <div className="px-1 py-2 border-r border-gray-100 text-center">C</div>
            <div className="px-1 py-2 border-r border-gray-100 text-center">I</div>
            <div className="px-2 py-2 border-r border-gray-100">Notes</div>
            <div className="px-2 py-2 w-24 text-center">Actions</div>
          </div>
          {/* Rows */}
          {pending.map(a => {
            const pc = PRIORITY_CFG[a.priority] || PRIORITY_CFG.medium
            return (
              <div key={a.id} className="grid grid-cols-[1fr_100px_80px_80px_60px_60px_60px_60px_1fr_auto] gap-0 border-t border-gray-100 bg-white group">
                <div className="px-2 py-2 border-r border-gray-50">
                  <input value={a.title} onChange={e => onUpdate(a.id, { title: e.target.value })}
                    className="w-full text-[11px] font-medium text-np-dark bg-transparent focus:outline-none" />
                </div>
                <div className="px-2 py-2 border-r border-gray-50">
                  <select value={a.owner_name} onChange={e => onUpdate(a.id, { owner_name: e.target.value })}
                    className="w-full text-[10px] text-np-dark bg-transparent focus:outline-none">
                    <option value="">Assign</option>
                    {attendees.map(att => <option key={att.user_id} value={att.display_name}>{att.display_name?.split(' ')[0]}</option>)}
                  </select>
                </div>
                <div className="px-2 py-2 border-r border-gray-50">
                  <input type="date" value={a.due_date} onChange={e => onUpdate(a.id, { due_date: e.target.value })}
                    className="w-full text-[10px] text-gray-600 bg-transparent focus:outline-none" />
                </div>
                <div className="px-2 py-2 border-r border-gray-50">
                  <select value={a.priority} onChange={e => onUpdate(a.id, { priority: e.target.value as MeetingActionItem['priority'] })}
                    className="w-full text-[10px] font-semibold bg-transparent focus:outline-none" style={{ color: pc.color }}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="px-1 py-2 border-r border-gray-50">
                  <input value={a.raci_responsible} onChange={e => onUpdate(a.id, { raci_responsible: e.target.value })} placeholder="—"
                    className="w-full text-[9px] text-center text-gray-600 bg-transparent focus:outline-none focus:bg-blue-50 rounded" title="Responsible" />
                </div>
                <div className="px-1 py-2 border-r border-gray-50">
                  <input value={a.raci_accountable} onChange={e => onUpdate(a.id, { raci_accountable: e.target.value })} placeholder="—"
                    className="w-full text-[9px] text-center text-gray-600 bg-transparent focus:outline-none focus:bg-blue-50 rounded" title="Accountable" />
                </div>
                <div className="px-1 py-2 border-r border-gray-50">
                  <input value={a.raci_consulted} onChange={e => onUpdate(a.id, { raci_consulted: e.target.value })} placeholder="—"
                    className="w-full text-[9px] text-center text-gray-600 bg-transparent focus:outline-none focus:bg-blue-50 rounded" title="Consulted" />
                </div>
                <div className="px-1 py-2 border-r border-gray-50">
                  <input value={a.raci_informed} onChange={e => onUpdate(a.id, { raci_informed: e.target.value })} placeholder="—"
                    className="w-full text-[9px] text-center text-gray-600 bg-transparent focus:outline-none focus:bg-blue-50 rounded" title="Informed" />
                </div>
                <div className="px-2 py-2 border-r border-gray-50">
                  <input value={a.description} onChange={e => onUpdate(a.id, { description: e.target.value })} placeholder="Notes..."
                    className="w-full text-[10px] text-gray-600 bg-transparent focus:outline-none" />
                </div>
                <div className="flex items-center justify-center gap-1 px-1 py-2 w-24">
                  <button onClick={() => onApprove(a.id)} title="Approve → Task Manager"
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-green-50 text-green-600 hover:bg-green-100"><ThumbsUp size={11} /></button>
                  <button onClick={() => onDefer(a.id)} title="Defer → Next meeting"
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-100"><RotateCcw size={11} /></button>
                  <button onClick={() => onDelete(a.id)} title="Reject"
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-400"><Trash2 size={11} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Approved summary */}
      {approved.length > 0 && (
        <div className="bg-green-50/50 rounded-lg px-3 py-2">
          <span className="text-[9px] font-bold text-green-600 uppercase tracking-wider">✅ Approved → Task Manager ({approved.length})</span>
          <div className="mt-1 space-y-0.5">{approved.map(a => (
            <div key={a.id} className="text-[10px] text-green-700 flex items-center gap-2"><Check size={9} /><span className="line-through opacity-60">{a.title}</span>{a.owner_name && <span className="text-green-500">— {a.owner_name.split(' ')[0]}</span>}{a.task_column && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[8px] font-medium">{a.task_column}</span>}</div>
          ))}</div>
        </div>
      )}

      {/* Completed summary — tasks that were moved to Done in Task Manager */}
      {completed.length > 0 && (
        <div className="bg-blue-50/50 rounded-lg px-3 py-2">
          <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">🎉 Completed ({completed.length})</span>
          <div className="mt-1 space-y-0.5">{completed.map(a => (
            <div key={a.id} className="text-[10px] text-blue-700 flex items-center gap-2"><CheckCircle2 size={9} /><span>{a.title}</span>{a.owner_name && <span className="text-blue-400">— {a.owner_name.split(' ')[0]}</span>}</div>
          ))}</div>
        </div>
      )}

      {/* Deferred summary */}
      {deferred.length > 0 && (
        <div className="bg-amber-50/50 rounded-lg px-3 py-2">
          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">🔄 Deferred → Next ({deferred.length})</span>
          <div className="mt-1 space-y-0.5">{deferred.map(a => (
            <div key={a.id} className="text-[10px] text-amber-700 flex items-center gap-2"><RotateCcw size={9} />{a.title}</div>
          ))}</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// SCHEDULE NEXT MODAL
// ═══════════════════════════════════════════════════════════

function SchedModal({ deferred, onSched, onClose }: {
  deferred: MeetingActionItem[]; onSched: (d: string, t: string) => void; onClose: () => void
}) {
  const [d, setD] = useState(''); const [t, setT] = useState('09:00')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
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

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

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

  // Inline capture state
  const [idsText, setIdsText] = useState('')
  const [actText, setActText] = useState('')
  const [aiFillingId, setAiFillingId] = useState<string | null>(null)
  const { on: vIds, toggle: vTIds } = useVoice(t => setIdsText(p => p ? p + ' ' + t : t))
  const { on: vAct, toggle: vTAct } = useVoice(t => setActText(p => p ? p + ' ' + t : t))

  // ── Load meeting + sync task statuses ──
  const load = useCallback(async () => {
    if (!id) return; setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (!m) { setLoading(false); return }

    const mtg: Meeting = { ...m, agenda: m.agenda || [], action_items: m.action_items || [], ids_items: m.ids_items || [] }

    // Sync approved action items with Task Manager
    const acts = (mtg.action_items || []) as MeetingActionItem[]
    const approvedWithTasks = acts.filter(a => a.task_id && (a.status === 'approved' || a.status === 'completed'))
    if (approvedWithTasks.length > 0) {
      const taskIds = approvedWithTasks.map(a => a.task_id!).filter(Boolean)
      const { data: tasks } = await supabase.from('kanban_tasks').select('id, column_id').in('id', taskIds)
      if (tasks && tasks.length > 0) {
        const colIds = [...new Set(tasks.map(t => t.column_id))]
        const { data: cols } = await supabase.from('kanban_columns').select('id, title').in('id', colIds)
        const colMap: Record<string, string> = {}; (cols || []).forEach(c => { colMap[c.id] = c.title })
        let changed = false
        const updated = acts.map(a => {
          if (!a.task_id) return a
          const task = tasks.find(t => t.id === a.task_id)
          if (!task) return a
          const colTitle = colMap[task.column_id] || ''
          const isDone = colTitle.toLowerCase().includes('done') || colTitle.toLowerCase().includes('complete')
          const newStatus = isDone ? 'completed' as const : a.status
          if (a.status !== newStatus || a.task_column !== colTitle) { changed = true }
          return { ...a, status: newStatus, task_column: colTitle }
        })
        if (changed) {
          mtg.action_items = updated
          await supabase.from('meetings').update({ action_items: updated, updated_at: new Date().toISOString() }).eq('id', mtg.id)
        }
      }
    }

    setMeeting(mtg)

    const { data: att } = await supabase.from('meeting_attendees').select('*, team_profiles:user_id(display_name)').eq('meeting_id', id)
    if (att) setAttendees(att.map((a: any) => ({ ...a, display_name: a.team_profiles?.display_name || 'Unknown' })))
    const { data: revs } = await supabase.from('meeting_rock_reviews').select('*').eq('meeting_id', id)
    if (revs) { const map: Record<string, string> = {}; revs.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' }); setRockReviews(map) }

    // Load previous meeting data
    if (m.prev_meeting_id) {
      const { data: prev } = await supabase.from('meetings').select('action_items, agenda').eq('id', m.prev_meeting_id).single()
      if (prev?.action_items) {
        const allPrev = prev.action_items as MeetingActionItem[]
        setPrevActions(allPrev.filter(a => a.status === 'deferred'))
        // Auto-populate To-Do Review
        const agenda = mtg.agenda || []
        const todoIdx = agenda.findIndex(s => s.section.toLowerCase().includes('to-do') || s.section.toLowerCase().includes('todo'))
        if (todoIdx >= 0 && (!agenda[todoIdx].talking_points || agenda[todoIdx].talking_points.length === 0)) {
          const prevItems = allPrev.filter(a => a.status !== 'deleted')
          if (prevItems.length > 0) {
            const updated = [...agenda]
            updated[todoIdx] = { ...updated[todoIdx], talking_points: prevItems.map(a => {
              const icon = a.status === 'approved' ? '✅' : a.status === 'deferred' ? '🔄' : a.status === 'completed' ? '🎉' : '⬜'
              return `${icon} ${a.title}${a.owner_name ? ` (${a.owner_name})` : ''}`
            })}
            // Carry forward notes
            if (prev.agenda) {
              (prev.agenda as AgendaSection[]).forEach(ps => {
                const mi = updated.findIndex(s => s.section === ps.section)
                if (mi >= 0 && ps.notes?.trim() && !updated[mi].notes?.trim()) {
                  updated[mi] = { ...updated[mi], notes: `[Previous] ${ps.notes}` }
                }
              })
            }
            mtg.agenda = updated
            await supabase.from('meetings').update({ agenda: updated, updated_at: new Date().toISOString() }).eq('id', mtg.id)
            setMeeting({ ...mtg, agenda: updated })
          }
        }
      }
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // ── Save helper ──
  const save = async (u: Partial<Meeting>) => {
    if (!meeting) return
    setMeeting(p => p ? { ...p, ...u } : p)
    await supabase.from('meetings').update({ ...u, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ── Meeting controls ──
  const startMeeting = () => { save({ status: 'in_progress' }); setOpenSec(0) }
  const endMeeting = () => { save({ status: 'completed' }); setOpenSec(null) }
  const toggleSec = (i: number) => { if (meeting?.status !== 'in_progress' && meeting?.status !== 'completed') return; setOpenSec(openSec === i ? null : i) }
  const checkSec = (i: number) => {
    if (!meeting) return
    const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], completed: !a[i].completed }; save({ agenda: a })
    if (a[i].completed) { const nx = a.findIndex((s, j) => j > i && !s.completed); if (nx >= 0) setOpenSec(nx) }
  }
  const updateNotes = (i: number, n: string) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], notes: n }; save({ agenda: a }) }

  // ── IDS operations ──
  const addIdsItem = () => {
    if (!idsText.trim() || !meeting) return
    save({ ids_items: [...(meeting.ids_items || []), EMPTY_IDS(idsText.trim())] })
    setIdsText('')
  }
  const updateIds = (itemId: string, u: Partial<IdsItem>) => {
    if (!meeting) return
    save({ ids_items: (meeting.ids_items || []).map(i => i.id === itemId ? { ...i, ...u } : i) })
  }
  const removeIds = (itemId: string) => {
    if (!meeting) return
    save({ ids_items: (meeting.ids_items || []).filter(i => i.id !== itemId) })
  }

  // ── AI Fill IDS ──
  const aiFillIds = async (itemId: string) => {
    if (!meeting || !currentOrg) return
    const item = (meeting.ids_items || []).find(i => i.id === itemId)
    if (!item) return
    setAiFillingId(itemId)
    try {
      const res = await fetch('/api/ai/ids-analyzer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_description: item.description || item.issue_category || 'Untitled issue',
          org_id: currentOrg.id,
          team_members: attendees.map(a => ({ display_name: a.display_name, role: 'attendee' })),
        }),
      })
      if (!res.ok) throw new Error(`AI returned ${res.status}`)
      const data = await res.json()
      updateIds(itemId, {
        issue_category: data.issue_category || item.issue_category,
        description: data.description || item.description,
        dependencies_context: data.dependencies_context || item.dependencies_context,
        decisions_needed: data.decisions_needed || item.decisions_needed,
        action_items_text: data.action_items_text || item.action_items_text,
        due_date: data.due_date || item.due_date,
        owner_name: data.suggested_owner || item.owner_name,
      })
    } catch (e) { console.error('AI fill error:', e) }
    setAiFillingId(null)
  }

  // ── Action item operations ──
  const addActionItem = () => {
    if (!actText.trim() || !meeting) return
    const item = EMPTY_ACTION(); item.title = actText.trim()
    save({ action_items: [...(meeting.action_items || []), item] })
    setActText('')
  }
  const updateAction = (aid: string, u: Partial<MeetingActionItem>) => {
    if (!meeting) return
    save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, ...u } : a) })
  }
  const approveAction = async (aid: string) => {
    if (!meeting || !currentOrg) return
    const action = (meeting.action_items || []).find(a => a.id === aid)
    if (!action) return
    const { data: cols } = await supabase.from('kanban_columns').select('id, title').eq('org_id', currentOrg.id).order('sort_order').limit(1)
    if (cols?.length) {
      const { data: task } = await supabase.from('kanban_tasks').insert({
        org_id: currentOrg.id, column_id: cols[0].id, title: action.title,
        description: action.description || null, assignee: action.owner || null,
        priority: action.priority || 'medium', due_date: action.due_date || null,
        source: 'meeting', visibility: 'everyone', sort_order: 0,
        custom_fields: {
          meeting_id: meeting.id,
          raci_responsible: action.raci_responsible, raci_accountable: action.raci_accountable,
          raci_consulted: action.raci_consulted, raci_informed: action.raci_informed,
        },
      }).select().single()
      if (task) {
        save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'approved' as const, task_id: task.id, task_column: cols[0].title } : a) })
      }
    }
  }
  const deferAction = (aid: string) => {
    if (!meeting) return
    save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'deferred' as const } : a) })
  }
  const deleteAction = (aid: string) => {
    if (!meeting) return
    save({ action_items: (meeting.action_items || []).map(a => a.id === aid ? { ...a, status: 'deleted' as const } : a) })
  }

  // ── Schedule next ──
  const scheduleNext = async (date: string, time: string) => {
    if (!meeting || !currentOrg) return
    const deferredItems = (meeting.action_items || []).filter(a => a.status === 'deferred')
    const templateAgenda = MEETING_TEMPLATES[meeting.template as MeetingTemplate]?.defaultAgenda || meeting.agenda || []
    const freshAgenda = templateAgenda.map(s => ({ ...s, notes: '', completed: false, talking_points: [] as string[] }))
    let finalAgenda = [...freshAgenda]
    if (deferredItems.length > 0) {
      const existing = finalAgenda.findIndex(s => s.section.toLowerCase().includes('deferred'))
      if (existing >= 0) {
        finalAgenda[existing] = { ...finalAgenda[existing], talking_points: deferredItems.map(d => `🔄 ${d.title}`) }
      } else {
        finalAgenda.unshift({ section: 'Review Deferred Items', duration_min: 10, notes: '', completed: false, talking_points: deferredItems.map(d => `🔄 ${d.title}`) })
      }
    }
    const { data: nm } = await supabase.from('meetings').insert({
      org_id: currentOrg.id, title: meeting.title, template: meeting.template,
      scheduled_at: new Date(`${date}T${time}:00`).toISOString(), duration_minutes: meeting.duration_minutes,
      status: 'scheduled', prev_meeting_id: meeting.id, agenda: finalAgenda,
      action_items: deferredItems.map(d => ({ ...d, status: 'pending' as const })),
    }).select().single()
    if (nm) {
      await supabase.from('meetings').update({ next_meeting_id: nm.id }).eq('id', meeting.id)
      if (attendees.length > 0) await supabase.from('meeting_attendees').insert(attendees.map(a => ({ meeting_id: nm.id, user_id: a.user_id })))
      setShowSched(false); router.push(`/meetings/${nm.id}`)
    }
  }

  // ── Edit helpers ──
  const editSecName = (i: number, n: string) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], section: n }; save({ agenda: a }) }
  const editSecTime = (i: number, m: number) => { if (!meeting) return; const a = [...(meeting.agenda || [])]; a[i] = { ...a[i], duration_min: Math.max(1, m) }; save({ agenda: a }) }
  const addSec = () => { if (!meeting) return; save({ agenda: [...(meeting.agenda || []), { section: 'New Section', duration_min: 10, notes: '', completed: false }] }) }
  const rmSec = (i: number) => { if (!meeting) return; save({ agenda: (meeting.agenda || []).filter((_, j) => j !== i) }) }
  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return; setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert({ meeting_id: meeting.id, rock_id: rockId, status_at_review: status }, { onConflict: 'meeting_id,rock_id' })
  }

  // ── Render ──
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const live = meeting.status === 'in_progress'
  const done = meeting.status === 'completed'
  const acts = (meeting.action_items || []).filter(a => a.status !== 'deleted')
  const ids = meeting.ids_items || []
  const isRock = (s: AgendaSection) => s.section.toLowerCase().includes('rock')
  const isIds = (s: AgendaSection) => s.section.toLowerCase().includes('ids') || s.section.toLowerCase().includes('identify')

  // Separate deferred (from prev) vs new for end review
  const prevActIds = new Set(prevActions.map(a => a.id))
  const deferredActs = acts.filter(a => prevActIds.has(a.id))
  const newActs = acts.filter(a => !prevActIds.has(a.id))

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-4xl mx-auto pb-12">
      <button onClick={() => router.push('/meetings')} className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark"><ChevronLeft size={14} /> Meetings</button>

      {/* ═══ HEADER ═══ */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5">
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
            {ids.filter(i => i.status !== 'solved').length > 0 && <span className="text-fire font-semibold">{ids.filter(i => i.status !== 'solved').length} IDS open</span>}
          </div>
        </div>
      </div>

      {/* ═══ DEFERRED FROM PREVIOUS ═══ */}
      {prevActions.length > 0 && !done && (
        <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-5 py-3">
          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">🔄 Deferred From Last Meeting</span>
          <div className="mt-1.5 space-y-1">{prevActions.map(a => <div key={a.id} className="flex items-center gap-2 text-[11px] text-amber-800"><ArrowRight size={9} className="shrink-0" /> {a.title}{a.owner_name && <span className="text-amber-500">— {a.owner_name.split(' ')[0]}</span>}</div>)}</div>
        </div>
      )}

      {/* ═══ AGENDA ACCORDION ═══ */}
      <div className="space-y-1.5">
        {(meeting.agenda || []).map((sec, i) => {
          const open = openSec === i
          const secIsRock = isRock(sec)
          const secIsIds = isIds(sec)

          return (
            <div key={i} className={`bg-white rounded-xl border overflow-hidden transition-all ${open ? 'border-np-blue/20 shadow-sm' : 'border-gray-100'}`}>
              {/* Section Header */}
              <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none" onClick={() => toggleSec(i)}>
                {(live || done) && (
                  <button onClick={e => { e.stopPropagation(); checkSec(i) }} className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition-colors ${sec.completed ? 'bg-green-500 border-green-500' : 'border-gray-200 hover:border-np-blue'}`}>
                    {sec.completed && <Check size={11} className="text-white" strokeWidth={3} />}
                  </button>
                )}
                {editing ? (
                  <input value={sec.section} onClick={e => e.stopPropagation()} onChange={e => editSecName(i, e.target.value)} className="flex-1 text-sm font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg" />
                ) : (
                  <span className={`text-sm font-semibold flex-1 ${sec.completed ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{sec.section}</span>
                )}
                {sec.prompts && sec.prompts.length > 0 && !open && <HelpCircle size={11} className="text-violet-300" />}
                {secIsIds && ids.length > 0 && !open && <span className="text-[9px] font-bold text-fire bg-fire/10 px-1.5 py-0.5 rounded-md">{ids.length}</span>}
                {live && open && <STimer dur={sec.duration_min} active={open} />}
                {editing ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => editSecTime(i, sec.duration_min - 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">−</button>
                    <span className="text-[10px] font-bold text-gray-500 w-7 text-center">{sec.duration_min}m</span>
                    <button onClick={() => editSecTime(i, sec.duration_min + 5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">+</button>
                    <button onClick={() => rmSec(i)} className="ml-1 text-gray-300 hover:text-red-400"><X size={11} /></button>
                  </div>
                ) : <span className="text-[10px] text-gray-400 font-medium shrink-0">{sec.duration_min} min</span>}
                <ChevronDown size={13} className={`text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
              </div>

              {/* ── Expanded Card Content ── */}
              {open && (
                <div className="border-t border-gray-100">
                  {/* Facilitator Prompts */}
                  {sec.prompts && sec.prompts.length > 0 && (
                    <div className="px-5 py-3 bg-violet-50/40 border-b border-violet-100/50">
                      <span className="text-[8px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1"><HelpCircle size={9} /> Facilitator Prompts</span>
                      <div className="mt-1.5 space-y-1">{sec.prompts.map((q, j) => <div key={j} className="text-[11px] text-violet-700 font-medium flex items-start gap-2"><span className="text-violet-400 shrink-0">Q{j + 1}.</span><span>{q}</span></div>)}</div>
                    </div>
                  )}

                  {/* Talking Points */}
                  {sec.talking_points && sec.talking_points.length > 0 && (
                    <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100/50">
                      <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Discussion Points</span>
                      <div className="mt-1.5 space-y-1">{sec.talking_points.map((tp, j) => <div key={j} className="text-[11px] text-np-dark flex items-start gap-2"><span className="text-gray-300 mt-0.5 shrink-0">•</span><span>{tp}</span></div>)}</div>
                    </div>
                  )}

                  {/* Rock Review */}
                  {secIsRock && rocks.length > 0 && (
                    <div className="px-5 py-3 border-b border-gray-100/50 space-y-1">{rocks.map(r => (
                      <div key={r.id} className="flex items-center gap-2 py-1.5">
                        <StatusDot status={rockReviews[r.id] || r.status} /><span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span>
                        <ProgressBar pct={r.progress_pct} className="max-w-[80px]" /><span className="text-[10px] font-bold text-gray-500 w-7 text-right">{r.progress_pct}%</span>
                        {live && <select value={rockReviews[r.id] || r.status} onChange={e => saveRockReview(r.id, e.target.value)} className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none"><option value="on_track">On Track</option><option value="at_risk">At Risk</option><option value="off_track">Off Track</option></select>}
                      </div>
                    ))}</div>
                  )}

                  {/* ═══ IDS TABLE — INSIDE the IDS section card ═══ */}
                  {secIsIds && (
                    <div className="px-5 py-3 border-b border-fire/10 bg-fire/[0.01]">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={11} className="text-fire" />
                        <span className="text-[9px] font-bold text-fire uppercase tracking-wider">IDS Capture List ({ids.length})</span>
                        <div className="flex gap-2 ml-auto text-[9px]">
                          <span className="text-green-600 font-semibold">{ids.filter(i => i.status === 'solved').length} solved</span>
                          <span className="text-amber-600 font-semibold">{ids.filter(i => i.status !== 'solved').length} open</span>
                        </div>
                      </div>
                      <IdsTable items={ids} onUpdate={updateIds} onRemove={removeIds} onAiFill={live ? aiFillIds : undefined} aiFillingId={aiFillingId} attendees={attendees} />
                      {/* IDS Quick Add */}
                      {live && (
                        <div className="flex gap-2 items-center mt-3">
                          <div className="relative flex-1">
                            <input value={idsText} onChange={e => setIdsText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addIdsItem() } }}
                              placeholder="Type an issue and press Enter..."
                              className="w-full px-3 py-2.5 text-xs border border-fire/20 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-fire/30 pr-8" />
                            <button onClick={vTIds} className={`absolute right-2 top-1/2 -translate-y-1/2 ${vIds ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-fire'}`}>{vIds ? <MicOff size={12} /> : <Mic size={12} />}</button>
                          </div>
                          <button onClick={addIdsItem} disabled={!idsText.trim()} className="px-3 py-2.5 bg-fire/10 text-fire rounded-lg disabled:opacity-30 hover:bg-fire/20 transition-colors"><Plus size={14} /></button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section Notes */}
                  <div className="px-5 py-3 border-b border-gray-100/50">
                    <label className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Notes</label>
                    <textarea value={sec.notes} onChange={e => updateNotes(i, e.target.value)} placeholder="Meeting notes for this section..." rows={3}
                      className="w-full mt-1 text-xs text-gray-600 bg-gray-50/50 rounded-lg p-3 border border-gray-100 focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none placeholder-gray-300" />
                  </div>

                  {/* IDS Quick Capture — every section during live (not just IDS section) */}
                  {live && !secIsIds && (
                    <div className="px-5 py-2.5 bg-fire/[0.02] border-b border-fire/10">
                      <div className="flex gap-2 items-center">
                        <span className="text-[8px] font-bold text-fire/50 uppercase shrink-0">🔥 IDS</span>
                        <div className="relative flex-1">
                          <input value={idsText} onChange={e => setIdsText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addIdsItem() } }}
                            placeholder="Identify an issue..."
                            className="w-full px-3 py-2 text-[11px] border border-fire/15 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-fire/20 pr-8" />
                          <button onClick={vTIds} className={`absolute right-2 top-1/2 -translate-y-1/2 ${vIds ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-fire'}`}>{vIds ? <MicOff size={11} /> : <Mic size={11} />}</button>
                        </div>
                        <button onClick={addIdsItem} disabled={!idsText.trim()} className="px-2.5 py-2 bg-fire/10 text-fire rounded-lg disabled:opacity-30 text-[10px]"><Plus size={12} /></button>
                      </div>
                    </div>
                  )}

                  {/* Action Item Capture — every section during live */}
                  {live && (
                    <div className="px-5 py-2.5 bg-np-blue/[0.02]">
                      <div className="flex gap-2 items-center">
                        <span className="text-[8px] font-bold text-np-blue/50 uppercase shrink-0">✏️ Action</span>
                        <div className="relative flex-1">
                          <input value={actText} onChange={e => setActText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addActionItem() } }}
                            placeholder="Capture an action item..."
                            className="w-full px-3 py-2 text-[11px] border border-np-blue/15 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/20 pr-8" />
                          <button onClick={vTAct} className={`absolute right-2 top-1/2 -translate-y-1/2 ${vAct ? 'text-red-500 animate-pulse' : 'text-gray-300 hover:text-np-blue'}`}>{vAct ? <MicOff size={11} /> : <Mic size={11} />}</button>
                        </div>
                        <button onClick={addActionItem} disabled={!actText.trim()} className="px-2.5 py-2 bg-np-blue/10 text-np-blue rounded-lg disabled:opacity-30 text-[10px]"><Plus size={12} /></button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {editing && <button onClick={addSec} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">+ Add Section</button>}
      </div>

      {/* ═══ LIVE: Captured Actions Preview ═══ */}
      {live && newActs.filter(a => a.status === 'pending').length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <span className="text-[9px] font-bold text-np-blue uppercase tracking-wider">✏️ Captured Action Items ({newActs.filter(a => a.status === 'pending').length})</span>
          <div className="mt-2 space-y-1">{newActs.filter(a => a.status === 'pending').map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] py-1.5">
              <Check size={9} className="text-np-blue shrink-0" /><span className="text-np-dark flex-1">{a.title}</span>
              <button onClick={() => deleteAction(a.id)} className="text-gray-200 hover:text-red-400"><X size={10} /></button>
            </div>
          ))}</div>
        </div>
      )}

      {/* ═══ END-OF-MEETING REVIEW ═══ */}
      {done && (
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5 space-y-5">
          <div className="text-center py-3">
            <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3"><CheckCircle2 size={28} className="text-green-500" /></div>
            <h3 className="text-sm font-bold text-np-dark">Meeting Complete</h3>
            <p className="text-xs text-gray-400 mt-1">Review each item — fill in details, then approve, defer, or reject</p>
          </div>

          {/* IDS Summary */}
          {ids.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4">
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">IDS Summary</span>
              <div className="flex gap-3 mt-1">
                <span className="text-[10px] font-semibold text-green-600">{ids.filter(i => i.status === 'solved').length} solved</span>
                <span className="text-[10px] font-semibold text-amber-600">{ids.filter(i => i.status !== 'solved').length} open</span>
              </div>
              {ids.filter(i => i.status !== 'solved').length > 0 && (
                <div className="mt-2 space-y-1">{ids.filter(i => i.status !== 'solved').map(i => <div key={i.id} className="text-[10px] text-amber-700 flex items-center gap-1"><AlertTriangle size={9} /> {i.issue_category || i.description?.slice(0, 80)}</div>)}</div>
              )}
            </div>
          )}

          {/* Deferred from previous — review first */}
          {deferredActs.length > 0 && (
            <ActionReviewTable actions={deferredActs} attendees={attendees} onUpdate={updateAction} onApprove={approveAction} onDefer={deferAction} onDelete={deleteAction} label="🔄 Deferred From Previous" labelColor="#D97706" />
          )}

          {/* New captured items */}
          {newActs.length > 0 && (
            <ActionReviewTable actions={newActs} attendees={attendees} onUpdate={updateAction} onApprove={approveAction} onDefer={deferAction} onDelete={deleteAction} label="✏️ New Action Items" labelColor="#386797" />
          )}

          <button onClick={() => setShowSched(true)} className="w-full flex items-center justify-center gap-2 py-3.5 bg-np-blue/5 text-np-blue text-xs font-semibold rounded-xl border border-np-blue/20 hover:bg-np-blue/10 transition-colors"><Calendar size={13} /> Schedule Next Meeting</button>
        </div>
      )}

      {showSched && <SchedModal deferred={acts.filter(a => a.status === 'deferred')} onSched={scheduleNext} onClose={() => setShowSched(false)} />}
    </div>
  )
}
