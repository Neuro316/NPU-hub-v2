'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWorkspace } from '@/lib/workspace-context'
import {
  BarChart3, TrendingUp, Target, Users, Zap, Brain, ArrowUpRight, ArrowDownRight,
  DollarSign, Percent, Clock, UserPlus, Gauge, Activity, Phone, Mail,
  ExternalLink, ShieldCheck, Repeat
} from 'lucide-react'
import { fetchContacts, fetchCallLogs, fetchCampaigns, fetchTasks } from '@/lib/crm-client'
import type { CrmContact, EmailCampaign, CrmTask } from '@/types/crm'

function KPI({ label, value, change, icon: Icon, color, link }: {
  label: string; value: string; change?: number | null; icon: any; color: string; link?: string
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4" style={{ color }} />
        {change !== undefined && change !== null && (
          <span className={`text-[9px] font-bold flex items-center gap-0.5 ${change > 0 ? 'text-green-500' : change < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {change > 0 ? <ArrowUpRight className="w-3 h-3" /> : change < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="text-lg font-bold text-np-dark">{value}</p>
      <div className="flex items-center justify-between mt-0.5">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{label}</p>
        {link && <Link href={link} className="text-[9px] text-np-blue hover:underline flex items-center gap-0.5"><ExternalLink size={8} /></Link>}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [cRes, clRes, cpRes, tRes] = await Promise.allSettled([
          fetchContacts({ limit: 2000 }), fetchCallLogs(undefined, 200), fetchCampaigns(), fetchTasks(),
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

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading analytics...</div></div>

  // ── Compute everything ──
  const now = Date.now(); const week = 7*86400000; const month = 30*86400000
  const thisMonth = contacts.filter(c => now - new Date(c.created_at).getTime() < month)
  const lastMonth = contacts.filter(c => { const d = now - new Date(c.created_at).getTime(); return d >= month && d < 2*month })
  const monthGrowth = lastMonth.length > 0 ? Math.round(((thisMonth.length - lastMonth.length)/lastMonth.length)*100) : null
  const wonContacts = contacts.filter(c => c.pipeline_stage === 'Won')
  const lostContacts = contacts.filter(c => c.pipeline_stage === 'Lost')
  const closedTotal = wonContacts.length + lostContacts.length
  const winRate = closedTotal > 0 ? ((wonContacts.length/closedTotal)*100).toFixed(1) : '--'
  const totalRevenue = wonContacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const pipelineValue = contacts.reduce((s,c) => s + ((c.custom_fields?.value as number)||0), 0)
  const avgDealSize = wonContacts.length > 0 ? totalRevenue / wonContacts.length : 0
  const repeatBuyers = wonContacts.filter(c => (c.custom_fields?.purchases as number) > 1).length
  const repeatRate = wonContacts.length > 0 ? repeatBuyers / wonContacts.length : 0
  const estimatedLTV = avgDealSize > 0 ? avgDealSize * (1 + repeatRate * 2) : 0
  const totalSpend = campaigns.reduce((s,c) => s + ((c as any).spend || 0), 0)
  const newFromCampaigns = contacts.filter(c => c.source && ['Website','Social Media','Cold Outreach','Podcast'].includes(c.source)).length
  const estimatedCAC = newFromCampaigns > 0 ? totalSpend / newFromCampaigns : 0
  const ltvCacRatio = estimatedCAC > 0 ? (estimatedLTV / estimatedCAC).toFixed(1) : '--'
  const closeTimes = wonContacts.map(c => { if (!c.created_at || !c.updated_at) return null; return (new Date(c.updated_at).getTime()-new Date(c.created_at).getTime())/86400000 }).filter((d):d is number => d!==null && d>0)
  const avgCloseTime = closeTimes.length > 0 ? Math.round(closeTimes.reduce((a,b)=>a+b,0)/closeTimes.length) : null
  const totalSent = campaigns.reduce((s,c) => s + c.sent_count, 0)
  const openTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length
  const completedTasks = tasks.filter(t => t.status === 'done').length
  const activeDeals = contacts.length - wonContacts.length - lostContacts.length
  const velocity = avgCloseTime && avgDealSize > 0 && winRate !== '--'
    ? ((activeDeals * (parseFloat(winRate as string)/100) * avgDealSize) / avgCloseTime) : 0

  // Source distribution for chart
  const sourceCounts: Record<string,number> = {}
  contacts.forEach(c => { const s = c.source || 'Unknown'; sourceCounts[s] = (sourceCounts[s]||0)+1 })
  const maxSource = Math.max(...Object.values(sourceCounts), 1)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Analytics</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Business Intelligence</p>
        </div>
        <Link href="/crm/analytics" className="flex items-center gap-1.5 px-3 py-2 bg-np-blue/10 text-np-blue text-xs font-medium rounded-lg hover:bg-np-blue/20 transition-colors">
          <BarChart3 size={13} /> Detailed CRM Analytics
        </Link>
      </div>

      {/* ── Revenue KPIs ── */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Revenue</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total Revenue" value={`$${(totalRevenue/1000).toFixed(0)}k`} icon={DollarSign} color="#34D399" link="/crm/analytics" />
          <KPI label="Pipeline Value" value={`$${(pipelineValue/1000).toFixed(0)}k`} icon={Target} color="#228DC4" />
          <KPI label="Avg Deal Size" value={avgDealSize > 0 ? `$${(avgDealSize/1000).toFixed(1)}k` : '--'} icon={BarChart3} color="#8B5CF6" />
          <KPI label="Sales Velocity" value={velocity > 0 ? `$${(velocity/1000).toFixed(1)}k/day` : '--'} icon={TrendingUp} color="#2A9D8F" />
        </div>
      </div>

      {/* ── Unit Economics ── */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Unit Economics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Est. LTV" value={estimatedLTV > 0 ? `$${(estimatedLTV/1000).toFixed(1)}k` : '--'} icon={Repeat} color="#2A9D8F" />
          <KPI label="Est. CAC" value={estimatedCAC > 0 ? `$${estimatedCAC.toFixed(0)}` : '--'} icon={UserPlus} color="#E76F51" />
          <KPI label="LTV:CAC Ratio" value={ltvCacRatio as string} icon={Gauge} color={parseFloat(ltvCacRatio as string) >= 3 ? '#34D399' : '#F87171'} />
          <KPI label="Win Rate" value={`${winRate}%`} icon={Percent} color="#34D399" />
        </div>
      </div>

      {/* ── Operations ── */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Operations</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Contacts" value={contacts.length.toString()} change={monthGrowth} icon={Users} color="#2A9D8F" link="/crm/contacts" />
          <KPI label="Avg Close Time" value={avgCloseTime ? `${avgCloseTime} days` : '--'} icon={Clock} color="#228DC4" />
          <KPI label="Active Deals" value={activeDeals.toString()} icon={Activity} color="#FBBF24" link="/crm/pipelines" />
          <KPI label="Task Completion" value={`${completedTasks+openTasks > 0 ? Math.round((completedTasks/(completedTasks+openTasks))*100) : 0}%`} icon={ShieldCheck} color="#8B5CF6" link="/crm/tasks" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Source Attribution */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-np-dark mb-3 flex items-center gap-2"><Zap size={13} className="text-amber-500" /> Lead Sources</h3>
          <div className="space-y-2.5">
            {Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([source, count]) => (
              <div key={source} className="flex items-center gap-3">
                <span className="text-xs text-np-dark w-28 truncate">{source}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div className="h-full rounded-full bg-teal/70 transition-all duration-500" style={{ width: `${(count/maxSource)*100}%` }} />
                </div>
                <span className="text-[10px] font-semibold text-np-dark w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-np-dark mb-3 flex items-center gap-2"><Target size={13} className="text-np-blue" /> Conversion Funnel</h3>
          <div className="flex items-end justify-center gap-3 h-40">
            {[
              { label: 'Total Leads', value: contacts.length, color: '#DBEAFE' },
              { label: 'Contacted', value: contacts.filter(c => c.last_contacted_at).length, color: '#93C5FD' },
              { label: 'Qualified', value: contacts.filter(c => ['Qualified','Proposal','Negotiation','Won'].includes(c.pipeline_stage||'')).length, color: '#60A5FA' },
              { label: 'Proposal', value: contacts.filter(c => ['Proposal','Negotiation','Won'].includes(c.pipeline_stage||'')).length, color: '#3B82F6' },
              { label: 'Won', value: wonContacts.length, color: '#1D4ED8' },
            ].map((step, i) => {
              const maxVal = contacts.length || 1
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full rounded-t-lg transition-all duration-500" style={{ height: `${Math.max((step.value/maxVal)*100, 5)}%`, backgroundColor: step.color }} />
                  <span className="text-[8px] text-gray-500 font-medium text-center">{step.label}</span>
                  <span className="text-[10px] font-bold text-np-dark">{step.value}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bayesian Campaign Stack */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-np-blue" />
          <h2 className="text-sm font-bold text-np-dark">Bayesian Campaign Stack Ranking</h2>
          <span className="text-[9px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">Intelligence Engine</span>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          As campaigns collect data, the Bayesian engine ranks your best-performing combinations of quiz type + post format + platform + ICP target.
        </p>
        {campaigns.length > 0 ? (
          <div className="space-y-2">
            {campaigns.slice(0, 5).map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                <span className="text-xs font-bold text-gray-400 w-6">#{i+1}</span>
                <div className="flex-1"><p className="text-xs font-medium text-np-dark">{c.name}</p><p className="text-[10px] text-gray-400">{c.sent_count} sent · {c.status}</p></div>
                <div className="text-right"><p className="text-xs font-semibold text-np-dark">{c.total_recipients || 0}</p><p className="text-[9px] text-gray-400">recipients</p></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-400 mb-1">Campaign data needed</p>
            <p className="text-xs text-gray-400">Create campaigns to start building your ranking stack.</p>
          </div>
        )}
      </div>
    </div>
  )
}
