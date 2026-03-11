'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  ArrowLeft, Mic, MessageCircle, Smartphone, Heart, Brain,
  Copy, ExternalLink, Check, Calendar,
  Instagram, Linkedin, Twitter, Youtube, Facebook,
} from 'lucide-react'

/* ═══ Types ═══ */

interface Appearance {
  id: string
  title: string
  platform: string | null
  host: string | null
  air_date: string | null
  recording_date: string | null
  key_topics: string[]
  key_quotes: string[]
  verbal_cta: string | null
  promo_code: string | null
  status: string
  url: string | null
}

interface GuestProfile {
  name: string
  title: string
  bio_short: string
  social: { instagram?: string; linkedin?: string; youtube?: string; x?: string }
}

/* ═══ Post Types ═══ */

interface PostType {
  key: string
  icon: any
  emoji: string
  label: string
  timing: string
  day: number
  color: string
  bg: string
  platforms: string[]
}

const POST_TYPES: PostType[] = [
  { key: 'announcement', icon: Mic, emoji: '🎙️', label: 'Episode Announcement', timing: 'Day of air date', day: 0, color: 'text-purple-600', bg: 'bg-purple-50', platforms: ['instagram', 'linkedin', 'x', 'youtube', 'facebook'] },
  { key: 'quote1', icon: MessageCircle, emoji: '💬', label: 'Quote Card #1', timing: 'Day 2', day: 2, color: 'text-violet-600', bg: 'bg-violet-50', platforms: ['instagram', 'linkedin'] },
  { key: 'quote2', icon: MessageCircle, emoji: '💬', label: 'Quote Card #2', timing: 'Day 5', day: 5, color: 'text-purple-600', bg: 'bg-purple-50', platforms: ['instagram', 'x'] },
  { key: 'carousel', icon: Smartphone, emoji: '📱', label: 'Key Takeaways Carousel', timing: 'Day 7', day: 7, color: 'text-pink-600', bg: 'bg-pink-50', platforms: ['instagram', 'linkedin'] },
  { key: 'thankyou', icon: Heart, emoji: '🙏', label: 'Thank You to Host', timing: 'Day 10', day: 10, color: 'text-rose-600', bg: 'bg-rose-50', platforms: ['instagram', 'linkedin', 'x', 'youtube', 'facebook'] },
  { key: 'reflection', icon: Brain, emoji: '💭', label: 'Episode Reflection', timing: 'Day 14', day: 14, color: 'text-emerald-600', bg: 'bg-emerald-50', platforms: ['linkedin', 'instagram'] },
]

const PLATFORM_INFO: { key: string; label: string; icon: any; color: string; formats: string[] }[] = [
  { key: 'instagram', label: 'Instagram', icon: Instagram, color: '#E4405F', formats: ['Post', 'Carousel', 'Reel', 'Story'] },
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: '#0A66C2', formats: ['Post', 'Article', 'Carousel', 'Video'] },
  { key: 'x', label: 'X / Twitter', icon: Twitter, color: '#1DA1F2', formats: ['Post', 'Thread', 'Video'] },
  { key: 'youtube', label: 'YouTube', icon: Youtube, color: '#FF0000', formats: ['Short', 'Community Post', 'Video'] },
  { key: 'facebook', label: 'Facebook', icon: Facebook, color: '#1877F2', formats: ['Post', 'Reel', 'Video', 'Story'] },
]

/* ═══ Text Generation ═══ */

