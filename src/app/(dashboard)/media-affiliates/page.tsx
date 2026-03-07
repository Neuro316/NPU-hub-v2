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
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

interface Conversion {
  id: string
  appearance_id: string | null
  contact_name: string | null
  contact_email: string | null
  conversion_type: string
  source: string
  promo_code: string | null
  utm_campaign: string | null
  value: number
  personal_outreach_status: string
  notified: boolean
  created_at: string
  appearance?: { platform: string }
}

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  all:       { label: 'All',        icon: Globe,        color: 'gray' },
  podcast:   { label: 'Podcasts',   icon: Mic,          color: 'violet' },
  interview: { label: 'Interviews', icon: Radio,        color: 'blue' },
  press:     { label: 'Press',      icon: Newspaper,    color: 'emerald' },
  speaking:  { label: 'Speaking',   icon: Presentation, color: 'amber' },
  panel:     { label: 'Panels',     icon: Users,        color: 'rose' },
  webinar:   { label: 'Webinars',   icon: Monitor,      color: 'cyan' },
}

const PIPELINE_BY_TYPE: Record<string, { name: string; key: string; color: string }[]> = {
  podcast: [
    { name: 'Prospect', key: 'prospect', color: 'bg-gray-100 text-gray-600 border-gray-200' },
    { name: 'Pitched', key: 'pitched', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'Booked', key: 'booked', color: 'bg-violet-50 text-violet-600 border-violet-200' },
    { name: 'Prepped', key: 'prepped', color: 'bg-purple-50 text-purple-600 border-purple-200' },
    { name: 'Recorded', key: 'recorded', color: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200' },
    { name: 'Post-Prod', key: 'post_prod', color: 'bg-pink-50 text-pink-600 border-pink-200' },
    { name: 'Live', key: 'live', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
  interview: [
    { name: 'Pitched', key: 'pitched', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'Scheduled', key: 'scheduled', color: 'bg-violet-50 text-violet-600 border-violet-200' },
    { name: 'Completed', key: 'completed', color: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200' },
    { name: 'Published', key: 'published', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
  press: [
    { name: 'Pitched', key: 'pitched', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'In Review', key: 'in_review', color: 'bg-pink-50 text-pink-600 border-pink-200' },
    { name: 'Published', key: 'published', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
  speaking: [
    { name: 'Prospect', key: 'prospect', color: 'bg-gray-100 text-gray-600 border-gray-200' },
    { name: 'Applied', key: 'applied', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'Booked', key: 'booked', color: 'bg-violet-50 text-violet-600 border-violet-200' },
    { name: 'Prepped', key: 'prepped', color: 'bg-purple-50 text-purple-600 border-purple-200' },
    { name: 'Delivered', key: 'delivered', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Repurposed', key: 'repurposed', color: 'bg-pink-50 text-pink-600 border-pink-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
  panel: [
    { name: 'Invited', key: 'invited', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'Confirmed', key: 'confirmed', color: 'bg-violet-50 text-violet-600 border-violet-200' },
    { name: 'Completed', key: 'completed', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
  webinar: [
    { name: 'Planning', key: 'planning', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { name: 'Scheduled', key: 'scheduled', color: 'bg-violet-50 text-violet-600 border-violet-200' },
    { name: 'Promoted', key: 'promoted', color: 'bg-purple-50 text-purple-600 border-purple-200' },
    { name: 'Delivered', key: 'delivered', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { name: 'Archived', key: 'archived', color: 'bg-gray-50 text-gray-500 border-gray-200' },
  ],
}

const GUEST_SHEET = [
  { title: 'Bio & Headshot', icon: User, items: ['Short bio (50 words) — social posts', 'Medium bio (100 words) — show notes', 'Full bio (200 words) — website features', 'High-res headshot (1000x1000px min)', 'Secondary action shot'] },
  { title: 'Links for Show Notes', icon: Link2, items: ['Primary CTA link with UTM tags', 'Website link with UTM params', 'Promo code + what it unlocks', 'All social handles (IG, LI, X, YT)'] },
  { title: 'Talking Points', icon: Mic, items: ['3-5 conversation starters for their audience', 'Key frameworks to discuss', 'Stories / case studies (anonymized)', 'Off-limits topics'] },
  { title: 'Preferred Introduction', icon: FileText, items: ['Scripted intro paragraph', 'Pronunciation guide', 'Title / credential to emphasize'] },
  { title: 'Cross-Promotion Requirements', icon: Megaphone, items: ['Minimum: share to social + tag', 'Preferred: 2-3 posts first week', 'UTM link in all posts (NOT generic)', 'Promo code in show notes'] },
  { title: 'Affiliate Vetting (Internal)', icon: Tag, internal: true, items: ['Tier 1 — Awareness (promo code only)', 'Tier 2 — Revenue share on enrollments', 'Tier 3 — Full ongoing partnership', 'Criteria: audience, ICP alignment, commitment'] },
]

const SCORE_COLORS: Record<string, string> = {
  A: 'text-emerald-600 bg-emerald-50',
  B: 'text-amber-600 bg-amber-50',
  C: 'text-red-500 bg-red-50',
}

// ═══════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════

export default function MediaAffiliatesPage() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id

  // State
  const [appearances, setAppearances] = useState<Appearance[]>([])
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('podcast')
  const [viewMode, setViewMode] = useState<'pipeline' | 'cards' | 'table'>('pipeline')
  const [subTab, setSubTab] = useState('appearances')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedSheet, setExpandedSheet] = useState<number | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createEntryType, setCreateEntryType] = useState<'outbound' | 'inbound'>('outbound')

  // New appearance form
  const [formData, setFormData] = useState({
    title: '', platform: '', host: '', type: 'podcast',
    recording_date: '', air_date: '', description: '',
    affiliate_tier: 'none', promo_code: '', utm_campaign: '',
  })

  // ─── Data Loading ───
  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)

    const [appRes, convRes] = await Promise.all([
      supabase.from('media_appearances').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('podcast_conversions').select('*, appearance:media_appearances(platform)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50),
    ])

    if (appRes.data) setAppearances(appRes.data)
    if (convRes.data) setConversions(convRes.data as any)
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  // ─── Computed ───
  const filtered = useMemo(() => {
    if (typeFilter === 'all') return appearances
    return appearances.filter(a => a.type === typeFilter)
  }, [appearances, typeFilter])

  const pipeline = PIPELINE_BY_TYPE[typeFilter] || PIPELINE_BY_TYPE.podcast
  const pipelineGroups = useMemo(() => {
    const g: Record<string, Appearance[]> = {}
    pipeline.forEach(s => { g[s.key] = [] })
    filtered.forEach(a => { if (g[a.status]) g[a.status].push(a) })
    return g
  }, [filtered, pipeline])

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: appearances.length }
    appearances.forEach(a => { c[a.type] = (c[a.type] || 0) + 1 })
    return c
  }, [appearances])

  const totals = useMemo(() => {
    return {
      clicks: conversions.filter(c => c.conversion_type === 'click').length,
      promoUses: conversions.filter(c => c.source === 'promo_code').length,
      enrollments: conversions.filter(c => c.conversion_type === 'course_enroll').length,
      calls: conversions.filter(c => c.conversion_type === 'discovery_call').length,
      revenue: conversions.reduce((s, c) => s + (c.value || 0), 0),
    }
  }, [conversions])

  const pendingOutreach = conversions.filter(c => c.personal_outreach_status === 'pending')
  const showPodcastTabs = typeFilter === 'podcast' || typeFilter === 'all'

  // ─── CRUD ───
  const createAppearance = async () => {
    if (!orgId || !formData.title) return
    const startStatus = createEntryType === 'inbound' ? 'booked' : 'prospect'
    const utmCampaign = formData.utm_campaign || formData.platform?.toLowerCase().replace(/\s+/g, '-') || ''

    const { error } = await supabase.from('media_appearances').insert({
      org_id: orgId,
      type: formData.type,
      entry_type: createEntryType,
      title: formData.title,
      platform: formData.platform || null,
      host: formData.host || null,
      recording_date: formData.recording_date || null,
      air_date: formData.air_date || null,
      description: formData.description || null,
      affiliate_tier: formData.affiliate_tier,
      promo_code: formData.promo_code || null,
      utm_campaign: utmCampaign || null,
      utm_source: 'podcast',
      utm_medium: 'audio',
      status: startStatus,
    })

    if (!error) {
      setShowCreateModal(false)
      setFormData({ title: '', platform: '', host: '', type: 'podcast', recording_date: '', air_date: '', description: '', affiliate_tier: 'none', promo_code: '', utm_campaign: '' })
      loadData()
    }
  }

  const updateStatus = async (id: string, newStatus: string) => {
    await supabase.from('media_appearances').update({ status: newStatus }).eq('id', id)
    loadData()
  }

  const updateOutreach = async (convId: string, status: string) => {
    await supabase.from('podcast_conversions').update({
      personal_outreach_status: status,
      outreach_sent_at: status === 'sent' ? new Date().toISOString() : null,
    }).eq('id', convId)
    loadData()
  }

  const deleteAppearance = async (id: string) => {
    await supabase.from('media_appearances').delete().eq('id', id)
    setSelectedId(null)
    loadData()
  }

  // ─── Status badge helper ───
  const StatusBadge = ({ status }: { status: string }) => {
    const stage = Object.values(PIPELINE_BY_TYPE).flat().find(s => s.key === status)
    const cls = stage?.color || 'bg-gray-100 text-gray-500 border-gray-200'
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${cls}`}>{stage?.name || status}</span>
  }

  if (loading && appearances.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-gray-300 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ─── HEADER ─── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-np-dark">Media & Affiliates</h1>
            {pendingOutreach.length > 0 && (
              <button
                onClick={() => setSubTab('dashboard')}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-[11px] font-bold text-amber-600 hover:bg-amber-100 transition-colors"
              >
                <Bell className="w-3 h-3" />
                {pendingOutreach.length} outreach pending
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">Track appearances, manage guest sheets, monitor podcast attribution</p>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNewMenu(!showNewMenu)}
            className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-xl text-sm font-semibold hover:bg-np-blue/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Appearance
          </button>
          {showNewMenu && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
              <button
                onClick={() => { setCreateEntryType('outbound'); setShowNewMenu(false); setShowCreateModal(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
              >
                <Presentation className="w-5 h-5 text-np-blue" />
                <div>
                  <div className="text-sm font-semibold text-np-dark">Outbound Pitch</div>
                  <div className="text-[10px] text-gray-400">You're pitching a show</div>
                </div>
              </button>
              <button
                onClick={() => { setCreateEntryType('inbound'); setShowNewMenu(false); setShowCreateModal(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 text-left transition-colors border-t border-gray-100"
              >
                <ArrowRight className="w-5 h-5 text-emerald-500 rotate-180" />
                <div>
                  <div className="text-sm font-semibold text-emerald-600">Inbound Request</div>
                  <div className="text-[10px] text-gray-400">Host reached out — starts at Booked</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── TYPE FILTERS ─── */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          const count = typeCounts[key] || 0
          const active = typeFilter === key
          return (
            <button
              key={key}
              onClick={() => { setTypeFilter(key); setSelectedId(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                active
                  ? 'bg-np-blue/10 text-np-blue border-np-blue/20'
                  : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {cfg.label}
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${active ? 'bg-np-blue/15' : 'bg-gray-100'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ─── SUB-TABS ─── */}
      <div className="flex gap-0 border-b border-gray-100 mb-5">
        {[
          { id: 'appearances', label: 'Appearances' },
          ...(showPodcastTabs ? [
            { id: 'guestsheet', label: 'Guest Sheet' },
            { id: 'utm', label: 'UTM & Codes' },
            { id: 'dashboard', label: 'Conversions', badge: pendingOutreach.length || null },
          ] : []),
          { id: 'integrations', label: 'Integrations' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              subTab === tab.id
                ? 'border-np-blue text-np-blue'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className="bg-amber-100 text-amber-600 text-[9px] font-bold px-1.5 rounded-full">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* APPEARANCES TAB                         */}
      {/* ═══════════════════════════════════════ */}
      {subTab === 'appearances' && (
        <div>
          {/* View toggle */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-1">
              {(typeFilter !== 'all' ? ['pipeline', 'cards', 'table'] as const : ['cards', 'table'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1 rounded-md text-[11px] font-semibold capitalize border transition-colors ${
                    viewMode === v
                      ? 'bg-np-blue/10 text-np-blue border-np-blue/20'
                      : 'text-gray-400 border-transparent hover:text-gray-600'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{filtered.length} total</span>
          </div>

          {/* Pipeline View */}
          {viewMode === 'pipeline' && typeFilter !== 'all' && (
            <div className="flex gap-3 overflow-x-auto pb-4">
              {pipeline.map(stage => {
                const cards = pipelineGroups[stage.key] || []
                return (
                  <div key={stage.key} className="min-w-[220px] max-w-[260px] flex-shrink-0">
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-2 ${stage.color}`}>
                      <span className="text-[10px] font-bold uppercase tracking-wider">{stage.name}</span>
                      <span className="text-[10px] font-bold bg-white/60 rounded-full px-1.5">{cards.length}</span>
                    </div>
                    <div className="space-y-2">
                      {cards.map(card => (
                        <div
                          key={card.id}
                          onClick={() => setSelectedId(selectedId === card.id ? null : card.id)}
                          className={`bg-white border rounded-xl p-3.5 cursor-pointer transition-all hover:shadow-sm ${
                            selectedId === card.id ? 'border-np-blue/30 shadow-sm' : 'border-gray-100'
                          }`}
                        >
                          {card.entry_type === 'inbound' && (
                            <span className="inline-block text-[9px] font-bold text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5 mb-1.5">INBOUND</span>
                          )}
                          <div className="text-sm font-semibold text-np-dark mb-1 leading-snug">{card.title}</div>
                          <div className="text-[11px] text-gray-500 mb-2">{card.platform} · {card.host}</div>

                          {card.key_topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {card.key_topics.slice(0, 2).map((t, i) => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500">{t}</span>
                              ))}
                            </div>
                          )}

                          {/* Integration indicators */}
                          <div className="flex gap-2 items-center mb-1.5 text-[10px] text-gray-400">
                            {card.host_contact_id && <span title="CRM linked">👤</span>}
                            {card.calendar_events_count > 0 && <span>📅{card.calendar_events_count}</span>}
                            {card.social_posts_count > 0 && <span>📱{card.social_posts_count}</span>}
                            {card.tasks_created > 0 && (
                              <span className={card.tasks_completed === card.tasks_created ? 'text-emerald-500' : 'text-amber-500'}>
                                ✅{card.tasks_completed}/{card.tasks_created}
                              </span>
                            )}
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400">
                              {card.recording_date ? `Rec: ${card.recording_date}` : card.air_date ? `Air: ${card.air_date}` : 'TBD'}
                            </span>
                            <div className="flex gap-1.5 items-center">
                              {card.promo_code && <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 rounded px-1 py-0.5">PROMO</span>}
                              {card.performance_score && (
                                <span className={`text-xs font-extrabold rounded px-1 ${SCORE_COLORS[card.performance_score] || ''}`}>
                                  {card.performance_score}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {selectedId === card.id && (
                            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                              {card.host_contact_id && (
                                <a href={`/crm/contacts?id=${card.host_contact_id}`} className="block text-center text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100 transition-colors">
                                  👤 Open {card.host}&apos;s CRM Card →
                                </a>
                              )}
                              {card.affiliate_tier !== 'none' && (
                                <div className="text-[11px] text-gray-500">
                                  <span className="font-semibold text-violet-600">Affiliate:</span> {card.affiliate_tier} {card.promo_code && `· ${card.promo_code}`}
                                </div>
                              )}
                              {card.key_quotes.length > 0 && (
                                <div className="text-[11px] text-violet-600 italic bg-violet-50 rounded-lg p-2 border-l-2 border-violet-200">
                                  &ldquo;{card.key_quotes[0]}&rdquo;
                                </div>
                              )}
                              <div className="flex gap-1.5">
                                <button className="flex-1 text-[10px] font-semibold text-gray-500 bg-gray-50 rounded-lg py-1.5 hover:bg-gray-100 transition-colors border border-gray-100">
                                  <Edit3 className="w-3 h-3 inline mr-1" />Edit
                                </button>
                                <button className="flex-1 text-[10px] font-semibold text-fuchsia-600 bg-fuchsia-50 rounded-lg py-1.5 hover:bg-fuchsia-100 transition-colors border border-fuchsia-100">
                                  <Share2 className="w-3 h-3 inline mr-1" />Repurpose
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteAppearance(card.id) }}
                                  className="px-2 text-[10px] text-red-400 bg-red-50 rounded-lg py-1.5 hover:bg-red-100 transition-colors border border-red-100"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {cards.length === 0 && (
                        <div className="text-center py-6 text-[11px] text-gray-300 border border-dashed border-gray-200 rounded-xl">
                          Empty
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Cards View */}
          {(viewMode === 'cards' || (viewMode === 'pipeline' && typeFilter === 'all')) && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map(card => (
                <div key={card.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-all">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0">
                      {card.entry_type === 'inbound' && (
                        <span className="inline-block text-[9px] font-bold text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5 mb-1">INBOUND</span>
                      )}
                      <div className="text-sm font-semibold text-np-dark truncate">{card.title}</div>
                      <div className="text-xs text-gray-500">{card.platform} · {card.host}</div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      <StatusBadge status={card.status} />
                      {card.performance_score && (
                        <span className={`text-xs font-extrabold rounded px-1 ${SCORE_COLORS[card.performance_score]}`}>{card.performance_score}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 text-[10px] text-gray-400">
                    {card.host_contact_id && <span>👤</span>}
                    {card.calendar_events_count > 0 && <span>📅{card.calendar_events_count}</span>}
                    {card.social_posts_count > 0 && <span>📱{card.social_posts_count}</span>}
                    {card.tasks_created > 0 && <span className={card.tasks_completed === card.tasks_created ? 'text-emerald-500' : 'text-amber-500'}>✅{card.tasks_completed}/{card.tasks_created}</span>}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-400">
                  <Mic className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm font-medium">No appearances yet</p>
                  <p className="text-xs mt-1">Click &quot;New Appearance&quot; to get started</p>
                </div>
              )}
            </div>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Title','Platform','Host','Entry','Status','CRM','Cal','Posts','Tasks','Score'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-np-dark max-w-[200px] truncate">{a.title}</td>
                      <td className="px-3 py-2.5 text-gray-500">{a.platform}</td>
                      <td className="px-3 py-2.5 text-gray-500">{a.host}</td>
                      <td className="px-3 py-2.5"><span className={`text-[9px] font-bold ${a.entry_type === 'inbound' ? 'text-emerald-500' : 'text-gray-400'}`}>{a.entry_type === 'inbound' ? '📥 IN' : '🎯 OUT'}</span></td>
                      <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                      <td className="px-3 py-2.5">{a.host_contact_id ? '👤' : ''}</td>
                      <td className="px-3 py-2.5 text-gray-400">{a.calendar_events_count || ''}</td>
                      <td className="px-3 py-2.5 text-gray-400">{a.social_posts_count || ''}</td>
                      <td className="px-3 py-2.5"><span className={a.tasks_created > 0 && a.tasks_completed === a.tasks_created ? 'text-emerald-500' : 'text-gray-400'}>{a.tasks_created ? `${a.tasks_completed}/${a.tasks_created}` : ''}</span></td>
                      <td className="px-3 py-2.5">{a.performance_score && <span className={`font-extrabold ${SCORE_COLORS[a.performance_score]?.split(' ')[0]}`}>{a.performance_score}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* GUEST SHEET TAB                         */}
      {/* ═══════════════════════════════════════ */}
      {subTab === 'guestsheet' && (
        <div>
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-5 mb-5 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-np-dark mb-1">Podcast Guest Sheet</h2>
              <p className="text-xs text-gray-500">Sent to hosts after booking. Inbound requests auto-generate at Booked stage.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0 ml-4">
              <button className="px-4 py-2 rounded-lg border border-violet-200 text-xs font-semibold text-violet-600 hover:bg-violet-100 transition-colors">Download Template</button>
              <button className="px-4 py-2 rounded-lg bg-np-blue text-white text-xs font-semibold hover:bg-np-blue/90 transition-colors">Generate for Show →</button>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5 flex items-center gap-3 text-xs text-blue-600">
            <Link2 className="w-4 h-4 flex-shrink-0" />
            <span><strong>Integration:</strong> &quot;Generate for Show&quot; pulls host data from CRM contact card, builds UTM links from appearance record, attaches promo code from affiliate tier.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {GUEST_SHEET.map((section, si) => {
              const Icon = section.icon
              const isExpanded = expandedSheet === si
              const isInternal = section.internal
              return (
                <div
                  key={si}
                  onClick={() => setExpandedSheet(isExpanded ? null : si)}
                  className={`rounded-xl border p-4 cursor-pointer transition-all ${
                    isInternal ? 'bg-pink-50/50 border-pink-100' :
                    isExpanded ? 'bg-white border-np-blue/20 shadow-sm' :
                    'bg-white border-gray-100 hover:border-gray-200'
                  } ${isExpanded ? 'md:col-span-2' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isInternal ? 'bg-pink-100' : 'bg-violet-50'}`}>
                      <Icon className={`w-4 h-4 ${isInternal ? 'text-pink-500' : 'text-violet-500'}`} />
                    </div>
                    <div className="flex-1">
                      <div className={`text-sm font-bold ${isInternal ? 'text-pink-600' : 'text-np-dark'}`}>{section.title}</div>
                      {isInternal && !isExpanded && <div className="text-[9px] font-bold text-pink-500 mt-0.5">INTERNAL — Do not send to host</div>}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {isExpanded && (
                    <div className="mt-4 space-y-2">
                      {section.items.map((item, ii) => (
                        <div key={ii} className="flex items-start gap-2.5 bg-gray-50 rounded-lg p-2.5">
                          <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isInternal ? 'bg-pink-400' : 'bg-violet-400'}`} />
                          <span className="text-xs text-gray-600">{item}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* UTM & CODES TAB                         */}
      {/* ═══════════════════════════════════════ */}
      {subTab === 'utm' && (
        <div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-5">
            <h2 className="text-sm font-bold text-blue-700 mb-3">UTM Convention</h2>
            <div className="font-mono text-xs text-blue-600 bg-white/60 rounded-lg p-4 space-y-0.5 leading-relaxed">
              <div className="text-gray-400">// Course enrollment link:</div>
              <div>neuroprogeny.com/courses/free?</div>
              <div>&nbsp;&nbsp;utm_source=<span className="text-violet-600 font-bold">podcast</span></div>
              <div>&nbsp;&nbsp;&amp;utm_medium=<span className="text-violet-600 font-bold">audio</span></div>
              <div>&nbsp;&nbsp;&amp;utm_campaign=<span className="text-pink-500 font-bold">[show-slug]</span></div>
              <div>&nbsp;&nbsp;&amp;utm_content=<span className="text-pink-500 font-bold">[episode-slug]</span></div>
              <div className="mt-3 text-gray-400">// Promo code:</div>
              <div>PODCAST-<span className="text-pink-500 font-bold">[SHOWNAME]</span></div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-5 flex items-center gap-3 text-xs text-amber-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span><strong>Critical:</strong> NPU University must capture UTM params at enrollment and POST to <code className="bg-white/60 px-1 rounded">/api/integrations/podcast-conversion</code></span>
          </div>

          <h3 className="text-sm font-bold text-np-dark mb-3">Active Promo Codes</h3>
          <div className="space-y-2">
            {appearances.filter(a => a.promo_code).map(a => (
              <div key={a.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg">{a.promo_code}</span>
                  <div>
                    <div className="text-sm font-semibold text-np-dark">{a.platform}</div>
                    <div className="text-[11px] text-gray-400">Tier: {a.affiliate_tier} · <StatusBadge status={a.status} /></div>
                  </div>
                </div>
              </div>
            ))}
            {appearances.filter(a => a.promo_code).length === 0 && (
              <div className="text-center py-8 text-gray-400 text-xs">No promo codes yet. Create one when adding an appearance.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* CONVERSIONS DASHBOARD TAB                */}
      {/* ═══════════════════════════════════════ */}
      {subTab === 'dashboard' && (
        <div>
          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[
              { icon: Globe, label: 'Appearances', value: appearances.length },
              { icon: Link2, label: 'UTM Clicks', value: totals.clicks },
              { icon: Tag, label: 'Promo Uses', value: totals.promoUses },
              { icon: CheckCircle2, label: 'Enrollments', value: totals.enrollments },
              { icon: Phone, label: 'Calls', value: totals.calls },
              { icon: DollarSign, label: 'Revenue', value: `$${totals.revenue.toLocaleString()}` },
            ].map((m, i) => {
              const Icon = m.icon
              return (
                <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 text-center">
                  <Icon className="w-5 h-5 mx-auto text-gray-300 mb-1" />
                  <div className="text-lg font-extrabold text-np-dark">{m.value}</div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{m.label}</div>
                </div>
              )
            })}
          </div>

          {/* Outreach queue */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-5 mb-6">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-amber-700">Personal Outreach Queue</h3>
              <span className={`text-xl font-extrabold ${pendingOutreach.length > 0 ? 'text-amber-600' : 'text-emerald-500'}`}>
                {pendingOutreach.length}
              </span>
            </div>
            <div className="bg-white/50 rounded-lg p-3 mb-4 text-[11px] text-amber-700 border-l-3 border-amber-300">
              <strong>Notification chain:</strong> University webhook → task + conversion record → Hub bell → SMS via Twilio → daily digest. Tasks also show in main Tasks page.
            </div>
            <div className="space-y-2">
              {conversions.filter(c => ['pending','sent','converted'].includes(c.personal_outreach_status)).slice(0, 10).map(conv => {
                const isPending = conv.personal_outreach_status === 'pending'
                const isSent = conv.personal_outreach_status === 'sent'
                const isConverted = conv.personal_outreach_status === 'converted'
                return (
                  <div key={conv.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                    isPending ? 'bg-amber-50/50 border-amber-200' :
                    isConverted ? 'bg-emerald-50/50 border-emerald-200' :
                    'bg-white border-gray-100'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                        {(conv.contact_name || conv.contact_email || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-np-dark">{conv.contact_name || conv.contact_email}</div>
                        <div className="text-[10px] text-gray-400">
                          via {conv.promo_code || conv.utm_campaign || 'UTM'} · {conv.appearance?.platform || 'Unknown show'} · {new Date(conv.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {conv.notified && <Bell className="w-3 h-3 text-amber-400" />}
                      <span className={`text-[9px] font-bold uppercase tracking-wider ${
                        isPending ? 'text-amber-600' : isConverted ? 'text-emerald-600' : 'text-violet-500'
                      }`}>
                        {conv.personal_outreach_status}
                      </span>
                      {isPending && (
                        <button
                          onClick={() => updateOutreach(conv.id, 'sent')}
                          className="px-3 py-1 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                        >
                          Mark Sent
                        </button>
                      )}
                      {isSent && (
                        <button
                          onClick={() => updateOutreach(conv.id, 'converted')}
                          className="px-3 py-1 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                        >
                          Converted
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {conversions.length === 0 && (
                <div className="text-center py-6 text-xs text-gray-400">
                  No conversions yet. Conversions appear here when someone enrolls via podcast UTM or promo code.
                </div>
              )}
            </div>
          </div>

          {/* Performance table */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-np-dark">Appearance Performance</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  {['Show','Air Date','Status','Promo','Enrollments','Revenue','Outreach','Score'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appearances.filter(a => ['live','published','delivered'].includes(a.status)).map(a => {
                  const appConversions = conversions.filter(c => c.appearance_id === a.id)
                  const enrolls = appConversions.filter(c => c.conversion_type === 'course_enroll').length
                  const revenue = appConversions.reduce((s, c) => s + (c.value || 0), 0)
                  const outreachDone = appConversions.filter(c => c.personal_outreach_status !== 'pending').length
                  const outreachTotal = appConversions.length
                  return (
                    <tr key={a.id} className="border-b border-gray-50">
                      <td className="px-4 py-2.5 font-semibold text-np-dark">{a.platform}</td>
                      <td className="px-4 py-2.5 text-gray-500">{a.air_date || '—'}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{a.promo_code || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{enrolls}</td>
                      <td className="px-4 py-2.5 font-semibold text-emerald-600">{revenue > 0 ? `$${revenue}` : '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={outreachTotal > 0 && outreachDone === outreachTotal ? 'text-emerald-500' : 'text-amber-500'}>
                          {outreachTotal > 0 ? `${outreachDone}/${outreachTotal}` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {a.performance_score && (
                          <span className={`font-extrabold text-sm ${SCORE_COLORS[a.performance_score]?.split(' ')[0]}`}>{a.performance_score}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* INTEGRATIONS TAB                         */}
      {/* ═══════════════════════════════════════ */}
      {subTab === 'integrations' && (
        <div>
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-5 mb-5">
            <h2 className="text-sm font-bold text-np-dark mb-1">Integration Connection Map</h2>
            <p className="text-xs text-gray-500">Every integration needed for the podcast pipeline to work end-to-end. These touch existing Hub systems without modifying their core logic.</p>
          </div>

          <div className="flex gap-3 mb-5">
            {[
              { label: 'CRITICAL', color: 'bg-red-50 text-red-600 border-red-200', count: 2 },
              { label: 'HIGH', color: 'bg-amber-50 text-amber-600 border-amber-200', count: 3 },
              { label: 'MEDIUM', color: 'bg-blue-50 text-blue-600 border-blue-200', count: 2 },
            ].map((p, i) => (
              <div key={i} className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${p.color}`}>
                <span className="text-lg font-extrabold">{p.count}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider">{p.label}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {[
              { title: 'Enrollment → Attribution Loop', priority: 'CRITICAL', priColor: 'text-red-500', from: 'NPU University', to: 'Hub Media & Affiliates', desc: 'University captures UTM params at enrollment, POSTs to /api/integrations/podcast-conversion. Hub creates conversion record + auto-task + notification.' },
              { title: 'Real-Time Notifications', priority: 'CRITICAL', priColor: 'text-red-500', from: 'Podcast Conversions', to: 'Hub Bell + SMS + Email', desc: 'Supabase trigger fires on new conversion → Hub bell notification → SMS via Twilio → daily email digest. Ensures you know immediately.' },
              { title: 'Host ↔ CRM Contact Card', priority: 'HIGH', priColor: 'text-amber-500', from: 'Media & Affiliates', to: 'CRM Contacts + Network', desc: 'Every host is a CRM contact tagged podcast_host. Appearance card links to CRM card. Contact card shows all appearances with this host.' },
              { title: 'Tasks System Integration', priority: 'HIGH', priColor: 'text-amber-500', from: 'Pipeline Stage Changes', to: 'Hub Tasks Page', desc: 'Status changes auto-create tasks visible in both outreach queue AND main Tasks page. Booked → send guest sheet. Live → 14-day promo sequence.' },
              { title: 'Calendar Integration', priority: 'HIGH', priColor: 'text-amber-500', from: 'Appearance Dates', to: 'Hub Calendar + Google Calendar', desc: 'Recording and air dates auto-create Google Calendar events with reminders via existing OAuth connection.' },
              { title: 'Social Creator ↔ Repurpose', priority: 'MEDIUM', priColor: 'text-blue-500', from: 'Media & Affiliates', to: 'Social Creator', desc: 'Repurpose button passes appearance data to Social Creator in campaign-connected mode. Transcript, quotes, UTM links pre-loaded.' },
              { title: 'Inbound Quick-Add', priority: 'MEDIUM', priColor: 'text-blue-500', from: 'Email / DM', to: 'Media & Affiliates at Booked', desc: 'Inbound path skips Prospect + Pitched, starts at Booked, auto-creates CRM contact, generates guest sheet ready to send.' },
            ].map((intg, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-np-dark">{intg.title}</span>
                      <span className={`text-[9px] font-bold uppercase ${intg.priColor}`}>{intg.priority}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mb-1">{intg.from} → {intg.to}</div>
                    <p className="text-xs text-gray-500 leading-relaxed">{intg.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* CREATE MODAL                             */}
      {/* ═══════════════════════════════════════ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold text-np-dark">New Appearance</h2>
                <span className={`text-[10px] font-bold ${createEntryType === 'inbound' ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {createEntryType === 'inbound' ? '📥 Inbound — starts at Booked' : '🎯 Outbound — starts at Prospect'}
                </span>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-300 hover:text-gray-500 text-lg">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Type</label>
                <select value={formData.type} onChange={e => setFormData(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20">
                  {Object.entries(TYPE_CONFIG).filter(([k]) => k !== 'all').map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Title / Episode Topic *</label>
                <input value={formData.title} onChange={e => setFormData(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Nervous System Capacity & VR Biofeedback" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Show / Platform</label>
                  <input value={formData.platform} onChange={e => setFormData(f => ({ ...f, platform: e.target.value }))} placeholder="e.g., Mind Body Podcast" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Host</label>
                  <input value={formData.host} onChange={e => setFormData(f => ({ ...f, host: e.target.value }))} placeholder="e.g., Dr. Sarah Chen" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Recording Date</label>
                  <input type="date" value={formData.recording_date} onChange={e => setFormData(f => ({ ...f, recording_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Air Date</label>
                  <input type="date" value={formData.air_date} onChange={e => setFormData(f => ({ ...f, air_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Affiliate Tier</label>
                  <select value={formData.affiliate_tier} onChange={e => setFormData(f => ({ ...f, affiliate_tier: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20">
                    <option value="none">None</option>
                    <option value="tier1">Tier 1 — Awareness</option>
                    <option value="tier2">Tier 2 — Revenue Share</option>
                    <option value="tier3">Tier 3 — Full Partnership</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Promo Code</label>
                  <input value={formData.promo_code} onChange={e => setFormData(f => ({ ...f, promo_code: e.target.value }))} placeholder="e.g., PODCAST-MINDBODY" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">UTM Campaign Slug</label>
                <input value={formData.utm_campaign} onChange={e => setFormData(f => ({ ...f, utm_campaign: e.target.value }))} placeholder="Auto-generates from platform name if blank" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Notes</label>
                <textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Key topics, audience notes, etc." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={createAppearance} disabled={!formData.title} className="px-6 py-2 bg-np-blue text-white rounded-lg text-sm font-semibold hover:bg-np-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Create Appearance
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
