'use client'

// ═══════════════════════════════════════════════════════════════
// Contact Communication Panel — Live counters + recent activity
// Drop into contact-detail.tsx as a tab or section
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Phone, MessageCircle, Mail, ArrowUpRight, ArrowDownLeft, Clock, Activity, Calendar, PhoneMissed, Voicemail } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { buildTimeline, TimelineStream, type TimelineEntry } from '@/components/crm/comms-timeline'

interface CommStats {
  total_calls: number
  total_texts: number
  total_emails: number
  total_inbound_calls: number
  total_outbound_calls: number
  total_inbound_texts: number
  total_outbound_texts: number
  total_call_duration_seconds: number
  last_call_at: string | null
  last_text_at: string | null
  last_email_at: string | null
  last_contacted_at: string | null
}

function fmtDur(s: number) {
  if (!s) return '0s'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function ago(d: string | null) {
  if (!d) return 'Never'
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ContactCommPanel({ contactId }: { contactId: string }) {
  const supabase = createClient()
  const [stats, setStats] = useState<CommStats | null>(null)
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
    loadTimeline()

    // Realtime: counters bump on every new inbound/outbound comm, so re-fetch
    // both stats and the merged timeline when the contact row updates.
    const ch = supabase.channel(`contact-comms-${contactId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `id=eq.${contactId}` }, () => { loadStats(); loadTimeline() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [contactId])

  async function loadTimeline() {
    try { setEntries(await buildTimeline(supabase, { contactId })) } catch { /* RLS or empty */ }
  }

  async function loadStats() {
    const { data } = await supabase
      .from('contacts')
      .select('total_calls, total_texts, total_emails, total_inbound_calls, total_outbound_calls, total_inbound_texts, total_outbound_texts, total_call_duration_seconds, last_call_at, last_text_at, last_email_at, last_contacted_at')
      .eq('id', contactId).single()
    if (data) setStats(data as CommStats)
    setLoading(false)
  }

  if (loading || !stats) return <div className="animate-pulse space-y-2 p-3"><div className="h-16 bg-gray-50 rounded-lg" /><div className="h-32 bg-gray-50 rounded-lg" /></div>

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-100 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-5 h-5 rounded bg-green-50 flex items-center justify-center"><Phone size={10} className="text-green-600" /></div>
            <span className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Calls</span>
          </div>
          <p className="text-lg font-bold text-np-dark">{stats.total_calls}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-0.5 text-[8px] text-gray-400"><ArrowUpRight size={8} className="text-green-500" />{stats.total_outbound_calls}</span>
            <span className="flex items-center gap-0.5 text-[8px] text-gray-400"><ArrowDownLeft size={8} className="text-blue-500" />{stats.total_inbound_calls}</span>
          </div>
          <p className="text-[7px] text-gray-300 mt-0.5">{fmtDur(stats.total_call_duration_seconds)} total</p>
          <p className="text-[7px] text-gray-300">Last: {ago(stats.last_call_at)}</p>
        </div>

        <div className="rounded-lg border border-gray-100 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-5 h-5 rounded bg-blue-50 flex items-center justify-center"><MessageCircle size={10} className="text-blue-500" /></div>
            <span className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Texts</span>
          </div>
          <p className="text-lg font-bold text-np-dark">{stats.total_texts}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-0.5 text-[8px] text-gray-400"><ArrowUpRight size={8} className="text-green-500" />{stats.total_outbound_texts}</span>
            <span className="flex items-center gap-0.5 text-[8px] text-gray-400"><ArrowDownLeft size={8} className="text-blue-500" />{stats.total_inbound_texts}</span>
          </div>
          <p className="text-[7px] text-gray-300 mt-1">Last: {ago(stats.last_text_at)}</p>
        </div>

        <div className="rounded-lg border border-gray-100 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-5 h-5 rounded bg-amber-50 flex items-center justify-center"><Mail size={10} className="text-amber-600" /></div>
            <span className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Emails</span>
          </div>
          <p className="text-lg font-bold text-np-dark">{stats.total_emails}</p>
          <p className="text-[7px] text-gray-300 mt-3">Last: {ago(stats.last_email_at)}</p>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex gap-2">
        <div className="flex-1 bg-gray-50 rounded-lg p-2 flex items-center gap-2">
          <Activity size={12} className="text-gray-400" />
          <div><p className="text-[8px] text-gray-400">Total</p><p className="text-xs font-bold text-np-dark">{stats.total_calls + stats.total_texts + stats.total_emails}</p></div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg p-2 flex items-center gap-2">
          <Calendar size={12} className="text-gray-400" />
          <div><p className="text-[8px] text-gray-400">Last Contact</p><p className="text-xs font-bold text-np-dark">{ago(stats.last_contacted_at)}</p></div>
        </div>
      </div>

      {/* Full communications history — texts + calls + voicemails, merged + sorted */}
      <div>
        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Communications</p>
        <div className="max-h-96 overflow-auto pr-1">
          <TimelineStream entries={entries} emptyLabel="No communications yet" />
        </div>
      </div>
    </div>
  )
}