function generatePostText(type: PostType, a: Appearance, profile: GuestProfile | null): string {
  const host = a.host || 'the host'
  const platform = a.platform || 'the show'
  const cta = a.verbal_cta || (a.url ? `Listen here: ${a.url}` : '')
  const promo = a.promo_code ? `Use code ${a.promo_code} for free access.` : ''
  const q1 = a.key_quotes?.[0] || ''
  const q2 = a.key_quotes?.[1] || a.key_quotes?.[0] || ''
  const topics = a.key_topics?.length ? a.key_topics : ['the topic']

  switch (type.key) {
    case 'announcement':
      return `I had an incredible conversation with ${host} on ${platform} about ${a.title}.\n\nWe dove into ${topics.slice(0, 3).join(', ')}${topics.length > 3 ? ' and more' : ''}.\n\n${cta}\n\n${promo}`.trim()
    case 'quote1':
      return q1 ? `"${q1}"\n\n— From my conversation with ${host} on ${platform}\n\n${cta}` : `Check out this highlight from my conversation with ${host} on ${platform}.\n\n${cta}`
    case 'quote2':
      return q2 ? `"${q2}"\n\n— ${platform} with ${host}\n\n${cta}` : `Another gem from the conversation with ${host}.\n\n${cta}`
    case 'carousel':
      return `Key takeaways from ${platform} with ${host}:\n\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nWhich one resonates most? Drop a comment.\n\n${cta}`
    case 'thankyou':
      return `Huge thank you to ${host} for the amazing conversation about ${a.title} on ${platform}.\n\nYour audience is incredible, and I loved diving deep into ${topics[0] || 'the topic'}.\n\n${promo ? promo + '\n\n' : ''}${cta}`
    case 'reflection':
      return `It's been two weeks since my episode on ${platform} with ${host} went live.\n\nOne thing that keeps coming back to me: ${topics[0] || 'the impact of this work'}.\n\nIf you haven't listened yet, the link is in my bio.\n\n${cta}`
    default:
      return ''
  }
}

/* ═══ Component ═══ */

