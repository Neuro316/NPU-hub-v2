'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMeetingData } from '@/lib/hooks/use-meeting-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { MeetingTemplate, MeetingWithAttendees, AgendaSection } from '@/lib/types/meetings'
import {
  Plus, Clock, ChevronRight, Calendar, X, Loader2, Sparkles, Mic, MicOff,
  ArrowRight, ArrowLeft, Check, Target, Zap, Users, FileText, Upload
} from 'lucide-react'

const TMPL_META: Record<MeetingTemplate, { icon: any; desc: string; tags: string[] }> = {
  level_10: { icon: Target, desc: 'EOS weekly leadership rhythm', tags: ['Segue','Scorecard','Rocks','IDS','Conclude'] },
  one_on_one: { icon: Users, desc: 'Manager-report check-in', tags: ['Check-in','Updates','Challenges','Actions'] },
  standup: { icon: Zap, desc: 'Quick daily sync', tags: ['Yesterday','Today','Blockers'] },
  quarterly: { icon: Calendar, desc: 'Strategic planning session', tags: ['Review','SWOT','Rocks','Team Health'] },
  custom: { icon: Sparkles, desc: 'Build from scratch or paste an agenda', tags: [] },
}

/* ─── Voice ─── */
function useVoice(cb: (t: string) => void) {
  const [on, setOn] = useState(false); const ref = useRef<any>(null)
  const toggle = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return
    if (on && ref.current) { ref.current.stop(); setOn(false); return }
    const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = 'en-US'
    r.onresult = (e: any) => { cb(e.results[0]?.[0]?.transcript || ''); setOn(false) }
    r.onerror = () => setOn(false); r.onend = () => setOn(false); ref.current = r; r.start(); setOn(true)
  }, [on, cb]); return { on, toggle }
}

/* ══════════════════════════════════════════════════════════
   SETUP WIZARD — 3 Steps
   1. Template  2. Details  3. Agenda (paste/upload/AI/manual)
   ══════════════════════════════════════════════════════════ */
