'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Plus, Clock, X, ArrowLeft, Trash2, Loader2,
  Target, Mic, Megaphone, ClipboardList, Brain, Filter, Users, Send,
  Wand2, Sparkles, CalendarDays, Eye, EyeOff, Mail, Check
} from 'lucide-react'

/* ═══ Event Types ═══ */
type EventCategory = 'social' | 'appearances' | 'marketing' | 'sessions' | 'assessments'

interface CalEvent {
  id: string
  category: EventCategory
  title: string
  subtitle?: string
  date: string          // YYYY-MM-DD
  time?: string         // HH:MM
  endTime?: string
  color: string
  assignee?: string     // team member name or id
  meta?: Record<string, any>
}

interface TeamMember {
  id: string; display_name: string; email: string; user_id: string
}

const CATEGORIES: { key: EventCategory; label: string; icon: any; color: string; bg: string; dot: string }[] = [
  { key: 'social', label: 'Social Media', icon: Target, color: 'text-pink-500', bg: 'bg-pink-50', dot: '#E4405F' },
  { key: 'appearances', label: 'Media Appearances', icon: Mic, color: 'text-purple-500', bg: 'bg-purple-50', dot: '#8B5CF6' },
  { key: 'marketing', label: 'Marketing', icon: Megaphone, color: 'text-blue-500', bg: 'bg-blue-50', dot: '#3B82F6' },
  { key: 'sessions', label: 'Client Sessions', icon: ClipboardList, color: 'text-green-500', bg: 'bg-green-50', dot: '#10B981' },
  { key: 'assessments', label: 'Assessments', icon: Brain, color: 'text-amber-500', bg: 'bg-amber-50', dot: '#F59E0B' },
]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const PLATFORMS: Record<string, { icon: string; color: string }> = {
  instagram: { icon: 'IG', color: '#E4405F' }, facebook: { icon: 'FB', color: '#1877F2' },
  linkedin: { icon: 'LI', color: '#0A66C2' }, tiktok: { icon: 'TT', color: '#000' },
  x: { icon: 'X', color: '#1DA1F2' }, youtube: { icon: 'YT', color: '#FF0000' },
}

