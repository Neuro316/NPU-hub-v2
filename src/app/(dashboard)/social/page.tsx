'use client'

import { useState } from 'react'
import { useSocialData } from '@/lib/hooks/use-social-data'
import type { SocialPost, PlatformFormat } from '@/lib/hooks/use-social-data'
import { useWorkspace } from '@/lib/workspace-context'
import { Plus, Wand2, Send, Clock, Archive, Edit3, Trash2, Instagram, Hash, Eye, Sparkles, X } from 'lucide-react'

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: '📸' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: '📘' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: '💼' },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: '🎵' },
  { key: 'x', label: 'X (Twitter)', color: '#1DA1F2', icon: '𝕏' },
]

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  scheduled: { label: 'Scheduled', color: '#3B82F6', bg: '#DBEAFE' },
  published: { label: 'Published', color: '#10B981', bg: '#D1FAE5' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
}

export default function SocialPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { posts, formats, loading, addPost, updatePost, deletePost } = useSocialData()

  const [creating, setCreating] = useState(false)
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null)
  const [content, setContent] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram', 'linkedin'])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [brand, setBrand] = useState<string>('np')
  const [hashtags, setHashtags] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key])
  }

  const handleCreate = async () => {
    if (!content.trim()) return
    const platformVersions = selectedPlatforms.map(p => ({
      platform: p,
      content: content.trim(),
      formats: formats.filter(f => f.platform === p && selectedFormats.includes(f.id)).map(f => ({ id: f.id, name: f.format_name, width: f.width, height: f.height })),
    }))
    await addPost({
      brand,
      content_original: content.trim(),
      platform_versions: platformVersions,
      hashtags: hashtags.split(/[\s,]+/).filter(h => h.startsWith('#') || h.length > 0).map(h => h.startsWith('#') ? h : '#' + h).filter(Boolean),
      status: 'draft',
    } as any)
    setContent('')
    setHashtags('')
    setCreating(false)
  }

  const filteredPosts = statusFilter === 'all' ? posts : posts.filter(p => p.status === statusFilter)

  const platformFormats = (platform: string) => formats.filter(f => f.platform === platform)

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading social...</div></div>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Social Media Designer</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {posts.length} posts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New Post
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
            <Wand2 className="w-3.5 h-3.5" /> AI Content
          </button>
        </div>
      </div>

      {/* Post Creator */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-np-dark mb-4">Create Post</h3>

          {/* Brand + Platforms */}
          <div className="flex items-center gap-4 mb-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Brand</label>
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
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Platforms</label>
              <div className="flex gap-1.5">
                {PLATFORMS.map(p => (
                  <button key={p.key} onClick={() => togglePlatform(p.key)}
                    className={`text-sm px-2.5 py-1.5 rounded-lg border-2 transition-all ${selectedPlatforms.includes(p.key) ? 'border-current' : 'border-transparent bg-gray-100 opacity-40'}`}
                    style={selectedPlatforms.includes(p.key) ? { borderColor: p.color, color: p.color, backgroundColor: p.color + '10' } : {}}
                    title={p.label}>
                    {p.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Content</label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Write your post content... AI will adapt it for each platform."
              rows={4} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" autoFocus />
          </div>

          {/* Format Selector per Platform */}
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Formats</label>
            <div className="space-y-3">
              {selectedPlatforms.map(platKey => {
                const plat = PLATFORMS.find(p => p.key === platKey)
                const pFormats = platformFormats(platKey)
                return (
                  <div key={platKey}>
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: plat?.color }}>{plat?.icon} {plat?.label}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {pFormats.map(f => {
                        const isSelected = selectedFormats.includes(f.id)
                        return (
                          <button key={f.id}
                            onClick={() => setSelectedFormats(prev => isSelected ? prev.filter(id => id !== f.id) : [...prev, f.id])}
                            className={`text-[9px] px-2.5 py-1.5 rounded-lg border transition-all ${isSelected ? 'border-np-blue bg-np-blue/10 text-np-blue font-bold' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                            {f.format_name}
                            <span className="text-[7px] ml-1 opacity-60">{f.width}×{f.height}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Hashtags */}
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
              <Hash className="w-3 h-3" /> Hashtags
            </label>
            <input value={hashtags} onChange={e => setHashtags(e.target.value)}
              placeholder="#nervoussystem #biofeedback #capacity"
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleCreate} className="flex items-center gap-1.5 btn-primary text-xs py-2 px-4">
              <Edit3 className="w-3.5 h-3.5" /> Save as Draft
            </button>
            <button className="flex items-center gap-1.5 text-xs px-4 py-2 bg-purple-50 text-purple-600 rounded-lg font-medium hover:bg-purple-100">
              <Sparkles className="w-3.5 h-3.5" /> AI Enhance
            </button>
            <button onClick={() => { setCreating(false); setContent(''); setHashtags('') }}
              className="btn-secondary text-xs py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Status Filters */}
      <div className="flex gap-1.5 mb-4">
        <button onClick={() => setStatusFilter('all')}
          className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg ${statusFilter === 'all' ? 'bg-np-dark text-white' : 'bg-gray-100 text-gray-600'}`}>
          All ({posts.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([key, config]) => {
          const count = posts.filter(p => p.status === key).length
          return (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg ${statusFilter === key ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
              style={statusFilter === key ? { backgroundColor: config.color } : {}}>
              {config.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Empty State */}
      {posts.length === 0 && !creating && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Send className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Social Media Designer</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create content once, adapt for every platform. AI helps with captions, hashtags, and brand alignment.
            Choose formats for Instagram, Facebook, LinkedIn, TikTok, and X.
          </p>
          <button onClick={() => setCreating(true)} className="btn-primary">Create First Post</button>
        </div>
      )}

      {/* Posts Grid */}
      {filteredPosts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map(post => {
            const statusConf = STATUS_CONFIG[post.status]
            const platforms = (post.platform_versions || []).map((v: any) => v.platform)
            return (
              <div key={post.id} onClick={() => setSelectedPost(post)}
                className="bg-white border border-gray-100 rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all">
                {/* Status + Brand */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>
                    {statusConf.label}
                  </span>
                  <span className="text-[8px] font-bold uppercase text-gray-400">
                    {post.brand === 'np' ? 'NP' : 'SEN'}
                  </span>
                </div>
                {/* Content preview */}
                <p className="text-xs text-np-dark line-clamp-3 mb-3 leading-snug">{post.content_original}</p>
                {/* Platforms */}
                <div className="flex items-center gap-1.5 mb-2">
                  {platforms.map((p: string) => {
                    const plat = PLATFORMS.find(pl => pl.key === p)
                    return plat ? (
                      <span key={p} className="text-sm" title={plat.label}>{plat.icon}</span>
                    ) : null
                  })}
                </div>
                {/* Hashtags */}
                {post.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {post.hashtags.slice(0, 4).map(h => (
                      <span key={h} className="text-[8px] text-np-blue">{h}</span>
                    ))}
                    {post.hashtags.length > 4 && <span className="text-[8px] text-gray-400">+{post.hashtags.length - 4}</span>}
                  </div>
                )}
                {/* Date */}
                <p className="text-[9px] text-gray-400 mt-2">{new Date(post.created_at).toLocaleDateString()}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
