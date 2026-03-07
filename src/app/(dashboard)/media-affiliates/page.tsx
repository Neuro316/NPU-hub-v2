'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  Plus, Search, Filter, ChevronDown, ChevronRight,
  ExternalLink, Copy, Trash2, Edit3, RefreshCw,
  Mic, Radio, Newspaper, Presentation, Users, Monitor,
  Link2, Tag, Calendar, Share2, Bell, CheckCircle2,
  AlertCircle, ArrowRight, Phone, DollarSign, Eye,
  FileText, Send, User, Globe, Megaphone, BarChart3,
  LayoutGrid, Table, Columns3, X,
} from 'lucide-react'

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

interface Appearance {
  id: string
  org_id: string
  type: string
  entry_type: string
  title: string
  platform: string | null
  host: string | null
  host_contact_id: string | null
  recording_date: string | null
  air_date: string | null
  url: string | null
  description: string | null
  key_topics: string[]
  key_quotes: string[]
  verbal_cta: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  promo_code: string | null
  affiliate_tier: string
  status: string
  performance_score: string | null
  social_posts_count: number
  tasks_created: number
  tasks_completed: number
  calendar_events_count: number
  repurposed: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

interface Conversion {
  id: string
  appearance_id: string | null
  contact_name: string | null
  contact_email: string | null
  contact_id: string | null
  conversion_type: string
  source: string
  utm_campaign: string | null
  utm_content: string | null
  promo_code: string | null
  value: number
  personal_outreach_status: string
  notified: boolean
  created_at: string
}

interface ContentPiece {
  id: string
  appearance_id: string
  type: string
  title: string
  platform: string | null
  url: string | null
  status: string
  published_at: string | null
  created_at: string
}

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const TYPE_FILTERS = [
  { key: 'all', label: 'All', icon: Globe },
  { key: 'podcast', label: 'Podcasts', icon: Mic },
  { key: 'interview', label: 'Interviews', icon: Radio },
  { key: 'press', label: 'Press', icon: Newspaper },
  { key: 'speaking', label: 'Speaking', icon: Presentation },
  { key: 'panel', label: 'Panels', icon: Users },
  { key: 'webinar', label: 'Webinars', icon: Monitor },
]

const SUB_TABS = ['Appearances', 'Guest Sheet', 'UTM & Codes', 'Conversions', 'Integrations']

const PIPELINE_STAGES: Record<string, string[]> = {
  podcast: ['prospect', 'pitched', 'booked', 'prepped', 'recorded', 'post_prod', 'live', 'archived'],
  interview: ['prospect', 'pitched', 'confirmed', 'prepped', 'completed', 'published', 'archived'],
  press: ['prospect', 'pitched', 'accepted', 'drafted', 'review', 'published', 'archived'],
  speaking: ['prospect', 'applied', 'accepted', 'prepped', 'delivered', 'follow_up', 'archived'],
  panel: ['prospect', 'invited', 'confirmed', 'prepped', 'delivered', 'archived'],
  webinar: ['prospect', 'planned', 'promoted', 'prepped', 'delivered', 'replay_live', 'archived'],
}

const DEFAULT_STAGES = ['prospect', 'pitched', 'booked', 'prepped', 'completed', 'live', 'archived']

const STAGE_COLORS: Record<string, string> = {
  prospect: 'bg-gray-100 text-gray-600',
  pitched: 'bg-blue-50 text-blue-600',
  applied: 'bg-blue-50 text-blue-600',
  invited: 'bg-blue-50 text-blue-600',
  planned: 'bg-blue-50 text-blue-600',
  booked: 'bg-indigo-50 text-indigo-600',
  confirmed: 'bg-indigo-50 text-indigo-600',
  accepted: 'bg-indigo-50 text-indigo-600',
  prepped: 'bg-purple-50 text-purple-600',
  drafted: 'bg-purple-50 text-purple-600',
  promoted: 'bg-purple-50 text-purple-600',
  recorded: 'bg-amber-50 text-amber-600',
  completed: 'bg-amber-50 text-amber-600',
  delivered: 'bg-amber-50 text-amber-600',
  review: 'bg-amber-50 text-amber-600',
  post_prod: 'bg-orange-50 text-orange-600',
  follow_up: 'bg-orange-50 text-orange-600',
  live: 'bg-green-50 text-green-600',
  published: 'bg-green-50 text-green-600',
  replay_live: 'bg-green-50 text-green-600',
  archived: 'bg-gray-50 text-gray-400',
}

const SCORE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-red-100 text-red-700',
}

