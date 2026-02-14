'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Brain, Users, User, Compass, Plus, X, Trash2, Loader2, Send, Upload,
  Sparkles, FileText, Mic, Video, ChevronDown, MessageSquare, Settings, Wand2,
  Route, CheckSquare, Rocket, Megaphone, Target, BarChart3, Mail, BookOpen
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================
interface AdvisoryVoice {
  id: string
  name: string
  role: string
  description: string
  style: string
  color: string
  avatar: string
  knowledge: string // accumulated from transcripts/uploads
  source_count: number
  enabled: boolean
}

interface ChatMsg { role: 'user' | 'assistant'; content: string }

// ============================================================
// HUB MAP - every feature and how to get there
// ============================================================
const HUB_MAP = `
NPU HUB FEATURE MAP (use this to guide users):

JOURNEY BUILDER (/journeys) - Visual customer journey with paths and cards. Each path = a major phase (Marketing, Sales, Onboarding, Program, Off-boarding). Cards are touchpoints within paths. Cards can have assets, resources, tasks, email sending.
- "How do I create a journey?" → Go to Journey Builder, click Add Path or AI Journey Creator
- "How do I send resources to someone?" → Open a card in Journey Builder, expand the email widget, select resources, add recipient, click Send
- "How do I use AI to build a journey?" → Click the purple AI Journey Creator button, describe your business, preview, then create

TASK MANAGER (/tasks) - Kanban board with columns. Drag cards between columns. Click cards to edit details, assign team members, set due dates.
- "How do I create a task?" → Go to Task Manager, click + in any column
- "How do tasks connect to ShipIt?" → Create tasks from ShipIt sections, or link existing tasks in the card detail

SHIPIT JOURNAL (/shipit) - Godin/Linchpin shipping framework. 6 sections: What/Who/Why/Fears/Timeline/Ship Date. AI Coach for each section. Export to Google Docs.
- "How do I ship a project?" → Create a new ShipIt project, fill in sections, set a ship date, use AI coach for guidance
- "How do I export to Google Doc?" → Click Export button, choose Create Google Doc (requires Apps Script integration)

CAMPAIGNS (/campaigns) - 11-phase marketing campaign pipeline. AI Campaign Builder generates full campaign plans. RACI role assignment on steps.
- "How do I create a campaign?" → Go to Campaigns, click New Campaign, or use AI Campaign Builder for AI-generated plans
- "What are the campaign phases?" → Ideation, Strategy, Creative, Copy, Landing, Tracking, Build, QA, Launch, Optimize, Report

SOCIAL MEDIA (/social) - 3-panel designer. Left: controls and voices. Center: AI chat generates 3 options per request. Right: platform previews. Posts tab for drafts. Calendar for scheduling.
- "How do I create social posts?" → Go to Social Media, describe what you want, AI generates 3 options, select and save as drafts
- "How do I schedule posts?" → Go to Calendar tab, drag posts from drafts to calendar days
- "How do I create posts from a video?" → Click "From Video/Podcast" button, paste YouTube URL or transcript

SETTINGS (/settings) - Brand identity, voice, vocabulary, messaging, AI prompts, email templates, content guardrails, platform rules.
- "Where do I set up email templates?" → Settings > Email Templates section
- "How do I change the brand voice?" → Settings > Voice & Tone section
- "Where are the AI prompts?" → Settings > AI Prompts section

INTEGRATIONS (/integrations) - Google Apps Script (master integration), Gmail, Slack, Calendar connections.
- "How do I connect Gmail?" → Integrations > Google Apps Script card, paste your Web App URL, test connection
- "How do I send emails?" → First set up Apps Script in Integrations, then use the email widget on Journey Cards

TEAM (/team) - Team member management, roles, permissions.
MEDIA LIBRARY (/media) - Upload and organize images, videos, documents.
IDEAS (/ideas) - Capture and vote on business ideas.
SOPs (/sops) - Standard operating procedures.
ICPs (/icps) - Ideal customer profile definitions.
CALENDAR (/calendar) - Content calendar and scheduling.
COMPANY LIBRARY (/library) - Curated books and resources that define the methodology.
MEDIA APPEARANCES (/media-appearances) - Track podcast/media appearances.
SUPPORT TICKETS (/tickets) - Cross-app support ticket management.
ANALYTICS (/analytics) - Platform analytics and metrics.
AI ADVISORY (/advisory) - This page. Advisory board voices, Cameron AI, Hub Guide.
`

