'use client'

import { useEffect, useState } from 'react'
import {
  Users, Phone, MessageCircle, Mail, TrendingUp, Clock,
  BarChart3, Activity, Heart, Zap, Target, DollarSign,
  Percent, ArrowUpRight, ArrowDownRight, UserPlus, Repeat,
  Calendar, ShieldCheck, AlertTriangle, Gauge
} from 'lucide-react'
import { fetchContacts, fetchCallLogs, fetchCampaigns, fetchTasks } from '@/lib/crm-client'
import type { CrmContact, EmailCampaign, CrmTask } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'

function MetricCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub?: string; icon: any; color: string; trend?: number | null
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color+'15', color }}><Icon size={14} /></div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
        </div>
        {trend !== undefined && trend !== null && (
          <span className={`text-[9px] font-bold flex items-center gap-0.5 ${trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {trend > 0 ? <ArrowUpRight size={10} /> : trend < 0 ? <ArrowDownRight size={10} /> : null}{Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-np-dark">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function BarRow({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-600 w-28 truncate">{label}</span>
      <div className="flex-1 h-3 bg-gray-50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${max > 0 ? (value/max)*100 : 0}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold text-np-dark w-12 text-right">{value}{suffix || ''}</span>
    </div>
  )
}

function FunnelStage({ name, count, prevCount, value, color, maxCount }: {
  name: string; count: number; prevCount: number; value: number; color: string; maxCount: number
}) {
  const convRate = prevCount > 0 ? ((count/prevCount)*100).toFixed(0) : '--'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-np-dark">{name}</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-400">{count}</span>
          {value > 0 && <span className="text-[10px] font-medium text-green-600">${(value/1000).toFixed(0)}k</span>}
          {prevCount !== count && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400">{convRate}%</span>}
        </div>
      </div>
      <div className="h-3 bg-gray-50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(count/maxCount)*100}%`, background: color }} />
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { currentOrg } = useWorkspace()
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [cRes, clRes, cpRes, tRes] = await Promise.allSettled([
          fetchContacts({ org_id: currentOrg?.id, limit: 2000 }), fetchCallLogs(undefined, 200), fetchCampaigns(), fetchTasks(),
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

  // ── Time periods ──
  const now = Date.now()
  const week = 7*86400000; const month = 30*86400000; const quarter = 90*86400000
  const thisWeek = contacts.filter(c => now - new Date(c.created_at).getTime() < week)
  const thisMonth = contacts.filter(c => now - new Date(c.created_at).getTime() < month)
  const lastMonth = contacts.filter(c => { const d = now - new Date(c.created_at).getTime(); return d >= month && d < 2*month })

  // ── Pipeline metrics ──
  const wonContacts = contacts.filter(c => c.pipeline_stage === 'Won')
  const lostContacts = contacts.filter(c => c.pipeline_stage === 'Lost')
  const closedTotal = wonContacts.length + lostContacts.length
  const winRate = closedTotal > 0 ? ((wonContacts.length/closedTotal)*100).toFixed(1) : '--'

  // ── Revenue metrics ──
  const totalRevenue = wonContacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const pipelineValue = contacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const avgDealSize = wonContacts.length > 0 ? totalRevenue / wonContacts.length : 0

  // ── Lifetime Value (LTV) ──
  // Estimated as avg deal size * repeat rate (contacts with >1 lifecycle event)
  const repeatBuyers = wonContacts.filter(c => (c.custom_fields?.purchases as number) > 1).length
  const repeatRate = wonContacts.length > 0 ? repeatBuyers / wonContacts.length : 0
  const estimatedLTV = avgDealSize > 0 ? avgDealSize * (1 + repeatRate * 2) : 0

  // ── Cost of Acquisition (CAC) ──
  const totalCampaignSpend = campaigns.reduce((s,c) => s + ((c as any).spend || 0), 0)
  const newContactsFromCampaigns = contacts.filter(c => c.source && ['Website','Social Media','Cold Outreach','Podcast'].includes(c.source)).length
  const estimatedCAC = newContactsFromCampaigns > 0 ? totalCampaignSpend / newContactsFromCampaigns : 0
  const ltvCacRatio = estimatedCAC > 0 ? (estimatedLTV / estimatedCAC).toFixed(1) : '--'

  // ── Sales Cycle ──
  const closeTimes = wonContacts.map(c => {
    if (!c.created_at || !c.updated_at) return null
    return (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86400000
  }).filter((d): d is number => d !== null && d > 0)
  const avgCloseTime = closeTimes.length > 0 ? Math.round(closeTimes.reduce((a,b)=>a+b,0)/closeTimes.length) : null
  const medianCloseTime = closeTimes.length > 0 ? closeTimes.sort((a,b)=>a-b)[Math.floor(closeTimes.length/2)] : null

  // ── Activity metrics ──
  const completedCalls = calls.filter(c => c.status === 'completed')
  const avgCallDuration = completedCalls.length > 0
    ? Math.round(completedCalls.reduce((s: number, c: any) => s + (c.duration_seconds||0), 0) / completedCalls.length) : 0
  const totalSent = campaigns.reduce((s,c) => s + c.sent_count, 0)
  const openTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length
  const completedTasks = tasks.filter(t => t.status === 'done').length
  const overdueTasks = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length

  // ── Lead Response Time (first contact after creation) ──
  const responseTimes = contacts.map(c => {
    if (!c.created_at || !c.last_contacted_at) return null
    return (new Date(c.last_contacted_at).getTime() - new Date(c.created_at).getTime()) / 3600000
  }).filter((h): h is number => h !== null && h > 0 && h < 720)
  const avgResponseTime = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length) : null

  // ── Stale / Health ──
  const stale14d = contacts.filter(c => c.pipeline_stage !== 'Won' && c.pipeline_stage !== 'Lost' && c.last_contacted_at && now - new Date(c.last_contacted_at).getTime() > 14*86400000).length
  const neverContacted = contacts.filter(c => !c.last_contacted_at && c.pipeline_stage !== 'Won' && c.pipeline_stage !== 'Lost').length

  // ── Pipeline distribution ──
  const pipelineCounts: Record<string,number> = {}
  const pipelineValues: Record<string,number> = {}
  contacts.forEach(c => { const s = c.pipeline_stage || 'Unassigned'; pipelineCounts[s] = (pipelineCounts[s]||0)+1; pipelineValues[s] = (pipelineValues[s]||0)+((c.custom_fields?.value as number)||0) })

  // ── Source distribution ──
  const sourceCounts: Record<string,number> = {}; const sourceWon: Record<string,number> = {}
  contacts.forEach(c => { const s = c.source || 'Unknown'; sourceCounts[s] = (sourceCounts[s]||0)+1 })
  wonContacts.forEach(c => { const s = c.source || 'Unknown'; sourceWon[s] = (sourceWon[s]||0)+1 })
  const maxSource = Math.max(...Object.values(sourceCounts), 1)

  // ── Tag distribution ──
  const tagCounts: Record<string,number> = {}
  contacts.forEach(c => c.tags?.forEach(t => { tagCounts[t] = (tagCounts[t]||0)+1 }))
  const topTags = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,8)
  const maxTag = topTags.length > 0 ? topTags[0][1] : 1

  // ── Growth trend ──
  const monthGrowth = lastMonth.length > 0 ? Math.round(((thisMonth.length - lastMonth.length)/lastMonth.length)*100) : null

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Revenue & Business KPIs ── */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Revenue & Business Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Total Revenue" value={`$${(totalRevenue/1000).toFixed(0)}k`} icon={DollarSign} color="#34D399" sub={`${wonContacts.length} closed deals`} />
          <MetricCard label="Pipeline Value" value={`$${(pipelineValue/1000).toFixed(0)}k`} icon={Target} color="#228DC4" sub={`${contacts.length} total contacts`} />
          <MetricCard label="Avg Deal Size" value={avgDealSize > 0 ? `$${(avgDealSize/1000).toFixed(1)}k` : '--'} icon={BarChart3} color="#8B5CF6" />
          <MetricCard label="Est. LTV" value={estimatedLTV > 0 ? `$${(estimatedLTV/1000).toFixed(1)}k` : '--'} icon={Repeat} color="#2A9D8F" sub="lifetime value" />
          <MetricCard label="Est. CAC" value={estimatedCAC > 0 ? `$${estimatedCAC.toFixed(0)}` : '--'} icon={UserPlus} color="#E76F51" sub="cost per acquisition" />
          <MetricCard label="LTV:CAC" value={ltvCacRatio} icon={Gauge} color={parseFloat(ltvCacRatio as string) >= 3 ? '#34D399' : '#F87171'} sub={parseFloat(ltvCacRatio as string) >= 3 ? 'Healthy ratio' : 'Target 3:1+'} />
        </div>
      </div>

      {/* ── Sales Performance ── */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Sales Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Win Rate" value={`${winRate}%`} icon={Percent} color="#34D399" sub={`${wonContacts.length}W / ${lostContacts.length}L`} />
          <MetricCard label="Avg Close Time" value={avgCloseTime ? `${avgCloseTime}d` : '--'} icon={Clock} color="#228DC4" sub={medianCloseTime ? `Median: ${Math.round(medianCloseTime)}d` : ''} />
          <MetricCard label="Lead Response" value={avgResponseTime ? `${avgResponseTime}h` : '--'} icon={Zap} color="#FBBF24" sub="avg first contact" />
          <MetricCard label="New This Week" value={thisWeek.length} icon={UserPlus} color="#3DB5A6" trend={monthGrowth} />
          <MetricCard label="Stale 14d+" value={stale14d} icon={AlertTriangle} color="#F87171" sub={`${neverContacted} never contacted`} />
          <MetricCard label="Task Completion" value={`${completedTasks + openTasks > 0 ? Math.round((completedTasks/(completedTasks+openTasks))*100) : 0}%`} icon={ShieldCheck} color="#8B5CF6" sub={`${overdueTasks} overdue`} />
        </div>
      </div>

      {/* ── Activity Metrics ── */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Activity</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Calls Made" value={calls.length} icon={Phone} color="#228DC4" sub={`Avg ${Math.floor(avgCallDuration/60)}m ${avgCallDuration%60}s`} />
          <MetricCard label="Emails Sent" value={totalSent} icon={Mail} color="#E76F51" sub={`${campaigns.length} campaigns`} />
          <MetricCard label="Open Tasks" value={openTasks} icon={Activity} color="#A78BFA" sub={`${completedTasks} completed`} />
          <MetricCard label="Contacts" value={contacts.length} icon={Users} color="#2A9D8F" sub={`+${thisMonth.length} this month`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Pipeline Funnel ── */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Target size={14} className="text-np-blue" /> Pipeline Funnel</h3>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage, i) => {
              const count = pipelineCounts[stage] || 0
              const value = pipelineValues[stage] || 0
              const prevCount = i > 0 ? (pipelineCounts[PIPELINE_STAGES[i-1]]||0) : count
              const maxCount = Math.max(...PIPELINE_STAGES.map(s => pipelineCounts[s]||0), 1)
              return <FunnelStage key={stage} name={stage} count={count} prevCount={prevCount} value={value} color={STAGE_COLORS[stage]||'#94a3b8'} maxCount={maxCount} />
            })}
          </div>
        </div>

        {/* ── Source Attribution with Conversion ── */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Zap size={14} className="text-amber-500" /> Source Attribution</h3>
          <div className="space-y-2.5">
            {Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([source, count]) => {
              const won = sourceWon[source] || 0
              const conv = count > 0 ? ((won/count)*100).toFixed(0) : '0'
              return (
                <div key={source}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-gray-600">{source}</span>
                    <span className="text-[9px] text-gray-400">{conv}% conv</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 bg-gray-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(count/maxSource)*100}%`, background: '#2A9D8F' }} />
                    </div>
                    <span className="text-[11px] font-semibold text-np-dark w-8 text-right">{count}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Monthly Cohort Analysis ── */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Calendar size={14} className="text-purple-500" /> Monthly Cohort</h3>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => {
              const monthStart = new Date(now - (i*month))
              const monthEnd = new Date(now - ((i-1)*month))
              const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
              const cohort = contacts.filter(c => { const d = new Date(c.created_at); return d >= monthStart && d < monthEnd })
              const cohortWon = cohort.filter(c => c.pipeline_stage === 'Won').length
              const cohortConv = cohort.length > 0 ? ((cohortWon/cohort.length)*100).toFixed(0) : '0'
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-500 w-16">{label}</span>
                  <div className="flex-1 h-3 bg-gray-50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-purple-400 transition-all duration-500" style={{ width: `${Math.min((cohort.length/Math.max(thisMonth.length,1))*100, 100)}%` }} />
                  </div>
                  <span className="text-[10px] font-medium text-np-dark w-10 text-right">{cohort.length}</span>
                  <span className="text-[9px] text-gray-400 w-12 text-right">{cohortConv}% won</span>
                </div>
              )
            }).reverse()}
          </div>
        </div>

        {/* ── Top Tags ── */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><BarChart3 size={14} className="text-np-blue" /> Contact Tags</h3>
          <div className="space-y-2.5">
            {topTags.map(([tag, count]) => <BarRow key={tag} label={tag} value={count} max={maxTag} color="#228DC4" />)}
            {topTags.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No tags yet</p>}
          </div>
        </div>
      </div>

      {/* ── Sales Velocity ── */}
      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><TrendingUp size={14} className="text-np-blue" /> Sales Velocity</h3>
        <p className="text-xs text-gray-400 mb-4">Revenue generated per day based on pipeline velocity formula: (Opportunities x Win Rate x Avg Deal Size) / Sales Cycle Length</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-3 rounded-lg bg-gray-50">
            <p className="text-[10px] text-gray-400 uppercase">Opportunities</p>
            <p className="text-xl font-bold text-np-dark">{contacts.length - wonContacts.length - lostContacts.length}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-gray-50">
            <p className="text-[10px] text-gray-400 uppercase">Win Rate</p>
            <p className="text-xl font-bold text-np-dark">{winRate}%</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-gray-50">
            <p className="text-[10px] text-gray-400 uppercase">Avg Deal</p>
            <p className="text-xl font-bold text-np-dark">${avgDealSize > 0 ? (avgDealSize/1000).toFixed(1)+'k' : '--'}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-gray-50">
            <p className="text-[10px] text-gray-400 uppercase">Cycle Length</p>
            <p className="text-xl font-bold text-np-dark">{avgCloseTime ? `${avgCloseTime}d` : '--'}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-np-blue/5 border border-np-blue/20">
            <p className="text-[10px] text-np-blue uppercase font-semibold">Velocity</p>
            <p className="text-xl font-bold text-np-blue">
              {avgCloseTime && avgDealSize > 0 && winRate !== '--'
                ? `$${(((contacts.length - wonContacts.length - lostContacts.length) * (parseFloat(winRate as string)/100) * avgDealSize) / avgCloseTime / 1000).toFixed(1)}k/day`
                : '--'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
