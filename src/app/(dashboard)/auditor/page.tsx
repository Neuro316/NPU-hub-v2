'use client'

import { useState, useEffect, useCallback } from 'react'
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Database, Globe, Key, Layers, Link2, Loader2, RefreshCw, Search, Server, Shield, Sparkles, XCircle, Zap, ArrowUpRight, Cpu, GitBranch, Box, Wrench, TrendingDown, Unplug, FileWarning, Timer, ExternalLink, ClipboardCopy, BarChart3 } from 'lucide-react'

const MODULE_COLORS: Record<string, string> = {
  core: '#386797', crm: '#3B82F6', marketing: '#8B5CF6', email: '#F59E0B',
  sms: '#10B981', voice: '#EF4444', twilio: '#E1306C', content: '#2A9D8F',
  operations: '#6366f1', admin: '#64748B', ai: '#8B5CF6', ehr: '#10B981',
  accounting: '#F59E0B', analytics: '#3B82F6', automation: '#E76F51',
  integrations: '#0EA5E9', compliance: '#DC2626',
}

const STATUS_ICONS: Record<string, any> = {
  ok: { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' },
  configured: { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' },
  fresh: { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: '#FFFBEB' },
  partial: { icon: AlertTriangle, color: '#F59E0B', bg: '#FFFBEB' },
  aging: { icon: Clock, color: '#F59E0B', bg: '#FFFBEB' },
  error: { icon: XCircle, color: '#EF4444', bg: '#FEF2F2' },
  missing: { icon: XCircle, color: '#EF4444', bg: '#FEF2F2' },
  stale: { icon: TrendingDown, color: '#EF4444', bg: '#FEF2F2' },
  skip: { icon: Clock, color: '#9CA3AF', bg: '#F9FAFB' },
  empty: { icon: Clock, color: '#9CA3AF', bg: '#F9FAFB' },
  info: { icon: Activity, color: '#3B82F6', bg: '#EFF6FF' },
  production: { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' },
  beta: { icon: Zap, color: '#F59E0B', bg: '#FFFBEB' },
  stub: { icon: Clock, color: '#9CA3AF', bg: '#F9FAFB' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_ICONS[status] || STATUS_ICONS.skip
  const Icon = s.icon
  return <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: s.bg, color: s.color }}><Icon className="w-3 h-3" />{status}</span>
}

function ScoreRing({ score }: { score: number }) {
  const r = 54, c = 2 * Math.PI * r, offset = c - (score / 100) * c
  const color = score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444'
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#F1F5F9" strokeWidth="8" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] text-gray-400 font-medium">/ 100</span>
      </div>
    </div>
  )
}

function Section({ title, icon: Icon, count, countColor, children, defaultOpen = false }: { title: string; icon: any; count?: number; countColor?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-bold text-np-dark flex-1 text-left">{title}</span>
        {count !== undefined && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: (countColor || '#6B7280') + '15', color: countColor || '#6B7280' }}>{count}</span>}
        {open ? <ChevronDown className="w-4 h-4 text-gray-300" /> : <ChevronRight className="w-4 h-4 text-gray-300" />}
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </div>
  )
}

type TabKey = 'overview' | 'pages' | 'tables' | 'apis' | 'connections' | 'integrity' | 'repair' | 'env'

