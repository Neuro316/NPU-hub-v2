'use client'

// ═══════════════════════════════════════════════════════════════
// Contact Communication Panel — Live counters + recent activity
// Drop into contact-detail.tsx as a tab or section
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Phone, MessageCircle, Mail, ArrowUpRight, ArrowDownLeft, Clock, Activity, Calendar, PhoneMissed, Voicemail } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { fetchCallLogs } from '@/lib/crm-client'
import type { CallLog } from '@/types/crm'

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
  const [calls, setCalls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
    fetchCallLogs(contactId, 10).then(setCalls).catch(() => {})

    // Realtime: re-fetch when contact counters update
    const ch = supabase.channel(`contact-comms-${contactId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `id=eq.${contactId}` }, () => loadStats())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [contactId])

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

      {/* Recent calls */}
      <div>
        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent Calls</p>
        <div className="space-y-1">
          {calls.length === 0 && <p className="text-[10px] text-gray-300 text-center py-4">No calls yet</p>}
          {calls.map((call: any) => (
            <div key={call.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-gray-50">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                call.direction === 'inbound' ? 'bg-green-100' : 'bg-blue-100'
              }`}>
                {call.status === 'missed' ? <PhoneMissed size={10} className="text-red-500" /> :
                 call.direction === 'inbound' ? <ArrowDownLeft size={10} className="text-green-600" /> :
                 <ArrowUpRight size={10} className="text-blue-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-np-dark">
                  {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                  {(call.duration_seconds ?? 0) > 0 && ` · ${fmtDur(call.duration_seconds)}`}
                </p>
                <p className="text-[8px] text-gray-300">{new Date(call.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              </div>
              {call.sentiment && (
                <span className={`text-[7px] font-bold px-1 py-0.5 rounded ${
                  call.sentiment === 'positive' ? 'bg-green-50 text-green-600' :
                  call.sentiment === 'negative' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                }`}>{call.sentiment}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
