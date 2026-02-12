'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { Send, X, Loader2, Copy, Check, Plus, Calendar, Trash2, Save, Edit3, Clock, RefreshCw } from 'lucide-react'

const PL: Record<string, { name: string; icon: string; color: string; cl: number; formats: Array<{ id: string; name: string; w: number; h: number; r: string }> }> = {
  instagram: { name: 'Instagram', icon: 'IG', color: '#E1306C', cl: 2200, formats: [{ id: 'ig-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'ig-port', name: 'Portrait', w: 1080, h: 1350, r: '4:5' }, { id: 'ig-story', name: 'Story/Reel', w: 1080, h: 1920, r: '9:16' }, { id: 'ig-land', name: 'Landscape', w: 1080, h: 566, r: '1.91:1' }] },
  facebook: { name: 'Facebook', icon: 'FB', color: '#1877F2', cl: 63206, formats: [{ id: 'fb-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'fb-land', name: 'Landscape', w: 1200, h: 630, r: '1.91:1' }, { id: 'fb-story', name: 'Story', w: 1080, h: 1920, r: '9:16' }] },
  linkedin: { name: 'LinkedIn', icon: 'LI', color: '#0A66C2', cl: 3000, formats: [{ id: 'li-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'li-port', name: 'Portrait', w: 1080, h: 1350, r: '4:5' }, { id: 'li-land', name: 'Landscape', w: 1200, h: 627, r: '1.91:1' }, { id: 'li-art', name: 'Article', w: 1280, h: 720, r: '16:9' }] },
  tiktok: { name: 'TikTok', icon: 'TT', color: '#010101', cl: 2200, formats: [{ id: 'tt-vid', name: 'Video', w: 1080, h: 1920, r: '9:16' }] },
  x: { name: 'X (Twitter)', icon: 'X', color: '#1DA1F2', cl: 280, formats: [{ id: 'tw-img', name: 'Image', w: 1600, h: 900, r: '16:9' }, { id: 'tw-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }] },
  youtube: { name: 'YouTube', icon: 'YT', color: '#FF0000', cl: 5000, formats: [{ id: 'yt-thumb', name: 'Thumbnail', w: 1280, h: 720, r: '16:9' }, { id: 'yt-short', name: 'Short', w: 1080, h: 1920, r: '9:16' }] },
}

const CONTENT_TYPES = [
  { id: 'edu', name: 'Educational' }, { id: 'story', name: 'Story' }, { id: 'promo', name: 'Promotional' },
  { id: 'engage', name: 'Engagement' }, { id: 'authority', name: 'Authority' }, { id: 'bts', name: 'Behind Scenes' },
]

const FORMAT_TYPES = [
  { id: 'post', name: 'Post', desc: 'Static image + caption' },
  { id: 'reel', name: 'Reel', desc: 'Short video 15-90s' },
  { id: 'carousel', name: 'Carousel', desc: 'Multi-slide swipe' },
]

interface Voice { id: string; name: string; role: string; persp: string; color: string; on: boolean }
const DEFAULT_VOICES: Voice[] = [
  { id: 'v1', name: 'Alex Hormozi', role: 'Growth & Offers', persp: 'Irresistible offers, value equations, scaling. Would someone feel stupid saying no?', color: '#E63946', on: true },
  { id: 'v2', name: 'Seth Godin', role: 'Marketing Philosophy', persp: 'Smallest viable audience, permission marketing, remarkable ideas. Who is this for?', color: '#F4A261', on: true },
  { id: 'v3', name: 'Daniel Priestley', role: 'Key Person of Influence', persp: 'Scorecard strategy, perfect pitch, publishing authority. Does this position you as the go-to expert?', color: '#2A9D8F', on: false },
  { id: 'v4', name: 'Motivational Interviewing', role: 'Change Psychology', persp: 'Elicit change talk, roll with resistance, express empathy. Orient toward the person\'s own reasons for change.', color: '#386797', on: true },
  { id: 'v5', name: 'Stephen Porges', role: 'Polyvagal Theory', persp: 'Neuroception, co-regulation, ventral vagal states. Frame through safety and connection.', color: '#10b981', on: false },
  { id: 'v6', name: 'ACT Framework', role: 'Acceptance & Commitment', persp: 'Psychological flexibility, values-driven action, defusion. Frame content around what matters, not what hurts.', color: '#8B5CF6', on: false },
]
const VOICE_SUGGESTIONS = ['Brene Brown', 'Gary Vaynerchuk', 'Dan Siegel', 'Russell Brunson', 'StoryBrand', 'Cialdini Persuasion', 'Joe Dispenza', 'Jobs-to-be-Done']
const VOICE_COLORS = ['#8B5CF6', '#2A9D8F', '#E76F51', '#F4A261', '#386797', '#E63946', '#10b981', '#ec4899', '#f59e0b', '#6366f1']

// Content option from AI
interface ContentOption {
  id: string
  label: string
  hook: string
  caption: string
  imageDirection: string
  videoScript: string
  carouselSlides: string[]
  hashtags: string[]
  selected: boolean
  formatType: 'post' | 'reel' | 'carousel'
}

interface AIMessage {
  role: 'ai' | 'user'
  content: string
  options?: ContentOption[]
}

// Strip markdown bold and em dashes from text
function cleanText(t: string): string {
  return t.replace(/\*\*/g, '').replace(/\*/g, '').replace(/---/g, '').replace(/--/g, ',').replace(/\u2014/g, ',').replace(/\u2013/g, ',')
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [tab, setTab] = useState<'create' | 'posts' | 'voices'>('create')
  const [brand, setBrand] = useState('np')
  const [contentType, setContentType] = useState('edu')
  const [plats, setPlats] = useState<string[]>(['instagram', 'linkedin'])
  const [fmts, setFmts] = useState<Record<string, string>>({ instagram: 'ig-sq', linkedin: 'li-sq' })
  const [voices, setVoices] = useState<Voice[]>(DEFAULT_VOICES)

  const [msgs, setMsgs] = useState<AIMessage[]>([])
  const [inp, setInp] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  // Right panel: selected content for preview
  const [activeOption, setActiveOption] = useState<ContentOption | null>(null)
  const [previewBg, setPreviewBg] = useState('#386797')
  const [previewTextColor, setPreviewTextColor] = useState('#FFFFFF')

  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editPost, setEditPost] = useState<any | null>(null)
  const [editCaption, setEditCaption] = useState('')
  const [editScheduleDate, setEditScheduleDate] = useState('')
  const [editScheduleTime, setEditScheduleTime] = useState('')

  const [editVoice, setEditVoice] = useState<Voice | 'new' | null>(null)
  const [voiceForm, setVoiceForm] = useState({ name: '', role: '', persp: '', color: '#8B5CF6' })

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight) }, [msgs])

  const fetchPosts = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase.from('social_posts').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
    if (data) setPosts(data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  useEffect(() => {
    const av = voices.filter(v => v.on)
    setMsgs([{ role: 'ai', content: `I'm your AI CMO. ${av.length ? `Voices: ${av.map(v => v.name).join(', ')}` : ''}\nBrand: ${brand === 'np' ? 'Neuro Progeny' : 'Sensorium'} | ${plats.map(p => PL[p]?.name).join(', ')}\n\nDescribe what you want to post. I'll generate 3 content options you can select, assign as Post/Reel/Carousel, and save to your drafts.` }])
  }, [brand])

  const togglePlat = (pid: string) => {
    setPlats(prev => {
      if (prev.includes(pid)) return prev.length > 1 ? prev.filter(p => p !== pid) : prev
      return [...prev, pid]
    })
    if (!fmts[pid]) setFmts(prev => ({ ...prev, [pid]: PL[pid]?.formats[0]?.id || '' }))
  }

  const buildSystemPrompt = async () => {
    const br = brand === 'np' ? 'Neuro Progeny' : 'Sensorium Wellness'
    const av = voices.filter(v => v.on)
    const pn = plats.map(p => `${PL[p]?.name} (${PL[p]?.cl} chars)`).join(', ')
    const ti = CONTENT_TYPES.find(t => t.id === contentType)
    let s = `You are a world-class CMO for ${br}. Generate content for: ${pn}. Content type: ${ti?.name || 'Educational'}.

CRITICAL FORMATTING RULES:
- NEVER use em dashes (the long dash character). Use commas or periods instead.
- NEVER use ** for bold. Write plain text only.
- NEVER use * for italics or emphasis. Plain text only.
- NEVER use --- or -- as separators. Use line breaks.
- Keep output clean, plain text suitable for social media platforms.

BRAND RULES:
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV)
- No em dashes anywhere. Forward-facing questions only.

`
    if (av.length) { s += 'ADVISORY VOICES (analyze through each):\n'; av.forEach(v => { s += `- ${v.name} (${v.role}): ${v.persp}\n` }) }
    if (currentOrg) {
      const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', brand).single()
      if (data?.guidelines) {
        const g = data.guidelines
        if (g.core_messages?.length) s += `\nCore Messages: ${g.core_messages.join(' | ')}\n`
      }
    }

    s += `
RESPOND WITH EXACTLY THIS JSON FORMAT (wrapped in \`\`\`json):
{
  "options": [
    {
      "label": "Short 2-4 word label for this angle",
      "hook": "The scroll-stopping first line",
      "caption": "Full post caption. Plain text, no markdown, no em dashes. Include line breaks where natural.",
      "imageDirection": "Detailed visual description: composition, colors, mood, text overlays, style reference. Specific enough for a designer.",
      "videoScript": "If this works as a reel: Hook(0-3s), Setup(3-10s), Value(10-45s), CTA(45-60s). On-screen text ideas. Leave empty string if purely static.",
      "carouselSlides": ["Slide 1: Cover text and visual", "Slide 2: ...", "Slide 3: ..."],
      "hashtags": ["tag1", "tag2", "tag3"]
    },
    { second option with different angle },
    { third option with different angle }
  ]
}

ALWAYS return exactly 3 options with distinctly different angles/approaches. Each should work standalone as a complete post. Make captions platform-ready, not theoretical. Zero markdown formatting in any field.`

    return s
  }

  const send = async () => {
    if (!inp.trim() || busy) return
    const txt = inp.trim()
    setInp('')
    setBusy(true)
    const newMsgs: AIMessage[] = [...msgs, { role: 'user', content: txt }]
    setMsgs(newMsgs)
    try {
      const systemPrompt = await buildSystemPrompt()
      const apiMessages = newMsgs.filter(m => m.content.trim()).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, brandSettings: null, campaignContext: { type: 'social_designer', systemOverride: systemPrompt } }),
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }

      if (data.error) {
        setMsgs([...newMsgs, { role: 'ai', content: `Error: ${data.error}` }])
      } else {
        const raw = data.content || ''
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            const options: ContentOption[] = (parsed.options || []).map((o: any, idx: number) => ({
              id: `opt-${Date.now()}-${idx}`,
              label: cleanText(o.label || `Option ${idx + 1}`),
              hook: cleanText(o.hook || ''),
              caption: cleanText(o.caption || ''),
              imageDirection: cleanText(o.imageDirection || ''),
              videoScript: cleanText(o.videoScript || ''),
              carouselSlides: (o.carouselSlides || []).map((s: string) => cleanText(s)),
              hashtags: o.hashtags || [],
              selected: false,
              formatType: (o.videoScript && o.videoScript.length > 20) ? 'reel' : (o.carouselSlides?.length > 2) ? 'carousel' : 'post',
            }))
            const intro = raw.split('```json')[0].trim()
            setMsgs([...newMsgs, { role: 'ai', content: intro ? cleanText(intro) : 'Here are 3 content options. Select the ones you want, choose Post/Reel/Carousel, then save to drafts:', options }])
            if (options.length > 0) setActiveOption(options[0])
          } catch {
            setMsgs([...newMsgs, { role: 'ai', content: cleanText(raw) }])
          }
        } else {
          setMsgs([...newMsgs, { role: 'ai', content: cleanText(raw) }])
        }
      }
    } catch (err: any) { setMsgs([...newMsgs, { role: 'ai', content: `Connection error: ${err.message}` }]) }
    setBusy(false)
  }

  const toggleOptionSelect = (msgIdx: number, optId: string) => {
    setMsgs(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.options) return m
      return { ...m, options: m.options.map(o => o.id === optId ? { ...o, selected: !o.selected } : o) }
    }))
  }

  const setOptionFormat = (msgIdx: number, optId: string, fmt: 'post' | 'reel' | 'carousel') => {
    setMsgs(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.options) return m
      return { ...m, options: m.options.map(o => o.id === optId ? { ...o, formatType: fmt } : o) }
    }))
  }

  const saveSelectedDrafts = async (msgIdx: number) => {
    if (!currentOrg) return
    const msg = msgs[msgIdx]
    if (!msg?.options) return
    const selected = msg.options.filter(o => o.selected)
    if (selected.length === 0) return
    setSaving(true)
    for (const opt of selected) {
      await supabase.from('social_posts').insert({
        org_id: currentOrg.id, brand, content_original: opt.caption,
        platform_versions: plats.map(p => {
          const f = PL[p]?.formats.find(x => x.id === fmts[p]) || PL[p]?.formats[0]
          return { platform: p, content: opt.caption, format: { id: f?.id, name: f?.name, w: f?.w, h: f?.h, r: f?.r } }
        }),
        hashtags: opt.hashtags,
        status: 'draft',
        custom_fields: {
          formatType: opt.formatType, hook: opt.hook, imageDirection: opt.imageDirection,
          videoScript: opt.videoScript, carouselSlides: opt.carouselSlides,
          overlayText: opt.hook, bgColor: previewBg, textColor: previewTextColor,
          contentType, formats: fmts,
        },
      }).select()
    }
    await fetchPosts()
    setSaving(false)
    setMsgs(prev => [...prev, { role: 'ai', content: `Saved ${selected.length} post${selected.length > 1 ? 's' : ''} as draft${selected.length > 1 ? 's' : ''}. Find them in the Posts tab or schedule from the Calendar.` }])
  }

  const openEdit = (post: any) => {
    setEditPost(post)
    setEditCaption(post.content_original || '')
    setEditScheduleDate(post.scheduled_at ? new Date(post.scheduled_at).toISOString().split('T')[0] : '')
    setEditScheduleTime(post.scheduled_at ? new Date(post.scheduled_at).toTimeString().slice(0, 5) : '')
  }

  const saveEdit = async () => {
    if (!editPost) return
    setSaving(true)
    const scheduledAt = editScheduleDate && editScheduleTime ? new Date(`${editScheduleDate}T${editScheduleTime}:00`).toISOString() : editPost.scheduled_at
    await supabase.from('social_posts').update({
      content_original: editCaption, status: scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: scheduledAt || null, updated_at: new Date().toISOString(),
    }).eq('id', editPost.id)
    await fetchPosts()
    setSaving(false)
    setEditPost(null)
  }

  const copyText = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000) }
  const openVoiceEditor = (v: Voice | 'new') => { setEditVoice(v); if (v === 'new') setVoiceForm({ name: '', role: '', persp: '', color: '#8B5CF6' }); else setVoiceForm({ name: v.name, role: v.role, persp: v.persp, color: v.color }) }
  const saveVoice = () => { if (!voiceForm.name.trim()) return; if (editVoice === 'new') setVoices(prev => [...prev, { ...voiceForm, id: `v-${Date.now()}`, on: true }]); else if (editVoice) setVoices(prev => prev.map(v => v.id === editVoice.id ? { ...v, ...voiceForm } : v)); setEditVoice(null) }

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media Designer</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">AI CMO | {voices.filter(v => v.on).length} voices | {plats.map(p => PL[p]?.icon).join(' ')}</p>
        </div>
        <div className="flex gap-1.5">
          {([['create', 'Create'], ['posts', `Posts (${posts.length})`], ['voices', `Voices`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k as any)} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border ${tab === k ? 'bg-np-blue text-white border-np-blue' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
          ))}
          <Link href="/calendar" className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 flex items-center gap-1"><Calendar className="w-3 h-3" /> Calendar</Link>
        </div>
      </div>

      {/* ====== CREATE: 3-PANEL ====== */}
      {tab === 'create' && (
        <div className="flex-1 grid grid-cols-[220px_1fr_300px] gap-3 min-h-0">
          {/* LEFT */}
          <div className="overflow-y-auto space-y-2 pr-1">
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Brand</div>
              {[{ k: 'np', n: 'Neuro Progeny', c: ['#1B365D', '#476B8E', '#386797'] }, { k: 'sensorium', n: 'Sensorium Wellness', c: ['#2A9D8F', '#264653', '#E9C46A'] }].map(b => (
                <div key={b.k} onClick={() => setBrand(b.k)} className={`flex items-center gap-2 px-2.5 py-2 mb-1 rounded-lg cursor-pointer border ${brand === b.k ? 'border-np-blue/30 bg-np-blue/5' : 'border-transparent hover:bg-gray-50'}`}>
                  <div className="flex gap-0.5">{b.c.map((c, i) => <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}</div>
                  <span className={`text-xs ${brand === b.k ? 'font-bold text-np-dark' : 'text-gray-500'}`}>{b.n}</span>
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Content Type</div>
              <div className="grid grid-cols-2 gap-1">
                {CONTENT_TYPES.map(t => (
                  <button key={t.id} onClick={() => setContentType(t.id)} className={`py-1.5 px-2 rounded-lg text-left text-[10px] ${contentType === t.id ? 'bg-np-blue/10 border border-np-blue/30 text-np-blue font-bold' : 'bg-gray-50 border border-transparent text-gray-500 hover:bg-gray-100'}`}>{t.name}</button>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Platforms & Formats</div>
              {Object.entries(PL).map(([pid, pl]) => (
                <div key={pid} className="mb-1.5">
                  <div onClick={() => togglePlat(pid)} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${plats.includes(pid) ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={plats.includes(pid)} readOnly className="w-3 h-3" style={{ accentColor: pl.color }} />
                    <span className={`text-xs ${plats.includes(pid) ? 'font-bold' : 'text-gray-500'}`} style={plats.includes(pid) ? { color: pl.color } : {}}>{pl.icon} {pl.name}</span>
                  </div>
                  {plats.includes(pid) && (
                    <div className="flex gap-1 flex-wrap pl-6 mt-0.5">
                      {pl.formats.map(f => (
                        <button key={f.id} onClick={() => setFmts(prev => ({ ...prev, [pid]: f.id }))}
                          className={`text-[8px] px-1.5 py-0.5 rounded border ${fmts[pid] === f.id ? 'font-bold' : 'text-gray-400 border-gray-200'}`}
                          style={fmts[pid] === f.id ? { color: pl.color, borderColor: pl.color + '60', backgroundColor: pl.color + '10' } : {}}>{f.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Voices</div>
                <button onClick={() => setTab('voices')} className="text-[9px] text-np-blue font-medium">Manage</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {voices.filter(v => v.on).map(v => (
                  <span key={v.id} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-lg border font-medium" style={{ borderColor: v.color + '40', backgroundColor: v.color + '10', color: v.color }}>
                    {v.name.split(' ')[0]}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* CENTER: Chat with Option Cards */}
          <div className="bg-white border border-gray-100 rounded-xl flex flex-col min-h-0">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <span className="text-xs font-bold text-purple-600">CMO AI Assistant</span>
              <span className="text-[9px] text-gray-400 ml-2">Generates 3 options per request</span>
            </div>
            <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {msgs.map((m, mi) => (
                <div key={mi} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[92%] ${m.role === 'user' ? 'bg-np-blue text-white rounded-2xl rounded-br-sm px-3.5 py-2.5' : ''}`}>
                    {m.role === 'user' && <div className="text-sm whitespace-pre-wrap">{m.content}</div>}
                    {m.role === 'ai' && !m.options && (
                      <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                        <div className="text-[8px] font-bold text-purple-500 uppercase tracking-wider mb-1">CMO AI</div>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed text-np-dark">{m.content}</div>
                      </div>
                    )}
                    {m.role === 'ai' && m.options && (
                      <div className="space-y-2">
                        {m.content && <div className="text-[11px] text-gray-500 mb-2">{m.content}</div>}
                        {/* 3 Option Cards */}
                        {m.options.map((opt, oi) => (
                          <div key={opt.id}
                            className={`border rounded-xl overflow-hidden transition-all ${opt.selected ? 'border-np-blue shadow-md ring-2 ring-np-blue/20' : 'border-gray-200 hover:border-gray-300'}`}>
                            {/* Option header */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                              <button onClick={() => toggleOptionSelect(mi, opt.id)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center text-[10px] flex-shrink-0 ${opt.selected ? 'bg-np-blue border-np-blue text-white' : 'border-gray-300 text-transparent'}`}>
                                {opt.selected && <Check className="w-3 h-3" />}
                              </button>
                              <span className="text-[10px] font-bold text-np-dark flex-1">Option {oi + 1}: {opt.label}</span>
                              {/* Format type selector */}
                              <div className="flex gap-0.5">
                                {FORMAT_TYPES.map(ft => (
                                  <button key={ft.id} onClick={() => setOptionFormat(mi, opt.id, ft.id as any)}
                                    className={`text-[8px] px-2 py-0.5 rounded font-bold ${opt.formatType === ft.id ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
                                    {ft.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Hook */}
                            <div className="px-3 pt-2">
                              <div className="text-[8px] font-bold text-orange-500 uppercase">Hook</div>
                              <p className="text-[11px] text-np-dark font-medium">{opt.hook}</p>
                            </div>
                            {/* Caption preview */}
                            <div className="px-3 py-1.5">
                              <p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-4">{opt.caption}</p>
                            </div>
                            {/* Expandable details */}
                            {(opt.selected || activeOption?.id === opt.id) && (
                              <div className="px-3 pb-2 space-y-1.5">
                                {opt.imageDirection && (
                                  <div className="bg-blue-50 rounded-lg p-2">
                                    <div className="text-[8px] font-bold text-blue-600 uppercase mb-0.5">Image Direction</div>
                                    <p className="text-[9px] text-blue-800 leading-relaxed">{opt.imageDirection}</p>
                                  </div>
                                )}
                                {opt.videoScript && opt.formatType === 'reel' && (
                                  <div className="bg-red-50 rounded-lg p-2">
                                    <div className="text-[8px] font-bold text-red-600 uppercase mb-0.5">Video Script</div>
                                    <p className="text-[9px] text-red-800 leading-relaxed whitespace-pre-wrap">{opt.videoScript}</p>
                                  </div>
                                )}
                                {opt.carouselSlides?.length > 0 && opt.formatType === 'carousel' && (
                                  <div className="bg-purple-50 rounded-lg p-2">
                                    <div className="text-[8px] font-bold text-purple-600 uppercase mb-1">Carousel ({opt.carouselSlides.length} slides)</div>
                                    {opt.carouselSlides.map((sl, si) => (
                                      <div key={si} className="text-[9px] text-purple-800 py-0.5 border-b border-purple-100 last:border-0">Slide {si + 1}: {sl}</div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1">{opt.hashtags.map((h, hi) => <span key={hi} className="text-[8px] text-np-blue font-medium">#{h}</span>)}</div>
                              </div>
                            )}
                            {/* Preview button */}
                            <div className="px-3 pb-2 flex gap-1">
                              <button onClick={() => setActiveOption(opt)} className="text-[8px] text-np-blue font-medium hover:underline">
                                {activeOption?.id === opt.id ? 'Previewing' : 'Preview'}
                              </button>
                              <button onClick={() => copyText(opt.caption + '\n\n' + opt.hashtags.map(h => '#' + h).join(' '), opt.id)}
                                className="text-[8px] text-gray-400 hover:text-gray-600 ml-auto">
                                {copiedId === opt.id ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                          </div>
                        ))}
                        {/* Batch actions */}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => saveSelectedDrafts(mi)}
                            disabled={saving || !m.options?.some(o => o.selected)}
                            className="text-[10px] px-3 py-1.5 bg-np-blue text-white rounded-lg font-medium disabled:opacity-40 flex items-center gap-1">
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save Selected as Drafts
                          </button>
                          <button onClick={() => send()} disabled={busy} className="text-[10px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> 3 More Options
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-gray-400">Generating 3 options...</span>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={inp} onChange={e => setInp(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Describe what you want to post..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={send} disabled={busy} className="px-4 py-2 bg-np-blue text-white rounded-xl hover:bg-np-blue/90 disabled:opacity-50">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Preview Panel */}
          <div className="overflow-y-auto space-y-2 pl-1">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
              {activeOption ? `Previewing: ${activeOption.label}` : 'Select an option to preview'}
            </div>

            {activeOption && (
              <>
                {/* Format type badge */}
                <div className="flex gap-1 mb-1">
                  {FORMAT_TYPES.map(ft => (
                    <span key={ft.id} className={`text-[9px] px-2.5 py-1 rounded-lg font-bold ${activeOption.formatType === ft.id ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      {ft.name}
                    </span>
                  ))}
                </div>

                {/* Color controls */}
                <div className="bg-white border border-gray-100 rounded-xl p-2.5">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="text-[8px] text-gray-400 mb-0.5">Background</div>
                      <div className="flex gap-1">
                        {['#386797', '#1A1A2E', '#10B981', '#E1306C', '#8B5CF6', '#F59E0B', '#FFFFFF'].map(c => (
                          <button key={c} onClick={() => setPreviewBg(c)} className="w-4 h-4 rounded-full border" style={{ backgroundColor: c, borderColor: previewBg === c ? '#000' : '#ddd', borderWidth: previewBg === c ? 2 : 1 }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] text-gray-400 mb-0.5">Text</div>
                      <div className="flex gap-1">
                        <button onClick={() => setPreviewTextColor('#FFFFFF')} className="w-4 h-4 rounded-full border bg-white" style={{ borderColor: previewTextColor === '#FFFFFF' ? '#000' : '#ccc', borderWidth: previewTextColor === '#FFFFFF' ? 2 : 1 }} />
                        <button onClick={() => setPreviewTextColor('#1A1A2E')} className="w-4 h-4 rounded-full bg-gray-900" style={{ border: previewTextColor === '#1A1A2E' ? '2px solid #3B82F6' : '1px solid transparent' }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Platform mockup cards */}
                {plats.map(pid => {
                  const pl = PL[pid]
                  if (!pl) return null
                  const f = pl.formats.find(x => x.id === fmts[pid]) || pl.formats[0]
                  const scale = Math.min(260 / f.w, 170 / f.h)
                  const overLimit = activeOption.caption.length > pl.cl
                  return (
                    <div key={pid} className="bg-white border border-gray-100 rounded-xl p-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold" style={{ color: pl.color }}>{pl.icon} {pl.name}</span>
                        <span className="text-[8px] text-gray-400">{f.name} {f.r}</span>
                      </div>
                      <div className="flex items-center justify-center mb-1.5">
                        <div className="rounded-lg overflow-hidden relative flex items-center justify-center p-3"
                          style={{ width: Math.round(f.w * scale), height: Math.round(f.h * scale), backgroundColor: previewBg }}>
                          <p className="text-center font-bold leading-tight" style={{ color: previewTextColor, fontSize: f.h > f.w ? '11px' : '10px' }}>
                            {activeOption.hook || 'Your hook here'}
                          </p>
                          <span className="absolute bottom-1 right-1 text-[6px] bg-black/30 text-white px-1 rounded">{f.w}x{f.h}</span>
                          {activeOption.formatType === 'reel' && <span className="absolute top-1 left-1 text-[7px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold">REEL</span>}
                          {activeOption.formatType === 'carousel' && <span className="absolute top-1 left-1 text-[7px] bg-purple-500 text-white px-1.5 py-0.5 rounded font-bold">1/{activeOption.carouselSlides?.length || 5}</span>}
                        </div>
                      </div>
                      <div className="border border-gray-100 rounded-lg p-2">
                        <p className="text-[9px] text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-5">{activeOption.caption}</p>
                        {activeOption.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-1">{activeOption.hashtags.slice(0, 6).map((h, i) => <span key={i} className="text-[8px] text-np-blue">#{h}</span>)}</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className={`text-[8px] font-bold ${overLimit ? 'text-red-500' : 'text-gray-400'}`}>{activeOption.caption.length}/{pl.cl}</span>
                        <button onClick={() => copyText(activeOption.caption + '\n\n' + activeOption.hashtags.map(h => '#' + h).join(' '), `pv-${pid}`)}
                          className="text-[8px] text-gray-400 hover:text-np-blue">{copiedId === `pv-${pid}` ? 'Copied!' : 'Copy'}</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
            {!activeOption && <div className="bg-gray-50 rounded-xl p-8 text-center text-xs text-gray-400">Generate content, then click Preview on an option to see it in your platform cards</div>}
          </div>
        </div>
      )}

      {/* ====== POSTS ====== */}
      {tab === 'posts' && (
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="text-center py-8 text-gray-400 text-sm">Loading...</div> : posts.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
              <h2 className="text-lg font-semibold text-np-dark mb-2">No Posts Yet</h2>
              <p className="text-sm text-gray-500 mb-4">Generate content in the Create tab, select options, and save as drafts.</p>
              <button onClick={() => setTab('create')} className="btn-primary text-sm py-2.5 px-5">Start Creating</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {posts.map(post => {
                const cf = post.custom_fields || {}
                const platforms = post.platform_versions || []
                const fmt = platforms[0]?.format
                return (
                  <div key={post.id} onClick={() => openEdit(post)}
                    className="bg-white border border-gray-100 rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition-all group">
                    <div className="relative flex items-center justify-center p-3" style={{ backgroundColor: cf.bgColor || '#386797', minHeight: 90, maxHeight: 140 }}>
                      <p className="text-center font-bold leading-tight px-2 line-clamp-2" style={{ color: cf.textColor || '#fff', fontSize: '11px' }}>{cf.hook || cf.overlayText || post.content_original?.split('\n')[0]?.slice(0, 60)}</p>
                      <div className="absolute top-1.5 left-1.5 flex gap-1">
                        <span className={`text-[7px] font-bold uppercase px-1.5 py-0.5 rounded ${post.status === 'draft' ? 'bg-white/80 text-gray-600' : post.status === 'scheduled' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'}`}>{post.status}</span>
                        {cf.formatType && <span className="text-[7px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500 text-white">{cf.formatType}</span>}
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                        {platforms.map((v: any) => <span key={v.platform} className="text-[7px] font-bold bg-white/80 px-1 py-0.5 rounded" style={{ color: PL[v.platform]?.color }}>{PL[v.platform]?.icon}</span>)}
                      </div>
                      {fmt && <span className="absolute bottom-1 right-1 text-[6px] bg-black/40 text-white px-1 py-0.5 rounded">{fmt.name} {fmt.r}</span>}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <Edit3 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] text-np-dark line-clamp-2 leading-relaxed">{post.content_original}</p>
                      {post.hashtags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{post.hashtags.slice(0, 4).map((h: string, i: number) => <span key={i} className="text-[8px] text-np-blue">#{h}</span>)}</div>}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[8px] text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>
                        {post.scheduled_at && <span className="text-[8px] text-blue-500 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{new Date(post.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== VOICES ====== */}
      {tab === 'voices' && (
        <div className="flex-1 overflow-y-auto max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div><h2 className="text-base font-bold text-np-dark">Advisory Voices</h2><p className="text-xs text-gray-500 mt-0.5">AI analyzes through each selected lens.</p></div>
            <button onClick={() => openVoiceEditor('new')} className="text-xs px-3 py-1.5 bg-np-blue text-white rounded-lg font-medium">+ Add Voice</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {voices.map(v => (
              <div key={v.id} className="bg-white border border-gray-100 rounded-xl p-3.5" style={{ borderLeftWidth: 4, borderLeftColor: v.color }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: v.color }}>{v.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                    <div><div className="text-sm font-bold text-np-dark">{v.name}</div><div className="text-[10px] font-medium" style={{ color: v.color }}>{v.role}</div></div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openVoiceEditor(v)} className="text-[10px] text-gray-400 hover:text-np-blue">Edit</button>
                    <button onClick={() => setVoices(prev => prev.map(x => x.id === v.id ? { ...x, on: !x.on } : x))} className={`text-[9px] px-2 py-0.5 rounded font-bold border ${v.on ? 'text-white' : 'text-gray-400 border-gray-200'}`} style={v.on ? { backgroundColor: v.color, borderColor: v.color } : {}}>{v.on ? 'Active' : 'Off'}</button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">{v.persp}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div className="text-[10px] font-bold text-gray-400 mb-2">Suggested Voices</div>
            <div className="flex flex-wrap gap-1.5">
              {VOICE_SUGGESTIONS.filter(n => !voices.find(v => v.name === n)).map(n => (
                <button key={n} onClick={() => { setVoiceForm({ name: n, role: '', persp: '', color: '#8B5CF6' }); setEditVoice('new') }} className="text-[10px] px-2.5 py-1 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-white hover:border-np-blue hover:text-np-blue">+ {n}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Post Modal */}
      {editPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditPost(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-np-dark">Edit Post</h3>
              <button onClick={() => setEditPost(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="p-6">
              <div className="flex gap-6">
                <div className="w-44 flex-shrink-0">
                  {(() => {
                    const cf = editPost.custom_fields || {}
                    const fmt = editPost.platform_versions?.[0]?.format
                    return (
                      <div className="rounded-xl overflow-hidden relative flex items-center justify-center p-3" style={{ backgroundColor: cf.bgColor || '#386797', aspectRatio: fmt ? `${fmt.w}/${fmt.h}` : '1/1', maxHeight: 200 }}>
                        <p className="text-center font-bold leading-tight" style={{ color: cf.textColor || '#fff', fontSize: '11px' }}>{cf.hook || cf.overlayText || 'Preview'}</p>
                        {cf.formatType && <span className="absolute top-1 left-1 text-[7px] bg-purple-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">{cf.formatType}</span>}
                      </div>
                    )
                  })()}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {editPost.platform_versions?.map((v: any) => (
                      <span key={v.platform} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: PL[v.platform]?.color, backgroundColor: PL[v.platform]?.color + '15' }}>{PL[v.platform]?.icon} {PL[v.platform]?.name}</span>
                    ))}
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Caption</label>
                    <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={6} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
                    <span className="text-[8px] text-gray-400">{editCaption.length} chars</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Date</label><input type="date" value={editScheduleDate} onChange={e => setEditScheduleDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2" /></div>
                    <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label><input type="time" value={editScheduleTime} onChange={e => setEditScheduleTime(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2" /></div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={saveEdit} disabled={saving} className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {editScheduleDate ? 'Schedule' : 'Save'}
                    </button>
                    <button onClick={() => setEditPost(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
                    <button onClick={async () => { await supabase.from('social_posts').delete().eq('id', editPost.id); await fetchPosts(); setEditPost(null) }} className="text-xs py-2 px-4 text-red-500 hover:bg-red-50 rounded-lg ml-auto">Delete</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voice Editor Modal */}
      {editVoice !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditVoice(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-np-dark">{editVoice === 'new' ? 'Add Voice' : 'Edit Voice'}</h3><button onClick={() => setEditVoice(null)}><X className="w-4 h-4 text-gray-400" /></button></div>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Name *</label><input value={voiceForm.name} onChange={e => setVoiceForm({ ...voiceForm, name: e.target.value })} placeholder="Alex Hormozi..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Role</label><input value={voiceForm.role} onChange={e => setVoiceForm({ ...voiceForm, role: e.target.value })} placeholder="Growth strategist..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Perspective</label><textarea value={voiceForm.persp} onChange={e => setVoiceForm({ ...voiceForm, persp: e.target.value })} rows={3} placeholder="What lens do they use?" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Color</label><div className="flex gap-1.5 flex-wrap">{VOICE_COLORS.map(c => <button key={c} onClick={() => setVoiceForm({ ...voiceForm, color: c })} className="w-6 h-6 rounded-full" style={{ backgroundColor: c, border: voiceForm.color === c ? '3px solid #1A1A2E' : '3px solid transparent' }} />)}</div></div>
              <div className="flex justify-between pt-2">
                <div>{editVoice !== 'new' && <button onClick={() => { setVoices(prev => prev.filter(v => v.id !== (editVoice as Voice).id)); setEditVoice(null) }} className="text-xs px-3 py-1.5 bg-red-50 text-red-500 rounded-lg border border-red-200">Delete</button>}</div>
                <div className="flex gap-2"><button onClick={() => setEditVoice(null)} className="btn-secondary text-xs py-1.5 px-3">Cancel</button><button onClick={saveVoice} className="btn-primary text-xs py-1.5 px-3">Save</button></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
