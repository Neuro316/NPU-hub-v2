'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import {
  Route, CheckSquare, Megaphone, Target, Brain, Image, BarChart3, Users,
  Lightbulb, ArrowRight, Sparkles, TrendingUp, Zap, Pencil, X, Save,
  Plus, Trash2, Quote, Heart, Globe, Rocket, Eye, Contact2, Activity
} from 'lucide-react'

/* --- Types --- */
interface Stats {
  contacts: number; journeyCards: number; tasks: number; campaigns: number; posts: number
  mediaAssets: number; ideas: number; teamMembers: number; sessions: number
}

interface CompanyOverview {
  who: string; what: string; how: string; why: string
  companyValues: string[]
  teamValues: string[]
  tagline: string
}

const EMPTY_OVERVIEW: CompanyOverview = {
  who: '', what: '', how: '', why: '',
  companyValues: [], teamValues: [], tagline: '',
}

const PILLARS = [
  { key: 'who' as const, label: 'WHO', icon: Users, color: 'text-rose-500', bg: 'bg-rose-50' },
  { key: 'what' as const, label: 'WHAT', icon: Lightbulb, color: 'text-amber-500', bg: 'bg-amber-50' },
  { key: 'how' as const, label: 'HOW', icon: Rocket, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { key: 'why' as const, label: 'WHY', icon: Heart, color: 'text-red-500', bg: 'bg-red-50' },
]

export default function DashboardPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const [stats, setStats] = useState<Stats>({ contacts: 0, journeyCards: 0, tasks: 0, campaigns: 0, posts: 0, mediaAssets: 0, ideas: 0, teamMembers: 0, sessions: 0 })
  const supabase = createClient()

  /* --- Company Overview state --- */
  const [overview, setOverview] = useState<CompanyOverview>(EMPTY_OVERVIEW)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CompanyOverview>(EMPTY_OVERVIEW)
  const [saving, setSaving] = useState(false)
  const [newCompVal, setNewCompVal] = useState('')
  const [newTeamVal, setNewTeamVal] = useState('')

  /* --- Load overview from org_settings --- */
  const loadOverview = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', currentOrg.id)
      .eq('setting_key', 'company_overview')
      .maybeSingle()
    if (data?.setting_value) {
      const val = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value
      setOverview({ ...EMPTY_OVERVIEW, ...val })
    } else {
      setOverview(EMPTY_OVERVIEW)
    }
  }, [currentOrg?.id])

  useEffect(() => { loadOverview() }, [loadOverview])

  /* --- Save overview --- */
  const saveOverview = async () => {
    if (!currentOrg) return
    setSaving(true)
    await supabase.from('org_settings').upsert({
      org_id: currentOrg.id,
      setting_key: 'company_overview',
      setting_value: draft,
    }, { onConflict: 'org_id,setting_key' })
    setOverview(draft)
    setEditing(false)
    setSaving(false)
  }

  const startEdit = () => { setDraft({ ...overview, companyValues: [...overview.companyValues], teamValues: [...overview.teamValues] }); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setNewCompVal(''); setNewTeamVal('') }

  const addValue = (field: 'companyValues' | 'teamValues', val: string) => {
    if (!val.trim()) return
    setDraft(d => ({ ...d, [field]: [...d[field], val.trim()] }))
    if (field === 'companyValues') setNewCompVal(''); else setNewTeamVal('')
  }

  const removeValue = (field: 'companyValues' | 'teamValues', idx: number) => {
    setDraft(d => ({ ...d, [field]: d[field].filter((_, i) => i !== idx) }))
  }

  /* --- Stats loading --- */
  useEffect(() => {
    if (!currentOrg) return
    Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('journey_cards').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('kanban_tasks').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('media_assets').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('ideas').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('team_profiles').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('ehr_session_notes').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
    ]).then(([contacts, cards, tasks, campaigns, posts, media, ideas, team, sessions]) => {
      setStats({
        contacts: contacts.count || 0,
        journeyCards: cards.count || 0, tasks: tasks.count || 0,
        campaigns: campaigns.count || 0, posts: posts.count || 0,
        mediaAssets: media.count || 0, ideas: ideas.count || 0,
        teamMembers: team.count || 0, sessions: sessions.count || 0,
      })
    }).catch(() => {})
  }, [currentOrg?.id])

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const hasContent = overview.who || overview.what || overview.how || overview.why ||
    overview.companyValues.length > 0 || overview.teamValues.length > 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-np-dark">{greeting}, {firstName}</h1>
        <p className="text-sm text-gray-500 mt-1">{currentOrg?.name} · NPU Hub</p>
      </div>

      {/* ======= COMPANY OVERVIEW ======= */}
      <div className="bg-white border border-gray-100 rounded-2xl mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
          <h2 className="text-sm font-bold text-np-dark">Company Overview</h2>
          {!editing ? (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-np-dark bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
              <Pencil className="w-3 h-3" /> Edit Values
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={cancelEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-np-dark bg-gray-50 rounded-lg transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
              <button onClick={saveOverview} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-np-blue hover:bg-np-blue/90 rounded-lg transition-colors disabled:opacity-50">
                <Save className="w-3 h-3" /> {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* --- VIEW MODE --- */}
        {!editing && (
          <div className="px-6 py-5">
            {!hasContent ? (
              <div className="text-center py-8">
                <Globe className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400 mb-3">Define your company's mission and values</p>
                <button onClick={startEdit}
                  className="text-xs font-medium text-np-blue hover:underline">
                  Get Started
                </button>
              </div>
            ) : (
              <>
                {/* WHO / WHAT / HOW / WHY pillars */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {PILLARS.map(p => {
                    const val = overview[p.key]
                    const Icon = p.icon
                    return (
                      <div key={p.key} className="text-center">
                        <div className="flex items-center justify-center gap-1 mb-1.5">
                          <Icon className={`w-3 h-3 ${p.color}`} />
                          <span className={`text-[10px] font-bold tracking-wider ${p.color}`}>{p.label}</span>
                        </div>
                        <p className={`text-sm ${val ? 'text-np-dark' : 'text-gray-300 italic'}`}>
                          {val || 'Not set'}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {/* Values */}
                {(overview.companyValues.length > 0 || overview.teamValues.length > 0) && (
                  <div className="border-t border-gray-100 pt-5 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {overview.companyValues.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-np-blue tracking-wider uppercase mb-3 flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5" /> Company Values
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          {overview.companyValues.map((v, i) => (
                            <div key={i} className="flex items-center gap-2.5">
                              <span className="text-emerald-400 text-sm flex-shrink-0">&#9670;</span>
                              <span className="text-sm text-np-dark font-semibold">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {overview.teamValues.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-rose-500 tracking-wider uppercase mb-3 flex items-center gap-2">
                          <Users className="w-3.5 h-3.5" /> Team Values
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          {overview.teamValues.map((v, i) => (
                            <div key={i} className="flex items-center gap-2.5">
                              <span className="text-rose-400 text-sm flex-shrink-0">&#9670;</span>
                              <span className="text-sm text-np-dark font-semibold">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tagline */}
                {overview.tagline && (
                  <div className="border-t border-gray-50 mt-5 pt-4 text-center">
                    <p className="text-xs text-gray-400 italic">"{overview.tagline}"</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* --- EDIT MODE --- */}
        {editing && (
          <div className="px-6 py-5 space-y-6">
            {/* WHO / WHAT / HOW / WHY */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PILLARS.map(p => (
                <div key={p.key}>
                  <label className={`text-[10px] font-bold tracking-wider uppercase ${p.color} mb-1 block`}>{p.label}</label>
                  <input
                    value={draft[p.key]}
                    onChange={e => setDraft(d => ({ ...d, [p.key]: e.target.value }))}
                    placeholder={p.key === 'who' ? 'Who do you serve?' : p.key === 'what' ? 'What do you offer?' : p.key === 'how' ? 'How do you deliver?' : 'Why does it matter?'}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
              ))}
            </div>

            {/* Company Values */}
            <div>
              <label className="text-[10px] font-bold text-np-blue tracking-wider uppercase mb-2 flex items-center gap-1.5">
                <Globe className="w-3 h-3" /> Company Values
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.companyValues.map((v, i) => (
                  <span key={i} className="flex items-center gap-1 px-2.5 py-1 bg-np-blue/5 text-np-dark text-xs rounded-md font-medium">
                    {v}
                    <button onClick={() => removeValue('companyValues', i)} className="text-gray-400 hover:text-red-500 ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCompVal} onChange={e => setNewCompVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue('companyValues', newCompVal) } }}
                  placeholder="Add a value..."
                  className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue" />
                <button onClick={() => addValue('companyValues', newCompVal)}
                  className="px-2.5 py-1.5 text-xs font-medium text-np-blue bg-np-blue/5 hover:bg-np-blue/10 rounded-lg transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Team Values */}
            <div>
              <label className="text-[10px] font-bold text-purple-500 tracking-wider uppercase mb-2 flex items-center gap-1.5">
                <Users className="w-3 h-3" /> Team Values
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.teamValues.map((v, i) => (
                  <span key={i} className="flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 text-xs rounded-md font-medium">
                    {v}
                    <button onClick={() => removeValue('teamValues', i)} className="text-gray-400 hover:text-red-500 ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newTeamVal} onChange={e => setNewTeamVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue('teamValues', newTeamVal) } }}
                  placeholder="Add a value..."
                  className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue" />
                <button onClick={() => addValue('teamValues', newTeamVal)}
                  className="px-2.5 py-1.5 text-xs font-medium text-purple-500 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Tagline */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-1 flex items-center gap-1.5">
                <Quote className="w-3 h-3" /> Tagline
              </label>
              <input
                value={draft.tagline}
                onChange={e => setDraft(d => ({ ...d, tagline: e.target.value }))}
                placeholder="Your company motto or mission statement..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
              />
            </div>
          </div>
        )}
      </div>

      {/* ======= STATS GRID ======= */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { label: 'Contacts', value: stats.contacts, icon: Contact2, color: '#2A9D8F', href: '/crm/contacts' },
          { label: 'Sessions', value: stats.sessions, icon: Activity, color: '#228DC4', href: '/ehr/sessions' },
          { label: 'Journey Cards', value: stats.journeyCards, icon: Route, color: '#386797', href: '/journeys' },
          { label: 'Active Tasks', value: stats.tasks, icon: CheckSquare, color: '#F59E0B', href: '/tasks' },
          { label: 'Campaigns', value: stats.campaigns, icon: Megaphone, color: '#8B5CF6', href: '/campaigns' },
          { label: 'Social Posts', value: stats.posts, icon: Target, color: '#E4405F', href: '/social' },
        ].map((stat, i) => (
          <Link key={i} href={stat.href}
            className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md hover:border-gray-200 transition-all">
            <div className="flex items-center justify-between mb-3">
              <stat.icon className="w-5 h-5" style={{ color: stat.color }} />
              <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <p className="text-2xl font-bold text-np-dark">{stat.value}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* ======= QUICK ACTIONS ======= */}
      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'New Contact', icon: Contact2, href: '/crm/contacts', color: '#2A9D8F' },
            { label: 'View Pipeline', icon: Target, href: '/crm/pipelines', color: '#386797' },
            { label: 'Create Post', icon: Megaphone, href: '/social', color: '#E4405F' },
            { label: 'Add Task', icon: CheckSquare, href: '/tasks', color: '#F59E0B' },
          ].map((action, i) => (
            <Link key={i} href={action.href}
              className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 hover:shadow-sm hover:border-gray-200 transition-all">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: action.color + '15' }}>
                <action.icon className="w-4 h-4" style={{ color: action.color }} />
              </div>
              <span className="text-xs font-semibold text-np-dark">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ======= BOTTOM PANELS ======= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-np-blue" />
            <h3 className="text-xs font-bold text-np-dark">Campaign Intelligence</h3>
            <span className="text-[8px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">Bayesian</span>
          </div>
          {stats.campaigns > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Ranking engine active. Publish more content to sharpen campaign stack recommendations.</p>
              <Link href="/analytics" className="text-xs text-np-blue font-medium flex items-center gap-1 hover:underline">
                View Analytics <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Create your first campaign to activate the Bayesian ranking engine.</p>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-green-500" />
            <h3 className="text-xs font-bold text-np-dark">Team</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-np-dark">{stats.teamMembers}</p>
              <p className="text-[10px] text-gray-500">Active members</p>
            </div>
            <Link href="/team" className="text-xs text-np-blue font-medium flex items-center gap-1 hover:underline">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
