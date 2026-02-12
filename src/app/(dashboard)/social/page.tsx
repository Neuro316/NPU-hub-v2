'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { Send, X, Loader2, Copy, Check, Plus, Calendar, Trash2, Save, Film, Image, FileText, Edit3, Clock, ChevronDown, ChevronUp } from 'lucide-react'

// --- PLATFORM CONFIG ---
const PL: Record<string, { name: string; icon: string; color: string; cl: number; formats: Array<{ id: string; name: string; w: number; h: number; r: string }> }> = {
  instagram: { name: 'Instagram', icon: 'IG', color: '#E1306C', cl: 2200, formats: [{ id: 'ig-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'ig-port', name: 'Portrait', w: 1080, h: 1350, r: '4:5' }, { id: 'ig-story', name: 'Story/Reel', w: 1080, h: 1920, r: '9:16' }, { id: 'ig-land', name: 'Landscape', w: 1080, h: 566, r: '1.91:1' }] },
  facebook: { name: 'Facebook', icon: 'FB', color: '#1877F2', cl: 63206, formats: [{ id: 'fb-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'fb-land', name: 'Landscape', w: 1200, h: 630, r: '1.91:1' }, { id: 'fb-story', name: 'Story', w: 1080, h: 1920, r: '9:16' }] },
  linkedin: { name: 'LinkedIn', icon: 'LI', color: '#0A66C2', cl: 3000, formats: [{ id: 'li-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }, { id: 'li-port', name: 'Portrait', w: 1080, h: 1350, r: '4:5' }, { id: 'li-land', name: 'Landscape', w: 1200, h: 627, r: '1.91:1' }, { id: 'li-art', name: 'Article', w: 1280, h: 720, r: '16:9' }] },
  tiktok: { name: 'TikTok', icon: 'TT', color: '#010101', cl: 2200, formats: [{ id: 'tt-vid', name: 'Video', w: 1080, h: 1920, r: '9:16' }] },
  x: { name: 'X (Twitter)', icon: 'X', color: '#1DA1F2', cl: 280, formats: [{ id: 'tw-img', name: 'Image', w: 1600, h: 900, r: '16:9' }, { id: 'tw-sq', name: 'Square', w: 1080, h: 1080, r: '1:1' }] },
  youtube: { name: 'YouTube', icon: 'YT', color: '#FF0000', cl: 5000, formats: [{ id: 'yt-thumb', name: 'Thumbnail', w: 1280, h: 720, r: '16:9' }, { id: 'yt-short', name: 'Short', w: 1080, h: 1920, r: '9:16' }] },
}

const CONTENT_TYPES = [
  { id: 'edu', name: 'Educational' },
  { id: 'story', name: 'Story' },
  { id: 'promo', name: 'Promotional' },
  { id: 'engage', name: 'Engagement' },
  { id: 'authority', name: 'Authority' },
  { id: 'bts', name: 'Behind Scenes' },
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

interface AIMessage { role: 'ai' | 'user'; content: string }

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [tab, setTab] = useState<'create' | 'posts' | 'voices'>('create')
  const [brand, setBrand] = useState('np')
  const [contentType, setContentType] = useState('edu')
  const [plats, setPlats] = useState<string[]>(['instagram', 'linkedin'])
  const [fmts, setFmts] = useState<Record<string, string>>({ instagram: 'ig-sq', linkedin: 'li-sq' })
  const [voices, setVoices] = useState<Voice[]>(DEFAULT_VOICES)

  // Chat
  const [msgs, setMsgs] = useState<AIMessage[]>([])
  const [inp, setInp] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  // Right panel preview content
  const [previewCaption, setPreviewCaption] = useState('')
  const [previewOverlay, setPreviewOverlay] = useState('')
  const [previewBg, setPreviewBg] = useState('#386797')
  const [previewTextColor, setPreviewTextColor] = useState('#FFFFFF')

  // Posts
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Edit modal
  const [editPost, setEditPost] = useState<any | null>(null)
  const [editCaption, setEditCaption] = useState('')
  const [editScheduleDate, setEditScheduleDate] = useState('')
  const [editScheduleTime, setEditScheduleTime] = useState('')

  // Voice editor
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
    setMsgs([{ role: 'ai', content: `Welcome to the Social Media Designer. I'm your AI CMO.\n\n${av.length ? `Active voices: ${av.map(v => v.name).join(', ')}` : 'No advisory voices selected.'}\nBrand: ${brand === 'np' ? 'Neuro Progeny' : 'Sensorium Wellness'}\nPlatforms: ${plats.map(p => PL[p]?.name).join(', ')}\n\nDescribe what you want to post and I'll create platform-ready content with image direction and video scripts. Click "Use This" on any response to load it into the preview cards.` }])
  }, [brand])

  const togglePlat = (pid: string) => {
    setPlats(prev => {
      if (prev.includes(pid)) return prev.length > 1 ? prev.filter(p => p !== pid) : prev
      return [...prev, pid]
    })
    if (!fmts[pid]) setFmts(prev => ({ ...prev, [pid]: PL[pid]?.formats[0]?.id || '' }))
  }

  // ---- AI ----
  const buildSystemPrompt = async () => {
    const br = brand === 'np' ? 'Neuro Progeny' : 'Sensorium Wellness'
    const av = voices.filter(v => v.on)
    const pn = plats.map(p => `${PL[p]?.name} (${PL[p]?.cl} chars, ${PL[p]?.formats.find(f => f.id === fmts[p])?.name || PL[p]?.formats[0]?.name} ${PL[p]?.formats.find(f => f.id === fmts[p])?.r || PL[p]?.formats[0]?.r})`).join('\n')
    const ti = CONTENT_TYPES.find(t => t.id === contentType)
    let s = `You are a world-class CMO and social media strategist for ${br}.

CORE RULES: NEVER use treatment/therapy/fix/broken/disorder/cure/patient/calm-chasing/sympathovagal balance. ALWAYS use capacity/training/regulation/adaptive/bandwidth/state fluidity/mirror. No em dashes. Forward-facing questions only.

PLATFORMS:\n${pn}\nContent type: ${ti?.name || 'Educational'}\n\n`
    if (av.length) { s += 'ADVISORY VOICES:\n\n'; av.forEach(v => { s += `${v.name} (${v.role}): ${v.persp}\n\n` }) }
    if (currentOrg) {
      const { data } = await supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', brand).single()
      if (data?.guidelines) {
        const g = data.guidelines
        if (g.core_messages?.length) s += `Core Messages: ${g.core_messages.join(' | ')}\n`
        if (g.positioning_statement) s += `Positioning: ${g.positioning_statement}\n`
      }
    }
    s += `\nFOR EACH PLATFORM provide: 1) Full Caption within char limit 2) Hook (first line) 3) Image Direction (detailed visual for designer/AI gen) 4) Video Script if reel/video (timing, on-screen text, b-roll, audio) 5) Hashtags 6) Brand Alignment Score 1-10 7) One insight per active voice\n\nBe tactical and specific. Immediately actionable.`
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
      if (data.error) { setMsgs([...newMsgs, { role: 'ai', content: `Error: ${data.error}\n\nMake sure ANTHROPIC_API_KEY is set in Vercel > Settings > Environment Variables, then redeploy.` }]) }
      else { setMsgs([...newMsgs, { role: 'ai', content: data.content }]) }
    } catch (err: any) { setMsgs([...newMsgs, { role: 'ai', content: `Connection error: ${err.message}` }]) }
    setBusy(false)
  }

  // Push AI content into preview cards
  const useContent = (content: string) => {
    setPreviewCaption(content)
    const firstLine = content.split('\n')[0].replace(/\*\*/g, '').slice(0, 60)
    setPreviewOverlay(firstLine)
  }

  // Save current preview as draft
  const saveDraft = async () => {
    if (!currentOrg || !previewCaption.trim()) return
    setSaving(true)
    await supabase.from('social_posts').insert({
      org_id: currentOrg.id, brand, content_original: previewCaption,
      platform_versions: plats.map(p => {
        const f = PL[p]?.formats.find(x => x.id === fmts[p]) || PL[p]?.formats[0]
        return { platform: p, content: previewCaption, format: { id: f?.id, name: f?.name, w: f?.w, h: f?.h, r: f?.r } }
      }),
      hashtags: previewCaption.match(/#(\w+)/g)?.map(h => h.replace('#', '')) || [],
      status: 'draft',
      custom_fields: { contentType, overlayText: previewOverlay, bgColor: previewBg, textColor: previewTextColor, formats: fmts },
    }).select()
    await fetchPosts()
    setSaving(false)
  }

  // Edit post
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
      content_original: editCaption,
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: scheduledAt || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editPost.id)
    await fetchPosts()
    setSaving(false)
    setEditPost(null)
  }

  const copyText = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000) }

  const openVoiceEditor = (v: Voice | 'new') => {
    setEditVoice(v)
    if (v === 'new') setVoiceForm({ name: '', role: '', persp: '', color: '#8B5CF6' })
    else setVoiceForm({ name: v.name, role: v.role, persp: v.persp, color: v.color })
  }
  const saveVoice = () => {
    if (!voiceForm.name.trim()) return
    if (editVoice === 'new') setVoices(prev => [...prev, { ...voiceForm, id: `v-${Date.now()}`, on: true }])
    else if (editVoice) setVoices(prev => prev.map(v => v.id === editVoice.id ? { ...v, ...voiceForm } : v))
    setEditVoice(null)
  }

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media Designer</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">AI CMO | {voices.filter(v => v.on).length} voice{voices.filter(v => v.on).length !== 1 ? 's' : ''} active | {plats.map(p => PL[p]?.icon).join(' ')}</p>
        </div>
        <div className="flex gap-1.5">
          {([['create', 'Create'], ['posts', `Posts (${posts.length})`], ['voices', `Voices (${voices.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k as any)}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border ${tab === k ? 'bg-np-blue text-white border-np-blue' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
          ))}
          <Link href="/calendar" className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Calendar
          </Link>
        </div>
      </div>

      {/* ====== CREATE TAB: 3-PANEL ====== */}
      {tab === 'create' && (
        <div className="flex-1 grid grid-cols-[240px_1fr_280px] gap-3 min-h-0">

          {/* LEFT: Controls */}
          <div className="overflow-y-auto space-y-2 pr-1">
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Brand</div>
              {[{ k: 'np', n: 'Neuro Progeny', c: ['#1B365D', '#476B8E', '#386797'] }, { k: 'sensorium', n: 'Sensorium Wellness', c: ['#2A9D8F', '#264653', '#E9C46A'] }].map(b => (
                <div key={b.k} onClick={() => setBrand(b.k)}
                  className={`flex items-center gap-2 px-2.5 py-2 mb-1 rounded-lg cursor-pointer border ${brand === b.k ? 'border-np-blue/30 bg-np-blue/5' : 'border-transparent hover:bg-gray-50'}`}>
                  <div className="flex gap-0.5">{b.c.map((c, i) => <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}</div>
                  <span className={`text-xs ${brand === b.k ? 'font-bold text-np-dark' : 'text-gray-500'}`}>{b.n}</span>
                </div>
              ))}
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Content Type</div>
              <div className="grid grid-cols-2 gap-1">
                {CONTENT_TYPES.map(t => (
                  <button key={t.id} onClick={() => setContentType(t.id)}
                    className={`py-1.5 px-2 rounded-lg text-left ${contentType === t.id ? 'bg-np-blue/10 border border-np-blue/30' : 'bg-gray-50 border border-transparent hover:bg-gray-100'}`}>
                    <div className={`text-[10px] ${contentType === t.id ? 'text-np-blue font-bold' : 'text-gray-500'}`}>{t.name}</div>
                  </button>
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
                    <span className="text-[8px] text-gray-400 ml-auto">{pl.cl}</span>
                  </div>
                  {plats.includes(pid) && (
                    <div className="flex gap-1 flex-wrap pl-6 mt-0.5">
                      {pl.formats.map(f => (
                        <button key={f.id} onClick={() => setFmts(prev => ({ ...prev, [pid]: f.id }))}
                          className={`text-[8px] px-1.5 py-0.5 rounded border ${fmts[pid] === f.id ? 'font-bold' : 'text-gray-400 border-gray-200'}`}
                          style={fmts[pid] === f.id ? { color: pl.color, borderColor: pl.color + '60', backgroundColor: pl.color + '10' } : {}}>
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Active Voices</div>
                <button onClick={() => setTab('voices')} className="text-[9px] text-np-blue font-medium">Manage</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {voices.filter(v => v.on).map(v => (
                  <button key={v.id} onClick={() => setVoices(prev => prev.map(x => x.id === v.id ? { ...x, on: false } : x))}
                    className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-lg border font-medium"
                    style={{ borderColor: v.color + '40', backgroundColor: v.color + '10', color: v.color }}>
                    <span className="w-3.5 h-3.5 rounded-full text-white text-[7px] font-bold flex items-center justify-center" style={{ backgroundColor: v.color }}>
                      {v.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </span>
                    {v.name}
                  </button>
                ))}
                {!voices.some(v => v.on) && <span className="text-[10px] text-gray-400 italic">None selected</span>}
              </div>
            </div>
          </div>

          {/* CENTER: Chat */}
          <div className="bg-white border border-gray-100 rounded-xl flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <span className="text-xs font-bold text-purple-600">CMO AI Assistant</span>
            </div>
            <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-np-blue text-white rounded-br-sm' : 'bg-gray-50 text-np-dark border border-gray-100 rounded-bl-sm'}`}>
                    {m.role === 'ai' && <div className="text-[8px] font-bold text-purple-500 uppercase tracking-wider mb-1">CMO AI</div>}
                    {m.content}
                    {m.role === 'ai' && i > 0 && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                        <button onClick={() => useContent(m.content)}
                          className="text-[9px] flex items-center gap-1 px-2.5 py-1 bg-np-blue text-white rounded-lg font-medium hover:bg-np-blue/90">
                          <Image className="w-3 h-3" /> Use This
                        </button>
                        <button onClick={() => copyText(m.content, `msg-${i}`)}
                          className="text-[9px] flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-500 rounded-lg font-medium hover:bg-gray-200">
                          {copiedId === `msg-${i}` ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-gray-400">Generating through {voices.filter(v => v.on).length} voices...</span>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100">
              <div className="flex gap-2">
                <input value={inp} onChange={e => setInp(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Describe content, paste a draft, ask for strategy..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder-gray-300" />
                <button onClick={send} disabled={busy}
                  className="px-4 py-2 bg-np-blue text-white rounded-xl hover:bg-np-blue/90 disabled:opacity-50">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Live Preview Cards with Content */}
          <div className="overflow-y-auto space-y-2 pl-1">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Preview Cards</div>
              <button onClick={saveDraft} disabled={saving || !previewCaption.trim()}
                className="text-[9px] px-2.5 py-1 bg-np-blue text-white rounded-lg font-medium disabled:opacity-40 flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Draft
              </button>
            </div>

            {/* Caption input */}
            <div className="bg-white border border-gray-100 rounded-xl p-2.5">
              <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Caption</div>
              <textarea value={previewCaption} onChange={e => setPreviewCaption(e.target.value)}
                rows={3} placeholder="Click 'Use This' on an AI response or type directly..."
                className="w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none leading-relaxed" />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[8px] text-gray-400">{previewCaption.length} chars</span>
              </div>
            </div>

            {/* Overlay & color controls */}
            <div className="bg-white border border-gray-100 rounded-xl p-2.5">
              <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Image Text Overlay</div>
              <input value={previewOverlay} onChange={e => setPreviewOverlay(e.target.value)} placeholder="Text on image..."
                className="w-full text-[10px] border border-gray-200 rounded-lg px-2.5 py-1 focus:outline-none mb-1.5" />
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[8px] text-gray-400 mb-0.5">Background</div>
                  <div className="flex gap-1">
                    {['#386797', '#1A1A2E', '#10B981', '#E1306C', '#8B5CF6', '#F59E0B'].map(c => (
                      <button key={c} onClick={() => setPreviewBg(c)} className="w-4 h-4 rounded-full border" style={{ backgroundColor: c, borderColor: previewBg === c ? '#000' : 'transparent', borderWidth: previewBg === c ? 2 : 1 }} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] text-gray-400 mb-0.5">Text</div>
                  <div className="flex gap-1">
                    <button onClick={() => setPreviewTextColor('#FFFFFF')} className="w-4 h-4 rounded-full border border-gray-300 bg-white" style={{ borderWidth: previewTextColor === '#FFFFFF' ? 2 : 1, borderColor: previewTextColor === '#FFFFFF' ? '#000' : '#ccc' }} />
                    <button onClick={() => setPreviewTextColor('#1A1A2E')} className="w-4 h-4 rounded-full bg-gray-900" style={{ border: previewTextColor === '#1A1A2E' ? '2px solid #3B82F6' : '1px solid transparent' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Platform preview cards */}
            {plats.map(pid => {
              const pl = PL[pid]
              if (!pl) return null
              const f = pl.formats.find(x => x.id === fmts[pid]) || pl.formats[0]
              const scale = Math.min(240 / f.w, 160 / f.h)
              const charCount = previewCaption.length
              const overLimit = charCount > pl.cl
              return (
                <div key={pid} className="bg-white border border-gray-100 rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold" style={{ color: pl.color }}>{pl.icon} {pl.name}</span>
                    <span className="text-[8px] text-gray-400">{f.name} {f.r}</span>
                  </div>
                  {/* Visual mockup with content */}
                  <div className="flex items-center justify-center mb-1.5">
                    <div className="rounded-lg overflow-hidden relative flex items-center justify-center"
                      style={{ width: Math.round(f.w * scale), height: Math.round(f.h * scale), backgroundColor: previewBg }}>
                      {previewOverlay ? (
                        <p className="text-center font-bold leading-tight px-2" style={{ color: previewTextColor, fontSize: f.h > f.w ? '11px' : '10px' }}>
                          {previewOverlay}
                        </p>
                      ) : (
                        <span className="text-[8px] opacity-40" style={{ color: previewTextColor }}>{f.w}x{f.h}</span>
                      )}
                    </div>
                  </div>
                  {/* Caption preview */}
                  {previewCaption && (
                    <div className="border border-gray-100 rounded-lg p-2 mb-1">
                      <p className="text-[9px] text-gray-600 line-clamp-4 leading-relaxed whitespace-pre-wrap">{previewCaption}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className={`text-[8px] font-bold ${overLimit ? 'text-red-500' : 'text-gray-400'}`}>
                      {charCount}/{pl.cl} {overLimit ? '(over limit!)' : ''}
                    </span>
                    <button onClick={() => copyText(previewCaption, `prev-${pid}`)}
                      className="text-[8px] text-gray-400 hover:text-np-blue">
                      {copiedId === `prev-${pid}` ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )
            })}
            {plats.length === 0 && <div className="text-center py-8 text-gray-400 text-xs">Select platforms</div>}
          </div>
        </div>
      )}

      {/* ====== POSTS TAB ====== */}
      {tab === 'posts' && (
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="text-center py-8 text-gray-400 text-sm">Loading...</div> : posts.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
              <Send className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">No Posts Yet</h2>
              <p className="text-sm text-gray-500 mb-4">Create content in the Create tab, then save as drafts.</p>
              <button onClick={() => setTab('create')} className="btn-primary text-sm py-2.5 px-5">Start Creating</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {posts.map(post => {
                const cf = post.custom_fields || {}
                const platforms = post.platform_versions || []
                const firstPlat = platforms[0]?.platform
                const pl = firstPlat ? PL[firstPlat] : null
                const fmt = firstPlat && platforms[0]?.format ? platforms[0].format : null
                const scale = fmt ? Math.min(180 / fmt.w, 100 / fmt.h) : 0
                return (
                  <div key={post.id} onClick={() => openEdit(post)}
                    className="bg-white border border-gray-100 rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition-all group">
                    {/* Visual card header */}
                    <div className="relative flex items-center justify-center"
                      style={{ backgroundColor: cf.bgColor || '#386797', minHeight: 100, aspectRatio: fmt ? `${fmt.w}/${fmt.h}` : '1/1', maxHeight: 160 }}>
                      {cf.overlayText ? (
                        <p className="text-center font-bold leading-tight px-3" style={{ color: cf.textColor || '#fff', fontSize: '12px' }}>{cf.overlayText}</p>
                      ) : (
                        <p className="text-center font-medium leading-tight px-4 line-clamp-3" style={{ color: '#ffffff99', fontSize: '10px' }}>{post.content_original?.slice(0, 80)}</p>
                      )}
                      {/* Status badge */}
                      <div className="absolute top-2 left-2">
                        <span className={`text-[7px] font-bold uppercase px-1.5 py-0.5 rounded ${post.status === 'draft' ? 'bg-white/80 text-gray-600' : post.status === 'scheduled' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'}`}>{post.status}</span>
                      </div>
                      {/* Platform badges */}
                      <div className="absolute top-2 right-2 flex gap-1">
                        {platforms.map((v: any) => (
                          <span key={v.platform} className="text-[8px] font-bold bg-white/80 px-1 py-0.5 rounded" style={{ color: PL[v.platform]?.color }}>{PL[v.platform]?.icon}</span>
                        ))}
                      </div>
                      {/* Format badge */}
                      {fmt && (
                        <div className="absolute bottom-2 right-2">
                          <span className="text-[7px] bg-black/40 text-white px-1.5 py-0.5 rounded">{fmt.name} {fmt.r}</span>
                        </div>
                      )}
                      {/* Edit overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <Edit3 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    </div>
                    {/* Card body */}
                    <div className="p-3">
                      <p className="text-[11px] text-np-dark line-clamp-2 leading-relaxed">{post.content_original}</p>
                      {post.hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">{post.hashtags.slice(0, 5).map((h: string, i: number) => <span key={i} className="text-[8px] text-np-blue font-medium">#{h}</span>)}</div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[8px] text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>
                        {post.scheduled_at && <span className="text-[8px] text-blue-500 font-medium flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{new Date(post.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== VOICES TAB ====== */}
      {tab === 'voices' && (
        <div className="flex-1 overflow-y-auto max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-np-dark">Advisory Voices</h2>
              <p className="text-xs text-gray-500 mt-0.5">AI analyzes through each selected lens simultaneously.</p>
            </div>
            <button onClick={() => openVoiceEditor('new')} className="text-xs px-3 py-1.5 bg-np-blue text-white rounded-lg font-medium">+ Add Voice</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {voices.map(v => (
              <div key={v.id} className="bg-white border border-gray-100 rounded-xl p-3.5" style={{ borderLeftWidth: 4, borderLeftColor: v.color }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: v.color }}>{v.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                    <div>
                      <div className="text-sm font-bold text-np-dark">{v.name}</div>
                      <div className="text-[10px] font-medium" style={{ color: v.color }}>{v.role}</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openVoiceEditor(v)} className="text-[10px] text-gray-400 hover:text-np-blue">Edit</button>
                    <button onClick={() => setVoices(prev => prev.map(x => x.id === v.id ? { ...x, on: !x.on } : x))}
                      className={`text-[9px] px-2 py-0.5 rounded font-bold border ${v.on ? 'text-white' : 'text-gray-400 border-gray-200'}`}
                      style={v.on ? { backgroundColor: v.color, borderColor: v.color } : {}}>
                      {v.on ? 'Active' : 'Off'}
                    </button>
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
                <button key={n} onClick={() => { setVoiceForm({ name: n, role: '', persp: '', color: '#8B5CF6' }); setEditVoice('new') }}
                  className="text-[10px] px-2.5 py-1 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-white hover:border-np-blue hover:text-np-blue">+ {n}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====== EDIT POST MODAL ====== */}
      {editPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditPost(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-np-dark">Edit Post</h3>
              <button onClick={() => setEditPost(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <div className="flex gap-6">
                {/* Left: Preview card */}
                <div className="w-48 flex-shrink-0">
                  {(() => {
                    const cf = editPost.custom_fields || {}
                    const firstPlat = editPost.platform_versions?.[0]?.platform
                    const fmt = editPost.platform_versions?.[0]?.format
                    return (
                      <div className="rounded-xl overflow-hidden relative flex items-center justify-center"
                        style={{ backgroundColor: cf.bgColor || '#386797', aspectRatio: fmt ? `${fmt.w}/${fmt.h}` : '1/1', maxHeight: 240 }}>
                        <p className="text-center font-bold leading-tight px-3" style={{ color: cf.textColor || '#fff', fontSize: '12px' }}>
                          {cf.overlayText || editCaption.split('\n')[0]?.slice(0, 50) || 'Preview'}
                        </p>
                        {fmt && <span className="absolute bottom-1 right-1 text-[7px] bg-black/40 text-white px-1 py-0.5 rounded">{fmt.name} {fmt.r}</span>}
                      </div>
                    )
                  })()}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {editPost.platform_versions?.map((v: any) => (
                      <span key={v.platform} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: PL[v.platform]?.color, backgroundColor: PL[v.platform]?.color + '15' }}>
                        {PL[v.platform]?.icon} {PL[v.platform]?.name}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Right: Edit form */}
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Caption</label>
                    <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={6}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
                    <span className="text-[8px] text-gray-400">{editCaption.length} chars</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Schedule Date</label>
                      <input type="date" value={editScheduleDate} onChange={e => setEditScheduleDate(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Time</label>
                      <input type="time" value={editScheduleTime} onChange={e => setEditScheduleTime(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={saveEdit} disabled={saving} className="btn-primary text-xs py-2 px-4 disabled:opacity-50 flex items-center gap-1.5">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {editScheduleDate ? 'Schedule' : 'Save Changes'}
                    </button>
                    <button onClick={() => setEditPost(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
                    <button onClick={async () => { await supabase.from('social_posts').delete().eq('id', editPost.id); await fetchPosts(); setEditPost(null) }}
                      className="text-xs py-2 px-4 text-red-500 hover:bg-red-50 rounded-lg ml-auto">Delete</button>
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">{editVoice === 'new' ? 'Add Voice' : 'Edit Voice'}</h3>
              <button onClick={() => setEditVoice(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Name *</label>
                <input value={voiceForm.name} onChange={e => setVoiceForm({ ...voiceForm, name: e.target.value })} placeholder="Alex Hormozi, ACT Framework..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Role / Expertise</label>
                <input value={voiceForm.role} onChange={e => setVoiceForm({ ...voiceForm, role: e.target.value })} placeholder="Growth strategist..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Perspective</label>
                <textarea value={voiceForm.persp} onChange={e => setVoiceForm({ ...voiceForm, persp: e.target.value })} rows={3} placeholder="What lens do they use?"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {VOICE_COLORS.map(c => (
                    <button key={c} onClick={() => setVoiceForm({ ...voiceForm, color: c })}
                      className="w-6 h-6 rounded-full" style={{ backgroundColor: c, border: voiceForm.color === c ? '3px solid #1A1A2E' : '3px solid transparent' }} />
                  ))}
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <div>
                  {editVoice !== 'new' && (
                    <button onClick={() => { setVoices(prev => prev.filter(v => v.id !== (editVoice as Voice).id)); setEditVoice(null) }}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-500 rounded-lg font-medium border border-red-200">Delete</button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditVoice(null)} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
                  <button onClick={saveVoice} className="btn-primary text-xs py-1.5 px-3">Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
