'use client'

// ═══════════════════════════════════════════════════════════════
// Activity Log — Org-wide timeline of all CRM/EHR activity
// Route: /activity-log
// Queries: activity_log with contact join
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Activity, Phone, MessageCircle, Mail, UserPlus, CheckCircle2,
  Brain, Workflow, FileText, Shield, AlertTriangle, Search,
  Filter, RefreshCw, ChevronDown, PhoneMissed, ArrowUpRight
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

interface ActivityEntry {
  id: string
  contact_id: string
  org_id: string
  event_type: string
  event_data: Record<string, unknown> | null
  ref_table: string | null
  ref_id: string | null
  actor_id: string | null
  occurred_at: string
  contacts?: { first_name: string; last_name: string } | null
}

const EVENT_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  contact_created: { icon: UserPlus, color: '#2A9D8F', bg: '#2A9D8F15', label: 'Contact Created' },
  contact_merged: { icon: UserPlus, color: '#6366f1', bg: '#6366f115', label: 'Contact Merged' },
  sms_sent: { icon: MessageCircle, color: '#22c55e', bg: '#22c55e15', label: 'SMS Sent' },
  sms_received: { icon: MessageCircle, color: '#16a34a', bg: '#16a34a15', label: 'SMS Received' },
  sms_opt_out: { icon: Shield, color: '#ef4444', bg: '#ef444415', label: 'SMS Opt-Out' },
  sms_opt_in: { icon: Shield, color: '#22c55e', bg: '#22c55e15', label: 'SMS Opt-In' },
  email_sent: { icon: Mail, color: '#3b82f6', bg: '#3b82f615', label: 'Email Sent' },
  email_delivered: { icon: Mail, color: '#2563eb', bg: '#2563eb15', label: 'Email Delivered' },
  email_opened: { icon: Mail, color: '#8b5cf6', bg: '#8b5cf615', label: 'Email Opened' },
  email_clicked: { icon: Mail, color: '#a855f7', bg: '#a855f715', label: 'Email Clicked' },
  email_bounced: { icon: AlertTriangle, color: '#ef4444', bg: '#ef444415', label: 'Email Bounced' },
  call_outbound: { icon: Phone, color: '#228DC4', bg: '#228DC415', label: 'Call Placed' },
  call_completed: { icon: Phone, color: '#059669', bg: '#05966915', label: 'Call Completed' },
  call_missed: { icon: PhoneMissed, color: '#ef4444', bg: '#ef444415', label: 'Call Missed' },
  call_transcribed: { icon: Brain, color: '#8b5cf6', bg: '#8b5cf615', label: 'Call Transcribed' },
  task_created: { icon: CheckCircle2, color: '#f59e0b', bg: '#f59e0b15', label: 'Task Created' },
  task_completed: { icon: CheckCircle2, color: '#22c55e', bg: '#22c55e15', label: 'Task Completed' },
  sequence_enrolled: { icon: Workflow, color: '#6366f1', bg: '#6366f115', label: 'Sequence Enrolled' },
  sequence_step_sent: { icon: Workflow, color: '#8b5cf6', bg: '#8b5cf615', label: 'Sequence Step Sent' },
  mastermind_enrolled: { icon: Brain, color: '#059669', bg: '#05966915', label: 'Mastermind Enrolled' },
  enrollment: { icon: Brain, color: '#3b82f6', bg: '#3b82f615', label: 'Enrollment' },
  ai_tasks_extracted: { icon: Brain, color: '#a855f7', bg: '#a855f715', label: 'AI Tasks Extracted' },
  form_submitted: { icon: FileText, color: '#f97316', bg: '#f9731615', label: 'Form Submitted' },
}

const DEFAULT_CONFIG = { icon: Activity, color: '#6b7280', bg: '#6b728015', label: 'Event' }

const FILTER_GROUPS = [
  { label: 'All', value: '' },
  { label: 'Calls', value: 'call' },
  { label: 'SMS', value: 'sms' },
  { label: 'Email', value: 'email' },
  { label: 'Tasks', value: 'task' },
  { label: 'Sequences', value: 'sequence' },
  { label: 'Contacts', value: 'contact' },
]

function fmtRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function groupByDate(entries: ActivityEntry[]): { date: string; items: ActivityEntry[] }[] {
  const groups: Record<string, ActivityEntry[]> = {}
  entries.forEach(e => {
    const key = new Date(e.occurred_at).toDateString()
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  })
  return Object.entries(groups).map(([date, items]) => ({ date, items }))
}

export default function ActivityLogPage() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(100)

  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    let query = supabase
      .from('activity_log')
      .select('*, contacts(first_name, last_name)')
      .eq('org_id', currentOrg.id)
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (filter) {
      query = query.like('event_type', `${filter}%`)
    }

    const { data } = await query
    setEntries((data as ActivityEntry[]) || [])
    setLoading(false)
  }, [currentOrg?.id, filter, limit])

  useEffect(() => { load() }, [load])

  // Real-time subscription
  useEffect(() => {
    if (!currentOrg) return
    const channel = supabase
      .channel('activity-log-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_log',
        filter: `org_id=eq.${currentOrg.id}`,
      }, (payload) => {
        setEntries(prev => [payload.new as ActivityEntry, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentOrg?.id])

  const filtered = search
    ? entries.filter(e => {
        const name = e.contacts ? `${e.contacts.first_name} ${e.contacts.last_name}`.toLowerCase() : ''
        const type = (EVENT_CONFIG[e.event_type]?.label || e.event_type).toLowerCase()
        return name.includes(search.toLowerCase()) || type.includes(search.toLowerCase())
      })
    : entries

  const groups = groupByDate(filtered)

  // Stats
  const today = entries.filter(e => new Date(e.occurred_at).toDateString() === new Date().toDateString())
  const smsSent = today.filter(e => e.event_type === 'sms_sent').length
  const callsMade = today.filter(e => e.event_type.startsWith('call_')).length
  const emailsSent = today.filter(e => e.event_type === 'email_sent').length

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark flex items-center gap-2">
            <Activity size={20} className="text-np-blue" /> Activity Log
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Real-time feed of all CRM activity across your organization</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Today's Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-2xl font-bold text-np-dark">{today.length}</p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Events Today</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-2xl font-bold text-np-dark">{callsMade}</p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Calls</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-2xl font-bold text-np-dark">{smsSent}</p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">SMS Sent</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-2xl font-bold text-np-dark">{emailsSent}</p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Emails</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or event..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
        </div>
        <div className="flex gap-1">
          {FILTER_GROUPS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-2.5 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                filter === f.value ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'
              }`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Activity size={32} className="mx-auto text-gray-400/20 mb-3" />
          <p className="text-sm text-gray-400">No activity found</p>
          <p className="text-[10px] text-gray-400 mt-1">Events will appear here as your team interacts with contacts</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{fmtDate(group.date)}</span>
                <div className="h-px flex-1 bg-gray-100" />
              </div>
              <div className="space-y-1">
                {group.items.map(entry => {
                  const cfg = EVENT_CONFIG[entry.event_type] || DEFAULT_CONFIG
                  const Icon = cfg.icon
                  const contactName = entry.contacts
                    ? `${entry.contacts.first_name} ${entry.contacts.last_name}`
                    : null
                  const eventData = entry.event_data || {}

                  return (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5 rounded-lg hover:bg-gray-50/50 transition-colors group">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: cfg.bg }}>
                        <Icon size={14} style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-np-dark">{cfg.label}</span>
                          {contactName && (
                            <Link href={`/crm/contacts?open=${entry.contact_id}`}
                              className="text-[10px] text-np-blue hover:underline font-medium">
                              {contactName}
                            </Link>
                          )}
                        </div>
                        {/* Event details */}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {(eventData as any).channel && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500">{String((eventData as any).channel).toUpperCase()}</span>
                          )}
                          {(eventData as any).sequence_id && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">Sequence</span>
                          )}
                          {(eventData as any).step_order && (
                            <span className="text-[9px] text-gray-400">Step {String((eventData as any).step_order)}</span>
                          )}
                          {(eventData as any).success === false && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Failed</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtRelative(entry.occurred_at)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {entries.length >= limit && (
            <button onClick={() => setLimit(l => l + 100)}
              className="w-full py-3 text-xs text-gray-400 hover:text-np-blue border border-dashed border-gray-100 rounded-lg transition-colors">
              Load more...
            </button>
          )}
        </div>
      )}
    </div>
  )
}
