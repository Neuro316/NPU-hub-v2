'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, IdsItem, IdsStatus } from '@/lib/types/meetings'
import {
  ChevronLeft, Clock, Save, Upload, Check, Loader2, Target,
  Play, Pause, SkipForward, Timer, Plus, X, Sparkles,
  AlertTriangle, CheckCircle2, MessageSquare, Trash2
} from 'lucide-react'

/* ═══════════════════════════════════
   SECTION TIMER
   Green → Yellow (<25%) → Red (over)
   ═══════════════════════════════════ */
function SectionTimer({ durationMin, isActive }: { durationMin: number; isActive: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const totalSec = durationMin * 60
  const remaining = totalSec - elapsed
  const pct = totalSec > 0 ? Math.max(0, remaining / totalSec) : 0

  useEffect(() => {
    setElapsed(0); setRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [durationMin, isActive])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(p => p + 1), 1000)
    } else if (intervalRef.current) clearInterval(intervalRef.current)
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
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
        style={{ background: bg, color }}>
        <Timer size={13} />
        <span className="font-mono tabular-nums">{fmt(remaining)}</span>
        <span className="text-[9px] font-semibold opacity-70 ml-1">{label}</span>
      </div>
      <button onClick={() => setRunning(!running)}
        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100" style={{ color }}>
        {running ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <button onClick={() => { setElapsed(0); setRunning(false) }}
        className="text-[10px] text-gray-400 hover:text-gray-600">Reset</button>
    </div>
  )
}

/* ═══════════════════════════════════
   SECTION POPUP on checkbox click
   ═══════════════════════════════════ */
