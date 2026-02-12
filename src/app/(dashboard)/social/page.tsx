'use client'

import { useState, useRef, useEffect } from 'react'
import { useSocialData } from '@/lib/hooks/use-social-data'
import type { SocialPost, PlatformFormat } from '@/lib/hooks/use-social-data'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { Plus, Wand2, Send, Clock, Trash2, X, Bot, Loader2, Copy, Check, Film, Image, FileText, Calendar } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: '📸' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: '📘' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: '💼' },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: '🎵' },
  { key: 'x', label: 'X (Twitter)', color: '#1DA1F2', icon: '𝕏' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: '📺' },
]

// Exact social media format dimensions
const FORMAT_SPECS: Record<string, Array<{ key: string; label: string; w: number; h: number; ratio: string }>> = {
  instagram: [
    { key: 'ig-square', label: 'Square Post', w: 1080, h: 1080, ratio: '1:1' },
    { key: 'ig-portrait', label: 'Portrait Post', w: 1080, h: 1350, ratio: '4:5' },
    { key: 'ig-landscape', label: 'Landscape Post', w: 1080, h: 566, ratio: '1.91:1' },
    { key: 'ig-story', label: 'Story / Reel', w: 1080, h: 1920, ratio: '9:16' },
    { key: 'ig-carousel', label: 'Carousel Slide', w: 1080, h: 1080, ratio: '1:1' },
  ],
  facebook: [
    { key: 'fb-landscape', label: 'Feed Post', w: 1200, h: 630, ratio: '1.91:1' },
    { key: 'fb-square', label: 'Square Post', w: 1080, h: 1080, ratio: '1:1' },
    { key: 'fb-story', label: 'Story', w: 1080, h: 1920, ratio: '9:16' },
    { key: 'fb-cover', label: 'Cover Photo', w: 820, h: 312, ratio: '2.63:1' },
    { key: 'fb-event', label: 'Event Cover', w: 1920, h: 1005, ratio: '1.91:1' },
  ],
  linkedin: [
    { key: 'li-landscape', label: 'Feed Post', w: 1200, h: 627, ratio: '1.91:1' },
    { key: 'li-square', label: 'Square Post', w: 1080, h: 1080, ratio: '1:1' },
    { key: 'li-portrait', label: 'Portrait Post', w: 1080, h: 1350, ratio: '4:5' },
    { key: 'li-banner', label: 'Company Banner', w: 1128, h: 191, ratio: '5.9:1' },
    { key: 'li-article', label: 'Article Cover', w: 1200, h: 644, ratio: '1.86:1' },
  ],
  tiktok: [
    { key: 'tt-video', label: 'Video', w: 1080, h: 1920, ratio: '9:16' },
    { key: 'tt-square', label: 'Photo Post', w: 1080, h: 1080, ratio: '1:1' },
  ],
  x: [
    { key: 'x-landscape', label: 'Tweet Image', w: 1200, h: 675, ratio: '16:9' },
    { key: 'x-square', label: 'Square Image', w: 1080, h: 1080, ratio: '1:1' },
    { key: 'x-header', label: 'Header Photo', w: 1500, h: 500, ratio: '3:1' },
  ],
  youtube: [
    { key: 'yt-thumb', label: 'Thumbnail', w: 1280, h: 720, ratio: '16:9' },
    { key: 'yt-banner', label: 'Channel Banner', w: 2560, h: 1440, ratio: '16:9' },
    { key: 'yt-short', label: 'YouTube Short', w: 1080, h: 1920, ratio: '9:16' },
  ],
}

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
  generated?: any[]
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { posts, formats, loading, addPost, updatePost, deletePost } = useSocialData()
  const supabase = createClient()

  const [creating, setCreating] = useState(false)
  const [content, setContent] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram'])
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null)
  const [brand, setBrand] = useState<string>('np')
  const [hashtags, setHashtags] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [saving, setSaving] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')

  // Visual mockup
  const [overlayText, setOverlayText] = useState('')
  const [bgColor, setBgColor] = useState('#386797')
  const [textColor, setTextColor] = useState('#FFFFFF')
  const [showMockup, setShowMockup] = useState(false)

  // AI
  const [aiMode, setAiMode] = useState(false)
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => {
      const next = prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
      if (!next.length) return prev
      return next
    })
  }

  const availableFormats = selectedPlatforms.flatMap(p => (FORMAT_SPECS[p] || []).map(f => ({ ...f, platform: p })))
  const currentFormatSpec = availableFormats.find(f => f.key === selectedFormat) || availableFormats[0]

  const handleCreate = async () => {
    if (!content.trim()) return
    setSaving(true)
    const platformVersions = selectedPlatforms.map(p => ({
      platform: p, content: content.trim(), formats: currentFormatSpec ? [{ key: currentFormatSpec.key, label: currentFormatSpec.label, width: currentFormatSpec.w, height: currentFormatSpec.h, ratio: currentFormatSpec.ratio }] : [],
    }))
    const scheduledAt = scheduleDate && scheduleTime ? new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString() : null
    await addPost({
      brand, content_original: content.trim(), platform_versions: platformVersions,
      hashtags: hashtags.split(',').map(h => h.trim().replace(/^#/, '')).filter(Boolean),
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: scheduledAt,
      custom_fields: {
        format: currentFormatSpec ? { key: currentFormatSpec.key, label: currentFormatSpec.label, w: currentFormatSpec.w, h: currentFormatSpec.h, ratio: currentFormatSpec.ratio } : null,
        overlayText, bgColor, textColor,
      },
    })
    setSaving(false)
    setContent(''); setHashtags(''); setOverlayText(''); setCreating(false)
  }

  // AI
  const fetchBrandSettings = async () => {
    if (!currentOrg) return null
    const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', 'np').single()
    if (data) return { vocabulary_use: data.vocabulary_use || [], vocabulary_avoid: data.vocabulary_avoid || [], voice_description: data.voice_description || '', ...(data.guidelines || {}) }
    return null
  }

  const startAI = () => {
    setAiMode(true)
    setAiMessages([
      { role: 'ai', content: "I'll create platform-specific content with image direction, video scripts, and carousel breakdowns.\n\nWhat type of content?", options: ['Static Post (Image + Caption)', 'Reel / Short Video', 'Carousel / Multi-Slide', 'Long-Form Video', 'Story Content', 'Full Campaign Bundle'] },
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages, brandSettings,
          campaignContext: { type: 'social_content_generation', systemOverride: `You are a world-class social media content strategist for Neuro Progeny.

BRAND RULES: NEVER use treatment/therapy/fix/broken/disorder/cure/patient/calm-chasing/sympathovagal balance. ALWAYS use capacity/training/regulation/adaptive/bandwidth/state fluidity/mirror. No em dashes. Forward-oriented questions only.
${brandSettings?.vocabulary_use?.length ? `Power words: ${brandSettings.vocabulary_use.join(', ')}` : ''}

When ready, output JSON in \`\`\`json ... \`\`\`:
{ "content": [{ "platform": "instagram", "format": "reel|static|carousel|video|story", "caption": "...", "hook": "first line hook", "imageDirection": "Detailed image description for designer/AI: composition, colors, mood, text overlays, style reference", "videoScript": "Full script: Hook(0-3s), Setup(3-10s), Value(10-45s), CTA(45-60s). On-screen text, b-roll, transitions, audio", "carouselSlides": ["Slide 1:...", "Slide 2:..."], "hashtags": ["tag1"], "suggestedFormat": { "key": "ig-square", "label": "Square Post", "w": 1080, "h": 1080, "ratio": "1:1" } }] }

FORMAT REFERENCE:
Instagram: Square 1080x1080(1:1), Portrait 1080x1350(4:5), Story/Reel 1080x1920(9:16)
Facebook: Feed 1200x630(1.91:1), Square 1080x1080, Story 1080x1920
LinkedIn: Feed 1200x627(1.91:1), Square 1080x1080, Portrait 1080x1350
TikTok: Video 1080x1920(9:16)
YouTube: Thumbnail 1280x720(16:9), Short 1080x1920(9:16)
X: Image 1200x675(16:9)

Always suggest the best format dimensions for each platform. Include suggestedFormat in output.
Static = imageDirection. Reel/Video = videoScript. Carousel = carouselSlides + imageDirection per slide.
Ask 2-3 questions if needed. Generate immediately when ready.` },
        }),
      })
      const data = await res.json()
      if (data.error) { setAiMessages([...newMessages, { role: 'ai', content: `Error: ${data.error}` }]) }
      else {
        const aiResponse = data.content
        const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)```/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            const textBefore = aiResponse.split('```json')[0].trim()
            setAiMessages([...newMessages, { role: 'ai', content: textBefore || "Content generated. Expand cards for image direction, video scripts, and formats:", generated: parsed.content || [], options: ['Save All as Drafts', 'Regenerate', 'Different Angle', 'Create Another'] }])
          } catch { setAiMessages([...newMessages, { role: 'ai', content: aiResponse }]) }
        } else { setAiMessages([...newMessages, { role: 'ai', content: aiResponse }]) }
      }
    } catch (err: any) { setAiMessages([...newMessages, { role: 'ai', content: `Error: ${err.message}` }]) }
    setAiGenerating(false)
  }

  const handleAIAction = async (action: string) => {
    if (action === 'Save All as Drafts') {
      const last = [...aiMessages].reverse().find(m => m.generated)?.generated
      if (!last) return
      setSaving(true)
      for (const item of last) {
        await addPost({
          brand: 'np', content_original: item.caption,
          platform_versions: [{ platform: item.platform, content: item.caption, formats: item.suggestedFormat ? [item.suggestedFormat] : [] }],
          hashtags: item.hashtags || [], status: 'draft',
          custom_fields: { format: item.suggestedFormat, imageDirection: item.imageDirection, videoScript: item.videoScript, carouselSlides: item.carouselSlides, hook: item.hook },
        })
      }
      setSaving(false)
      setAiMessages(prev => [...prev, { role: 'ai', content: `Saved ${last.length} posts as drafts! Schedule them from the Content Calendar.` }])
    } else if (action === 'Create Another') { startAI() }
    else { sendToAI(action) }
  }

  const copyText = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000) }

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
          <Link href="/calendar" className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">
            <Calendar className="w-3.5 h-3.5" /> Calendar
          </Link>
          <button onClick={() => { setCreating(true); setShowMockup(false) }} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New Post
          </button>
          <button onClick={startAI} className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
            <Wand2 className="w-3.5 h-3.5" /> AI Generator
          </button>
        </div>
      </div>

      {/* ═══ POST CREATOR WITH FORMAT MOCKUP ═══ */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex gap-6">
            {/* Left: Form */}
            <div className="flex-1">
              <h3 className="text-sm font-bold text-np-dark mb-3">Create Post</h3>
              <div className="flex items-start gap-4 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Brand</label>
                  <div className="flex gap-1">
                    {[{ k: 'np', l: 'NP' }, { k: 'sensorium', l: 'SEN' }].map(b => (
                      <button key={b.k} onClick={() => setBrand(b.k)} className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border-2 ${brand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>{b.l}</button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Platform</label>
                  <div className="flex gap-1 flex-wrap">
                    {PLATFORMS.map(p => (
                      <button key={p.key} onClick={() => { togglePlatform(p.key); setSelectedFormat(null) }}
                        className={`text-xs px-2 py-1 rounded-lg border-2 transition-all ${selectedPlatforms.includes(p.key) ? 'border-current' : 'border-transparent bg-gray-100 opacity-40'}`}
                        style={selectedPlatforms.includes(p.key) ? { borderColor: p.color, color: p.color, backgroundColor: p.color + '15' } : {}}>{p.icon}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Format selector */}
              <div className="mb-3">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Format & Dimensions</label>
                <div className="flex flex-wrap gap-1">
                  {availableFormats.map(f => (
                    <button key={f.key} onClick={() => { setSelectedFormat(f.key); setShowMockup(true) }}
                      className={`text-[9px] px-2 py-1 rounded-lg border transition-all ${selectedFormat === f.key ? 'border-purple-500 bg-purple-50 text-purple-600 font-bold' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      {PLATFORMS.find(p => p.key === (f as any).platform)?.icon} {f.label} <span className="text-gray-400">({f.ratio})</span>
                    </button>
                  ))}
                </div>
              </div>

              <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write your post caption..."
                rows={4} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />

              <div className="mb-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Hashtags</label>
                <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="nervous system, capacity"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none" />
              </div>

              {/* Schedule */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Schedule Date (optional)</label>
                  <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label>
                  <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none" />
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={saving || !content.trim()} className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
                  {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : scheduleDate ? '📅 Schedule Post' : 'Save as Draft'}
                </button>
                <button onClick={() => setShowMockup(!showMockup)} className="btn-secondary text-xs py-2 px-4">
                  {showMockup ? 'Hide Preview' : '👁️ Preview'}
                </button>
                <button onClick={() => setCreating(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
              </div>
            </div>

            {/* Right: Visual Mockup */}
            {showMockup && currentFormatSpec && (
              <div className="w-72 flex-shrink-0">
                <div className="sticky top-0">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Visual Preview ({currentFormatSpec.label})</label>
                  <div className="bg-gray-100 rounded-xl p-3 flex items-center justify-center" style={{ minHeight: 200 }}>
                    <div className="relative overflow-hidden rounded-lg shadow-lg"
                      style={{
                        width: '100%',
                        maxWidth: 240,
                        aspectRatio: `${currentFormatSpec.w}/${currentFormatSpec.h}`,
                        backgroundColor: bgColor,
                      }}>
                      {/* Text overlay preview */}
                      <div className="absolute inset-0 flex items-center justify-center p-4">
                        <p className="text-center font-bold leading-tight" style={{ color: textColor, fontSize: currentFormatSpec.h > currentFormatSpec.w ? '14px' : '12px' }}>
                          {overlayText || content?.split('\n')[0]?.slice(0, 60) || 'Your text here'}
                        </p>
                      </div>
                      {/* Dimension badge */}
                      <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[7px] px-1.5 py-0.5 rounded">
                        {currentFormatSpec.w}x{currentFormatSpec.h}
                      </div>
                    </div>
                  </div>
                  {/* Mockup controls */}
                  <div className="mt-2 space-y-1.5">
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Overlay Text</label>
                      <input value={overlayText} onChange={e => setOverlayText(e.target.value)} placeholder="Text on image..."
                        className="w-full text-[10px] border border-gray-200 rounded-lg px-2 py-1 focus:outline-none" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Background</label>
                        <div className="flex gap-1">
                          <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-6 h-6 rounded border cursor-pointer" />
                          {['#386797', '#1A1A2E', '#10B981', '#EF4444', '#8B5CF6', '#F59E0B'].map(c => (
                            <button key={c} onClick={() => setBgColor(c)} className="w-5 h-5 rounded-full border border-gray-200" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Text</label>
                        <div className="flex gap-1">
                          <button onClick={() => setTextColor('#FFFFFF')} className="w-5 h-5 rounded-full border border-gray-300 bg-white" />
                          <button onClick={() => setTextColor('#1A1A2E')} className="w-5 h-5 rounded-full border border-gray-300 bg-gray-900" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
                            className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 bg-white text-np-dark hover:bg-np-blue hover:text-white hover:border-np-blue transition-all font-medium">{opt}</button>
                        ))}
                      </div>
                    )}
                    {msg.generated && msg.generated.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.generated.map((item: any, idx: number) => {
                          const plat = PLATFORMS.find(p => p.key === item.platform)
                          const cardId = `${i}-${idx}`
                          const isExpanded = expandedCard === cardId
                          return (
                            <div key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                              <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedCard(isExpanded ? null : cardId)}>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{plat?.icon}</span>
                                  <span className="text-xs font-bold text-np-dark">{plat?.label}</span>
                                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-bold">{item.format}</span>
                                  {item.suggestedFormat && <span className="text-[8px] text-gray-400">{item.suggestedFormat.label} ({item.suggestedFormat.ratio})</span>}
                                  {item.imageDirection && <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">🖼️</span>}
                                  {item.videoScript && <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">🎬</span>}
                                  {item.carouselSlides && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">📑{item.carouselSlides.length}</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={e => { e.stopPropagation(); copyText(item.caption, cardId) }}
                                    className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 font-medium">
                                    {copiedId === cardId ? <><Check className="w-3 h-3 text-green-500" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                                  </button>
                                  <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                              </div>
                              {item.hook && <div className="px-3 pb-1"><span className="text-[9px] font-bold text-orange-500">HOOK: </span><span className="text-[10px] text-gray-600">{item.hook}</span></div>}
                              <div className="px-3 pb-2"><p className={`text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed ${isExpanded ? '' : 'line-clamp-3'}`}>{item.caption}</p></div>
                              {isExpanded && (
                                <div className="border-t border-gray-100 px-3 py-3 space-y-3">
                                  {item.suggestedFormat && (
                                    <div className="bg-gray-50 rounded-lg p-2 flex items-center gap-3">
                                      <div className="w-12 h-12 rounded border border-gray-200 flex items-center justify-center text-[7px] text-gray-400" style={{ aspectRatio: `${item.suggestedFormat.w}/${item.suggestedFormat.h}`, maxWidth: 48, backgroundColor: '#386797' }}>
                                        <span className="text-white font-bold">{item.suggestedFormat.ratio}</span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-bold text-np-dark">{item.suggestedFormat.label}</span>
                                        <span className="text-[9px] text-gray-400 ml-2">{item.suggestedFormat.w}x{item.suggestedFormat.h}</span>
                                      </div>
                                    </div>
                                  )}
                                  {item.imageDirection && (
                                    <div className="bg-blue-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-1"><Image className="w-3.5 h-3.5 text-blue-500" /><span className="text-[10px] font-bold text-blue-600 uppercase">Image Direction</span>
                                        <button onClick={() => copyText(item.imageDirection, `img-${cardId}`)} className="ml-auto text-[9px] text-blue-400">{copiedId === `img-${cardId}` ? 'Copied!' : 'Copy'}</button></div>
                                      <p className="text-[11px] text-blue-800 leading-relaxed">{item.imageDirection}</p>
                                    </div>
                                  )}
                                  {item.videoScript && (
                                    <div className="bg-red-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-1"><Film className="w-3.5 h-3.5 text-red-500" /><span className="text-[10px] font-bold text-red-600 uppercase">Video Script</span>
                                        <button onClick={() => copyText(item.videoScript, `vid-${cardId}`)} className="ml-auto text-[9px] text-red-400">{copiedId === `vid-${cardId}` ? 'Copied!' : 'Copy'}</button></div>
                                      <p className="text-[11px] text-red-800 leading-relaxed whitespace-pre-wrap">{item.videoScript}</p>
                                    </div>
                                  )}
                                  {item.carouselSlides?.length > 0 && (
                                    <div className="bg-purple-50 rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-2"><FileText className="w-3.5 h-3.5 text-purple-500" /><span className="text-[10px] font-bold text-purple-600 uppercase">Carousel ({item.carouselSlides.length} slides)</span></div>
                                      <div className="space-y-1.5">{item.carouselSlides.map((s: string, si: number) => (
                                        <div key={si} className="bg-white rounded-lg px-3 py-2 border border-purple-100"><span className="text-[9px] font-bold text-purple-500">Slide {si + 1}</span><p className="text-[10px] text-purple-800">{s}</p></div>
                                      ))}</div>
                                    </div>
                                  )}
                                  {item.hashtags?.length > 0 && <div className="flex flex-wrap gap-1">{item.hashtags.map((h: string, hi: number) => <span key={hi} className="text-[9px] text-np-blue font-medium">#{h}</span>)}</div>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleAIAction('Save All as Drafts')} disabled={saving} className="text-[11px] px-4 py-2 bg-np-blue text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5">
                            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : <><Send className="w-3 h-3" /> Save as Drafts</>}
                          </button>
                          <button onClick={() => sendToAI('Regenerate with a different angle')} className="text-[11px] px-4 py-2 bg-white border border-gray-200 rounded-lg font-medium">Regenerate</button>
                          <button onClick={startAI} className="text-[11px] px-4 py-2 bg-white border border-gray-200 rounded-lg font-medium">New</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {aiGenerating && <div className="flex justify-start"><div className="bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2"><Loader2 className="w-4 h-4 text-purple-500 animate-spin" /><span className="text-sm text-gray-500">Generating...</span></div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) sendToAI(aiInput.trim()) }}
                  placeholder="Describe content, request changes..." className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={() => { if (aiInput.trim()) sendToAI(aiInput.trim()) }} className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-xl hover:opacity-90"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5 mb-4">
        {['all', 'draft', 'scheduled', 'published', 'archived'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg ${statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {posts.length === 0 && !creating && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Send className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Social Media Content Hub</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">Create posts with exact platform dimensions, visual mockups, and schedule to your content calendar.</p>
          <div className="flex justify-center gap-3">
            <button onClick={() => setCreating(true)} className="btn-secondary text-sm py-2.5 px-5">Write Manually</button>
            <button onClick={startAI} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium hover:opacity-90"><Wand2 className="w-4 h-4" /> AI Generator</button>
          </div>
        </div>
      )}

      {filteredPosts.length > 0 && (
        <div className="space-y-3">
          {filteredPosts.map(post => {
            const statusConf = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft
            const platforms = post.platform_versions?.map((v: any) => v.platform) || []
            const cf = (post as any).custom_fields || {}
            return (
              <div key={post.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>{statusConf.label}</span>
                      {cf.format && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">{cf.format.label} ({cf.format.ratio})</span>}
                      <span className="text-[8px] font-bold uppercase text-gray-400">{post.brand === 'np' ? 'NP' : 'SEN'}</span>
                      {platforms.map((p: string) => <span key={p} className="text-xs">{PLATFORMS.find(pl => pl.key === p)?.icon}</span>)}
                      {post.scheduled_at && <span className="text-[8px] text-blue-500 font-medium">📅 {new Date(post.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                    </div>
                    <p className="text-sm text-np-dark line-clamp-2">{post.content_original}</p>
                    {cf.imageDirection && <div className="mt-1 flex items-center gap-1"><Image className="w-3 h-3 text-blue-400" /><span className="text-[9px] text-blue-500 line-clamp-1">{cf.imageDirection}</span></div>}
                    {cf.videoScript && <div className="mt-0.5 flex items-center gap-1"><Film className="w-3 h-3 text-red-400" /><span className="text-[9px] text-red-500 line-clamp-1">{cf.videoScript}</span></div>}
                    {post.hashtags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{post.hashtags.map((h: string, i: number) => <span key={i} className="text-[9px] text-np-blue font-medium">#{h}</span>)}</div>}
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
