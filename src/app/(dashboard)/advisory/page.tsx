'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Brain, Users, User, Compass, Plus, X, Trash2, Loader2, Send, Upload,
  Sparkles, FileText, Mic, Video, MessageSquare, Settings, Wand2,
  Route, Rocket, Megaphone, Target, Mail, BookOpen,
  Image as ImageIcon, Star, Pin, Search, Tag, Share2, Clock,
  Hash, MoreVertical, ChevronDown
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================
interface AdvisoryVoice {
  id: string; name: string; role: string; description: string; style: string
  color: string; avatar: string; knowledge: string; source_count: number; enabled: boolean
}
interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Conversation {
  id: string; org_id: string; user_id: string; user_name: string
  voice_id: string; title: string; messages: ChatMsg[]
  summary: string | null; key_insights: string[]; tags: string[]
  rating: number | null; is_pinned: boolean; is_shared: boolean
  is_archived: boolean; promoted_to_library: string | null
  message_count: number; created_at: string; updated_at: string
}

// ============================================================
// STABLE SUB-COMPONENTS (outside main component)
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

const ChatInput = ({ value, onChange, onSend, loading, placeholder }: {
  value: string; onChange: (v: string) => void; onSend: () => void; loading: boolean; placeholder: string
}) => (
  <div className="px-3 py-2.5 border-t border-gray-100 flex gap-2">
    <input value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
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

const StarRating = ({ rating, onChange, size = 'sm' }: { rating: number | null; onChange: (r: number) => void; size?: 'sm' | 'md' }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map(star => (
      <button key={star} onClick={(e) => { e.stopPropagation(); onChange(star) }} className={size === 'md' ? 'p-0.5' : ''}>
        <Star className={`${size === 'md' ? 'w-4 h-4' : 'w-3 h-3'} ${
          (rating || 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-gray-200 hover:text-amber-300'
        }`} />
      </button>
    ))}
  </div>
)

// ============================================================
// CONSTANTS
// ============================================================
const HUB_MAP = `NPU HUB FEATURE MAP:\nJOURNEY BUILDER (/journeys) - Visual customer journey with paths and cards.\nTASK MANAGER (/tasks) - Kanban board.\nSHIPIT JOURNAL (/shipit) - Shipping framework.\nCAMPAIGNS (/campaigns) - 11-phase marketing pipeline.\nSOCIAL MEDIA (/social) - 3-panel AI designer.\nSETTINGS (/settings) - Brand identity, voice.\nINTEGRATIONS (/integrations) - Google, Gmail, Slack.\nTEAM (/team) - Members, roles, permissions.\nSOPs (/sops) - Standard operating procedures.\nCRM (/crm) - Full CRM with contacts, pipelines, dialer, messages, sequences.\nAI ADVISORY (/advisory) - This page.`

