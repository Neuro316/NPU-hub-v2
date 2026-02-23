'use client'

// ═══════════════════════════════════════════════════════════════
// Usage Analytics — Comprehensive telemetry dashboard
// Route: /usage-analytics — ADMIN ONLY
// Shows: page heatmap, team performance, API health, sunset candidates
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import {
  Activity, BarChart3, Users, AlertTriangle, TrendingDown, TrendingUp,
  Clock, Monitor, Smartphone, Tablet, Brain, Search, Zap, XCircle,
  Eye, MousePointer, RefreshCw, ChevronDown, Flame, Snowflake
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { PermissionGate } from '@/lib/hooks/use-permissions'
import { fetchTeamMembers } from '@/lib/crm-client'
import type { TeamMember } from '@/types/crm'

type Tab = 'overview' | 'team' | 'api' | 'sunset'

// All trackable pages with friendly names
const PAGE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/crm': 'CRM Hub',
  '/crm/contacts': 'Contacts',
  '/crm/pipelines': 'Pipelines',
  '/crm/conversations': 'Conversations',
  '/crm/dialer': 'Dialer',
  '/crm/sequences': 'Sequences',
  '/crm/tasks': 'Client Tasks',
  '/crm/analytics': 'CRM Analytics',
  '/crm/network': 'Network Intel',
  '/crm/import': 'Import',
  '/crm/settings': 'CRM Settings',
  '/crm/campaigns': 'CRM Campaigns',
  '/campaigns': 'Campaigns',
  '/analytics': 'Analytics',
  '/tasks': 'Project Board',
  '/journeys': 'Journey Builder',
  '/social': 'Social Media',
  '/media': 'Media Library',
  '/calendar': 'Calendar',
  '/shipit': 'ShipIt Journal',
  '/ideas': 'Ideas',
  '/library': 'Company Library',
  '/ehr/sessions': 'EHR Sessions',
  '/ehr/forms': 'EHR Forms',
  '/ehr/accounting': 'EHR Accounting',
  '/ehr/neuroreport': 'NeuroReport',
  '/team': 'Team',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/auditor': 'System Auditor',
  '/activity-log': 'Activity Log',
  '/advisory': 'Advisory',
  '/icps': 'ICP Profiles',
  '/sops': 'SOPs',
  '/tickets': 'Tickets',
  '/media-appearances': 'Media Appearances',
}

interface PageStat {
  page: string
  label: string
  views: number
  uniqueUsers: number
  avgDuration: number
  clicks: number
  errors: number
  lastVisit: string | null
}

interface TeamStat {
  userId: string
  name: string
  totalViews: number
  totalClicks: number
  totalErrors: number
  topPages: string[]
  aiUsage: number
  searches: number
  lastActive: string | null
  avgSessionMin: number
}

interface ApiStat {
  route: string
  calls: number
  avgMs: number
  p95Ms: number
  errors: number
  errorRate: number
}