export default function CalendarPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [team, setTeam] = useState<TeamMember[]>([])

  // Filters
  const [visibleCategories, setVisibleCategories] = useState<Set<EventCategory>>(new Set(CATEGORIES.map(c => c.key)))
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<Set<string>>(new Set()) // empty = show all
  const [showFilters, setShowFilters] = useState(false)

  // Active tab (highlights which category panel is open, but calendar always shows filtered combo)
  const [activeTab, setActiveTab] = useState<EventCategory | 'all'>('all')

  // Day detail
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  // AI Scheduler
  const [showAI, setShowAI] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiMessages, setAiMessages] = useState<{ role: string; text: string }[]>([])
  const [suggestedSlots, setSuggestedSlots] = useState<{ date: string; time: string; label: string }[]>([])
  const [slotEmailTo, setSlotEmailTo] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  /* ─── Load all event sources ─── */
  const loadEvents = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`

    const allEvents: CalEvent[] = []

    // 1. Social media posts
    const { data: posts } = await supabase.from('social_posts')
      .select('id, content_original, status, scheduled_at, platform_versions, custom_fields, brand')
      .eq('org_id', currentOrg.id)
      .not('scheduled_at', 'is', null)
    if (posts) {
      posts.forEach(p => {
        if (!p.scheduled_at) return
        const d = new Date(p.scheduled_at)
        const cf = p.custom_fields || {}
        const platforms = (p.platform_versions || []).map((v: any) => v.platform).join(', ')
        allEvents.push({
          id: `social-${p.id}`, category: 'social',
          title: cf.hook || p.content_original?.slice(0, 40) || 'Post',
          subtitle: platforms ? platforms.toUpperCase() : undefined,
          date: d.toISOString().slice(0, 10),
          time: d.toTimeString().slice(0, 5),
          color: '#E4405F',
          meta: { ...p, source: 'social_posts' },
        })
      })
    }

    // 2. Email campaigns (marketing)
    const { data: campaigns } = await supabase.from('email_campaigns')
      .select('id, name, status, scheduled_at, created_at')
      .eq('org_id', currentOrg.id)
    if (campaigns) {
      campaigns.forEach(c => {
        const dateStr = c.scheduled_at || c.created_at
        if (!dateStr) return
        const d = new Date(dateStr)
        allEvents.push({
          id: `mktg-${c.id}`, category: 'marketing',
          title: c.name || 'Campaign',
          subtitle: c.status,
          date: d.toISOString().slice(0, 10),
          time: d.toTimeString().slice(0, 5),
          color: '#3B82F6',
          meta: { ...c, source: 'email_campaigns' },
        })
      })
    }

    // 3. Session notes (client sessions)
    const { data: sessions } = await supabase.from('ehr_session_notes')
      .select('id, contact_id, session_date, session_time, tech_name, status, contacts!inner(first_name, last_name)')
      .eq('org_id', currentOrg.id)
    if (sessions) {
      sessions.forEach((s: any) => {
        const name = s.contacts ? `${s.contacts.first_name} ${s.contacts.last_name}` : 'Client'
        allEvents.push({
          id: `session-${s.id}`, category: 'sessions',
          title: name,
          subtitle: s.status === 'completed' ? 'Completed' : 'Scheduled',
          date: s.session_date,
          time: s.session_time?.slice(0, 5),
          color: '#10B981',
          assignee: s.tech_name,
          meta: { ...s, source: 'ehr_session_notes' },
        })
      })
    }

    // 4. Load team
    const { data: teamData } = await supabase.from('team_profiles')
      .select('id, display_name, email, user_id')
      .eq('org_id', currentOrg.id)
      .eq('is_active', true)
    if (teamData) setTeam(teamData)

    setEvents(allEvents)
    setLoading(false)
  }, [currentOrg?.id, year, month])

  useEffect(() => { loadEvents() }, [loadEvents])

  /* ─── Filtered events ─── */
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (!visibleCategories.has(e.category)) return false
      if (selectedTeamMembers.size > 0 && e.assignee && !selectedTeamMembers.has(e.assignee)) return false
      return true
    })
  }, [events, visibleCategories, selectedTeamMembers])

  /* ─── Calendar grid helpers ─── */
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  const calendarDays: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) calendarDays.push(null)
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i)

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return filteredEvents.filter(e => e.date === dateStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  }

  const toggleCategory = (key: EventCategory) => {
    setVisibleCategories(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleTeamMember = (name: string) => {
    setSelectedTeamMembers(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  /* ─── AI Scheduler ─── */
  const processAI = async () => {
    if (!aiInput.trim() || !currentOrg) return
    const msg = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', text: msg }])
    setAiProcessing(true)
    setSuggestedSlots([])
    setEmailSent(false)

    // Build busy times for context
    const busyTimes = events.map(e => `${e.date} ${e.time || 'all-day'}: ${e.title} (${e.category})`).join('\n')

    const systemPrompt = `You are a scheduling assistant for ${currentOrg.name}. Help find open time slots and suggest appointments.

CURRENT MONTH: ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
TODAY: ${today.toISOString().slice(0, 10)}

EXISTING EVENTS (busy times):
${busyTimes || 'No events scheduled yet.'}

TEAM MEMBERS: ${team.map(t => t.display_name).join(', ') || 'Not loaded'}

RULES:
- Business hours are 8am to 6pm, Monday through Friday
- Sessions are typically 60 minutes
- Leave 15 min buffer between appointments
- Suggest times that avoid existing events
- When asked for slots, always provide exactly the number requested (default 3)

RESPONSE FORMAT:
Provide a brief message, then always include slot suggestions as:
<slots>
[
  {"date": "YYYY-MM-DD", "time": "HH:MM", "label": "Day, Month Date at Time AM/PM"},
  ...
]
</slots>

