'use client'

// ═══════════════════════════════════════════════════════════════
// Unified Campaigns Hub — Marketing, Drip/Automation, Social
// Permission-gated tabs: CRM → drip/email/SMS, Social → social
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import CampaignFlowBuilder, { type FlowNode, type FlowEdge } from '@/components/campaigns/campaign-flow-builder'
import {
  Plus, Wand2, Target, TrendingUp, Calendar, DollarSign, Zap, X, Send, Bot,
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, Edit3, Trash2, ExternalLink,
  ChevronDown, Users, Link2, BarChart3, Clock, CheckSquare, Square, User,
  Megaphone, Mail, MessageCircle, Share2, Search, Pause, Play, Copy,
  Eye, Filter, MoreHorizontal, Settings, GitBranch, Save, Smartphone,
  Instagram, Facebook, Linkedin, Youtube, AlertTriangle
} from 'lucide-react'

// ─── TYPES ───

interface Campaign {
  id: string; org_id: string; name: string; brand: string
  description: string | null; status: string
  budget: number | null; start_date: string | null; end_date: string | null
  goals: Record<string, any>; ai_suggestions: Record<string, any>
  custom_fields: Record<string, any>; created_at: string
}

interface Automation {
  id: string; org_id: string; campaign_id: string | null
  name: string; description: string | null
  type: 'email_drip' | 'sms_drip' | 'mixed' | 'social' | 'multi_channel'
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived'
  nodes: FlowNode[]; edges: FlowEdge[]
  trigger_config: Record<string, any>
  stats: { entered: number; active: number; completed: number; exited: number }
  start_at: string | null; end_at: string | null
  created_by: string | null; created_at: string; updated_at: string
}

interface EmailCampaign {
  id: string; org_id: string; name: string; subject: string
  body_html: string; status: string
  filter_criteria?: Record<string, any> | null
  total_recipients?: number | null; sent_count: number; failed_count: number
  created_at: string
}

type TabId = 'marketing' | 'automations' | 'social'

// ─── CONFIG ───

const CAMPAIGN_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  planning:      { label: 'Planning',    color: '#8b5cf6', bg: '#8b5cf620' },
  'in-progress': { label: 'In Progress', color: '#3b82f6', bg: '#3b82f620' },
  active:        { label: 'Active',      color: '#10b981', bg: '#10b98120' },
  paused:        { label: 'Paused',      color: '#f59e0b', bg: '#f59e0b20' },
  completed:     { label: 'Completed',   color: '#386797', bg: '#38679720' },
  archived:      { label: 'Archived',    color: '#64748b', bg: '#64748b20' },
}

const AUTOMATION_STATUS: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft:     { label: 'Draft',     color: '#6b7280', bg: '#f3f4f6', icon: Edit3 },
  active:    { label: 'Active',    color: '#10b981', bg: '#ecfdf5', icon: Play },
  paused:    { label: 'Paused',    color: '#f59e0b', bg: '#fffbeb', icon: Pause },
  completed: { label: 'Completed', color: '#386797', bg: '#dbeafe', icon: CheckCircle2 },
  archived:  { label: 'Archived',  color: '#64748b', bg: '#f1f5f9', icon: Eye },
}

const AUTO_TYPE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  email_drip:    { label: 'Email Drip',    icon: Mail,           color: '#3b82f6' },
  sms_drip:      { label: 'SMS Drip',      icon: MessageCircle,  color: '#10b981' },
  mixed:         { label: 'Multi-Channel',  icon: GitBranch,      color: '#8b5cf6' },
  social:        { label: 'Social',         icon: Share2,         color: '#ec4899' },
  multi_channel: { label: 'Multi-Channel',  icon: Zap,            color: '#f97316' },
}

