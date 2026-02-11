'use client'

import { useState, useRef, useEffect } from 'react'
import { useSocialData } from '@/lib/hooks/use-social-data'
import type { SocialPost, PlatformFormat } from '@/lib/hooks/use-social-data'
import { useWorkspace } from '@/lib/workspace-context'
import { Plus, Wand2, Send, Clock, Archive, Edit3, Trash2, Hash, Eye, Sparkles, X, Bot, Loader2, Copy, Check } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: '📸' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: '📘' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: '💼' },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: '🎵' },
  { key: 'x', label: 'X (Twitter)', color: '#1DA1F2', icon: '𝕏' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  scheduled: { label: 'Scheduled', color: '#3B82F6', bg: '#DBEAFE' },
  published: { label: 'Published', color: '#10B981', bg: '#D1FAE5' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
}

// AI content generation templates
const AI_TEMPLATES: Record<string, (topic: string) => Record<string, string>> = {
  educational: (topic: string) => ({
    instagram: `Your nervous system isn't broken. It adapted.\n\n${topic}\n\nThis is what capacity training looks like. Not managing symptoms. Building the bandwidth to hold more of life without shutting down.\n\nSave this if it resonated. Share it with someone who needs to hear it.\n\n#NervousSystemCapacity #HRV #Biofeedback #StateTraining #VR`,
    linkedin: `Most wellness approaches get this backwards.\n\nThey try to fix what's "wrong" with your nervous system. But here's the thing: nothing is wrong.\n\n${topic}\n\nAt Neuro Progeny, we train capacity. Not calm. Not relaxation. The ability to move fluidly between states, using VR biofeedback as a mirror, not a scorecard.\n\nThe nervous system that got you here was adaptive. The one that takes you forward needs more bandwidth.\n\nWhat does capacity training look like in your world?`,
    facebook: `${topic}\n\nYour nervous system developed patterns that made sense at the time. Every single one was adaptive.\n\nCapacity training doesn't ask "what's wrong with you?" It asks "what did your system learn, and what does it need now?"\n\nThis changes everything about how we approach performance, resilience, and wellbeing.`,
    tiktok: `POV: You realize your nervous system isn't broken, it's adaptive 🧠\n\n${topic}\n\n#NervousSystem #HRV #Biofeedback #VR #CapacityTraining #Resilience`,
    x: `${topic}\n\nYour nervous system isn't broken. It adapted.\n\nCapacity training > calm-chasing.\n\n🧠 HRV as a mirror, not a score\n🎮 VR as a feedback amplifier\n⚡ State fluidity, not stillness`,
  }),
  testimonial: (topic: string) => ({
    instagram: `"${topic}"\n\nThis is what happens when you stop trying to fix yourself and start building capacity.\n\nNo diagnosis. No disorder. Just a nervous system learning it can hold more.\n\n#NervousSystem #CapacityTraining #Transformation #HRV #VRBiofeedback`,
    linkedin: `One of our participants shared this recently:\n\n"${topic}"\n\nWhat changed wasn't their circumstances. It was their nervous system's capacity to hold complexity without collapsing into survival mode.\n\nThis is the shift from symptom management to capacity building. And it's measurable through HRV data.`,
    facebook: `"${topic}"\n\nWe hear stories like this every cohort. Not because we "fixed" anyone. Because nervous systems, when given the right feedback environment, remember how to expand.\n\nCapacity over pathology. Always.`,
    tiktok: `Wait for the transformation 🧠✨\n\n"${topic}"\n\n#NervousSystem #Transformation #CapacityTraining #HRV #Biofeedback`,
    x: `"${topic}"\n\nCapacity training in action. No fixing. No diagnosing. Just building bandwidth.\n\nThe nervous system knows what to do when it has the right mirror.`,
  }),
  cta: (topic: string) => ({
    instagram: `Ready to train your nervous system?\n\n${topic}\n\nThe Immersive Mastermind is a 5-week VR biofeedback experience that builds nervous system capacity through state fluidity.\n\nNot therapy. Not meditation. Training.\n\n🔗 Link in bio to learn more\n\n#ImmersiveMastermind #NervousSystem #VR #HRV #CapacityTraining`,
    linkedin: `${topic}\n\nIf you've tried meditation, breathwork, therapy, and coaching but still find yourself hitting the same ceiling under pressure, this might be the missing piece.\n\nThe Immersive Mastermind is a 5-week program that uses VR biofeedback to train nervous system capacity. Not relaxation. Not calm-chasing. The ability to hold complexity and perform from a wider window.\n\nInterested? Comment "CAPACITY" and I'll send you the details.`,
    facebook: `${topic}\n\nThe Immersive Mastermind is open for enrollment.\n\n5 weeks. VR biofeedback. Nervous system capacity training.\n\nThis isn't about learning to relax. It's about expanding what your system can hold.\n\nDrop a 🧠 if you want details.`,
    tiktok: `This changed everything for me 🧠\n\n${topic}\n\nLink in bio for the Immersive Mastermind\n\n#NervousSystem #VR #Biofeedback #CapacityTraining #ImmersiveMastermind`,
    x: `${topic}\n\nThe Immersive Mastermind: 5 weeks of VR biofeedback training for nervous system capacity.\n\nNot therapy. Training.\n\nDM "CAPACITY" for details.`,
  }),
}

interface AIMessage {
  role: 'ai' | 'user'
  content: string
  options?: string[]
  generated?: Record<string, string>
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { posts, formats, loading, addPost, updatePost, deletePost } = useSocialData()

  const [creating, setCreating] = useState(false)
  const [content, setContent] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram', 'linkedin'])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [brand, setBrand] = useState<string>('np')
  const [hashtags, setHashtags] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [saving, setSaving] = useState(false)

  // AI state
  const [aiMode, setAiMode] = useState(false)
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiStep, setAiStep] = useState(0)
  const [aiData, setAiData] = useState<Record<string, string>>({})
  const [aiGenerating, setAiGenerating] = useState(false)
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key])
  }

  const handleCreate = async () => {
    if (!content.trim()) return
    setSaving(true)
    const platformVersions = selectedPlatforms.map(p => ({
      platform: p,
      content: content.trim(),
      formats: formats.filter(f => f.platform === p && selectedFormats.includes(f.id)).map(f => ({ id: f.id, name: f.format_name, width: f.width, height: f.height })),
    }))
    await addPost({
      brand,
      content_original: content.trim(),
      platform_versions: platformVersions,
      hashtags: hashtags.split(',').map(h => h.trim().replace(/^#/, '')).filter(Boolean),
      status: 'draft',
    })
    setSaving(false)
    setContent(''); setHashtags(''); setCreating(false)
  }

  // AI Content Generator
  const startAI = () => {
    setAiMode(true)
    setAiStep(0)
    setAiData({})
    setAiMessages([
      { role: 'ai', content: "I'll help you generate social content across all your platforms. Let's start with the content type:", options: ['Educational / Authority', 'Testimonial / Story', 'CTA / Enrollment', 'Custom Topic'] },
    ])
  }

  const handleAIResponse = (response: string) => {
    const newMessages: AIMessage[] = [...aiMessages, { role: 'user', content: response }]
    const newData = { ...aiData }

    if (aiStep === 0) {
      newData.type = response
      if (response === 'Custom Topic') {
        newMessages.push({ role: 'ai', content: "What's the topic or core message you want to communicate?" })
        setAiStep(1)
      } else {
        newMessages.push({ role: 'ai', content: "What's the key insight, story, or message? Give me the raw idea and I'll shape it for each platform." })
        setAiStep(1)
      }
    } else if (aiStep === 1) {
      newData.topic = response
      newMessages.push({ role: 'ai', content: "Which platforms should I generate for?", options: ['All Platforms', 'Instagram + LinkedIn', 'Instagram + TikTok', 'LinkedIn Only', 'Instagram Only'] })
      setAiStep(2)
    } else if (aiStep === 2) {
      newData.platforms = response
      // Generate content
      setAiGenerating(true)
      setAiData(newData)
      setAiMessages(newMessages)

      setTimeout(() => {
        const templateKey = newData.type?.includes('Testimonial') ? 'testimonial' : newData.type?.includes('CTA') ? 'cta' : 'educational'
        const template = AI_TEMPLATES[templateKey]
        const generated = template(newData.topic || '')

        let platformsToShow: string[]
        if (response.includes('All')) platformsToShow = ['instagram', 'linkedin', 'facebook', 'tiktok', 'x']
        else if (response.includes('TikTok')) platformsToShow = ['instagram', 'tiktok']
        else if (response.includes('LinkedIn Only')) platformsToShow = ['linkedin']
        else if (response.includes('Instagram Only')) platformsToShow = ['instagram']
        else platformsToShow = ['instagram', 'linkedin']

        const filtered: Record<string, string> = {}
        for (const p of platformsToShow) {
          if (generated[p]) filtered[p] = generated[p]
        }

        setAiMessages(prev => [...prev, {
          role: 'ai',
          content: "Here's your content adapted for each platform. Click to copy, or save directly as drafts:",
          generated: filtered,
        }])
        setAiGenerating(false)
        setAiStep(3)
      }, 1500)
      return
    }

    setAiData(newData)
    setAiMessages(newMessages)
    setAiInput('')
  }

  const copyToClipboard = (text: string, platform: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPlatform(platform)
    setTimeout(() => setCopiedPlatform(null), 2000)
  }

  const saveAllAsDrafts = async () => {
    const lastGenerated = aiMessages.find(m => m.generated)?.generated
    if (!lastGenerated) return
    setSaving(true)
    for (const [platform, text] of Object.entries(lastGenerated)) {
      await addPost({
        brand: 'np',
        content_original: text,
        platform_versions: [{ platform, content: text, formats: [] }],
        hashtags: text.match(/#(\w+)/g)?.map(h => h.replace('#', '')) || [],
        status: 'draft',
      })
    }
    setSaving(false)
    setAiMessages(prev => [...prev, { role: 'ai', content: `Saved ${Object.keys(lastGenerated).length} posts as drafts! You can find them in your post list.` }])
  }

  const handleAISubmit = () => {
    if (!aiInput.trim()) return
    handleAIResponse(aiInput.trim())
    setAiInput('')
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading social...</div></div>
  }

  const filteredPosts = statusFilter === 'all' ? posts : posts.filter(p => p.status === statusFilter)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {posts.length} posts · {formats.length} formats loaded</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New Post
          </button>
          <button onClick={startAI}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
            <Wand2 className="w-3.5 h-3.5" /> AI Content Generator
          </button>
        </div>
      </div>

      {/* AI Content Generator Modal */}
      {aiMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAiMode(false)} />
          <div className="relative w-full max-w-2xl h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-np-blue">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-white" />
                <span className="text-sm font-bold text-white">AI Content Generator</span>
              </div>
              <button onClick={() => setAiMode(false)} className="p-1 rounded hover:bg-white/10">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-np-blue text-white rounded-2xl rounded-br-sm' : 'bg-gray-50 text-np-dark rounded-2xl rounded-bl-sm'} px-4 py-3`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>

                    {/* Option buttons */}
                    {msg.options && msg.role === 'ai' && i === aiMessages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.options.map(opt => (
                          <button key={opt} onClick={() => handleAIResponse(opt)}
                            className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 bg-white text-np-dark hover:bg-np-blue hover:text-white hover:border-np-blue transition-all font-medium">
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Generated content cards */}
                    {msg.generated && (
                      <div className="mt-3 space-y-3">
                        {Object.entries(msg.generated).map(([platform, text]) => {
                          const plat = PLATFORMS.find(p => p.key === platform)
                          return (
                            <div key={platform} className="bg-white border border-gray-200 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold flex items-center gap-1.5">
                                  <span>{plat?.icon}</span> {plat?.label}
                                </span>
                                <button onClick={() => copyToClipboard(text, platform)}
                                  className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 font-medium">
                                  {copiedPlatform === platform ? <><Check className="w-3 h-3 text-green-500" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                                </button>
                              </div>
                              <p className="text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{text}</p>
                            </div>
                          )
                        })}
                        <div className="flex gap-2 mt-2">
                          <button onClick={saveAllAsDrafts} disabled={saving}
                            className="text-[11px] px-4 py-2 bg-np-blue text-white rounded-lg font-medium hover:bg-np-blue/90 disabled:opacity-50 flex items-center gap-1.5">
                            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : <><Send className="w-3 h-3" /> Save All as Drafts</>}
                          </button>
                          <button onClick={() => { setAiStep(0); setAiMessages([...aiMessages, { role: 'ai', content: "Want to generate more? Pick a content type:", options: ['Educational / Authority', 'Testimonial / Story', 'CTA / Enrollment', 'Custom Topic'] }]) }}
                            className="text-[11px] px-4 py-2 bg-white border border-gray-200 text-np-dark rounded-lg font-medium hover:bg-gray-50">
                            Generate More
                          </button>
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
                    <span className="text-sm text-gray-500">Generating content for each platform...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAISubmit() }}
                  placeholder="Type your message or pick an option above..."
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

      {/* Manual Post Creator */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-np-dark mb-4">Create Post</h3>

          <div className="flex items-center gap-4 mb-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Brand</label>
              <div className="flex gap-1.5">
                {[{ k: 'np', l: 'NP' }, { k: 'sensorium', l: 'SEN' }].map(b => (
                  <button key={b.k} onClick={() => setBrand(b.k)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${brand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                    {b.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Platforms</label>
              <div className="flex gap-1.5">
                {PLATFORMS.map(p => (
                  <button key={p.key} onClick={() => togglePlatform(p.key)}
                    className={`text-sm px-2.5 py-1.5 rounded-lg border-2 transition-all ${selectedPlatforms.includes(p.key) ? 'border-current' : 'border-transparent bg-gray-100 opacity-40'}`}
                    style={selectedPlatforms.includes(p.key) ? { borderColor: p.color, color: p.color, backgroundColor: p.color + '15' } : {}}>
                    {p.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Format picker */}
          {selectedPlatforms.length > 0 && (
            <div className="mb-4">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Formats</label>
              <div className="flex flex-wrap gap-1.5">
                {formats
                  .filter(f => selectedPlatforms.includes(f.platform))
                  .map(f => (
                    <button key={f.id} onClick={() => setSelectedFormats(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                      className={`text-[9px] px-2 py-1 rounded border ${selectedFormats.includes(f.id) ? 'border-np-blue bg-np-blue/10 text-np-blue font-bold' : 'border-gray-200 text-gray-500'}`}>
                      {PLATFORMS.find(p => p.key === f.platform)?.icon} {f.format_name} ({f.width}x{f.height})
                    </button>
                  ))}
              </div>
            </div>
          )}

          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write your post content..."
            rows={4} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />

          <div className="mb-3">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Hashtags</label>
            <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="nervous system, capacity, HRV"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
          </div>

          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !content.trim()}
              className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save as Draft'}
            </button>
            <button onClick={() => setCreating(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Status Filters */}
      <div className="flex gap-1.5 mb-4">
        {['all', 'draft', 'scheduled', 'published', 'archived'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg ${statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {posts.length === 0 && !creating && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Send className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Social Media Designer</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create content once, adapt for all platforms. Use the AI generator to produce brand-aligned posts for Instagram, LinkedIn, Facebook, TikTok, and X.
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={() => setCreating(true)} className="btn-secondary text-sm py-2.5 px-5">Write Manually</button>
            <button onClick={startAI}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium hover:opacity-90">
              <Wand2 className="w-4 h-4" /> AI Content Generator
            </button>
          </div>
        </div>
      )}

      {/* Post Grid */}
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
                      <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>
                        {statusConf.label}
                      </span>
                      <span className="text-[8px] font-bold uppercase text-gray-400">
                        {post.brand === 'np' ? 'Neuro Progeny' : 'Sensorium'}
                      </span>
                      {platforms.map((p: string) => (
                        <span key={p} className="text-xs">{PLATFORMS.find(pl => pl.key === p)?.icon}</span>
                      ))}
                    </div>
                    <p className="text-sm text-np-dark line-clamp-2">{post.content_original}</p>
                    {post.hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {post.hashtags.map((h: string, i: number) => (
                          <span key={i} className="text-[9px] text-np-blue font-medium">#{h}</span>
                        ))}
                      </div>
                    )}
                    <p className="text-[9px] text-gray-400 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => deletePost(post.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