function SectionPopup({ section, index, onClose, onSaveNotes, isIds, onOpenIds }: {
  section: AgendaSection; index: number; onClose: () => void
  onSaveNotes: (i: number, notes: string) => void; isIds: boolean; onOpenIds: () => void
}) {
  const [localNotes, setLocalNotes] = useState(section.notes || '')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
              <Check size={12} className="text-white" strokeWidth={3} />
            </div>
            <h3 className="text-sm font-bold text-np-dark">{section.section}</h3>
          </div>
          <div className="flex items-center gap-2">
            <BadgePill text={`${section.duration_min} min`} color="#9CA3AF" bgColor="#F3F4F6" />
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
          </div>
        </div>
        <textarea value={localNotes} onChange={e => setLocalNotes(e.target.value)}
          placeholder="Capture key points, decisions, outcomes..."
          rows={4} className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
        {isIds && (
          <button onClick={onOpenIds}
            className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 bg-fire/10 text-fire text-xs font-semibold rounded-lg hover:bg-fire/20 border border-fire/20">
            <MessageSquare size={13} /> Open IDS Capture Board
          </button>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { onSaveNotes(index, localNotes); onClose() }}
            className="px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg">Save & Close</button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════
   IDS CAPTURE PANEL
   ═══════════════════════════════════ */
function IdsPanel({ items, attendees, onSave, onClose }: {
  items: IdsItem[]; attendees: MeetingAttendee[]
  onSave: (items: IdsItem[]) => void; onClose: () => void
}) {
  const [localItems, setLocalItems] = useState<IdsItem[]>(items || [])
  const [newIssue, setNewIssue] = useState('')
  const [newOwner, setNewOwner] = useState('')

  const addIssue = () => {
    if (!newIssue.trim()) return
    const ownerAtt = attendees.find(a => a.user_id === newOwner)
    setLocalItems(prev => [...prev, {
      id: crypto.randomUUID(), issue: newIssue.trim(), owner: newOwner || '',
      owner_name: ownerAtt?.display_name || 'Unassigned', status: 'identified' as IdsStatus,
      resolution: '', created_at: new Date().toISOString(),
    }])
    setNewIssue(''); setNewOwner('')
  }

  const updateItem = (id: string, updates: Partial<IdsItem>) => {
    setLocalItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
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
      <div className="w-full max-w-2xl max-h-[85vh] bg-white rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
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

        <div className="px-5 py-3 bg-np-light border-b border-gray-100">
          <div className="flex gap-2">
            <input value={newIssue} onChange={e => setNewIssue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addIssue() }}
              placeholder="Type an issue to identify..."
              className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-fire/30" />
            <select value={newOwner} onChange={e => setNewOwner(e.target.value)}
              className="px-2 py-2 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">Owner</option>
              {attendees.map(a => <option key={a.user_id} value={a.user_id}>{a.display_name?.split(' ')[0]}</option>)}
            </select>
            <button onClick={addIssue} disabled={!newIssue.trim()}
              className="px-3 py-2 bg-fire text-white text-xs font-semibold rounded-lg disabled:opacity-50"><Plus size={13} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {localItems.length === 0 && (
            <div className="text-center py-12">
              <AlertTriangle size={28} className="mx-auto text-gray-200 mb-2" />
              <p className="text-xs text-gray-400">No issues identified yet.</p>
            </div>
          )}
          {localItems.map(item => {
            const sc = statusColors[item.status]
            return (
              <div key={item.id} className="border border-gray-100 rounded-lg mb-2 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => {
                    const flow: IdsStatus[] = ['identified', 'discussing', 'solved']
                    const idx = flow.indexOf(item.status)
                    if (idx < flow.length - 1) updateItem(item.id, { status: flow[idx + 1] })
                  }}
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 cursor-pointer"
                    style={{ background: sc.bg, color: sc.text }}>{sc.label}</button>
                  <span className={`text-xs flex-1 ${item.status === 'solved' ? 'line-through text-gray-400' : 'text-np-dark font-medium'}`}>
                    {item.issue}
                  </span>
                  {item.owner_name !== 'Unassigned' && (
                    <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{item.owner_name.split(' ')[0]}</span>
                  )}
                  <button onClick={() => setLocalItems(prev => prev.filter(i => i.id !== item.id))}
                    className="text-gray-300 hover:text-red-400"><Trash2 size={11} /></button>
                </div>
                {(item.status === 'discussing' || item.status === 'solved') && (
                  <div className="px-3 pb-2.5">
                    <input value={item.resolution} onChange={e => updateItem(item.id, { resolution: e.target.value })}
                      placeholder={item.status === 'discussing' ? 'Capture discussion...' : 'Resolution / decision...'}
                      className="w-full px-2 py-1.5 text-[11px] bg-np-light border border-gray-100 rounded-md focus:outline-none focus:ring-1 focus:ring-fire/20" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {solvedCount > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={13} className="text-green-600" />
              <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Solved</span>
            </div>
            {localItems.filter(i => i.status === 'solved').map(item => (
              <div key={item.id} className="text-[11px] text-green-800 py-0.5">
                <span className="font-semibold">✓ {item.issue}</span>
                {item.resolution && <span className="text-green-600 ml-1">— {item.resolution}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { onSave(localItems); onClose() }}
            className="px-4 py-1.5 bg-fire text-white text-xs font-semibold rounded-lg">Save IDS Items</button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════
   AGENDA BUILDER (manual)
   ═══════════════════════════════════ */
function AgendaBuilder({ existingAgenda, onSave, onClose }: {
  existingAgenda: AgendaSection[]; onSave: (a: AgendaSection[]) => void; onClose: () => void
}) {
  const [sections, setSections] = useState<AgendaSection[]>(
    existingAgenda.length > 0 ? [...existingAgenda] : [{ section: '', duration_min: 5, notes: '', completed: false }]
  )
  const totalMin = sections.reduce((s, x) => s + (x.duration_min || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-np-dark">Build Agenda</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-400">Total: {totalMin} min</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
          </div>
        </div>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {sections.map((s, i) => (
            <div key={i} className="flex items-center gap-2 bg-np-light rounded-lg p-2">
              <span className="text-[10px] font-bold text-gray-300 w-5 text-center">{i + 1}</span>
              <input value={s.section} onChange={e => setSections(p => p.map((x, idx) => idx === i ? { ...x, section: e.target.value } : x))}
                placeholder="Section name..."
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              <div className="flex items-center gap-1">
                <input type="number" value={s.duration_min}
                  onChange={e => setSections(p => p.map((x, idx) => idx === i ? { ...x, duration_min: parseInt(e.target.value) || 0 } : x))}
                  className="w-12 px-1.5 py-1.5 text-xs text-center border border-gray-200 rounded-md bg-white focus:outline-none" />
                <span className="text-[10px] text-gray-400">min</span>
              </div>
              <button onClick={() => setSections(p => p.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-400 p-1">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setSections(p => [...p, { section: '', duration_min: 5, notes: '', completed: false }])}
          className="w-full mt-2 py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30">
          + Add Section
        </button>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={() => { onSave(sections.filter(s => s.section.trim())); onClose() }}
            disabled={sections.filter(s => s.section.trim()).length === 0}
            className="px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg disabled:opacity-50">Save Agenda</button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════ */
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
  const [tab, setTab] = useState<'agenda' | 'notes' | 'ids_review' | 'read_ai'>('agenda')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})
  const [activeSectionIdx, setActiveSectionIdx] = useState<number | null>(null)
  const [sectionPopup, setSectionPopup] = useState<number | null>(null)
  const [showIds, setShowIds] = useState(false)
  const [showAgendaBuilder, setShowAgendaBuilder] = useState(false)
  const [generatingAgenda, setGeneratingAgenda] = useState(false)
  const [aiContext, setAiContext] = useState('')
  const [showAiPrompt, setShowAiPrompt] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) { setMeeting({ ...m, ids_items: m.ids_items || [] }); setNotes(m.notes || '') }
    const { data: att } = await supabase.from('meeting_attendees')
      .select('*, team_profiles:user_id(display_name)').eq('meeting_id', id)
    if (att) setAttendees(att.map((a: any) => ({ ...a, display_name: a.team_profiles?.display_name || 'Unknown' })))
    const { data: reviews } = await supabase.from('meeting_rock_reviews').select('*').eq('meeting_id', id)
    if (reviews) {
      const map: Record<string, string> = {}
      reviews.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' })
      setRockReviews(map)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const saveNotes = async () => {
    if (!meeting) return; setSaving(true)
    await supabase.from('meetings').update({ notes, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    setSaving(false)
  }

  const toggleAgendaItem = async (index: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    const wasCompleted = agenda[index].completed
    agenda[index] = { ...agenda[index], completed: !wasCompleted }
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    if (!wasCompleted) setSectionPopup(index)
  }

  const saveSectionNotes = async (index: number, newNotes: string) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[index] = { ...agenda[index], notes: newNotes }
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const updateMeetingStatus = async (status: string) => {
    if (!meeting) return
    setMeeting({ ...meeting, status: status as any })
    await supabase.from('meetings').update({ status, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    if (status === 'in_progress' && meeting.agenda?.length > 0) setActiveSectionIdx(0)
  }

  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return
    setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert({
      meeting_id: meeting.id, rock_id: rockId, status_at_review: status,
    }, { onConflict: 'meeting_id,rock_id' })
  }

  const saveIdsItems = async (items: IdsItem[]) => {
    if (!meeting) return
    setMeeting({ ...meeting, ids_items: items })
    await supabase.from('meetings').update({ ids_items: items, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const saveAgenda = async (agenda: AgendaSection[]) => {
    if (!meeting) return
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const generateAiAgenda = async () => {
    if (!meeting) return
    setGeneratingAgenda(true); setShowAiPrompt(false)
    try {
      const res = await fetch('/api/ai/agenda-generator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meeting.title, template: meeting.template,
          duration_minutes: meeting.duration_minutes,
          attendee_names: attendees.map(a => a.display_name), context: aiContext,
        }),
      })
      const data = await res.json()
      if (data.agenda) await saveAgenda(data.agenda)
    } catch (e) { console.error('AI agenda error:', e) }
    setGeneratingAgenda(false); setAiContext('')
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const attendeeAvatars = attendees.map(a => ({
    initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase(),
  }))
  const idsCount = (meeting.ids_items || []).length
  const idsSolvedCount = (meeting.ids_items || []).filter(i => i.status === 'solved').length
  const isIdsSection = (s: AgendaSection) => s.section.toLowerCase().includes('ids') || s.section.toLowerCase().includes('identify')

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <button onClick={() => router.push('/meetings')}
        className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark transition-colors">
        <ChevronLeft size={14} /> Back to Meetings
      </button>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* Header */}
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
              }) : 'No date set'} · {meeting.duration_minutes} min
            </span>
            {attendeeAvatars.length > 0 && <AvatarStack list={attendeeAvatars} />}
            <div className="ml-auto flex gap-1.5 items-center">
              {meeting.status === 'scheduled' && (
                <button onClick={() => updateMeetingStatus('in_progress')}
                  className="px-2.5 py-1 bg-teal text-white text-[10px] font-semibold rounded-md flex items-center gap-1">
                  <Play size={9} /> Start Meeting
                </button>
              )}
              {meeting.status === 'in_progress' && (
                <button onClick={() => updateMeetingStatus('completed')}
                  className="px-2.5 py-1 bg-green-500 text-white text-[10px] font-semibold rounded-md">Complete</button>
              )}
              <StatusDot status={meeting.status} />
              <span className="text-[10px] capitalize font-medium">{meeting.status.replace('_', ' ')}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {([
            { key: 'agenda' as const, label: 'Agenda' },
            { key: 'notes' as const, label: 'Notes' },
            { key: 'ids_review' as const, label: `IDS Review${idsCount > 0 ? ` (${idsSolvedCount}/${idsCount})` : ''}` },
            { key: 'read_ai' as const, label: 'Read AI' },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t.key ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent hover:text-np-dark'
              }`}>{t.label}</button>
          ))}
        </div>

        <div className="p-5 min-h-[200px]">
          {/* AGENDA TAB */}
          {tab === 'agenda' && (
            <div>
              {/* Toolbar: timer + buttons */}
              <div className="flex items-center gap-2 mb-4">
                {meeting.status === 'in_progress' && activeSectionIdx !== null && (
                  <SectionTimer durationMin={(meeting.agenda || [])[activeSectionIdx]?.duration_min || 5} isActive={true} />
                )}
                {meeting.status === 'in_progress' && activeSectionIdx !== null && (
                  <button onClick={() => {
                    const next = (activeSectionIdx || 0) + 1
                    if (next < (meeting.agenda || []).length) setActiveSectionIdx(next)
                  }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-teal hover:bg-teal/5 rounded-md ml-auto">
                    <SkipForward size={11} /> Next Section
                  </button>
                )}
                {meeting.status !== 'completed' && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button onClick={() => setShowAgendaBuilder(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-np-blue bg-np-blue/5 rounded-md border border-np-blue/20">
                      <Plus size={10} /> Manual
                    </button>
                    <button onClick={() => setShowAiPrompt(true)} disabled={generatingAgenda}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-violet bg-violet/5 rounded-md border border-violet/20 disabled:opacity-50">
                      {generatingAgenda ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI Generate
                    </button>
                  </div>
                )}
              </div>

              {/* AI context prompt */}
              {showAiPrompt && (
                <div className="mb-4 p-3 bg-violet/5 border border-violet/20 rounded-lg">
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-violet">Optional context</label>
                  <textarea value={aiContext} onChange={e => setAiContext(e.target.value)}
                    placeholder="e.g., Focus on Q1 revenue, discuss Charlotte location..." rows={2}
                    className="w-full mt-1 px-2 py-1.5 text-xs border border-violet/20 rounded-md bg-white focus:outline-none resize-none" />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => setShowAiPrompt(false)} className="text-[10px] text-gray-400">Cancel</button>
                    <button onClick={generateAiAgenda} className="px-3 py-1 bg-violet text-white text-[10px] font-semibold rounded-md">Generate</button>
                  </div>
                </div>
              )}

              {/* Agenda sections */}
              {(meeting.agenda || []).map((section, i) => {
                const isActive = activeSectionIdx === i && meeting.status === 'in_progress'
                const isIds = isIdsSection(section)
                return (
                  <div key={i} className={`flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0 transition-colors ${
                    isActive ? 'bg-teal/5 -mx-5 px-5 border-l-2 border-l-teal' : ''
                  }`}>
                    {meeting.status === 'in_progress' && (
                      <button onClick={() => setActiveSectionIdx(i)}
                        className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-teal' : 'bg-gray-200 hover:bg-teal/50'}`} />
                    )}
                    <button onClick={() => toggleAgendaItem(i)}
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
                    {isIds && <button onClick={() => setShowIds(true)} className="text-[10px] text-fire font-semibold hover:underline">IDS</button>}
                    <BadgePill text={`${section.duration_min} min`} color="#9CA3AF" bgColor="#F3F4F6" />
                  </div>
                )
              })}
              {(meeting.agenda || []).length === 0 && (
                <div className="text-center py-8">
                  <p className="text-xs text-gray-400 mb-3">No agenda items yet.</p>
                  <div className="flex justify-center gap-2">
                    <button onClick={() => setShowAgendaBuilder(true)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-np-blue bg-np-blue/5 rounded-lg border border-np-blue/20">
                      <Plus size={11} /> Build Manually
                    </button>
                    <button onClick={() => setShowAiPrompt(true)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-violet bg-violet/5 rounded-lg border border-violet/20">
                      <Sparkles size={11} /> AI Generate
                    </button>
                  </div>
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
                        className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none">
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

          {/* NOTES TAB */}
          {tab === 'notes' && (
            <div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveNotes}
                placeholder="Meeting notes... Auto-save on blur." rows={12}
                className="w-full p-4 bg-np-light border border-gray-100 rounded-xl text-xs text-np-dark leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              <div className="flex justify-end mt-2">
                <button onClick={saveNotes} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-np-blue hover:bg-np-blue/5 rounded-md">
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                  {saving ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}

          {/* IDS REVIEW TAB */}
          {tab === 'ids_review' && (
            <div>
              {idsCount === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare size={32} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm font-medium text-np-dark">No IDS items yet</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Open the IDS board during a meeting to capture issues.</p>
                  <button onClick={() => setShowIds(true)}
                    className="px-4 py-2 bg-fire text-white text-xs font-semibold rounded-lg">Open IDS Board</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-np-dark">{idsCount} Issues Tracked</span>
                    <button onClick={() => setShowIds(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-fire bg-fire/5 rounded-md border border-fire/20">
                      <MessageSquare size={10} /> Edit IDS
                    </button>
                  </div>
                  {(meeting.ids_items || []).map(item => {
                    const colors: Record<string, string> = { identified: '#D97706', discussing: '#2563EB', solved: '#059669', deferred: '#6B7280' }
                    return (
                      <div key={item.id} className="flex items-start gap-2 p-3 bg-np-light rounded-lg">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5"
                          style={{ background: (colors[item.status] || '#6B7280') + '15', color: colors[item.status] || '#6B7280' }}>
                          {item.status.toUpperCase()}
                        </span>
                        <div className="flex-1">
                          <span className={`text-xs font-medium ${item.status === 'solved' ? 'line-through text-gray-400' : 'text-np-dark'}`}>{item.issue}</span>
                          {item.resolution && <p className="text-[11px] text-gray-500 mt-0.5">→ {item.resolution}</p>}
                        </div>
                        {item.owner_name !== 'Unassigned' && <span className="text-[10px] text-gray-400">{item.owner_name.split(' ')[0]}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* READ AI TAB */}
          {tab === 'read_ai' && (
            <div>
              {meeting.read_ai_data ? (
                <div className="space-y-4">
                  {meeting.read_ai_data.summary && (
                    <div className="bg-white border-l-4 border-teal rounded-r-lg p-4">
                      <h4 className="text-[10px] font-bold text-teal uppercase tracking-wider mb-1">Summary</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{meeting.read_ai_data.summary}</p>
                    </div>
                  )}
                  {meeting.read_ai_data.action_items?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Action Items</h4>
                      {meeting.read_ai_data.action_items.map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-100/50">
                          <Check size={12} className="text-gray-300" />
                          <span className="text-[11px] text-np-dark flex-1">{item.description || item}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 border-2 border-dashed border-gray-200 rounded-xl text-center">
                  <Upload size={24} className="mx-auto text-gray-300 mb-2" />
                  <div className="text-xs font-medium text-np-dark">Drop Read AI export here</div>
                  <div className="text-[11px] text-gray-400 mt-1">JSON, TXT, CSV, or PDF</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Popups */}
      {sectionPopup !== null && meeting?.agenda?.[sectionPopup] && (
        <SectionPopup section={meeting.agenda[sectionPopup]} index={sectionPopup}
          onClose={() => setSectionPopup(null)} onSaveNotes={saveSectionNotes}
          isIds={isIdsSection(meeting.agenda[sectionPopup])}
          onOpenIds={() => { setSectionPopup(null); setShowIds(true) }} />
      )}
      {showIds && (
        <IdsPanel items={meeting?.ids_items || []} attendees={attendees}
          onSave={saveIdsItems} onClose={() => setShowIds(false)} />
      )}
      {showAgendaBuilder && (
        <AgendaBuilder existingAgenda={meeting?.agenda || []}
          onSave={saveAgenda} onClose={() => setShowAgendaBuilder(false)} />
      )}
    </div>
  )
}
