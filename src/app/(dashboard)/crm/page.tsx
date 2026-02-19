'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Dashboard — Overview with KPIs, recent calls, pipeline funnel
// Route: /crm
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Phone, MessageCircle, Mail, TrendingUp, TrendingDown,
  ArrowRight, Clock, UserPlus, CheckCircle2, AlertTriangle,
  Route, GraduationCap, Brain, GitBranch, Sparkles, Loader2
} from 'lucide-react'
import { fetchContacts, fetchCallLogs, fetchCampaigns, fetchTasks, fetchNetworkGraph, seedNetworkIntelligence } from '@/lib/crm-client'
import type { CrmContact, CallLog, EmailCampaign, CrmTask, NetworkGraphData } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'

function StatCard({ label, value, icon: Icon, trend, color, href }: {
  label: string; value: string | number; icon: any; trend?: number; color: string; href?: string
}) {
  const Wrapper = href ? Link : 'div'
  return (
    <Wrapper
      href={href || '#'}
      className={`relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 ${href ? 'hover:shadow-md cursor-pointer' : ''} transition-all`}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
          <p className="text-2xl font-bold mt-0.5 tracking-tight text-np-dark">{value}</p>
          {trend !== undefined && (
            <div className={`flex items-center gap-0.5 mt-1 text-[10px] font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {Math.abs(trend)}% vs last week
            </div>
          )}
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '18', color }}>
          <Icon size={16} />
        </div>
      </div>
    </Wrapper>
  )
}

function CallRow({ call }: { call: any }) {
  const name = call.contacts ? `${call.contacts.first_name} ${call.contacts.last_name}` : 'Unknown'
  const dur = call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '--'
  const statusColor = call.status === 'completed' ? '#34D399' : call.status === 'missed' ? '#F87171' : '#FBBF24'
  return (
    <tr className="border-b border-gray-100/50 hover:bg-gray-50/50 transition-colors">
      <td className="py-2 px-3 text-xs font-medium text-np-dark">{name}</td>
      <td className="py-2 px-3 text-xs text-gray-600">{call.direction}</td>
      <td className="py-2 px-3">
        <span className="inline-flex items-center gap-1 text-[10px]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          {call.status}
        </span>
      </td>
      <td className="py-2 px-3 text-xs text-gray-400 font-mono">{dur}</td>
      <td className="py-2 px-3 text-[10px] text-gray-400">
        {new Date(call.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </td>
    </tr>
  )
}

export default function CrmDashboard() {
  const { currentOrg } = useWorkspace()
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [networkData, setNetworkData] = useState<NetworkGraphData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [cRes, clRes, cpRes, tRes] = await Promise.allSettled([
          fetchContacts({ org_id: currentOrg?.id, limit: 1000 }),
          fetchCallLogs(undefined, 50),
          fetchCampaigns(),
          fetchTasks(),
        ])
        if (cRes.status === 'fulfilled') setContacts(cRes.value.contacts)
        if (clRes.status === 'fulfilled') setCalls(clRes.value)
        if (cpRes.status === 'fulfilled') setCampaigns(cpRes.value)
        if (tRes.status === 'fulfilled') setTasks(tRes.value)

        // Load network data
        if (currentOrg) {
          try {
            await seedNetworkIntelligence(currentOrg.id).catch(() => {})
            const graph = await fetchNetworkGraph(currentOrg.id)
            setNetworkData(graph)
          } catch {}
        }
      } catch (e) {
        console.error('CRM Dashboard load error:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentOrg?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" />
      </div>
    )
  }

  const totalValue = contacts.reduce((s, c) => s + (c.custom_fields?.value as number || 0), 0)
  const assessed = contacts.filter(c => c.custom_fields?.assessment_completed)
  const openTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress')
  const activeCampaigns = campaigns.filter(c => c.status === 'sending' || c.status === 'scheduled')

  // Pipeline distribution
  const stageGroups: Record<string, number> = {}
  contacts.forEach(c => {
    const s = c.pipeline_stage || 'Unassigned'
    stageGroups[s] = (stageGroups[s] || 0) + 1
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total Contacts" value={contacts.length} icon={Users} color="#2A9D8F" href="/crm/contacts" trend={12} />
        <StatCard label="Pipeline Value" value={`$${(totalValue / 1000).toFixed(0)}k`} icon={TrendingUp} color="#34D399" href="/crm/pipelines" />
        <StatCard label="Calls Today" value={calls.filter(c => new Date(c.started_at).toDateString() === new Date().toDateString()).length} icon={Phone} color="#228DC4" href="/crm/dialer" />
        <StatCard label="Open Tasks" value={openTasks.length} icon={CheckCircle2} color="#A78BFA" href="/crm/tasks" />
        <StatCard label="Active Campaigns" value={activeCampaigns.length} icon={Mail} color="#E76F51" href="/crm/campaigns" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Calls */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-np-dark">Recent Calls</h3>
            <Link href="/crm/dialer" className="text-[10px] font-medium text-np-blue hover:underline flex items-center gap-0.5">
              View All <ArrowRight size={10} />
            </Link>
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="py-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Contact</th>
                  <th className="py-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="py-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                  <th className="py-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Duration</th>
                  <th className="py-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {calls.slice(0, 15).map(c => <CallRow key={c.id} call={c} />)}
                {calls.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-xs text-gray-400">No calls yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pipeline + Tasks */}
        <div className="space-y-4">
          {/* Pipeline Summary */}
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-np-dark">Pipeline Overview</h3>
              <Link href="/crm/pipelines" className="text-[10px] font-medium text-np-blue hover:underline flex items-center gap-0.5">
                Full View <ArrowRight size={10} />
              </Link>
            </div>
            <div className="space-y-2">
              {Object.entries(stageGroups).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([stage, count]) => {
                const max = Math.max(...Object.values(stageGroups))
                return (
                  <div key={stage} className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-gray-600 w-24 truncate">{stage}</span>
                    <div className="flex-1 h-2 bg-gray-50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(count / max) * 100}%`, background: '#2A9D8F' }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-np-dark w-6 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Open Tasks */}
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-np-dark">Open Tasks</h3>
              <Link href="/crm/tasks" className="text-[10px] font-medium text-np-blue hover:underline flex items-center gap-0.5">
                All Tasks <ArrowRight size={10} />
              </Link>
            </div>
            <div className="divide-y divide-border/50 max-h-48 overflow-auto">
              {openTasks.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 transition-colors">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    t.priority === 'urgent' ? 'bg-red-500' :
                    t.priority === 'high' ? 'bg-amber-500' :
                    t.priority === 'medium' ? 'bg-blue-500' : 'bg-gray-300'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-np-dark truncate">{t.title}</p>
                    <p className="text-[10px] text-gray-400">
                      {t.contact ? `${(t.contact as any).first_name} ${(t.contact as any).last_name}` : 'No contact'}
                      {t.due_date && ` · Due ${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                  </div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                    t.priority === 'urgent' ? 'bg-red-50 text-red-600' :
                    t.priority === 'high' ? 'bg-amber-50 text-amber-600' :
                    'bg-gray-50 text-gray-500'
                  }`}>
                    {t.priority}
                  </span>
                </div>
              ))}
              {openTasks.length === 0 && (
                <div className="py-8 text-center text-xs text-gray-400">No open tasks</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width: Acquisition Funnel + Mastermind Lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Acquisition Funnel */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-np-dark flex items-center gap-1.5">
              <Route size={14} className="text-np-blue" /> Acquisition Funnel
            </h3>
            <span className="text-[9px] text-gray-400">Last 90 days</span>
          </div>
          {(() => {
            const funnelStages = [
              { key: 'New Lead', color: '#94a3b8' },
              { key: 'Contacted', color: '#60a5fa' },
              { key: 'Qualified', color: '#34d399' },
              { key: 'Discovery', color: '#fbbf24' },
              { key: 'Proposal', color: '#f97316' },
              { key: 'Enrolled', color: '#8b5cf6' },
              { key: 'Active', color: '#22c55e' },
              { key: 'Graduated', color: '#059669' },
            ]
            const maxVal = Math.max(...funnelStages.map(s => stageGroups[s.key] || 0), 1)
            return (
              <div className="space-y-1.5">
                {funnelStages.map((stage, i) => {
                  const count = stageGroups[stage.key] || 0
                  const prev = i > 0 ? (stageGroups[funnelStages[i-1].key] || 0) : count
                  const convRate = prev > 0 ? Math.round((count / prev) * 100) : 0
                  return (
                    <div key={stage.key} className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-gray-500 w-20 truncate">{stage.key}</span>
                      <div className="flex-1 relative">
                        <div className="h-6 bg-gray-50 rounded-md overflow-hidden">
                          <div className="h-full rounded-md transition-all flex items-center px-2"
                            style={{ width: `${Math.max((count / maxVal) * 100, 4)}%`, background: stage.color + '30' }}>
                            <span className="text-[10px] font-bold" style={{ color: stage.color }}>{count}</span>
                          </div>
                        </div>
                      </div>
                      {i > 0 && count > 0 && (
                        <span className="text-[9px] font-medium text-gray-400 w-10 text-right">{convRate}%</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* Mastermind Lifecycle */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-np-dark flex items-center gap-1.5">
              <GraduationCap size={14} className="text-emerald-600" /> Mastermind Lifecycle
            </h3>
          </div>
          {(() => {
            const statuses = [
              { key: 'prospect', label: 'Prospects', color: '#6b7280', icon: Users },
              { key: 'enrolled', label: 'Enrolled', color: '#3b82f6', icon: UserPlus },
              { key: 'active', label: 'Active in Program', color: '#22c55e', icon: Brain },
              { key: 'completed', label: 'Completed', color: '#8b5cf6', icon: CheckCircle2 },
              { key: 'graduated', label: 'Graduated', color: '#059669', icon: GraduationCap },
              { key: 'alumni', label: 'Alumni', color: '#64748b', icon: Users },
            ]
            const statusCounts: Record<string, number> = {}
            contacts.forEach(c => {
              const s = (c as any).mastermind_status || 'prospect'
              statusCounts[s] = (statusCounts[s] || 0) + 1
            })
            return (
              <div className="grid grid-cols-2 gap-2">
                {statuses.map(s => {
                  const count = statusCounts[s.key] || 0
                  const Icon = s.icon
                  return (
                    <div key={s.key} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:shadow-sm transition-all">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: s.color + '15' }}>
                        <Icon size={14} style={{ color: s.color }} />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-np-dark leading-none">{count}</p>
                        <p className="text-[9px] text-gray-400">{s.label}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Network Intelligence Widget */}
      {networkData && (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-np-dark flex items-center gap-1.5">
              <GitBranch size={14} className="text-indigo-500" /> Network Intelligence
            </h3>
            <Link href="/crm/network" className="text-[10px] font-medium text-np-blue hover:underline flex items-center gap-0.5">
              View Network <ArrowRight size={10} />
            </Link>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-np-dark">{networkData.edges.length}</p>
                <p className="text-[9px] text-gray-400">Connections</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-np-dark">{networkData.clusters.length}</p>
                <p className="text-[9px] text-gray-400">Clusters</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-np-dark">
                  {networkData.nodes.filter(n => n.relationship_count > 0).length}
                </p>
                <p className="text-[9px] text-gray-400">Connected</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-300">
                  {networkData.nodes.filter(n => n.relationship_count === 0).length}
                </p>
                <p className="text-[9px] text-gray-400">Orphans</p>
              </div>
            </div>
            {/* Top connectors */}
            {networkData.nodes.filter(n => n.relationship_count > 0).length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-2">Top Connectors</p>
                <div className="flex gap-3">
                  {[...networkData.nodes].sort((a, b) => b.relationship_count - a.relationship_count).slice(0, 5).map(n => (
                    <div key={n.id} className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[8px] font-bold">{n.avatar}</div>
                      <div>
                        <p className="text-[10px] font-semibold text-np-dark">{n.name}</p>
                        <p className="text-[8px] text-gray-400">{n.relationship_count} connections</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
