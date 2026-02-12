'use client'

import { useState, useRef, useEffect } from 'react'
import { useSocialData } from '@/lib/hooks/use-social-data'
import type { SocialPost, PlatformFormat } from '@/lib/hooks/use-social-data'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { Plus, Wand2, Send, Clock, Archive, Edit3, Trash2, Hash, Eye, Sparkles, X, Bot, Loader2, Copy, Check, Film, Image, FileText, Video } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: '📸' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: '📘' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: '💼' },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: '🎵' },
  { key: 'x', label: 'X (Twitter)', color: '#1DA1F2', icon: '𝕏' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: '📺' },
]

const CONTENT_FORMATS = [
  { key: 'static', label: 'Static Post', icon: '🖼️', desc: 'Image + caption' },
  { key: 'carousel', label: 'Carousel', icon: '📑', desc: 'Multi-slide post' },
  { key: 'reel', label: 'Reel / Short', icon: '🎬', desc: 'Vertical video 15-90s' },
  { key: 'video', label: 'Long Video', icon: '🎥', desc: 'YouTube / LinkedIn video' },
  { key: 'story', label: 'Story', icon: '⏳', desc: '24hr ephemeral content' },
  { key: 'text', label: 'Text Only', icon: '📝', desc: 'No media needed' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  scheduled: { label: 'Scheduled', color: '#3B82F6', bg: '#DBEAFE' },
  published: { label: 'Published', color: '#10B981', bg: '#D1FAE5' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
}

interface AIMessage {
  role: 'ai' | 'user'
  content: string
  options?: string[]
  generated?: GeneratedContent[]
}

interface GeneratedContent {
  platform: string
  format: string
  caption: string
  imageDirection?: string
  videoScript?: string
  carouselSlides?: string[]
  hashtags: string[]
  hook?: string
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { posts, formats, loading, addPost, updatePost, deletePost } = useSocialData()
  const supabase = createClient()

  const [creating, setCreating] = useState(false)
  const [content, setContent] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram', 'linkedin'])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [selectedContentFormat, setSelectedContentFormat] = useState('static')
  const [brand, setBrand] = useState<string>('np')
  const [hashtags, setHashtags] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [saving, setSaving] = useState(false)

  // AI state
  const [aiMode, setAiMode] = useState(false)
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key])
  }

  const handleCreate = async () => {
    if (!content.trim()) return
    setSaving(true)
    const platformVersions = selectedPlatforms.map(p => ({
      platform: p, content: content.trim(),
      formats: formats.filter(f => f.platform === p && selectedFormats.includes(f.id)).map(f => ({ id: f.id, name: f.format_name, width: f.width, height: f.height })),
    }))
    await addPost({ brand, content_original: content.trim(), platform_versions: platformVersions, hashtags: hashtags.split(',').map(h => h.trim().replace(/^#/, '')).filter(Boolean), status: 'draft' })
    setSaving(false)
    setContent(''); setHashtags(''); setCreating(false)
  }

  // ─── AI CONTENT GENERATOR (Claude API) ───

  const fetchBrandSettings = async () => {
    if (!currentOrg) return null
    const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', 'np').single()
    if (data) return { vocabulary_use: data.vocabulary_use || [], vocabulary_avoid: data.vocabulary_avoid || [], voice_description: data.voice_description || '', ...(data.guidelines || {}) }
    return null
  }

  const startAI = () => {
    setAiMode(true)
    setAiMessages([
      { role: 'ai', content: "I'm your Social Content AI. I create platform-specific content with image direction, video scripts, and carousel breakdowns.\n\nWhat type of content are you creating?", options: ['Static Post (Image + Caption)', 'Reel / Short Video', 'Carousel / Multi-Slide', 'Long-Form Video', 'Story Content', 'Full Campaign Bundle (all formats)'] },
    ])
  }

  const sendToAI = async (userMessage: string) => {
    const newMessages: AIMessage[] = [...aiMessages, { role: 'user', content: userMessage }]
    setAiMessages(newMessages)
    setAiInput('')
    setAiGenerating(true)

    try {
      const brandSettings = await fetchBrandSettings()
      const apiMessages = newMessages.filter(m => m.content.trim()).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages, brandSettings,
          campaignContext: { type: 'social_content_generation', systemOverride: `You are a world-class social media content strategist for Neuro Progeny. You create platform-specific content with detailed creative direction.

BRAND RULES (CRITICAL):
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV)
- All behavior is adaptive. Nothing is broken. No em dashes.
- Questions orient forward, never backward into past failure

When you have enough context (content type, topic, platforms), generate content using this JSON format wrapped in \`\`\`json ... \`\`\`:

{
  "content": [
    {
      "platform": "instagram",
      "format": "reel|static|carousel|video|story|text",
      "caption": "Full post caption",
      "hook": "First line scroll-stopping hook",
      "imageDirection": "Detailed image description: composition, colors, mood, text overlays, style. Specific enough for a designer or AI image generator.",
      "videoScript": "Full script with timing: Hook (0-3s), Setup (3-10s), Value (10-45s), CTA (45-60s). Include on-screen text, b-roll ideas, transitions, audio suggestions.",
      "carouselSlides": ["Slide 1: Cover with bold text...", "Slide 2: Problem...", "Slide 3: Insight..."],
      "hashtags": ["NervousSystem", "CapacityTraining"]
    }
  ]
}

FORMAT RULES:
- Static: Always include imageDirection
- Reel/Short: Always include videoScript with timing and on-screen text
- Carousel: Always include carouselSlides (5-10 slides) with text overlay + visual direction
- Long Video: Full videoScript with sections, b-roll notes, talking points
- Story: imageDirection + short caption
- Full Bundle: One of each format

Adapt tone per platform. Instagram = visual hooks. LinkedIn = authority. TikTok = pattern interrupts. X = punchy. YouTube = depth.
Ask 2-3 clarifying questions if needed. Once ready, generate immediately.` },
        }),
      })

      const data = await res.json()
      if (data.error) {
        setAiMessages([...newMessages, { role: 'ai', content: `Error: ${data.error}\n\nMake sure ANTHROPIC_API_KEY is set in Vercel.` }])
      } else {
        const aiResponse = data.content
        const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)```/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            const generated: GeneratedContent[] = parsed.content || []
            const textBefore = aiResponse.split('```json')[0].trim()
            setAiMessages([...newMessages, {
              role: 'ai', content: textBefore || "Here's your content. Expand any card to see image direction, video scripts, or carousel slides:", generated,
              options: ['Save All as Drafts', 'Regenerate', 'Different Angle', 'Add More Platforms', 'Create Another'],
            }])
          } catch { setAiMessages([...newMessages, { role: 'ai', content: aiResponse }]) }
        } else {
          setAiMessages([...newMessages, { role: 'ai', content: aiResponse }])
        }
      }
    } catch (err: any) {
      setAiMessages([...newMessages, { role: 'ai', content: `Connection error: ${err.message}` }])
    }
    setAiGenerating(false)
  }

  const handleAIAction = async (action: string) => {
    if (action === 'Save All as Drafts') {
      const lastGenerated = [...aiMessages].reverse().find(m => m.generated)?.generated
      if (!lastGenerated) return
      setSaving(true)
      for (const item of lastGenerated) {
        await addPost({
          brand: 'np', content_original: item.caption,
          platform_versions: [{ platform: item.platform, content: item.caption, formats: [] }],
          hashtags: item.hashtags || [], status: 'draft',
        })
      }
      setSaving(false)
      setAiMessages(prev => [...prev, { role: 'ai', content: `Saved ${lastGenerated.length} posts as drafts!` }])
    } else if (action === 'Create Another') { startAI() }
    else { sendToAI(action) }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000)
  }

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading social...</div></div>

  const filteredPosts = statusFilter === 'all' ? posts : posts.filter(p => p.status === statusFilter)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {posts.length} posts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New Post
          </button>
          <button onClick={startAI} className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
            <Wand2 className="w-3.5 h-3.5" /> AI Content Generator
          </button>
        </div>
      </div>

      {/* ═══ AI MODAL ═══ */}
      {aiMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAiMode(false)} />
          <div className="relative w-full max-w-3xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-np-blue">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-white" />
                <span className="text-sm font-bold text-white">AI Content Generator</span>
                <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full text-white">Posts, Reels, Videos, Carousels</span>
              </div>
              <button onClick={() => setAiMode(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4 text-white" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] ${msg.role === 'user' ? 'bg-np-blue text-white rounded-2xl rounded-br-sm' : 'bg-gray-50 text-np-dark rounded-2xl rounded-bl-sm'} px-4 py-3`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {msg.options && msg.role === 'ai' && i === aiMessages.length - 1 && !msg.generated && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.options.map(opt => (
                          <button key={opt} onClick={() => ['Save All as Drafts', 'Create Another'].includes(opt) ? handleAIAction(opt) : sendToAI(opt)}
                            className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 bg-white text-np-dark hover:bg-np-blue hover:text-white hover:border-np-blue transition-all font-medium">
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    {msg.generated && msg.generated.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.generated.map((item, idx) => {
                          const plat = PLATFORMS.find(p => p.key === item.platform)
                          const fmt = CONTENT_FORMATS.find(f => f.key === item.format)
                          const cardId = `${i}-${idx}`
                          const isExpanded = expandedCard === cardId
                          return (
                            <div key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                              <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedCard(isExpanded ? null : cardId)}>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{plat?.icon}</span>
                                  <span className="text-xs font-bold text-np-dark">{plat?.label}</span>
                                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-bold">{fmt?.icon} {fmt?.label || item.format}</span>
                                  {item.imageDirection && <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">🖼️ Image</span>}
                                  {item.videoScript && <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">🎬 Script</span>}
                                  {item.carouselSlides && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">📑 {item.carouselSlides.length} slides</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={e => { e.stopPropagation(); copyToClipboard(item.caption, cardId) }}
                                    className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 font-medium">
                                    {copiedId === cardId ? <><Check className="w-3 h-3 text-green-500" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                                  </button>
                                  <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                              </div>
                              {item.hook && <div className="px-3 pb-1"><span className="text-[9px] font-bold text-orange-500 uppercase">Hook: </span><span className="text-[10px] text-gray-600">{item.hook}</span></div>}
                              <div className="px-3 pb-2"><p className={`text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed ${isExpanded ? '' : 'line-clamp-3'}`}>{item.caption}</p></div>
                              {isExpanded && (
                                <div className="border-t border-gray-100 px-3 py-3 space-y-3">
                                  {item.imageDirection && (
                                    <div className="bg-blue-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-1.5">
                                        <Image className="w-3.5 h-3.5 text-blue-500" />
                                        <span className="text-[10px] font-bold text-blue-600 uppercase">Image Direction</span>
                                        <button onClick={() => copyToClipboard(item.imageDirection!, `img-${cardId}`)} className="ml-auto text-[9px] text-blue-400 hover:text-blue-600">{copiedId === `img-${cardId}` ? 'Copied!' : 'Copy'}</button>
                                      </div>
                                      <p className="text-[11px] text-blue-800 leading-relaxed">{item.imageDirection}</p>
                                    </div>
                                  )}
                                  {item.videoScript && (
                                    <div className="bg-red-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-1.5">
                                        <Film className="w-3.5 h-3.5 text-red-500" />
                                        <span className="text-[10px] font-bold text-red-600 uppercase">Video Script</span>
                                        <button onClick={() => copyToClipboard(item.videoScript!, `vid-${cardId}`)} className="ml-auto text-[9px] text-red-400 hover:text-red-600">{copiedId === `vid-${cardId}` ? 'Copied!' : 'Copy'}</button>
                                      </div>
                                      <p className="text-[11px] text-red-800 leading-relaxed whitespace-pre-wrap">{item.videoScript}</p>
                                    </div>
                                  )}
                                  {item.carouselSlides && item.carouselSlides.length > 0 && (
                                    <div className="bg-purple-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <FileText className="w-3.5 h-3.5 text-purple-500" />
                                        <span className="text-[10px] font-bold text-purple-600 uppercase">Carousel Slides ({item.carouselSlides.length})</span>
                                        <button onClick={() => copyToClipboard(item.carouselSlides!.join('\n\n'), `car-${cardId}`)} className="ml-auto text-[9px] text-purple-400 hover:text-purple-600">{copiedId === `car-${cardId}` ? 'Copied!' : 'Copy All'}</button>
                                      </div>
                                      <div className="space-y-1.5">
                                        {item.carouselSlides.map((slide, si) => (
                                          <div key={si} className="bg-white rounded-lg px-3 py-2 border border-purple-100">
                                            <span className="text-[9px] font-bold text-purple-500">Slide {si + 1}</span>
                                            <p className="text-[10px] text-purple-800">{slide}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {item.hashtags?.length > 0 && <div className="flex flex-wrap gap-1">{item.hashtags.map((h, hi) => <span key={hi} className="text-[9px] text-np-blue font-medium">#{h}</span>)}</div>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleAIAction('Save All as Drafts')} disabled={saving}
                            className="text-[11px] px-4 py-2 bg-np-blue text-white rounded-lg font-medium hover:bg-np-blue/90 disabled:opacity-50 flex items-center gap-1.5">
                            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : <><Send className="w-3 h-3" /> Save All as Drafts</>}
                          </button>
                          <button onClick={() => sendToAI('Regenerate with a different angle')} className="text-[11px] px-4 py-2 bg-white border border-gray-200 text-np-dark rounded-lg font-medium hover:bg-gray-50">Regenerate</button>
                          <button onClick={startAI} className="text-[11px] px-4 py-2 bg-white border border-gray-200 text-np-dark rounded-lg font-medium hover:bg-gray-50">New Content</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {aiGenerating && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-gray-500">Generating content with image direction and video scripts...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) sendToAI(aiInput.trim()) }}
                  placeholder="Describe your content, ask for revisions, or pick an option..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={() => { if (aiInput.trim()) sendToAI(aiInput.trim()) }}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-xl hover:opacity-90">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MANUAL CREATOR ═══ */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-np-dark mb-4">Create Post</h3>
          <div className="flex items-start gap-4 mb-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Brand</label>
              <div className="flex gap-1.5">
                {[{ k: 'np', l: 'NP' }, { k: 'sensorium', l: 'SEN' }].map(b => (
                  <button key={b.k} onClick={() => setBrand(b.k)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${brand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>{b.l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Content Format</label>
              <div className="flex gap-1.5 flex-wrap">
                {CONTENT_FORMATS.map(f => (
                  <button key={f.key} onClick={() => setSelectedContentFormat(f.key)}
                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border-2 ${selectedContentFormat === f.key ? 'border-purple-500 bg-purple-50 text-purple-600' : 'border-transparent bg-gray-100 text-gray-500'}`}>{f.icon} {f.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Platforms</label>
            <div className="flex gap-1.5">
              {PLATFORMS.map(p => (
                <button key={p.key} onClick={() => togglePlatform(p.key)}
                  className={`text-sm px-2.5 py-1.5 rounded-lg border-2 transition-all ${selectedPlatforms.includes(p.key) ? 'border-current' : 'border-transparent bg-gray-100 opacity-40'}`}
                  style={selectedPlatforms.includes(p.key) ? { borderColor: p.color, color: p.color, backgroundColor: p.color + '15' } : {}}>{p.icon}</button>
              ))}
            </div>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write your post content..."
            rows={4} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
          <div className="mb-3">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Hashtags</label>
            <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="nervous system, capacity, HRV"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !content.trim()} className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save as Draft'}
            </button>
            <button onClick={() => setCreating(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5 mb-4">
        {['all', 'draft', 'scheduled', 'published', 'archived'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg ${statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {posts.length === 0 && !creating && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Send className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Social Media Content Hub</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">Create posts, reels, videos, and carousels with AI-generated image direction, video scripts, and platform-specific optimization.</p>
          <div className="flex justify-center gap-3">
            <button onClick={() => setCreating(true)} className="btn-secondary text-sm py-2.5 px-5">Write Manually</button>
            <button onClick={startAI} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium hover:opacity-90">
              <Wand2 className="w-4 h-4" /> AI Content Generator
            </button>
          </div>
        </div>
      )}

      {filteredPosts.length > 0 && (
        <div className="space-y-3">
          {filteredPosts.map(post => {
            const statusConf = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft
            const platforms = post.platform_versions?.map((v: any) => v.platform) || []
            return (
              <div key={post.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>{statusConf.label}</span>
                      <span className="text-[8px] font-bold uppercase text-gray-400">{post.brand === 'np' ? 'Neuro Progeny' : 'Sensorium'}</span>
                      {platforms.map((p: string) => <span key={p} className="text-xs">{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                    </div>
                    <p className="text-sm text-np-dark line-clamp-2">{post.content_original}</p>
                    {post.hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {post.hashtags.map((h: string, i: number) => <span key={i} className="text-[9px] text-np-blue font-medium">#{h}</span>)}
                      </div>
                    )}
                    <p className="text-[9px] text-gray-400 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => deletePost(post.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