const PLATFORMS = [
  { id: 'meta', label: 'Meta', icon: '📘' },
  { id: 'google', label: 'Google', icon: '🔍' },
  { id: 'youtube', label: 'YouTube', icon: '📺' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵' },
  { id: 'instagram', label: 'Instagram', icon: '📸' },
  { id: 'multi', label: 'Multi', icon: '🌐' },
]

const DRIP_TEMPLATES = [
  { id: 'welcome_drip', name: 'Welcome Sequence', desc: '5-email onboarding drip over 2 weeks', type: 'email_drip' as const,
    nodes: [
      { id: 'n1', type: 'trigger' as const, x: 300, y: 40, data: { trigger_type: 'new_contact' }, label: 'New Contact' },
      { id: 'n2', type: 'send_email' as const, x: 300, y: 160, data: { subject: 'Welcome to Neuro Progeny', body: 'Hi {{first_name}},\n\nWelcome...', from_email: 'Cameron.allen@neuroprogeny.com' }, label: 'Welcome Email' },
      { id: 'n3', type: 'wait' as const, x: 300, y: 280, data: { amount: 2, unit: 'days' }, label: 'Wait 2 Days' },
      { id: 'n4', type: 'send_email' as const, x: 300, y: 400, data: { subject: 'Your brain is capable of more', body: '', from_email: 'Cameron.allen@neuroprogeny.com' }, label: 'Education Email' },
      { id: 'n5', type: 'wait' as const, x: 300, y: 520, data: { amount: 3, unit: 'days' }, label: 'Wait 3 Days' },
      { id: 'n6', type: 'condition' as const, x: 300, y: 640, data: { condition_type: 'email_opened', value: '' }, label: 'Opened Email?' },
      { id: 'n7', type: 'send_email' as const, x: 140, y: 790, data: { subject: 'Ready to train your nervous system?', body: '', from_email: 'Cameron.allen@neuroprogeny.com' }, label: 'Offer Email' },
      { id: 'n8', type: 'add_tag' as const, x: 460, y: 790, data: { tag: 'cold-lead' }, label: 'Tag Cold' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', fromHandle: 'default' as const },
      { id: 'e2', from: 'n2', to: 'n3', fromHandle: 'default' as const },
      { id: 'e3', from: 'n3', to: 'n4', fromHandle: 'default' as const },
      { id: 'e4', from: 'n4', to: 'n5', fromHandle: 'default' as const },
      { id: 'e5', from: 'n5', to: 'n6', fromHandle: 'default' as const },
      { id: 'e6', from: 'n6', to: 'n7', fromHandle: 'yes' as const, label: 'Yes' },
      { id: 'e7', from: 'n6', to: 'n8', fromHandle: 'no' as const, label: 'No' },
    ],
  },
  { id: 'sms_followup', name: 'SMS Follow-Up', desc: '3-text check-in after consultation', type: 'sms_drip' as const,
    nodes: [
      { id: 'n1', type: 'trigger' as const, x: 300, y: 40, data: { trigger_type: 'tag_added', tag: 'consultation-done' }, label: 'Consultation Done' },
      { id: 'n2', type: 'wait' as const, x: 300, y: 160, data: { amount: 1, unit: 'days' }, label: 'Wait 1 Day' },
      { id: 'n3', type: 'send_sms' as const, x: 300, y: 280, data: { message: 'Hi {{first_name}}, thanks for your consultation yesterday. Any questions?' }, label: 'Check-In SMS' },
      { id: 'n4', type: 'wait' as const, x: 300, y: 400, data: { amount: 3, unit: 'days' }, label: 'Wait 3 Days' },
      { id: 'n5', type: 'send_sms' as const, x: 300, y: 520, data: { message: 'Hi {{first_name}}, did you have a chance to review the resources I sent?' }, label: 'Follow-Up SMS' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', fromHandle: 'default' as const },
      { id: 'e2', from: 'n2', to: 'n3', fromHandle: 'default' as const },
      { id: 'e3', from: 'n3', to: 'n4', fromHandle: 'default' as const },
      { id: 'e4', from: 'n4', to: 'n5', fromHandle: 'default' as const },
    ],
  },
  { id: 'pipeline_nurture', name: 'Pipeline Nurture', desc: 'Multi-channel nurture when stage changes to Qualified', type: 'mixed' as const,
    nodes: [
      { id: 'n1', type: 'trigger' as const, x: 300, y: 40, data: { trigger_type: 'pipeline_change', stage: 'Qualified' }, label: 'Became Qualified' },
      { id: 'n2', type: 'send_email' as const, x: 300, y: 160, data: { subject: 'Your personalized path forward', body: '', from_email: 'Cameron.allen@neuroprogeny.com' }, label: 'Personalized Email' },
      { id: 'n3', type: 'create_task' as const, x: 300, y: 280, data: { title: 'Call {{first_name}} for discovery', assignee: '', priority: 'high' }, label: 'Create Follow-Up Task' },
      { id: 'n4', type: 'wait' as const, x: 300, y: 400, data: { amount: 2, unit: 'days' }, label: 'Wait 2 Days' },
      { id: 'n5', type: 'send_sms' as const, x: 300, y: 520, data: { message: 'Hi {{first_name}}, checking in about the Immersive Mastermind. Ready to chat?' }, label: 'SMS Nudge' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', fromHandle: 'default' as const },
      { id: 'e2', from: 'n2', to: 'n3', fromHandle: 'default' as const },
      { id: 'e3', from: 'n3', to: 'n4', fromHandle: 'default' as const },
      { id: 'e4', from: 'n4', to: 'n5', fromHandle: 'default' as const },
    ],
  },
]

// ─── COMPONENT ───

export default function CampaignsPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  // Tabs
  const [activeTab, setActiveTab] = useState<TabId>('automations')
  const [permissions, setPermissions] = useState<Record<string, string>>({})

  // Marketing campaigns (existing)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignLoading, setCampaignLoading] = useState(true)

  // Automations (new flow builder)
  const [automations, setAutomations] = useState<Automation[]>([])
  const [autoLoading, setAutoLoading] = useState(true)
  const [editingAuto, setEditingAuto] = useState<Automation | null>(null)
  const [showCreateAuto, setShowCreateAuto] = useState(false)
  const [autoSearch, setAutoSearch] = useState('')
  const [autoFilter, setAutoFilter] = useState('')
  const [autoTypeFilter, setAutoTypeFilter] = useState('')

  // Create automation form
  const [newAutoName, setNewAutoName] = useState('')
  const [newAutoType, setNewAutoType] = useState<Automation['type']>('email_drip')
  const [newAutoDesc, setNewAutoDesc] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')

  // Team members
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; display_name: string }>>([])

  // Email campaigns (from CRM)
  const [emailCampaigns, setEmailCampaigns] = useState<EmailCampaign[]>([])

  // Marketing campaign form
  const [showCreateCampaign, setShowCreateCampaign] = useState(false)
  const [campForm, setCampForm] = useState({
    name: '', status: 'planning', type: 'lead-gen', platform: 'meta',
    startDate: '', endDate: '', objective: '', budget: '', brand: 'np',
  })

  // Load permissions
  useEffect(() => {
    if (!currentOrg || !user) return
    supabase.from('team_profiles').select('permissions').eq('org_id', currentOrg.id).eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data?.permissions?.modules) setPermissions(data.permissions.modules)
      })
  }, [currentOrg?.id, user?.id])

  // Check permissions
  const hasCrmAccess = !permissions.crm || permissions.crm !== 'none'
  const hasSocialAccess = !permissions.social || permissions.social !== 'none'
  const hasCampaignAccess = !permissions.campaigns || permissions.campaigns !== 'none'

  // Determine visible tabs
  const tabs: Array<{ id: TabId; label: string; icon: any; visible: boolean }> = [
    { id: 'automations', label: 'Automations & Drips', icon: GitBranch, visible: hasCrmAccess },
    { id: 'marketing',   label: 'Marketing Campaigns', icon: Megaphone,  visible: hasCampaignAccess },
    { id: 'social',      label: 'Social Campaigns',    icon: Share2,     visible: hasSocialAccess },
  ]
  const visibleTabs = tabs.filter(t => t.visible)

  // ─── Data Loading ───

  const loadData = useCallback(async () => {
    if (!currentOrg) return

    const [autoRes, campRes, teamRes, emailRes] = await Promise.all([
      supabase.from('campaign_automations').select('*').eq('org_id', currentOrg.id).order('updated_at', { ascending: false }),
      supabase.from('campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('team_profiles').select('id, display_name').eq('org_id', currentOrg.id).eq('status', 'active'),
      supabase.from('email_campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
    ])

    if (autoRes.data) setAutomations(autoRes.data as Automation[])
    if (campRes.data) setCampaigns(campRes.data)
    if (teamRes.data) setTeamMembers(teamRes.data)
    if (emailRes.data) setEmailCampaigns(emailRes.data as EmailCampaign[])

    setAutoLoading(false)
    setCampaignLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { loadData() }, [loadData])

  // ─── Automation CRUD ───

  const createAutomation = async () => {
    if (!newAutoName.trim() || !currentOrg || !user) return

    const template = DRIP_TEMPLATES.find(t => t.id === selectedTemplate)
    const payload = {
      org_id: currentOrg.id,
      name: newAutoName.trim(),
      description: newAutoDesc || null,
      type: template?.type || newAutoType,
      status: 'draft' as const,
      nodes: template?.nodes || [],
      edges: template?.edges || [],
      trigger_config: {},
      stats: { entered: 0, active: 0, completed: 0, exited: 0 },
      created_by: user.id,
    }

    const { data, error } = await supabase.from('campaign_automations').insert(payload).select().single()
    if (data && !error) {
      setAutomations(prev => [data as Automation, ...prev])
      setEditingAuto(data as Automation)
      setShowCreateAuto(false)
      setNewAutoName(''); setNewAutoDesc(''); setSelectedTemplate('')
    }
  }

  const saveAutomation = async (auto: Automation) => {
    const { error } = await supabase.from('campaign_automations')
      .update({ nodes: auto.nodes, edges: auto.edges, name: auto.name, description: auto.description })
      .eq('id', auto.id)
    if (!error) {
      setAutomations(prev => prev.map(a => a.id === auto.id ? auto : a))
    }
  }

  const updateAutoStatus = async (id: string, status: Automation['status']) => {
    const { data, error } = await supabase.from('campaign_automations')
      .update({ status }).eq('id', id).select().single()
    if (data && !error) {
      setAutomations(prev => prev.map(a => a.id === id ? data as Automation : a))
      if (editingAuto?.id === id) setEditingAuto(data as Automation)
    }
  }

  const deleteAutomation = async (id: string) => {
    if (!confirm('Delete this automation? This cannot be undone.')) return
    await supabase.from('campaign_automations').delete().eq('id', id)
    setAutomations(prev => prev.filter(a => a.id !== id))
    if (editingAuto?.id === id) setEditingAuto(null)
  }

  const duplicateAutomation = async (auto: Automation) => {
    if (!currentOrg || !user) return
    const { data } = await supabase.from('campaign_automations').insert({
      org_id: currentOrg.id, name: `${auto.name} (Copy)`, description: auto.description,
      type: auto.type, status: 'draft', nodes: auto.nodes, edges: auto.edges,
      trigger_config: auto.trigger_config, stats: { entered: 0, active: 0, completed: 0, exited: 0 },
      created_by: user.id,
    }).select().single()
    if (data) setAutomations(prev => [data as Automation, ...prev])
  }

  // ─── Marketing Campaign CRUD ───

  const createMarketingCampaign = async () => {
    if (!campForm.name.trim() || !currentOrg) return
    const { data, error } = await supabase.from('campaigns').insert({
      org_id: currentOrg.id, name: campForm.name.trim(), brand: campForm.brand,
      description: campForm.objective || null, status: campForm.status,
      budget: campForm.budget ? parseFloat(campForm.budget) : null,
      start_date: campForm.startDate || null, end_date: campForm.endDate || null,
      goals: { objective: campForm.objective, type: campForm.type },
      ai_suggestions: {}, custom_fields: { platform: campForm.platform, type: campForm.type },
    }).select().single()
    if (data && !error) {
      setCampaigns(prev => [data, ...prev])
      setShowCreateCampaign(false)
      setCampForm({ name: '', status: 'planning', type: 'lead-gen', platform: 'meta', startDate: '', endDate: '', objective: '', budget: '', brand: 'np' })
    }
  }

  // ─── Filtered automations ───

  const filteredAutomations = automations.filter(a => {
    // Filter by tab: social tab shows only social type, automations shows CRM types
    if (activeTab === 'social' && a.type !== 'social') return false
    if (activeTab === 'automations' && a.type === 'social') return false
    if (autoFilter && a.status !== autoFilter) return false
    if (autoTypeFilter && a.type !== autoTypeFilter) return false
    if (autoSearch && !a.name.toLowerCase().includes(autoSearch.toLowerCase())) return false
    return true
  })

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  // ─── Flow Builder View ───

  if (editingAuto) {
    return (
      <div className="h-[calc(100vh-6rem)] flex flex-col">
        {/* Flow Header */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => { saveAutomation(editingAuto); setEditingAuto(null) }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-np-dark transition-colors">
              <ArrowLeft size={14} /> Back
            </button>
            <div className="h-4 w-px bg-gray-200" />
            <input value={editingAuto.name}
              onChange={e => setEditingAuto({ ...editingAuto, name: e.target.value })}
              className="text-sm font-bold text-np-dark bg-transparent border-b border-transparent hover:border-gray-300 focus:border-np-blue outline-none px-1" />
            {(() => {
              const st = AUTOMATION_STATUS[editingAuto.status]
              return (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold" style={{ color: st.color, background: st.bg }}>
                  <st.icon size={9} /> {st.label}
                </span>
              )
            })()}
          </div>
          <div className="flex items-center gap-2">
            {/* Stats */}
            <div className="flex gap-3 mr-2">
              {Object.entries(editingAuto.stats || {}).map(([k, v]) => (
                <div key={k} className="text-center">
                  <p className="text-sm font-bold text-np-dark">{v as number}</p>
                  <p className="text-[8px] text-gray-400 capitalize">{k}</p>
                </div>
              ))}
            </div>
            <div className="h-4 w-px bg-gray-200" />
            {editingAuto.status === 'draft' && (
              <button onClick={() => updateAutoStatus(editingAuto.id, 'active')}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-white bg-green-600 rounded-md hover:bg-green-700">
                <Play size={10} /> Activate
              </button>
            )}
            {editingAuto.status === 'active' && (
              <button onClick={() => updateAutoStatus(editingAuto.id, 'paused')}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100">
                <Pause size={10} /> Pause
              </button>
            )}
            {editingAuto.status === 'paused' && (
              <button onClick={() => updateAutoStatus(editingAuto.id, 'active')}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100">
                <Play size={10} /> Resume
              </button>
            )}
            <button onClick={() => saveAutomation(editingAuto)}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark">
              <Save size={10} /> Save
            </button>
          </div>
        </div>

        {/* Flow Canvas */}
        <div className="flex-1 min-h-0">
          <CampaignFlowBuilder
            nodes={editingAuto.nodes}
            edges={editingAuto.edges}
            teamMembers={teamMembers}
            readOnly={editingAuto.status === 'active'}
            onChange={(newNodes, newEdges) => setEditingAuto({ ...editingAuto, nodes: newNodes, edges: newEdges })}
          />
        </div>
      </div>
    )
  }

  // ─── Main View ───

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Campaigns</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">Build drip sequences, marketing campaigns, and social content</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
        {visibleTabs.map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.id ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400 hover:text-gray-600'
              }`}>
              <Icon size={13} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ═══ Automations Tab ═══ */}
      {(activeTab === 'automations' || activeTab === 'social') && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={autoSearch} onChange={e => setAutoSearch(e.target.value)} placeholder="Search automations..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#386797]/30" />
            </div>
            <div className="flex gap-1">
              {['', 'draft', 'active', 'paused', 'completed'].map(s => (
                <button key={s} onClick={() => setAutoFilter(s)}
                  className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                    autoFilter === s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'
                  }`}>{s || 'All'}</button>
              ))}
            </div>
            {activeTab === 'automations' && (
              <div className="flex gap-1">
                {['', 'email_drip', 'sms_drip', 'mixed'].map(t => (
                  <button key={t} onClick={() => setAutoTypeFilter(t)}
                    className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                      autoTypeFilter === t ? 'bg-[#386797]/10 text-[#386797]' : 'bg-gray-50 text-gray-400'
                    }`}>{t ? AUTO_TYPE_LABELS[t]?.label || t : 'All Types'}</button>
                ))}
              </div>
            )}
            <button onClick={() => setShowCreateAuto(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={13} /> New Automation
            </button>
          </div>

          {/* Automation Grid */}
          {autoLoading ? (
            <div className="text-center py-12"><Loader2 className="mx-auto w-5 h-5 animate-spin text-gray-300" /></div>
          ) : filteredAutomations.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <GitBranch size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No automations yet</p>
              <p className="text-[10px] text-gray-400 mb-4">Create your first drip sequence or automation flow</p>
              <button onClick={() => setShowCreateAuto(true)}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark">
                <Plus size={12} className="inline mr-1" /> Create Automation
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAutomations.map(auto => {
                const st = AUTOMATION_STATUS[auto.status] || AUTOMATION_STATUS.draft
                const tp = AUTO_TYPE_LABELS[auto.type] || AUTO_TYPE_LABELS.mixed
                const TpIcon = tp.icon
                const StIcon = st.icon
                return (
                  <div key={auto.id} onClick={() => setEditingAuto(auto)}
                    className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md hover:border-[#386797]/20 transition-all cursor-pointer group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: tp.color + '15' }}>
                          <TpIcon size={15} style={{ color: tp.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-np-dark truncate">{auto.name}</h4>
                          <p className="text-[9px] text-gray-400 truncate">{auto.description || tp.label}</p>
                        </div>
                      </div>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold flex-shrink-0"
                        style={{ color: st.color, background: st.bg }}>
                        <StIcon size={9} /> {st.label}
                      </span>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-4 gap-1 mb-3">
                      {Object.entries(auto.stats || {}).map(([k, v]) => (
                        <div key={k} className="text-center py-1.5 rounded-lg bg-gray-50/80">
                          <p className="text-sm font-bold text-np-dark">{v as number}</p>
                          <p className="text-[7px] text-gray-400 uppercase">{k}</p>
                        </div>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                      <span className="text-[9px] text-gray-400">
                        {auto.nodes?.length || 0} nodes &middot; {auto.edges?.length || 0} connections
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button onClick={() => duplicateAutomation(auto)} className="p-1 rounded hover:bg-gray-100" title="Duplicate">
                          <Copy size={11} className="text-gray-400" />
                        </button>
                        <button onClick={() => deleteAutomation(auto.id)} className="p-1 rounded hover:bg-red-50" title="Delete">
                          <Trash2 size={11} className="text-gray-400 hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ Marketing Campaigns Tab ═══ */}
      {activeTab === 'marketing' && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {Object.entries(CAMPAIGN_STATUS).map(([k, v]) => (
                <span key={k} className="px-2 py-1 text-[9px] font-medium rounded" style={{ color: v.color, background: v.bg }}>
                  {campaigns.filter(c => c.status === k).length} {v.label}
                </span>
              ))}
            </div>
            <button onClick={() => setShowCreateCampaign(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark">
              <Plus size={13} /> New Campaign
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(camp => {
              const st = CAMPAIGN_STATUS[camp.status] || CAMPAIGN_STATUS.planning
              const platform = PLATFORMS.find(p => p.id === camp.custom_fields?.platform)
              return (
                <div key={camp.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-all cursor-pointer">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-np-dark truncate">{camp.name}</h4>
                      <p className="text-[9px] text-gray-400 mt-0.5">{platform?.icon} {platform?.label || 'Multi'} &middot; {camp.custom_fields?.type || 'General'}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                  </div>
                  {camp.description && <p className="text-[10px] text-gray-500 line-clamp-2 mb-2">{camp.description}</p>}
                  <div className="flex items-center gap-3 text-[9px] text-gray-400 pt-2 border-t border-gray-50">
                    {camp.budget && <span className="flex items-center gap-0.5"><DollarSign size={9} />${camp.budget.toLocaleString()}</span>}
                    {camp.start_date && <span className="flex items-center gap-0.5"><Calendar size={9} />{new Date(camp.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    <span className="flex items-center gap-0.5"><BarChart3 size={9} />{(camp.custom_fields?.steps || []).length} steps</span>
                  </div>
                </div>
              )
            })}
            {campaigns.length === 0 && (
              <div className="col-span-full text-center py-12"><Megaphone size={32} className="mx-auto text-gray-300 mb-3" /><p className="text-sm text-gray-400">No marketing campaigns</p></div>
            )}
          </div>

          {/* Quick Email Campaigns List */}
          {emailCampaigns.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-bold text-np-dark mb-3 flex items-center gap-1.5"><Mail size={12} /> Email/SMS Campaigns</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {emailCampaigns.slice(0, 6).map(ec => {
                  const ch = (ec.filter_criteria as any)?.channel || 'email'
                  return (
                    <div key={ec.id} className="bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        {ch === 'sms' ? <MessageCircle size={12} className="text-green-500" /> : <Mail size={12} className="text-blue-500" />}
                        <span className="text-[10px] font-semibold text-np-dark truncate">{ec.name}</span>
                      </div>
                      <div className="flex gap-2 text-center">
                        <div className="flex-1 py-1 bg-gray-50 rounded"><p className="text-xs font-bold">{ec.total_recipients || 0}</p><p className="text-[7px] text-gray-400">Recipients</p></div>
                        <div className="flex-1 py-1 bg-gray-50 rounded"><p className="text-xs font-bold">{ec.sent_count}</p><p className="text-[7px] text-gray-400">Sent</p></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ Create Automation Modal ═══ */}
      {showCreateAuto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowCreateAuto(false) }}>
          <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-100 max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-np-dark">Create Automation</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Build a visual drip sequence or automation flow</p>
              </div>
              <button onClick={() => setShowCreateAuto(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} className="text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400 tracking-wider">Automation Name *</label>
                <input value={newAutoName} onChange={e => setNewAutoName(e.target.value)} placeholder="e.g., Welcome Sequence"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#386797]/30" />
              </div>

              {/* Type */}
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400 tracking-wider">Type</label>
                <div className="grid grid-cols-4 gap-2 mt-1">
                  {Object.entries(AUTO_TYPE_LABELS).filter(([k]) => activeTab === 'social' ? k === 'social' : k !== 'social').map(([k, v]) => {
                    const Icon = v.icon
                    return (
                      <button key={k} onClick={() => setNewAutoType(k as Automation['type'])}
                        className={`flex flex-col items-center gap-1 py-3 rounded-lg border-2 text-[9px] font-medium transition-all ${
                          newAutoType === k ? 'border-[#386797] bg-[#386797]/5 text-[#386797]' : 'border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}>
                        <Icon size={16} style={{ color: newAutoType === k ? v.color : undefined }} />
                        {v.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400 tracking-wider">Description (optional)</label>
                <textarea value={newAutoDesc} onChange={e => setNewAutoDesc(e.target.value)} rows={2}
                  placeholder="Brief description of what this automation does..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#386797]/30 resize-none" />
              </div>

              {/* Templates */}
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400 tracking-wider">Start From Template</label>
                <div className="space-y-2 mt-1.5">
                  <button onClick={() => setSelectedTemplate('')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                      !selectedTemplate ? 'border-[#386797] bg-[#386797]/5' : 'border-gray-100 hover:border-gray-200'
                    }`}>
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center"><Plus size={14} className="text-gray-400" /></div>
                    <div>
                      <p className="text-[10px] font-semibold text-np-dark">Blank Canvas</p>
                      <p className="text-[8px] text-gray-400">Start from scratch</p>
                    </div>
                  </button>
                  {DRIP_TEMPLATES.filter(t => activeTab === 'social' ? (t.type as string) === 'social' : (t.type as string) !== 'social').map(t => {
                    const tp = AUTO_TYPE_LABELS[t.type]
                    const TpIcon = tp?.icon || GitBranch
                    return (
                      <button key={t.id} onClick={() => { setSelectedTemplate(t.id); setNewAutoType(t.type) }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                          selectedTemplate === t.id ? 'border-[#386797] bg-[#386797]/5' : 'border-gray-100 hover:border-gray-200'
                        }`}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: (tp?.color || '#666') + '15' }}>
                          <TpIcon size={14} style={{ color: tp?.color }} />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-np-dark">{t.name}</p>
                          <p className="text-[8px] text-gray-400">{t.desc}</p>
                        </div>
                        <span className="ml-auto text-[8px] text-gray-300">{t.nodes.length} nodes</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowCreateAuto(false)} className="px-4 py-2 text-xs text-gray-400 hover:text-np-dark">Cancel</button>
              <button onClick={createAutomation} disabled={!newAutoName.trim()}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40">
                Create & Open Builder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Create Marketing Campaign Modal ═══ */}
      {showCreateCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowCreateCampaign(false) }}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">New Marketing Campaign</h3>
              <button onClick={() => setShowCreateCampaign(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} className="text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400">Campaign Name *</label>
                <input value={campForm.name} onChange={e => setCampForm(p => ({ ...p, name: e.target.value }))} placeholder="Q1 Mastermind Launch"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#386797]/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-semibold uppercase text-gray-400">Platform</label>
                  <select value={campForm.platform} onChange={e => setCampForm(p => ({ ...p, platform: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg">
                    {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase text-gray-400">Budget</label>
                  <input type="number" value={campForm.budget} onChange={e => setCampForm(p => ({ ...p, budget: e.target.value }))} placeholder="5000"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase text-gray-400">Objective</label>
                <textarea value={campForm.objective} onChange={e => setCampForm(p => ({ ...p, objective: e.target.value }))} rows={2}
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg resize-none" placeholder="Drive enrollments for Immersive Mastermind" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-semibold uppercase text-gray-400">Start Date</label>
                  <input type="date" value={campForm.startDate} onChange={e => setCampForm(p => ({ ...p, startDate: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase text-gray-400">End Date</label>
                  <input type="date" value={campForm.endDate} onChange={e => setCampForm(p => ({ ...p, endDate: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreateCampaign(false)} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={createMarketingCampaign} disabled={!campForm.name.trim()}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40">
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
