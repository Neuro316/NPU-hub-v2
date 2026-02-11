'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import {
  Plus, Wand2, Target, TrendingUp, Calendar, DollarSign, Zap, X, Send, Bot,
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, Edit3, Trash2, ExternalLink,
  ChevronDown, Users, Link2, BarChart3, Clock, CheckSquare, Square, User
} from 'lucide-react'

// ─── CONSTANTS ───

const PHASES = [
  { id: 'ideation', name: 'Ideation', emoji: '💡', color: '#f59e0b' },
  { id: 'strategy', name: 'Strategy', emoji: '🎯', color: '#8b5cf6' },
  { id: 'creative', name: 'Creative', emoji: '🎨', color: '#ec4899' },
  { id: 'copy', name: 'Copy', emoji: '✍️', color: '#06b6d4' },
  { id: 'landing', name: 'Landing Page', emoji: '📄', color: '#10b981' },
  { id: 'tracking', name: 'Tracking', emoji: '📊', color: '#f97316' },
  { id: 'build', name: 'Build', emoji: '🔧', color: '#6366f1' },
  { id: 'qa', name: 'QA', emoji: '🔗', color: '#14b8a6' },
  { id: 'launch', name: 'Launch', emoji: '🚀', color: '#ef4444' },
  { id: 'optimize', name: 'Optimize', emoji: '⚡', color: '#eab308' },
  { id: 'report', name: 'Report', emoji: '📈', color: '#386797' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  planning: { label: 'Planning', color: '#8b5cf6', bg: '#8b5cf620', icon: '📋' },
  'in-progress': { label: 'In Progress', color: '#3b82f6', bg: '#3b82f620', icon: '🚀' },
  active: { label: 'Active', color: '#10b981', bg: '#10b98120', icon: '✅' },
  paused: { label: 'Paused', color: '#f59e0b', bg: '#f59e0b20', icon: '⏸️' },
  completed: { label: 'Completed', color: '#386797', bg: '#38679720', icon: '🏆' },
  archived: { label: 'Archived', color: '#64748b', bg: '#64748b20', icon: '📦' },
}

const STEP_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  'not-started': { label: 'Not Started', color: '#64748b', icon: '⬜' },
  'in-progress': { label: 'In Progress', color: '#FBBF24', icon: '🟡' },
  review: { label: 'In Review', color: '#3b82f6', icon: '🔵' },
  approved: { label: 'Approved', color: '#10b981', icon: '✅' },
  live: { label: 'Live', color: '#10b981', icon: '🟢' },
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

const TYPES = ['lead-gen', 'awareness', 'sales', 'retargeting', 'event', 'nurture']

const DEFAULT_STEPS = [
  { phase: 'ideation', name: 'Campaign Brief', desc: 'Define goals, audience, and key messages' },
  { phase: 'ideation', name: 'Audience Research', desc: 'Deep dive into ICP pain points' },
  { phase: 'strategy', name: 'Funnel Mapping', desc: 'Map journey from ad to enrollment' },
  { phase: 'strategy', name: 'Offer Definition', desc: 'Define the lead magnet and value prop' },
  { phase: 'creative', name: 'Hook Development', desc: 'Create 3-5 hook variations' },
  { phase: 'creative', name: 'Video Script', desc: 'Write video ad script' },
  { phase: 'creative', name: 'Image Assets', desc: 'Design static ad creative' },
  { phase: 'creative', name: 'Video Production', desc: 'Record and edit video' },
  { phase: 'copy', name: 'Primary Text', desc: 'Write ad body copy' },
  { phase: 'copy', name: 'Headlines', desc: 'Write headline variations' },
  { phase: 'copy', name: 'CTA Copy', desc: 'Finalize call-to-action' },
  { phase: 'landing', name: 'Landing Page Design', desc: 'Design the landing page' },
  { phase: 'landing', name: 'Quiz Setup', desc: 'Configure quiz scoring' },
  { phase: 'landing', name: 'Thank You Page', desc: 'Post-quiz experience' },
  { phase: 'tracking', name: 'Meta Pixel', desc: 'Install pixel events' },
  { phase: 'tracking', name: 'GA4 Setup', desc: 'Configure GA4 conversions' },
  { phase: 'tracking', name: 'UTM Parameters', desc: 'Define UTM structure' },
  { phase: 'tracking', name: 'Conversion API', desc: 'Server-side tracking' },
  { phase: 'build', name: 'Campaign Structure', desc: 'Build in ad platform' },
  { phase: 'build', name: 'Audience Setup', desc: 'Configure targeting' },
  { phase: 'build', name: 'Budget Allocation', desc: 'Set budgets and schedule' },
  { phase: 'qa', name: 'Link QA', desc: 'Verify all links and pixels' },
  { phase: 'launch', name: 'QA Testing', desc: 'Final review of all assets' },
  { phase: 'launch', name: 'Go Live', desc: 'Publish and monitor' },
  { phase: 'optimize', name: 'Performance Review', desc: 'Analyze initial results' },
  { phase: 'optimize', name: 'A/B Testing', desc: 'Monitor creative tests' },
  { phase: 'optimize', name: 'Audience Refinement', desc: 'Optimize targeting' },
  { phase: 'report', name: 'Weekly Report', desc: 'Compile metrics' },
  { phase: 'report', name: 'ROI Analysis', desc: 'Calculate ROAS and CPL' },
]

// ─── INTERFACES ───

interface CampaignStep {
  id: string
  phase: string
  name: string
  desc: string
  status: string
  assignee: string
  dueDate: string
  checklist: Array<{ text: string; done: boolean }>
  mediaUrl: string
  copyDocUrl: string
  landingPageUrl: string
  trackingPixel: string
  linkedTaskIds: string[]
}

interface Campaign {
  id: string
  org_id: string
  name: string
  brand: string
  description: string | null
  status: string
  budget: number | null
  start_date: string | null
  end_date: string | null
  goals: Record<string, any>
  ai_suggestions: Record<string, any>
  custom_fields: Record<string, any>
  created_at: string
}

interface CampaignData {
  platform: string
  type: string
  icp: string
  objective: string
  cta: string
  owner: string
  steps: CampaignStep[]
  folderUrl: string
  docUrl: string
}

interface AIMessage {
  role: 'ai' | 'user'
  content: string
  options?: string[]
}

// ─── COMPONENT ───

export default function CampaignsPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'grid' | 'expanded'>('grid')
  const [selected, setSelected] = useState<Campaign | null>(null)
  const [selectedData, setSelectedData] = useState<CampaignData | null>(null)

  // Filters
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showStepModal, setShowStepModal] = useState<CampaignStep | null>(null)
  const [showAI, setShowAI] = useState(false)

  // Create form
  const [form, setForm] = useState({
    name: '', status: 'planning', type: 'lead-gen', platform: 'meta', icp: '',
    startDate: '', endDate: '', objective: '', cta: '', budget: '', owner: '', brand: 'np',
  })

  // AI state
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiStep, setAiStep] = useState(0)
  const [aiData, setAiData] = useState<Record<string, string>>({})
  const [aiGenerating, setAiGenerating] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Linked tasks
  const [tasks, setTasks] = useState<any[]>([])

  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [campRes, taskRes] = await Promise.all([
      supabase.from('campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('kanban_tasks').select('id, title, status, assignee, priority').eq('org_id', currentOrg.id),
    ])
    if (campRes.data) setCampaigns(campRes.data)
    if (taskRes.data) setTasks(taskRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  // ─── CAMPAIGN CRUD ───

  const getCampaignData = (campaign: Campaign): CampaignData => {
    const cf = campaign.custom_fields || {}
    return {
      platform: cf.platform || 'meta',
      type: cf.type || 'lead-gen',
      icp: cf.icp || '',
      objective: cf.objective || '',
      cta: cf.cta || '',
      owner: cf.owner || '',
      steps: cf.steps || [],
      folderUrl: cf.folderUrl || '',
      docUrl: cf.docUrl || '',
    }
  }

  const saveCampaign = async (formData: typeof form, isEdit: boolean) => {
    if (!formData.name.trim() || !currentOrg) return
    setSaving(true)

    const steps: CampaignStep[] = isEdit && selectedData?.steps?.length
      ? selectedData.steps
      : DEFAULT_STEPS.map((s, i) => ({
          ...s, id: `step-${Date.now()}-${i}`, status: 'not-started',
          assignee: '', dueDate: '', checklist: [], mediaUrl: '', copyDocUrl: '',
          landingPageUrl: '', trackingPixel: '', linkedTaskIds: [],
        }))

    const payload = {
      org_id: currentOrg.id,
      name: formData.name.trim(),
      brand: formData.brand,
      description: formData.objective || null,
      status: formData.status,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      start_date: formData.startDate || null,
      end_date: formData.endDate || null,
      goals: { objective: formData.objective, cta: formData.cta, type: formData.type },
      ai_suggestions: isEdit ? (selected?.ai_suggestions || {}) : {},
      custom_fields: {
        platform: formData.platform,
        type: formData.type,
        icp: formData.icp,
        objective: formData.objective,
        cta: formData.cta,
        owner: formData.owner,
        steps,
        folderUrl: selectedData?.folderUrl || '',
        docUrl: selectedData?.docUrl || '',
      },
    }

    if (isEdit && selected) {
      const { data, error } = await supabase.from('campaigns').update(payload).eq('id', selected.id).select().single()
      if (data && !error) {
        setCampaigns(prev => prev.map(c => c.id === data.id ? data : c))
        setSelected(data)
        setSelectedData(getCampaignData(data))
      }
    } else {
      const { data, error } = await supabase.from('campaigns').insert(payload).select().single()
      if (data && !error) {
        setCampaigns(prev => [data, ...prev])
        // Auto-create task if owner assigned
        if (formData.owner && currentOrg) {
          await supabase.from('kanban_tasks').insert({
            org_id: currentOrg.id,
            column_id: (await supabase.from('kanban_columns').select('id').eq('org_id', currentOrg.id).order('position').limit(1).single()).data?.id,
            title: `Campaign: ${formData.name}`,
            assignee: formData.owner,
            priority: ['active', 'in-progress'].includes(formData.status) ? 'high' : 'medium',
            due_date: formData.startDate || null,
          })
        }
      }
    }
    setSaving(false)
    setShowCreateModal(false)
  }

  const deleteCampaign = async (id: string) => {
    if (!confirm('Delete this campaign and all its steps?')) return
    await supabase.from('campaigns').delete().eq('id', id)
    setCampaigns(prev => prev.filter(c => c.id !== id))
    setView('grid')
    setSelected(null)
  }

  const updateCampaignStatus = async (id: string, newStatus: string) => {
    const { data } = await supabase.from('campaigns').update({ status: newStatus }).eq('id', id).select().single()
    if (data) {
      setCampaigns(prev => prev.map(c => c.id === id ? data : c))
      if (selected?.id === id) setSelected(data)
    }
  }

  // ─── STEP CRUD ───

  const updateStep = async (updatedStep: CampaignStep) => {
    if (!selected || !selectedData) return
    const newSteps = selectedData.steps.map(s => s.id === updatedStep.id ? updatedStep : s)
    const newCF = { ...selected.custom_fields, steps: newSteps }
    const { data } = await supabase.from('campaigns').update({ custom_fields: newCF }).eq('id', selected.id).select().single()
    if (data) {
      setCampaigns(prev => prev.map(c => c.id === data.id ? data : c))
      setSelected(data)
      setSelectedData(getCampaignData(data))
    }
    setShowStepModal(null)
  }

  const addStep = async (phaseId: string) => {
    if (!selected || !selectedData) return
    const newStep: CampaignStep = {
      id: `step-${Date.now()}`, phase: phaseId, name: 'New Step', desc: '',
      status: 'not-started', assignee: '', dueDate: '', checklist: [],
      mediaUrl: '', copyDocUrl: '', landingPageUrl: '', trackingPixel: '', linkedTaskIds: [],
    }
    const newSteps = [...selectedData.steps, newStep]
    const newCF = { ...selected.custom_fields, steps: newSteps }
    const { data } = await supabase.from('campaigns').update({ custom_fields: newCF }).eq('id', selected.id).select().single()
    if (data) {
      setCampaigns(prev => prev.map(c => c.id === data.id ? data : c))
      setSelected(data)
      setSelectedData(getCampaignData(data))
    }
    setShowStepModal(newStep)
  }

  // ─── AI BUILDER ───

  const AI_QUESTIONS = [
    { field: 'goal', q: "What's the primary goal?", options: ['Lead Generation', 'Brand Awareness', 'Program Enrollment', 'Event Promotion', 'Sales', 'Retargeting'] },
    { field: 'icp', q: "Who's the target audience?", options: ['High-Performers / Executives', 'Burnt-Out Parents', 'Wellness Practitioners', 'Athletes / Peak Performance', 'Corporate Wellness', 'Veterans & First Responders', 'Custom...'] },
    { field: 'platform', q: "Which platform(s)?", options: ['Meta (Facebook/Instagram)', 'Google Ads', 'LinkedIn', 'TikTok', 'YouTube', 'Multi-Platform'] },
    { field: 'budget', q: "Budget range for the test phase?", options: ['$0 (organic)', '$100-500/mo', '$500-2,000/mo', '$2,000-5,000/mo', '$5,000+/mo'] },
    { field: 'offer', q: "What's the offer or lead magnet?", options: ['NSCI Quick-Score Quiz', 'Free Workshop/Webinar', 'Immersive Mastermind Enrollment', 'Free Consultation', 'Content Download', 'Custom...'] },
    { field: 'timeline', q: "Campaign timeline?", options: ['2 weeks (sprint)', '30 days', '60 days', '90 days (evergreen)'] },
    { field: 'creative', q: "What creative assets do you have?", options: ['Video ready', 'Images ready', 'Need everything created', 'Some assets, need more'] },
    { field: 'hook', q: "What's the core hook or angle?", },
  ]

  const startAI = () => {
    setShowAI(true)
    setAiStep(0)
    setAiData({})
    setAiMessages([
      { role: 'ai', content: "I'm your AI Campaign Builder. I'll ask you a series of questions, and once I have everything I need, I'll generate a complete campaign with all phase steps, targeting, and creative briefs.\n\nLet's start:" },
      { role: 'ai', content: AI_QUESTIONS[0].q, options: AI_QUESTIONS[0].options },
    ])
  }

  const handleAIResponse = (response: string) => {
    const current = AI_QUESTIONS[aiStep]
    const newData = { ...aiData, [current.field]: response }
    const newMessages: AIMessage[] = [...aiMessages, { role: 'user', content: response }]
    const next = aiStep + 1

    if (next < AI_QUESTIONS.length) {
      const nextQ = AI_QUESTIONS[next]
      const acks = ['Got it.', 'Perfect.', 'Nice.', 'Good.', 'That helps.', 'Great choice.']
      newMessages.push({ role: 'ai', content: `${acks[Math.floor(Math.random() * acks.length)]} ${nextQ.q}`, options: nextQ.options })
      setAiStep(next)
    } else {
      newMessages.push({ role: 'ai', content: 'I have everything I need. Generating your campaign...' })
      setAiGenerating(true)
      setTimeout(() => generateAICampaign(newData, newMessages), 1500)
    }
    setAiData(newData)
    setAiMessages(newMessages)
    setAiInput('')
  }

  const generateAICampaign = async (data: Record<string, string>, messages: AIMessage[]) => {
    const platformMap: Record<string, string> = { 'Meta (Facebook/Instagram)': 'meta', 'Google Ads': 'google', 'LinkedIn': 'linkedin', 'TikTok': 'tiktok', 'YouTube': 'youtube', 'Multi-Platform': 'multi' }
    const typeMap: Record<string, string> = { 'Lead Generation': 'lead-gen', 'Brand Awareness': 'awareness', 'Program Enrollment': 'sales', 'Event Promotion': 'event', 'Sales': 'sales', 'Retargeting': 'retargeting' }

    const name = `${data.goal || 'Campaign'} - ${data.icp?.split('/')[0]?.trim() || 'General'}`
    const platform = platformMap[data.platform || ''] || 'meta'
    const type = typeMap[data.goal || ''] || 'lead-gen'
    const budgetMatch = data.budget?.match(/\d[\d,]*/)
    const budget = budgetMatch ? parseInt(budgetMatch[0].replace(',', '')) : 0

    const today = new Date()
    const durationDays = data.timeline?.includes('2 week') ? 14 : data.timeline?.includes('60') ? 60 : data.timeline?.includes('90') ? 90 : 30
    const endDate = new Date(today.getTime() + durationDays * 24 * 60 * 60 * 1000)

    // Generate customized steps based on AI data
    const customSteps: CampaignStep[] = DEFAULT_STEPS.map((s, i) => ({
      ...s, id: `step-ai-${Date.now()}-${i}`, status: 'not-started',
      assignee: '', dueDate: '', checklist: [], mediaUrl: '', copyDocUrl: '',
      landingPageUrl: '', trackingPixel: '', linkedTaskIds: [],
    }))

    // Save to database
    if (currentOrg) {
      setSaving(true)
      const { data: saved, error } = await supabase.from('campaigns').insert({
        org_id: currentOrg.id, name, brand: 'np', description: data.hook || null,
        status: 'planning', budget, start_date: today.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        goals: { objective: data.goal, cta: data.offer, type },
        ai_suggestions: data,
        custom_fields: { platform, type, icp: data.icp, objective: data.goal, cta: data.offer, owner: '', steps: customSteps, folderUrl: '', docUrl: '' },
      }).select().single()
      setSaving(false)

      if (saved && !error) {
        setCampaigns(prev => [saved, ...prev])
        setAiMessages([...messages, {
          role: 'ai',
          content: `Campaign "${name}" created with ${customSteps.length} steps across all phases!\n\nPlatform: ${data.platform}\nTarget: ${data.icp}\nBudget: ${data.budget}\nOffer: ${data.offer}\nTimeline: ${durationDays} days\n\nClick "View Campaign" to open the phase pipeline and start working through each step.`,
          options: ['View Campaign', 'Create Another'],
        }])
        setAiGenerating(false)
        setAiData({ ...data, _campaignId: saved.id })
      }
    }
  }

  const handleAIAction = (action: string) => {
    if (action === 'View Campaign') {
      const camp = campaigns.find(c => c.id === aiData._campaignId)
      if (camp) {
        setSelected(camp)
        setSelectedData(getCampaignData(camp))
        setView('expanded')
      }
      setShowAI(false)
    } else if (action === 'Create Another') {
      startAI()
    }
  }

  // ─── RENDER HELPERS ───

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading campaigns...</div></div>
  }

  const filtered = campaigns.filter(c => {
    const cf = c.custom_fields || {}
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterPlatform !== 'all' && cf.platform !== filterPlatform) return false
    return true
  })

  const getProgress = (campaign: Campaign) => {
    const steps = campaign.custom_fields?.steps || []
    const total = steps.length
    const done = steps.filter((s: any) => s.status === 'approved' || s.status === 'live').length
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }

  return (
    <div>
      {/* ═══ GRID VIEW ═══ */}
      {view === 'grid' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold text-np-dark">Campaigns</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {currentOrg?.name} · {campaigns.length} campaigns · {campaigns.filter(c => c.status === 'active').length} active
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={startAI}
                className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
                <Wand2 className="w-3.5 h-3.5" /> AI Builder
              </button>
              <button onClick={() => { setForm({ name: '', status: 'planning', type: 'lead-gen', platform: 'meta', icp: '', startDate: '', endDate: '', objective: '', cta: '', budget: '', owner: '', brand: 'np' }); setShowCreateModal(true) }}
                className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
                <Plus className="w-3.5 h-3.5" /> New Campaign
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-4">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="text-[10px] px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none">
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}
              className="text-[10px] px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none">
              <option value="all">All Platforms</option>
              {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
            </select>
          </div>

          {/* Empty State */}
          {filtered.length === 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
              <Target className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Campaign Command Center</h2>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                Plan, build, launch, optimize, and report on campaigns across all channels. Each campaign has an 11-phase pipeline with step-level task management.
              </p>
              <div className="flex justify-center gap-3">
                <button onClick={() => { setForm({ name: '', status: 'planning', type: 'lead-gen', platform: 'meta', icp: '', startDate: '', endDate: '', objective: '', cta: '', budget: '', owner: '', brand: 'np' }); setShowCreateModal(true) }}
                  className="btn-secondary text-sm py-2.5 px-5">+ New Campaign</button>
                <button onClick={startAI}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium hover:opacity-90">
                  <Wand2 className="w-4 h-4" /> AI Builder
                </button>
              </div>
            </div>
          )}

          {/* Campaign Cards Grid */}
          {filtered.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(campaign => {
                const statusConf = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.planning
                const cf = campaign.custom_fields || {}
                const plat = PLATFORMS.find(p => p.id === cf.platform)
                const prog = getProgress(campaign)
                return (
                  <div key={campaign.id}
                    onClick={() => { setSelected(campaign); setSelectedData(getCampaignData(campaign)); setView('expanded') }}
                    className="bg-white border-l-4 border border-gray-100 rounded-xl p-4 cursor-pointer hover:shadow-md transition-all"
                    style={{ borderLeftColor: statusConf.color }}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[9px] text-gray-400 uppercase">{plat?.icon} {cf.platform?.toUpperCase()}</span>
                          {cf.icp && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">🎯 {cf.icp}</span>}
                        </div>
                        <h3 className="text-sm font-bold text-np-dark">{campaign.name}</h3>
                      </div>
                      <span className="text-[8px] font-bold px-2 py-0.5 rounded whitespace-nowrap"
                        style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>
                        {statusConf.icon} {statusConf.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 line-clamp-2 mb-3">{cf.objective || 'No objective defined'}</p>
                    {/* Progress bar */}
                    <div className="mb-2">
                      <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                        <span>Progress</span>
                        <span>{prog.done}/{prog.total} ({prog.pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${prog.pct}%`, backgroundColor: statusConf.color }} />
                      </div>
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-400">
                      <span>{campaign.start_date ? `📅 ${new Date(campaign.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}{cf.owner ? ` · 👤 ${cf.owner}` : ''}</span>
                      <span className="text-np-blue">{cf.cta || ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ EXPANDED VIEW ═══ */}
      {view === 'expanded' && selected && selectedData && (
        <div>
          {/* Expanded Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => { setView('grid'); setSelected(null) }}
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-np-dark">{selected.name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: (STATUS_CONFIG[selected.status] || STATUS_CONFIG.planning).bg, color: (STATUS_CONFIG[selected.status] || STATUS_CONFIG.planning).color }}>
                    {(STATUS_CONFIG[selected.status] || STATUS_CONFIG.planning).icon} {(STATUS_CONFIG[selected.status] || STATUS_CONFIG.planning).label}
                  </span>
                  {selected.budget && <span className="text-[9px] text-gray-400">💰 ${selected.budget?.toLocaleString()}</span>}
                  {selectedData.owner && <span className="text-[9px] text-gray-400">👤 {selectedData.owner}</span>}
                  {selectedData.icp && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">🎯 {selectedData.icp}</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {/* Status switcher */}
              <select value={selected.status} onChange={e => updateCampaignStatus(selected.id, e.target.value)}
                className="text-[10px] px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none">
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <button onClick={() => {
                const cf = selected.custom_fields || {}
                setForm({ name: selected.name, status: selected.status, type: cf.type || 'lead-gen', platform: cf.platform || 'meta', icp: cf.icp || '', startDate: selected.start_date || '', endDate: selected.end_date || '', objective: cf.objective || '', cta: cf.cta || '', budget: selected.budget?.toString() || '', owner: cf.owner || '', brand: selected.brand || 'np' })
                setShowCreateModal(true)
              }}
                className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[10px] text-gray-500 hover:bg-gray-50">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => deleteCampaign(selected.id)}
                className="px-2.5 py-1.5 bg-white border border-red-100 rounded-lg text-[10px] text-red-400 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Objective */}
          {selectedData.objective && (
            <div className="bg-white border border-gray-100 rounded-xl p-3 mb-4">
              <span className="text-[9px] font-bold text-gray-400 uppercase">Objective: </span>
              <span className="text-xs text-gray-600">{selectedData.objective}</span>
            </div>
          )}

          {/* Phase Pipeline */}
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3" style={{ minWidth: 'fit-content' }}>
              {PHASES.map(phase => {
                const phaseSteps = selectedData.steps.filter(s => s.phase === phase.id)
                const done = phaseSteps.filter(s => s.status === 'approved' || s.status === 'live').length
                return (
                  <div key={phase.id} className="w-56 flex-shrink-0 bg-white rounded-xl border border-gray-100 overflow-hidden">
                    {/* Phase header */}
                    <div className="px-3 py-2 border-b-2" style={{ backgroundColor: phase.color + '10', borderBottomColor: phase.color }}>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold" style={{ color: phase.color }}>{phase.emoji} {phase.name}</span>
                        {phaseSteps.length > 0 && <span className="text-[9px] text-gray-400">{done}/{phaseSteps.length}</span>}
                      </div>
                    </div>
                    {/* Step cards */}
                    <div className="p-1.5 space-y-1.5 min-h-[50px]">
                      {phaseSteps.map(step => {
                        const ss = STEP_STATUS[step.status] || STEP_STATUS['not-started']
                        return (
                          <div key={step.id} onClick={() => setShowStepModal(step)}
                            className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 cursor-pointer hover:border-gray-300 transition-all">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{ss.icon}</span>
                              <span className="text-[11px] font-medium text-np-dark truncate">{step.name}</span>
                            </div>
                            {step.assignee && <div className="text-[9px] text-gray-400 mt-0.5 ml-5">👤 {step.assignee}</div>}
                            {step.dueDate && <div className="text-[9px] text-gray-400 ml-5">📅 {new Date(step.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
                            {step.checklist?.length > 0 && (
                              <div className="text-[8px] text-gray-400 ml-5 mt-0.5">
                                ☑ {step.checklist.filter(c => c.done).length}/{step.checklist.length}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <button onClick={() => addStep(phase.id)}
                        className="w-full text-[10px] text-gray-400 border border-dashed border-gray-200 rounded-lg py-1.5 hover:text-np-blue hover:border-np-blue transition-all">
                        + Add Step
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CAMPAIGN CREATE/EDIT MODAL ═══ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowCreateModal(false)} />
          <div className="relative w-full max-w-lg max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-y-auto p-6">
            <div className="flex justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">{selected && view === 'expanded' ? 'Edit Campaign' : 'New Campaign'}</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Campaign name"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Platform</label>
                  <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                    {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Target ICP</label>
                  <input value={form.icp} onChange={e => setForm({ ...form, icp: e.target.value })} placeholder="e.g. Burnt-Out Parents"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Start Date</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">End Date</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Objective</label>
                <textarea value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })} rows={2}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">CTA</label>
                  <input value={form.cta} onChange={e => setForm({ ...form, cta: e.target.value })} placeholder="Take the Quiz"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Budget</label>
                  <input value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} placeholder="500"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Owner</label>
                  <input value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} placeholder="Cameron"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreateModal(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
              <button onClick={() => saveCampaign(form, !!(selected && view === 'expanded'))} disabled={saving || !form.name.trim()}
                className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP MODAL ═══ */}
      {showStepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowStepModal(null)} />
          <div className="relative w-full max-w-lg max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-y-auto p-6">
            <div className="flex justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">Edit Step</h3>
              <button onClick={() => setShowStepModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <StepEditor step={showStepModal} onSave={updateStep} tasks={tasks} />
          </div>
        </div>
      )}

      {/* ═══ AI BUILDER MODAL ═══ */}
      {showAI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowAI(false)} />
          <div className="relative w-full max-w-2xl h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-np-blue">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-white" />
                <span className="text-sm font-bold text-white">AI Campaign Builder</span>
              </div>
              <button onClick={() => setShowAI(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4 text-white" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-np-blue text-white rounded-2xl rounded-br-sm' : 'bg-gray-50 text-np-dark rounded-2xl rounded-bl-sm'} px-4 py-3`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {msg.options && msg.role === 'ai' && i === aiMessages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.options.map(opt => (
                          <button key={opt} onClick={() => opt === 'View Campaign' || opt === 'Create Another' ? handleAIAction(opt) : handleAIResponse(opt)}
                            className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 bg-white text-np-dark hover:bg-np-blue hover:text-white hover:border-np-blue transition-all font-medium">
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {aiGenerating && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-gray-500">Building your campaign...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) { handleAIResponse(aiInput.trim()); setAiInput('') } }}
                  placeholder="Type your answer..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={() => { if (aiInput.trim()) { handleAIResponse(aiInput.trim()); setAiInput('') } }}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-xl hover:opacity-90">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── STEP EDITOR COMPONENT ───

function StepEditor({ step, onSave, tasks }: { step: CampaignStep; onSave: (s: CampaignStep) => void; tasks: any[] }) {
  const [f, setF] = useState<CampaignStep>({ ...step })
  const [newCheckItem, setNewCheckItem] = useState('')

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return
    setF(prev => ({ ...prev, checklist: [...(prev.checklist || []), { text: newCheckItem.trim(), done: false }] }))
    setNewCheckItem('')
  }

  const toggleCheck = (index: number) => {
    setF(prev => ({
      ...prev,
      checklist: prev.checklist.map((c, i) => i === index ? { ...c, done: !c.done } : c),
    }))
  }

  const removeCheck = (index: number) => {
    setF(prev => ({ ...prev, checklist: prev.checklist.filter((_, i) => i !== index) }))
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Step Name</label>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Phase</label>
          <select value={f.phase} onChange={e => setF({ ...f, phase: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
            {PHASES.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Status</label>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
            {Object.entries(STEP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Description</label>
        <textarea value={f.desc} onChange={e => setF({ ...f, desc: e.target.value })} rows={2}
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Assigned To</label>
          <input value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })} placeholder="Team member"
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Due Date</label>
          <input type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
        </div>
      </div>

      {/* Resource Links */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-2">
        <label className="text-[10px] font-bold text-gray-400 uppercase block">Resource Links</label>
        {[
          { key: 'mediaUrl' as const, label: '🖼️ Media Asset URL', ph: 'Google Drive link...' },
          { key: 'copyDocUrl' as const, label: '📄 Copy/Script Doc', ph: 'Google Doc link...' },
          { key: 'landingPageUrl' as const, label: '🔗 Landing Page', ph: 'URL...' },
          { key: 'trackingPixel' as const, label: '📊 Tracking/Pixel', ph: 'Pixel ID or UTM...' },
        ].map(({ key, label, ph }) => (
          <div key={key} className="flex gap-1.5">
            <input value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} placeholder={`${label} - ${ph}`}
              className="flex-1 text-[10px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none" />
            {f[key] && (
              <a href={f[key]} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100">
                <ExternalLink className="w-3 h-3 text-gray-400" />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Checklist */}
      <div className="bg-gray-50 rounded-xl p-3">
        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-2">Checklist</label>
        {f.checklist?.map((item, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <button onClick={() => toggleCheck(i)} className="flex-shrink-0">
              {item.done ? <CheckSquare className="w-3.5 h-3.5 text-green-500" /> : <Square className="w-3.5 h-3.5 text-gray-300" />}
            </button>
            <span className={`text-xs flex-1 ${item.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{item.text}</span>
            <button onClick={() => removeCheck(i)} className="text-gray-300 hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex gap-1.5 mt-2">
          <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCheckItem() }}
            placeholder="Add checklist item..."
            className="flex-1 text-[10px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none" />
          <button onClick={addCheckItem} className="text-[10px] px-2.5 py-1.5 bg-np-blue text-white rounded-lg font-medium">Add</button>
        </div>
      </div>

      {/* Linked Tasks */}
      <div className="bg-gray-50 rounded-xl p-3">
        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-2">Linked Tasks</label>
        {f.linkedTaskIds?.map(taskId => {
          const task = tasks.find(t => t.id === taskId)
          return task ? (
            <div key={taskId} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 mb-1 border border-gray-100">
              <span className="text-[10px] text-np-dark">{task.title}</span>
              <button onClick={() => setF({ ...f, linkedTaskIds: f.linkedTaskIds.filter(id => id !== taskId) })}
                className="text-gray-300 hover:text-red-400"><X className="w-3 h-3" /></button>
            </div>
          ) : null
        })}
        <select onChange={e => {
          if (e.target.value && !f.linkedTaskIds?.includes(e.target.value)) {
            setF({ ...f, linkedTaskIds: [...(f.linkedTaskIds || []), e.target.value] })
          }
          e.target.value = ''
        }} className="w-full text-[10px] border border-gray-200 rounded-lg px-2.5 py-1.5 mt-1 focus:outline-none text-gray-400">
          <option value="">Link a task...</option>
          {tasks.filter(t => !f.linkedTaskIds?.includes(t.id)).map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => onSave(f)} className="btn-primary text-xs py-2 px-4">Save Step</button>
      </div>
    </div>
  )
}
