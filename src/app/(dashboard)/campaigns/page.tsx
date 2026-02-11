'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { Plus, Wand2, Target, TrendingUp, Calendar, DollarSign, Zap, X, Send, Bot, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'

interface Campaign {
  id: string
  org_id: string
  brand: string
  name: string
  description: string | null
  status: string
  budget: number | null
  start_date: string | null
  end_date: string | null
  goals: Record<string, any>
  custom_fields: Record<string, any>
  created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  active: { label: 'Active', color: '#10B981', bg: '#D1FAE5' },
  paused: { label: 'Paused', color: '#F59E0B', bg: '#FEF3C7' },
  completed: { label: 'Completed', color: '#3B82F6', bg: '#DBEAFE' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
}

// AI Campaign Builder conversation steps
interface AIMessage {
  role: 'ai' | 'user'
  content: string
  options?: string[]
  field?: string
}

const AI_FLOW: Array<{ field: string; question: string; options?: string[]; followUp?: string }> = [
  {
    field: 'brand',
    question: "Which brand is this campaign for?",
    options: ['Neuro Progeny', 'Sensorium'],
  },
  {
    field: 'objective',
    question: "What's the primary objective? What outcome would make this campaign a success?",
    options: ['Lead Generation', 'Brand Awareness', 'Program Enrollment', 'Community Growth', 'Event Promotion', 'Other'],
  },
  {
    field: 'icp',
    question: "Who's the ideal audience? Describe the person you want this to reach.",
    options: ['High-Performers / Executives', 'Wellness Practitioners', 'Athletes / Peak Performance', 'Parents / Families', 'Clinical Professionals', 'Custom...'],
  },
  {
    field: 'messaging',
    question: "What's the core message or hook? What should people feel or understand after seeing this campaign?",
  },
  {
    field: 'platforms',
    question: "Which platforms should we target?",
    options: ['Instagram', 'LinkedIn', 'Facebook', 'TikTok', 'X (Twitter)', 'All Platforms'],
  },
  {
    field: 'quiz',
    question: "Should this campaign include a quiz or assessment as a lead capture tool?",
    options: ['NSCI Quick-Score (7 questions)', 'Custom Quiz', 'No Quiz - Direct CTA', 'Let me decide later'],
  },
  {
    field: 'duration',
    question: "How long should this campaign run?",
    options: ['2 weeks (sprint)', '30 days (standard)', '60 days (deep)', '90 days (evergreen)', 'Custom timeline'],
  },
  {
    field: 'budget',
    question: "What's the monthly budget range? This helps me recommend post frequency and ad spend allocation.",
    options: ['$0 (organic only)', '$100-500', '$500-2,000', '$2,000-5,000', '$5,000+', 'Not sure yet'],
  },
  {
    field: 'tone',
    question: "Any specific tone or angle? Think about what makes this campaign unique.",
    options: ['Educational / Authority', 'Inspirational / Aspirational', 'Data-Driven / Scientific', 'Personal Story / Testimonial', 'Urgent / Limited-Time'],
  },
  {
    field: 'content_assets',
    question: "Do you have existing content to repurpose? Blog posts, podcast episodes, videos, testimonials?",
    options: ['Yes - I have content ready', 'Some - needs adapting', 'No - create everything fresh', 'I have ideas but nothing produced'],
  },
]

export default function CampaignsPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [brand, setBrand] = useState('np')
  const [budget, setBudget] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [editingStatus, setEditingStatus] = useState(false)

