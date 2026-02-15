'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Analytics — Full stats dashboard
// Route: /crm/analytics
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  Users, Phone, MessageCircle, Mail, TrendingUp, Clock,
  BarChart3, Activity, Heart, Zap, Target
} from 'lucide-react'
import { fetchContacts, fetchCallLogs, fetchCampaigns, fetchTasks } from '@/lib/crm-client'
import type { CrmContact, EmailCampaign, CrmTask } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string; icon: any; color: string
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '15', color }}>
          <Icon size={14} />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <p className="text-xl font-bold text-np-dark">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-600 w-28 truncate">{label}</span>
      <div className="flex-1 h-3 bg-gray-50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold text-np-dark w-8 text-right">{value}</span>
    </div>
  )
}

export default function AnalyticsPage() {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [cRes, clRes, cpRes, tRes] = await Promise.allSettled([
          fetchContacts({ limit: 2000 }),
          fetchCallLogs(undefined, 200),
          fetchCampaigns(),
          fetchTasks(),
        ])
        if (cRes.status === 'fulfilled') setContacts(cRes.value.contacts)
        if (clRes.status === 'fulfilled') setCalls(clRes.value)
        if (cpRes.status === 'fulfilled') setCampaigns(cpRes.value)
        if (tRes.status === 'fulfilled') setTasks(tRes.value)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  // Compute metrics
  const now = Date.now()
  const week = 7 * 86400000
  const newThisWeek = contacts.filter(c => now - new Date(c.created_at).getTime() < week).length
  const completedCalls = calls.filter(c => c.status === 'completed')
  const avgCallDuration = completedCalls.length > 0
    ? Math.round(completedCalls.reduce((s: number, c: any) => s + (c.duration_seconds || 0), 0) / completedCalls.length)
    : 0
  const openTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length
  const completedTasks = tasks.filter(t => t.status === 'done').length
  const stale14d = contacts.filter(c => c.last_contacted_at && now - new Date(c.last_contacted_at).getTime() > 14 * 86400000).length

  // Pipeline distribution
  const pipelineCounts: Record<string, number> = {}
  const pipelineValues: Record<string, number> = {}
  contacts.forEach(c => {
    const s = c.pipeline_stage || 'Unassigned'
    pipelineCounts[s] = (pipelineCounts[s] || 0) + 1
    pipelineValues[s] = (pipelineValues[s] || 0) + ((c.custom_fields?.value as number) || 0)
  })

  // Source distribution
  const sourceCounts: Record<string, number> = {}
  contacts.forEach(c => { const s = c.source || 'Unknown'; sourceCounts[s] = (sourceCounts[s] || 0) + 1 })
  const maxSource = Math.max(...Object.values(sourceCounts), 1)

  // Tag distribution
  const tagCounts: Record<string, number> = {}
  contacts.forEach(c => c.tags?.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1 }))
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxTag = topTags.length > 0 ? topTags[0][1] : 1

  // Sentiment from calls
  const sentimentCounts: Record<string, number> = { positive: 0, neutral: 0, negative: 0, concerned: 0 }
  calls.forEach(c => { if (c.sentiment) sentimentCounts[c.sentiment] = (sentimentCounts[c.sentiment] || 0) + 1 })

  // Campaign metrics
  const totalSent = campaigns.reduce((s, c) => s + c.sent_count, 0)
  const totalRecipients = campaigns.reduce((s, c) => s + (c.total_recipients || 0), 0)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Total Contacts" value={contacts.length} icon={Users} color="#2A9D8F" sub={`+${newThisWeek} this week`} />
        <MetricCard label="Calls Made" value={calls.length} icon={Phone} color="#228DC4" sub={`Avg ${Math.floor(avgCallDuration / 60)}m ${avgCallDuration % 60}s`} />
        <MetricCard label="Emails Sent" value={totalSent} icon={Mail} color="#E76F51" sub={`${campaigns.length} campaigns`} />
        <MetricCard label="Open Tasks" value={openTasks} icon={Activity} color="#A78BFA" sub={`${completedTasks} completed`} />
        <MetricCard label="Stale 14d+" value={stale14d} icon={Clock} color="#F87171" sub="Need follow-up" />
        <MetricCard label="Pipeline Value" value={`$${(Object.values(pipelineValues).reduce((a, b) => a + b, 0) / 1000).toFixed(0)}k`} icon={Target} color="#34D399" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline Funnel */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2">
            <Target size={14} className="text-np-blue" /> Pipeline Funnel
          </h3>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage, i) => {
              const count = pipelineCounts[stage] || 0
              const value = pipelineValues[stage] || 0
              const prevCount = i > 0 ? (pipelineCounts[PIPELINE_STAGES[i - 1]] || 0) : count
              const convRate = prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) : '--'
              const maxCount = Math.max(...PIPELINE_STAGES.map(s => pipelineCounts[s] || 0), 1)
              return (
                <div key={stage}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-np-dark">{stage}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-gray-400">{count} contacts</span>
                      {value > 0 && <span className="text-[10px] font-medium text-green-600">${(value / 1000).toFixed(0)}k</span>}
                      {i > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400">{convRate}%</span>}
                    </div>
                  </div>
                  <div className="h-3 bg-gray-50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${(count / maxCount) * 100}%`, background: STAGE_COLORS[stage] || '#94a3b8' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Attribution by Source */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2">
            <Zap size={14} className="text-amber-500" /> Attribution by Source
          </h3>
          <div className="space-y-2.5">
            {Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([source, count]) => (
              <BarRow key={source} label={source} value={count} max={maxSource} color="#2A9D8F" />
            ))}
          </div>
        </div>

        {/* Top Tags */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2">
            <BarChart3 size={14} className="text-np-blue" /> Contact Tags
          </h3>
          <div className="space-y-2.5">
            {topTags.map(([tag, count]) => (
              <BarRow key={tag} label={tag} value={count} max={maxTag} color="#228DC4" />
            ))}
            {topTags.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No tags yet</p>}
          </div>
        </div>

        {/* Call Sentiment */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2">
            <Heart size={14} className="text-rose-400" /> Call Sentiment
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(sentimentCounts).map(([sentiment, count]) => {
              const colors: Record<string, string> = { positive: '#34D399', neutral: '#94a3b8', negative: '#F87171', concerned: '#FBBF24' }
              const emojis: Record<string, string> = { positive: '😊', neutral: '😐', negative: '😟', concerned: '🤔' }
              return (
                <div key={sentiment} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50/50">
                  <span className="text-lg">{emojis[sentiment]}</span>
                  <div>
                    <p className="text-xs font-semibold capitalize" style={{ color: colors[sentiment] }}>{sentiment}</p>
                    <p className="text-lg font-bold text-np-dark">{count}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
