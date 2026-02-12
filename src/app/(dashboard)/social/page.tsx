'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useMediaData } from '@/lib/hooks/use-media-data'
import type { MediaAsset } from '@/lib/hooks/use-media-data'
import Link from 'next/link'
import { Send, X, Loader2, Copy, Check, Calendar, Trash2, Save, Edit3, Clock, RefreshCw, Image, Film, Layers, Sparkles, Plus, Search } from 'lucide-react'

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

const FORMAT_PREFS = [
  { id: 'ai', name: 'AI Recommends', icon: Sparkles, desc: 'CMO picks best format', color: '#8B5CF6' },
  { id: 'post', name: 'Static Post', icon: Image, desc: 'Image + caption', color: '#3B82F6' },
  { id: 'reel', name: 'Reel / Video', icon: Film, desc: 'Short video 15-90s', color: '#EF4444' },
  { id: 'carousel', name: 'Carousel', icon: Layers, desc: 'Multi-slide swipe', color: '#10B981' },
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

interface ContentOption {
  id: string; label: string; hook: string; caption: string; imageDirection: string;
  videoScript: string; carouselSlides: string[]; hashtags: string[];
  selected: boolean; formatType: 'post' | 'reel' | 'carousel'; formatReason: string;
  media: Array<{ slotLabel: string; asset: MediaAsset | null }>
}
interface AIMessage { role: 'ai' | 'user'; content: string; options?: ContentOption[] }

function cleanText(t: string): string {
  return t.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/---/g, '').replace(/--/g, ', ').replace(/\u2014/g, ', ').replace(/\u2013/g, ', ')
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()
  const { assets: mediaAssets, loading: mediaLoading } = useMediaData()

  const [tab, setTab] = useState<'create' | 'posts' | 'voices'>('create')
  const [brand, setBrand] = useState('np')
  const [contentType, setContentType] = useState('edu')
  const [formatPref, setFormatPref] = useState('ai')
  const [plats, setPlats] = useState<string[]>(['instagram', 'linkedin'])
  const [fmts, setFmts] = useState<Record<string, string>>({ instagram: 'ig-sq', linkedin: 'li-sq' })
  const [voices, setVoices] = useState<Voice[]>(DEFAULT_VOICES)

  const [msgs, setMsgs] = useState<AIMessage[]>([])
  const [inp, setInp] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const [activeOption, setActiveOption] = useState<ContentOption | null>(null)
  const [previewBg, setPreviewBg] = useState('#386797')
  const [previewTextColor, setPreviewTextColor] = useState('#FFFFFF')

  // Media picker
  const [mediaPicker, setMediaPicker] = useState<{ optionId: string; slotIndex: number; type: 'image' | 'video' } | null>(null)
  const [mediaSearch, setMediaSearch] = useState('')

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
    setMsgs([{ role: 'ai', content: `I'm your AI CMO. ${av.length ? `Voices: ${av.map(v => v.name).join(', ')}` : ''}\n${brand === 'np' ? 'Neuro Progeny' : 'Sensorium'} | ${plats.map(p => PL[p]?.name).join(', ')}\nFormat: ${formatPref === 'ai' ? 'AI Recommends (I\'ll pick the best format for each option)' : FORMAT_PREFS.find(f => f.id === formatPref)?.name}\n\nDescribe what you want to post. I'll generate 3 options with the best format for each.` }])
  }, [brand])

  const togglePlat = (pid: string) => {
    setPlats(prev => { if (prev.includes(pid)) return prev.length > 1 ? prev.filter(p => p !== pid) : prev; return [...prev, pid] })
    if (!fmts[pid]) setFmts(prev => ({ ...prev, [pid]: PL[pid]?.formats[0]?.id || '' }))
  }

  const buildSystemPrompt = async () => {
    const br = brand === 'np' ? 'Neuro Progeny' : 'Sensorium Wellness'
    const av = voices.filter(v => v.on)
    const pn = plats.map(p => `${PL[p]?.name} (${PL[p]?.cl} chars)`).join(', ')
    const ti = CONTENT_TYPES.find(t => t.id === contentType)

    const formatInstruction = formatPref === 'ai'
      ? `For each option, YOU CHOOSE the best format (post, reel, or carousel) based on what will perform best for this content, audience, and platforms. Include "formatReason" explaining WHY you chose that format. Each option can be a different format.`
      : `All 3 options MUST be "${formatPref}" format. Tailor each option specifically for ${FORMAT_PREFS.find(f => f.id === formatPref)?.name}.`

    let s = `You are a world-class CMO for ${br}. Platforms: ${pn}. Content type: ${ti?.name || 'Educational'}.

FORMATTING RULES (CRITICAL):
- NEVER use em dashes (long dash). Use commas or periods.
- NEVER use ** or * for bold/italics. Plain text only.
- NEVER use --- or -- as separators.
- Clean, plain text for social media.

BRAND RULES:
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV)
- Forward-facing questions only. No em dashes.

${formatInstruction}

`
    if (av.length) { s += 'ADVISORY VOICES:\n'; av.forEach(v => { s += `- ${v.name} (${v.role}): ${v.persp}\n` }) }
    if (currentOrg) {
      const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', brand).single()
      if (data?.guidelines?.core_messages?.length) s += `\nCore Messages: ${data.guidelines.core_messages.join(' | ')}\n`
    }

    s += `
RESPOND WITH THIS JSON (wrapped in \`\`\`json):
{
  "options": [
    {
      "label": "2-4 word angle label",
      "formatType": "post|reel|carousel",
      "formatReason": "Why this format performs best for this content (1 sentence)",
      "hook": "Scroll-stopping first line",
      "caption": "Full platform-ready caption. Plain text, no markdown. Natural line breaks.",
      "imageDirection": "Detailed visual: composition, colors, mood, text overlays, style. Specific for a designer.",
      "videoScript": "For reels only: Hook(0-3s), Setup(3-10s), Value(10-45s), CTA(45-60s). On-screen text. Empty string if static post.",
      "carouselSlides": ["Slide 1: Cover headline + visual", "Slide 2: Key point + visual", ...],
      "hashtags": ["tag1", "tag2", "tag3"]
    }
  ]
}

CAROUSEL RULES: If carousel, provide 5-10 slides. Each slide must have text overlay direction AND visual direction.
REEL RULES: If reel, videoScript must include exact timing, on-screen text, transitions, audio suggestions.
POST RULES: If post, imageDirection must be detailed enough for AI image generation or designer handoff.

Return exactly 3 options with distinctly different angles. Zero markdown. Immediately actionable.`
    return s
  }

  const buildMediaSlots = (opt: any): Array<{ slotLabel: string; asset: MediaAsset | null }> => {
    if (opt.formatType === 'carousel') {
      return (opt.carouselSlides || []).map((_: string, i: number) => ({ slotLabel: `Slide ${i + 1}`, asset: null }))
    }
    if (opt.formatType === 'reel') return [{ slotLabel: 'Video', asset: null }]
    return [{ slotLabel: 'Image', asset: null }]
  }

  const send = async () => {
    if (!inp.trim() || busy) return
    const txt = inp.trim(); setInp(''); setBusy(true)
    const newMsgs: AIMessage[] = [...msgs, { role: 'user', content: txt }]
    setMsgs(newMsgs)
    try {
      const systemPrompt = await buildSystemPrompt()
      const apiMessages = newMsgs.filter(m => m.content.trim()).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: apiMessages, brandSettings: null, campaignContext: { type: 'social_designer', systemOverride: systemPrompt } }) })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
      if (data.error) { setMsgs([...newMsgs, { role: 'ai', content: `Error: ${data.error}` }]) }
      else {
        const raw = data.content || ''
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            const options: ContentOption[] = (parsed.options || []).map((o: any, idx: number) => {
              const ft = (o.formatType === 'reel' || o.formatType === 'carousel' || o.formatType === 'post') ? o.formatType : 'post'
              const opt = {
                id: `opt-${Date.now()}-${idx}`, label: cleanText(o.label || `Option ${idx + 1}`),
                hook: cleanText(o.hook || ''), caption: cleanText(o.caption || ''),
                imageDirection: cleanText(o.imageDirection || ''), videoScript: cleanText(o.videoScript || ''),
                carouselSlides: (o.carouselSlides || []).map((s: string) => cleanText(s)),
                hashtags: o.hashtags || [], selected: false, formatType: ft as any,
                formatReason: cleanText(o.formatReason || ''), media: [] as any[],
              }
              opt.media = buildMediaSlots(opt)
              return opt
            })
            setMsgs([...newMsgs, { role: 'ai', content: '', options }])
            if (options.length > 0) setActiveOption(options[0])
          } catch { setMsgs([...newMsgs, { role: 'ai', content: cleanText(raw) }]) }
        } else { setMsgs([...newMsgs, { role: 'ai', content: cleanText(raw) }]) }
      }
    } catch (err: any) { setMsgs([...newMsgs, { role: 'ai', content: `Connection error: ${err.message}` }]) }
    setBusy(false)
  }

  const toggleOptionSelect = (mi: number, optId: string) => {
    setMsgs(prev => prev.map((m, i) => i !== mi || !m.options ? m : { ...m, options: m.options.map(o => o.id === optId ? { ...o, selected: !o.selected } : o) }))
  }
  const setOptionFormat = (mi: number, optId: string, fmt: 'post' | 'reel' | 'carousel') => {
    setMsgs(prev => prev.map((m, i) => {
      if (i !== mi || !m.options) return m
      return { ...m, options: m.options.map(o => {
        if (o.id !== optId) return o
        const updated = { ...o, formatType: fmt }
        updated.media = buildMediaSlots(updated)
        return updated
      })}
    }))
    if (activeOption?.id === optId) {
      const updated = { ...activeOption, formatType: fmt }
      updated.media = buildMediaSlots(updated)
      setActiveOption(updated)
    }
  }

  const assignMedia = (asset: MediaAsset) => {
    if (!mediaPicker || !activeOption) return
    const updated = { ...activeOption, media: activeOption.media.map((s, i) => i === mediaPicker.slotIndex ? { ...s, asset } : s) }
    setActiveOption(updated)
    // Also update in msgs
    setMsgs(prev => prev.map(m => !m.options ? m : { ...m, options: m.options.map(o => o.id === activeOption.id ? updated : o) }))
    setMediaPicker(null)
  }

  const removeMedia = (slotIndex: number) => {
    if (!activeOption) return
    const updated = { ...activeOption, media: activeOption.media.map((s, i) => i === slotIndex ? { ...s, asset: null } : s) }
    setActiveOption(updated)
    setMsgs(prev => prev.map(m => !m.options ? m : { ...m, options: m.options.map(o => o.id === activeOption.id ? updated : o) }))
  }

  const saveSelectedDrafts = async (mi: number) => {
    if (!currentOrg) return
    const msg = msgs[mi]; if (!msg?.options) return
    const selected = msg.options.filter(o => o.selected); if (selected.length === 0) return
    setSaving(true)
    for (const opt of selected) {
      await supabase.from('social_posts').insert({
        org_id: currentOrg.id, brand, content_original: opt.caption,
        platform_versions: plats.map(p => { const f = PL[p]?.formats.find(x => x.id === fmts[p]) || PL[p]?.formats[0]; return { platform: p, content: opt.caption, format: { id: f?.id, name: f?.name, w: f?.w, h: f?.h, r: f?.r } } }),
        hashtags: opt.hashtags, status: 'draft',
        custom_fields: { formatType: opt.formatType, formatReason: opt.formatReason, hook: opt.hook, imageDirection: opt.imageDirection, videoScript: opt.videoScript, carouselSlides: opt.carouselSlides, overlayText: opt.hook, bgColor: previewBg, textColor: previewTextColor, contentType, formats: fmts, media: opt.media.map(s => s.asset ? { id: s.asset.id, name: s.asset.name, url: s.asset.url, thumbnail_url: s.asset.thumbnail_url, mime_type: s.asset.mime_type, slotLabel: s.slotLabel } : null).filter(Boolean) },
      }).select()
    }
    await fetchPosts(); setSaving(false)
    setMsgs(prev => [...prev, { role: 'ai', content: `Saved ${selected.length} draft${selected.length > 1 ? 's' : ''}. Find them in Posts or schedule from Calendar.` }])
  }

  const openEdit = (post: any) => { setEditPost(post); setEditCaption(post.content_original || ''); setEditScheduleDate(post.scheduled_at ? new Date(post.scheduled_at).toISOString().split('T')[0] : ''); setEditScheduleTime(post.scheduled_at ? new Date(post.scheduled_at).toTimeString().slice(0, 5) : '') }
  const saveEdit = async () => {
    if (!editPost) return; setSaving(true)
    const sa = editScheduleDate && editScheduleTime ? new Date(`${editScheduleDate}T${editScheduleTime}:00`).toISOString() : editPost.scheduled_at
    await supabase.from('social_posts').update({ content_original: editCaption, status: sa ? 'scheduled' : 'draft', scheduled_at: sa || null, updated_at: new Date().toISOString() }).eq('id', editPost.id)
    await fetchPosts(); setSaving(false); setEditPost(null)
  }
  const copyText = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000) }
  const openVoiceEditor = (v: Voice | 'new') => { setEditVoice(v); if (v === 'new') setVoiceForm({ name: '', role: '', persp: '', color: '#8B5CF6' }); else setVoiceForm({ name: v.name, role: v.role, persp: v.persp, color: v.color }) }
  const saveVoice = () => { if (!voiceForm.name.trim()) return; if (editVoice === 'new') setVoices(prev => [...prev, { ...voiceForm, id: `v-${Date.now()}`, on: true }]); else if (editVoice) setVoices(prev => prev.map(v => v.id === editVoice.id ? { ...v, ...voiceForm } : v)); setEditVoice(null) }

  const filteredMedia = mediaAssets.filter(a => {
    if (mediaSearch && !a.name.toLowerCase().includes(mediaSearch.toLowerCase()) && !a.tags.some(t => t.toLowerCase().includes(mediaSearch.toLowerCase()))) return false
    if (mediaPicker?.type === 'video') return a.mime_type?.startsWith('video')
    if (mediaPicker?.type === 'image') return a.mime_type?.startsWith('image') || a.mime_type?.startsWith('video')
    return true
  })

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media Designer</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">AI CMO | {voices.filter(v => v.on).length} voices | {plats.map(p => PL[p]?.icon).join(' ')} | {FORMAT_PREFS.find(f => f.id === formatPref)?.name}</p>
        </div>
        <div className="flex gap-1.5">
          {([['create', 'Create'], ['posts', `Posts (${posts.length})`], ['voices', 'Voices']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k as any)} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border ${tab === k ? 'bg-np-blue text-white border-np-blue' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
          ))}
          <Link href="/calendar" className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 flex items-center gap-1"><Calendar className="w-3 h-3" /> Calendar</Link>
        </div>
      </div>

      {/* CREATE */}
      {tab === 'create' && (
        <div className="flex-1 grid grid-cols-[220px_1fr_300px] gap-3 min-h-0">
          {/* LEFT */}
          <div className="overflow-y-auto space-y-2 pr-1">
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Brand</div>
              {[{ k: 'np', n: 'Neuro Progeny', c: ['#1B365D','#476B8E','#386797'] }, { k: 'sensorium', n: 'Sensorium Wellness', c: ['#2A9D8F','#264653','#E9C46A'] }].map(b => (
                <div key={b.k} onClick={() => setBrand(b.k)} className={`flex items-center gap-2 px-2.5 py-2 mb-1 rounded-lg cursor-pointer border ${brand === b.k ? 'border-np-blue/30 bg-np-blue/5' : 'border-transparent hover:bg-gray-50'}`}>
                  <div className="flex gap-0.5">{b.c.map((c, i) => <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}</div>
                  <span className={`text-xs ${brand === b.k ? 'font-bold text-np-dark' : 'text-gray-500'}`}>{b.n}</span>
                </div>
              ))}
            </div>

            {/* Format Preference */}
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Format</div>
              {FORMAT_PREFS.map(fp => {
                const Icon = fp.icon
                return (
                  <div key={fp.id} onClick={() => setFormatPref(fp.id)} className={`flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg cursor-pointer border ${formatPref === fp.id ? 'bg-gray-50' : 'border-transparent hover:bg-gray-50'}`} style={formatPref === fp.id ? { borderColor: fp.color + '40' } : {}}>
                    <Icon className="w-3.5 h-3.5" style={{ color: formatPref === fp.id ? fp.color : '#9CA3AF' }} />
                    <div>
                      <div className={`text-[10px] ${formatPref === fp.id ? 'font-bold' : 'text-gray-500'}`} style={formatPref === fp.id ? { color: fp.color } : {}}>{fp.name}</div>
                      <div className="text-[8px] text-gray-400">{fp.desc}</div>
                    </div>
                  </div>
                )
              })}
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
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Platforms</div>
              {Object.entries(PL).map(([pid, pl]) => (
                <div key={pid} className="mb-1">
                  <div onClick={() => togglePlat(pid)} className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer ${plats.includes(pid) ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={plats.includes(pid)} readOnly className="w-3 h-3" style={{ accentColor: pl.color }} />
                    <span className={`text-[10px] ${plats.includes(pid) ? 'font-bold' : 'text-gray-500'}`} style={plats.includes(pid) ? { color: pl.color } : {}}>{pl.icon} {pl.name}</span>
                  </div>
                  {plats.includes(pid) && <div className="flex gap-1 flex-wrap pl-6 mt-0.5">{pl.formats.map(f => <button key={f.id} onClick={() => setFmts(prev => ({ ...prev, [pid]: f.id }))} className={`text-[7px] px-1 py-0.5 rounded border ${fmts[pid] === f.id ? 'font-bold' : 'text-gray-400 border-gray-200'}`} style={fmts[pid] === f.id ? { color: pl.color, borderColor: pl.color + '60', backgroundColor: pl.color + '10' } : {}}>{f.name}</button>)}</div>}
                </div>
              ))}
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1"><div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Voices</div><button onClick={() => setTab('voices')} className="text-[8px] text-np-blue font-medium">Manage</button></div>
              <div className="flex flex-wrap gap-1">{voices.filter(v => v.on).map(v => <span key={v.id} className="text-[8px] px-1.5 py-0.5 rounded-lg border font-medium" style={{ borderColor: v.color + '40', backgroundColor: v.color + '10', color: v.color }}>{v.name.split(' ')[0]}</span>)}</div>
            </div>
          </div>

          {/* CENTER: Chat */}
          <div className="bg-white border border-gray-100 rounded-xl flex flex-col min-h-0">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
              <span className="text-xs font-bold text-purple-600">CMO AI</span>
              <span className="text-[9px] text-gray-400">3 options per request</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold ml-auto" style={{ backgroundColor: FORMAT_PREFS.find(f => f.id === formatPref)?.color + '15', color: FORMAT_PREFS.find(f => f.id === formatPref)?.color }}>
                {FORMAT_PREFS.find(f => f.id === formatPref)?.name}
              </span>
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
                        {m.options.map((opt, oi) => {
                          const fmtColor = opt.formatType === 'reel' ? '#EF4444' : opt.formatType === 'carousel' ? '#10B981' : '#3B82F6'
                          const mediaCount = opt.media.filter(s => s.asset).length
                          return (
                            <div key={opt.id} className={`border rounded-xl overflow-hidden transition-all ${opt.selected ? 'border-np-blue shadow-md ring-2 ring-np-blue/20' : 'border-gray-200 hover:border-gray-300'}`}>
                              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                                <button onClick={() => toggleOptionSelect(mi, opt.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${opt.selected ? 'bg-np-blue border-np-blue text-white' : 'border-gray-300'}`}>{opt.selected && <Check className="w-3 h-3" />}</button>
                                <span className="text-[10px] font-bold text-np-dark flex-1">{opt.label}</span>
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: fmtColor + '15', color: fmtColor }}>{opt.formatType}</span>
                                <div className="flex gap-0.5">{(['post','reel','carousel'] as const).map(ft => <button key={ft} onClick={() => setOptionFormat(mi, opt.id, ft)} className={`text-[7px] px-1.5 py-0.5 rounded font-bold ${opt.formatType === ft ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>{ft[0].toUpperCase()}</button>)}</div>
                              </div>
                              {opt.formatReason && <div className="px-3 py-1 bg-purple-50 border-b border-purple-100"><span className="text-[8px] text-purple-600 italic">{opt.formatReason}</span></div>}
                              <div className="px-3 pt-2"><div className="text-[8px] font-bold text-orange-500 uppercase">Hook</div><p className="text-[11px] text-np-dark font-medium">{opt.hook}</p></div>
                              <div className="px-3 py-1.5"><p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-3">{opt.caption}</p></div>
                              {(opt.selected || activeOption?.id === opt.id) && (
                                <div className="px-3 pb-2 space-y-1.5">
                                  {opt.imageDirection && <div className="bg-blue-50 rounded-lg p-2"><div className="text-[8px] font-bold text-blue-600 uppercase mb-0.5">Image Direction</div><p className="text-[9px] text-blue-800 leading-relaxed">{opt.imageDirection}</p></div>}
                                  {opt.videoScript && opt.formatType === 'reel' && <div className="bg-red-50 rounded-lg p-2"><div className="text-[8px] font-bold text-red-600 uppercase mb-0.5">Video Script</div><p className="text-[9px] text-red-800 leading-relaxed whitespace-pre-wrap">{opt.videoScript}</p></div>}
                                  {opt.carouselSlides?.length > 0 && opt.formatType === 'carousel' && <div className="bg-green-50 rounded-lg p-2"><div className="text-[8px] font-bold text-green-600 uppercase mb-1">Carousel ({opt.carouselSlides.length} slides)</div>{opt.carouselSlides.map((sl, si) => <div key={si} className="text-[9px] text-green-800 py-0.5 border-b border-green-100 last:border-0">Slide {si + 1}: {sl}</div>)}</div>}
                                  {mediaCount > 0 && <div className="text-[8px] text-gray-500">{mediaCount} media attached</div>}
                                  <div className="flex flex-wrap gap-1">{opt.hashtags.map((h, hi) => <span key={hi} className="text-[8px] text-np-blue font-medium">#{h}</span>)}</div>
                                </div>
                              )}
                              <div className="px-3 pb-2 flex gap-1">
                                <button onClick={() => setActiveOption(opt)} className={`text-[8px] font-medium ${activeOption?.id === opt.id ? 'text-purple-600' : 'text-np-blue hover:underline'}`}>{activeOption?.id === opt.id ? 'Previewing' : 'Preview + Media'}</button>
                                <button onClick={() => copyText(opt.caption + '\n\n' + opt.hashtags.map(h => '#' + h).join(' '), opt.id)} className="text-[8px] text-gray-400 hover:text-gray-600 ml-auto">{copiedId === opt.id ? 'Copied!' : 'Copy'}</button>
                              </div>
                            </div>
                          )
                        })}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => saveSelectedDrafts(mi)} disabled={saving || !m.options?.some(o => o.selected)} className="text-[10px] px-3 py-1.5 bg-np-blue text-white rounded-lg font-medium disabled:opacity-40 flex items-center gap-1">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Selected</button>
                          <button onClick={send} disabled={busy} className="text-[10px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium flex items-center gap-1"><RefreshCw className="w-3 h-3" /> 3 More</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && <div className="flex justify-start"><div className="bg-gray-50 border border-gray-100 rounded-xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2"><Loader2 className="w-4 h-4 text-purple-500 animate-spin" /><span className="text-sm text-gray-400">Generating 3 options...</span></div></div>}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 flex gap-2">
              <input value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Describe what you want to post..."
                className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
              <button onClick={send} disabled={busy} className="px-4 py-2 bg-np-blue text-white rounded-xl hover:bg-np-blue/90 disabled:opacity-50"><Send className="w-4 h-4" /></button>
            </div>
          </div>

          {/* RIGHT: Preview + Media */}
          <div className="overflow-y-auto space-y-2 pl-1">
            {activeOption ? (<>
              <div className="flex items-center justify-between">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{activeOption.label}</div>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: (activeOption.formatType === 'reel' ? '#EF4444' : activeOption.formatType === 'carousel' ? '#10B981' : '#3B82F6') + '15', color: activeOption.formatType === 'reel' ? '#EF4444' : activeOption.formatType === 'carousel' ? '#10B981' : '#3B82F6' }}>{activeOption.formatType}</span>
              </div>

              {/* Media Slots */}
              <div className="bg-white border border-gray-100 rounded-xl p-2.5">
                <div className="text-[9px] font-bold text-gray-400 uppercase mb-2">
                  {activeOption.formatType === 'carousel' ? 'Slide Media' : activeOption.formatType === 'reel' ? 'Video' : 'Image'}
                  <span className="text-gray-300 ml-1 font-normal">from media library</span>
                </div>
                <div className={`${activeOption.formatType === 'carousel' ? 'space-y-1.5' : ''}`}>
                  {activeOption.media.map((slot, si) => (
                    <div key={si} className={`flex items-center gap-2 ${activeOption.formatType === 'carousel' ? 'bg-gray-50 rounded-lg p-1.5' : ''}`}>
                      {slot.asset ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {slot.asset.thumbnail_url || slot.asset.mime_type?.startsWith('image') ? (
                            <img src={slot.asset.thumbnail_url || slot.asset.url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center flex-shrink-0"><Film className="w-4 h-4 text-gray-400" /></div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[9px] font-medium text-np-dark truncate">{slot.asset.name}</div>
                            <div className="text-[8px] text-gray-400">{slot.slotLabel}</div>
                          </div>
                          <button onClick={() => removeMedia(si)} className="text-gray-300 hover:text-red-400 flex-shrink-0"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <button onClick={() => setMediaPicker({ optionId: activeOption.id, slotIndex: si, type: activeOption.formatType === 'reel' ? 'video' : 'image' })}
                          className="flex items-center gap-2 w-full border-2 border-dashed border-gray-200 rounded-lg p-2 hover:border-np-blue/40 hover:bg-np-blue/5 transition-all">
                          <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center"><Plus className="w-3.5 h-3.5 text-gray-400" /></div>
                          <div>
                            <div className="text-[9px] font-medium text-gray-500">{slot.slotLabel}</div>
                            <div className="text-[7px] text-gray-400">Click to pick from library</div>
                          </div>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Color controls */}
              <div className="bg-white border border-gray-100 rounded-xl p-2.5">
                <div className="flex gap-2">
                  <div className="flex-1"><div className="text-[8px] text-gray-400 mb-0.5">Overlay BG</div><div className="flex gap-1">{['#386797','#1A1A2E','#10B981','#E1306C','#8B5CF6','#F59E0B','#FFFFFF'].map(c => <button key={c} onClick={() => setPreviewBg(c)} className="w-3.5 h-3.5 rounded-full border" style={{ backgroundColor: c, borderColor: previewBg === c ? '#000' : '#ddd', borderWidth: previewBg === c ? 2 : 1 }} />)}</div></div>
                  <div><div className="text-[8px] text-gray-400 mb-0.5">Text</div><div className="flex gap-1"><button onClick={() => setPreviewTextColor('#FFFFFF')} className="w-3.5 h-3.5 rounded-full border bg-white" style={{ borderColor: previewTextColor === '#FFFFFF' ? '#000' : '#ccc', borderWidth: previewTextColor === '#FFFFFF' ? 2 : 1 }} /><button onClick={() => setPreviewTextColor('#1A1A2E')} className="w-3.5 h-3.5 rounded-full bg-gray-900" style={{ border: previewTextColor === '#1A1A2E' ? '2px solid #3B82F6' : '1px solid transparent' }} /></div></div>
                </div>
              </div>

              {/* Platform mockups */}
              {plats.map(pid => {
                const pl = PL[pid]; if (!pl) return null
                const f = pl.formats.find(x => x.id === fmts[pid]) || pl.formats[0]
                const scale = Math.min(260 / f.w, 160 / f.h)
                const firstMedia = activeOption.media[0]?.asset
                return (
                  <div key={pid} className="bg-white border border-gray-100 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold" style={{ color: pl.color }}>{pl.icon} {pl.name}</span>
                      <span className="text-[8px] text-gray-400">{f.name}</span>
                    </div>
                    <div className="flex items-center justify-center mb-1.5">
                      <div className="rounded-lg overflow-hidden relative flex items-center justify-center" style={{ width: Math.round(f.w * scale), height: Math.round(f.h * scale) }}>
                        {firstMedia?.thumbnail_url || firstMedia?.url ? (
                          <img src={firstMedia.thumbnail_url || firstMedia.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        ) : null}
                        <div className="absolute inset-0" style={{ backgroundColor: firstMedia ? 'rgba(0,0,0,0.3)' : previewBg }} />
                        <p className="relative text-center font-bold leading-tight px-2 z-10" style={{ color: previewTextColor, fontSize: f.h > f.w ? '11px' : '10px' }}>{activeOption.hook || 'Hook'}</p>
                        <span className="absolute bottom-0.5 right-0.5 text-[5px] bg-black/30 text-white px-0.5 rounded z-10">{f.w}x{f.h}</span>
                        {activeOption.formatType === 'reel' && <span className="absolute top-0.5 left-0.5 text-[6px] bg-red-500 text-white px-1 py-0.5 rounded font-bold z-10">REEL</span>}
                        {activeOption.formatType === 'carousel' && <span className="absolute top-0.5 left-0.5 text-[6px] bg-green-500 text-white px-1 py-0.5 rounded font-bold z-10">1/{activeOption.carouselSlides?.length || 5}</span>}
                      </div>
                    </div>
                    <div className="border border-gray-100 rounded-lg p-1.5"><p className="text-[8px] text-gray-600 leading-relaxed line-clamp-3">{activeOption.caption}</p></div>
                    <div className="flex items-center justify-between mt-1"><span className={`text-[7px] font-bold ${activeOption.caption.length > pl.cl ? 'text-red-500' : 'text-gray-400'}`}>{activeOption.caption.length}/{pl.cl}</span><button onClick={() => copyText(activeOption.caption + '\n\n' + activeOption.hashtags.map(h => '#' + h).join(' '), `pv-${pid}`)} className="text-[7px] text-gray-400 hover:text-np-blue">{copiedId === `pv-${pid}` ? 'Copied!' : 'Copy'}</button></div>
                  </div>
                )
              })}
            </>) : <div className="bg-gray-50 rounded-xl p-8 text-center text-xs text-gray-400">Generate content, then click Preview on an option</div>}
          </div>
        </div>
      )}

      {/* POSTS */}
      {tab === 'posts' && (
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="text-center py-8 text-gray-400 text-sm">Loading...</div> : posts.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center"><h2 className="text-lg font-semibold text-np-dark mb-2">No Posts Yet</h2><p className="text-sm text-gray-500 mb-4">Generate content, select options, and save as drafts.</p><button onClick={() => setTab('create')} className="btn-primary text-sm py-2.5 px-5">Start Creating</button></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {posts.map(post => {
                const cf = post.custom_fields || {}; const platforms = post.platform_versions || []
                const firstMedia = cf.media?.[0]
                return (
                  <div key={post.id} onClick={() => openEdit(post)} className="bg-white border border-gray-100 rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition-all group">
                    <div className="relative flex items-center justify-center p-3" style={{ backgroundColor: cf.bgColor || '#386797', minHeight: 90, maxHeight: 140 }}>
                      {firstMedia?.thumbnail_url && <img src={firstMedia.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />}
                      <p className="relative text-center font-bold leading-tight px-2 line-clamp-2 z-10" style={{ color: cf.textColor || '#fff', fontSize: '11px' }}>{cf.hook || cf.overlayText || post.content_original?.split('\n')[0]?.slice(0, 60)}</p>
                      <div className="absolute top-1.5 left-1.5 flex gap-1 z-10">
                        <span className={`text-[7px] font-bold uppercase px-1.5 py-0.5 rounded ${post.status === 'draft' ? 'bg-white/80 text-gray-600' : post.status === 'scheduled' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'}`}>{post.status}</span>
                        {cf.formatType && <span className="text-[7px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: (cf.formatType === 'reel' ? '#EF4444' : cf.formatType === 'carousel' ? '#10B981' : '#3B82F6'), color: '#fff' }}>{cf.formatType}</span>}
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex gap-0.5 z-10">{platforms.map((v: any) => <span key={v.platform} className="text-[7px] font-bold bg-white/80 px-1 py-0.5 rounded" style={{ color: PL[v.platform]?.color }}>{PL[v.platform]?.icon}</span>)}</div>
                      {cf.media?.length > 1 && <span className="absolute bottom-1 left-1 text-[7px] bg-black/50 text-white px-1 py-0.5 rounded z-10">{cf.media.length} media</span>}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center z-10"><Edit3 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-all" /></div>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] text-np-dark line-clamp-2 leading-relaxed">{post.content_original}</p>
                      {post.hashtags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{post.hashtags.slice(0, 4).map((h: string, i: number) => <span key={i} className="text-[8px] text-np-blue">#{h}</span>)}</div>}
                      <div className="flex items-center justify-between mt-1.5"><span className="text-[8px] text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>{post.scheduled_at && <span className="text-[8px] text-blue-500 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{new Date(post.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* VOICES */}
      {tab === 'voices' && (
        <div className="flex-1 overflow-y-auto max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4"><div><h2 className="text-base font-bold text-np-dark">Advisory Voices</h2></div><button onClick={() => openVoiceEditor('new')} className="text-xs px-3 py-1.5 bg-np-blue text-white rounded-lg font-medium">+ Add</button></div>
          <div className="grid grid-cols-2 gap-3">{voices.map(v => (
            <div key={v.id} className="bg-white border border-gray-100 rounded-xl p-3.5" style={{ borderLeftWidth: 4, borderLeftColor: v.color }}>
              <div className="flex items-start justify-between mb-2"><div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: v.color }}>{v.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div><div><div className="text-sm font-bold text-np-dark">{v.name}</div><div className="text-[10px]" style={{ color: v.color }}>{v.role}</div></div></div><div className="flex gap-1"><button onClick={() => openVoiceEditor(v)} className="text-[10px] text-gray-400 hover:text-np-blue">Edit</button><button onClick={() => setVoices(prev => prev.map(x => x.id === v.id ? { ...x, on: !x.on } : x))} className={`text-[9px] px-2 py-0.5 rounded font-bold border ${v.on ? 'text-white' : 'text-gray-400 border-gray-200'}`} style={v.on ? { backgroundColor: v.color, borderColor: v.color } : {}}>{v.on ? 'Active' : 'Off'}</button></div></div>
              <p className="text-[11px] text-gray-500 leading-relaxed">{v.persp}</p>
            </div>
          ))}</div>
          <div className="mt-4 bg-gray-50 border border-gray-100 rounded-xl p-3"><div className="text-[10px] font-bold text-gray-400 mb-2">Suggested</div><div className="flex flex-wrap gap-1.5">{VOICE_SUGGESTIONS.filter(n => !voices.find(v => v.name === n)).map(n => <button key={n} onClick={() => { setVoiceForm({ name: n, role: '', persp: '', color: '#8B5CF6' }); setEditVoice('new') }} className="text-[10px] px-2.5 py-1 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-white hover:border-np-blue hover:text-np-blue">+ {n}</button>)}</div></div>
        </div>
      )}

      {/* Media Picker Modal */}
      {mediaPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMediaPicker(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-np-dark">Select {mediaPicker.type === 'video' ? 'Video' : 'Image'} from Library</h3>
              <button onClick={() => setMediaPicker(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="px-5 py-2 border-b border-gray-100">
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400" />
                <input value={mediaSearch} onChange={e => setMediaSearch(e.target.value)} placeholder="Search media..." className="text-sm flex-1 outline-none placeholder-gray-300" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {mediaLoading ? <div className="text-center py-8 text-gray-400 text-sm">Loading library...</div> :
                filteredMedia.length === 0 ? <div className="text-center py-8 text-gray-400 text-sm">No {mediaPicker.type === 'video' ? 'videos' : 'images'} found. Upload media in the Media Library.</div> : (
                <div className="grid grid-cols-3 gap-2">
                  {filteredMedia.map(asset => (
                    <button key={asset.id} onClick={() => assignMedia(asset)} className="group relative rounded-lg overflow-hidden border-2 border-transparent hover:border-np-blue transition-all aspect-square">
                      {asset.thumbnail_url || asset.mime_type?.startsWith('image') ? (
                        <img src={asset.thumbnail_url || asset.url} alt={asset.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center"><Film className="w-8 h-8 text-gray-300" /></div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center"><Check className="w-6 h-6 text-white opacity-0 group-hover:opacity-100" /></div>
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-0.5"><span className="text-[8px] text-white truncate block">{asset.name}</span></div>
                      {asset.mime_type?.startsWith('video') && <span className="absolute top-1 left-1 text-[7px] bg-red-500 text-white px-1 rounded font-bold">VID</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Post Modal */}
      {editPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditPost(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="text-sm font-bold text-np-dark">Edit Post</h3><button onClick={() => setEditPost(null)}><X className="w-4 h-4 text-gray-400" /></button></div>
            <div className="p-6 flex gap-6">
              <div className="w-44 flex-shrink-0">
                {(() => { const cf = editPost.custom_fields || {}; return (
                  <div className="rounded-xl overflow-hidden relative flex items-center justify-center p-3" style={{ backgroundColor: cf.bgColor || '#386797', aspectRatio: '1/1', maxHeight: 180 }}>
                    {cf.media?.[0]?.thumbnail_url && <img src={cf.media[0].thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />}
                    <p className="relative text-center font-bold leading-tight z-10" style={{ color: cf.textColor || '#fff', fontSize: '11px' }}>{cf.hook || cf.overlayText || 'Preview'}</p>
                    {cf.formatType && <span className="absolute top-1 left-1 text-[7px] font-bold uppercase px-1.5 py-0.5 rounded text-white z-10" style={{ backgroundColor: cf.formatType === 'reel' ? '#EF4444' : cf.formatType === 'carousel' ? '#10B981' : '#3B82F6' }}>{cf.formatType}</span>}
                  </div>
                ) })()}
                {editPost.custom_fields?.media?.length > 0 && <div className="flex gap-1 mt-2 overflow-x-auto">{editPost.custom_fields.media.map((m: any, i: number) => <div key={i} className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-gray-100">{m.thumbnail_url ? <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" /> : <Film className="w-4 h-4 text-gray-400 m-auto mt-2" />}</div>)}</div>}
              </div>
              <div className="flex-1 space-y-3">
                <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Caption</label><textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={6} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" /><span className="text-[8px] text-gray-400">{editCaption.length} chars</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Date</label><input type="date" value={editScheduleDate} onChange={e => setEditScheduleDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2" /></div>
                  <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label><input type="time" value={editScheduleTime} onChange={e => setEditScheduleTime(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2" /></div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={saveEdit} disabled={saving} className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {editScheduleDate ? 'Schedule' : 'Save'}</button>
                  <button onClick={() => setEditPost(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
                  <button onClick={async () => { await supabase.from('social_posts').delete().eq('id', editPost.id); await fetchPosts(); setEditPost(null) }} className="text-xs py-2 px-4 text-red-500 hover:bg-red-50 rounded-lg ml-auto">Delete</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voice Modal */}
      {editVoice !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditVoice(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">{editVoice === 'new' ? 'Add Voice' : 'Edit Voice'}</h3><button onClick={() => setEditVoice(null)}><X className="w-4 h-4 text-gray-400" /></button></div>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Name *</label><input value={voiceForm.name} onChange={e => setVoiceForm({ ...voiceForm, name: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Role</label><input value={voiceForm.role} onChange={e => setVoiceForm({ ...voiceForm, role: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Perspective</label><textarea value={voiceForm.persp} onChange={e => setVoiceForm({ ...voiceForm, persp: e.target.value })} rows={3} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" /></div>
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
