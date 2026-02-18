'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import {
  Activity, Search, Filter, ChevronDown, ChevronRight, Clock,
  User, FileText, Eye, Pencil, Trash2, Plus, Lock, Unlock, Users,
  LogIn, LogOut, Download, RefreshCw, Calendar, BarChart3, Shield,
} from 'lucide-react'

interface AuditEntry {
  id: string
  user_id: string
  user_name: string
  user_email: string
  action: string
  resource_type: string
  resource_id: string | null
  resource_name: string | null
  details: Record<string, any>
  page_path: string | null
  session_id: string | null
  created_at: string
}

interface ChangeEntry {
  id: string
  user_name: string
  resource_type: string
  resource_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  change_type: string
  created_at: string
}

interface UserStats {
  user_id: string
  user_name: string
  total_actions: number
  active_days: number
  creates: number
  updates: number
  deletes: number
  views: number
  last_active: string
}

const ACTION_ICONS: Record<string, any> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  view: Eye,
  login: LogIn,
  logout: LogOut,
  lock: Lock,
  unlock: Unlock,
  collaborate: Users,
  export: Download,
}

const ACTION_COLORS: Record<string, string> = {
  create: 'text-green-600 bg-green-50',
  update: 'text-blue-600 bg-blue-50',
  delete: 'text-red-600 bg-red-50',
  view: 'text-gray-500 bg-gray-50',
  login: 'text-indigo-600 bg-indigo-50',
  logout: 'text-gray-400 bg-gray-50',
  lock: 'text-amber-600 bg-amber-50',
  unlock: 'text-green-600 bg-green-50',
  collaborate: 'text-purple-600 bg-purple-50',
  export: 'text-cyan-600 bg-cyan-50',
}