export default function RepurposePage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()
  const { currentOrg } = useWorkspace()

  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [profile, setProfile] = useState<GuestProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'posts' | 'schedule' | 'platforms'>('posts')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(['instagram', 'linkedin', 'x']))

  useEffect(() => {
    if (!id || !currentOrg) return
    const load = async () => {
      setLoading(true)
      const [{ data: app }, { data: org }] = await Promise.all([
        supabase.from('media_appearances').select('*').eq('id', id).single(),
        supabase.from('organizations').select('guest_profile').eq('id', currentOrg.id).single(),
      ])
      if (app) setAppearance(app)
      if (org?.guest_profile) setProfile(org.guest_profile)
      setLoading(false)
    }
    load()
  }, [id, currentOrg?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>
  if (!appearance) return <div className="text-center py-20 text-gray-400">Appearance not found</div>

  const airDate = appearance.air_date ? new Date(appearance.air_date.replace(/([+-]\d{2}:\d{2}|Z)$/, '')) : null

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/media-affiliates" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-gray-500" />
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-np-dark">Repurpose Content</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {appearance.title} — {appearance.platform || 'Unknown'} with {appearance.host || 'Unknown'}
          </p>
        </div>
        {appearance.status && (
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-50 text-purple-600">
            {appearance.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-100">
        {[
          { key: 'posts', label: 'Post Overview' },
          { key: 'schedule', label: '14-Day Schedule' },
          { key: 'platforms', label: 'Platforms' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === t.key ? 'border-np-blue text-np-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ POST OVERVIEW TAB ═══ */}
      {tab === 'posts' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {POST_TYPES.map(pt => {
              const text = generatePostText(pt, appearance, profile)
              return (
                <div key={pt.key} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${pt.bg} flex-shrink-0`}>
                      <span className="text-lg">{pt.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-np-dark">{pt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{pt.timing}</p>
                    </div>
                    <div className="flex gap-0.5">
                      {pt.platforms.slice(0, 3).map(p => {
                        const pInfo = PLATFORM_INFO.find(pi => pi.key === p)
                        return pInfo ? <div key={p} className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: pInfo.color + '15' }}>
                          <pInfo.icon className="w-2.5 h-2.5" style={{ color: pInfo.color }} />
                        </div> : null
                      })}
                      {pt.platforms.length > 3 && <span className="text-[9px] text-gray-400">+{pt.platforms.length - 3}</span>}
                    </div>
                  </div>
                  <div className="px-4 pb-4 border-t border-gray-50">
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{text}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <a
                        href={`/social?source=repurpose&appearance_id=${id}&post_type=${pt.key}`}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-np-blue text-white rounded-lg hover:bg-np-blue/90 font-medium"
                      >
                        <ExternalLink className="w-3 h-3" /> Send to Social Creator
                      </a>
                      <button
                        onClick={() => copyText(pt.key, text)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                      >
                        {copiedKey === pt.key ? <><Check className="w-3 h-3 text-green-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy Text</>}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-6 text-center">
            <a
              href={`/social?source=repurpose&appearance_id=${id}&post_type=all`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-np-blue text-white rounded-xl text-sm font-semibold hover:bg-np-blue/90 transition-colors"
            >
              <Mic className="w-4 h-4" /> Generate All 6 Posts with AI
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* ═══ 14-DAY SCHEDULE TAB ═══ */}
      {tab === 'schedule' && (
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[19px] top-6 bottom-6 w-px bg-gray-200" />

            <div className="space-y-0">
              {POST_TYPES.map((pt, i) => {
                const Icon = pt.icon
                const postDate = airDate ? new Date(airDate.getTime() + pt.day * 86400000) : null
                const dateStr = postDate ? postDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : `Day ${pt.day}`
                return (
                  <div key={pt.key} className="flex items-start gap-4 py-4">
                    {/* Timeline dot */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${pt.bg} relative z-10 flex-shrink-0 border-2 border-white`}>
                      <span className="text-base">{pt.emoji}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-np-dark">{pt.label}</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{pt.timing}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {dateStr}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        {pt.platforms.map(p => {
                          const pInfo = PLATFORM_INFO.find(pi => pi.key === p)
                          if (!pInfo) return null
                          return (
                            <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                              style={{ backgroundColor: pInfo.color + '12', color: pInfo.color }}>
                              <pInfo.icon className="w-2.5 h-2.5" /> {pInfo.label}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ PLATFORMS TAB ═══ */}
      {tab === 'platforms' && (
        <div>
          {/* Platform selection */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            {PLATFORM_INFO.map(p => {
              const Icon = p.icon
              const selected = selectedPlatforms.has(p.key)
              return (
                <button key={p.key}
                  onClick={() => setSelectedPlatforms(prev => {
                    const next = new Set(prev)
                    next.has(p.key) ? next.delete(p.key) : next.add(p.key)
                    return next
                  })}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all
                    ${selected ? 'border-np-blue bg-np-blue/5' : 'border-gray-100 bg-white hover:border-gray-200'}`}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: selected ? p.color + '15' : '#f3f4f6' }}>
                    <Icon className="w-5 h-5" style={{ color: selected ? p.color : '#9ca3af' }} />
                  </div>
                  <span className={`text-xs font-medium ${selected ? 'text-np-dark' : 'text-gray-400'}`}>{p.label}</span>
                </button>
              )
            })}
          </div>

          {/* Selected platform formats */}
          <div className="space-y-3">
            {PLATFORM_INFO.filter(p => selectedPlatforms.has(p.key)).map(p => {
              const Icon = p.icon
              return (
                <div key={p.key} className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center gap-2.5 mb-3">
                    <Icon className="w-4 h-4" style={{ color: p.color }} />
                    <span className="text-sm font-semibold text-np-dark">{p.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.formats.map(f => (
                      <span key={f} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-600 border border-gray-100">
                        {f}
                      </span>
                    ))}
                  </div>
                  {/* Posts for this platform */}
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">Scheduled Posts</p>
                    <div className="space-y-1">
                      {POST_TYPES.filter(pt => pt.platforms.includes(p.key)).map(pt => (
                        <div key={pt.key} className="flex items-center gap-2 text-xs text-gray-600">
                          <span>{pt.emoji}</span>
                          <span className="flex-1">{pt.label}</span>
                          <span className="text-gray-400">{pt.timing}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
