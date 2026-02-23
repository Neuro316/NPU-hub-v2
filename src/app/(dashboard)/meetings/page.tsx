'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useMeetingData } from '@/lib/hooks/use-meeting-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingWithAttendees } from '@/lib/types/meetings'
import {
  Plus, Clock, ChevronRight, Calendar, X, Users, Loader2
} from 'lucide-react'

export default function MeetingsPage() {
  const { currentOrg } = useWorkspace()
  const { meetings, loading, addMeeting, deleteMeeting, fetchData } = useMeetingData()
  const { members } = useTeamData()
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '', template: 'custom' as MeetingTemplate,
    scheduled_at: '', duration_minutes: 60, attendee_ids: [] as string[],
  })
  const [creating, setCreating] = useState(false)

  // Group meetings by Today / Upcoming / Past
  const grouped = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 86400000)

    const today: MeetingWithAttendees[] = []
    const upcoming: MeetingWithAttendees[] = []
    const past: MeetingWithAttendees[] = []

    meetings.forEach(m => {
      const d = m.scheduled_at ? new Date(m.scheduled_at) : null
      if (!d) { upcoming.push(m); return }
      if (d >= todayStart && d < todayEnd) today.push(m)
      else if (d >= todayEnd) upcoming.push(m)
      else past.push(m)
    })

    // Sort: today/upcoming ascending, past descending
    today.sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    upcoming.sort((a, b) => new Date(a.scheduled_at || '').getTime() - new Date(b.scheduled_at || '').getTime())
    past.sort((a, b) => new Date(b.scheduled_at || '').getTime() - new Date(a.scheduled_at || '').getTime())

    return { today, upcoming, past }
  }, [meetings])

  const handleCreate = async () => {
    if (!createForm.title.trim()) return
    setCreating(true)
    try {
      const tmpl = MEETING_TEMPLATES[createForm.template]
      const meeting = await addMeeting({
        title: createForm.title.trim(),
        template: createForm.template,
        scheduled_at: createForm.scheduled_at || null,
        duration_minutes: createForm.duration_minutes || tmpl.defaultDuration,
        agenda: tmpl.defaultAgenda,
        status: 'scheduled',
      }, createForm.attendee_ids)

      if (meeting) {
        setShowCreate(false)
        setCreateForm({ title: '', template: 'custom', scheduled_at: '', duration_minutes: 60, attendee_ids: [] })
        router.push(`/meetings/${meeting.id}`)
      }
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return 'No time set'
    const d = new Date(iso)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const renderMeetingCard = (m: MeetingWithAttendees) => {
    const tmpl = MEETING_TEMPLATES[m.template as MeetingTemplate] || MEETING_TEMPLATES.custom
    const attendeeAvatars = m.attendees.map(a => ({
      initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase(),
    }))

    return (
      <div key={m.id} onClick={() => router.push(`/meetings/${m.id}`)}
        className="bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer flex items-center gap-3 mb-1.5 hover:border-gray-200 hover:shadow-sm transition-all">
        <BadgePill text={tmpl.label} color={tmpl.color} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-np-dark truncate">{m.title}</div>
          <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
            <Clock size={10} /> {formatTime(m.scheduled_at)} · {m.duration_minutes} min
          </div>
        </div>
        {attendeeAvatars.length > 0 && <AvatarStack list={attendeeAvatars} />}
        {m.status === 'completed' && <BadgePill text="Done" color="#16A34A" />}
        <ChevronRight size={13} className="text-gray-300" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-np-blue" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Meetings</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {currentOrg?.name} · {meetings.length} meeting{meetings.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors">
          <Plus size={13} /> Schedule Meeting
        </button>
      </div>

      {/* Grouped lists */}
      {grouped.today.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Today</div>
          {grouped.today.map(renderMeetingCard)}
        </div>
      )}

      {grouped.upcoming.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Upcoming</div>
          {grouped.upcoming.map(renderMeetingCard)}
        </div>
      )}

      {grouped.past.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Past</div>
          {grouped.past.slice(0, 10).map(renderMeetingCard)}
          {grouped.past.length > 10 && (
            <p className="text-[10px] text-gray-400 text-center py-2">
              + {grouped.past.length - 10} more past meetings
            </p>
          )}
        </div>
      )}

      {meetings.length === 0 && (
        <div className="text-center py-16">
          <Calendar size={40} className="mx-auto text-gray-200 mb-3" />
          <h2 className="text-sm font-semibold text-np-dark">No meetings yet</h2>
          <p className="text-xs text-gray-400 mt-1">Schedule your first meeting to get started.</p>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">Schedule Meeting</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Template selection */}
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Template</label>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {(Object.entries(MEETING_TEMPLATES) as [MeetingTemplate, typeof MEETING_TEMPLATES.custom][]).map(([key, tmpl]) => (
                    <button key={key} onClick={() => {
                      setCreateForm(p => ({ ...p, template: key, duration_minutes: tmpl.defaultDuration }))
                    }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors border"
                      style={{
                        background: createForm.template === key ? tmpl.color + '15' : 'transparent',
                        color: createForm.template === key ? tmpl.color : '#9CA3AF',
                        borderColor: createForm.template === key ? tmpl.color + '40' : '#F3F4F6',
                      }}>
                      {tmpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Meeting Title</label>
                <input value={createForm.title} onChange={e => setCreateForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Weekly L10 Meeting"
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Date & Time</label>
                  <input type="datetime-local" value={createForm.scheduled_at}
                    onChange={e => setCreateForm(p => ({ ...p, scheduled_at: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Duration (min)</label>
                  <input type="number" value={createForm.duration_minutes}
                    onChange={e => setCreateForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 60 }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
              </div>

              {/* Attendees */}
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                  Attendees ({createForm.attendee_ids.length})
                </label>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {members.filter(m => m.user_id).map(m => {
                    const uid = m.user_id as string
                    const selected = createForm.attendee_ids.includes(uid)
                    const initials = (m.display_name || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
                    return (
                      <button key={uid} onClick={() => {
                        setCreateForm(p => ({
                          ...p,
                          attendee_ids: selected
                            ? p.attendee_ids.filter(id => id !== uid)
                            : [...p.attendee_ids, uid]
                        }))
                      }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors border"
                        style={{
                          background: selected ? '#2A9D8F15' : 'transparent',
                          color: selected ? '#2A9D8F' : '#9CA3AF',
                          borderColor: selected ? '#2A9D8F40' : '#F3F4F6',
                        }}>
                        <Avatar initials={initials} size={16} />
                        {m.display_name?.split(' ')[0]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!createForm.title.trim() || creating}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors disabled:opacity-50">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