  // AI Builder state
  const [aiMode, setAiMode] = useState(false)
  const [aiStep, setAiStep] = useState(0)
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiData, setAiData] = useState<Record<string, string>>({})
  const [aiConfidence, setAiConfidence] = useState(0)
  const [aiGenerating, setAiGenerating] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase.from('campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
    if (data) setCampaigns(data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const updateCampaignStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('campaigns').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    if (!error) {
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c))
      if (selectedCampaign?.id === id) setSelectedCampaign(prev => prev ? { ...prev, status: newStatus } : null)
    }
  }

  const deleteCampaign = async (id: string) => {
    if (!confirm('Delete this campaign? This cannot be undone.')) return
    const { error } = await supabase.from('campaigns').delete().eq('id', id)
    if (!error) {
      setCampaigns(prev => prev.filter(c => c.id !== id))
      setSelectedCampaign(null)
    }
  }

  // Manual create
  const handleCreate = async () => {
    if (!name.trim() || !currentOrg) return
    setSaving(true)
    const { data, error } = await supabase.from('campaigns').insert({
      org_id: currentOrg.id,
      brand,
      name: name.trim(),
      description: description.trim() || null,
      budget: budget ? parseFloat(budget) : null,
      start_date: startDate || null,
      end_date: endDate || null,
      status: 'draft',
      goals: {},
      post_ids: [],
      funnel_config: {},
      ai_suggestions: {},
      custom_fields: {},
    }).select().single()
    setSaving(false)
    if (data && !error) {
      setCampaigns(prev => [data, ...prev])
      setName(''); setDescription(''); setBudget(''); setStartDate(''); setEndDate('')
      setCreating(false)
    } else {
      console.error('Campaign save error:', error)
    }
  }

  // AI Builder functions
  const startAI = () => {
    setAiMode(true)
    setAiStep(0)
    setAiData({})
    setAiConfidence(0)
    setAiMessages([
      {
        role: 'ai',
        content: "Hey! I'm going to help you build a campaign from scratch. I'll ask you a series of questions to understand your goals, audience, and preferences. Once I'm confident I understand what you need, I'll generate a complete campaign plan.\n\nLet's start:",
      },
      {
        role: 'ai',
        content: AI_FLOW[0].question,
        options: AI_FLOW[0].options,
        field: AI_FLOW[0].field,
      },
    ])
  }

  const handleAIResponse = (response: string) => {
    const currentStep = AI_FLOW[aiStep]
    const newData = { ...aiData, [currentStep.field]: response }
    setAiData(newData)

    // Add user message
    const newMessages: AIMessage[] = [
      ...aiMessages,
      { role: 'user', content: response },
    ]

    // Calculate confidence based on how many fields are filled
    const filledFields = Object.keys(newData).length
    const totalFields = AI_FLOW.length
    const newConfidence = Math.round((filledFields / totalFields) * 100)
    setAiConfidence(newConfidence)

    const nextStep = aiStep + 1

    if (nextStep < AI_FLOW.length) {
      // More questions
      const nextQ = AI_FLOW[nextStep]
      const acknowledgments = [
        "Got it.",
        "Perfect.",
        "Nice.",
        "Good choice.",
        "That helps a lot.",
        "Understood.",
        "Great, that narrows things down.",
        "Love it.",
      ]
      const ack = acknowledgments[Math.floor(Math.random() * acknowledgments.length)]

      newMessages.push({
        role: 'ai',
        content: `${ack} ${nextQ.question}`,
        options: nextQ.options,
        field: nextQ.field,
      })
      setAiStep(nextStep)
    } else {
      // All questions answered - generate campaign
      newMessages.push({
        role: 'ai',
        content: "I now have a clear picture of what you're building. Let me generate your campaign plan...",
      })
      setAiConfidence(95)
      generateCampaign(newData, newMessages)
    }

    setAiMessages(newMessages)
    setAiInput('')
  }

  const generateCampaign = async (data: Record<string, string>, messages: AIMessage[]) => {
    setAiGenerating(true)

    // Simulate AI thinking time
    await new Promise(r => setTimeout(r, 2000))

    const brandKey = data.brand?.includes('Sensorium') ? 'sensorium' : 'np'
    const brandLabel = brandKey === 'np' ? 'Neuro Progeny' : 'Sensorium'
    const budgetVal = data.budget?.match(/\d[\d,]*/) ? parseInt(data.budget.replace(/[^0-9]/g, '')) : 0
    const durationDays = data.duration?.includes('2 week') ? 14 : data.duration?.includes('60') ? 60 : data.duration?.includes('90') ? 90 : 30

    const today = new Date()
    const endDate = new Date(today.getTime() + durationDays * 24 * 60 * 60 * 1000)

    const campaignName = `${data.objective || 'Campaign'} - ${data.icp?.split('/')[0]?.trim() || 'General'}`

    const plan = `Here's your campaign plan:

**${campaignName}**
Brand: ${brandLabel}
Duration: ${durationDays} days (${today.toLocaleDateString()} → ${endDate.toLocaleDateString()})
Budget: ${data.budget || 'TBD'}
Target: ${data.icp || 'General audience'}

**Core Message:** ${data.messaging || 'To be refined'}

**Strategy:**
• Objective: ${data.objective}
• Tone: ${data.tone || 'Brand standard'}
• Platforms: ${data.platforms || 'Multi-platform'}
• Lead Capture: ${data.quiz || 'Direct CTA'}

**Suggested Content Calendar (${durationDays} days):**
• Week 1-2: Awareness phase - educational posts establishing authority
• Week 2-3: Engagement phase - interactive content, polls, questions
• Week 3-4: Conversion phase - testimonials, case studies, direct CTAs
${durationDays > 30 ? '• Week 5+: Nurture phase - deeper content, email sequences, retargeting' : ''}

**Recommended Post Frequency:**
${budgetVal > 2000 ? '• 5-7 posts/week across platforms with paid amplification' : budgetVal > 500 ? '• 3-5 posts/week with selective boosting' : '• 3-4 organic posts/week'}

**Next Steps:**
1. Review and approve this plan
2. Create quiz (if selected)
3. Generate post content in Social Designer
4. Schedule and launch

Ready to create this campaign?`

    const updatedMessages = [
      ...messages,
      { role: 'ai' as const, content: plan, options: ['Create Campaign', 'Modify Something', 'Start Over'] },
    ]
    setAiMessages(updatedMessages)
    setAiConfidence(98)
    setAiGenerating(false)

    // Store generated data for campaign creation
    setAiData(prev => ({
      ...prev,
      _generated: 'true',
      _name: campaignName,
      _brand: brandKey,
      _budget: String(budgetVal),
      _startDate: today.toISOString().split('T')[0],
      _endDate: endDate.toISOString().split('T')[0],
      _description: `Objective: ${data.objective}. Target: ${data.icp}. Message: ${data.messaging}. Tone: ${data.tone}.`,
    }))
  }

  const handleAIAction = async (action: string) => {
    if (action === 'Create Campaign') {
      if (!currentOrg) return
      setSaving(true)
      const { data, error } = await supabase.from('campaigns').insert({
        org_id: currentOrg.id,
        brand: aiData._brand || 'np',
        name: aiData._name || 'AI Campaign',
        description: aiData._description || null,
        budget: aiData._budget ? parseFloat(aiData._budget) : null,
        start_date: aiData._startDate || null,
        end_date: aiData._endDate || null,
        status: 'draft',
        goals: {
          objective: aiData.objective,
          icp: aiData.icp,
          platforms: aiData.platforms,
          quiz: aiData.quiz,
          tone: aiData.tone,
        },
        post_ids: [],
        funnel_config: { quiz_type: aiData.quiz, content_assets: aiData.content_assets },
        ai_suggestions: aiData,
        custom_fields: {},
      }).select().single()
      setSaving(false)

      if (data && !error) {
        setCampaigns(prev => [data, ...prev])
        setAiMessages(prev => [...prev,
          { role: 'user', content: action },
          { role: 'ai', content: `Campaign "${aiData._name}" created! You can find it in your campaign list. Next up: head to the Social Designer to start creating content for this campaign.` },
        ])
        setAiConfidence(100)
      } else {
        setAiMessages(prev => [...prev,
          { role: 'ai', content: `Something went wrong saving: ${error?.message}. Try again?`, options: ['Create Campaign', 'Start Over'] },
        ])
      }
    } else if (action === 'Start Over') {
      startAI()
    } else if (action === 'Modify Something') {
      setAiMessages(prev => [...prev,
        { role: 'user', content: action },
        { role: 'ai', content: "What would you like to change? Tell me what to adjust and I'll update the plan.", },
      ])
    }
  }

  const handleAISubmit = () => {
    if (!aiInput.trim()) return
    const currentQ = aiMessages[aiMessages.length - 1]
    if (currentQ?.options?.includes('Create Campaign')) {
      handleAIAction(aiInput.trim())
    } else {
      handleAIResponse(aiInput.trim())
    }
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading campaigns...</div></div>
  }

  const activeCampaigns = campaigns.filter(c => c.status === 'active')
  const totalBudget = activeCampaigns.reduce((sum, c) => sum + (c.budget || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Campaigns</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {campaigns.length} campaigns · {activeCampaigns.length} active</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
            <Plus className="w-3.5 h-3.5" /> Manual Create
          </button>
          <button onClick={startAI}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity">
            <Wand2 className="w-3.5 h-3.5" /> AI Campaign Builder
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Campaigns', value: campaigns.length, icon: Target, color: '#386797' },
            { label: 'Active Now', value: activeCampaigns.length, icon: Zap, color: '#10B981' },
            { label: 'Total Budget', value: '$' + totalBudget.toLocaleString(), icon: DollarSign, color: '#F59E0B' },
            { label: 'Avg Performance', value: 'Coming Soon', icon: TrendingUp, color: '#8B5CF6' },
          ].map((stat, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="text-lg font-bold text-np-dark">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* AI Campaign Builder Modal */}
      {aiMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAiMode(false)} />
          <div className="relative w-full max-w-2xl h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* AI Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-np-blue">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-white" />
                <span className="text-sm font-bold text-white">AI Campaign Builder</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Confidence meter */}
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${aiConfidence}%`, backgroundColor: aiConfidence >= 95 ? '#10B981' : aiConfidence >= 50 ? '#F59E0B' : '#ffffff80' }} />
                  </div>
                  <span className="text-[10px] text-white/80 font-mono">{aiConfidence}%</span>
                </div>
                <button onClick={() => setAiMode(false)} className="p-1 rounded hover:bg-white/10">
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-np-blue text-white rounded-2xl rounded-br-sm' : 'bg-gray-50 text-np-dark rounded-2xl rounded-bl-sm'} px-4 py-3`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {/* Option buttons */}
                    {msg.options && msg.role === 'ai' && i === aiMessages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.options.map(opt => (
                          <button key={opt}
                            onClick={() => {
                              if (opt === 'Create Campaign' || opt === 'Modify Something' || opt === 'Start Over') {
                                handleAIAction(opt)
                              } else {
                                handleAIResponse(opt)
                              }
                            }}
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
                    <span className="text-sm text-gray-500">Building your campaign plan...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAISubmit() }}
                  placeholder="Type your answer or pick an option above..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={handleAISubmit}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-xl hover:opacity-90">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Create Form */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-np-dark mb-4">New Campaign</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 block mb-0.5">Campaign Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Q1 High-Performer Acquisition"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 block mb-0.5">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Campaign goals and strategy..."
                rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Brand</label>
              <div className="flex gap-1.5">
                {[{ k: 'np', l: 'Neuro Progeny' }, { k: 'sensorium', l: 'Sensorium' }].map(b => (
                  <button key={b.k} onClick={() => setBrand(b.k)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${brand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                    {b.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Budget</label>
              <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="2000"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5"><Calendar className="w-3 h-3" /> Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !name.trim()}
              className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Create Campaign'}
            </button>
            <button onClick={() => setCreating(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {campaigns.length === 0 && !creating && !aiMode && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Target className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Campaign Designer</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Build campaigns that connect your quizzes, social posts, and email sequences. Track performance with Bayesian ranking to find your winning formula.
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={() => setCreating(true)} className="btn-secondary text-sm py-2.5 px-5">Manual Create</button>
            <button onClick={startAI}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium hover:opacity-90">
              <Wand2 className="w-4 h-4" /> AI Campaign Builder
            </button>
          </div>
        </div>
      )}

      {/* Campaign Cards */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(campaign => {
            const statusConf = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft
            const goals = campaign.goals || {}
            return (
              <div key={campaign.id} onClick={() => setSelectedCampaign(campaign)}
                className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md hover:border-gray-200 transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>
                    {statusConf.label}
                  </span>
                  <span className="text-[8px] font-bold uppercase text-gray-400">
                    {campaign.brand === 'np' ? 'Neuro Progeny' : 'Sensorium'}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-np-dark mb-1">{campaign.name}</h3>
                {campaign.description && (
                  <p className="text-[10px] text-gray-500 line-clamp-2 mb-3">{campaign.description}</p>
                )}
                {/* Goal tags */}
                {(goals.objective || goals.icp) && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {goals.objective && <span className="text-[7px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded font-medium">{goals.objective}</span>}
                    {goals.icp && <span className="text-[7px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">{goals.icp}</span>}
                    {goals.platforms && <span className="text-[7px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-medium">{goals.platforms}</span>}
                  </div>
                )}
                <div className="flex items-center gap-3 text-[9px] text-gray-400">
                  {campaign.budget && (
                    <span className="flex items-center gap-0.5"><DollarSign className="w-3 h-3" />{campaign.budget.toLocaleString()}</span>
                  )}
                  {campaign.start_date && (
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3" />
                      {new Date(campaign.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {campaign.end_date && (' → ' + new Date(campaign.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedCampaign(null)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-np-blue" />
                <h2 className="text-lg font-bold text-np-dark">{selectedCampaign.name}</h2>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Status + Brand Row */}
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {Object.entries(STATUS_CONFIG).map(([key, conf]) => (
                    <button key={key} onClick={() => updateCampaignStatus(selectedCampaign.id, key)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all ${selectedCampaign.status === key ? 'ring-2 ring-offset-1' : 'opacity-50 hover:opacity-80'}`}
                      style={{ backgroundColor: conf.bg, color: conf.color, ...(selectedCampaign.status === key ? { ringColor: conf.color } : {}) }}>
                      {conf.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] font-bold uppercase text-gray-400 ml-auto">
                  {selectedCampaign.brand === 'np' ? 'Neuro Progeny' : 'Sensorium'}
                </span>
              </div>

              {/* Description */}
              {selectedCampaign.description && (
                <div>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</h4>
                  <p className="text-sm text-gray-600 leading-relaxed">{selectedCampaign.description}</p>
                </div>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Budget</span>
                  </div>
                  <p className="text-lg font-bold text-np-dark">
                    {selectedCampaign.budget ? '$' + selectedCampaign.budget.toLocaleString() : 'Not set'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Timeline</span>
                  </div>
                  <p className="text-sm font-bold text-np-dark">
                    {selectedCampaign.start_date
                      ? new Date(selectedCampaign.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : 'No start'}
                    {selectedCampaign.end_date
                      ? ' → ' + new Date(selectedCampaign.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : ''}
                  </p>
                </div>
              </div>

              {/* Goals / AI Data */}
              {selectedCampaign.goals && Object.keys(selectedCampaign.goals).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Campaign Goals</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedCampaign.goals).map(([key, value]) => (
                      <div key={key} className="bg-purple-50 rounded-lg px-3 py-2">
                        <span className="text-[8px] font-bold text-purple-400 uppercase block">{key.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-semibold text-purple-700">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Suggestions */}
              {selectedCampaign.ai_suggestions && Object.keys(selectedCampaign.ai_suggestions).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Wand2 className="w-3 h-3 text-purple-500" /> AI Campaign Data
                  </h4>
                  <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-4 space-y-2">
                    {Object.entries(selectedCampaign.ai_suggestions)
                      .filter(([k]) => !k.startsWith('_'))
                      .map(([key, value]) => (
                        <div key={key} className="flex items-start gap-2">
                          <span className="text-[9px] font-bold text-gray-400 uppercase min-w-[80px]">{key}</span>
                          <span className="text-xs text-np-dark">{String(value)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Funnel Config */}
              {selectedCampaign.custom_fields && Object.keys(selectedCampaign.custom_fields).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Custom Fields</h4>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <pre className="text-[10px] text-gray-600 overflow-auto">{JSON.stringify(selectedCampaign.custom_fields, null, 2)}</pre>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <Link href="/social"
                  className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5" /> Go to Social Designer
                </Link>
                <button onClick={() => deleteCampaign(selectedCampaign.id)}
                  className="ml-auto text-xs text-red-400 hover:text-red-600 font-medium px-3 py-2">
                  Delete Campaign
                </button>
              </div>

              {/* Meta */}
              <p className="text-[9px] text-gray-300">
                Created {new Date(selectedCampaign.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