const DEFAULT_VOICES: AdvisoryVoice[] = [
  { id: 'cameron', name: 'Cameron Allen', role: 'Founder & CEO', description: 'My own perspective, trained from my conversations.', style: 'Direct, warm, capacity-focused. No em dashes.', color: '#386797', avatar: 'CA', knowledge: '', source_count: 0, enabled: true },
  { id: 'advisor-1', name: 'Advisory Board', role: 'Strategic Advisors', description: 'Collective wisdom from advisory board meetings.', style: 'Strategic, asks clarifying questions.', color: '#8B5CF6', avatar: 'AB', knowledge: '', source_count: 0, enabled: true },
]

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function AdvisoryPage() {
  const { user, currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()
  const [tab, setTab] = useState<'voices' | 'cameron' | 'guide'>('guide')

  // Voices
  const [voices, setVoices] = useState<AdvisoryVoice[]>(DEFAULT_VOICES)
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null)
  const [editingVoice, setEditingVoice] = useState<AdvisoryVoice | null>(null)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null)
  const [uploadText, setUploadText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [gdocUrl, setGdocUrl] = useState('')
  const [modalFiles, setModalFiles] = useState<{ name: string; type: string; preview?: string }[]>([])
  const modalFileRef = useRef<HTMLInputElement>(null)

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Conversation history
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null)
  const [convoSearch, setConvoSearch] = useState('')
  const [convoFilter, setConvoFilter] = useState<'all' | 'pinned' | 'rated' | 'shared'>('all')
  const [showConvoMenu, setShowConvoMenu] = useState<string | null>(null)
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [promotingToLibrary, setPromotingToLibrary] = useState(false)

  // Cameron knowledge panel
  const [uploadFiles, setUploadFiles] = useState<{ name: string; type: string; preview?: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── Load voices ──
  useEffect(() => {
    if (!currentOrg) return
    const load = async () => {
      const { data } = await supabase.from('brand_profiles').select('guidelines')
        .eq('org_id', currentOrg.id).eq('brand_key', 'np').single()
      if (data?.guidelines?.advisory_voices) setVoices(data.guidelines.advisory_voices)
    }
    load()
  }, [currentOrg])

  // ── Load conversations for current tab/voice ──
  const loadConversations = useCallback(async () => {
    if (!currentOrg || !user) return
    const vid = tab === 'cameron' ? 'cameron' : tab === 'guide' ? 'guide' : selectedVoice || ''
    if (!vid) return

    let query = supabase.from('ai_conversations').select('id,org_id,user_id,user_name,voice_id,title,summary,key_insights,tags,rating,is_pinned,is_shared,is_archived,promoted_to_library,message_count,created_at,updated_at')
      .eq('org_id', currentOrg.id).eq('voice_id', vid).eq('is_archived', false)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })

    if (convoFilter === 'pinned') query = query.eq('is_pinned', true)
    if (convoFilter === 'rated') query = query.not('rating', 'is', null)
    if (convoFilter === 'shared') query = query.eq('is_shared', true)
    if (convoSearch.trim()) query = query.or(`title.ilike.%${convoSearch}%,summary.ilike.%${convoSearch}%`)

    const { data } = await query.limit(50)
    setConversations((data || []).map(d => ({ ...d, messages: [] })) as Conversation[])
  }, [currentOrg?.id, user?.id, tab, selectedVoice, convoFilter, convoSearch])

  useEffect(() => { loadConversations() }, [loadConversations])

  // ── Save voices ──
  const saveVoices = useCallback(async (newVoices: AdvisoryVoice[]) => {
    if (!currentOrg) return
    const { data: existing } = await supabase.from('brand_profiles').select('guidelines')
      .eq('org_id', currentOrg.id).eq('brand_key', 'np').single()
    await supabase.from('brand_profiles')
      .update({ guidelines: { ...(existing?.guidelines || {}), advisory_voices: newVoices } })
      .eq('org_id', currentOrg.id).eq('brand_key', 'np')
    setVoices(newVoices)
  }, [currentOrg, supabase])

  // ── Scroll chat ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  // ── Close menu on outside click ──
  useEffect(() => {
    const handler = () => setShowConvoMenu(null)
    if (showConvoMenu) document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showConvoMenu])

  // ════════════════════════════════════════════
  // CONVERSATION MANAGEMENT
  // ════════════════════════════════════════════
  const createConversation = async (voiceId: string, firstMsg: string): Promise<string | null> => {
    if (!currentOrg || !user) return null
    const title = firstMsg.slice(0, 80) + (firstMsg.length > 80 ? '...' : '')
    const { data } = await supabase.from('ai_conversations').insert({
      org_id: currentOrg.id, user_id: user.id,
      user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      voice_id: voiceId, title, messages: [], message_count: 0,
    }).select().single()
    if (data) {
      setConversations(prev => [{ ...data, messages: [] } as Conversation, ...prev])
      setActiveConvoId(data.id)
      return data.id
    }
    return null
  }

  const saveMessages = async (convoId: string, msgs: ChatMsg[]) => {
    await supabase.from('ai_conversations').update({ messages: msgs, message_count: msgs.length }).eq('id', convoId)
  }

  const updateConversation = async (convoId: string, updates: Partial<Conversation>) => {
    await supabase.from('ai_conversations').update(updates).eq('id', convoId)
    setConversations(prev => prev.map(c => c.id === convoId ? { ...c, ...updates } as Conversation : c))
  }

  const deleteConversation = async (convoId: string) => {
    await supabase.from('ai_conversations').delete().eq('id', convoId)
    setConversations(prev => prev.filter(c => c.id !== convoId))
    if (activeConvoId === convoId) { setActiveConvoId(null); setChatMessages([]) }
  }

  const loadConversation = async (convo: Conversation) => {
    setActiveConvoId(convo.id)
    // Fetch full messages
    const { data } = await supabase.from('ai_conversations').select('messages').eq('id', convo.id).single()
    const msgs = (data?.messages || []) as ChatMsg[]
    setChatMessages(msgs)
    setConversations(prev => prev.map(c => c.id === convo.id ? { ...c, messages: msgs } : c))
  }

  const startNewConversation = () => {
    setActiveConvoId(null)
    setChatMessages([])
    setChatInput('')
  }

  // ════════════════════════════════════════════
  // AI SEND (with auto-save)
  // ════════════════════════════════════════════
  const sendToAI = async (systemPrompt: string, voiceId: string) => {
    if (!chatInput.trim()) return
    const userMsg = chatInput.trim()
    let convoId = activeConvoId
    if (!convoId) {
      convoId = await createConversation(voiceId, userMsg)
      if (!convoId) return
    }

    const newMsgs: ChatMsg[] = [...chatMessages, { role: 'user', content: userMsg }]
    setChatMessages(newMsgs)
    setChatInput('')
    setChatLoading(true)
    saveMessages(convoId, newMsgs)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMsgs, campaignContext: { type: 'advisory', systemOverride: systemPrompt } }),
      })
      const data = await res.json()
      const reply = (data.content || 'No response.').replace(/\*\*/g, '').replace(/\u2014/g, ', ').replace(/\u2013/g, ', ').trim()
      const withReply: ChatMsg[] = [...newMsgs, { role: 'assistant', content: reply }]
      setChatMessages(withReply)
      saveMessages(convoId, withReply)
      setConversations(prev => prev.map(c =>
        c.id === convoId ? { ...c, message_count: withReply.length, updated_at: new Date().toISOString() } : c
      ))
    } catch {
      const errMsgs: ChatMsg[] = [...newMsgs, { role: 'assistant', content: 'Connection error. Try again.' }]
      setChatMessages(errMsgs)
      saveMessages(convoId, errMsgs)
    }
    setChatLoading(false)
  }

  const sendChat = () => {
    const voiceId = tab === 'cameron' ? 'cameron' : tab === 'guide' ? 'guide' : selectedVoice || ''
    let sys = ''
    if (tab === 'guide') {
      sys = `You are the NPU Hub Guide.\n\n${HUB_MAP}\n\nBe concise. Step-by-step instructions. No em dashes.`
    } else if (tab === 'cameron') {
      const cam = voices.find(v => v.id === 'cameron')
      sys = `You are Cameron Allen, founder of Neuro Progeny.\n\nStyle: Direct, warm. Biological framing. No em dashes. Capacity over pathology.\nBeliefs: All behavior is adaptive. HRV is a mirror. Train state fluidity. VR is feedback amplifier.\n\n${cam?.knowledge ? `KNOWLEDGE:\n${cam.knowledge}` : ''}\n\nAnswer as Cameron would.`
    } else if (selectedVoice) {
      const v = voices.find(v => v.id === selectedVoice)
      if (v) sys = `You are ${v.name}, ${v.role}. ${v.description}\nStyle: ${v.style}\n${v.knowledge ? `KNOWLEDGE:\n${v.knowledge}` : ''}\nStay in character.`
    }
    if (sys) sendToAI(sys, voiceId)
  }

  // ════════════════════════════════════════════
  // AI SUMMARY + INSIGHTS
  // ════════════════════════════════════════════
  const generateSummary = async (convoId: string) => {
    // Get full messages
    const { data: convoData } = await supabase.from('ai_conversations').select('messages,title').eq('id', convoId).single()
    const msgs = (convoData?.messages || []) as ChatMsg[]
    if (msgs.length < 2) return
    setGeneratingSummary(true)

    try {
      const transcript = msgs.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n\n')
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Analyze this conversation. Return ONLY valid JSON, no markdown:\n{"summary":"2-3 sentence summary","insights":["insight 1","insight 2","insight 3"],"tags":["tag1","tag2"]}\n\nConversation:\n${transcript.slice(0, 20000)}` }],
          campaignContext: { type: 'analysis', systemOverride: 'Extract summary, insights, tags. Return ONLY valid JSON.' },
        }),
      })
      const data = await res.json()
      let content = (data.content || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(content)
      await updateConversation(convoId, {
        summary: parsed.summary || null,
        key_insights: parsed.insights || [],
        tags: parsed.tags || [],
      } as any)
    } catch {}
    setGeneratingSummary(false)
  }

  // ════════════════════════════════════════════
  // PROMOTE TO LIBRARY
  // ════════════════════════════════════════════
  const promoteToLibrary = async (convoId: string) => {
    if (!currentOrg || !user) return
    setPromotingToLibrary(true)

    // Get full conversation
    const { data: convoData } = await supabase.from('ai_conversations').select('*').eq('id', convoId).single()
    if (!convoData) { setPromotingToLibrary(false); return }
    const convo = convoData as Conversation

    // Generate summary if missing
    if (!convo.summary) await generateSummary(convoId)
    // Refetch after summary
    const { data: refreshed } = await supabase.from('ai_conversations').select('*').eq('id', convoId).single()
    const final = (refreshed || convo) as Conversation

    const transcript = (final.messages as ChatMsg[]).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n\n')

    const { data: libItem } = await supabase.from('company_library').insert({
      org_id: currentOrg.id, title: final.title,
      description: final.summary || 'AI advisory conversation',
      category: 'ai-conversation', content_type: 'conversation', content: transcript,
      summary: final.summary, key_insights: final.key_insights || [],
      tags: [...(final.tags || []), 'ai-conversation', final.voice_id],
      source_type: 'ai_conversation', source_id: convoId,
      author_name: final.user_name, rating: final.rating, created_by: user.id,
    }).select().single()

    if (libItem) {
      await updateConversation(convoId, { promoted_to_library: libItem.id } as any)
    }
    setPromotingToLibrary(false)
  }

  // ════════════════════════════════════════════
  // KNOWLEDGE EXTRACTION
  // ════════════════════════════════════════════
  const extractKnowledge = async (voiceId: string, rawText: string, sourceName: string) => {
    setExtracting(true)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Extract key insights, decisions, perspectives from:\nSource: ${sourceName}\n\n${rawText.slice(0, 30000)}` }],
          campaignContext: { type: 'knowledge_extraction', systemOverride: 'Extract and organize key insights, decisions, advice patterns. Return structured knowledge.' },
        }),
      })
      const data = await res.json()
      const extracted = (data.content || '').replace(/\*\*/g, '').replace(/\u2014/g, ', ').trim()
      if (extracted) {
        const updated = voices.map(v => v.id === voiceId
          ? { ...v, knowledge: (v.knowledge ? v.knowledge + '\n\n---\n\n' : '') + `[Source: ${sourceName}]\n${extracted}`, source_count: v.source_count + 1 }
          : v)
        await saveVoices(updated)
      }
    } catch {}
    setExtracting(false); setUploadingTo(null); setUploadText('')
  }

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          setUploadText(prev => prev + (prev ? '\n\n' : '') + (e.target?.result as string))
          setUploadFiles(prev => [...prev, { name: file.name, type: 'document' }])
        }
        reader.readAsText(file)
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const reader = new FileReader()
        reader.onload = async (e) => {
          const base64 = e.target?.result as string
          setUploadFiles(prev => [...prev, { name: file.name, type: 'pdf' }])
          setExtracting(true)
          try {
            const res = await fetch('/api/ai', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [{ role: 'user', content: [
                  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64.split(',')[1] } },
                  { type: 'text', text: 'Extract all text content from this PDF.' }
                ] }],
                campaignContext: { type: 'pdf_extraction', systemOverride: 'Extract all text. Return full content.' },
              }),
            })
            const data = await res.json()
            if (data.content) setUploadText(prev => prev + (prev ? '\n\n' : '') + data.content.trim())
          } catch {}
          setExtracting(false)
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const fetchGoogleDoc = async (url: string, targetVoiceId: string) => {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (!match) return
    setExtracting(true)
    try {
      const res = await fetch('/api/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: currentOrg?.id, action: 'getDocContent', docId: match[1] }),
      })
      const data = await res.json()
      if (data.content) {
        setUploadText(prev => prev + (prev ? '\n\n' : '') + data.content)
        setUploadFiles(prev => [...prev, { name: 'Google Doc', type: 'gdoc' }])
      }
    } catch {}
    setExtracting(false); setGdocUrl('')
  }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════
  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  const activeConvo = conversations.find(c => c.id === activeConvoId) || null
  const cameron = voices.find(v => v.id === 'cameron')
  const cameronSources = (cameron?.knowledge || '').split('\n\n---\n\n').filter(Boolean)

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">AI Advisory</h1>
          <p className="text-xs text-gray-400 mt-0.5">Advisory voices, Cameron AI, and platform guide</p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {([['guide', Compass, 'Hub Guide'], ['cameron', User, 'Cameron AI'], ['voices', Users, 'Board Voices']] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => { setTab(k); setActiveConvoId(null); setChatMessages([]); setChatInput('') }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === k ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex-1 flex gap-3 min-h-0">

        {/* ════ LEFT: Conversation Sidebar ════ */}
        <div className="w-64 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 space-y-2">
            <button onClick={startNewConversation}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-[10px] font-bold hover:bg-np-blue/90">
              <Plus className="w-3 h-3" /> New Conversation
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input value={convoSearch} onChange={e => setConvoSearch(e.target.value)} placeholder="Search conversations..."
                className="w-full pl-7 pr-2 py-1.5 text-[10px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div className="flex gap-1">
              {(['all', 'pinned', 'rated', 'shared'] as const).map(f => (
                <button key={f} onClick={() => setConvoFilter(f)}
                  className={`text-[8px] font-bold uppercase px-2 py-1 rounded-md transition-colors ${
                    convoFilter === f ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600'
                  }`}>{f}</button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="w-6 h-6 text-gray-200 mx-auto mb-2" />
                <p className="text-[10px] text-gray-400">No conversations yet</p>
                <p className="text-[8px] text-gray-300 mt-0.5">Start chatting to save history</p>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                {conversations.map(convo => (
                  <div key={convo.id} onClick={() => loadConversation(convo)}
                    className={`relative px-2.5 py-2 rounded-xl cursor-pointer group transition-all ${
                      activeConvoId === convo.id ? 'bg-np-blue/5 border border-np-blue/20' : 'hover:bg-gray-50 border border-transparent'
                    }`}>
                    <div className="flex items-start gap-1.5 pr-6">
                      {convo.is_pinned && <Pin className="w-2.5 h-2.5 text-amber-500 flex-shrink-0 mt-0.5 fill-amber-500" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-np-dark truncate">{convo.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[8px] text-gray-400">{convo.message_count} msgs</span>
                          {convo.rating && <StarRating rating={convo.rating} onChange={() => {}} />}
                          {convo.promoted_to_library && <BookOpen className="w-2.5 h-2.5 text-green-500" />}
                          {convo.is_shared && <Share2 className="w-2.5 h-2.5 text-purple-400" />}
                        </div>
                        {convo.tags && convo.tags.length > 0 && (
                          <div className="flex gap-0.5 mt-0.5 flex-wrap">
                            {convo.tags.slice(0, 3).map(t => (
                              <span key={t} className="text-[7px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[7px] text-gray-300 absolute top-2 right-2">
                      {new Date(convo.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>

                    {/* Context menu */}
                    <button onClick={e => { e.stopPropagation(); setShowConvoMenu(showConvoMenu === convo.id ? null : convo.id) }}
                      className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 p-0.5">
                      <MoreVertical className="w-3 h-3" />
                    </button>
                    {showConvoMenu === convo.id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-xl py-1"
                        onClick={e => e.stopPropagation()}>
                        <button onClick={() => { updateConversation(convo.id, { is_pinned: !convo.is_pinned } as any); setShowConvoMenu(null) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50">
                          <Pin className="w-3 h-3" /> {convo.is_pinned ? 'Unpin' : 'Pin to Top'}
                        </button>
                        <button onClick={() => { updateConversation(convo.id, { is_shared: !convo.is_shared } as any); setShowConvoMenu(null) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50">
                          <Share2 className="w-3 h-3" /> {convo.is_shared ? 'Make Private' : 'Share with Team'}
                        </button>
                        <button onClick={() => { generateSummary(convo.id); setShowConvoMenu(null) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50">
                          <Sparkles className="w-3 h-3" /> Generate Summary
                        </button>
                        <button onClick={() => { promoteToLibrary(convo.id); setShowConvoMenu(null) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-green-600 hover:bg-green-50">
                          <BookOpen className="w-3 h-3" /> Promote to Library
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        <button onClick={() => { if (confirm('Delete this conversation?')) { deleteConversation(convo.id); setShowConvoMenu(null) } }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50">
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ════ CENTER: Chat ════ */}
        <div className="flex-1 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {tab === 'guide' && (
                <><div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center"><Compass className="w-4 h-4 text-white" /></div>
                <div><h2 className="text-sm font-bold text-np-dark">Hub Guide</h2><p className="text-[10px] text-gray-400 truncate max-w-[200px]">{activeConvo?.title || 'New conversation'}</p></div></>
              )}
              {tab === 'cameron' && (
                <><div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#386797] to-[#2a4f73] flex items-center justify-center text-white text-xs font-bold">CA</div>
                <div><h2 className="text-sm font-bold text-np-dark">Cameron AI</h2><p className="text-[10px] text-gray-400 truncate max-w-[200px]">{activeConvo?.title || 'New conversation'}</p></div></>
              )}
              {tab === 'voices' && selectedVoice && (() => {
                const v = voices.find(v => v.id === selectedVoice)
                return v ? (
                  <><div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: v.color }}>{v.avatar}</div>
                  <div><h2 className="text-sm font-bold text-np-dark">{v.name}</h2><p className="text-[10px] text-gray-400 truncate max-w-[200px]">{activeConvo?.title || 'New conversation'}</p></div></>
                ) : null
              })()}
            </div>

            {/* Actions */}
            {activeConvo && (
              <div className="flex items-center gap-2">
                <StarRating rating={activeConvo.rating} size="md"
                  onChange={r => updateConversation(activeConvo.id, { rating: r } as any)} />
                <button onClick={() => setShowTagInput(!showTagInput)}
                  className={`p-1.5 rounded-lg transition-colors ${showTagInput ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}>
                  <Tag className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => promoteToLibrary(activeConvo.id)}
                  disabled={!!activeConvo.promoted_to_library || promotingToLibrary}
                  className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                    activeConvo.promoted_to_library
                      ? 'bg-green-50 border-green-200 text-green-600'
                      : 'border-gray-200 text-gray-500 hover:text-green-600 hover:border-green-200 hover:bg-green-50'
                  }`}>
                  {promotingToLibrary ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                  {activeConvo.promoted_to_library ? 'In Library' : 'Library'}
                </button>
              </div>
            )}
          </div>

          {/* Tag bar */}
          {showTagInput && activeConvo && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap bg-gray-50/50">
              {(activeConvo.tags || []).map(tag => (
                <span key={tag} className="flex items-center gap-1 text-[9px] bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                  <Hash className="w-2.5 h-2.5" />{tag}
                  <button onClick={() => updateConversation(activeConvo.id, { tags: (activeConvo.tags || []).filter(t => t !== tag) } as any)}
                    className="text-gray-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              <input value={newTag} onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    updateConversation(activeConvo.id, { tags: [...(activeConvo.tags || []), newTag.trim().toLowerCase()] } as any)
                    setNewTag('')
                  }
                }}
                placeholder="Add tag..." className="text-[10px] border-none bg-transparent focus:outline-none placeholder-gray-300 w-20" />
              <button onClick={() => generateSummary(activeConvo.id)} disabled={generatingSummary}
                className="flex items-center gap-1 text-[9px] text-purple-500 hover:text-purple-700 ml-auto font-medium">
                {generatingSummary ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                Auto-tag
              </button>
            </div>
          )}

          {/* Summary */}
          {activeConvo?.summary && (
            <div className="px-4 py-2 bg-amber-50/50 border-b border-amber-100/50">
              <p className="text-[10px] text-amber-700 leading-relaxed">{activeConvo.summary}</p>
              {activeConvo.key_insights && activeConvo.key_insights.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {activeConvo.key_insights.map((ins, i) => (
                    <span key={i} className="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">{ins}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {chatMessages.length === 0 && (
              <div className="py-6">
                <p className="text-xs text-gray-400 text-center mb-4">
                  {tab === 'guide' ? 'What would you like to do?' : tab === 'cameron' ? "Ask me anything. I'll answer as Cameron would." : selectedVoice ? `Chat with ${voices.find(v => v.id === selectedVoice)?.name}.` : 'Select a voice to start.'}
                </p>
                {tab === 'guide' && <QuickPrompts prompts={['How do I build a customer journey?', 'How do I send resources to someone?', 'Walk me through creating a campaign', 'Where do I set up integrations?']} onSelect={setChatInput} />}
                {tab === 'cameron' && <QuickPrompts prompts={['How would Cameron handle a participant who wants to quit?', "What are Cameron's priorities for Q1?", 'How does Cameron think about pricing?', 'What would Cameron say about a new feature?']} onSelect={setChatInput} />}
              </div>
            )}
            {chatMessages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 text-np-blue animate-spin" />
                  <span className="text-[10px] text-gray-400">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <ChatInput value={chatInput} onChange={setChatInput} onSend={sendChat} loading={chatLoading}
            placeholder={tab === 'guide' ? 'Ask how to do anything...' : tab === 'cameron' ? 'Ask Cameron anything...' : `Ask ${voices.find(v => v.id === selectedVoice)?.name || 'advisor'}...`} />
        </div>

        {/* ════ RIGHT PANEL ════ */}
        {tab === 'cameron' && (
          <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-3.5 h-3.5 text-np-blue" />
                <h3 className="text-xs font-bold text-np-dark">Knowledge Feed</h3>
              </div>
              <span className="text-[9px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{cameron?.source_count || 0} sources</span>
            </div>
            <div className="px-3 py-2.5 border-b border-gray-100 space-y-2">
              <input id="cameron-source-name" placeholder="Source name..."
                className="w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              <div onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-xl px-3 py-2 text-center cursor-pointer hover:border-np-blue/40 transition-all">
                <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.pdf,.docx" onChange={e => handleFileUpload(e.target.files)} className="hidden" />
                <span className="text-[10px] text-gray-400">Drop files or click</span>
              </div>
              <div className="flex gap-1.5">
                <input value={gdocUrl} onChange={e => setGdocUrl(e.target.value)} placeholder="Google Doc URL..."
                  className="flex-1 text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-gray-300" />
                <button onClick={() => fetchGoogleDoc(gdocUrl, 'cameron')} disabled={!gdocUrl.includes('docs.google.com') || extracting}
                  className="text-[10px] font-bold text-np-blue px-2 py-1.5 rounded-lg border border-np-blue/20 disabled:opacity-30">
                  {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
                </button>
              </div>
              {uploadFiles.length > 0 && (
                <div className="flex flex-wrap gap-1">{uploadFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 text-[9px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                    <FileText className="w-2.5 h-2.5 text-gray-400" />{f.name}
                    <button onClick={() => setUploadFiles(prev => prev.filter((_, fi) => fi !== i))} className="text-gray-300 hover:text-red-400"><X className="w-2 h-2" /></button>
                  </span>
                ))}</div>
              )}
              <textarea value={uploadText} onChange={e => setUploadText(e.target.value)} placeholder="Paste transcript..."
                rows={3} className="w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-gray-300 resize-none font-mono" />
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-gray-400">{uploadText.length > 0 ? `${uploadText.length.toLocaleString()} chars` : ''}</span>
                <button onClick={() => {
                  const name = (document.getElementById('cameron-source-name') as HTMLInputElement)?.value || 'Untitled'
                  extractKnowledge('cameron', uploadText, name)
                }} disabled={extracting || !uploadText.trim()}
                  className="flex items-center gap-1 text-[10px] font-bold text-white bg-np-blue px-3 py-1.5 rounded-lg disabled:opacity-40">
                  {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Feed
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {cameronSources.length === 0 ? (
                <div className="text-center py-6"><Brain className="w-6 h-6 text-gray-200 mx-auto mb-2" /><p className="text-[10px] text-gray-400">No knowledge yet</p></div>
              ) : cameronSources.map((src, i) => {
                const lines = src.split('\n')
                const sl = lines.find(l => l.startsWith('[Source:'))
                const name = sl ? sl.replace('[Source: ', '').replace(']', '') : `Source ${i + 1}`
                const preview = lines.filter(l => !l.startsWith('[Source:') && !l.startsWith('[Visual')).join(' ').slice(0, 80)
                return (
                  <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 group">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-np-dark truncate">{name}</span>
                      <button onClick={() => {
                        const updated = voices.map(v => v.id === 'cameron' ? { ...v, knowledge: cameronSources.filter((_, si) => si !== i).join('\n\n---\n\n'), source_count: Math.max(0, v.source_count - 1) } : v)
                        saveVoices(updated)
                      }} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-2.5 h-2.5" /></button>
                    </div>
                    <p className="text-[8px] text-gray-500 line-clamp-2">{preview}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'voices' && (
          <div className="w-56 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-np-dark">Voices</h3>
              <button onClick={() => setEditingVoice({
                id: `voice-${Date.now()}`, name: 'New Advisor', role: 'Advisor', description: '', style: '',
                color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
                avatar: 'NA', knowledge: '', source_count: 0, enabled: true,
              })} className="text-np-blue hover:bg-np-blue/5 p-1 rounded"><Plus className="w-3 h-3" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {voices.filter(v => v.id !== 'cameron').map(voice => (
                <button key={voice.id} onClick={() => { setSelectedVoice(voice.id); setActiveConvoId(null); setChatMessages([]) }}
                  className={`w-full text-left p-2 rounded-xl transition-all ${
                    selectedVoice === voice.id ? 'bg-np-blue/5 border border-np-blue/20' : 'hover:bg-gray-50 border border-transparent'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[8px] font-bold" style={{ backgroundColor: voice.color }}>{voice.avatar}</div>
                    <div className="min-w-0"><div className="text-[10px] font-semibold text-np-dark truncate">{voice.name}</div><div className="text-[8px] text-gray-400">{voice.source_count} sources</div></div>
                  </div>
                </button>
              ))}
            </div>
            {selectedVoice && (
              <div className="px-3 py-2 border-t border-gray-100 flex gap-1.5">
                <button onClick={() => setUploadingTo(selectedVoice)}
                  className="flex-1 flex items-center justify-center gap-1 text-[9px] text-purple-600 font-medium py-1.5 rounded-lg border border-purple-200 hover:bg-purple-50">
                  <Upload className="w-3 h-3" /> Feed
                </button>
                <button onClick={() => setEditingVoice(voices.find(v => v.id === selectedVoice) || null)}
                  className="flex-1 flex items-center justify-center gap-1 text-[9px] text-gray-500 font-medium py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                  <Settings className="w-3 h-3" /> Edit
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════ UPLOAD MODAL ════ */}
      {uploadingTo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !extracting && setUploadingTo(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2"><Upload className="w-4 h-4 text-purple-500" /><h3 className="text-sm font-bold text-np-dark">Feed Knowledge</h3></div>
              <button onClick={() => !extracting && setUploadingTo(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Source Name</label>
                <input id="source-name" placeholder="e.g., Advisory Board Call" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none placeholder-gray-300" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Paste Text / Transcript</label>
                <textarea value={uploadText} onChange={e => setUploadText(e.target.value)} placeholder="Paste transcript..." rows={6}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none placeholder-gray-300 resize-none font-mono" /></div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => !extracting && setUploadingTo(null)} className="text-xs text-gray-500 px-4 py-2 rounded-lg border border-gray-200">Cancel</button>
              <button onClick={() => { const n = (document.getElementById('source-name') as HTMLInputElement)?.value || 'Untitled'; extractKnowledge(uploadingTo, uploadText, n) }}
                disabled={extracting || !uploadText.trim()}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-purple-600 px-4 py-2 rounded-lg disabled:opacity-40">
                {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {extracting ? 'Extracting...' : 'Extract Knowledge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ EDIT VOICE MODAL ════ */}
      {editingVoice && !uploadingTo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditingVoice(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-np-dark">{voices.find(v => v.id === editingVoice.id) ? 'Edit Voice' : 'New Voice'}</h3>
              <button onClick={() => setEditingVoice(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Name</label>
                  <input value={editingVoice.name} onChange={e => setEditingVoice({ ...editingVoice, name: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
                <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Role</label>
                  <input value={editingVoice.role} onChange={e => setEditingVoice({ ...editingVoice, role: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Initials</label>
                  <input value={editingVoice.avatar} onChange={e => setEditingVoice({ ...editingVoice, avatar: e.target.value.slice(0, 2).toUpperCase() })} maxLength={2} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
                <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Color</label>
                  <input type="color" value={editingVoice.color} onChange={e => setEditingVoice({ ...editingVoice, color: e.target.value })} className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" /></div>
              </div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Description</label>
                <textarea value={editingVoice.description} onChange={e => setEditingVoice({ ...editingVoice, description: e.target.value })} rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Style</label>
                <input value={editingVoice.style} onChange={e => setEditingVoice({ ...editingVoice, style: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-between">
              {voices.find(v => v.id === editingVoice.id) && editingVoice.id !== 'cameron' ? (
                <button onClick={() => { saveVoices(voices.filter(v => v.id !== editingVoice.id)); if (selectedVoice === editingVoice.id) setSelectedVoice(null); setEditingVoice(null) }}
                  className="text-[10px] text-red-400 flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
              ) : <div />}
              <div className="flex gap-2">
                <button onClick={() => setEditingVoice(null)} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200">Cancel</button>
                <button onClick={() => {
                  const exists = voices.find(v => v.id === editingVoice.id)
                  saveVoices(exists ? voices.map(v => v.id === editingVoice.id ? editingVoice : v) : [...voices, editingVoice])
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