function SetupWizard({ members, onDone, onClose }: {
  members: Array<{ user_id: string | null; display_name: string }>
  onDone: (d: { title: string; template: MeetingTemplate; scheduled_at: string; duration_minutes: number; attendee_ids: string[]; agenda: AgendaSection[] }) => void
  onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [tmpl, setTmpl] = useState<MeetingTemplate>('level_10')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(''); const [time, setTime] = useState('09:00')
  const [dur, setDur] = useState(90)
  const [attIds, setAttIds] = useState<string[]>([])
  const [agenda, setAgenda] = useState<AgendaSection[]>([])
  // AI paste/upload state
  const [pasteText, setPasteText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiError, setAiError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { on: vOn, toggle: vTog } = useVoice(t => setPasteText(p => p ? p + ' ' + t : t))

  const pickTemplate = (t: MeetingTemplate) => {
    setTmpl(t); const cfg = MEETING_TEMPLATES[t]; setDur(cfg.defaultDuration)
    setAgenda(cfg.defaultAgenda.map(s => ({ ...s })))
    if (!title) {
      const lbl: Record<string, string> = { level_10: 'Weekly L10', one_on_one: '1:1 Check-in', standup: 'Daily Standup', quarterly: 'Quarterly Planning', custom: 'Team Meeting' }
      setTitle(lbl[t] || 'Meeting')
    }
  }

  // AI parse pasted/uploaded text into structured sections
  const aiParseAgenda = async (text?: string) => {
    const raw = text || pasteText
    if (!raw.trim()) return
    setAiParsing(true); setAiError('')
    try {
      const res = await fetch('/api/ai/agenda-parser', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: raw, template: tmpl, duration_minutes: dur, title }),
      })
      if (!res.ok) throw new Error(`AI returned ${res.status}`)
      const data = await res.json()
      if (data.sections?.length) setAgenda(data.sections)
      else throw new Error('No sections returned')
    } catch (e: any) { setAiError(e.message || 'Failed to parse agenda') }
    setAiParsing(false)
  }

  // File upload handler (txt, pdf, docx — reads as text)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    setPasteText(text)
    aiParseAgenda(text)
  }

  const updateSec = (i: number, u: Partial<AgendaSection>) => setAgenda(p => p.map((s, j) => j === i ? { ...s, ...u } : s))
  const removeSec = (i: number) => setAgenda(p => p.filter((_, j) => j !== i))
  const addSec = () => setAgenda(p => [...p, { section: 'New Section', duration_min: 10, notes: '', completed: false, talking_points: [] }])

  const total = agenda.reduce((s, a) => s + a.duration_min, 0)
  const canProceed = step === 1 ? true : step === 2 ? title.trim() && date : agenda.length > 0

  const goNext = () => {
    if (step === 1) { if (agenda.length === 0) pickTemplate(tmpl); setStep(2) }
    else if (step === 2) setStep(3)
    else onDone({ title: title.trim(), template: tmpl, scheduled_at: new Date(`${date}T${time}:00`).toISOString(), duration_minutes: dur, attendee_ids: attIds, agenda })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        {/* Progress */}
        <div className="h-1 bg-gray-100"><div className="h-full bg-np-blue transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} /></div>

        <div className="px-6 pt-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-np-blue uppercase tracking-widest">Step {step} of 3</p>
            <h3 className="text-base font-bold text-np-dark mt-0.5">
              {step === 1 ? 'Choose a Template' : step === 2 ? 'Meeting Details' : 'Build Your Agenda'}
            </h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100"><X size={14} className="text-gray-400" /></button>
        </div>

        <div className="px-6 py-5 min-h-[340px] max-h-[70vh] overflow-y-auto">

          {/* ── STEP 1: Template ── */}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(MEETING_TEMPLATES) as [MeetingTemplate, typeof MEETING_TEMPLATES.custom][]).map(([key, cfg]) => {
                const meta = TMPL_META[key]; const Icon = meta.icon; const sel = tmpl === key
                return (
                  <button key={key} onClick={() => pickTemplate(key)}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${sel ? 'border-np-blue bg-np-blue/[0.03] shadow-sm' : 'border-gray-100 hover:border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: cfg.color + '15' }}>
                        <Icon size={16} style={{ color: cfg.color }} />
                      </div>
                      <div><div className="text-xs font-bold text-np-dark">{cfg.label}</div><div className="text-[10px] text-gray-400">{cfg.defaultDuration} min</div></div>
                      {sel && <div className="ml-auto w-5 h-5 rounded-full bg-np-blue flex items-center justify-center"><Check size={10} className="text-white" strokeWidth={3} /></div>}
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed">{meta.desc}</p>
                    {meta.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{meta.tags.map(t => <span key={t} className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400">{t}</span>)}</div>}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── STEP 2: Details ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div><label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Meeting Title</label>
                <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="What's this meeting about?"
                  className="w-full mt-1 px-4 py-3 text-sm border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:bg-white transition-all" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
                <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Time</label>
                  <input type="time" value={time} onChange={e => setTime(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
                <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Duration</label>
                  <div className="relative mt-1"><input type="number" value={dur} onChange={e => setDur(parseInt(e.target.value) || 60)}
                    className="w-full px-3 py-2.5 text-xs border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-np-blue/20 pr-10" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">min</span></div></div>
              </div>
              <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Attendees <span className="text-gray-300 normal-case">({attIds.length})</span></label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {members.filter(m => m.user_id).map(m => {
                    const uid = m.user_id as string; const sel = attIds.includes(uid)
                    const init = (m.display_name || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
                    return <button key={uid} onClick={() => setAttIds(p => sel ? p.filter(i => i !== uid) : [...p, uid])}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium border transition-all ${sel ? 'bg-np-blue/5 text-np-dark border-np-blue/30 shadow-sm' : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'}`}>
                      <Avatar initials={init} size={20} />{m.display_name?.split(' ')[0]}{sel && <Check size={10} className="text-np-blue" />}</button>
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Agenda Builder ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* AI Paste / Upload zone */}
              <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-violet-500" />
                  <span className="text-xs font-bold text-np-dark">AI Agenda Builder</span>
                  <span className="text-[10px] text-gray-400">— paste, dictate, or upload your agenda</span>
                </div>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder={"Paste your agenda, meeting notes, or talking points here...\n\nExample:\n1. Review Q1 numbers (15 min)\n2. Discuss hiring plan\n3. Product roadmap update\n4. Open discussion"}
                  rows={4} className="w-full px-3 py-2.5 text-xs border border-violet-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none placeholder-gray-400" />
                <div className="flex items-center gap-2">
                  <button onClick={() => aiParseAgenda()} disabled={aiParsing || !pasteText.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-violet-500 text-white text-[11px] font-semibold rounded-xl disabled:opacity-40 hover:bg-violet-600 transition-colors">
                    {aiParsing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Parse with AI
                  </button>
                  <button onClick={vTog}
                    className={`p-2 rounded-xl border transition-colors ${vOn ? 'bg-red-50 border-red-200 text-red-500 animate-pulse' : 'bg-white border-gray-200 text-gray-400 hover:text-violet-500'}`}>
                    {vOn ? <MicOff size={13} /> : <Mic size={13} />}
                  </button>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-3 py-2 bg-white border border-gray-200 text-gray-500 text-[11px] font-medium rounded-xl hover:bg-gray-50">
                    <Upload size={11} /> Upload File
                  </button>
                  <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.doc,.docx,.pdf" className="hidden" onChange={handleFileUpload} />
                  {vOn && <span className="text-[10px] text-red-500 animate-pulse">🎤 Listening...</span>}
                </div>
                {aiError && <p className="text-[10px] text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">{aiError}</p>}
              </div>

              {/* Section list */}
              {agenda.length > 0 && (
                <div className="space-y-1.5">
                  {agenda.map((s, i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-xl p-3 group">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-bold text-gray-400 bg-gray-50 border border-gray-100 shrink-0">{i + 1}</div>
                        <input value={s.section} onChange={e => updateSec(i, { section: e.target.value })}
                          className="flex-1 text-xs font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg transition-all" />
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => updateSec(i, { duration_min: Math.max(1, s.duration_min - 5) })}
                            className="w-5 h-5 rounded-md text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">−</button>
                          <span className="text-[11px] font-bold text-np-dark w-8 text-center tabular-nums">{s.duration_min}m</span>
                          <button onClick={() => updateSec(i, { duration_min: s.duration_min + 5 })}
                            className="w-5 h-5 rounded-md text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">+</button>
                        </div>
                        <button onClick={() => removeSec(i)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 p-1 transition-opacity"><X size={11} /></button>
                      </div>
                      {/* Talking points preview */}
                      {s.talking_points && s.talking_points.length > 0 && (
                        <div className="mt-2 ml-7 space-y-0.5">
                          {s.talking_points.map((tp, j) => (
                            <div key={j} className="text-[10px] text-gray-500 flex items-start gap-1.5">
                              <span className="text-gray-300 mt-px shrink-0">•</span>
                              <input value={tp} onChange={e => {
                                const pts = [...(s.talking_points || [])]; pts[j] = e.target.value
                                updateSec(i, { talking_points: pts })
                              }} className="flex-1 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button onClick={addSec} className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-np-blue"><Plus size={11} /> Add Section</button>
                <span className={`text-[10px] font-bold tabular-nums ${total > dur ? 'text-red-500' : total === dur ? 'text-green-500' : 'text-gray-400'}`}>
                  {total} / {dur} min {total > dur && '⚠ Over'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>{step > 1 && <button onClick={() => setStep(step - 1)} className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-np-dark"><ArrowLeft size={12} /> Back</button>}</div>
          <button onClick={goNext} disabled={!canProceed}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-np-blue text-white text-xs font-semibold rounded-xl hover:bg-np-dark disabled:opacity-40 transition-colors">
            {step < 3 ? <>Continue <ArrowRight size={12} /></> : <><Calendar size={12} /> Create Meeting</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   MEETINGS LIST PAGE
   ══════════════════════════════════════════════════════════ */
export default function MeetingsPage() {
  const { currentOrg } = useWorkspace()
  const { meetings, loading, addMeeting } = useMeetingData()
  const { members } = useTeamData()
  const router = useRouter()
  const [showWiz, setShowWiz] = useState(false)

  const grouped = useMemo(() => {
    const now = new Date(); const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const dayEnd = new Date(dayStart.getTime() + 86400000)
    const today: MeetingWithAttendees[] = []; const upcoming: MeetingWithAttendees[] = []; const past: MeetingWithAttendees[] = []
    meetings.forEach(m => {
      const d = m.scheduled_at ? new Date(m.scheduled_at) : null
      if (!d) { upcoming.push(m); return }
      if (d >= dayStart && d < dayEnd) today.push(m); else if (d >= dayEnd) upcoming.push(m); else past.push(m)
    })
    today.sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    upcoming.sort((a, b) => new Date(a.scheduled_at || '').getTime() - new Date(b.scheduled_at || '').getTime())
    past.sort((a, b) => new Date(b.scheduled_at || '').getTime() - new Date(a.scheduled_at || '').getTime())
    return { today, upcoming, past }
  }, [meetings])

  const handleDone = async (d: any) => {
    const m = await addMeeting({ title: d.title, template: d.template, scheduled_at: d.scheduled_at, duration_minutes: d.duration_minutes, agenda: d.agenda, status: 'scheduled' }, d.attendee_ids)
    setShowWiz(false); if (m) router.push(`/meetings/${m.id}`)
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No time set'

  const card = (m: MeetingWithAttendees) => {
    const cfg = MEETING_TEMPLATES[m.template as MeetingTemplate] || MEETING_TEMPLATES.custom
    const av = m.attendees.map(a => ({ initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() }))
    const live = m.status === 'in_progress'
    return (
      <div key={m.id} onClick={() => router.push(`/meetings/${m.id}`)}
        className={`bg-white rounded-xl px-4 py-3.5 cursor-pointer flex items-center gap-3 mb-2 border transition-all ${live ? 'border-green-200 shadow-sm shadow-green-100/50 hover:shadow-md' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'}`}>
        {live && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
        <BadgePill text={cfg.label} color={cfg.color} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-np-dark truncate">{m.title}</div>
          <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1.5"><Clock size={9} /> {fmt(m.scheduled_at)} · {m.duration_minutes}m
            {m.agenda?.length > 0 && <span>· {m.agenda.filter(s => s.completed).length}/{m.agenda.length}</span>}</div>
        </div>
        {av.length > 0 && <AvatarStack list={av} />}
        {m.status === 'completed' && <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Done</span>}
        <ChevronRight size={13} className="text-gray-300 shrink-0" />
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-bold text-np-dark">Meetings</h1><p className="text-[11px] text-gray-400 mt-0.5">{currentOrg?.name} · {meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</p></div>
        <button onClick={() => setShowWiz(true)} className="flex items-center gap-1.5 px-4 py-2.5 bg-np-blue text-white text-xs font-semibold rounded-xl hover:bg-np-dark transition-colors shadow-sm shadow-np-blue/20"><Plus size={13} /> New Meeting</button>
      </div>

      {grouped.today.length > 0 && <div><div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] font-bold text-np-dark uppercase tracking-wider">Today</span></div>{grouped.today.map(card)}</div>}
      {grouped.upcoming.length > 0 && <div><span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Upcoming</span><div className="mt-2">{grouped.upcoming.map(card)}</div></div>}
      {grouped.past.length > 0 && <div><span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Past</span><div className="mt-2">{grouped.past.slice(0, 10).map(card)}{grouped.past.length > 10 && <p className="text-[10px] text-gray-400 text-center py-2">+ {grouped.past.length - 10} more</p>}</div></div>}

      {meetings.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-np-blue/5 flex items-center justify-center mx-auto mb-4"><Calendar size={28} className="text-np-blue" /></div>
          <h2 className="text-sm font-bold text-np-dark">No meetings yet</h2>
          <p className="text-xs text-gray-400 mt-1 mb-5 max-w-xs mx-auto">Create your first meeting with the setup wizard — choose a template, paste your agenda, and AI structures it for you.</p>
          <button onClick={() => setShowWiz(true)} className="px-5 py-2.5 bg-np-blue text-white text-xs font-semibold rounded-xl">Get Started</button>
        </div>
      )}

      {showWiz && <SetupWizard members={members} onDone={handleDone} onClose={() => setShowWiz(false)} />}
    </div>
  )
}