const AFFILIATE_TIERS = ['none', 'bronze', 'silver', 'gold', 'platinum']

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  podcast: Mic,
  interview: Radio,
  press: Newspaper,
  speaking: Presentation,
  panel: Users,
  webinar: Monitor,
}

const GUEST_SHEET_SECTIONS = [
  { key: 'bio', title: 'Bio & Headshot', description: 'Your short bio and headshot link for show notes.' },
  { key: 'links', title: 'Links for Show Notes', description: 'Website, social profiles, and landing pages to include in show notes.' },
  { key: 'talking_points', title: 'Talking Points', description: 'Key topics, stories, and frameworks you want to discuss.' },
  { key: 'intro', title: 'Preferred Introduction', description: 'How you prefer the host to introduce you.' },
  { key: 'cross_promo', title: 'Cross-Promotion Requirements', description: 'Social sharing expectations, episode tagging, and promotional agreements.' },
  { key: 'vetting', title: 'Affiliate Vetting', description: 'Internal criteria for evaluating potential affiliate partnerships.', internal: true },
]

const INTEGRATIONS_LIST = [
  { name: 'CRM Contact Linking', description: 'Auto-link hosts to CRM contacts. Creates contact if not found. Tags with podcast-lead on conversion.', priority: 'CRITICAL' },
  { name: 'Task Auto-Creation', description: 'Creates high-priority outreach tasks when conversions arrive. 24h due date for warm leads.', priority: 'CRITICAL' },
  { name: 'Calendar Sync', description: 'Recording dates and air dates sync to Hub calendar. Pre-show prep reminders 48h before.', priority: 'HIGH' },
  { name: 'Social Media Queue', description: 'Auto-generates social post drafts when episodes go live. Cross-promotion tracking.', priority: 'HIGH' },
  { name: 'UTM & Promo Tracking', description: 'Convention: utm_source=podcast, utm_medium=audio, utm_campaign=[show-slug]. Promo codes: PODCAST-[SHOWNAME].', priority: 'HIGH' },
  { name: 'SMS Notifications', description: 'Instant SMS alert when a podcast conversion comes in. Configurable via Twilio env vars.', priority: 'MEDIUM' },
  { name: 'Content Repurposing', description: 'Track content pieces derived from each appearance: clips, blog posts, social cards, newsletters.', priority: 'MEDIUM' },
]

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function MediaAffiliatesPage() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id

  // State
  const [appearances, setAppearances] = useState<Appearance[]>([])
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [contentPieces, setContentPieces] = useState<ContentPiece[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [subTab, setSubTab] = useState('Appearances')
  const [viewMode, setViewMode] = useState<'pipeline' | 'cards' | 'table'>('pipeline')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createEntryType, setCreateEntryType] = useState<'outbound' | 'inbound'>('outbound')
  const [showNewDropdown, setShowNewDropdown] = useState(false)
  const [guestSheetOpen, setGuestSheetOpen] = useState<Record<string, boolean>>({ bio: true })

  // Create form state
  const [form, setForm] = useState({
    type: 'podcast',
    title: '',
    platform: '',
    host: '',
    recording_date: '',
    air_date: '',
    affiliate_tier: 'none',
    promo_code: '',
    utm_campaign: '',
    description: '',
  })

  // ─── Data Loading ──────────────────────────────────

  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)

    const [appRes, convRes, contentRes] = await Promise.all([
      supabase
        .from('media_appearances')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase
        .from('podcast_conversions')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase
        .from('podcast_content_pieces')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
    ])

    if (appRes.error) console.error('loadData: media_appearances error', appRes.error)
    if (convRes.error) console.error('loadData: podcast_conversions error', convRes.error)
    if (contentRes.error) console.error('loadData: podcast_content_pieces error', contentRes.error)
    if (appRes.data) setAppearances(appRes.data)
    if (convRes.data) setConversions(convRes.data)
    if (contentRes.data) setContentPieces(contentRes.data)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── Filtered Data ─────────────────────────────────

  const filtered = useMemo(() => {
    let items = appearances
    if (typeFilter !== 'all') {
      items = items.filter(a => a.type === typeFilter)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.platform?.toLowerCase().includes(q) ||
        a.host?.toLowerCase().includes(q) ||
        a.key_topics?.some(t => t.toLowerCase().includes(q))
      )
    }
    return items
  }, [appearances, typeFilter, searchQuery])

  const stages = useMemo(() => {
    if (typeFilter !== 'all') return PIPELINE_STAGES[typeFilter] || DEFAULT_STAGES
    return DEFAULT_STAGES
  }, [typeFilter])

  // ─── Metrics ───────────────────────────────────────

  const metrics = useMemo(() => {
    const total = appearances.length
    const totalConversions = conversions.length
    const promoUses = conversions.filter(c => c.source === 'promo_code').length
    const enrollments = conversions.filter(c => c.conversion_type === 'course_enroll').length
    const calls = conversions.filter(c => c.conversion_type === 'call_booked').length
    const revenue = conversions.reduce((sum, c) => sum + (c.value || 0), 0)
    return { total, totalConversions, promoUses, enrollments, calls, revenue }
  }, [appearances, conversions])

  const pendingOutreach = useMemo(() =>
    conversions.filter(c => c.personal_outreach_status === 'pending'),
  [conversions])

  // ─── CRUD ──────────────────────────────────────────

  const createAppearance = async () => {
    if (!orgId || !form.title) {
      console.error('createAppearance: missing orgId or title', { orgId, title: form.title })
      return
    }
    const status = createEntryType === 'inbound' ? 'booked' : 'prospect'
    const payload = {
      org_id: orgId,
      type: form.type,
      entry_type: createEntryType,
      title: form.title,
      platform: form.platform || null,
      host: form.host || null,
      recording_date: form.recording_date || null,
      air_date: form.air_date || null,
      description: form.description || null,
      affiliate_tier: form.affiliate_tier,
      promo_code: form.promo_code || null,
      utm_campaign: form.utm_campaign || null,
      utm_source: 'podcast',
      utm_medium: 'audio',
      status,
    }
    console.log('createAppearance: inserting', payload)
    const { data, error } = await supabase.from('media_appearances').insert(payload).select()
    if (error) {
      console.error('createAppearance: Supabase error', error)
      alert(`Failed to create appearance: ${error.message}\n\nCode: ${error.code}\nDetails: ${error.details || 'none'}`)
      return
    }
    console.log('createAppearance: success', data)
    setShowCreateModal(false)
    setForm({ type: 'podcast', title: '', platform: '', host: '', recording_date: '', air_date: '', affiliate_tier: 'none', promo_code: '', utm_campaign: '', description: '' })
    loadData()
  }

  const deleteAppearance = async (id: string) => {
    const { error } = await supabase.from('media_appearances').delete().eq('id', id)
    if (error) {
      console.error('deleteAppearance: Supabase error', error)
      alert(`Failed to delete: ${error.message}`)
      return
    }
    setExpandedCard(null)
    loadData()
  }

  const updateOutreachStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('podcast_conversions').update({ personal_outreach_status: newStatus }).eq('id', id)
    if (error) {
      console.error('updateOutreachStatus: Supabase error', error)
      alert(`Failed to update outreach status: ${error.message}`)
      return
    }
    loadData()
  }

  // ─── Stage label helper ────────────────────────────

  const stageLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  if (!orgId) {
    return <div className="p-8 text-gray-500">Select a workspace to view Media & Affiliates.</div>
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-np-dark">Media & Affiliates</h1>
          <p className="text-sm text-gray-500 mt-1">Track appearances, conversions, and affiliate performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadData()} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNewDropdown(!showNewDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-np-blue text-white rounded-lg hover:bg-np-blue/90 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Appearance
              <ChevronDown className="w-3 h-3" />
            </button>
            {showNewDropdown && (
              <div className="absolute right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-50 w-56">
                <button
                  onClick={() => { setCreateEntryType('outbound'); setShowCreateModal(true); setShowNewDropdown(false) }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 rounded-t-lg"
                >
                  <div className="text-sm font-medium text-np-dark">Outbound</div>
                  <div className="text-xs text-gray-500">You pitched them. Starts at Prospect.</div>
                </button>
                <button
                  onClick={() => { setCreateEntryType('inbound'); setShowCreateModal(true); setShowNewDropdown(false) }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 rounded-b-lg border-t border-gray-50"
                >
                  <div className="text-sm font-medium text-np-dark">Inbound</div>
                  <div className="text-xs text-gray-500">They invited you. Starts at Booked.</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Type Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {TYPE_FILTERS.map(tf => {
          const Icon = tf.icon
          const active = typeFilter === tf.key
          return (
            <button
              key={tf.key}
              onClick={() => setTypeFilter(tf.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tf.label}
            </button>
          )
        })}
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {SUB_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab
                ? 'border-np-blue text-np-blue'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ═══════ APPEARANCES TAB ═══════ */}
      {subTab === 'Appearances' && (
        <div className="space-y-4">
          {/* Search + View Toggle */}
          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search appearances..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
              />
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {([['pipeline', Columns3], ['cards', LayoutGrid], ['table', Table]] as const).map(([mode, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`p-2 rounded-md transition-colors ${
                    viewMode === mode ? 'bg-white shadow-sm text-np-blue' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title={mode.charAt(0).toUpperCase() + mode.slice(1)}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">Loading appearances...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Mic className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No appearances yet</p>
              <p className="text-sm text-gray-400 mt-1">Click &quot;New Appearance&quot; to add your first one.</p>
            </div>
          ) : viewMode === 'pipeline' ? (
            /* ── Pipeline View ── */
            <div className="flex gap-3 overflow-x-auto pb-4">
              {stages.map(stage => {
                const stageItems = filtered.filter(a => a.status === stage)
                return (
                  <div key={stage} className="flex-shrink-0 w-72">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STAGE_COLORS[stage] || 'bg-gray-100 text-gray-600'}`}>
                        {stageLabel(stage)}
                      </span>
                      <span className="text-xs text-gray-400">{stageItems.length}</span>
                    </div>
                    <div className="space-y-2 min-h-[200px]">
                      {stageItems.map(item => (
                        <AppearanceCard
                          key={item.id}
                          item={item}
                          expanded={expandedCard === item.id}
                          onToggle={() => setExpandedCard(expandedCard === item.id ? null : item.id)}
                          onDelete={deleteAppearance}
                          contentPieces={contentPieces.filter(cp => cp.appearance_id === item.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : viewMode === 'cards' ? (
            /* ── Cards View ── */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(item => (
                <AppearanceCard
                  key={item.id}
                  item={item}
                  expanded={expandedCard === item.id}
                  onToggle={() => setExpandedCard(expandedCard === item.id ? null : item.id)}
                  onDelete={deleteAppearance}
                  contentPieces={contentPieces.filter(cp => cp.appearance_id === item.id)}
                />
              ))}
            </div>
          ) : (
            /* ── Table View ── */
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Platform</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Host</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Entry</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Score</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Promo</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Air Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(item => {
                      const TypeIcon = TYPE_ICONS[item.type] || Globe
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedCard(expandedCard === item.id ? null : item.id)}>
                          <td className="px-4 py-3 font-medium text-np-dark max-w-[200px] truncate">{item.title}</td>
                          <td className="px-4 py-3"><TypeIcon className="w-4 h-4 text-gray-500" /></td>
                          <td className="px-4 py-3 text-gray-600">{item.platform || '-'}</td>
                          <td className="px-4 py-3 text-gray-600">{item.host || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                              {stageLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${item.entry_type === 'inbound' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                              {item.entry_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {item.performance_score && (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SCORE_COLORS[item.performance_score] || ''}`}>
                                {item.performance_score}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{item.promo_code || '-'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{item.air_date ? new Date(item.air_date).toLocaleDateString() : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ GUEST SHEET TAB ═══════ */}
      {subTab === 'Guest Sheet' && (
        <div className="space-y-4 max-w-3xl">
          <p className="text-sm text-gray-500">Prepare these sections before each appearance. Hosts often request this info in advance.</p>
          {GUEST_SHEET_SECTIONS.map(section => (
            <div key={section.key} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setGuestSheetOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-np-dark">{section.title}</span>
                  {section.internal && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Internal</span>
                  )}
                </div>
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${guestSheetOpen[section.key] ? 'rotate-90' : ''}`} />
              </button>
              {guestSheetOpen[section.key] && (
                <div className="px-5 pb-5 border-t border-gray-50">
                  <p className="text-sm text-gray-500 mt-3 mb-3">{section.description}</p>
                  <textarea
                    className="w-full h-32 border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue resize-none"
                    placeholder={`Add your ${section.title.toLowerCase()} here...`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══════ UTM & CODES TAB ═══════ */}
      {subTab === 'UTM & Codes' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="font-semibold text-np-dark mb-3">UTM Convention</h3>
            <div className="space-y-2 text-sm font-mono bg-gray-50 rounded-lg p-4">
              <div><span className="text-gray-500">utm_source</span> = <span className="text-np-blue font-semibold">podcast</span></div>
              <div><span className="text-gray-500">utm_medium</span> = <span className="text-np-blue font-semibold">audio</span></div>
              <div><span className="text-gray-500">utm_campaign</span> = <span className="text-np-blue font-semibold">[show-slug]</span></div>
              <div><span className="text-gray-500">utm_content</span> = <span className="text-np-blue font-semibold">[episode-slug]</span></div>
            </div>
            <div className="mt-4 p-3 bg-amber-50 rounded-lg">
              <p className="text-sm text-amber-700">
                <strong>Promo Code Format:</strong> PODCAST-[SHOWNAME] (e.g., PODCAST-HUBERMAN)
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="font-semibold text-np-dark mb-4">Active Promo Codes</h3>
            {appearances.filter(a => a.promo_code).length === 0 ? (
              <p className="text-sm text-gray-400">No promo codes configured yet.</p>
            ) : (
              <div className="space-y-2">
                {appearances.filter(a => a.promo_code).map(a => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="font-mono text-sm font-semibold text-np-dark">{a.promo_code}</span>
                      <span className="text-xs text-gray-500">{a.platform || a.title}</span>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(a.promo_code || '')}
                      className="p-1.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ CONVERSIONS TAB ═══════ */}
      {subTab === 'Conversions' && (
        <div className="space-y-6">
          {/* Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Appearances', value: metrics.total, icon: Mic, color: 'text-np-blue' },
              { label: 'Total Clicks', value: metrics.totalConversions, icon: Eye, color: 'text-indigo-600' },
              { label: 'Promo Uses', value: metrics.promoUses, icon: Tag, color: 'text-purple-600' },
              { label: 'Enrollments', value: metrics.enrollments, icon: CheckCircle2, color: 'text-green-600' },
              { label: 'Calls Booked', value: metrics.calls, icon: Phone, color: 'text-amber-600' },
              { label: 'Revenue', value: `$${metrics.revenue.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-600' },
            ].map(m => {
              const Icon = m.icon
              return (
                <div key={m.label} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${m.color}`} />
                    <span className="text-xs text-gray-500">{m.label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                </div>
              )
            })}
          </div>

          {/* Personal Outreach Queue */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="font-semibold text-np-dark mb-4 flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              Personal Outreach Queue
            </h3>
            {pendingOutreach.length === 0 ? (
              <p className="text-sm text-gray-400">No pending outreach. All caught up!</p>
            ) : (
              <div className="space-y-2">
                {pendingOutreach.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                    <div>
                      <div className="font-medium text-sm text-np-dark">{c.contact_name || c.contact_email}</div>
                      <div className="text-xs text-gray-500">
                        via {c.source === 'promo_code' ? c.promo_code : c.utm_campaign} &middot; {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateOutreachStatus(c.id, 'sent')}
                        className="text-xs px-3 py-1.5 bg-np-blue text-white rounded-lg hover:bg-np-blue/90 font-medium"
                      >
                        Mark Sent
                      </button>
                      <button
                        onClick={() => updateOutreachStatus(c.id, 'converted')}
                        className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                      >
                        Converted
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversions Table */}
          {conversions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-np-dark">All Conversions</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Source</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Value</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Outreach</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {conversions.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-np-dark">{c.contact_name || c.contact_email}</td>
                        <td className="px-4 py-3 text-gray-600">{c.conversion_type}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{c.promo_code || c.utm_campaign || c.source}</td>
                        <td className="px-4 py-3 text-gray-600">{c.value ? `$${c.value}` : '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            c.personal_outreach_status === 'converted' ? 'bg-green-100 text-green-700' :
                            c.personal_outreach_status === 'sent' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {c.personal_outreach_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ INTEGRATIONS TAB ═══════ */}
      {subTab === 'Integrations' && (
        <div className="space-y-4 max-w-3xl">
          <p className="text-sm text-gray-500">How Media & Affiliates connects to the rest of NPU Hub.</p>
          {INTEGRATIONS_LIST.map(intg => (
            <div key={intg.name} className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-np-dark">{intg.name}</h3>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                  intg.priority === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                  intg.priority === 'HIGH' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {intg.priority}
                </span>
              </div>
              <p className="text-sm text-gray-600">{intg.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* ═══════ CREATE MODAL ═══════ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-np-dark">
                New {createEntryType === 'inbound' ? 'Inbound' : 'Outbound'} Appearance
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                >
                  {TYPE_FILTERS.filter(t => t.key !== 'all').map(t => (
                    <option key={t.key} value={t.key}>{t.label.replace(/s$/, '')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Episode or appearance title"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Platform / Show</label>
                  <input
                    type="text"
                    value={form.platform}
                    onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                    placeholder="e.g., Huberman Lab"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    placeholder="Host name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recording Date</label>
                  <input
                    type="date"
                    value={form.recording_date}
                    onChange={e => setForm(f => ({ ...f, recording_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Air Date</label>
                  <input
                    type="date"
                    value={form.air_date}
                    onChange={e => setForm(f => ({ ...f, air_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Affiliate Tier</label>
                  <select
                    value={form.affiliate_tier}
                    onChange={e => setForm(f => ({ ...f, affiliate_tier: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  >
                    {AFFILIATE_TIERS.map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code</label>
                  <input
                    type="text"
                    value={form.promo_code}
                    onChange={e => setForm(f => ({ ...f, promo_code: e.target.value }))}
                    placeholder="PODCAST-SHOWNAME"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UTM Campaign</label>
                <input
                  type="text"
                  value={form.utm_campaign}
                  onChange={e => setForm(f => ({ ...f, utm_campaign: e.target.value }))}
                  placeholder="show-slug (auto-used as utm_campaign)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Notes about this appearance..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                onClick={createAppearance}
                disabled={!form.title}
                className="px-4 py-2 bg-np-blue text-white rounded-lg text-sm font-medium hover:bg-np-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Appearance
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// APPEARANCE CARD COMPONENT
// ═══════════════════════════════════════════════════════

function AppearanceCard({
  item,
  expanded,
  onToggle,
  onDelete,
  contentPieces,
}: {
  item: Appearance
  expanded: boolean
  onToggle: () => void
  onDelete: (id: string) => void
  contentPieces: ContentPiece[]
}) {
  const TypeIcon = TYPE_ICONS[item.type] || Globe

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        {/* Top row: type icon + entry badge */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TypeIcon className="w-4 h-4 text-gray-400" />
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              item.entry_type === 'inbound' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
            }`}>
              {item.entry_type}
            </span>
          </div>
          {item.performance_score && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SCORE_COLORS[item.performance_score] || ''}`}>
              {item.performance_score}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-medium text-np-dark text-sm leading-snug mb-1 line-clamp-2">{item.title}</h3>

        {/* Platform / Host */}
        {(item.platform || item.host) && (
          <p className="text-xs text-gray-500 mb-2">
            {item.platform}{item.platform && item.host ? ' \u00b7 ' : ''}{item.host}
          </p>
        )}

        {/* Topics */}
        {item.key_topics?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {item.key_topics.slice(0, 3).map(t => (
              <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{t}</span>
            ))}
            {item.key_topics.length > 3 && (
              <span className="text-[10px] text-gray-400">+{item.key_topics.length - 3}</span>
            )}
          </div>
        )}

        {/* Integration indicators */}
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          {item.host_contact_id && <span className="flex items-center gap-0.5"><Link2 className="w-3 h-3" /> CRM</span>}
          {item.calendar_events_count > 0 && <span className="flex items-center gap-0.5"><Calendar className="w-3 h-3" /> {item.calendar_events_count}</span>}
          {item.social_posts_count > 0 && <span className="flex items-center gap-0.5"><Share2 className="w-3 h-3" /> {item.social_posts_count}</span>}
          {item.tasks_created > 0 && (
            <span className="flex items-center gap-0.5">
              <CheckCircle2 className="w-3 h-3" /> {item.tasks_completed}/{item.tasks_created}
            </span>
          )}
          {item.promo_code && <span className="flex items-center gap-0.5"><Tag className="w-3 h-3" /> {item.promo_code}</span>}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-3 bg-gray-50/50">
          {item.description && <p className="text-sm text-gray-600">{item.description}</p>}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-gray-400">Status</span>
              <div className="font-medium text-np-dark mt-0.5">{item.status.replace(/_/g, ' ')}</div>
            </div>
            <div>
              <span className="text-gray-400">Affiliate Tier</span>
              <div className="font-medium text-np-dark mt-0.5 capitalize">{item.affiliate_tier}</div>
            </div>
            {item.recording_date && (
              <div>
                <span className="text-gray-400">Recording</span>
                <div className="font-medium text-np-dark mt-0.5">{new Date(item.recording_date).toLocaleDateString()}</div>
              </div>
            )}
            {item.air_date && (
              <div>
                <span className="text-gray-400">Air Date</span>
                <div className="font-medium text-np-dark mt-0.5">{new Date(item.air_date).toLocaleDateString()}</div>
              </div>
            )}
          </div>

          {item.key_quotes?.length > 0 && (
            <div>
              <span className="text-xs text-gray-400">Key Quotes</span>
              {item.key_quotes.map((q, i) => (
                <p key={i} className="text-sm text-gray-600 italic mt-1">&ldquo;{q}&rdquo;</p>
              ))}
            </div>
          )}

          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-np-blue hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> View Episode
            </a>
          )}

          {contentPieces.length > 0 && (
            <div>
              <span className="text-xs text-gray-400 mb-1 block">Content Pieces ({contentPieces.length})</span>
              {contentPieces.map(cp => (
                <div key={cp.id} className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                  <FileText className="w-3 h-3 text-gray-400" />
                  <span>{cp.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${cp.status === 'published' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {cp.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={e => { e.stopPropagation(); console.log('Edit appearance:', item.id, item.title) }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={e => { e.stopPropagation(); console.log('Repurpose appearance:', item.id, item.title) }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              <RefreshCw className="w-3 h-3" /> Repurpose
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(item.id) }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-red-200 rounded-lg hover:bg-red-50 text-red-500"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
