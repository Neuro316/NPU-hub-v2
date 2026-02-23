'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  Bell, Phone, MessageCircle, Mail, UserPlus, CheckCircle2,
  Brain, Workflow, Activity, PhoneMissed, Shield, AlertTriangle, FileText
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

interface NotifEntry {
  id: string
  contact_id: string
  event_type: string
  event_data: Record<string, unknown> | null
  occurred_at: string
  contacts?: { first_name: string; last_name: string } | null
}

const ICON_MAP: Record<string, { icon: any; color: string }> = {
  contact_created: { icon: UserPlus, color: '#2A9D8F' },
  sms_sent: { icon: MessageCircle, color: '#22c55e' },
  sms_received: { icon: MessageCircle, color: '#16a34a' },
  email_sent: { icon: Mail, color: '#3b82f6' },
  call_outbound: { icon: Phone, color: '#228DC4' },
  call_completed: { icon: Phone, color: '#059669' },
  call_missed: { icon: PhoneMissed, color: '#ef4444' },
  task_created: { icon: CheckCircle2, color: '#f59e0b' },
  task_completed: { icon: CheckCircle2, color: '#22c55e' },
  sequence_enrolled: { icon: Workflow, color: '#6366f1' },
  sequence_step_sent: { icon: Workflow, color: '#8b5cf6' },
}

const LABEL_MAP: Record<string, string> = {
  contact_created: 'New contact',
  contact_merged: 'Contact merged',
  sms_sent: 'SMS sent',
  sms_received: 'SMS received',
  sms_opt_out: 'Opted out',
  email_sent: 'Email sent',
  email_delivered: 'Email delivered',
  call_outbound: 'Call placed',
  call_completed: 'Call completed',
  call_missed: 'Missed call',
  call_transcribed: 'Transcription ready',
  task_created: 'Task created',
  task_completed: 'Task completed',
  sequence_enrolled: 'Enrolled in sequence',
  sequence_step_sent: 'Sequence step sent',
  ai_tasks_extracted: 'AI tasks extracted',
}

function fmtTime(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NotificationBell() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<NotifEntry[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Load recent activity
  useEffect(() => {
    if (!currentOrg) return
    loadEntries()

    // Get last seen timestamp from localStorage
    const stored = localStorage.getItem(`notif_last_seen_${currentOrg.id}`)
    if (stored) setLastSeen(stored)
  }, [currentOrg?.id])

  const loadEntries = async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('activity_log')
      .select('id, contact_id, event_type, event_data, occurred_at, contacts(first_name, last_name)')
      .eq('org_id', currentOrg.id)
      .order('occurred_at', { ascending: false })
      .limit(20)

    if (data) {
      const mapped = data.map((d: any) => ({
        ...d,
        contacts: Array.isArray(d.contacts) ? d.contacts[0] || null : d.contacts,
      })) as NotifEntry[]
      setEntries(mapped)
      // Count unread
      const stored = localStorage.getItem(`notif_last_seen_${currentOrg.id}`)
      if (stored) {
        const count = data.filter(e => new Date(e.occurred_at) > new Date(stored)).length
        setUnreadCount(count)
      } else {
        setUnreadCount(data.length > 0 ? data.length : 0)
      }
    }
  }

  // Real-time subscription
  useEffect(() => {
    if (!currentOrg) return
    const channel = supabase
      .channel('notif-bell-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_log',
        filter: `org_id=eq.${currentOrg.id}`,
      }, (payload) => {
        const entry = payload.new as NotifEntry
        setEntries(prev => [entry, ...prev.slice(0, 19)])
        setUnreadCount(prev => prev + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentOrg?.id])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleOpen = () => {
    setOpen(!open)
    if (!open && currentOrg) {
      // Mark all as seen
      const now = new Date().toISOString()
      localStorage.setItem(`notif_last_seen_${currentOrg.id}`, now)
      setLastSeen(now)
      setUnreadCount(0)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={handleOpen}
        className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
        <Bell size={16} className={unreadCount > 0 ? 'text-np-blue' : 'text-gray-400'} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-bold text-np-dark">Notifications</h3>
            <Link href="/activity-log" onClick={() => setOpen(false)}
              className="text-[10px] text-np-blue hover:underline font-medium">View All</Link>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="text-center py-8">
                <Activity size={24} className="mx-auto text-gray-400/30 mb-2" />
                <p className="text-[10px] text-gray-400">No activity yet</p>
              </div>
            ) : (
              entries.map(entry => {
                const iconCfg = ICON_MAP[entry.event_type] || { icon: Activity, color: '#6b7280' }
                const Icon = iconCfg.icon
                const label = LABEL_MAP[entry.event_type] || entry.event_type.replace(/_/g, ' ')
                const name = entry.contacts ? `${entry.contacts.first_name} ${entry.contacts.last_name}` : null
                const isNew = lastSeen ? new Date(entry.occurred_at) > new Date(lastSeen) : true

                return (
                  <Link key={entry.id} href={`/crm/contacts?open=${entry.contact_id}`} onClick={() => setOpen(false)}
                    className={`flex items-start gap-2.5 px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${isNew ? 'bg-np-blue/3' : ''}`}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: iconCfg.color + '15' }}>
                      <Icon size={12} style={{ color: iconCfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-np-dark">{label}</p>
                      {name && <p className="text-[10px] text-gray-400 truncate">{name}</p>}
                    </div>
                    <span className="text-[9px] text-gray-400 flex-shrink-0 mt-0.5">{fmtTime(entry.occurred_at)}</span>
                  </Link>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-100">
            <Link href="/activity-log" onClick={() => setOpen(false)}
              className="block text-center text-[10px] text-gray-400 hover:text-np-blue transition-colors">
              See full activity log →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
