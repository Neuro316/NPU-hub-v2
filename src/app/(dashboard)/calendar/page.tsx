'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { Calendar, ChevronLeft, ChevronRight, Plus, Clock, Wand2 } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', icon: '📸', color: '#E4405F' },
  { key: 'facebook', icon: '📘', color: '#1877F2' },
  { key: 'linkedin', icon: '💼', color: '#0A66C2' },
  { key: 'tiktok', icon: '🎵', color: '#000' },
  { key: 'x', icon: '𝕏', color: '#1DA1F2' },
  { key: 'youtube', icon: '📺', color: '#FF0000' },
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
  const [showScheduler, setShowScheduler] = useState<ScheduledPost | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')

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
    const dt = new Date(`${dateStr}T${time}:00`)
    const { data } = await supabase.from('social_posts').update({ scheduled_at: dt.toISOString(), status: 'scheduled' }).eq('id', postId).select().single()
    if (data) setPosts(prev => prev.map(p => p.id === postId ? data : p))
    setShowScheduler(null)
  }

  const handleDrop = async (day: number) => {
    if (!dragPost) return
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    await schedulePost(dragPost, dateStr, '09:00')
    setDragPost(null)
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Content Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {posts.filter(p => p.status === 'scheduled').length} scheduled · {unscheduledPosts.length} unscheduled drafts</p>
        </div>
        <Link href="/social" className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> Create Post
        </Link>
      </div>

      {/* Month navigation */}
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
            return (
              <div key={i}
                className={`min-h-[90px] border-b border-r border-gray-50 p-1 ${day ? 'cursor-pointer hover:bg-blue-50/30' : 'bg-gray-50/50'}`}
                onDragOver={day ? e => e.preventDefault() : undefined}
                onDrop={day ? () => handleDrop(day) : undefined}>
                {day && (
                  <>
                    <span className={`text-[10px] font-bold inline-block w-5 h-5 rounded-full text-center leading-5 ${isToday ? 'bg-np-blue text-white' : 'text-gray-500'}`}>{day}</span>
                    <div className="space-y-0.5 mt-0.5">
                      {dayPosts.slice(0, 3).map(post => {
                        const platforms = post.platform_versions?.map((v: any) => v.platform) || []
                        const time = post.scheduled_at ? new Date(post.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                        return (
                          <div key={post.id} onClick={() => { setShowScheduler(post); setScheduleDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`); setScheduleTime(post.scheduled_at ? new Date(post.scheduled_at).toTimeString().slice(0, 5) : '09:00') }}
                            className="bg-blue-50 rounded px-1.5 py-0.5 cursor-pointer hover:bg-blue-100 transition-all">
                            <div className="flex items-center gap-1">
                              {platforms.slice(0, 2).map((p: string) => <span key={p} className="text-[8px]">{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                              <span className="text-[8px] text-gray-500 truncate flex-1">{post.content_original?.slice(0, 25)}...</span>
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

      {/* Unscheduled drafts sidebar */}
      {unscheduledPosts.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="text-xs font-bold text-np-dark mb-2">📌 Unscheduled Drafts (drag to calendar)</h3>
          <div className="flex flex-wrap gap-2">
            {unscheduledPosts.map(post => {
              const platforms = post.platform_versions?.map((v: any) => v.platform) || []
              return (
                <div key={post.id} draggable onDragStart={() => setDragPost(post.id)}
                  onClick={() => { setShowScheduler(post); setScheduleDate(new Date().toISOString().split('T')[0]); setScheduleTime('09:00') }}
                  className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 cursor-grab hover:shadow-sm transition-all max-w-xs">
                  <div className="flex items-center gap-1 mb-0.5">
                    {platforms.map((p: string) => <span key={p} className="text-xs">{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                    <span className="text-[8px] font-bold text-gray-400 uppercase">{post.brand === 'np' ? 'NP' : 'SEN'}</span>
                  </div>
                  <p className="text-[10px] text-gray-600 line-clamp-2">{post.content_original}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {showScheduler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowScheduler(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-sm font-bold text-np-dark mb-3">Schedule Post</h3>
            <p className="text-[10px] text-gray-500 mb-4 line-clamp-3">{showScheduler.content_original}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Date</label>
                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label>
                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => schedulePost(showScheduler.id, scheduleDate, scheduleTime)} className="btn-primary text-xs py-2 px-4">Schedule</button>
              <button onClick={() => setShowScheduler(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