Keep responses concise. No em dashes.`

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...aiMessages.map(m => ({ role: m.role === 'assistant' ? 'ai' : m.role, content: m.text })),
            { role: 'user', content: msg },
          ],
          campaignContext: { systemOverride: systemPrompt },
        }),
      })
      const data = await res.json()
      const aiText = data.content || ''
      setAiMessages(prev => [...prev, { role: 'assistant', text: aiText }])

      // Parse slots
      const slotsMatch = aiText.match(/<slots>([\s\S]*?)<\/slots>/)
      if (slotsMatch) {
        try {
          const parsed = JSON.parse(slotsMatch[1])
          setSuggestedSlots(parsed)
        } catch {}
      }
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', text: 'Error processing request. Please try again.' }])
    }
    setAiProcessing(false)
    setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  /* ─── Send slot email ─── */
  const sendSlotEmail = async () => {
    if (!slotEmailTo.trim() || suggestedSlots.length === 0) return
    setSendingEmail(true)
    const slotList = suggestedSlots.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
    const subject = `Available time slots from ${currentOrg?.name}`
    const body = `Hi,\n\nHere are some available time slots:\n\n${slotList}\n\nPlease reply with your preferred time or let us know if none of these work.\n\nBest,\n${user?.user_metadata?.full_name || currentOrg?.name}`

    // Use mailto as fallback (the email API requires a contact_id)
    const mailtoUrl = `mailto:${slotEmailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(mailtoUrl, '_blank')

    setSendingEmail(false)
    setEmailSent(true)
    setTimeout(() => setEmailSent(false), 3000)
  }

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : []

  return (
    <div className="flex gap-4 h-[calc(100vh-6rem)]">
      {/* ═══ MAIN CALENDAR ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold text-np-dark">Calendar</h1>
            <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {filteredEvents.length} events</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAI(!showAI)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors
                ${showAI ? 'bg-purple-500 text-white' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'}`}>
              <Wand2 className="w-3.5 h-3.5" /> AI Scheduler
            </button>
            <button onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors">
              <Filter className="w-3.5 h-3.5" /> Filters
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
          <button onClick={() => setActiveTab('all')}
            className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
              ${activeTab === 'all' ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
            <CalendarDays className="w-3 h-3 inline mr-1" /> All
          </button>
          {CATEGORIES.map(cat => {
            const Icon = cat.icon
            const count = events.filter(e => e.category === cat.key).length
            const visible = visibleCategories.has(cat.key)
            return (
              <button key={cat.key} onClick={() => { setActiveTab(cat.key); if (!visible) toggleCategory(cat.key) }}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                  ${activeTab === cat.key ? `${cat.bg} ${cat.color}` : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}
                  ${!visible ? 'opacity-40' : ''}`}>
                <Icon className="w-3 h-3" /> {cat.label}
                {count > 0 && <span className="text-[9px] bg-white/60 px-1 rounded">{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white border border-gray-100 rounded-xl p-4 mb-3 flex flex-wrap gap-4">
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Categories</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(cat => (
                  <button key={cat.key} onClick={() => toggleCategory(cat.key)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors
                      ${visibleCategories.has(cat.key) ? `${cat.bg} ${cat.color}` : 'bg-gray-50 text-gray-400 line-through'}`}>
                    {visibleCategories.has(cat.key) ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            {team.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Team Members</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setSelectedTeamMembers(new Set())}
                    className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors
                      ${selectedTeamMembers.size === 0 ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-50 text-gray-400'}`}>
                    All
                  </button>
                  {team.map(t => (
                    <button key={t.id} onClick={() => toggleTeamMember(t.display_name)}
                      className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors
                        ${selectedTeamMembers.has(t.display_name) ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-50 text-gray-400'}`}>
                      {t.display_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Month nav */}
        <div className="flex items-center justify-between mb-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
          <span className="text-sm font-bold text-np-dark">{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        </div>

        {/* Calendar grid */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden flex-1">
          <div className="grid grid-cols-7 h-full" style={{ gridTemplateRows: `auto repeat(${Math.ceil(calendarDays.length / 7)}, 1fr)` }}>
            {DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold text-gray-400 uppercase py-1.5 border-b border-gray-100">{d}</div>)}
            {calendarDays.map((day, i) => {
              const isToday = day && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
              const dayEvents = day ? getEventsForDay(day) : []
              const isSelected = day === selectedDay
              return (
                <div key={i}
                  onClick={() => day && setSelectedDay(day === selectedDay ? null : day)}
                  className={`border-b border-r border-gray-50 p-1 cursor-pointer transition-colors overflow-hidden
                    ${!day ? 'bg-gray-50/50 cursor-default' : 'hover:bg-blue-50/30'}
                    ${isSelected ? 'ring-2 ring-inset ring-np-blue/30 bg-blue-50/40' : ''}`}>
                  {day && (
                    <>
                      <span className={`text-[10px] font-bold inline-block w-5 h-5 rounded-full text-center leading-5
                        ${isToday ? 'bg-np-blue text-white' : 'text-gray-500'}`}>{day}</span>
                      <div className="space-y-px mt-0.5">
                        {dayEvents.slice(0, 3).map(ev => {
                          const cat = CATEGORIES.find(c => c.key === ev.category)
                          return (
                            <div key={ev.id} className="flex items-center gap-0.5 px-1 py-px rounded" style={{ backgroundColor: ev.color + '12' }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
                              <span className="text-[8px] text-gray-700 truncate">{ev.title}</span>
                            </div>
                          )
                        })}
                        {dayEvents.length > 3 && <div className="text-[7px] text-gray-400 text-center">+{dayEvents.length - 3}</div>}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL: Day Detail or AI ═══ */}
      <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden">
        {showAI ? (
          /* ─── AI Scheduler Panel ─── */
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-np-dark flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-purple-500" /> AI Scheduler
              </h3>
              <button onClick={() => setShowAI(false)} className="text-gray-400 hover:text-np-dark"><X className="w-3.5 h-3.5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {aiMessages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-[10px] text-gray-400 mb-1">Try asking:</p>
                  <p className="text-[10px] text-gray-300">"Find 3 open slots next week for a session"</p>
                  <p className="text-[10px] text-gray-300 mt-0.5">"What's available Tuesday afternoon?"</p>
                  <p className="text-[10px] text-gray-300 mt-0.5">"Suggest 5 assessment times this month"</p>
                </div>
              )}
              {aiMessages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'ml-6' : 'mr-2'}>
                  <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed
                    ${m.role === 'user' ? 'bg-np-blue text-white' : 'bg-gray-50 border border-gray-100 text-np-dark'}`}>
                    {m.text.replace(/<slots>[\s\S]*?<\/slots>/g, '').trim() || 'Found available slots.'}
                  </div>
                </div>
              ))}
              {aiProcessing && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />
                  <span className="text-[10px] text-gray-400">Finding open slots...</span>
                </div>
              )}
              <div ref={chatRef} />
            </div>

            {/* Suggested slots */}
            {suggestedSlots.length > 0 && (
              <div className="px-3 pb-2 space-y-1.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Suggested Slots</p>
                {suggestedSlots.map((slot, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                    <Clock className="w-3 h-3 text-green-600 flex-shrink-0" />
                    <span className="text-[11px] text-green-800 font-medium flex-1">{slot.label}</span>
                  </div>
                ))}
                {/* Email send */}
                <div className="flex gap-1.5 mt-2">
                  <input value={slotEmailTo} onChange={e => setSlotEmailTo(e.target.value)}
                    placeholder="Email to send slots..."
                    className="flex-1 px-2.5 py-1.5 text-[10px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200" />
                  <button onClick={sendSlotEmail} disabled={sendingEmail || !slotEmailTo.trim() || emailSent}
                    className={`px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-colors flex items-center gap-1
                      ${emailSent ? 'bg-green-500 text-white' : 'bg-purple-500 text-white hover:bg-purple-600'} disabled:opacity-50`}>
                    {emailSent ? <><Check className="w-3 h-3" /> Sent</> : sendingEmail ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Mail className="w-3 h-3" /> Send</>}
                  </button>
                </div>
              </div>
            )}

            <div className="p-3 border-t border-gray-50">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), processAI())}
                  placeholder="Ask about availability..."
                  disabled={aiProcessing}
                  className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:opacity-50" />
                <button onClick={processAI} disabled={aiProcessing || !aiInput.trim()}
                  className="px-2.5 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ─── Day Detail Panel ─── */
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <h3 className="text-xs font-bold text-np-dark">
                {selectedDay
                  ? new Date(year, month, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                  : 'Select a day'}
              </h3>
              {selectedDay && <p className="text-[9px] text-gray-400 mt-0.5">{selectedDayEvents.length} events</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {!selectedDay ? (
                <div className="text-center py-12">
                  <CalendarDays className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-xs text-gray-400">Click a day to see details</p>
                </div>
              ) : selectedDayEvents.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xs text-gray-400">No events on this day</p>
                  <button onClick={() => setShowAI(true)}
                    className="text-[10px] text-purple-500 font-medium mt-2 hover:underline">
                    Use AI to schedule something
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedDayEvents.map(ev => {
                    const cat = CATEGORIES.find(c => c.key === ev.category)
                    const Icon = cat?.icon || CalendarDays
                    return (
                      <div key={ev.id} className="border border-gray-100 rounded-xl p-3 hover:border-gray-200 transition-colors">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cat?.bg || 'bg-gray-50'}`}>
                            <Icon className={`w-4 h-4 ${cat?.color || 'text-gray-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-np-dark truncate">{ev.title}</p>
                            {ev.subtitle && <p className="text-[9px] text-gray-400">{ev.subtitle}</p>}
                            <div className="flex items-center gap-2 mt-1">
                              {ev.time && (
                                <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" /> {ev.time}
                                </span>
                              )}
                              {ev.assignee && (
                                <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                                  <Users className="w-2.5 h-2.5" /> {ev.assignee}
                                </span>
                              )}
                              <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded ${cat?.bg || 'bg-gray-50'} ${cat?.color || 'text-gray-500'}`}>
                                {cat?.label || ev.category}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="px-3 py-2 border-t border-gray-50">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <button key={cat.key} onClick={() => toggleCategory(cat.key)}
                    className={`flex items-center gap-1 text-[8px] font-medium transition-opacity ${visibleCategories.has(cat.key) ? 'opacity-100' : 'opacity-30'}`}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.dot }} />
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
