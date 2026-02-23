'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection } from '@/lib/types/meetings'
import {
  ChevronLeft, Clock, Save, Upload, Check, Loader2, Target
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
  const [tab, setTab] = useState<'agenda' | 'notes' | 'read_ai'>('agenda')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})

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

    // Load rock reviews
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
            {/* Status controls */}
            <div className="ml-auto flex gap-1.5">
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
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {(['agenda', 'notes', 'read_ai'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent hover:text-np-dark'
              }`}>
              {t === 'read_ai' ? 'Read AI' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
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

              {/* Rock Review Section (for L10 meetings) */}
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
            <div>
              {meeting.read_ai_data ? (
                <div className="space-y-4">
                  {/* Summary */}
                  {meeting.read_ai_data.summary && (
                    <div className="bg-white border-l-4 border-teal rounded-r-lg p-4">
                      <h4 className="text-[10px] font-bold text-teal uppercase tracking-wider mb-1">Summary</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{meeting.read_ai_data.summary}</p>
                    </div>
                  )}
                  {/* Action items */}
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
    </div>
  )
}
