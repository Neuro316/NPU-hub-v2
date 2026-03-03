'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  HeartPulse, Activity, Brain, Users, ExternalLink, Search,
  ChevronDown, ChevronRight, ChevronLeft, Eye, Clock, X,
  CheckCircle2, AlertCircle, BarChart3, Zap, Shield, Send,
  Mail, Phone, FileText, ClipboardList, Plus, Mic, Pencil,
  Link2, MessageSquare, RefreshCw, Trash2, Star, Sparkles,
  User, Calendar, Tag, ArrowRight, Filter, MoreHorizontal
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════
   ECR v2 — Electronic Client Records
   
   Org-aware: detects NP vs Sensorium and renders different views.
   
   NP View: Pipeline-based (Enrolled, Mastermind, Subscribed)
     → Client cards with assessments, forms, send links
   
   Sensorium View: Clinical records with service entries
     → FNA, neurofeedback, modalities, AI session notes
   
   Both: Dynamic assessments from reports.neuroprogeny.com,
         send link via email + SMS, session notes with AI
   ═══════════════════════════════════════════════════════════════ */

const NEUROREPORT_URL = 'https://reports.neuroprogeny.com'

// ─── NP Pipeline Definitions ────────────────────────────────
const NP_PIPELINES = [
  { id: 'enrolled', label: 'Enrolled', stage: 'Enrolled', color: '#34D399' },
  { id: 'mastermind', label: 'Mastermind', stages: ['Applied','Discovery Call','Accepted','Deposit Paid','Equipment Shipped','Active (in cohort)','Completed','Alumni'], color: '#0D9488' },
  { id: 'subscribed', label: 'Subscribed', stages: ['Trial','Active Monthly','Active Annual','Past Due','Paused','Churned','Reactivated'], color: '#8B5CF6' },
]

// ─── Default Assessment Types ────────────────────────────────
const DEFAULT_ASSESSMENTS = [
  { key: 'nsci', name: 'NSCI (Nervous System Capacity Index)', icon: '🧠' },
  { key: 'core_narratives', name: 'Core Narratives Index', icon: '📖' },
  { key: 'qeeg', name: 'QEEG Brain Map', icon: '🗺️' },
  { key: 'fna', name: 'FNA (Functional Neuro Assessment)', icon: '🔬' },
  { key: 'hrv_baseline', name: 'HRV Baseline', icon: '💓' },
  { key: 'intake_form', name: 'Intake Form', icon: '📋' },
  { key: 'consent_form', name: 'Consent Form', icon: '✅' },
]

// ─── Stage Colors ────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  'Enrolled': '#34D399', 'Applied': '#228DC4', 'Discovery Call': '#2A9D8F',
  'Accepted': '#3DB5A6', 'Deposit Paid': '#FBBF24', 'Equipment Shipped': '#F59E0B',
  'Active (in cohort)': '#34D399', 'Completed': '#10B981', 'Alumni': '#8B5CF6',
  'Trial': '#60A5FA', 'Active Monthly': '#34D399', 'Active Annual': '#10B981',
  'Past Due': '#FBBF24', 'Paused': '#F59E0B', 'Churned': '#F87171', 'Reactivated': '#A78BFA',
}

// ─── Types ───────────────────────────────────────────────────
interface EcrClient {
  id: string; first_name: string; last_name: string; email: string; phone: string
  tags: string[]; pipeline_stage: string; pipeline_id: string
  source: string; created_at: string; notes: string
  subscription_status: string; subscription_plan: string
  date_of_birth: string; preferred_name: string
  emergency_contact_name: string; emergency_contact_phone: string
}

interface ServiceEntry {
  id: string; contact_id: string; service_type: string; service_date: string
  duration_minutes: number; provider_name: string; notes: string; status: string
  ai_generated: boolean; amount_cents: number
}

interface SessionNote {
  id: string; contact_id: string; session_date: string; session_type: string
  raw_transcript: string; structured_note: string; summary: string
  ai_formatted: boolean; author_name: string; status: string
}

interface AssessmentLink {
  id: string; contact_id: string; assessment_type: string; assessment_name: string
  status: string; send_url: string; report_url: string; sent_at: string
  completed_at: string; sent_via: string; score: any
}

