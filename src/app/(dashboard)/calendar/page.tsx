'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  ChevronLeft, ChevronRight, Plus, Clock, X, Trash2, Loader2,
  Calendar as CalIcon, CheckSquare, Link2, ExternalLink,
  RefreshCw, LogIn, LogOut, Eye, EyeOff, Circle, CheckCircle2,
} from 'lucide-react'

const PLATFORM_ICONS: Record<string, { icon: string; color: string }> = {
  instagram: { icon: 'IG', color: '#E4405F' },
  facebook: { icon: 'FB', color: '#1877F2' },
  linkedin: { icon: 'LI', color: '#0A66C2' },
  tiktok: { icon: 'TT', color: '#000' },
  x: { icon: 'X', color: '#1DA1F2' },
  youtube: { icon: 'YT', color: '#FF0000' },
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CalendarEvent {
  id: string
  type: 'google_event' | 'google_task' | 'social_post' | 'hub_task'
  title: string
  start: string
  end?: string
  allDay?: boolean
  color: string
  meta?: any
}

export default function CalendarPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  // Google connection state
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Visibility toggles
  const [showGoogle, setShowGoogle] = useState(true)
  const [showTasks, setShowTasks] = useState(true)
  const [showSocial, setShowSocial] = useState(true)
  const [showHubTasks, setShowHubTasks] = useState(true)

  // New event creation
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newType, setNewType] = useState<'google_event' | 'google_task'>('google_event')
  const [saving, setSaving] = useState(false)

  // Check Google connection
  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch('/api/gcal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        })
        const data = await res.json()
        setGoogleConnected(data.connected)
      } catch { setGoogleConnected(false) }
    }
    checkGoogle()
  }, [])

  // Fetch all events for current month
  const fetchAllEvents = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const allEvents: CalendarEvent[] = []

    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0, 23, 59, 59)

    // 1. Social posts from Supabase
    try {
      const { data: posts } = await supabase
        .from('social_posts')
        .select('*')
        .eq('org_id', currentOrg.id)
        .gte('scheduled_at', firstDay.toISOString())
        .lte('scheduled_at', lastDay.toISOString())
        .order('scheduled_at')

      for (const p of (posts || [])) {
        const platforms = (p.platform_versions || []).map((v: any) => v.platform)
        allEvents.push({
          id: `sp-${p.id}`,
          type: 'social_post',
          title: p.content_original?.slice(0, 60) || 'Social Post',
          start: p.scheduled_at,
          color: platforms.length > 0 ? (PLATFORM_ICONS[platforms[0]]?.color || '#6b7280') : '#6b7280',
          meta: { ...p, platforms },
        })
      }
    } catch {}

    // 2. Hub tasks with due dates
    try {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('org_id', currentOrg.id)
        .not('due_date', 'is', null)
        .gte('due_date', firstDay.toISOString().split('T')[0])
        .lte('due_date', lastDay.toISOString().split('T')[0])

      for (const t of (tasks || [])) {
        allEvents.push({
          id: `ht-${t.id}`,
          type: 'hub_task',
          title: t.title,
          start: t.due_date,
          allDay: true,
          color: t.status === 'done' ? '#10B981' : t.priority === 'high' ? '#EF4444' : '#3B82F6',
          meta: t,
        })
      }
    } catch {}

    // 3. Google Calendar events
    if (googleConnected && showGoogle) {
      try {
        const res = await fetch('/api/gcal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'calendar_events',
            timeMin: firstDay.toISOString(),
            timeMax: lastDay.toISOString(),
          }),
        })
        const data = await res.json()
        for (const e of (data.events || [])) {
          allEvents.push({
            id: `gc-${e.id}`,
            type: 'google_event',
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
            color: e.calendarColor || '#4285f4',
            meta: e,
          })
        }
      } catch {}
    }

    // 4. Google Tasks
    if (googleConnected && showTasks) {
      try {
        const res = await fetch('/api/gcal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'task_lists' }),
        })
        const data = await res.json()
        for (const t of (data.tasks || [])) {
          if (!t.due) continue
          const dueDate = new Date(t.due)
          if (dueDate >= firstDay && dueDate <= lastDay) {
            allEvents.push({
              id: `gt-${t.id}`,
              type: 'google_task',
              title: t.title,
              start: t.due,
              allDay: true,
              color: t.status === 'completed' ? '#34a853' : '#fbbc05',
              meta: t,
            })
          }
        }
      } catch {}
    }

    setEvents(allEvents)
    setLoading(false)
  }, [currentOrg?.id, currentDate, googleConnected, showGoogle, showTasks])

  useEffect(() => { fetchAllEvents() }, [fetchAllEvents])

  // Google OAuth flow
  const handleGoogleConnect = async () => {
    setGoogleLoading(true)
    try {
      const redirectUri = `${window.location.origin}/api/gcal/callback`
      const res = await fetch('/api/gcal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth_url', redirect_uri: redirectUri }),
      })
      const data = await res.json()
      if (data.url) {
        // Open OAuth in popup
        const popup = window.open(data.url, 'google_auth', 'width=500,height=600')
        // Poll for completion
        const interval = setInterval(async () => {
          try {
            if (popup?.closed) {
              clearInterval(interval)
              const status = await fetch('/api/gcal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'status' }),
              })
              const s = await status.json()
              setGoogleConnected(s.connected)
              setGoogleLoading(false)
              if (s.connected) fetchAllEvents()
            }
          } catch { clearInterval(interval); setGoogleLoading(false) }
        }, 1000)
      }
    } catch { setGoogleLoading(false) }
  }

  const handleGoogleDisconnect = async () => {
    await fetch('/api/gcal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    })
    setGoogleConnected(false)
    fetchAllEvents()
  }

  // Create new event
  const handleCreate = async () => {
    if (!newTitle.trim() || !newDate) return
    setSaving(true)

    if (newType === 'google_event' && googleConnected) {
      const start = newTime ? `${newDate}T${newTime}:00` : newDate
      const end = newTime
        ? new Date(new Date(`${newDate}T${newTime}:00`).getTime() + 3600000).toISOString()
        : newDate
      await fetch('/api/gcal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_event',
          summary: newTitle,
          start, end,
          allDay: !newTime,
        }),
      })
    } else if (newType === 'google_task' && googleConnected) {
      await fetch('/api/gcal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: newTitle,
          due: newDate,
        }),
      })
    }

    setNewTitle('')
    setNewDate('')
    setNewTime('')
    setShowCreate(false)
    setSaving(false)
    fetchAllEvents()
  }

  // Complete a Google Task
  const handleCompleteTask = async (event: CalendarEvent) => {
    if (event.type !== 'google_task') return
    await fetch('/api/gcal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'complete_task',
        listId: event.meta.listId,
        taskId: event.meta.id,
      }),
    })
    fetchAllEvents()
  }

  // Calendar grid
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const startOffset = firstDayOfMonth.getDay()
  const totalDays = lastDayOfMonth.getDate()
  const today = new Date()

  const getEventsForDay = (day: number) => {
    const dayStart = new Date(year, month, day)
    const dayEnd = new Date(year, month, day, 23, 59, 59)
    return events.filter(e => {
      if (e.type === 'social_post' && !showSocial) return false
      if (e.type === 'hub_task' && !showHubTasks) return false
      if (e.type === 'google_event' && !showGoogle) return false
      if (e.type === 'google_task' && !showTasks) return false
      const eDate = new Date(e.start)
      return eDate >= dayStart && eDate <= dayEnd
    })
  }

  const TYPE_LABELS: Record<string, string> = {
    google_event: 'Calendar Event',
    google_task: 'Google Task',
    social_post: 'Social Post',
    hub_task: 'Hub Task',
  }

  const TYPE_ICONS: Record<string, any> = {
    google_event: CalIcon,
    google_task: CheckSquare,
    social_post: Circle,
    hub_task: CheckCircle2,
  }

  if (orgLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} - Unified Calendar</p>
        </div>
        <div className="flex items-center gap-2">
          {googleConnected ? (
            <button onClick={handleGoogleDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-700 bg-green-50 rounded-lg hover:bg-green-100">
              <CheckCircle2 className="w-3.5 h-3.5" /> Google Connected
            </button>
          ) : (
            <button onClick={handleGoogleConnect} disabled={googleLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
              {googleLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
              Connect Google
            </button>
          )}
          <button onClick={() => { setShowCreate(true); setNewDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New Event
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        {[
          { key: 'google', label: 'Calendar', color: '#4285f4', show: showGoogle, toggle: () => setShowGoogle(!showGoogle) },
          { key: 'tasks', label: 'Tasks', color: '#fbbc05', show: showTasks, toggle: () => setShowTasks(!showTasks) },
          { key: 'social', label: 'Social Posts', color: '#E4405F', show: showSocial, toggle: () => setShowSocial(!showSocial) },
          { key: 'hub', label: 'Hub Tasks', color: '#3B82F6', show: showHubTasks, toggle: () => setShowHubTasks(!showHubTasks) },
        ].map(f => (
          <button key={f.key} onClick={f.toggle}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all
              ${f.show ? 'opacity-100' : 'opacity-40'}`}
            style={{ backgroundColor: f.show ? `${f.color}15` : '#f3f4f6', color: f.show ? f.color : '#9ca3af' }}>
            {f.show ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {f.label}
          </button>
        ))}
        <button onClick={fetchAllEvents} className="ml-auto text-gray-400 hover:text-np-dark">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
          className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-base font-semibold text-np-dark">
          {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </h2>
        <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
          className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7">
          {DAYS.map(d => (
            <div key={d} className="px-2 py-2 text-center text-[10px] font-semibold text-gray-400 border-b border-gray-50">{d}</div>
          ))}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`e-${i}`} className="min-h-[100px] border-b border-r border-gray-50 bg-gray-50/30" />
          ))}
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1
            const dayEvents = getEventsForDay(day)
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
            const isSelected = selectedDay?.getDate() === day && selectedDay?.getMonth() === month

            return (
              <div key={day}
                onClick={() => setSelectedDay(new Date(year, month, day))}
                className={`min-h-[100px] border-b border-r border-gray-50 p-1 cursor-pointer hover:bg-np-blue/5 transition-colors
                  ${isSelected ? 'bg-np-blue/10 ring-1 ring-np-blue/30' : ''}`}>
                <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full
                  ${isToday ? 'bg-np-blue text-white' : 'text-gray-600'}`}>
                  {day}
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {dayEvents.slice(0, 3).map(e => (
                    <button key={e.id}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedEvent(e) }}
                      className="w-full text-left px-1.5 py-0.5 rounded text-[10px] truncate font-medium"
                      style={{ backgroundColor: `${e.color}20`, color: e.color }}>
                      {e.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[9px] text-gray-400 pl-1">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div className="mt-4 bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-np-dark">
              {selectedDay.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {getEventsForDay(selectedDay.getDate()).length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">No events this day</p>
            )}
            {getEventsForDay(selectedDay.getDate()).map(e => {
              const Icon = TYPE_ICONS[e.type]
              return (
                <div key={e.id}
                  className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedEvent(e)}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${e.color}20` }}>
                    <Icon className="w-4 h-4" style={{ color: e.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-np-dark truncate">{e.title}</p>
                    <p className="text-[10px] text-gray-400">{TYPE_LABELS[e.type]}
                      {!e.allDay && e.start && ` - ${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                  {e.type === 'google_task' && e.meta?.status !== 'completed' && (
                    <button onClick={(ev) => { ev.stopPropagation(); handleCompleteTask(e) }}
                      className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded hover:bg-green-100">
                      Complete
                    </button>
                  )}
                  {e.type === 'social_post' && e.meta?.platforms?.map((p: string) => (
                    <span key={p} className="w-5 h-5 rounded-full text-white text-[8px] flex items-center justify-center"
                      style={{ backgroundColor: PLATFORM_ICONS[p]?.color || '#666' }}>
                      {PLATFORM_ICONS[p]?.icon || '?'}
                    </span>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${selectedEvent.color}20` }}>
                  {(() => { const I = TYPE_ICONS[selectedEvent.type]; return <I className="w-5 h-5" style={{ color: selectedEvent.color }} /> })()}
                </div>
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase">{TYPE_LABELS[selectedEvent.type]}</p>
                  <h3 className="font-semibold text-np-dark">{selectedEvent.title}</h3>
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <Clock className="w-4 h-4" />
                {selectedEvent.allDay ? 'All day' : new Date(selectedEvent.start).toLocaleString()}
              </div>

              {selectedEvent.meta?.description && (
                <p className="text-gray-600 text-xs bg-gray-50 p-3 rounded-lg">{selectedEvent.meta.description}</p>
              )}

              {selectedEvent.meta?.location && (
                <p className="text-gray-500 text-xs">Location: {selectedEvent.meta.location}</p>
              )}

              {selectedEvent.meta?.notes && (
                <p className="text-gray-600 text-xs bg-gray-50 p-3 rounded-lg">{selectedEvent.meta.notes}</p>
              )}

              {selectedEvent.meta?.content_original && (
                <p className="text-gray-600 text-xs bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
                  {selectedEvent.meta.content_original}
                </p>
              )}

              {selectedEvent.meta?.htmlLink && (
                <a href={selectedEvent.meta.htmlLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-np-blue text-xs hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Open in Google Calendar
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create event modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-np-dark mb-4">New Event</h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button onClick={() => setNewType('google_event')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${newType === 'google_event' ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-gray-200 text-gray-500'}`}>
                  <CalIcon className="w-4 h-4 mx-auto mb-1" /> Calendar Event
                </button>
                <button onClick={() => setNewType('google_task')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${newType === 'google_task' ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-gray-200 text-gray-500'}`}>
                  <CheckSquare className="w-4 h-4 mx-auto mb-1" /> Google Task
                </button>
              </div>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Title" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" autoFocus />
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              {newType === 'google_event' && (
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              )}
              {!googleConnected && (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">
                  Connect Google Calendar above to create events and tasks.
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">Cancel</button>
                <button onClick={handleCreate} disabled={saving || !googleConnected || !newTitle.trim()}
                  className="flex-1 px-3 py-2 bg-np-blue text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