export default function ActivityLogPage() {
  const supabase = createClient()
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { isSuperAdmin, loading: teamLoading, members } = useTeamData()

  const [tab, setTab] = useState<'feed' | 'changes' | 'users'>('feed')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [changes, setChanges] = useState<ChangeEntry[]>([])
  const [userStats, setUserStats] = useState<UserStats[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [resourceFilter, setResourceFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('7d')
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const dateStart = useCallback(() => {
    const now = new Date()
    switch (dateRange) {
      case 'today': return new Date(now.setHours(0, 0, 0, 0)).toISOString()
      case '7d': return new Date(Date.now() - 7 * 86400000).toISOString()
      case '30d': return new Date(Date.now() - 30 * 86400000).toISOString()
      default: return new Date('2020-01-01').toISOString()
    }
  }, [dateRange])

  // Fetch audit log
  const fetchEntries = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    let query = supabase
      .from('audit_log')
      .select('*')
      .eq('org_id', currentOrg.id)
      .gte('created_at', dateStart())
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (actionFilter !== 'all') query = query.eq('action', actionFilter)
    if (userFilter !== 'all') query = query.eq('user_id', userFilter)
    if (resourceFilter !== 'all') query = query.eq('resource_type', resourceFilter)
    if (search) query = query.or(`resource_name.ilike.%${search}%,user_name.ilike.%${search}%`)

    const { data } = await query
    setEntries(data || [])
    setLoading(false)
  }, [currentOrg?.id, dateRange, actionFilter, userFilter, resourceFilter, search, page])

  // Fetch change history
  const fetchChanges = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('change_history')
      .select('*')
      .eq('org_id', currentOrg.id)
      .gte('created_at', dateStart())
      .order('created_at', { ascending: false })
      .limit(100)
    setChanges(data || [])
  }, [currentOrg?.id, dateRange])

  // Fetch user stats
  const fetchUserStats = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('user_activity_summary')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('total_actions', { ascending: false })
    setUserStats(data || [])
  }, [currentOrg?.id])

  useEffect(() => {
    if (tab === 'feed') fetchEntries()
    else if (tab === 'changes') fetchChanges()
    else if (tab === 'users') fetchUserStats()
  }, [tab, fetchEntries, fetchChanges, fetchUserStats])

  // Realtime subscription
  useEffect(() => {
    if (!currentOrg) return
    const channel = supabase
      .channel('audit-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'audit_log',
        filter: `org_id=eq.${currentOrg.id}`,
      }, (payload: any) => {
        if (tab === 'feed') {
          setEntries(prev => [payload.new as AuditEntry, ...prev].slice(0, PAGE_SIZE))
        }
      })
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [currentOrg?.id, tab])

  if (orgLoading || teamLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>
  }

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-16">
        <Shield className="w-12 h-12 text-gray-200 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-np-dark mb-2">Activity Log</h2>
        <p className="text-sm text-gray-500">Only Super Admins can view the activity log.</p>
      </div>
    )
  }

  const uniqueActions = Array.from(new Set(entries.map(e => e.action))).sort()
  const uniqueResources = Array.from(new Set(entries.map(e => e.resource_type))).sort()

  return (
    <div className="mt-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2">
            <Activity className="w-5 h-5 text-np-blue" /> Activity Log
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} - Team activity and audit trail</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchEntries(); fetchChanges(); fetchUserStats() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'feed', label: 'Activity Feed', icon: Activity },
          { key: 'changes', label: 'Field Changes', icon: FileText },
          { key: 'users', label: 'User Stats', icon: BarChart3 },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === t.key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* Filters (feed tab) */}
      {tab === 'feed' && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
              placeholder="Search actions..."
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-48 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
          </div>

          <select value={dateRange} onChange={e => { setDateRange(e.target.value as any); setPage(0) }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>

          <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0) }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            <option value="all">All actions</option>
            {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setPage(0) }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            <option value="all">All users</option>
            {members.map(m => <option key={m.id} value={m.user_id || m.id}>{m.display_name}</option>)}
          </select>

          <select value={resourceFilter} onChange={e => { setResourceFilter(e.target.value); setPage(0) }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            <option value="all">All resources</option>
            {uniqueResources.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ACTIVITY FEED TAB */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'feed' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading && entries.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading activity...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No activity found for the selected filters.</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-50">
                {entries.map(entry => {
                  const Icon = ACTION_ICONS[entry.action] || Activity
                  const colorClass = ACTION_COLORS[entry.action] || 'text-gray-500 bg-gray-50'
                  const isExpanded = expandedEntry === entry.id
                  const time = new Date(entry.created_at)
                  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' })

                  return (
                    <div key={entry.id}>
                      <button
                        onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-np-dark">{entry.user_name}</span>
                            <span className="text-[10px] text-gray-400">{entry.action}</span>
                            <span className="text-[10px] text-gray-500 capitalize">{entry.resource_type.replace('_', ' ')}</span>
                            {entry.resource_name && (
                              <span className="text-[10px] font-medium text-np-blue truncate max-w-[150px]">"{entry.resource_name}"</span>
                            )}
                          </div>
                          {entry.page_path && (
                            <span className="text-[9px] text-gray-300">{entry.page_path}</span>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-[10px] text-gray-400">{timeStr}</span>
                          <span className="text-[9px] text-gray-300 block">{dateStr}</span>
                        </div>
                        {entry.details && Object.keys(entry.details).length > 0 && (
                          isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        )}
                      </button>

                      {/* Expanded details */}
                      {isExpanded && entry.details && Object.keys(entry.details).length > 0 && (
                        <div className="px-4 pb-3 ml-10">
                          <div className="bg-gray-50 rounded-lg p-3 text-[10px] font-mono text-gray-600 space-y-0.5">
                            {Object.entries(entry.details).map(([key, val]) => (
                              <div key={key}>
                                <span className="text-gray-400">{key}:</span>{' '}
                                <span>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                              </div>
                            ))}
                            {entry.session_id && (
                              <div><span className="text-gray-400">session:</span> {entry.session_id}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                  className="text-xs text-gray-500 disabled:text-gray-300">Previous</button>
                <span className="text-[10px] text-gray-400">Page {page + 1} - Showing {entries.length} entries</span>
                <button onClick={() => setPage(page + 1)} disabled={entries.length < PAGE_SIZE}
                  className="text-xs text-gray-500 disabled:text-gray-300">Next</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* FIELD CHANGES TAB */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'changes' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {changes.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No field changes recorded yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {changes.map(c => (
                <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Pencil className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-np-dark">{c.user_name}</span>
                      <span className="text-[10px] text-gray-400">changed</span>
                      <span className="text-[10px] font-medium text-purple-600">{c.field_name}</span>
                      <span className="text-[10px] text-gray-400">on</span>
                      <span className="text-[10px] text-gray-500 capitalize">{c.resource_type.replace('_', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {c.old_value && (
                        <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded line-through max-w-[200px] truncate">
                          {c.old_value}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-300">&#8594;</span>
                      <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded max-w-[200px] truncate">
                        {c.new_value || '(empty)'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">
                    {new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* USER STATS TAB */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'users' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {userStats.length === 0 ? (
            <div className="text-center py-12">
              <BarChart3 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No user activity data yet.</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                <span className="flex-1">User</span>
                <span className="w-16 text-center">Actions</span>
                <span className="w-16 text-center">Days</span>
                <span className="w-16 text-center">Creates</span>
                <span className="w-16 text-center">Edits</span>
                <span className="w-16 text-center">Deletes</span>
                <span className="w-16 text-center">Views</span>
                <span className="w-24 text-right">Last Active</span>
              </div>
              <div className="divide-y divide-gray-50">
                {userStats.map(stat => (
                  <div key={stat.user_id} className="flex items-center px-4 py-2.5 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-np-dark">{stat.user_name}</span>
                    </div>
                    <span className="w-16 text-center text-xs font-bold text-np-dark">{stat.total_actions}</span>
                    <span className="w-16 text-center text-xs text-gray-500">{stat.active_days}</span>
                    <span className="w-16 text-center text-xs text-green-600">{stat.creates}</span>
                    <span className="w-16 text-center text-xs text-blue-600">{stat.updates}</span>
                    <span className="w-16 text-center text-xs text-red-500">{stat.deletes}</span>
                    <span className="w-16 text-center text-xs text-gray-400">{stat.views}</span>
                    <span className="w-24 text-right text-[10px] text-gray-400">
                      {new Date(stat.last_active).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
