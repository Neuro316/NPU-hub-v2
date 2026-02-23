'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, IdsItem, IdsStatus, MeetingActionItem } from '@/lib/types/meetings'
import {
  ChevronLeft, ChevronRight, Clock, Save, Check, Loader2, Target,
  Play, Pause, SkipForward, Timer, Plus, X, Sparkles,
  AlertTriangle, CheckCircle2, MessageSquare, Trash2,
  Mic, MicOff, Calendar, ArrowRight, ExternalLink, Send
} from 'lucide-react'

/* ══════════════════════════════════════
   SECTION TIMER — auto-starts on check
   Green → Yellow (<25%) → Red (overtime)
   ══════════════════════════════════════ */
function SectionTimer({ durationMin, isActive, autoStart }: { durationMin: number; isActive: boolean; autoStart?: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const totalSec = durationMin * 60
  const remaining = totalSec - elapsed
  const pct = totalSec > 0 ? Math.max(0, remaining / totalSec) : 0

  useEffect(() => { setElapsed(0); setRunning(!!autoStart) }, [durationMin, isActive, autoStart])
  useEffect(() => {
    if (running) { intervalRef.current = setInterval(() => setElapsed(p => p + 1), 1000) }
    else if (intervalRef.current) clearInterval(intervalRef.current)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  const fmt = (sec: number) => {
    const abs = Math.abs(sec); const m = Math.floor(abs / 60); const s = abs % 60
    return `${sec < 0 ? '+' : ''}${m}:${s.toString().padStart(2, '0')}`
  }

  let color = '#16A34A', bg = '#F0FDF4', label = 'On Time'
  if (remaining <= 0) { color = '#DC2626'; bg = '#FEF2F2'; label = 'Over Time' }
  else if (pct < 0.25) { color = '#D97706'; bg = '#FFFBEB'; label = 'Wrap Up' }

  if (!isActive) return null
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: bg, color }}>
        <Timer size={13} /><span className="font-mono tabular-nums">{fmt(remaining)}</span>
        <span className="text-[9px] font-semibold opacity-70 ml-1">{label}</span>
      </div>
      <button onClick={() => setRunning(!running)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100" style={{ color }}>
        {running ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <button onClick={() => { setElapsed(0); setRunning(false) }} className="text-[10px] text-gray-400 hover:text-gray-600">Reset</button>
    </div>
  )
}

/* ══════════════════════════════════════
   VOICE INPUT HOOK
   ══════════════════════════════════════ */
function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  const toggle = useCallback(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported in this browser'); return }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop(); setListening(false); return
    }
    const recognition = new SR()
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      const text = e.results[0]?.[0]?.transcript || ''
      if (text) onResult(text)
      setListening(false)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start(); setListening(true)
  }, [listening, onResult])

  return { listening, toggle }
}

/* ══════════════════════════════════════
   IDS PANEL — Full 7-column format
   ══════════════════════════════════════ */
