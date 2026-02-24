'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection } from '@/lib/types/meetings'
import {
  ChevronLeft, Clock, Save, Upload, Check, Loader2, Target,
  Trash2, AlertTriangle, Sparkles, FileText, Video, X,
  Brain, TrendingUp, AlertCircle, Users, Calendar
} from 'lucide-react'

export default function MeetingDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { currentOrg } = useWorkspace()
  const { rocks } = useRockData()
  const supabase = createClient()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'agenda' | 'notes' | 'read_ai' | 'ai_advisor'>('agenda')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Read AI upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // AI Advisor state
  const [aiIssue, setAiIssue] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<any>(null)
  const [aiError, setAiError] = useState('')
  const [aiMetrics, setAiMetrics] = useState<any>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)

    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) {
      setMeeting(m)
      setNotes(m.notes || '')
    }

    const { data: att } = await supabase
      .from('meeting_attendees')
      .select('*, team_profiles:user_id(display_name)')
      .eq('meeting_id', id)

    if (att) {
      setAttendees(att.map((a: any) => ({
        ...a,
        display_name: a.team_profiles?.display_name || 'Unknown',
      })))
    }

    const { data: reviews } = await supabase
      .from('meeting_rock_reviews')
      .select('*')
      .eq('meeting_id', id)

    if (reviews) {
      const map: Record<string, string> = {}
      reviews.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' })
      setRockReviews(map)
    }

    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const saveNotes = async () => {
    if (!meeting) return
    setSaving(true)
    await supabase.from('meetings').update({ notes, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    setSaving(false)
  }

  const toggleAgendaItem = async (index: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[index] = { ...agenda[index], completed: !agenda[index].completed }
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const updateMeetingStatus = async (status: string) => {
    if (!meeting) return
    setMeeting({ ...meeting, status: status as any })
    await supabase.from('meetings').update({ status, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return
    setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert({
      meeting_id: meeting.id, rock_id: rockId, status_at_review: status,
    }, { onConflict: 'meeting_id,rock_id' })
  }

  // ═══ DELETE — chain-aware ═══
  const handleDeleteMeeting = async () => {
    if (!meeting) return
    setIsDeleting(true)

    // Read chain pointers (these columns may not exist yet — that's OK, they'll be null)
    const prevId = (meeting as any).prev_meeting_id as string | null
    const nextId = (meeting as any).next_meeting_id as string | null
    const deferredItems = ((meeting as any).action_items || []).filter((a: any) => a.status === 'deferred')

    // Repair chain
    if (prevId && nextId) {
      await supabase.from('meetings').update({ next_meeting_id: nextId, updated_at: new Date().toISOString() }).eq('id', prevId)
      await supabase.from('meetings').update({ prev_meeting_id: prevId, updated_at: new Date().toISOString() }).eq('id', nextId)
    } else if (prevId) {
      await supabase.from('meetings').update({ next_meeting_id: null, updated_at: new Date().toISOString() }).eq('id', prevId)
    } else if (nextId) {
      await supabase.from('meetings').update({ prev_meeting_id: null, updated_at: new Date().toISOString() }).eq('id', nextId)
    }

    // Migrate deferred items
    if (nextId && deferredItems.length > 0) {
      const { data: nm } = await supabase.from('meetings').select('action_items').eq('id', nextId).single()
      if (nm) {
        const existing = ((nm as any).action_items || []) as any[]
        const existingIds = new Set(existing.map((a: any) => a.id))
        const newItems = deferredItems.filter((d: any) => !existingIds.has(d.id))
        if (newItems.length > 0) {
          await supabase.from('meetings').update({
            action_items: [...existing, ...newItems.map((d: any) => ({ ...d, status: 'pending' }))],
            updated_at: new Date().toISOString(),
          }).eq('id', nextId)
        }
      }
    }

    // Clean up and delete
    await supabase.from('meeting_attendees').delete().eq('meeting_id', meeting.id)
    await supabase.from('meeting_rock_reviews').delete().eq('meeting_id', meeting.id)
    await supabase.from('meetings').delete().eq('id', meeting.id)
    router.push('/meetings')
  }

  // ═══ READ AI UPLOAD ═══
  const handleReadAiUpload = async (file: File) => {
    setUploading(true)
    setUploadError('')

    try {
      const text = await file.text()
      let parsed: Record<string, any> = {}

      if (file.name.endsWith('.json')) {
        // Direct JSON parse
        const raw = JSON.parse(text)
        // Read AI JSON format has various structures — normalize
        parsed = {
          summary: raw.summary || raw.abstract || raw.overview || null,
          action_items: raw.action_items || raw.actionItems || raw.action_items_list || [],
          key_topics: raw.key_topics || raw.topics || raw.keyTopics || [],
          transcript: raw.transcript || raw.full_transcript || null,
          attendees: raw.attendees || raw.participants || [],
          decisions: raw.decisions || [],
          questions: raw.questions || raw.open_questions || [],
          video_url: raw.video_url || raw.videoUrl || raw.recording_url || null,
          source: 'read_ai',
          uploaded_at: new Date().toISOString(),
          original_filename: file.name,
        }
      } else {
        // Text/CSV/MD — parse as raw transcript
        // Try to extract sections if present
        const sections: Record<string, string> = {}
        let currentSection = 'transcript'
        const lines = text.split('\n')

        lines.forEach(line => {
          const trimmed = line.trim()
          // Common Read AI section headers
          if (/^(summary|action items|key topics|decisions|questions|transcript)/i.test(trimmed)) {
            currentSection = trimmed.toLowerCase().replace(/[^a-z_]/g, '_').replace(/_+/g, '_')
          } else if (trimmed) {
            if (!sections[currentSection]) sections[currentSection] = ''
            sections[currentSection] += trimmed + '\n'
          }
        })

        // Try to extract action items from bullet points
        const actionLines = (sections.action_items || '').split('\n').filter(l => l.trim())
        const actionItems = actionLines.map(l => ({
          description: l.replace(/^[-*\u2022]\s*/, '').trim(),
        }))

        parsed = {
          summary: sections.summary?.trim() || null,
          action_items: actionItems.length > 0 ? actionItems : [],
          transcript: sections.transcript?.trim() || text.trim(),
          source: 'read_ai_text',
          uploaded_at: new Date().toISOString(),
          original_filename: file.name,
        }
      }

      // Save to meeting
      if (meeting) {
        await supabase.from('meetings').update({
          read_ai_data: parsed,
          updated_at: new Date().toISOString(),
        }).eq('id', meeting.id)
        setMeeting({ ...meeting, read_ai_data: parsed })
      }
    } catch (e: any) {
      setUploadError(e.message || 'Failed to parse file')
    }
    setUploading(false)
  }

  // ═══ AI ADVISOR ═══
  const runAiAdvisor = async () => {
    if (!meeting || !currentOrg) return
    setAiLoading(true)
    setAiError('')
    setAiResult(null)

    try {
      const res = await fetch('/api/ai/meeting-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          meeting_id: meeting.id,
          issue_text: aiIssue || `Analyze this meeting: "${meeting.title}"`,
          meeting_notes: notes || meeting.notes || '',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      setAiResult(data.analysis)
      setAiMetrics(data.metrics)
    } catch (e: any) {
      setAiError(e.message || 'AI analysis failed')
    }
    setAiLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const attendeeAvatars = attendees.map(a => ({
    initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase(),
  }))

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <button onClick={() => router.push('/meetings')}
        className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark transition-colors">
        <ChevronLeft size={14} /> Back to Meetings
      </button>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* ═══ HEADER ═══ */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <BadgePill text={tmpl.label} color={tmpl.color} />
            <h2 className="text-base font-bold text-np-dark flex-1">{meeting.title}</h2>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              }) : 'No date set'} &middot; {meeting.duration_minutes} min
            </span>
            {attendeeAvatars.length > 0 && <AvatarStack list={attendeeAvatars} />}
            <div className="ml-auto flex items-center gap-1.5">
              {meeting.status === 'scheduled' && (
                <button onClick={() => updateMeetingStatus('in_progress')}
                  className="px-2.5 py-1 bg-teal text-white text-[10px] font-semibold rounded-md hover:bg-teal/90 transition-colors">
                  Start Meeting
                </button>
              )}
              {meeting.status === 'in_progress' && (
                <button onClick={() => updateMeetingStatus('completed')}
                  className="px-2.5 py-1 bg-green-500 text-white text-[10px] font-semibold rounded-md hover:bg-green-600 transition-colors">
                  Complete
                </button>
              )}
              <StatusDot status={meeting.status} />
              <span className="text-[10px] capitalize font-medium">{meeting.status.replace('_', ' ')}</span>
              {/* Delete button */}
              <button onClick={() => setShowDeleteConfirm(true)}
                className="ml-2 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                title="Delete meeting">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* ═══ TABS ═══ */}
        <div className="flex border-b border-gray-100 px-5">
          {([
            { key: 'agenda', label: 'Agenda' },
            { key: 'notes', label: 'Notes' },
            { key: 'read_ai', label: 'Read AI' },
            { key: 'ai_advisor', label: 'AI Advisor' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t.key ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent hover:text-np-dark'
              }`}>
              {t.key === 'ai_advisor' && <Sparkles size={10} />}
              {t.key === 'read_ai' && <Brain size={10} />}
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ TAB CONTENT ═══ */}
        <div className="p-5 min-h-[200px]">

          {/* ── AGENDA TAB ── */}
          {tab === 'agenda' && (
            <div className="space-y-0">
              {(meeting.agenda || []).map((section: AgendaSection, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
                  <button onClick={() => toggleAgendaItem(i)}
                    className={`w-[18px] h-[18px] rounded flex items-center justify-center border-2 transition-colors flex-shrink-0 ${
                      section.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-teal'
                    }`}>
                    {section.completed && <Check size={10} className="text-white" strokeWidth={3} />}
                  </button>
                  <span className={`text-xs font-medium flex-1 ${section.completed ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                    {section.section}
                  </span>
                  <BadgePill text={`${section.duration_min} min`} color="#9CA3AF" bgColor="#F3F4F6" />
                </div>
              ))}
              {(meeting.agenda || []).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">No agenda items. Choose a template with a built-in agenda.</p>
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
                        className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal/30">
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

          {/* ── NOTES TAB ── */}
          {tab === 'notes' && (
            <div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Click to add meeting notes... Auto-save on blur."
                onBlur={saveNotes}
                rows={12}
                className="w-full p-4 bg-np-light border border-gray-100 rounded-xl text-xs text-np-dark leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder:text-gray-400"
              />
              <div className="flex items-center justify-end mt-2">
                <button onClick={saveNotes}
                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-np-blue hover:bg-np-blue/5 rounded-md transition-colors">
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                  {saving ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}

          {/* ── READ AI TAB ── */}
          {tab === 'read_ai' && (
            <div className="space-y-4">
              {/* Hidden file input */}
              <input ref={fileInputRef} type="file" accept=".json,.txt,.csv,.md" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleReadAiUpload(e.target.files[0]) }} />

              {meeting.read_ai_data ? (
                <>
                  {/* Source info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={12} className="text-teal" />
                      <span className="text-[10px] font-semibold text-teal">
                        Read AI Data Loaded
                      </span>
                      {meeting.read_ai_data.original_filename && (
                        <span className="text-[9px] text-gray-400">({meeting.read_ai_data.original_filename})</span>
                      )}
                    </div>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
                      <Upload size={9} /> Replace
                    </button>
                  </div>

                  {/* Video link */}
                  {meeting.read_ai_data.video_url && (
                    <a href={meeting.read_ai_data.video_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 rounded-lg border border-violet-100 hover:bg-violet-100 transition-colors">
                      <Video size={14} className="text-violet-600" />
                      <span className="text-[11px] font-semibold text-violet-700">Watch Recording</span>
                    </a>
                  )}

                  {/* Summary */}
                  {meeting.read_ai_data.summary && (
                    <div className="bg-white border-l-4 border-teal rounded-r-lg p-4">
                      <h4 className="text-[10px] font-bold text-teal uppercase tracking-wider mb-1">Summary</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{meeting.read_ai_data.summary}</p>
                    </div>
                  )}

                  {/* Key Topics */}
                  {meeting.read_ai_data.key_topics?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Key Topics</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {meeting.read_ai_data.key_topics.map((topic: any, i: number) => (
                          <span key={i} className="px-2.5 py-1 bg-gray-50 text-[10px] font-medium text-np-dark rounded-lg border border-gray-100">
                            {typeof topic === 'string' ? topic : topic.topic || topic.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Items */}
                  {meeting.read_ai_data.action_items?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Action Items ({meeting.read_ai_data.action_items.length})
                      </h4>
                      {meeting.read_ai_data.action_items.map((item: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 py-2 border-b border-gray-100/50 last:border-0">
                          <Check size={12} className="text-gray-300 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <span className="text-[11px] text-np-dark">{item.description || item.text || item}</span>
                            {item.assignee && <span className="text-[9px] text-gray-400 ml-2">({item.assignee})</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Decisions */}
                  {meeting.read_ai_data.decisions?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Decisions</h4>
                      {meeting.read_ai_data.decisions.map((d: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 py-1.5">
                          <span className="text-[10px] text-amber-500 font-bold mt-0.5">&#8227;</span>
                          <span className="text-[11px] text-np-dark">{typeof d === 'string' ? d : d.description || d.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Transcript */}
                  {meeting.read_ai_data.transcript && (
                    <details className="group">
                      <summary className="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-np-dark">
                        Transcript
                      </summary>
                      <pre className="mt-2 p-4 bg-gray-50 rounded-lg text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                        {meeting.read_ai_data.transcript}
                      </pre>
                    </details>
                  )}

                  {/* Clear data */}
                  <button onClick={async () => {
                    await supabase.from('meetings').update({ read_ai_data: null, updated_at: new Date().toISOString() }).eq('id', meeting.id)
                    setMeeting({ ...meeting, read_ai_data: null })
                  }}
                    className="text-[9px] text-gray-300 hover:text-red-400 transition-colors">
                    Clear Read AI Data
                  </button>
                </>
              ) : (
                <div
                  className="py-10 border-2 border-dashed border-gray-200 rounded-xl text-center cursor-pointer hover:border-np-blue/30 hover:bg-np-blue/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-np-blue', 'bg-np-blue/5') }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-np-blue', 'bg-np-blue/5') }}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('border-np-blue', 'bg-np-blue/5')
                    if (e.dataTransfer.files[0]) handleReadAiUpload(e.dataTransfer.files[0])
                  }}>
                  {uploading ? (
                    <Loader2 size={24} className="mx-auto text-np-blue animate-spin mb-2" />
                  ) : (
                    <Upload size={24} className="mx-auto text-gray-300 mb-2" />
                  )}
                  <div className="text-xs font-medium text-np-dark">
                    {uploading ? 'Processing...' : 'Drop Read AI export here or click to upload'}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">JSON, TXT, CSV, or Markdown</div>
                  <p className="text-[9px] text-gray-300 mt-3">Export from Read AI dashboard and upload here to import summary, action items, and transcript</p>
                </div>
              )}

              {uploadError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 text-[10px] rounded-lg">
                  <AlertCircle size={12} /> {uploadError}
                </div>
              )}
            </div>
          )}

          {/* ── AI ADVISOR TAB ── */}
          {tab === 'ai_advisor' && (
            <div className="space-y-4">
              <div className="p-4 bg-violet-50/50 rounded-xl border border-violet-100">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={13} className="text-violet-600" />
                  <span className="text-[11px] font-bold text-violet-800">AI Operations Advisor</span>
                </div>
                <p className="text-[10px] text-violet-600 leading-relaxed">
                  Analyzes your entire platform: all tasks (completed, overdue, abandoned), rocks, team velocity,
                  meeting history, and contacts. Recommends realistic timelines based on actual completion data.
                </p>
              </div>

              {/* Issue input */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  Describe the issue, decision, or topic to analyze
                </label>
                <textarea
                  value={aiIssue}
                  onChange={e => setAiIssue(e.target.value)}
                  placeholder="e.g. We need to hire a marketing person. What's realistic given our current workload and past hiring attempts?"
                  rows={3}
                  className="w-full mt-1 p-3 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-200 placeholder:text-gray-300"
                />
              </div>

              <button onClick={runAiAdvisor} disabled={aiLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 text-white text-xs font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                {aiLoading ? 'Analyzing entire platform...' : 'Run AI Analysis'}
              </button>

              {/* Error */}
              {aiError && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 rounded-lg border border-red-100">
                  <AlertCircle size={12} className="text-red-500 shrink-0" />
                  <span className="text-[10px] text-red-600">{aiError}</span>
                  <button onClick={runAiAdvisor} className="ml-auto text-[10px] font-semibold text-red-500 hover:underline">Retry</button>
                </div>
              )}

              {/* Metrics summary */}
              {aiMetrics && (
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: 'Total Tasks', value: aiMetrics.total_tasks, icon: FileText },
                    { label: 'Completed', value: aiMetrics.completed, icon: Check },
                    { label: 'Overdue', value: aiMetrics.overdue, icon: AlertTriangle },
                    { label: 'Abandoned', value: aiMetrics.abandoned, icon: X },
                    { label: 'Avg Days', value: aiMetrics.avg_completion_days || '?', icon: Clock },
                  ].map((m, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <m.icon size={11} className="mx-auto text-gray-400 mb-1" />
                      <div className="text-sm font-bold text-np-dark">{m.value}</div>
                      <div className="text-[8px] text-gray-400 uppercase tracking-wider">{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Analysis Results */}
              {aiResult && (
                <div className="space-y-4">
                  {/* Summary */}
                  {aiResult.analysis && (
                    <div className="bg-white border-l-4 border-violet-500 rounded-r-lg p-4 space-y-2">
                      <h4 className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Strategic Assessment</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{aiResult.analysis.summary}</p>
                      {aiResult.analysis.historical_patterns && (
                        <div className="mt-2 p-2.5 bg-amber-50 rounded-lg">
                          <span className="text-[9px] font-bold text-amber-600 uppercase">Historical Pattern:</span>
                          <p className="text-[10px] text-amber-800 mt-0.5">{aiResult.analysis.historical_patterns}</p>
                        </div>
                      )}
                      {aiResult.analysis.related_existing_work?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[9px] font-bold text-gray-400 uppercase">Related Existing Work:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {aiResult.analysis.related_existing_work.map((w: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-medium rounded">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiResult.analysis.risk_factors?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[9px] font-bold text-red-400 uppercase">Risk Factors:</span>
                          {aiResult.analysis.risk_factors.map((r: string, i: number) => (
                            <p key={i} className="text-[10px] text-red-600 mt-0.5 flex items-start gap-1">
                              <AlertTriangle size={8} className="mt-0.5 shrink-0" /> {r}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recommended Actions */}
                  {aiResult.recommended_actions?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <TrendingUp size={10} /> Recommended Actions ({aiResult.recommended_actions.length})
                      </h4>
                      <div className="space-y-3">
                        {aiResult.recommended_actions.map((action: any, i: number) => {
                          const priColor = { low: '#9CA3AF', medium: '#3B82F6', high: '#F59E0B', urgent: '#EF4444' }[action.suggested_priority || 'medium'] || '#3B82F6'
                          return (
                            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
                              <div className="flex items-start gap-2">
                                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
                                  style={{ background: priColor }}>
                                  {i + 1}
                                </span>
                                <div className="flex-1">
                                  <div className="text-xs font-semibold text-np-dark">{action.title}</div>
                                  <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{action.description}</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Owner</div>
                                  <div className="text-[10px] font-semibold text-np-dark mt-0.5">{action.suggested_owner || 'TBD'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Due Date</div>
                                  <div className="text-[10px] font-semibold text-np-dark mt-0.5">{action.suggested_due_date || 'TBD'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Priority</div>
                                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: priColor }}>
                                    {(action.suggested_priority || 'medium').toUpperCase()}
                                  </div>
                                </div>
                              </div>

                              {/* Timeline reasoning */}
                              {action.timeline_reasoning && (
                                <div className="p-2.5 bg-blue-50/50 rounded-lg border border-blue-100">
                                  <div className="text-[8px] font-bold text-blue-500 uppercase">Timeline Reasoning</div>
                                  <p className="text-[10px] text-blue-700 mt-0.5">{action.timeline_reasoning}</p>
                                </div>
                              )}

                              {/* RACI */}
                              {action.raci && (
                                <div className="flex gap-3 mt-1">
                                  {Object.entries(action.raci).map(([role, name]) => name ? (
                                    <div key={role} className="text-[9px]">
                                      <span className="font-bold text-gray-400 uppercase">{role[0]}:</span>{' '}
                                      <span className="text-np-dark">{name as string}</span>
                                    </div>
                                  ) : null)}
                                </div>
                              )}

                              {/* Success criteria */}
                              {action.success_criteria && (
                                <p className="text-[9px] text-gray-400 italic mt-1">
                                  Done when: {action.success_criteria}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Accountability & Systemic */}
                  {aiResult.accountability_notes && (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Users size={10} className="text-amber-600" />
                        <span className="text-[9px] font-bold text-amber-600 uppercase">Team Accountability</span>
                      </div>
                      <p className="text-[10px] text-amber-800 leading-relaxed">{aiResult.accountability_notes}</p>
                    </div>
                  )}

                  {aiResult.systemic_recommendations && (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp size={10} className="text-green-600" />
                        <span className="text-[9px] font-bold text-green-600 uppercase">Systemic Recommendation</span>
                      </div>
                      <p className="text-[10px] text-green-800 leading-relaxed">{aiResult.systemic_recommendations}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Loading skeleton */}
              {aiLoading && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-20 bg-violet-50 rounded-xl" />
                  <div className="h-32 bg-gray-50 rounded-xl" />
                  <div className="h-32 bg-gray-50 rounded-xl" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ DELETE CONFIRMATION MODAL ═══ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-np-dark">Delete this meeting?</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 mb-4 space-y-1">
              <p className="text-[10px] text-gray-500">&#8226; The prev/next chain will be repaired automatically</p>
              <p className="text-[10px] text-gray-500">&#8226; Deferred action items will migrate to the next linked meeting</p>
              <p className="text-[10px] text-gray-500">&#8226; Approved tasks in Task Manager are not affected</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleDeleteMeeting} disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
                {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
