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
  raci: { responsible: string; accountable: string; consulted: string[]; informed: string[] }
  uploads: Array<{ id: string; name: string; type: string; url: string; library: 'media' | 'company' }>
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

  // Linked tasks and team
  const [tasks, setTasks] = useState<any[]>([])
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; display_name: string }>>([])
  const [columns, setColumns] = useState<any[]>([])

  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [campRes, taskRes, teamRes, colRes] = await Promise.all([
      supabase.from('campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('kanban_tasks').select('id, title, status, assignee, priority').eq('org_id', currentOrg.id),
      supabase.from('team_profiles').select('id, display_name').eq('org_id', currentOrg.id),
      supabase.from('kanban_columns').select('id, title, position').eq('org_id', currentOrg.id).order('position'),
    ])
    if (campRes.data) setCampaigns(campRes.data)
    if (taskRes.data) setTasks(taskRes.data)
    if (teamRes.data) setTeamMembers(teamRes.data)
    if (colRes.data) setColumns(colRes.data)
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
          landingPageUrl: '', trackingPixel: '', linkedTaskIds: [], raci: { responsible: '', accountable: '', consulted: [], informed: [] }, uploads: [],
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
      mediaUrl: '', copyDocUrl: '', landingPageUrl: '', trackingPixel: '', linkedTaskIds: [], raci: { responsible: '', accountable: '', consulted: [], informed: [] }, uploads: [],
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

  // ─── AI BUILDER (Claude API) ───

  const startAI = () => {
    setShowAI(true)
    setAiStep(0)
    setAiData({})
    setAiGenerating(false)
    setAiMessages([
      { role: 'ai', content: "I'm your AI CMO. I'll help you build a complete campaign from scratch, whether it's digital ads, organic social, print, conference marketing, podcast outreach, or email sequences.\n\nTell me what you're working on. What's the campaign idea, goal, or challenge you're trying to solve?" },
    ])
  }

  const fetchBrandSettings = async () => {
    if (!currentOrg) return null
    const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', 'np').single()
    if (data) {
      return {
        vocabulary_use: data.vocabulary_use || [],
        vocabulary_avoid: data.vocabulary_avoid || [],
        voice_description: data.voice_description || '',
        ...(data.guidelines || {}),
      }
    }
    return null
  }

  const sendToAI = async (userMessage: string) => {
    const newMessages: AIMessage[] = [...aiMessages, { role: 'user', content: userMessage }]
    setAiMessages(newMessages)
    setAiInput('')
    setAiGenerating(true)

    try {
      const brandSettings = await fetchBrandSettings()

      const campaignContext = selected ? {
        name: selected.name,
        status: selected.status,
        steps: selectedData?.steps?.map(s => ({ phase: s.phase, name: s.name, status: s.status })),
        platform: selectedData?.platform,
        objective: selectedData?.objective,
      } : null

      const apiMessages = newMessages
        .filter(m => m.content.trim())
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, brandSettings, campaignContext }),
      })

      const data = await res.json()
      
      if (data.error) {
        setAiMessages([...newMessages, { role: 'ai', content: `Error: ${data.error}\n\nMake sure ANTHROPIC_API_KEY is set in your Vercel environment variables.` }])
      } else {
        const aiResponse = data.content
        
        // Check if response contains a campaign JSON
        const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)```/)
        if (jsonMatch) {
          try {
            const campaignPlan = JSON.parse(jsonMatch[1])
            setAiData(prev => ({ ...prev, _plan: JSON.stringify(campaignPlan) }))
            setAiMessages([...newMessages, {
              role: 'ai',
              content: aiResponse.replace(/```json[\s\S]*?```/, '[Campaign plan generated - see options below]'),
              options: ['Create This Campaign', 'Modify Steps', 'Change Target Audience', 'Adjust Budget', 'Add More Steps', 'Start Over'],
            }])
          } catch {
            setAiMessages([...newMessages, { role: 'ai', content: aiResponse }])
          }
        } else {
          setAiMessages([...newMessages, { role: 'ai', content: aiResponse }])
        }
      }
    } catch (err: any) {
      setAiMessages([...newMessages, { role: 'ai', content: `Connection error: ${err.message}. Check that your API key is configured.` }])
    }
    setAiGenerating(false)
  }

  const createCampaignFromAI = async () => {
    if (!currentOrg || !aiData._plan) return
    setSaving(true)
    try {
      const plan = JSON.parse(aiData._plan)
      const steps: CampaignStep[] = (plan.steps || []).map((s: any, i: number) => ({
        id: `step-ai-${Date.now()}-${i}`,
        phase: s.phase || 'ideation',
        name: s.name || `Step ${i + 1}`,
        desc: s.desc || s.description || '',
        status: 'not-started',
        assignee: '', dueDate: '', checklist: [],
        mediaUrl: '', copyDocUrl: '', landingPageUrl: '', trackingPixel: '', linkedTaskIds: [], raci: { responsible: '', accountable: '', consulted: [], informed: [] }, uploads: [],
      }))

      const budgetMatch = plan.budget?.match(/[\d,]+/)
      const budget = budgetMatch ? parseFloat(budgetMatch[0].replace(',', '')) : null

      const { data, error } = await supabase.from('campaigns').insert({
        org_id: currentOrg.id, name: plan.name || 'AI Campaign', brand: 'np',
        description: plan.objective || null, status: 'planning', budget,
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        goals: { objective: plan.objective, cta: plan.cta, type: plan.type, dataPoints: plan.dataPoints, risks: plan.risks, successCriteria: plan.successCriteria },
        ai_suggestions: { ...aiData, plan },
        custom_fields: { platform: plan.platform || 'multi', type: plan.type || 'lead-gen', icp: plan.icp || '', objective: plan.objective || '', cta: plan.cta || '', owner: '', steps, folderUrl: '', docUrl: '' },
      }).select().single()

      if (data && !error) {
        setCampaigns(prev => [data, ...prev])
        setAiMessages(prev => [...prev, {
          role: 'ai',
          content: `Campaign "${plan.name}" created with ${steps.length} steps!\n\nKey data points to track:\n${(plan.dataPoints || []).map((d: string) => `• ${d}`).join('\n')}\n\nClick "View Campaign" to open the phase pipeline.`,
          options: ['View Campaign', 'Create Another'],
        }])
        setAiData(prev => ({ ...prev, _campaignId: data.id }))
      }
    } catch (err: any) {
      setAiMessages(prev => [...prev, { role: 'ai', content: `Error creating campaign: ${err.message}` }])
    }
    setSaving(false)
  }

  const handleAIAction = (action: string) => {
    if (action === 'View Campaign') {
      const camp = campaigns.find(c => c.id === aiData._campaignId)
      if (camp) { setSelected(camp); setSelectedData(getCampaignData(camp)); setView('expanded') }
      setShowAI(false)
    } else if (action === 'Create Another') {
      startAI()
    } else if (action === 'Create This Campaign') {
      createCampaignFromAI()
    } else {
      // For modification options, send as a follow-up message to Claude
      sendToAI(action)
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
              <button onClick={() => { startAI(); /* AI will have campaign context */ }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-[10px] font-medium hover:opacity-90">
                <Wand2 className="w-3.5 h-3.5" /> AI Advisor
              </button>
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
                            {step.raci?.responsible && !step.assignee && <div className="text-[9px] text-blue-400 mt-0.5 ml-5">🔵 {step.raci.responsible}</div>}
                            {step.dueDate && <div className="text-[9px] text-gray-400 ml-5">📅 {new Date(step.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
                            {step.checklist?.length > 0 && (
                              <div className="text-[8px] text-gray-400 ml-5 mt-0.5">
                                ☑ {step.checklist.filter(c => c.done).length}/{step.checklist.length}
                              </div>
                            )}
                            {step.uploads?.length > 0 && (
                              <div className="text-[8px] text-purple-400 ml-5">📎 {step.uploads.length} file{step.uploads.length > 1 ? 's' : ''}</div>
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
            <StepEditor step={showStepModal} onSave={updateStep} tasks={tasks} teamMembers={teamMembers} columns={columns} currentOrg={currentOrg} supabase={supabase} onTaskCreated={fetchData} />
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
                          <button key={opt} onClick={() => ['View Campaign', 'Create Another', 'Create This Campaign', 'Modify Steps', 'Change Target Audience', 'Adjust Budget', 'Add More Steps', 'Start Over'].includes(opt) ? handleAIAction(opt) : sendToAI(opt)}
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
                  onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) { sendToAI(aiInput.trim()); setAiInput('') } }}
                  placeholder="Describe your campaign, ask for advice, or request changes..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={() => { if (aiInput.trim()) { sendToAI(aiInput.trim()); setAiInput('') } }}
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

function StepEditor({ step, onSave, tasks, teamMembers, columns, currentOrg, supabase, onTaskCreated }: {
  step: CampaignStep; onSave: (s: CampaignStep) => void; tasks: any[];
  teamMembers: Array<{ id: string; display_name: string }>; columns: any[];
  currentOrg: any; supabase: any; onTaskCreated: () => void
}) {
  const [f, setF] = useState<CampaignStep>({
    ...step,
    raci: step.raci || { responsible: '', accountable: '', consulted: [], informed: [] },
    uploads: step.uploads || [],
  })
  const [newCheckItem, setNewCheckItem] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'raci' | 'files' | 'tasks'>('details')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return
    setF(prev => ({ ...prev, checklist: [...(prev.checklist || []), { text: newCheckItem.trim(), done: false }] }))
    setNewCheckItem('')
  }

  const toggleCheck = (index: number) => {
    setF(prev => ({ ...prev, checklist: prev.checklist.map((c, i) => i === index ? { ...c, done: !c.done } : c) }))
  }

  const removeCheck = (index: number) => {
    setF(prev => ({ ...prev, checklist: prev.checklist.filter((_, i) => i !== index) }))
  }

  const createTaskFromStep = async () => {
    if (!currentOrg || !columns.length) return
    setCreatingTask(true)
    const firstCol = columns[0]
    const { data, error } = await supabase.from('kanban_tasks').insert({
      org_id: currentOrg.id,
      column_id: firstCol.id,
      title: f.name,
      description: f.desc,
      assignee: f.raci?.responsible || f.assignee || '',
      priority: 'medium',
      due_date: f.dueDate || null,
    }).select().single()
    if (data && !error) {
      setF(prev => ({ ...prev, linkedTaskIds: [...(prev.linkedTaskIds || []), data.id] }))
      onTaskCreated()
    }
    setCreatingTask(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !currentOrg) return
    setUploading(true)

    for (const file of Array.from(files)) {
      const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')
      const library = isMedia ? 'media' as const : 'company' as const
      const folder = isMedia ? 'campaign-media' : 'campaign-docs'
      const filePath = `${currentOrg.id}/${folder}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage.from('assets').upload(filePath, file)

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('assets').getPublicUrl(filePath)
        const url = urlData?.publicUrl || ''

        // Also create entry in media_assets or a record
        if (isMedia) {
          await supabase.from('media_assets').insert({
            org_id: currentOrg.id,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
            storage_path: filePath,
            url,
            tags: ['campaign'],
            brand: 'np',
          })
        }

        setF(prev => ({
          ...prev,
          uploads: [...(prev.uploads || []), {
            id: `upload-${Date.now()}`,
            name: file.name,
            type: file.type,
            url,
            library,
          }],
        }))
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeUpload = (uploadId: string) => {
    setF(prev => ({ ...prev, uploads: prev.uploads.filter(u => u.id !== uploadId) }))
  }

  const memberNames = teamMembers.map(m => m.display_name)

  const toggleRaciList = (role: 'consulted' | 'informed', name: string) => {
    setF(prev => {
      const list = prev.raci[role] || []
      const updated = list.includes(name) ? list.filter(n => n !== name) : [...list, name]
      return { ...prev, raci: { ...prev.raci, [role]: updated } }
    })
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-2">
        {[
          { id: 'details' as const, label: 'Details', icon: '📋' },
          { id: 'raci' as const, label: 'RACI', icon: '👥' },
          { id: 'files' as const, label: 'Files', icon: '📁' },
          { id: 'tasks' as const, label: 'Tasks', icon: '✅' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg ${activeTab === tab.id ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── DETAILS TAB ─── */}
      {activeTab === 'details' && (
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
              <select value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                <option value="">Unassigned</option>
                {memberNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
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
                <button onClick={() => removeCheck(i)} className="text-gray-300 hover:text-red-400"><X className="w-3 h-3" /></button>
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
        </div>
      )}

      {/* ─── RACI TAB ─── */}
      {activeTab === 'raci' && (
        <div className="space-y-4">
          <p className="text-[10px] text-gray-500">Assign team members to RACI roles for this step.</p>

          {/* Responsible */}
          <div className="bg-blue-50 rounded-xl p-3">
            <label className="text-[10px] font-bold text-blue-600 uppercase block mb-1">🔵 Responsible (Does the work)</label>
            <select value={f.raci.responsible} onChange={e => setF({ ...f, raci: { ...f.raci, responsible: e.target.value } })}
              className="w-full text-xs border border-blue-200 rounded-lg px-3 py-2 focus:outline-none bg-white">
              <option value="">Select person...</option>
              {memberNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Accountable */}
          <div className="bg-red-50 rounded-xl p-3">
            <label className="text-[10px] font-bold text-red-600 uppercase block mb-1">🔴 Accountable (Final approver)</label>
            <select value={f.raci.accountable} onChange={e => setF({ ...f, raci: { ...f.raci, accountable: e.target.value } })}
              className="w-full text-xs border border-red-200 rounded-lg px-3 py-2 focus:outline-none bg-white">
              <option value="">Select person...</option>
              {memberNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Consulted */}
          <div className="bg-yellow-50 rounded-xl p-3">
            <label className="text-[10px] font-bold text-yellow-700 uppercase block mb-1.5">🟡 Consulted (Provides input)</label>
            <div className="flex flex-wrap gap-1.5">
              {memberNames.map(n => (
                <button key={n} onClick={() => toggleRaciList('consulted', n)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg border font-medium transition-all ${(f.raci.consulted || []).includes(n) ? 'bg-yellow-100 border-yellow-400 text-yellow-700' : 'bg-white border-gray-200 text-gray-500'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Informed */}
          <div className="bg-green-50 rounded-xl p-3">
            <label className="text-[10px] font-bold text-green-600 uppercase block mb-1.5">🟢 Informed (Kept in the loop)</label>
            <div className="flex flex-wrap gap-1.5">
              {memberNames.map(n => (
                <button key={n} onClick={() => toggleRaciList('informed', n)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg border font-medium transition-all ${(f.raci.informed || []).includes(n) ? 'bg-green-100 border-green-400 text-green-700' : 'bg-white border-gray-200 text-gray-500'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {memberNames.length === 0 && (
            <p className="text-[10px] text-gray-400 text-center py-4">No team members found. Add team members in the Team page first.</p>
          )}
        </div>
      )}

      {/* ─── FILES TAB ─── */}
      {activeTab === 'files' && (
        <div className="space-y-3">
          <p className="text-[10px] text-gray-500">Upload files to this step. Images, video, and audio go to the Media Library. Documents go to the Company Library.</p>

          <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-center hover:border-np-blue hover:bg-np-blue/5 transition-all disabled:opacity-50">
            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-np-blue" />
                <span className="text-xs text-gray-500">Uploading...</span>
              </div>
            ) : (
              <div>
                <div className="text-2xl mb-1">📎</div>
                <span className="text-xs text-gray-500">Click to upload files</span>
                <div className="text-[9px] text-gray-400 mt-0.5">Images/Video/Audio → Media Library | Docs/Text → Company Library</div>
              </div>
            )}
          </button>

          {/* Uploaded files list */}
          {(f.uploads || []).length > 0 && (
            <div className="space-y-1.5">
              {f.uploads.map(upload => {
                const isMedia = upload.library === 'media'
                return (
                  <div key={upload.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-sm">{isMedia ? (upload.type.startsWith('image') ? '🖼️' : upload.type.startsWith('video') ? '🎬' : '🎵') : '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium text-np-dark truncate block">{upload.name}</span>
                      <span className="text-[9px] text-gray-400">{isMedia ? 'Media Library' : 'Company Library'}</span>
                    </div>
                    {upload.url && (
                      <a href={upload.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-gray-200">
                        <ExternalLink className="w-3 h-3 text-gray-400" />
                      </a>
                    )}
                    <button onClick={() => removeUpload(upload.id)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TASKS TAB ─── */}
      {activeTab === 'tasks' && (
        <div className="space-y-3">
          <p className="text-[10px] text-gray-500">Create kanban tasks from this step or link existing tasks.</p>

          {/* Create task button */}
          <button onClick={createTaskFromStep} disabled={creatingTask}
            className="w-full flex items-center justify-center gap-2 py-3 bg-np-blue/10 border border-np-blue/20 rounded-xl text-np-blue hover:bg-np-blue/20 transition-all disabled:opacity-50">
            {creatingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span className="text-xs font-bold">{creatingTask ? 'Creating...' : 'Create Kanban Task from This Step'}</span>
          </button>
          <p className="text-[9px] text-gray-400 text-center">Creates a task in Task Manager with this step's name, description, and RACI responsible person as assignee.</p>

          {/* Linked tasks */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase block">Linked Tasks</label>
            {f.linkedTaskIds?.map(taskId => {
              const task = tasks.find(t => t.id === taskId)
              return task ? (
                <div key={taskId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-3 h-3 text-np-blue" />
                    <span className="text-[11px] text-np-dark font-medium">{task.title}</span>
                    {task.assignee && <span className="text-[9px] text-gray-400">👤 {task.assignee}</span>}
                    {task.priority && <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${task.priority === 'high' ? 'bg-red-50 text-red-500' : task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-50 text-gray-400'}`}>{task.priority}</span>}
                  </div>
                  <button onClick={() => setF({ ...f, linkedTaskIds: f.linkedTaskIds.filter(id => id !== taskId) })}
                    className="text-gray-300 hover:text-red-400"><X className="w-3 h-3" /></button>
                </div>
              ) : null
            })}
          </div>

          {/* Link existing task */}
          <select onChange={e => {
            if (e.target.value && !f.linkedTaskIds?.includes(e.target.value)) {
              setF({ ...f, linkedTaskIds: [...(f.linkedTaskIds || []), e.target.value] })
            }
            e.target.value = ''
          }} className="w-full text-[10px] border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none text-gray-400">
            <option value="">Link an existing task...</option>
            {tasks.filter(t => !f.linkedTaskIds?.includes(t.id)).map(t => (
              <option key={t.id} value={t.id}>{t.title} {t.assignee ? `(${t.assignee})` : ''}</option>
            ))}
          </select>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <button onClick={() => onSave(f)} className="btn-primary text-xs py-2 px-4">Save Step</button>
      </div>
    </div>
  )
}