const DEFAULT_VOICES: AdvisoryVoice[] = [
  { id: 'cameron', name: 'Cameron Allen', role: 'Founder & CEO', description: 'My own perspective, trained from my conversations, decisions, and communication style. Ask me anything about how I would handle a situation, what my priorities are, or how I think about problems.', style: 'Direct, warm, capacity-focused. Uses biological framing. Forward-facing questions. No em dashes.', color: '#386797', avatar: 'CA', knowledge: '', source_count: 0, enabled: true },
  { id: 'advisor-1', name: 'Advisory Board', role: 'Strategic Advisors', description: 'Collective wisdom from advisory board meetings. Feed in recordings and transcripts to build this voice.', style: 'Strategic, experienced, asks clarifying questions before advising.', color: '#8B5CF6', avatar: 'AB', knowledge: '', source_count: 0, enabled: true },
]

// ============================================================
// COMPONENT
// ============================================================
export default function AdvisoryPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()
  const [tab, setTab] = useState<'voices' | 'cameron' | 'guide'>('guide')

  // Voices
  const [voices, setVoices] = useState<AdvisoryVoice[]>(DEFAULT_VOICES)
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null)
  const [voiceChat, setVoiceChat] = useState<ChatMsg[]>([])
  const [voiceInput, setVoiceInput] = useState('')
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [editingVoice, setEditingVoice] = useState<AdvisoryVoice | null>(null)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null)
  const [uploadText, setUploadText] = useState('')
  const [extracting, setExtracting] = useState(false)

  // Cameron AI
  const [cameronChat, setCameronChat] = useState<ChatMsg[]>([])
  const [cameronInput, setCameronInput] = useState('')
  const [cameronLoading, setCameronLoading] = useState(false)

  // Hub Guide
  const [guideChat, setGuideChat] = useState<ChatMsg[]>([])
  const [guideInput, setGuideInput] = useState('')
  const [guideLoading, setGuideLoading] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)

  // Load voices from Supabase
  useEffect(() => {
    if (!currentOrg) return
    const load = async () => {
      const { data } = await supabase
        .from('brand_profiles')
        .select('guidelines')
        .eq('org_id', currentOrg.id)
        .eq('brand_key', 'np')
        .single()
      if (data?.guidelines?.advisory_voices) {
        setVoices(data.guidelines.advisory_voices)
      }
    }
    load()
  }, [currentOrg])

  // Save voices
  const saveVoices = useCallback(async (newVoices: AdvisoryVoice[]) => {
    if (!currentOrg) return
    const { data: existing } = await supabase
      .from('brand_profiles')
      .select('guidelines')
      .eq('org_id', currentOrg.id)
      .eq('brand_key', 'np')
      .single()
    await supabase
      .from('brand_profiles')
      .update({ guidelines: { ...(existing?.guidelines || {}), advisory_voices: newVoices } })
      .eq('org_id', currentOrg.id)
      .eq('brand_key', 'np')
    setVoices(newVoices)
  }, [currentOrg, supabase])

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [voiceChat, cameronChat, guideChat])

  // ============================================================
  // AI CALLS
  // ============================================================
  const sendToAI = async (
    systemPrompt: string,
    messages: ChatMsg[],
    userMsg: string,
    setChat: (fn: (prev: ChatMsg[]) => ChatMsg[]) => void,
    setLoading: (b: boolean) => void,
    setInput: (s: string) => void,
  ) => {
    if (!userMsg.trim() || false) return
    const newMsgs: ChatMsg[] = [...messages, { role: 'user', content: userMsg.trim() }]
    setChat(() => newMsgs)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMsgs,
          campaignContext: { type: 'advisory', systemOverride: systemPrompt },
        }),
      })
      const data = await res.json()
      const reply = (data.content || 'No response.').replace(/\*\*/g, '').replace(/\u2014/g, ', ').replace(/\u2013/g, ', ').trim()
      setChat(() => [...newMsgs, { role: 'assistant', content: reply }])
    } catch {
      setChat(() => [...newMsgs, { role: 'assistant', content: 'Connection error. Try again.' }])
    }
    setLoading(false)
  }

  // Voice chat
  const sendVoiceChat = () => {
    const voice = voices.find(v => v.id === selectedVoice)
    if (!voice) return
    const sys = `You are ${voice.name}, ${voice.role}. ${voice.description}

Communication style: ${voice.style}

${voice.knowledge ? `KNOWLEDGE BASE (from uploaded transcripts and recordings):\n${voice.knowledge}\n\nUse this knowledge to inform your responses. When asked about specific topics covered in the knowledge base, reference that information directly.` : 'No knowledge base uploaded yet. Respond based on the role description.'}

Stay in character. Answer questions the way ${voice.name} would. Be helpful and specific.`

    sendToAI(sys, voiceChat, voiceInput, setVoiceChat, setVoiceLoading, setVoiceInput)
  }

  // Cameron AI
  const sendCameronChat = () => {
    const cameron = voices.find(v => v.id === 'cameron')
    const sys = `You are Cameron Allen, founder and CEO of Neuro Progeny. You are an AI representation of Cameron, trained to answer questions the way Cameron would.

Your communication style: Direct, warm, grounded. You use biological framing for nervous system concepts. You ask forward-facing questions. You never use em dashes. You frame everything through capacity building, not pathology.

Core beliefs:
- All behavior is adaptive. Nothing is broken.
- HRV is a mirror, not a score to optimize
- We train state fluidity, not calm-chasing
- Capacity gaps are training opportunities, not character flaws
- VR biofeedback is a feedback amplifier

${cameron?.knowledge ? `CAMERON'S KNOWLEDGE BASE (from conversations, recordings, and decisions):\n${cameron.knowledge}\n\nUse this knowledge to answer questions authentically as Cameron would. Reference specific decisions, preferences, and approaches from the knowledge base.` : ''}

Your team members will ask you questions about:
- How to handle situations
- What your priorities are
- How you think about problems
- Business decisions
- How features in the platform work and connect
- Your communication style and preferences

Answer as Cameron would. Be direct, specific, and helpful. If you don't have enough context to answer as Cameron, say so and give your best approximation.`

    sendToAI(sys, cameronChat, cameronInput, setCameronChat, setCameronLoading, setCameronInput)
  }

  // Hub Guide
  const sendGuideChat = () => {
    const sys = `You are the NPU Hub Guide, an intelligent assistant that knows every feature of the NPU Hub platform. Your job is to help team members navigate the platform, find features, understand how things connect, and learn how to use tools effectively.

${HUB_MAP}

RESPONSE RULES:
- Be concise and direct
- When explaining how to do something, give step-by-step instructions
- Reference specific page paths (e.g., "Go to /journeys")
- When features connect (like tasks linking to ShipIt), explain the connection
- If they ask about something not in the hub, say so
- Use friendly, helpful tone
- No em dashes
- If they seem lost, ask what they're trying to accomplish`

    sendToAI(sys, guideChat, guideInput, setGuideChat, setGuideLoading, setGuideInput)
  }

  // ============================================================
  // EXTRACT KNOWLEDGE FROM TEXT
  // ============================================================
  const extractKnowledge = async (voiceId: string, rawText: string, sourceName: string) => {
    setExtracting(true)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Extract key insights, advice, decisions, perspectives, communication patterns, and notable quotes from this transcript/recording. Organize by topic. Be thorough but concise. Preserve the speaker's voice and style.\n\nSource: ${sourceName}\n\nContent:\n${rawText.slice(0, 30000)}` }],
          campaignContext: { type: 'knowledge_extraction', systemOverride: 'You are a knowledge extraction system. Extract and organize key insights, decisions, advice patterns, communication style notes, and notable perspectives from the provided content. Return structured, searchable knowledge that can be used to emulate this person\'s voice and decision-making. Format as clear paragraphs organized by topic.' },
        }),
      })
      const data = await res.json()
      const extracted = (data.content || '').replace(/\*\*/g, '').replace(/\u2014/g, ', ').trim()

      if (extracted) {
        const updated = voices.map(v => {
          if (v.id === voiceId) {
            return {
              ...v,
              knowledge: (v.knowledge ? v.knowledge + '\n\n---\n\n' : '') + `[Source: ${sourceName}]\n${extracted}`,
              source_count: v.source_count + 1,
            }
          }
          return v
        })
        await saveVoices(updated)
      }
    } catch {}
    setExtracting(false)
    setUploadingTo(null)
    setUploadText('')
  }

  // ============================================================
  // RENDER HELPERS
  // ============================================================
  const ChatBubble = ({ msg }: { msg: ChatMsg }) => (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
        msg.role === 'user'
          ? 'bg-np-blue text-white rounded-br-sm'
          : 'bg-gray-50 border border-gray-100 text-gray-700 rounded-bl-sm'
      }`}>{msg.content}</div>
    </div>
  )

  const ChatInput = ({ value, onChange, onSend, loading, placeholder }: any) => (
    <div className="px-3 py-2.5 border-t border-gray-100 flex gap-2">
      <input value={value} onChange={(e: any) => onChange(e.target.value)}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        placeholder={placeholder}
        className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300" />
      <button onClick={onSend} disabled={loading || !value.trim()}
        className="px-3 py-2 bg-np-blue text-white rounded-lg hover:bg-np-blue/90 disabled:opacity-40">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      </button>
    </div>
  )

  const QuickPrompts = ({ prompts, onSelect }: { prompts: string[]; onSelect: (s: string) => void }) => (
    <div className="space-y-1.5 px-1">
      {prompts.map(q => (
        <button key={q} onClick={() => onSelect(q)}
          className="w-full text-left text-[11px] text-gray-600 bg-white border border-gray-100 rounded-lg px-3 py-2 hover:bg-np-blue/5 hover:border-np-blue/20 hover:text-np-blue transition-all">
          {q}
        </button>
      ))}
    </div>
  )

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">AI Advisory</h1>
          <p className="text-xs text-gray-400 mt-0.5">Advisory voices, Cameron AI, and platform guide</p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {([
            ['guide', Compass, 'Hub Guide'],
            ['cameron', User, 'Cameron AI'],
            ['voices', Users, 'Board Voices'],
          ] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === k ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/* TAB: HUB GUIDE */}
      {/* ============================================================ */}
      {tab === 'guide' && (
        <div className="flex-1 flex flex-col bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Compass className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-np-dark">Hub Guide</h2>
              <p className="text-[10px] text-gray-400">I know every feature in NPU Hub. Ask me how to do anything.</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {guideChat.length === 0 && (
              <div className="py-6">
                <p className="text-xs text-gray-400 text-center mb-4">What would you like to do? I can walk you through any feature.</p>
                <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto">
                  {[
                    { icon: Route, label: 'How do I build a customer journey?', color: '#8B5CF6' },
                    { icon: Mail, label: 'How do I send resources to someone?', color: '#EA4335' },
                    { icon: Rocket, label: 'How does ShipIt connect to tasks?', color: '#F59E0B' },
                    { icon: Megaphone, label: 'Walk me through creating a campaign', color: '#3B82F6' },
                    { icon: Target, label: 'How do I create social media posts?', color: '#EC4899' },
                    { icon: Settings, label: 'Where do I set up integrations?', color: '#10B981' },
                  ].map(q => (
                    <button key={q.label} onClick={() => setGuideInput(q.label)}
                      className="flex items-center gap-2 text-left text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 hover:bg-np-blue/5 hover:border-np-blue/20 hover:text-np-blue transition-all">
                      <q.icon className="w-4 h-4 flex-shrink-0" style={{ color: q.color }} />
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {guideChat.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {guideLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 text-teal-500 animate-spin" />
                  <span className="text-[10px] text-gray-400">Looking that up...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <ChatInput value={guideInput} onChange={setGuideInput} onSend={sendGuideChat} loading={guideLoading} placeholder="Ask how to do anything in NPU Hub..." />
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB: CAMERON AI */}
      {/* ============================================================ */}
      {tab === 'cameron' && (
        <div className="flex-1 flex flex-col bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#386797] to-[#2a4f73] flex items-center justify-center text-white text-xs font-bold">CA</div>
              <div>
                <h2 className="text-sm font-bold text-np-dark">Cameron AI</h2>
                <p className="text-[10px] text-gray-400">Ask me anything. I'll answer the way Cameron would. {voices.find(v => v.id === 'cameron')?.source_count || 0} sources loaded.</p>
              </div>
            </div>
            <button onClick={() => { setEditingVoice(voices.find(v => v.id === 'cameron') || null); setUploadingTo('cameron') }}
              className="flex items-center gap-1 text-[10px] text-np-blue font-medium px-2.5 py-1.5 rounded-lg border border-np-blue/20 hover:bg-np-blue/5">
              <Upload className="w-3 h-3" /> Feed Knowledge
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {cameronChat.length === 0 && (
              <div className="py-6">
                <p className="text-xs text-gray-400 text-center mb-4">I'm Cameron's AI. Ask me how Cameron would handle something, what his priorities are, or how he thinks about a problem.</p>
                <QuickPrompts prompts={[
                  'How would Cameron handle a participant who wants to quit after week 2?',
                  'What are Cameron\'s priorities for Q1?',
                  'How does Cameron think about pricing the Immersive Mastermind?',
                  'What would Cameron say about adding a new feature to the platform?',
                ]} onSelect={setCameronInput} />
              </div>
            )}
            {cameronChat.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {cameronLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 text-[#386797] animate-spin" />
                  <span className="text-[10px] text-gray-400">Thinking like Cameron...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <ChatInput value={cameronInput} onChange={setCameronInput} onSend={sendCameronChat} loading={cameronLoading} placeholder="Ask Cameron anything..." />
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB: ADVISORY BOARD VOICES */}
      {/* ============================================================ */}
      {tab === 'voices' && (
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Left: Voice list */}
          <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-np-dark">Advisory Voices</h3>
              <button onClick={() => {
                const newVoice: AdvisoryVoice = {
                  id: `voice-${Date.now()}`, name: 'New Advisor', role: 'Advisor', description: '', style: '',
                  color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
                  avatar: 'NA', knowledge: '', source_count: 0, enabled: true,
                }
                setEditingVoice(newVoice)
              }} className="text-np-blue hover:bg-np-blue/5 p-1 rounded">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {voices.filter(v => v.id !== 'cameron').map(voice => (
                <button key={voice.id} onClick={() => { setSelectedVoice(voice.id); setVoiceChat([]) }}
                  className={`w-full text-left p-2.5 rounded-xl transition-all ${
                    selectedVoice === voice.id ? 'bg-np-blue/5 border border-np-blue/20' : 'hover:bg-gray-50 border border-transparent'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                      style={{ backgroundColor: voice.color }}>
                      {voice.avatar}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-np-dark truncate">{voice.name}</div>
                      <div className="text-[9px] text-gray-400 truncate">{voice.role} · {voice.source_count} sources</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Chat or empty */}
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            {selectedVoice ? (() => {
              const voice = voices.find(v => v.id === selectedVoice)
              if (!voice) return null
              return (
                <>
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: voice.color }}>
                        {voice.avatar}
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-np-dark">{voice.name}</h2>
                        <p className="text-[10px] text-gray-400">{voice.role} · {voice.source_count} sources</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setUploadingTo(voice.id)}
                        className="flex items-center gap-1 text-[10px] text-purple-600 font-medium px-2 py-1 rounded-lg border border-purple-200 hover:bg-purple-50">
                        <Upload className="w-3 h-3" /> Feed
                      </button>
                      <button onClick={() => setEditingVoice(voice)}
                        className="flex items-center gap-1 text-[10px] text-gray-500 font-medium px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">
                        <Settings className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                    {voiceChat.length === 0 && (
                      <div className="py-6">
                        <p className="text-xs text-gray-400 text-center mb-4">Chat with {voice.name}. {voice.source_count > 0 ? `${voice.source_count} sources loaded.` : 'Feed transcripts or recordings to build their knowledge base.'}</p>
                        <QuickPrompts prompts={[
                          `What would you advise about scaling cohort enrollment?`,
                          `How should we think about pricing strategy?`,
                          `What are the biggest risks you see right now?`,
                          `What should we prioritize this quarter?`,
                        ]} onSelect={setVoiceInput} />
                      </div>
                    )}
                    {voiceChat.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
                    {voiceLoading && (
                      <div className="flex justify-start">
                        <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" style={{ color: voice.color }} />
                          <span className="text-[10px] text-gray-400">{voice.name} is thinking...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <ChatInput value={voiceInput} onChange={setVoiceInput} onSend={sendVoiceChat} loading={voiceLoading} placeholder={`Ask ${voice.name}...`} />
                </>
              )
            })() : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Select an advisory voice to start a conversation</p>
                  <p className="text-[10px] text-gray-300 mt-1">Feed transcripts and recordings to build their knowledge base</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* UPLOAD MODAL */}
      {/* ============================================================ */}
      {uploadingTo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !extracting && setUploadingTo(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-bold text-np-dark">Feed Knowledge to {voices.find(v => v.id === uploadingTo)?.name}</h3>
              </div>
              <button onClick={() => !extracting && setUploadingTo(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-500">Paste a transcript, meeting notes, or conversation text. AI will extract key insights, advice patterns, and communication style to build this voice's knowledge base.</p>

              <div className="flex gap-2">
                {[
                  { icon: FileText, label: 'Transcript', desc: 'Paste text' },
                  { icon: Mic, label: 'Audio', desc: 'Coming soon' },
                  { icon: Video, label: 'Video', desc: 'Coming soon' },
                ].map(t => (
                  <div key={t.label} className={`flex-1 border rounded-xl p-3 text-center ${t.label === 'Transcript' ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                    <t.icon className={`w-5 h-5 mx-auto mb-1 ${t.label === 'Transcript' ? 'text-purple-500' : 'text-gray-400'}`} />
                    <div className="text-[10px] font-bold text-gray-600">{t.label}</div>
                    <div className="text-[8px] text-gray-400">{t.desc}</div>
                  </div>
                ))}
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Source Name</label>
                <input id="source-name" placeholder="e.g., Advisory Board Call Jan 2026"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300/30 placeholder-gray-300" />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Paste Transcript / Notes</label>
                <textarea value={uploadText} onChange={e => setUploadText(e.target.value)}
                  placeholder="Paste the full transcript, meeting notes, or conversation here..."
                  rows={8}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300/30 placeholder-gray-300 resize-none font-mono" />
                <div className="text-[9px] text-gray-400 mt-1">{uploadText.length.toLocaleString()} characters · ~{Math.round(uploadText.length / 4).toLocaleString()} tokens</div>
              </div>

              {extracting && (
                <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 px-3 py-2 rounded-lg">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Extracting knowledge... This may take a moment.
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => !extracting && setUploadingTo(null)}
                className="text-xs text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={() => {
                const sourceName = (document.getElementById('source-name') as HTMLInputElement)?.value || 'Untitled Source'
                extractKnowledge(uploadingTo, uploadText, sourceName)
              }} disabled={extracting || !uploadText.trim()}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-purple-600 px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-40">
                {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {extracting ? 'Extracting...' : 'Extract Knowledge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* EDIT VOICE MODAL */}
      {/* ============================================================ */}
      {editingVoice && !uploadingTo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditingVoice(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-np-dark">{voices.find(v => v.id === editingVoice.id) ? 'Edit Voice' : 'New Voice'}</h3>
              <button onClick={() => setEditingVoice(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Name</label>
                  <input value={editingVoice.name} onChange={e => setEditingVoice({ ...editingVoice, name: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Role</label>
                  <input value={editingVoice.role} onChange={e => setEditingVoice({ ...editingVoice, role: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Initials</label>
                  <input value={editingVoice.avatar} onChange={e => setEditingVoice({ ...editingVoice, avatar: e.target.value.slice(0, 2).toUpperCase() })}
                    maxLength={2}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Color</label>
                  <input type="color" value={editingVoice.color} onChange={e => setEditingVoice({ ...editingVoice, color: e.target.value })}
                    className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Description</label>
                <textarea value={editingVoice.description} onChange={e => setEditingVoice({ ...editingVoice, description: e.target.value })}
                  placeholder="What perspective does this voice bring? What are they known for?"
                  rows={2}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Communication Style</label>
                <input value={editingVoice.style} onChange={e => setEditingVoice({ ...editingVoice, style: e.target.value })}
                  placeholder="e.g., Direct and analytical. Asks tough questions. Data-driven."
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex justify-between">
              {voices.find(v => v.id === editingVoice.id) && editingVoice.id !== 'cameron' ? (
                <button onClick={() => {
                  const updated = voices.filter(v => v.id !== editingVoice.id)
                  saveVoices(updated)
                  if (selectedVoice === editingVoice.id) setSelectedVoice(null)
                  setEditingVoice(null)
                }} className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              ) : <div />}
              <div className="flex gap-2">
                <button onClick={() => setEditingVoice(null)} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200">Cancel</button>
                <button onClick={() => {
                  const exists = voices.find(v => v.id === editingVoice.id)
                  const updated = exists ? voices.map(v => v.id === editingVoice.id ? editingVoice : v) : [...voices, editingVoice]
                  saveVoices(updated)
                  setEditingVoice(null)
                }} className="text-xs font-bold text-white bg-np-blue px-4 py-1.5 rounded-lg">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