export default function EcrPage() {
  const { currentOrg, user } = useWorkspace()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)

  // Org detection
  const orgSlug = currentOrg?.slug || ''
  const isSensorium = orgSlug.includes('sensorium')
  const isNP = !isSensorium

  // Data
  const [clients, setClients] = useState<EcrClient[]>([])
  const [services, setServices] = useState<ServiceEntry[]>([])
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [assessments, setAssessments] = useState<AssessmentLink[]>([])
  const [serviceTypes, setServiceTypes] = useState<any[]>([])

  // UI State
  const [search, setSearch] = useState('')
  const [activePipeline, setActivePipeline] = useState(isNP ? 'mastermind' : 'all')
  const [stageFilter, setStageFilter] = useState('all')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clientTab, setClientTab] = useState<'overview' | 'services' | 'notes' | 'assessments'>('overview')

  // Modals
  const [showSendLink, setShowSendLink] = useState(false)
  const [sendTarget, setSendTarget] = useState<{ client: EcrClient; type: string; name: string; url: string } | null>(null)
  const [showAddService, setShowAddService] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [showAddClient, setShowAddClient] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiNote, setAiNote] = useState('')

  // ─── Data Loading ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const orgId = currentOrg.id

    try {
      // Determine which pipeline stages to query
      let stageFilter: string[] = []
      if (isNP) {
        stageFilter = [
          'Enrolled',
          'Applied', 'Discovery Call', 'Accepted', 'Deposit Paid',
          'Equipment Shipped', 'Active (in cohort)', 'Completed', 'Alumni',
          'Trial', 'Active Monthly', 'Active Annual', 'Past Due',
          'Paused', 'Churned', 'Reactivated',
        ]
      }

      // Load clients
      let clientQuery = supabase
        .from('contacts')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500)

      if (isNP && stageFilter.length > 0) {
        clientQuery = clientQuery.in('pipeline_stage', stageFilter)
      }

      const [cR, sR, nR, aR] = await Promise.all([
        clientQuery,
        supabase.from('ecr_service_entries').select('*').eq('org_id', orgId).order('service_date', { ascending: false }).limit(1000),
        supabase.from('ecr_session_notes').select('*').eq('org_id', orgId).order('session_date', { ascending: false }).limit(500),
        supabase.from('ecr_assessment_links').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      ])

      setClients(cR.data || [])
      setServices(sR.data || [])
      setNotes(nR.data || [])
      setAssessments(aR.data || [])

      // Load service types for Sensorium
      if (isSensorium) {
        const { data: stData } = await supabase
          .from('org_settings')
          .select('setting_value')
          .eq('org_id', orgId)
          .eq('setting_key', 'ecr_service_types')
          .maybeSingle()
        if (stData?.setting_value?.types) setServiceTypes(stData.setting_value.types)
      }
    } catch (err) { console.error('ECR load error:', err) }
    setLoading(false)
  }, [currentOrg?.id, isNP, isSensorium])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setActivePipeline(isNP ? 'mastermind' : 'all') }, [isNP])

  // ─── Filtering ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = clients
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      )
    }
    if (isNP && activePipeline !== 'all') {
      const pl = NP_PIPELINES.find(p => p.id === activePipeline)
      if (pl) {
        const stages = 'stages' in pl ? pl.stages : [pl.stage]
        list = list.filter(c => stages?.includes(c.pipeline_stage))
      }
    }
    if (stageFilter !== 'all') {
      list = list.filter(c => c.pipeline_stage === stageFilter)
    }
    return list
  }, [clients, search, activePipeline, stageFilter, isNP])

  const clientServices = (id: string) => services.filter(s => s.contact_id === id)
  const clientNotes = (id: string) => notes.filter(n => n.contact_id === id)
  const clientAssessments = (id: string) => assessments.filter(a => a.contact_id === id)
  const selected = clients.find(c => c.id === selectedClient)

  // ─── Pipeline Stats ────────────────────────────────────────
  const pipelineStats = useMemo(() => {
    if (!isNP) return {}
    const stats: Record<string, number> = { all: clients.length }
    NP_PIPELINES.forEach(pl => {
      const stages = 'stages' in pl ? pl.stages : [pl.stage]
      stats[pl.id] = clients.filter(c => stages.includes(c.pipeline_stage)).length
    })
    return stats
  }, [clients, isNP])

  // ─── Stage counts for current pipeline ─────────────────────
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const pl = NP_PIPELINES.find(p => p.id === activePipeline)
    if (!pl) return counts
    const stages = 'stages' in pl ? pl.stages : [pl.stage]
    stages.forEach(s => { counts[s] = clients.filter(c => c.pipeline_stage === s).length })
    return counts
  }, [clients, activePipeline])

  // ─── Send Link Handler ─────────────────────────────────────
  const openSendLink = (client: EcrClient, type: string, name: string, url?: string) => {
    setSendTarget({ client, type, name, url: url || `${NEUROREPORT_URL}/assess/${type}` })
    setShowSendLink(true)
  }

  const executeSend = async (channel: 'email' | 'sms' | 'both') => {
    if (!sendTarget || !currentOrg) return
    const { client, type, name, url } = sendTarget

    await supabase.from('ecr_send_log').insert({
      org_id: currentOrg.id,
      contact_id: client.id,
      send_type: 'assessment',
      item_name: name,
      item_url: url,
      channel,
      recipient_email: channel !== 'sms' ? client.email : null,
      recipient_phone: channel !== 'email' ? client.phone : null,
      sent_by: user?.id,
    })

    // Update assessment link status
    const existing = assessments.find(a => a.contact_id === client.id && a.assessment_type === type)
    if (existing) {
      await supabase.from('ecr_assessment_links').update({
        status: 'sent', sent_at: new Date().toISOString(), sent_via: channel,
      }).eq('id', existing.id)
    } else {
      await supabase.from('ecr_assessment_links').insert({
        org_id: currentOrg.id, contact_id: client.id,
        assessment_type: type, assessment_name: name,
        status: 'sent', send_url: url,
        sent_at: new Date().toISOString(), sent_via: channel,
      })
    }

    setShowSendLink(false)
    setSendTarget(null)
    loadData()
  }

  // ─── AI Session Note Handler ───────────────────────────────
  const processNoteWithAI = async () => {
    if (!noteText.trim() || !selected || !currentOrg) return
    setAiProcessing(true)
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: `You are a clinical documentation assistant. Convert this raw session note into a structured clinical note with sections: Subjective, Objective, Assessment, Plan (SOAP format). Keep it concise and professional. Do not add information that isn't in the original.\n\nRaw note:\n${noteText}` }],
        }),
      })
      const data = await response.json()
      const formatted = data.content?.[0]?.text || noteText
      setAiNote(formatted)
    } catch (err) {
      console.error('AI note error:', err)
      setAiNote(noteText)
    }
    setAiProcessing(false)
  }

  const saveSessionNote = async () => {
    if (!selected || !currentOrg) return
    await supabase.from('ecr_session_notes').insert({
      org_id: currentOrg.id,
      contact_id: selected.id,
      session_date: new Date().toISOString(),
      session_type: isSensorium ? 'clinical' : 'vr_biofeedback',
      raw_transcript: noteText,
      structured_note: aiNote || noteText,
      summary: aiNote ? aiNote.substring(0, 200) : noteText.substring(0, 200),
      ai_formatted: !!aiNote,
      ai_model: aiNote ? 'claude-sonnet-4-20250514' : null,
      author_id: user?.id,
      author_name: user?.user_metadata?.full_name || user?.email || '',
      status: 'draft',
    })
    setShowAddNote(false)
    setNoteText('')
    setAiNote('')
    loadData()
  }

  // ─── Add Service Entry ─────────────────────────────────────
  const [serviceForm, setServiceForm] = useState({ type: '', date: new Date().toISOString().split('T')[0], duration: '60', notes: '', provider: '' })

  const saveService = async () => {
    if (!selected || !currentOrg || !serviceForm.type) return
    await supabase.from('ecr_service_entries').insert({
      org_id: currentOrg.id,
      contact_id: selected.id,
      service_type: serviceForm.type,
      service_date: serviceForm.date,
      duration_minutes: parseInt(serviceForm.duration) || 60,
      provider_name: serviceForm.provider || user?.user_metadata?.full_name || '',
      provider_id: user?.id,
      notes: serviceForm.notes,
      status: 'completed',
    })
    setShowAddService(false)
    setServiceForm({ type: '', date: new Date().toISOString().split('T')[0], duration: '60', notes: '', provider: '' })
    loadData()
  }

  // ─── Add Client Manually ───────────────────────────────────
  const [clientForm, setClientForm] = useState({ first_name: '', last_name: '', email: '', phone: '', pipeline_stage: 'Enrolled' })

  const saveNewClient = async () => {
    if (!currentOrg || !clientForm.first_name) return
    // Determine pipeline_id from stage
    let pipelineId = ''
    const { data: settingsData } = await supabase
      .from('org_settings').select('setting_value')
      .eq('org_id', currentOrg.id).eq('setting_key', 'crm_pipelines').maybeSingle()

    if (settingsData?.setting_value?.pipelines) {
      for (const pl of settingsData.setting_value.pipelines) {
        const stages = (pl.stages || []).map((s: any) => s.name)
        if (stages.includes(clientForm.pipeline_stage)) {
          pipelineId = pl.id
          break
        }
      }
    }

    await supabase.from('contacts').insert({
      org_id: currentOrg.id,
      first_name: clientForm.first_name,
      last_name: clientForm.last_name,
      email: clientForm.email || null,
      phone: clientForm.phone || null,
      pipeline_stage: clientForm.pipeline_stage,
      pipeline_id: pipelineId || null,
      source: 'manual_ecr',
      tags: [],
    })
    setShowAddClient(false)
    setClientForm({ first_name: '', last_name: '', email: '', phone: '', pipeline_stage: 'Enrolled' })
    loadData()
  }

  // ─── Render ────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-np-blue border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading client records...</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-[1400px]">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-rose-500" />
            Electronic Client Records
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentOrg?.name} · {isSensorium ? 'Clinical Records + FNA Integration' : 'Enrolled, Mastermind, and Subscriber management'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddClient(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> Add Client
          </button>
          <a href={NEUROREPORT_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-200">
            <ExternalLink className="w-3.5 h-3.5" /> NeuroReport
          </a>
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-np-dark rounded-lg hover:bg-gray-100">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ═══ NP: PIPELINE TABS ═══ */}
      {isNP && (
        <div className="flex gap-2 mb-4">
          {NP_PIPELINES.map(pl => (
            <button key={pl.id} onClick={() => { setActivePipeline(pl.id); setStageFilter('all'); setSelectedClient(null) }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
                ${activePipeline === pl.id ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              style={activePipeline === pl.id ? { background: pl.color } : undefined}>
              {pl.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activePipeline === pl.id ? 'bg-white/20' : 'bg-gray-200'}`}>
                {pipelineStats[pl.id] || 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ═══ NP: STAGE CHIPS ═══ */}
      {isNP && activePipeline !== 'all' && (() => {
        const pl = NP_PIPELINES.find(p => p.id === activePipeline)
        if (!pl) return null
        const stages = 'stages' in pl ? pl.stages : [pl.stage]
        return (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            <button onClick={() => setStageFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                ${stageFilter === 'all' ? 'bg-np-dark text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              All ({filtered.length})
            </button>
            {stages.map(s => {
              const sc = STAGE_COLORS[s] || '#94a3b8'
              const count = stageCounts[s] || 0
              return (
                <button key={s} onClick={() => setStageFilter(stageFilter === s ? 'all' : s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                    ${stageFilter === s ? 'text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  style={stageFilter === s ? { background: sc } : { background: sc + '15', color: sc }}>
                  {s} ({count})
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* ═══ SEARCH ═══ */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search clients by name, email, or phone..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue" />
      </div>

      {/* ═══ TWO-COLUMN LAYOUT ═══ */}
      <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 300px)' }}>
        {/* ── LEFT: Client List ── */}
        <div className={`${selectedClient ? 'w-[340px]' : 'w-full'} transition-all`}>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 uppercase">{filtered.length} Client{filtered.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600">No clients found</p>
                  <p className="text-xs text-gray-400 mt-1">Try adjusting your search or pipeline filter.</p>
                </div>
              ) : filtered.map(c => {
                const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email
                const sc = STAGE_COLORS[c.pipeline_stage] || '#94a3b8'
                const svcCount = clientServices(c.id).length
                const noteCount = clientNotes(c.id).length
                const assessCount = clientAssessments(c.id).length
                const isSelected = selectedClient === c.id

                return (
                  <div key={c.id} onClick={() => { setSelectedClient(c.id); setClientTab('overview') }}
                    className={`px-4 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-np-blue/5 border-l-2 border-l-np-blue' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-np-dark truncate">{name}</p>
                        <p className="text-xs text-gray-400 truncate">{c.email}</p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ml-2 flex-shrink-0"
                        style={{ background: sc + '18', color: sc }}>
                        {c.pipeline_stage}
                      </span>
                    </div>
                    {(svcCount > 0 || noteCount > 0 || assessCount > 0) && (
                      <div className="flex gap-3 mt-1.5">
                        {svcCount > 0 && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Activity className="w-3 h-3" />{svcCount}</span>}
                        {noteCount > 0 && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><ClipboardList className="w-3 h-3" />{noteCount}</span>}
                        {assessCount > 0 && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><FileText className="w-3 h-3" />{assessCount}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Client Detail Card ── */}
        {selected && (
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl overflow-hidden">
            {/* Card Header */}
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-np-dark">
                    {selected.preferred_name || `${selected.first_name} ${selected.last_name}`}
                  </h2>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    {selected.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{selected.email}</span>}
                    {selected.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selected.phone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: (STAGE_COLORS[selected.pipeline_stage] || '#94a3b8') + '18', color: STAGE_COLORS[selected.pipeline_stage] || '#94a3b8' }}>
                    {selected.pipeline_stage}
                  </span>
                  <button onClick={() => setSelectedClient(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
              {/* Tags */}
              {selected.tags?.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {selected.tags.map(t => (
                    <span key={t} className="text-[10px] font-medium px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md">{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Card Tabs */}
            <div className="flex border-b border-gray-100">
              {[
                { id: 'overview' as const, label: 'Overview', icon: Eye },
                { id: 'services' as const, label: isSensorium ? 'Services' : 'Sessions', icon: Activity },
                { id: 'notes' as const, label: 'Notes', icon: ClipboardList },
                { id: 'assessments' as const, label: 'Assessments & Forms', icon: FileText },
              ].map(tab => (
                <button key={tab.id} onClick={() => setClientTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors
                    ${clientTab === tab.id ? 'border-np-blue text-np-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  <tab.icon className="w-3.5 h-3.5" /> {tab.label}
                </button>
              ))}
            </div>

            {/* Card Content */}
            <div className="p-5 max-h-[60vh] overflow-y-auto">

              {/* ── Overview Tab ── */}
              {clientTab === 'overview' && (
                <div className="space-y-4">
                  {/* Quick Stats */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: isSensorium ? 'Services' : 'Sessions', value: clientServices(selected.id).length, color: '#0D9488' },
                      { label: 'Notes', value: clientNotes(selected.id).length, color: '#228DC4' },
                      { label: 'Assessments', value: clientAssessments(selected.id).filter(a => a.status === 'completed').length, color: '#8B5CF6' },
                      { label: 'Pending', value: clientAssessments(selected.id).filter(a => a.status === 'sent').length, color: '#F59E0B' },
                    ].map(s => (
                      <div key={s.label} className="text-center p-3 rounded-xl bg-gray-50">
                        <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Client Info */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Client Information</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        ['Source', selected.source || 'Unknown'],
                        ['Pipeline', selected.pipeline_stage],
                        ['Created', new Date(selected.created_at).toLocaleDateString()],
                        ['DOB', selected.date_of_birth ? new Date(selected.date_of_birth).toLocaleDateString() : 'Not set'],
                        ['Emergency', selected.emergency_contact_name || 'Not set'],
                        ['Subscription', selected.subscription_status || 'None'],
                      ].map(([k, v]) => (
                        <div key={k}><span className="text-gray-400">{k}: </span><span className="font-medium text-np-dark">{v}</span></div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div>
                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Quick Actions</h4>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => openSendLink(selected, 'intake_form', 'Intake Form')}
                        className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 text-teal-700 rounded-lg text-xs font-medium hover:bg-teal-100">
                        <Send className="w-3 h-3" /> Send Intake Form
                      </button>
                      <button onClick={() => openSendLink(selected, 'consent_form', 'Consent Form')}
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100">
                        <Send className="w-3 h-3" /> Send Consent
                      </button>
                      <button onClick={() => openSendLink(selected, 'nsci', 'NSCI Assessment')}
                        className="flex items-center gap-1.5 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100">
                        <Send className="w-3 h-3" /> Send NSCI
                      </button>
                      <button onClick={() => { setShowAddNote(true); setNoteText(''); setAiNote('') }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100">
                        <Mic className="w-3 h-3" /> Add Note
                      </button>
                      {isSensorium && (
                        <button onClick={() => setShowAddService(true)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium hover:bg-rose-100">
                          <Plus className="w-3 h-3" /> Add Service
                        </button>
                      )}
                      <a href={`${NEUROREPORT_URL}/client/${selected.email}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-100">
                        <Brain className="w-3 h-3" /> Open in NeuroReport
                      </a>
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div>
                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent Activity</h4>
                    <div className="space-y-2">
                      {[
                        ...clientServices(selected.id).slice(0, 3).map(s => ({ date: s.service_date, type: 'service', label: s.service_type, detail: s.provider_name })),
                        ...clientNotes(selected.id).slice(0, 3).map(n => ({ date: n.session_date, type: 'note', label: n.session_type || 'Session Note', detail: n.author_name })),
                        ...clientAssessments(selected.id).slice(0, 3).map(a => ({ date: a.completed_at || a.sent_at || a.created_at, type: 'assessment', label: a.assessment_name, detail: a.status })),
                      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
                            ${item.type === 'service' ? 'bg-teal-50' : item.type === 'note' ? 'bg-blue-50' : 'bg-purple-50'}`}>
                            {item.type === 'service' ? <Activity className="w-3.5 h-3.5 text-teal-600" /> :
                             item.type === 'note' ? <ClipboardList className="w-3.5 h-3.5 text-blue-600" /> :
                             <FileText className="w-3.5 h-3.5 text-purple-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-np-dark truncate">{item.label}</p>
                            <p className="text-[10px] text-gray-400">{item.detail}</p>
                          </div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                          </span>
                        </div>
                      ))}
                      {clientServices(selected.id).length === 0 && clientNotes(selected.id).length === 0 && clientAssessments(selected.id).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-4">No activity yet</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Services Tab (Sensorium) / Sessions Tab (NP) ── */}
              {clientTab === 'services' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-np-dark">{isSensorium ? 'Service History' : 'Session History'}</h4>
                    <button onClick={() => setShowAddService(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-np-blue text-white rounded-lg text-[11px] font-medium">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {clientServices(selected.id).length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No {isSensorium ? 'services' : 'sessions'} recorded yet</p>
                  ) : clientServices(selected.id).map(svc => {
                    const stColor = serviceTypes.find(st => st.key === svc.service_type)?.color || '#6B7280'
                    return (
                      <div key={svc.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md text-white" style={{ background: stColor }}>
                              {serviceTypes.find(st => st.key === svc.service_type)?.name || svc.service_type}
                            </span>
                            <p className="text-xs text-gray-400 mt-1">{new Date(svc.service_date).toLocaleDateString()} · {svc.duration_minutes}min · {svc.provider_name}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full
                            ${svc.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            {svc.status}
                          </span>
                        </div>
                        {svc.notes && <p className="text-xs text-gray-600 mt-2 bg-gray-50 rounded-lg p-3">{svc.notes}</p>}
                        {svc.ai_generated && <span className="text-[10px] text-purple-500 flex items-center gap-0.5 mt-1"><Sparkles className="w-3 h-3" />AI-formatted</span>}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Notes Tab ── */}
              {clientTab === 'notes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-np-dark">Session Notes</h4>
                    <button onClick={() => { setShowAddNote(true); setNoteText(''); setAiNote('') }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-np-blue text-white rounded-lg text-[11px] font-medium">
                      <Plus className="w-3 h-3" /> Add Note
                    </button>
                  </div>
                  {clientNotes(selected.id).length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No notes yet. Use the AI assistant to format speech into structured clinical notes.</p>
                  ) : clientNotes(selected.id).map(note => (
                    <div key={note.id} className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-np-dark">{note.session_type || 'Session Note'}</span>
                          {note.ai_formatted && <span className="text-[10px] text-purple-500 flex items-center gap-0.5"><Sparkles className="w-3 h-3" />AI</span>}
                        </div>
                        <span className="text-[10px] text-gray-400">{new Date(note.session_date).toLocaleDateString()} · {note.author_name}</span>
                      </div>
                      {note.summary && <p className="text-xs text-gray-500 mb-2 italic">{note.summary}</p>}
                      <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{note.structured_note || note.raw_transcript}</div>
                      <span className={`text-[10px] mt-2 inline-block px-2 py-0.5 rounded-full
                        ${note.status === 'finalized' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {note.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Assessments & Forms Tab ── */}
              {clientTab === 'assessments' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-np-dark">Assessments, Batteries & Forms</h4>
                  </div>
                  <p className="text-[10px] text-gray-400">Send links directly to the client via email or SMS. Status updates when they complete.</p>

                  {/* Assessment Grid */}
                  <div className="space-y-2">
                    {DEFAULT_ASSESSMENTS.map(assess => {
                      const link = clientAssessments(selected.id).find(a => a.assessment_type === assess.key)
                      const status = link?.status || 'not_sent'
                      const statusColor = status === 'completed' ? '#10B981' : status === 'sent' ? '#F59E0B' : status === 'started' ? '#3B82F6' : '#D1D5DB'

                      return (
                        <div key={assess.key} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{assess.icon}</span>
                            <div>
                              <p className="text-xs font-medium text-np-dark">{assess.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: statusColor + '18', color: statusColor }}>
                                  {status.replace('_', ' ')}
                                </span>
                                {link?.sent_at && <span className="text-[10px] text-gray-400">Sent {new Date(link.sent_at).toLocaleDateString()}</span>}
                                {link?.completed_at && <span className="text-[10px] text-emerald-500">Done {new Date(link.completed_at).toLocaleDateString()}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {link?.report_url && (
                              <a href={link.report_url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-600 rounded-md text-[10px] font-medium hover:bg-purple-100">
                                <Eye className="w-3 h-3" /> View
                              </a>
                            )}
                            <button onClick={() => openSendLink(selected, assess.key, assess.name)}
                              className="flex items-center gap-1 px-2 py-1 bg-np-blue/10 text-np-blue rounded-md text-[10px] font-medium hover:bg-np-blue/20">
                              <Send className="w-3 h-3" /> {status === 'not_sent' ? 'Send' : 'Resend'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Dynamic assessments from NeuroReport would load here */}
                  <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-xl">
                    <p className="text-xs font-medium text-orange-800 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5" /> NeuroReport Integration
                    </p>
                    <p className="text-[10px] text-orange-600 mt-1">
                      Additional assessments and batteries created in NeuroReport at {NEUROREPORT_URL} will appear here automatically when the API bridge is connected.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODALS ═══ */}

      {/* Send Link Modal */}
      {showSendLink && sendTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSendLink(false)}>
          <div className="bg-white rounded-2xl w-[420px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-np-dark">Send {sendTarget.name}</h3>
              <button onClick={() => setShowSendLink(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-xs font-medium text-np-dark">{sendTarget.client.first_name} {sendTarget.client.last_name}</p>
              <p className="text-[10px] text-gray-400">{sendTarget.client.email} · {sendTarget.client.phone}</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">URL: <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{sendTarget.url}</code></p>
            <div className="space-y-2">
              <button onClick={() => executeSend('email')} disabled={!sendTarget.client.email}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-np-blue text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-np-blue/90">
                <Mail className="w-4 h-4" /> Send via Email
              </button>
              <button onClick={() => executeSend('sms')} disabled={!sendTarget.client.phone}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-teal-700">
                <MessageSquare className="w-4 h-4" /> Send via SMS
              </button>
              <button onClick={() => executeSend('both')} disabled={!sendTarget.client.email || !sendTarget.client.phone}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-np-dark rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-gray-50">
                <Send className="w-4 h-4" /> Send Both
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal with AI */}
      {showAddNote && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddNote(false)}>
          <div className="bg-white rounded-2xl w-[520px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-np-dark flex items-center gap-2">
                <Mic className="w-4 h-4 text-np-blue" /> Session Note
              </h3>
              <button onClick={() => setShowAddNote(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-400 mb-3">Type or paste your raw notes. The AI assistant will format them into structured clinical documentation.</p>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={6}
              placeholder="Start typing your session notes... speak naturally, the AI will structure them into SOAP format."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            <div className="flex gap-2 mt-3">
              <button onClick={processNoteWithAI} disabled={!noteText.trim() || aiProcessing}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-purple-700">
                <Sparkles className="w-3.5 h-3.5" /> {aiProcessing ? 'Processing...' : 'Format with AI'}
              </button>
            </div>
            {aiNote && (
              <div className="mt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs font-semibold text-purple-700">AI-Structured Note</span>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {aiNote}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddNote(false)} className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={saveSessionNote} disabled={!noteText.trim()}
                className="px-4 py-2 bg-np-blue text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-np-blue/90">
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Service Modal (Sensorium) */}
      {showAddService && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddService(false)}>
          <div className="bg-white rounded-2xl w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-np-dark">Add Service Entry</h3>
              <button onClick={() => setShowAddService(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Service Type</label>
                <select value={serviceForm.type} onChange={e => setServiceForm(p => ({ ...p, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  <option value="">Select service...</option>
                  {(isSensorium ? serviceTypes : [
                    { key: 'vr_biofeedback', name: 'VR Biofeedback Session' },
                    { key: 'hrv_monitoring', name: 'HRV Monitoring' },
                    { key: 'consult', name: 'Consultation' },
                  ]).map(st => <option key={st.key} value={st.key}>{st.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Date</label>
                  <input type="date" value={serviceForm.date} onChange={e => setServiceForm(p => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Duration (min)</label>
                  <input type="number" value={serviceForm.duration} onChange={e => setServiceForm(p => ({ ...p, duration: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Provider</label>
                <input value={serviceForm.provider} onChange={e => setServiceForm(p => ({ ...p, provider: e.target.value }))}
                  placeholder={user?.user_metadata?.full_name || ''}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Notes</label>
                <textarea value={serviceForm.notes} onChange={e => setServiceForm(p => ({ ...p, notes: e.target.value }))} rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddService(false)} className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={saveService} disabled={!serviceForm.type}
                className="px-4 py-2 bg-np-blue text-white rounded-lg text-xs font-medium disabled:opacity-40">Save Service</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {showAddClient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddClient(false)}>
          <div className="bg-white rounded-2xl w-[420px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-np-dark">Add Client</h3>
              <button onClick={() => setShowAddClient(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">First Name *</label>
                  <input value={clientForm.first_name} onChange={e => setClientForm(p => ({ ...p, first_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Last Name</label>
                  <input value={clientForm.last_name} onChange={e => setClientForm(p => ({ ...p, last_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Email</label>
                <input type="email" value={clientForm.email} onChange={e => setClientForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Phone</label>
                <input value={clientForm.phone} onChange={e => setClientForm(p => ({ ...p, phone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Pipeline Stage</label>
                <select value={clientForm.pipeline_stage} onChange={e => setClientForm(p => ({ ...p, pipeline_stage: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {isNP ? (
                    <>
                      <optgroup label="Enrolled"><option value="Enrolled">Enrolled</option></optgroup>
                      <optgroup label="Mastermind">
                        {['Applied','Discovery Call','Accepted','Deposit Paid','Equipment Shipped','Active (in cohort)','Completed','Alumni'].map(s => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                      <optgroup label="Subscribed">
                        {['Trial','Active Monthly','Active Annual','Past Due','Paused','Churned','Reactivated'].map(s => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    </>
                  ) : (
                    <>
                      <option value="New Lead">New Lead</option>
                      <option value="Contacted">Contacted</option>
                      <option value="Qualified">Qualified</option>
                      <option value="Enrolled">Enrolled</option>
                    </>
                  )}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddClient(false)} className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={saveNewClient} disabled={!clientForm.first_name}
                className="px-4 py-2 bg-np-blue text-white rounded-lg text-xs font-medium disabled:opacity-40">Add Client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