function HeatCell({ value, max, label }: { value: number; max: number; label?: string }) {
  const intensity = max > 0 ? value / max : 0
  const bg = intensity === 0 ? '#f9fafb'
    : intensity < 0.2 ? '#dbeafe'
    : intensity < 0.4 ? '#93c5fd'
    : intensity < 0.6 ? '#3b82f6'
    : intensity < 0.8 ? '#1d4ed8'
    : '#1e3a8a'
  const textColor = intensity > 0.4 ? 'white' : '#1f2937'

  return (
    <div className="rounded-md px-2 py-1 text-center min-w-[40px]" style={{ background: bg, color: textColor }}>
      <span className="text-[10px] font-bold">{value}</span>
      {label && <span className="text-[8px] block opacity-80">{label}</span>}
    </div>
  )
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.round(sec / 60)}m`
}

function UsageAnalyticsContent() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')
  const [pageStats, setPageStats] = useState<PageStat[]>([])
  const [teamStats, setTeamStats] = useState<TeamStat[]>([])
  const [apiStats, setApiStats] = useState<ApiStat[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [totals, setTotals] = useState({ views: 0, users: 0, errors: 0, aiUsage: 0, searches: 0 })

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const since = new Date(Date.now() - periodDays * 86400000).toISOString()

  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [members] = await Promise.all([
      fetchTeamMembers(currentOrg.id),
    ])
    setTeamMembers(members)

    const memberMap: Record<string, string> = {}
    members.forEach(m => { if (m.user_id) memberMap[m.user_id] = m.display_name })

    // Fetch raw events for the period
    const { data: events } = await supabase
      .from('usage_events')
      .select('event_type, event_category, event_target, event_data, duration_ms, user_id, occurred_at')
      .eq('org_id', currentOrg.id)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(5000)

    if (!events) { setLoading(false); return }

    // ─── Aggregate page stats ───
    const pageMap: Record<string, PageStat> = {}
    const userSet = new Set<string>()
    let totalAI = 0, totalSearches = 0

    events.forEach(e => {
      if (e.user_id) userSet.add(e.user_id)

      if (e.event_type === 'page_view' && e.event_target) {
        const p = e.event_target
        if (!pageMap[p]) {
          pageMap[p] = {
            page: p, label: PAGE_LABELS[p] || p.replace(/\//g, ' / ').trim(),
            views: 0, uniqueUsers: 0, avgDuration: 0, clicks: 0, errors: 0, lastVisit: null,
          }
        }
        pageMap[p].views++
        if (!pageMap[p].lastVisit || e.occurred_at > pageMap[p].lastVisit!) {
          pageMap[p].lastVisit = e.occurred_at
        }
      }

      if (e.event_type === 'page_exit' && e.event_target && pageMap[e.event_target]) {
        const durations = (pageMap[e.event_target] as any)._durations || []
        durations.push(e.duration_ms || 0)
        ;(pageMap[e.event_target] as any)._durations = durations
      }

      if (e.event_type === 'feature_click' && e.event_target) {
        const page = (e.event_data as any)?.page || e.event_target
        if (pageMap[page]) pageMap[page].clicks++
      }

      if (e.event_type === 'error' && e.event_target) {
        if (pageMap[e.event_target]) pageMap[e.event_target].errors++
      }

      if (e.event_type === 'ai_usage') totalAI++
      if (e.event_type === 'search') totalSearches++
    })

    // Calculate avg durations
    Object.values(pageMap).forEach(p => {
      const durations = (p as any)._durations || []
      p.avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
        : 0
      delete (p as any)._durations
    })

    // Calculate unique users per page
    const pageUsers: Record<string, Set<string>> = {}
    events.forEach(e => {
      if (e.event_type === 'page_view' && e.event_target && e.user_id) {
        if (!pageUsers[e.event_target]) pageUsers[e.event_target] = new Set()
        pageUsers[e.event_target].add(e.user_id)
      }
    })
    Object.keys(pageMap).forEach(p => {
      pageMap[p].uniqueUsers = pageUsers[p]?.size || 0
    })

    const sortedPages = Object.values(pageMap).sort((a, b) => b.views - a.views)
    setPageStats(sortedPages)

    // ─── Aggregate team stats ───
    const teamMap: Record<string, TeamStat> = {}
    events.forEach(e => {
      if (!e.user_id) return
      if (!teamMap[e.user_id]) {
        teamMap[e.user_id] = {
          userId: e.user_id,
          name: memberMap[e.user_id] || e.user_id.slice(0, 8) + '...',
          totalViews: 0, totalClicks: 0, totalErrors: 0,
          topPages: [], aiUsage: 0, searches: 0,
          lastActive: null, avgSessionMin: 0,
        }
      }
      const t = teamMap[e.user_id]
      if (e.event_type === 'page_view') t.totalViews++
      if (e.event_type === 'feature_click') t.totalClicks++
      if (e.event_type === 'error') t.totalErrors++
      if (e.event_type === 'ai_usage') t.aiUsage++
      if (e.event_type === 'search') t.searches++
      if (!t.lastActive || e.occurred_at > t.lastActive) t.lastActive = e.occurred_at
    })

    // Top pages per user
    const userPages: Record<string, Record<string, number>> = {}
    events.forEach(e => {
      if (e.event_type === 'page_view' && e.user_id && e.event_target) {
        if (!userPages[e.user_id]) userPages[e.user_id] = {}
        userPages[e.user_id][e.event_target] = (userPages[e.user_id][e.event_target] || 0) + 1
      }
    })
    Object.keys(teamMap).forEach(uid => {
      const pages = userPages[uid] || {}
      teamMap[uid].topPages = Object.entries(pages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([p]) => PAGE_LABELS[p] || p)
    })

    setTeamStats(Object.values(teamMap).sort((a, b) => b.totalViews - a.totalViews))

    // ─── API health ───
    const { data: apiEvents } = await supabase
      .from('api_health_log')
      .select('route, method, status_code, duration_ms, error_message')
      .eq('org_id', currentOrg.id)
      .gte('occurred_at', since)
      .limit(2000)

    const apiMap: Record<string, { calls: number; durations: number[]; errors: number }> = {}
    ;(apiEvents || []).forEach((e: any) => {
      const key = `${e.method} ${e.route}`
      if (!apiMap[key]) apiMap[key] = { calls: 0, durations: [], errors: 0 }
      apiMap[key].calls++
      if (e.duration_ms) apiMap[key].durations.push(e.duration_ms)
      if (e.status_code >= 400) apiMap[key].errors++
    })

    const sortedApi = Object.entries(apiMap).map(([route, d]) => {
      const sorted = d.durations.sort((a, b) => a - b)
      return {
        route,
        calls: d.calls,
        avgMs: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        p95Ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] || 0 : 0,
        errors: d.errors,
        errorRate: d.calls > 0 ? Math.round((d.errors / d.calls) * 100) : 0,
      }
    }).sort((a, b) => b.calls - a.calls)

    setApiStats(sortedApi)

    const totalViews = sortedPages.reduce((s, p) => s + p.views, 0)
    const totalErrors = sortedPages.reduce((s, p) => s + p.errors, 0)
    setTotals({
      views: totalViews,
      users: userSet.size,
      errors: totalErrors,
      aiUsage: totalAI,
      searches: totalSearches,
    })

    setLoading(false)
  }, [currentOrg?.id, since])

  useEffect(() => { load() }, [load])

  // ─── Sunset candidates: pages with <5 views in period ───
  const sunsetCandidates = pageStats.filter(p => p.views < 5).sort((a, b) => a.views - b.views)
  const hotPages = [...pageStats].sort((a, b) => b.views - a.views).slice(0, 10)
  const errorPages = [...pageStats].filter(p => p.errors > 0).sort((a, b) => b.errors - a.errors)
  const neverVisited = Object.keys(PAGE_LABELS).filter(p => !pageStats.find(s => s.page === p))

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'api', label: 'API Health', icon: Zap },
    { id: 'sunset', label: 'Sunset', icon: Snowflake },
  ]

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark flex items-center gap-2">
            <BarChart3 size={20} className="text-np-blue" /> Usage Analytics
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Platform telemetry, team performance, and feature adoption · Admin only</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-0.5 p-0.5 bg-gray-50 rounded-lg">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all ${
                  period === p ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400'
                }`}>{p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}</button>
            ))}
          </div>
          <button onClick={load} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Page Views', value: totals.views, icon: Eye, color: '#228DC4' },
          { label: 'Active Users', value: totals.users, icon: Users, color: '#2A9D8F' },
          { label: 'Client Errors', value: totals.errors, icon: XCircle, color: '#ef4444' },
          { label: 'AI Usage', value: totals.aiUsage, icon: Brain, color: '#8b5cf6' },
          { label: 'Searches', value: totals.searches, icon: Search, color: '#f59e0b' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon size={13} style={{ color: kpi.color }} />
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{kpi.label}</span>
            </div>
            <p className="text-2xl font-bold text-np-dark">{kpi.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-0.5 bg-gray-50 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === t.id ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400'
            }`}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>
      ) : (
        <>
          {/* ═══ OVERVIEW TAB ═══ */}
          {tab === 'overview' && (
            <div className="space-y-4">
              {/* Hot Pages */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <h3 className="text-sm font-bold text-np-dark mb-3 flex items-center gap-1.5">
                  <Flame size={14} className="text-orange-500" /> Most Used Pages
                </h3>
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                    <div className="col-span-4">Page</div>
                    <div className="col-span-1 text-center">Views</div>
                    <div className="col-span-1 text-center">Users</div>
                    <div className="col-span-2 text-center">Avg Time</div>
                    <div className="col-span-1 text-center">Clicks</div>
                    <div className="col-span-1 text-center">Errors</div>
                    <div className="col-span-2">Heat</div>
                  </div>
                  {hotPages.map((p, i) => {
                    const maxViews = hotPages[0]?.views || 1
                    const pct = Math.round((p.views / maxViews) * 100)
                    return (
                      <div key={p.page} className="grid grid-cols-12 gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 items-center">
                        <div className="col-span-4">
                          <span className="text-[10px] text-gray-400 mr-1.5">{i + 1}.</span>
                          <span className="text-xs font-medium text-np-dark">{p.label}</span>
                          <span className="text-[9px] text-gray-400 ml-1">{p.page}</span>
                        </div>
                        <div className="col-span-1 text-center text-xs font-bold text-np-dark">{p.views}</div>
                        <div className="col-span-1 text-center text-xs text-gray-500">{p.uniqueUsers}</div>
                        <div className="col-span-2 text-center text-xs text-gray-500">{fmtDuration(p.avgDuration)}</div>
                        <div className="col-span-1 text-center text-xs text-gray-500">{p.clicks}</div>
                        <div className="col-span-1 text-center">
                          {p.errors > 0 ? (
                            <span className="text-xs font-bold text-red-500">{p.errors}</span>
                          ) : (
                            <span className="text-xs text-gray-300">0</span>
                          )}
                        </div>
                        <div className="col-span-2">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{
                              width: `${pct}%`,
                              background: pct > 60 ? '#228DC4' : pct > 30 ? '#93c5fd' : '#dbeafe',
                            }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Error-prone pages */}
              {errorPages.length > 0 && (
                <div className="bg-white rounded-xl border border-red-100 p-4">
                  <h3 className="text-sm font-bold text-np-dark mb-3 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-red-500" /> Pages With Errors
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {errorPages.map(p => (
                      <div key={p.page} className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg">
                        <span className="text-xs font-medium text-np-dark">{p.label}</span>
                        <span className="text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded">{p.errors} errors</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Device breakdown */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <h3 className="text-sm font-bold text-np-dark mb-3">Device Breakdown</h3>
                <div className="flex gap-4">
                  {[
                    { icon: Monitor, label: 'Desktop', key: 'desktop' },
                    { icon: Tablet, label: 'Tablet', key: 'tablet' },
                    { icon: Smartphone, label: 'Mobile', key: 'mobile' },
                  ].map(d => (
                    <div key={d.key} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                      <d.icon size={14} className="text-gray-400" />
                      <span className="text-xs text-gray-600">{d.label}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400 self-center ml-2">
                    Device data populates after events accumulate
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TEAM TAB ═══ */}
          {tab === 'team' && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-np-dark mb-3">Team Member Activity</h3>
              <div className="space-y-1">
                <div className="grid grid-cols-12 gap-2 px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                  <div className="col-span-3">Member</div>
                  <div className="col-span-1 text-center">Views</div>
                  <div className="col-span-1 text-center">Clicks</div>
                  <div className="col-span-1 text-center">AI</div>
                  <div className="col-span-1 text-center">Search</div>
                  <div className="col-span-1 text-center">Errors</div>
                  <div className="col-span-2">Top Pages</div>
                  <div className="col-span-2">Last Active</div>
                </div>
                {teamStats.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">No team activity tracked yet</p>
                ) : teamStats.map(t => (
                  <div key={t.userId} className="grid grid-cols-12 gap-2 px-3 py-2.5 rounded-lg hover:bg-gray-50 items-center">
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-np-blue to-teal flex items-center justify-center text-[8px] font-bold text-white">
                        {t.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-np-dark truncate">{t.name}</span>
                    </div>
                    <div className="col-span-1 text-center text-xs font-bold text-np-dark">{t.totalViews}</div>
                    <div className="col-span-1 text-center text-xs text-gray-500">{t.totalClicks}</div>
                    <div className="col-span-1 text-center">
                      {t.aiUsage > 0 ? (
                        <span className="text-xs font-medium text-purple-600">{t.aiUsage}</span>
                      ) : <span className="text-xs text-gray-300">0</span>}
                    </div>
                    <div className="col-span-1 text-center text-xs text-gray-500">{t.searches}</div>
                    <div className="col-span-1 text-center">
                      {t.totalErrors > 0 ? (
                        <span className="text-xs font-bold text-red-500">{t.totalErrors}</span>
                      ) : <span className="text-xs text-gray-300">0</span>}
                    </div>
                    <div className="col-span-2">
                      <div className="flex flex-wrap gap-1">
                        {t.topPages.map(p => (
                          <span key={p} className="text-[8px] px-1 py-0.5 bg-gray-50 text-gray-500 rounded">{p}</span>
                        ))}
                      </div>
                    </div>
                    <div className="col-span-2 text-[10px] text-gray-400">
                      {t.lastActive ? new Date(t.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ API HEALTH TAB ═══ */}
          {tab === 'api' && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-np-dark mb-3">API Route Performance</h3>
              {apiStats.length === 0 ? (
                <div className="text-center py-12">
                  <Zap size={28} className="mx-auto text-gray-400/20 mb-2" />
                  <p className="text-xs text-gray-400">No API health data yet</p>
                  <p className="text-[10px] text-gray-400 mt-1">API tracking requires the withApiTracking wrapper on routes</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                    <div className="col-span-5">Route</div>
                    <div className="col-span-1 text-center">Calls</div>
                    <div className="col-span-2 text-center">Avg</div>
                    <div className="col-span-2 text-center">P95</div>
                    <div className="col-span-1 text-center">Errors</div>
                    <div className="col-span-1 text-center">Rate</div>
                  </div>
                  {apiStats.map(a => (
                    <div key={a.route} className="grid grid-cols-12 gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 items-center">
                      <div className="col-span-5 text-xs font-mono text-np-dark truncate">{a.route}</div>
                      <div className="col-span-1 text-center text-xs text-gray-500">{a.calls}</div>
                      <div className="col-span-2 text-center">
                        <span className={`text-xs font-medium ${a.avgMs > 2000 ? 'text-red-500' : a.avgMs > 500 ? 'text-amber-500' : 'text-green-600'}`}>
                          {fmtDuration(a.avgMs)}
                        </span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className={`text-xs ${a.p95Ms > 5000 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                          {fmtDuration(a.p95Ms)}
                        </span>
                      </div>
                      <div className="col-span-1 text-center">
                        {a.errors > 0 ? (
                          <span className="text-xs font-bold text-red-500">{a.errors}</span>
                        ) : <span className="text-xs text-gray-300">0</span>}
                      </div>
                      <div className="col-span-1 text-center">
                        {a.errorRate > 0 ? (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            a.errorRate > 10 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                          }`}>{a.errorRate}%</span>
                        ) : <span className="text-[10px] text-green-500">0%</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ SUNSET TAB ═══ */}
          {tab === 'sunset' && (
            <div className="space-y-4">
              {/* Never visited */}
              {neverVisited.length > 0 && (
                <div className="bg-white rounded-xl border border-blue-100 p-4">
                  <h3 className="text-sm font-bold text-np-dark mb-2 flex items-center gap-1.5">
                    <Snowflake size={14} className="text-blue-500" /> Never Visited ({period})
                  </h3>
                  <p className="text-[10px] text-gray-400 mb-3">These pages had zero visits in the selected period. Consider removing or consolidating.</p>
                  <div className="flex flex-wrap gap-2">
                    {neverVisited.map(p => (
                      <div key={p} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg">
                        <Snowflake size={10} className="text-blue-400" />
                        <span className="text-xs font-medium text-np-dark">{PAGE_LABELS[p]}</span>
                        <span className="text-[9px] text-gray-400">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Low usage */}
              {sunsetCandidates.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-100 p-4">
                  <h3 className="text-sm font-bold text-np-dark mb-2 flex items-center gap-1.5">
                    <TrendingDown size={14} className="text-amber-500" /> Low Usage (&lt;5 views in {period})
                  </h3>
                  <div className="space-y-1">
                    {sunsetCandidates.map(p => (
                      <div key={p.page} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-amber-50/50">
                        <div>
                          <span className="text-xs font-medium text-np-dark">{p.label}</span>
                          <span className="text-[9px] text-gray-400 ml-2">{p.page}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">{p.views} views</span>
                          <span className="text-xs text-gray-500">{p.uniqueUsers} users</span>
                          {p.lastVisit && (
                            <span className="text-[10px] text-gray-400">
                              last: {new Date(p.lastVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendation */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-np-dark mb-2">Recommendations</h3>
                <div className="space-y-2 text-xs text-gray-600">
                  <p>Pages with <strong>zero visits</strong> in 30+ days are strong candidates for removal or consolidation into existing pages.</p>
                  <p>Pages with <strong>views but no clicks</strong> suggest users land there but don&apos;t find what they need — consider redesigning.</p>
                  <p>Pages with <strong>high error counts</strong> need immediate debugging attention.</p>
                  <p>Track this dashboard weekly to identify adoption trends and make data-driven decisions about the platform&apos;s scope.</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function UsageAnalyticsPage() {
  return (
    <PermissionGate module="usage_analytics" level="view">
      <UsageAnalyticsContent />
    </PermissionGate>
  )
}
