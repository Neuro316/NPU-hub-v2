'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plus, Clock, X, ArrowLeft, Trash2, Loader2 } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', icon: 'IG', color: '#E4405F' },
  { key: 'facebook', icon: 'FB', color: '#1877F2' },
  { key: 'linkedin', icon: 'LI', color: '#0A66C2' },
  { key: 'tiktok', icon: 'TT', color: '#000' },
  { key: 'x', icon: 'X', color: '#1DA1F2' },
  { key: 'youtube', icon: 'YT', color: '#FF0000' },
]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ScheduledPost {
  id: string
  content_original: string
  status: string
  scheduled_at: string | null
  platform_versions: any[]
  brand: string
  custom_fields: Record<string, any>
}

export default function CalendarPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [dragPost, setDragPost] = useState<string | null>(null)
  const [dragOverDay, setDragOverDay] = useState<number | null>(null)
  const [dragOverUnscheduled, setDragOverUnscheduled] = useState(false)
  const [showScheduler, setShowScheduler] = useState<ScheduledPost | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [saving, setSaving] = useState(false)

  const fetchPosts = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase.from('social_posts').select('id, content_original, status, scheduled_at, platform_versions, brand, custom_fields').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
    if (data) setPosts(data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  const calendarDays: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) calendarDays.push(null)
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i)

  const getPostsForDay = (day: number) => {
    return posts.filter(p => {
      if (!p.scheduled_at) return false
      const d = new Date(p.scheduled_at)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })
  }

  const unscheduledPosts = posts.filter(p => !p.scheduled_at && p.status === 'draft')

  const schedulePost = async (postId: string, dateStr: string, time: string) => {
    setSaving(true)
    const dt = new Date(`${dateStr}T${time}:00`)
    const { data } = await supabase.from('social_posts').update({ scheduled_at: dt.toISOString(), status: 'scheduled' }).eq('id', postId).select().single()
    if (data) setPosts(prev => prev.map(p => p.id === postId ? data : p))
    setShowScheduler(null)
    setSaving(false)
  }

  const unschedulePost = async (postId: string) => {
    setSaving(true)
    const { data } = await supabase.from('social_posts').update({ scheduled_at: null, status: 'draft' }).eq('id', postId).select().single()
    if (data) setPosts(prev => prev.map(p => p.id === postId ? data : p))
    setShowScheduler(null)
    setSaving(false)
  }

  const deletePost = async (postId: string) => {
    await supabase.from('social_posts').delete().eq('id', postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
    setShowScheduler(null)
  }

  const handleDrop = async (day: number) => {
    if (!dragPost) return
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const existing = posts.find(p => p.id === dragPost)
    const time = existing?.scheduled_at ? new Date(existing.scheduled_at).toTimeString().slice(0, 5) : '09:00'
    await schedulePost(dragPost, dateStr, time)
    setDragPost(null)
    setDragOverDay(null)
  }

  const handleDropUnscheduled = async () => {
    if (!dragPost) return
    await unschedulePost(dragPost)
    setDragPost(null)
    setDragOverUnscheduled(false)
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Content Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} | {posts.filter(p => p.status === 'scheduled').length} scheduled | {unscheduledPosts.length} drafts</p>
        </div>
        <Link href="/social" className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> Create Post
        </Link>
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
        <span className="text-sm font-bold text-np-dark">{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-4">
        <div className="grid grid-cols-7">
          {DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold text-gray-400 uppercase py-2 border-b border-gray-100">{d}</div>)}
          {calendarDays.map((day, i) => {
            const isToday = day && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
            const dayPosts = day ? getPostsForDay(day) : []
            const isDragOver = day === dragOverDay && dragPost
            return (
              <div key={i}
                className={`min-h-[90px] border-b border-r border-gray-50 p-1 transition-colors ${day ? '' : 'bg-gray-50/50'} ${isDragOver ? 'bg-blue-50 ring-2 ring-inset ring-np-blue/30' : day ? 'hover:bg-blue-50/20' : ''}`}
                onDragOver={day ? e => { e.preventDefault(); setDragOverDay(day) } : undefined}
                onDragLeave={() => setDragOverDay(null)}
                onDrop={day ? e => { e.preventDefault(); handleDrop(day); setDragOverDay(null) } : undefined}>
                {day && (
                  <>
                    <span className={`text-[10px] font-bold inline-block w-5 h-5 rounded-full text-center leading-5 ${isToday ? 'bg-np-blue text-white' : 'text-gray-500'}`}>{day}</span>
                    <div className="space-y-0.5 mt-0.5">
                      {dayPosts.slice(0, 3).map(post => {
                        const platforms = post.platform_versions?.map((v: any) => v.platform) || []
                        const time = post.scheduled_at ? new Date(post.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                        const cf = post.custom_fields || {}
                        return (
                          <div key={post.id}
                            draggable
                            onDragStart={e => { setDragPost(post.id); e.dataTransfer.effectAllowed = 'move' }}
                            onDragEnd={() => { setDragPost(null); setDragOverDay(null); setDragOverUnscheduled(false) }}
                            onClick={() => { setShowScheduler(post); setScheduleDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`); setScheduleTime(post.scheduled_at ? new Date(post.scheduled_at).toTimeString().slice(0, 5) : '09:00') }}
                            className={`rounded px-1.5 py-0.5 cursor-grab hover:shadow-sm transition-all active:cursor-grabbing ${dragPost === post.id ? 'opacity-40' : ''}`}
                            style={{ backgroundColor: cf.formatType === 'reel' ? '#FEF2F2' : cf.formatType === 'carousel' ? '#F0FDF4' : '#EFF6FF' }}>
                            <div className="flex items-center gap-0.5">
                              {cf.formatType && <span className="text-[6px] font-bold uppercase px-0.5 rounded" style={{ backgroundColor: cf.formatType === 'reel' ? '#EF4444' : cf.formatType === 'carousel' ? '#10B981' : '#3B82F6', color: '#fff' }}>{cf.formatType[0]}</span>}
                              {platforms.slice(0, 2).map((p: string) => <span key={p} className="text-[7px] font-bold" style={{ color: PLATFORMS.find(pl => pl.key === p)?.color }}>{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                              <span className="text-[8px] text-gray-600 truncate flex-1">{cf.hook || post.content_original?.slice(0, 18)}</span>
                            </div>
                            {time && <div className="text-[7px] text-np-blue font-bold">{time}</div>}
                          </div>
                        )
                      })}
                      {dayPosts.length > 3 && <div className="text-[8px] text-gray-400 text-center">+{dayPosts.length - 3} more</div>}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Unscheduled drafts - drop zone */}
      <div className={`bg-white border-2 rounded-xl p-4 transition-all ${dragOverUnscheduled && dragPost ? 'border-orange-400 bg-orange-50' : 'border-gray-100'}`}
        onDragOver={e => { e.preventDefault(); setDragOverUnscheduled(true) }}
        onDragLeave={() => setDragOverUnscheduled(false)}
        onDrop={e => { e.preventDefault(); handleDropUnscheduled() }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-np-dark">Unscheduled Drafts</h3>
          <span className="text-[9px] text-gray-400">Drag to calendar to schedule | Drag here to unschedule</span>
        </div>
        {unscheduledPosts.length === 0 && !dragPost ? (
          <p className="text-[10px] text-gray-400 py-2">No unscheduled drafts. Create posts in the Social Designer.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unscheduledPosts.map(post => {
              const platforms = post.platform_versions?.map((v: any) => v.platform) || []
              const cf = post.custom_fields || {}
              return (
                <div key={post.id}
                  draggable
                  onDragStart={e => { setDragPost(post.id); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { setDragPost(null); setDragOverDay(null); setDragOverUnscheduled(false) }}
                  onClick={() => { setShowScheduler(post); setScheduleDate(new Date().toISOString().split('T')[0]); setScheduleTime('09:00') }}
                  className={`bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 cursor-grab hover:shadow-sm transition-all max-w-xs active:cursor-grabbing ${dragPost === post.id ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    {cf.formatType && <span className="text-[7px] font-bold uppercase px-1 py-0.5 rounded text-white" style={{ backgroundColor: cf.formatType === 'reel' ? '#EF4444' : cf.formatType === 'carousel' ? '#10B981' : '#3B82F6' }}>{cf.formatType}</span>}
                    {platforms.map((p: string) => <span key={p} className="text-[9px] font-bold" style={{ color: PLATFORMS.find(pl => pl.key === p)?.color }}>{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                    <span className="text-[8px] font-bold text-gray-400 uppercase">{post.brand === 'np' ? 'NP' : 'SEN'}</span>
                  </div>
                  <p className="text-[10px] text-gray-600 line-clamp-2">{cf.hook || post.content_original}</p>
                </div>
              )
            })}
            {dragPost && dragOverUnscheduled && (
              <div className="flex items-center gap-2 border-2 border-dashed border-orange-300 rounded-lg px-4 py-3 bg-orange-50">
                <ArrowLeft className="w-4 h-4 text-orange-500" />
                <span className="text-[10px] text-orange-600 font-medium">Drop to unschedule</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Schedule / Reschedule modal */}
      {showScheduler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowScheduler(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-np-dark">{showScheduler.scheduled_at ? 'Reschedule Post' : 'Schedule Post'}</h3>
              <button onClick={() => setShowScheduler(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-1.5 mb-1">
                {showScheduler.custom_fields?.formatType && (
                  <span className="text-[7px] font-bold uppercase px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: showScheduler.custom_fields.formatType === 'reel' ? '#EF4444' : showScheduler.custom_fields.formatType === 'carousel' ? '#10B981' : '#3B82F6' }}>{showScheduler.custom_fields.formatType}</span>
                )}
                {showScheduler.platform_versions?.map((v: any) => (
                  <span key={v.platform} className="text-[9px] font-bold" style={{ color: PLATFORMS.find(pl => pl.key === v.platform)?.color }}>{PLATFORMS.find(pl => pl.key === v.platform)?.icon}</span>
                ))}
                <span className="text-[8px] text-gray-400 uppercase font-bold">{showScheduler.brand === 'np' ? 'NP' : 'SEN'}</span>
              </div>
              {showScheduler.custom_fields?.hook && <p className="text-[11px] font-bold text-np-dark mb-0.5">{showScheduler.custom_fields.hook}</p>}
              <p className="text-[10px] text-gray-600 line-clamp-3">{showScheduler.content_original}</p>
              {showScheduler.scheduled_at && <p className="text-[9px] text-blue-500 font-medium mt-1.5">Currently: {new Date(showScheduler.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Date</label><input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label><input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => schedulePost(showScheduler.id, scheduleDate, scheduleTime)} disabled={saving} className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />} {showScheduler.scheduled_at ? 'Reschedule' : 'Schedule'}
              </button>
              {showScheduler.scheduled_at && (
                <button onClick={() => unschedulePost(showScheduler.id)} disabled={saving} className="text-xs py-2 px-4 bg-orange-50 text-orange-600 rounded-lg font-medium border border-orange-200 hover:bg-orange-100 flex items-center gap-1.5 disabled:opacity-50">
                  <ArrowLeft className="w-3 h-3" /> Unschedule
                </button>
              )}
              <button onClick={() => setShowScheduler(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
              <button onClick={() => deletePost(showScheduler.id)} className="text-xs py-2 px-4 text-red-500 hover:bg-red-50 rounded-lg ml-auto flex items-center gap-1"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