export default function AuditorPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabKey>('overview')
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('all')
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scanHistory, setScanHistory] = useState<Array<{ time: string; score: number; issues: number }>>([])

  const runScan = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auditor')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setData(d)
      setScanHistory(prev => [...prev.slice(-9), { time: d.scanTime, score: d.summary?.overallScore || 0, issues: d.summary?.totalIssues || 0 }])
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { runScan() }, [])

  const getAiDiagnosis = async () => {
    if (!data?.claudePrompt) return
    setAiLoading(true); setAiSuggestion(null)
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: data.claudePrompt }], campaignContext: { type: 'social_designer', systemOverride: 'You are a senior full-stack engineer diagnosing a production Next.js 14 + Supabase application called NPU Hub. Give precise, actionable fixes with exact file paths, SQL statements, and TypeScript code. Format with markdown headers and code blocks.' } }) })
      const d = await res.json(); setAiSuggestion(d.content || d.message || 'No response')
    } catch { setAiSuggestion('Failed to get AI diagnosis.') }
    setAiLoading(false)
  }

  const copyPrompt = () => {
    if (!data?.claudePrompt) return
    navigator.clipboard.writeText(data.claudePrompt)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const allModules = data ? Array.from(new Set([...(data.siteMap || []).map((p: any) => p.module), ...(data.apiRoutes || []).map((a: any) => a.module), ...(data.tableHealth || []).map((t: any) => t.module)])).sort() as string[] : []
  const filterByModule = (items: any[]) => moduleFilter === 'all' ? items : items.filter(i => i.module === moduleFilter)
  const filterBySearch = (items: any[], keys: string[]) => {
    if (!search) return items
    const s = search.toLowerCase()
    return items.filter(i => keys.some(k => String(i[k] || '').toLowerCase().includes(s)))
  }

  const issuesCount = data?.summary?.totalIssues || 0

  const TABS: Array<[TabKey, string, any, number?]> = [
    ['overview', 'Overview', BarChart3],
    ['pages', 'Pages', Layers, data?.summary?.pages?.total],
    ['tables', 'Tables', Database, data?.summary?.tables?.total],
    ['apis', 'APIs', Globe, data?.summary?.apis?.total],
    ['connections', 'Connections', GitBranch, data?.summary?.connections],
    ['integrity', 'Integrity', Shield, data?.summary?.integrity?.total],
    ['repair', 'Repair', Wrench, issuesCount || undefined],
    ['env', 'Env', Key, data?.summary?.env?.total],
  ]

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2"><Shield className="w-5 h-5 text-np-blue" /> System Auditor</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">{data ? `Last scan: ${new Date(data.scanTime).toLocaleString()} · ${data.summary?.scanMs}ms · ${data.summary?.totalIssues || 0} issues` : 'Run a scan to begin'}</p>
        </div>
        <div className="flex items-center gap-2">
          {issuesCount > 0 && (
            <button onClick={() => setTab('repair')} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1">
              <Wrench className="w-3 h-3" /> {issuesCount} Issues
            </button>
          )}
          <button onClick={runScan} disabled={loading} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-np-blue text-white hover:bg-np-blue/90 disabled:opacity-50 flex items-center gap-1">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {loading ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3"><p className="text-sm text-red-600">{error}</p></div>}

      {/* AI Response Banner */}
      {aiSuggestion && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-3 max-h-[350px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-purple-50 py-1"><Sparkles className="w-4 h-4 text-purple-500" /><span className="text-sm font-bold text-purple-700">Claude Repair Analysis</span><button onClick={() => setAiSuggestion(null)} className="ml-auto text-purple-400 hover:text-purple-600 text-xs font-bold">Close</button></div>
          <pre className="text-[11px] text-purple-900 whitespace-pre-wrap leading-relaxed">{aiSuggestion}</pre>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {TABS.map(([k, l, Icon, count]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${tab === k ? 'bg-np-blue text-white border-np-blue' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'} ${k === 'repair' && issuesCount > 0 ? (tab === k ? '' : '!border-amber-300 !bg-amber-50 !text-amber-700') : ''}`}>
            <Icon className="w-3 h-3" />{l}{count !== undefined && <span className={`text-[8px] px-1 rounded ${tab === k ? 'bg-white/20' : 'bg-gray-200/50'}`}>{count}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1"><Search className="w-3 h-3 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="text-[10px] w-28 outline-none placeholder-gray-300" /></div>
          <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="text-[10px] border border-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Modules</option>
            {allModules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {!data && !loading && <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center"><Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h2 className="text-lg font-semibold text-np-dark mb-2">System Auditor</h2><p className="text-sm text-gray-500 mb-4">Scan your entire platform — database tables, API routes, field connections, environment variables, data integrity, service health, and dependency chains.</p><button onClick={runScan} className="text-sm py-2.5 px-5 bg-np-blue text-white rounded-lg font-bold">Run First Scan</button></div>}

        {loading && <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center"><Loader2 className="w-8 h-8 text-np-blue animate-spin mx-auto mb-4" /><p className="text-sm text-gray-500">Scanning 75+ tables, 39 APIs, 33 connections, external services...</p></div>}

        {/* ═══════════════════════════ OVERVIEW ═══════════════════════════ */}
        {data && !loading && tab === 'overview' && (<>
          <div className="grid grid-cols-[auto_1fr] gap-4">
            <div className="bg-white border border-gray-100 rounded-xl p-6 flex flex-col items-center">
              <ScoreRing score={data.summary.overallScore} />
              <span className="text-[10px] font-bold text-gray-400 mt-2">HEALTH SCORE</span>
              {scanHistory.length > 1 && (
                <div className="mt-2 flex items-center gap-1">
                  {scanHistory.slice(-5).map((h, i) => <div key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: h.score >= 80 ? '#10B981' : h.score >= 60 ? '#F59E0B' : '#EF4444' }} title={`${h.score} — ${new Date(h.time).toLocaleTimeString()}`} />)}
                  <span className="text-[8px] text-gray-300 ml-1">history</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Tables', icon: Database, ok: data.summary.tables.ok, total: data.summary.tables.total, bad: data.summary.tables.missing + data.summary.tables.error },
                { label: 'APIs', icon: Globe, ok: data.summary.apis.total, total: data.summary.apis.total, bad: 0 },
                { label: 'Environment', icon: Key, ok: data.summary.env.ok, total: data.summary.env.total, bad: data.summary.env.missing },
                { label: 'Integrity', icon: Link2, ok: data.summary.integrity.ok, total: data.summary.integrity.total, bad: data.summary.integrity.warnings + data.summary.integrity.errors },
                { label: 'Pages', icon: Layers, ok: data.summary.pages.production, total: data.summary.pages.total, bad: data.summary.pages.stub },
                { label: 'Connections', icon: GitBranch, ok: data.summary.connections, total: data.summary.connections, bad: 0 },
                { label: 'Services', icon: Server, ok: data.summary.services?.ok || 0, total: data.summary.services?.total || 0, bad: data.summary.services?.issues || 0 },
                { label: 'Freshness', icon: Timer, ok: data.summary.freshness?.fresh || 0, total: (data.summary.freshness?.fresh || 0) + (data.summary.freshness?.aging || 0) + (data.summary.freshness?.stale || 0), bad: data.summary.freshness?.stale || 0 },
              ].map(c => (
                <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 mb-1"><c.icon className="w-3.5 h-3.5 text-gray-400" /><span className="text-[9px] font-bold text-gray-400 uppercase">{c.label}</span></div>
                  <div className="flex items-baseline gap-1"><span className="text-xl font-bold text-np-dark">{c.ok}</span><span className="text-[9px] text-gray-400">/ {c.total}</span></div>
                  {c.bad > 0 && <span className="text-[8px] font-bold text-red-500">{c.bad} issues</span>}
                </div>
              ))}
            </div>
          </div>

          {/* External Services */}
          {data.services && (
            <Section title="External Services" icon={Server} count={data.services.length} countColor="#3B82F6" defaultOpen>
              <div className="divide-y divide-gray-100">
                {data.services.map((s: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                    <StatusBadge status={s.status} />
                    <span className="text-[11px] font-bold text-np-dark flex-1">{s.name}</span>
                    <span className="text-[10px] text-gray-500">{s.detail}</span>
                    {s.latency && <span className="text-[9px] text-gray-400">{s.latency}ms</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Data Freshness */}
          {data.freshness && (
            <Section title="Data Freshness" icon={Timer} count={data.freshness.filter((f: any) => f.status === 'stale').length || undefined} countColor="#EF4444" defaultOpen={data.freshness.some((f: any) => f.status === 'stale')}>
              <div className="divide-y divide-gray-100">
                {data.freshness.map((f: any, i: number) => (
                  <div key={i} className={`px-4 py-2 flex items-center gap-3 ${f.status === 'stale' ? 'bg-red-50/30' : f.status === 'aging' ? 'bg-amber-50/30' : ''}`}>
                    <StatusBadge status={f.status} />
                    <span className="text-[11px] font-mono text-np-dark flex-1">{f.table}</span>
                    <span className="text-[10px] text-gray-500">{f.detail}</span>
                    {f.lastActivity && <span className="text-[9px] text-gray-400">{new Date(f.lastActivity).toLocaleDateString()}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Dependency Cascades */}
          {data.cascades?.length > 0 && (
            <Section title="Dependency Cascades" icon={Unplug} count={data.cascades.length} countColor="#EF4444" defaultOpen>
              <div className="divide-y divide-gray-100">
                {data.cascades.map((c: any, i: number) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-[10px] font-bold text-red-700 uppercase">{c.sourceType}</span>
                      <span className="text-[11px] font-mono font-bold text-np-dark">{c.source}</span>
                      <StatusBadge status={c.status} />
                      <span className="text-[9px] text-gray-400 ml-auto">breaks {c.affects.length} items</span>
                    </div>
                    <div className="ml-6 flex flex-wrap gap-1.5">
                      {c.affects.map((a: any, j: number) => (
                        <span key={j} className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${a.type === 'page' ? 'bg-blue-100 text-blue-700' : a.type === 'api' ? 'bg-green-100 text-green-700' : a.type === 'connection' ? 'bg-purple-100 text-purple-700' : 'bg-red-100 text-red-700'}`}>
                          {a.type === 'page' ? '📄' : a.type === 'api' ? '🔌' : a.type === 'connection' ? '🔗' : '⚠️'} {a.path || a.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Module Health */}
          <Section title="Module Health" icon={Box} count={allModules.length} countColor="#3B82F6">
            <div className="p-4 grid grid-cols-4 gap-2">
              {allModules.map(mod => {
                const pages = (data.siteMap || []).filter((p: any) => p.module === mod)
                const tables = (data.tableHealth || []).filter((t: any) => t.module === mod)
                const apis = (data.apiRoutes || []).filter((a: any) => a.module === mod)
                const tBad = tables.filter((t: any) => t.status !== 'ok').length
                return (
                  <div key={mod} className="border rounded-lg p-2.5 cursor-pointer hover:shadow-sm" style={{ borderColor: MODULE_COLORS[mod] + '40' }} onClick={() => { setModuleFilter(mod); setTab('tables') }}>
                    <div className="flex items-center gap-1.5 mb-1"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: MODULE_COLORS[mod] }} /><span className="text-[10px] font-bold" style={{ color: MODULE_COLORS[mod] }}>{mod}</span></div>
                    <div className="space-y-0.5">
                      {pages.length > 0 && <div className="text-[9px] text-gray-500">{pages.length} pages ({pages.filter((p: any) => p.status === 'production').length} prod)</div>}
                      {tables.length > 0 && <div className="text-[9px] text-gray-500">{tables.length} tables {tBad > 0 && <span className="text-red-500 font-bold">({tBad} issues)</span>}</div>}
                      {apis.length > 0 && <div className="text-[9px] text-gray-500">{apis.length} APIs</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        </>)}

        {/* ═══════════════════════════ PAGES ═══════════════════════════ */}
        {data && !loading && tab === 'pages' && (
          <div className="space-y-1">
            {filterBySearch(filterByModule(data.siteMap || []), ['page', 'path', 'description']).map((p: any) => (
              <div key={p.path} className="bg-white border border-gray-100 rounded-lg px-4 py-3 hover:shadow-sm transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 rounded-full" style={{ backgroundColor: MODULE_COLORS[p.module] || '#999' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold text-np-dark">{p.page}</span><StatusBadge status={p.status} /><span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{p.module}</span></div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{p.path} — {p.description}</div>
                  </div>
                </div>
                <div className="ml-5 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {p.tables.length > 0 && <div className="text-[9px] text-gray-400"><Database className="w-3 h-3 inline mr-0.5" />{p.tables.length} tables: <span className="text-gray-600">{p.tables.join(', ')}</span></div>}
                  {p.apis.length > 0 && <div className="text-[9px] text-gray-400"><Globe className="w-3 h-3 inline mr-0.5" />{p.apis.length} APIs: <span className="text-gray-600">{p.apis.join(', ')}</span></div>}
                  {p.linksTo.length > 0 && <div className="text-[9px] text-gray-400"><ArrowUpRight className="w-3 h-3 inline mr-0.5" />Links: <span className="text-np-blue">{p.linksTo.join(', ')}</span></div>}
                  {p.components.length > 0 && <div className="text-[9px] text-gray-400"><Layers className="w-3 h-3 inline mr-0.5" />Components: <span className="text-gray-600">{p.components.join(', ')}</span></div>}
                  {p.hooks.length > 0 && <div className="text-[9px] text-gray-400"><Zap className="w-3 h-3 inline mr-0.5" />Hooks: <span className="text-gray-600">{p.hooks.join(', ')}</span></div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════ TABLES ═══════════════════════════ */}
        {data && !loading && tab === 'tables' && (
          <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-gray-50 border-b border-gray-100"><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Table</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Module</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Status</th><th className="text-right text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Rows</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Used By</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Error</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {filterBySearch(filterByModule(data.tableHealth || []), ['name', 'module', 'error']).map((t: any) => (
                  <tr key={t.name} className={`hover:bg-gray-50 ${t.status !== 'ok' ? (t.status === 'missing' ? 'bg-red-50/30' : 'bg-amber-50/30') : ''}`}>
                    <td className="px-4 py-2"><span className="text-[11px] font-mono font-medium text-np-dark">{t.name}</span></td>
                    <td className="px-4 py-2"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: (MODULE_COLORS[t.module] || '#999') + '15', color: MODULE_COLORS[t.module] || '#999' }}>{t.module}</span></td>
                    <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-2 text-right"><span className="text-[11px] font-mono text-gray-600">{t.rows >= 0 ? t.rows.toLocaleString() : '—'}</span></td>
                    <td className="px-4 py-2"><span className="text-[9px] text-gray-500 max-w-[200px] truncate block">{t.usedBy?.join(', ') || '—'}</span></td>
                    <td className="px-4 py-2"><span className="text-[9px] text-red-500">{t.error || ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════════════════ APIS ═══════════════════════════ */}
        {data && !loading && tab === 'apis' && (
          <div className="space-y-1">
            {filterBySearch(filterByModule(data.apiRoutes || []), ['path', 'name', 'description', 'externalService']).map((a: any) => (
              <div key={a.path} className="bg-white border border-gray-100 rounded-lg px-4 py-2.5 flex items-center gap-3 hover:shadow-sm">
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${a.method === 'POST' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{a.method}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-[11px] font-mono font-medium text-np-dark">{a.path}</span>{a.critical && <span className="text-[8px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">CRITICAL</span>}</div>
                  <div className="text-[9px] text-gray-500">{a.name} — {a.description}</div>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: (MODULE_COLORS[a.module] || '#999') + '15', color: MODULE_COLORS[a.module] || '#999' }}>{a.module}</span>
                {a.externalService && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{a.externalService}</span>}
                {a.tables.length > 0 && <span className="text-[9px] text-gray-400"><Database className="w-3 h-3 inline" /> {a.tables.length}</span>}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════ CONNECTIONS ═══════════════════════════ */}
        {data && !loading && tab === 'connections' && (
          <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-gray-50 border-b border-gray-100"><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">From</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Field</th><th className="text-center text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Type</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">To</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Field</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Description</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {filterBySearch(data.fieldConnections || [], ['from', 'to', 'fromField', 'toField', 'description']).map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2"><span className="text-[10px] font-mono font-medium text-np-dark">{c.from}</span></td>
                    <td className="px-4 py-2"><span className="text-[10px] font-mono text-gray-600">{c.fromField}</span></td>
                    <td className="px-4 py-2 text-center"><span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${c.type === 'foreign_key' ? 'bg-blue-100 text-blue-700' : c.type === 'reciprocal' ? 'bg-green-100 text-green-700' : c.type === 'lookup' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>{c.type.replace('_', ' ')}</span></td>
                    <td className="px-4 py-2"><span className="text-[10px] font-mono font-medium text-np-dark">{c.to}</span></td>
                    <td className="px-4 py-2"><span className="text-[10px] font-mono text-gray-600">{c.toField}</span></td>
                    <td className="px-4 py-2"><span className="text-[9px] text-gray-500">{c.description}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════════════════ INTEGRITY ═══════════════════════════ */}
        {data && !loading && tab === 'integrity' && (
          <div className="space-y-1">
            {(data.integrity || []).map((check: any, i: number) => (
              <div key={i} className={`bg-white border rounded-lg px-4 py-3 ${check.status === 'warning' ? 'border-amber-200 bg-amber-50/30' : check.status === 'error' ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2"><StatusBadge status={check.status} /><span className="text-[11px] font-bold text-np-dark">{check.check}</span></div>
                <p className="text-[10px] text-gray-600 mt-1">{check.detail}</p>
                {check.fix && (
                  <div className="mt-2 bg-gray-900 rounded-lg p-2.5 flex items-start gap-2">
                    <Sparkles className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div><div className="text-[8px] text-amber-400 font-bold uppercase mb-0.5">Suggested Fix</div><code className="text-[10px] text-green-300 font-mono whitespace-pre-wrap">{check.fix}</code></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════ REPAIR TAB ═══════════════════════════ */}
        {data && !loading && tab === 'repair' && (
          <div className="space-y-4">
            {/* Claude Prompt Section */}
            {data.claudePrompt ? (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-100 flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-np-dark">Claude Repair Prompt</h3>
                    <p className="text-[10px] text-gray-500">Auto-generated diagnostic prompt with all {data.allIssues?.length || 0} issues, file paths, table names, and dependency chains. Copy and paste into Claude to get exact fixes.</p>
                  </div>
                  <button onClick={copyPrompt} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
                    {copied ? <><CheckCircle2 className="w-3 h-3" /> Copied!</> : <><ClipboardCopy className="w-3 h-3" /> Copy Prompt</>}
                  </button>
                  <button onClick={getAiDiagnosis} disabled={aiLoading} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 flex items-center gap-1">
                    {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Run AI Diagnosis
                  </button>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <pre className="p-4 text-[10px] font-mono text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50">{data.claudePrompt}</pre>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-green-800">All Systems Healthy</h3>
                <p className="text-[10px] text-green-600 mt-1">No issues detected — no repair prompt needed.</p>
              </div>
            )}

            {/* Categorized Issues */}
            {data.allIssues?.length > 0 && (
              <Section title="Issues by Category" icon={AlertTriangle} count={data.allIssues.length} countColor="#EF4444" defaultOpen>
                <div className="divide-y divide-gray-100">
                  {data.allIssues.map((issue: any, i: number) => (
                    <div key={i} className={`px-4 py-2.5 ${issue.severity === 'critical' ? 'bg-red-50/40' : issue.severity === 'warning' ? 'bg-amber-50/30' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${issue.severity === 'critical' ? 'bg-red-100 text-red-700' : issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' : issue.severity === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{issue.severity}</span>
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{issue.category}</span>
                        <span className="text-[11px] font-mono font-bold text-np-dark">{issue.item}</span>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1 ml-0.5">{issue.detail}</p>
                      {issue.fix && <div className="mt-1.5 bg-gray-900 rounded px-2.5 py-1.5"><code className="text-[9px] text-green-300 font-mono">{issue.fix}</code></div>}
                      {(issue.affectedPages?.length > 0 || issue.affectedApis?.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {issue.affectedPages?.map((p: string) => <span key={p} className="text-[8px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">📄 {p}</span>)}
                          {issue.affectedApis?.map((a: string) => <span key={a} className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">🔌 {a}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Orphans / Dead Code */}
            {data.orphans?.length > 0 && (
              <Section title="Orphans & Dead Code" icon={FileWarning} count={data.orphans.length} countColor="#F59E0B">
                <div className="divide-y divide-gray-100">
                  {data.orphans.map((o: any, i: number) => (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-2">
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${o.type === 'table' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{o.type}</span>
                      <div>
                        <span className="text-[11px] font-mono font-medium text-np-dark">{o.name}</span>
                        <p className="text-[9px] text-gray-500 mt-0.5">{o.detail}</p>
                      </div>
                      <StatusBadge status={o.severity} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Dependency Cascades in Repair Tab too */}
            {data.cascades?.length > 0 && (
              <Section title="Cascade Impact" icon={Unplug} count={data.cascades.reduce((acc: number, c: any) => acc + c.affects.length, 0)} countColor="#EF4444">
                <div className="p-4 space-y-3">
                  {data.cascades.map((c: any, i: number) => (
                    <div key={i} className="border border-red-100 rounded-lg p-3 bg-red-50/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-red-700">If <span className="font-mono">{c.source}</span> fails:</span>
                        <span className="text-[9px] text-red-500">{c.affects.length} items affected</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {c.affects.map((a: any, j: number) => (
                          <span key={j} className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${a.type === 'page' ? 'bg-blue-100 text-blue-700' : a.type === 'api' ? 'bg-green-100 text-green-700' : a.type === 'connection' ? 'bg-purple-100 text-purple-700' : 'bg-red-100 text-red-700'}`}>
                            {a.path || a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ═══════════════════════════ ENVIRONMENT ═══════════════════════════ */}
        {data && !loading && tab === 'env' && (
          <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-gray-50 border-b border-gray-100"><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Variable</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Module</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Status</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Critical</th><th className="text-left text-[9px] font-bold text-gray-400 uppercase px-4 py-2">Value</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(data.env || []).map((e: any) => (
                  <tr key={e.key} className={`hover:bg-gray-50 ${e.status !== 'ok' ? (e.critical ? 'bg-red-50/30' : 'bg-amber-50/30') : ''}`}>
                    <td className="px-4 py-2"><span className="text-[10px] font-mono font-medium text-np-dark">{e.key}</span></td>
                    <td className="px-4 py-2"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: (MODULE_COLORS[e.module] || '#999') + '15', color: MODULE_COLORS[e.module] || '#999' }}>{e.module}</span></td>
                    <td className="px-4 py-2"><StatusBadge status={e.status} /></td>
                    <td className="px-4 py-2">{e.critical && <span className="text-[8px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">REQUIRED</span>}</td>
                    <td className="px-4 py-2"><span className="text-[10px] font-mono text-gray-500">{e.masked}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