function IdsPanel({ items, attendees, orgId, meetingTemplate, onSave, onClose }: {
  items: IdsItem[]; attendees: MeetingAttendee[]; orgId: string; meetingTemplate: string
  onSave: (items: IdsItem[]) => void; onClose: () => void
}) {
  const [localItems, setLocalItems] = useState<IdsItem[]>(items || [])
  const [newIssue, setNewIssue] = useState('')
  const [aiLoading, setAiLoading] = useState<string | null>(null) // id of item being analyzed
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { listening, toggle: toggleVoice } = useVoiceInput((text) => setNewIssue(prev => prev ? prev + ' ' + text : text))

  const addIssue = async (text?: string) => {
    const issueText = text || newIssue.trim()
    if (!issueText) return

    const newId = crypto.randomUUID()
    const newItem: IdsItem = {
      id: newId, issue_category: '', description: issueText,
      dependencies_context: '', decisions_needed: '', action_items: '',
      due_date: '', owner: '', owner_name: '', status: 'identified',
      resolution: '', created_at: new Date().toISOString(),
    }
    setLocalItems(prev => [...prev, newItem])
    setNewIssue('')
    setExpandedId(newId)

    // AI auto-fill
    setAiLoading(newId)
    try {
      const res = await fetch('/api/ai/ids-analyzer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_text: issueText, org_id: orgId, meeting_template: meetingTemplate,
          attendees: attendees.map(a => a.display_name),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ids_item) {
          setLocalItems(prev => prev.map(item => item.id === newId ? {
            ...item,
            issue_category: data.ids_item.issue_category || item.issue_category,
            description: data.ids_item.description || item.description,
            dependencies_context: data.ids_item.dependencies_context || '',
            decisions_needed: data.ids_item.decisions_needed || '',
            action_items: data.ids_item.action_items || '',
            due_date: data.ids_item.due_date || '',
            owner_name: data.ids_item.owner || '',
          } : item))
        }
      }
    } catch (e) { console.error('AI IDS error:', e) }
    setAiLoading(null)
  }

  const updateItem = (id: string, updates: Partial<IdsItem>) => {
    setLocalItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }

  const advanceStatus = (id: string) => {
    const flow: IdsStatus[] = ['identified', 'discussing', 'solved']
    setLocalItems(prev => prev.map(i => {
      if (i.id !== id) return i
      const idx = flow.indexOf(i.status)
      return idx < flow.length - 1 ? { ...i, status: flow[idx + 1] } : i
    }))
  }

  const statusColors: Record<IdsStatus, { bg: string; text: string; label: string }> = {
    identified: { bg: '#FEF3C7', text: '#D97706', label: 'Identified' },
    discussing: { bg: '#DBEAFE', text: '#2563EB', label: 'Discussing' },
    solved: { bg: '#D1FAE5', text: '#059669', label: 'Solved' },
    deferred: { bg: '#F3F4F6', text: '#6B7280', label: 'Deferred' },
  }

  const solvedCount = localItems.filter(i => i.status === 'solved').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-fire" />
            <h3 className="text-sm font-bold text-np-dark">IDS — Identify, Discuss, Solve</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold text-gray-400">{solvedCount} solved · {localItems.length - solvedCount} active</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
          </div>
        </div>

        {/* Input bar — text + voice */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex gap-2">
            <input value={newIssue} onChange={e => setNewIssue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) addIssue() }}
              placeholder="Type or speak an issue — AI will break it down into all fields..."
              className="flex-1 px-3 py-2.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-fire/30" />
            <button onClick={toggleVoice}
              className={`px-3 py-2.5 rounded-lg border transition-colors ${
                listening ? 'bg-red-500 text-white border-red-500 animate-pulse' : 'bg-white text-gray-400 border-gray-200 hover:text-fire hover:border-fire/30'
              }`}>
              {listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button onClick={() => addIssue()} disabled={!newIssue.trim()}
              className="px-4 py-2.5 bg-fire text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1">
              <Send size={12} /> Add Issue
            </button>
          </div>
          {listening && <p className="text-[10px] text-red-500 mt-1 animate-pulse">🎤 Listening... speak your issue</p>}
        </div>

        {/* Issues list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {localItems.length === 0 && (
            <div className="text-center py-16">
              <AlertTriangle size={28} className="mx-auto text-gray-200 mb-2" />
              <p className="text-xs text-gray-400">No issues yet. Type or speak an issue above.</p>
              <p className="text-[10px] text-gray-400 mt-1">AI will auto-fill Category, Dependencies, Decisions, Action Items, and Owner.</p>
            </div>
          )}
          {localItems.map(item => {
            const sc = statusColors[item.status]
            const isExpanded = expandedId === item.id
            const isAiLoading = aiLoading === item.id

            return (
              <div key={item.id} className="border border-gray-100 rounded-lg mb-2 overflow-hidden">
                {/* Compact row */}
                <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                  <button onClick={e => { e.stopPropagation(); advanceStatus(item.id) }}
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 cursor-pointer"
                    style={{ background: sc.bg, color: sc.text }}>{sc.label}</button>
                  {isAiLoading && <Loader2 size={12} className="animate-spin text-fire shrink-0" />}
                  <span className="text-[10px] font-bold text-fire bg-fire/10 px-1.5 py-0.5 rounded shrink-0">
                    {item.issue_category || 'Uncategorized'}
                  </span>
                  <span className={`text-xs flex-1 truncate ${item.status === 'solved' ? 'line-through text-gray-400' : 'text-np-dark font-medium'}`}>
                    {item.description}
                  </span>
                  {item.owner_name && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">{item.owner_name}</span>}
                  <ChevronRight size={12} className={`text-gray-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </div>

                {/* Expanded detail — all 7 fields editable */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 bg-gray-50/50 space-y-2 border-t border-gray-100">
                    {isAiLoading && (
                      <div className="flex items-center gap-2 py-2 text-[11px] text-fire">
                        <Loader2 size={11} className="animate-spin" /> AI is analyzing this issue and filling fields...
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase">Issue Category</label>
                        <input value={item.issue_category} onChange={e => updateItem(item.id, { issue_category: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase">Owner</label>
                        <select value={item.owner_name} onChange={e => {
                          const att = attendees.find(a => a.display_name === e.target.value)
                          updateItem(item.id, { owner: att?.user_id || '', owner_name: e.target.value })
                        }} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white">
                          <option value="">Assign...</option>
                          {attendees.map(a => <option key={a.user_id} value={a.display_name}>{a.display_name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase">Description</label>
                      <textarea value={item.description} onChange={e => updateItem(item.id, { description: e.target.value })}
                        rows={2} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none resize-none" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase">Dependencies / Context</label>
                      <textarea value={item.dependencies_context} onChange={e => updateItem(item.id, { dependencies_context: e.target.value })}
                        rows={2} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none resize-none" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase">Decisions Needed</label>
                      <textarea value={item.decisions_needed} onChange={e => updateItem(item.id, { decisions_needed: e.target.value })}
                        rows={2} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none resize-none" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase">Action Items</label>
                      <textarea value={item.action_items} onChange={e => updateItem(item.id, { action_items: e.target.value })}
                        rows={2} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase">Due Date</label>
                        <input value={item.due_date} onChange={e => updateItem(item.id, { due_date: e.target.value })}
                          placeholder="e.g. 2 weeks, Next meeting"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase">Status</label>
                        <select value={item.status} onChange={e => updateItem(item.id, { status: e.target.value as IdsStatus })}
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white">
                          <option value="identified">Identified</option>
                          <option value="discussing">Discussing</option>
                          <option value="solved">Solved</option>
                          <option value="deferred">Deferred</option>
                        </select>
                      </div>
                    </div>
                    {(item.status === 'discussing' || item.status === 'solved') && (
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase">Resolution</label>
                        <textarea value={item.resolution} onChange={e => updateItem(item.id, { resolution: e.target.value })}
                          placeholder="Capture the decision / resolution..." rows={2}
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none resize-none" />
                      </div>
                    )}
                    <div className="flex justify-end pt-1">
                      <button onClick={() => setLocalItems(prev => prev.filter(i => i.id !== item.id))}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-400 hover:bg-red-50 rounded">
                        <Trash2 size={10} /> Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { onSave(localItems); onClose() }}
            className="px-4 py-1.5 bg-fire text-white text-xs font-semibold rounded-lg">Save IDS Items</button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════
   SCHEDULE NEXT MEETING MODAL
   ══════════════════════════════════════ */
function ScheduleNextModal({ meeting, attendees, actionItems, onSchedule, onClose }: {
  meeting: Meeting; attendees: MeetingAttendee[]
  actionItems: MeetingActionItem[]
  onSchedule: (date: string, time: string) => void; onClose: () => void
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-teal" />
            <h3 className="text-sm font-bold text-np-dark">Schedule Next Meeting</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-3">
            <span className="text-[9px] font-bold text-gray-400 uppercase">Action Items to Carry Forward ({actionItems.length})</span>
            {actionItems.length > 0 ? (
              <div className="mt-1.5 space-y-1">
                {actionItems.slice(0, 6).map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    <ArrowRight size={9} className="text-teal shrink-0" />
                    <span className="text-np-dark truncate">{a.title}</span>
                    {a.owner_name && <span className="text-gray-400 shrink-0">— {a.owner_name.split(' ')[0]}</span>}
                  </div>
                ))}
                {actionItems.length > 6 && <p className="text-[10px] text-gray-400">+{actionItems.length - 6} more</p>}
              </div>
            ) : <p className="text-[10px] text-gray-400 mt-1">No action items to carry forward</p>}
          </div>

          <div className="bg-blue-50 rounded-lg p-3">
            <span className="text-[9px] font-bold text-blue-600 uppercase">Attendees ({attendees.length})</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {attendees.map(a => (
                <span key={a.user_id} className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-blue-100 text-np-dark">
                  {a.display_name}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-blue-500 mt-1.5">Calendar invites will be sent to all attendees</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { if (date) onSchedule(date, time) }} disabled={!date}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal text-white text-xs font-semibold rounded-lg disabled:opacity-50">
            <Calendar size={11} /> Schedule & Create
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════ */
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
  const [tab, setTab] = useState<'agenda' | 'ids_review' | 'action_items'>('agenda')
  const [saving, setSaving] = useState(false)
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})
  const [activeSectionIdx, setActiveSectionIdx] = useState<number | null>(null)
  const [showIds, setShowIds] = useState(false)
  const [showScheduleNext, setShowScheduleNext] = useState(false)
  const [prevActions, setPrevActions] = useState<MeetingActionItem[]>([])

  // Voice input for agenda prompt
  const [agendaPrompt, setAgendaPrompt] = useState('')
  const [generatingAgenda, setGeneratingAgenda] = useState(false)
  const { listening: voiceListening, toggle: toggleAgendaVoice } = useVoiceInput(
    (text) => setAgendaPrompt(prev => prev ? prev + ' ' + text : text)
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) {
      setMeeting({ ...m, ids_items: m.ids_items || [], action_items: m.action_items || [] })
    }
    const { data: att } = await supabase.from('meeting_attendees')
      .select('*, team_profiles:user_id(display_name)').eq('meeting_id', id)
    if (att) setAttendees(att.map((a: any) => ({ ...a, display_name: a.team_profiles?.display_name || 'Unknown' })))
    const { data: reviews } = await supabase.from('meeting_rock_reviews').select('*').eq('meeting_id', id)
    if (reviews) {
      const map: Record<string, string> = {}
      reviews.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' })
      setRockReviews(map)
    }
    // Load previous meeting actions if linked
    if (m?.prev_meeting_id) {
      const { data: prev } = await supabase.from('meetings').select('action_items').eq('id', m.prev_meeting_id).single()
      if (prev?.action_items) setPrevActions(prev.action_items)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const saveMeeting = async (updates: Partial<Meeting>) => {
    if (!meeting) return
    const merged = { ...meeting, ...updates }
    setMeeting(merged)
    await supabase.from('meetings').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const checkSection = async (index: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    const wasCompleted = agenda[index].completed
    agenda[index] = { ...agenda[index], completed: !wasCompleted }

    if (!wasCompleted) {
      // Auto-advance to this section and start timer
      setActiveSectionIdx(index)
    }
    await saveMeeting({ agenda })
  }

  const nextSection = () => {
    if (!meeting?.agenda || activeSectionIdx === null) return
    const next = activeSectionIdx + 1
    if (next < meeting.agenda.length) setActiveSectionIdx(next)
  }

  const updateMeetingStatus = async (status: string) => {
    if (!meeting) return
    await saveMeeting({ status: status as any })
    if (status === 'in_progress' && meeting.agenda?.length > 0) setActiveSectionIdx(0)
    if (status === 'completed') {
      // Extract action items from IDS
      extractActionItems()
    }
  }

  const extractActionItems = () => {
    if (!meeting) return
    const actions: MeetingActionItem[] = []
    ;(meeting.ids_items || []).forEach(ids => {
      if (ids.action_items?.trim()) {
        // Split multi-line action items
        const lines = ids.action_items.split(/[;,\n]/).map(l => l.trim()).filter(Boolean)
        lines.forEach(line => {
          actions.push({
            id: crypto.randomUUID(), title: line,
            owner: ids.owner, owner_name: ids.owner_name,
            due_date: ids.due_date, task_id: null, completed: false,
          })
        })
      }
    })
    if (actions.length > 0) saveMeeting({ action_items: actions })
  }

  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return
    setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert(
      { meeting_id: meeting.id, rock_id: rockId, status_at_review: status },
      { onConflict: 'meeting_id,rock_id' }
    )
  }

  const saveIdsItems = async (items: IdsItem[]) => {
    if (!meeting) return
    await saveMeeting({ ids_items: items })
  }

  const generateAiAgenda = async () => {
    if (!meeting) return
    setGeneratingAgenda(true)
    try {
      const res = await fetch('/api/ai/agenda-generator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meeting.title, template: meeting.template,
          duration_minutes: meeting.duration_minutes,
          attendee_names: attendees.map(a => a.display_name),
          context: agendaPrompt,
        }),
      })
      const data = await res.json()
      if (data.agenda) await saveMeeting({ agenda: data.agenda })
    } catch (e) { console.error('AI agenda error:', e) }
    setGeneratingAgenda(false); setAgendaPrompt('')
  }

  const createTaskFromAction = async (action: MeetingActionItem) => {
    if (!currentOrg || !meeting) return
    // Get first column
    const { data: cols } = await supabase.from('kanban_columns').select('id').eq('org_id', currentOrg.id).order('sort_order').limit(1)
    if (!cols?.length) return

    const { data: task } = await supabase.from('kanban_tasks').insert({
      org_id: currentOrg.id, column_id: cols[0].id, title: action.title,
      source: 'meeting', priority: 'medium', visibility: 'everyone', sort_order: 0,
      assignee: action.owner || null,
      custom_fields: { meeting_id: meeting.id, raci_responsible: action.owner_name },
    }).select().single()

    if (task) {
      const updatedActions = (meeting.action_items || []).map(a =>
        a.id === action.id ? { ...a, task_id: task.id } : a
      )
      await saveMeeting({ action_items: updatedActions })
    }
  }

  const createAllTasks = async () => {
    if (!meeting?.action_items) return
    for (const action of meeting.action_items.filter(a => !a.task_id)) {
      await createTaskFromAction(action)
    }
  }

  const scheduleNextMeeting = async (date: string, time: string) => {
    if (!meeting || !currentOrg) return
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString()

    // Carry forward unsolved IDS items + action items into next agenda context
    const prevActionItems = (meeting.action_items || []).filter(a => !a.completed)

    const { data: newMeeting } = await supabase.from('meetings').insert({
      org_id: currentOrg.id, title: meeting.title, template: meeting.template,
      scheduled_at: scheduledAt, duration_minutes: meeting.duration_minutes,
      status: 'scheduled', prev_meeting_id: meeting.id,
      agenda: [
        { section: 'Review Previous Action Items', duration_min: 10, notes: '', completed: false },
        ...(meeting.agenda || []).filter(s => !s.section.toLowerCase().includes('review previous')),
      ],
      action_items: prevActionItems, // carry forward uncompleted
    }).select().single()

    if (newMeeting) {
      // Link current → next
      await supabase.from('meetings').update({ next_meeting_id: newMeeting.id }).eq('id', meeting.id)

      // Copy attendees
      if (attendees.length > 0) {
        await supabase.from('meeting_attendees').insert(
          attendees.map(a => ({ meeting_id: newMeeting.id, user_id: a.user_id }))
        )
      }

      setShowScheduleNext(false)
      router.push(`/meetings/${newMeeting.id}`)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const idsCount = (meeting.ids_items || []).length
  const idsSolvedCount = (meeting.ids_items || []).filter(i => i.status === 'solved').length
  const actionCount = (meeting.action_items || []).length
  const isIdsSection = (s: AgendaSection) => s.section.toLowerCase().includes('ids') || s.section.toLowerCase().includes('identify')

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <button onClick={() => router.push('/meetings')}
        className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark">
        <ChevronLeft size={14} /> Back to Meetings
      </button>

      {/* Header card */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <BadgePill text={tmpl.label} color={tmpl.color} />
            <h2 className="text-base font-bold text-np-dark">{meeting.title}</h2>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              }) : 'No date'} · {meeting.duration_minutes} min
            </span>
            {attendees.length > 0 && <AvatarStack list={attendees.map(a => ({
              initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
            }))} />}
            <div className="ml-auto flex gap-1.5 items-center">
              {meeting.status === 'scheduled' && (
                <button onClick={() => updateMeetingStatus('in_progress')}
                  className="px-2.5 py-1 bg-teal text-white text-[10px] font-semibold rounded-md flex items-center gap-1">
                  <Play size={9} /> Start Meeting
                </button>
              )}
              {meeting.status === 'in_progress' && (
                <button onClick={() => { extractActionItems(); updateMeetingStatus('completed') }}
                  className="px-2.5 py-1 bg-green-500 text-white text-[10px] font-semibold rounded-md">Complete</button>
              )}
              {meeting.status === 'completed' && !meeting.next_meeting_id && (
                <button onClick={() => setShowScheduleNext(true)}
                  className="px-2.5 py-1 bg-teal text-white text-[10px] font-semibold rounded-md flex items-center gap-1">
                  <Calendar size={9} /> Schedule Next
                </button>
              )}
              <StatusDot status={meeting.status} />
              <span className="text-[10px] capitalize font-medium">{meeting.status.replace('_', ' ')}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {[
            { key: 'agenda' as const, label: 'Agenda' },
            { key: 'ids_review' as const, label: `IDS${idsCount > 0 ? ` (${idsSolvedCount}/${idsCount})` : ''}` },
            { key: 'action_items' as const, label: `Actions${actionCount > 0 ? ` (${actionCount})` : ''}` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t.key ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent'
              }`}>{t.label}</button>
          ))}
        </div>

        <div className="p-5 min-h-[200px]">
          {/* ═══ AGENDA TAB ═══ */}
          {tab === 'agenda' && (
            <div>
              {/* Previous meeting actions review */}
              {prevActions.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
                  <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Previous Meeting Action Items</span>
                  <div className="mt-1.5 space-y-1">
                    {prevActions.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-[11px]">
                        <span className={`font-semibold ${a.completed ? 'text-green-500' : 'text-amber-600'}`}>{a.completed ? '✓' : '○'}</span>
                        <span className={a.completed ? 'line-through text-gray-400' : 'text-np-dark'}>{a.title}</span>
                        {a.owner_name && <span className="text-gray-400">— {a.owner_name.split(' ')[0]}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timer toolbar */}
              {meeting.status === 'in_progress' && activeSectionIdx !== null && (
                <div className="flex items-center gap-2 mb-4 p-2 bg-gray-50 rounded-lg">
                  <SectionTimer
                    durationMin={(meeting.agenda || [])[activeSectionIdx]?.duration_min || 5}
                    isActive={true} autoStart={true} />
                  <span className="text-xs font-semibold text-np-dark flex-1">
                    {(meeting.agenda || [])[activeSectionIdx]?.section}
                  </span>
                  <button onClick={nextSection}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-teal hover:bg-teal/5 rounded-md">
                    <SkipForward size={11} /> Next
                  </button>
                </div>
              )}

              {/* Voice/text agenda prompt (when no agenda yet) */}
              {(!meeting.agenda || meeting.agenda.length === 0) && meeting.status !== 'completed' && (
                <div className="mb-4 p-4 bg-violet-50 border border-violet-100 rounded-lg">
                  <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Generate Agenda</span>
                  <p className="text-[10px] text-violet-500 mt-0.5 mb-2">Speak or type what you want to cover — AI will create the agenda in your meeting format.</p>
                  <div className="flex gap-2">
                    <input value={agendaPrompt} onChange={e => setAgendaPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') generateAiAgenda() }}
                      placeholder="e.g. Review Q1 revenue, discuss Charlotte expansion, hiring update..."
                      className="flex-1 px-3 py-2 text-xs border border-violet-200 rounded-lg bg-white focus:outline-none" />
                    <button onClick={toggleAgendaVoice}
                      className={`px-3 py-2 rounded-lg border ${voiceListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-violet-400 border-violet-200 hover:text-violet-600'}`}>
                      {voiceListening ? <MicOff size={13} /> : <Mic size={13} />}
                    </button>
                    <button onClick={generateAiAgenda} disabled={generatingAgenda || !agendaPrompt.trim()}
                      className="px-4 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1">
                      {generatingAgenda ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Generate
                    </button>
                  </div>
                  {voiceListening && <p className="text-[10px] text-red-500 mt-1 animate-pulse">🎤 Listening...</p>}
                </div>
              )}

              {/* Agenda sections — checkbox starts timer */}
              {(meeting.agenda || []).map((section, i) => {
                const isActive = activeSectionIdx === i && meeting.status === 'in_progress'
                const isIds = isIdsSection(section)
                return (
                  <div key={i} className={`flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0 transition-colors ${
                    isActive ? 'bg-teal/5 -mx-5 px-5 border-l-2 border-l-teal' : ''
                  }`}>
                    <button onClick={() => checkSection(i)}
                      className={`w-[18px] h-[18px] rounded flex items-center justify-center border-2 shrink-0 ${
                        section.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-teal'
                      }`}>
                      {section.completed && <Check size={10} className="text-white" strokeWidth={3} />}
                    </button>
                    <span className={`text-xs font-medium flex-1 ${section.completed ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                      {section.section}
                      {section.notes && <span className="text-[10px] text-gray-400 ml-2">📝</span>}
                    </span>
                    {isIds && idsCount > 0 && (
                      <button onClick={() => setShowIds(true)}
                        className="flex items-center gap-1 px-2 py-0.5 bg-fire/10 text-fire text-[9px] font-bold rounded-full">
                        <MessageSquare size={9} /> {idsSolvedCount}/{idsCount}
                      </button>
                    )}
                    <BadgePill text={`${section.duration_min} min`} color="#9CA3AF" bgColor="#F3F4F6" />
                  </div>
                )
              })}

              {/* Floating Add IDS Issue button — always visible during meeting */}
              {meeting.status === 'in_progress' && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <button onClick={() => setShowIds(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-fire/5 text-fire text-sm font-semibold rounded-xl border-2 border-dashed border-fire/30 hover:bg-fire/10 transition-colors">
                    <Plus size={16} /> Add IDS Issue
                  </button>
                </div>
              )}

              {/* Rock Review (L10) */}
              {meeting.template === 'level_10' && rocks.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Target size={13} className="text-teal" />
                    <span className="text-xs font-bold text-np-dark">Rock Review</span>
                  </div>
                  {rocks.map(r => (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-gray-100/50 last:border-0">
                      <StatusDot status={rockReviews[r.id] || r.status} />
                      <span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span>
                      <ProgressBar pct={r.progress_pct} className="max-w-[80px]" />
                      <span className="text-[10px] font-bold text-np-dark w-8 text-right">{r.progress_pct}%</span>
                      <select value={rockReviews[r.id] || r.status}
                        onChange={e => saveRockReview(r.id, e.target.value)}
                        className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md">
                        <option value="on_track">On Track</option>
                        <option value="at_risk">At Risk</option>
                        <option value="off_track">Off Track</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ IDS REVIEW TAB ═══ */}
          {tab === 'ids_review' && (
            <div>
              {idsCount === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare size={32} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm font-medium text-np-dark">No IDS items yet</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Add issues during the meeting — AI will auto-fill all fields.</p>
                  <button onClick={() => setShowIds(true)}
                    className="px-4 py-2 bg-fire text-white text-xs font-semibold rounded-lg">Open IDS Board</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-np-dark">{idsCount} Issues</span>
                    <button onClick={() => setShowIds(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-fire bg-fire/5 rounded-md border border-fire/20">
                      <MessageSquare size={10} /> Edit IDS
                    </button>
                  </div>
                  {/* Column headers */}
                  <div className="grid grid-cols-12 gap-1 px-2 text-[8px] font-bold text-gray-400 uppercase tracking-wider">
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Category</div>
                    <div className="col-span-3">Description</div>
                    <div className="col-span-2">Decisions</div>
                    <div className="col-span-2">Action Items</div>
                    <div className="col-span-1">Due</div>
                    <div className="col-span-1">Owner</div>
                  </div>
                  {(meeting.ids_items || []).map(item => {
                    const colors: Record<string, string> = { identified: '#D97706', discussing: '#2563EB', solved: '#059669', deferred: '#6B7280' }
                    return (
                      <div key={item.id} className="grid grid-cols-12 gap-1 p-2 bg-gray-50 rounded-lg text-[10px] items-start">
                        <div className="col-span-1">
                          <span className="px-1 py-0.5 rounded-full text-[8px] font-bold"
                            style={{ background: (colors[item.status] || '#6B7280') + '15', color: colors[item.status] || '#6B7280' }}>
                            {item.status.slice(0, 4).toUpperCase()}
                          </span>
                        </div>
                        <div className="col-span-2 font-semibold text-np-dark">{item.issue_category || '--'}</div>
                        <div className="col-span-3 text-gray-600">{item.description?.slice(0, 80)}{item.description?.length > 80 ? '...' : ''}</div>
                        <div className="col-span-2 text-gray-500">{item.decisions_needed?.slice(0, 60)}</div>
                        <div className="col-span-2 text-gray-500">{item.action_items?.slice(0, 60)}</div>
                        <div className="col-span-1 text-gray-400">{item.due_date || '--'}</div>
                        <div className="col-span-1 text-gray-400">{item.owner_name?.split(' ')[0] || '--'}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══ ACTION ITEMS TAB ═══ */}
          {tab === 'action_items' && (
            <div>
              {actionCount === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 size={32} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm font-medium text-np-dark">No action items yet</p>
                  <p className="text-xs text-gray-400 mt-1">Action items are extracted from IDS when the meeting completes.</p>
                  {meeting.status === 'in_progress' && (
                    <button onClick={extractActionItems}
                      className="mt-3 px-4 py-2 bg-np-blue text-white text-xs font-semibold rounded-lg">Extract Now</button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-np-dark">{actionCount} Action Items</span>
                    <button onClick={createAllTasks}
                      className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-np-blue bg-np-blue/5 rounded-md border border-np-blue/20">
                      <Plus size={10} /> Send All to Task Manager
                    </button>
                  </div>
                  {(meeting.action_items || []).map(action => (
                    <div key={action.id} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0">
                      <span className={`text-sm font-semibold ${action.completed ? 'text-green-500' : 'text-gray-300'}`}>
                        {action.completed ? '✓' : '○'}
                      </span>
                      <span className={`text-xs flex-1 ${action.completed ? 'line-through text-gray-400' : 'text-np-dark'}`}>
                        {action.title}
                      </span>
                      {action.owner_name && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{action.owner_name.split(' ')[0]}</span>}
                      {action.due_date && <span className="text-[10px] text-gray-400">{action.due_date}</span>}
                      {action.task_id ? (
                        <button onClick={() => router.push(`/tasks?task=${action.task_id}`)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold text-green-600 bg-green-50 rounded">
                          <ExternalLink size={9} /> In Tasks
                        </button>
                      ) : (
                        <button onClick={() => createTaskFromAction(action)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold text-np-blue bg-blue-50 rounded hover:bg-blue-100">
                          <Plus size={9} /> Create Task
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Schedule next meeting */}
              {meeting.status === 'completed' && !meeting.next_meeting_id && (
                <div className="mt-6 p-4 bg-teal/5 border border-teal/20 rounded-xl text-center">
                  <Calendar size={20} className="mx-auto text-teal mb-2" />
                  <p className="text-xs font-semibold text-np-dark">Ready to schedule the next meeting?</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 mb-3">Action items will carry forward to the next agenda</p>
                  <button onClick={() => setShowScheduleNext(true)}
                    className="px-4 py-2 bg-teal text-white text-xs font-semibold rounded-lg">
                    Schedule Next Meeting
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* IDS Panel */}
      {showIds && (
        <IdsPanel items={meeting?.ids_items || []} attendees={attendees}
          orgId={currentOrg?.id || ''} meetingTemplate={meeting?.template || 'level_10'}
          onSave={saveIdsItems} onClose={() => setShowIds(false)} />
      )}

      {/* Schedule Next Modal */}
      {showScheduleNext && meeting && (
        <ScheduleNextModal meeting={meeting} attendees={attendees}
          actionItems={(meeting.action_items || []).filter(a => !a.completed)}
          onSchedule={scheduleNextMeeting} onClose={() => setShowScheduleNext(false)} />
      )}
    </div>
  )
}
