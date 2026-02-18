'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  BookOpen, Plus, Search, Star, Tag, Hash, Pin, Trash2, X,
  MessageSquare, FileText, ChevronDown, Filter, Sparkles, Clock,
  ExternalLink, User, Brain, Compass, Users
} from 'lucide-react'

interface LibraryItem {
  id: string; org_id: string; title: string; description: string | null
  category: string; content_type: string; content: string | null
  summary: string | null; key_insights: string[]; tags: string[]
  source_type: string | null; source_id: string | null; source_url: string | null
  author_name: string | null; rating: number | null
  is_pinned: boolean; is_featured: boolean; view_count: number
  created_by: string | null; created_at: string; updated_at: string
}

const CATEGORIES = [
  { key: 'all', label: 'All', icon: BookOpen },
  { key: 'ai-conversation', label: 'AI Conversations', icon: MessageSquare },
  { key: 'white-paper', label: 'White Papers', icon: FileText },
  { key: 'case-study', label: 'Case Studies', icon: Brain },
  { key: 'guide', label: 'Guides', icon: Compass },
  { key: 'general', label: 'General', icon: BookOpen },
]

const VOICE_LABELS: Record<string, { label: string; color: string }> = {
  cameron: { label: 'Cameron AI', color: '#386797' },
  guide: { label: 'Hub Guide', color: '#10B981' },
}

const StarRating = ({ rating, onChange }: { rating: number | null; onChange: (r: number) => void }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map(star => (
      <button key={star} onClick={() => onChange(star)}>
        <Star className={`w-3.5 h-3.5 ${(rating || 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-gray-200 hover:text-amber-300'}`} />
      </button>
    ))}
  </div>
)

export default function LibraryPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', description: '', category: 'general', content: '', tags: '' })

  const loadItems = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    let query = supabase.from('company_library').select('*').eq('org_id', currentOrg.id)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })

    if (category !== 'all') query = query.eq('category', category)
    if (search.trim()) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,summary.ilike.%${search}%`)

    const { data } = await query.limit(100)
    setItems(data || [])
    setLoading(false)
  }, [currentOrg?.id, category, search])

  useEffect(() => { loadItems() }, [loadItems])

  const updateItem = async (id: string, updates: Partial<LibraryItem>) => {
    await supabase.from('company_library').update(updates).eq('id', id)
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } as LibraryItem : item))
    if (selectedItem?.id === id) setSelectedItem(prev => prev ? { ...prev, ...updates } as LibraryItem : null)
  }

  const deleteItem = async (id: string) => {
    await supabase.from('company_library').delete().eq('id', id)
    setItems(prev => prev.filter(item => item.id !== id))
    if (selectedItem?.id === id) setSelectedItem(null)
  }

  const addItem = async () => {
    if (!currentOrg || !addForm.title.trim()) return
    const { data } = await supabase.from('company_library').insert({
      org_id: currentOrg.id,
      title: addForm.title.trim(),
      description: addForm.description.trim() || null,
      category: addForm.category,
      content_type: 'document',
      content: addForm.content.trim() || null,
      tags: addForm.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
    }).select().single()
    if (data) {
      setItems(prev => [data as LibraryItem, ...prev])
      setShowAdd(false)
      setAddForm({ title: '', description: '', category: 'general', content: '', tags: '' })
    }
  }

  // Track views
  const viewItem = async (item: LibraryItem) => {
    setSelectedItem(item)
    await supabase.from('company_library').update({ view_count: (item.view_count || 0) + 1 }).eq('id', item.id)
  }

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Company Library</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {items.length} resources</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> Add Resource
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search library..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300" />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {CATEGORIES.map(cat => (
            <button key={cat.key} onClick={() => setCategory(cat.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                category === cat.key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <cat.icon className="w-3 h-3" /> {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Items grid */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
              <BookOpen className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Company Library</h2>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                Centralize knowledge from AI conversations, white papers, guides, and more. Promote valuable AI chats to build your team's knowledge base.
              </p>
              <button onClick={() => setShowAdd(true)} className="bg-np-blue text-white text-xs font-bold px-5 py-2.5 rounded-lg">Add First Resource</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(item => (
                <div key={item.id} onClick={() => viewItem(item)}
                  className={`bg-white border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all group ${
                    selectedItem?.id === item.id ? 'border-np-blue/40 shadow-md' : 'border-gray-100'
                  }`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {item.content_type === 'conversation' ? (
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: (VOICE_LABELS[item.tags?.find(t => VOICE_LABELS[t]) || '']?.color || '#386797') + '15' }}>
                          <MessageSquare className="w-3.5 h-3.5" style={{ color: VOICE_LABELS[item.tags?.find(t => VOICE_LABELS[t]) || '']?.color || '#386797' }} />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                          <FileText className="w-3.5 h-3.5 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-np-dark truncate">{item.title}</p>
                        <p className="text-[9px] text-gray-400">
                          {item.author_name && `by ${item.author_name} · `}
                          {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    {item.is_pinned && <Pin className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />}
                  </div>

                  {item.description && (
                    <p className="text-[10px] text-gray-500 line-clamp-2 mb-2 leading-relaxed">{item.description}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {item.rating && (
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} className={`w-2.5 h-2.5 ${(item.rating || 0) >= s ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
                          ))}
                        </div>
                      )}
                      <span className="text-[8px] text-gray-400">{item.view_count} views</span>
                    </div>
                    <div className="flex gap-1">
                      {(item.tags || []).slice(0, 2).map(tag => (
                        <span key={tag} className="text-[7px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <div className="w-96 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-np-dark truncate">{selectedItem.title}</h3>
              <button onClick={() => setSelectedItem(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>

            {/* Meta */}
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <StarRating rating={selectedItem.rating} onChange={r => updateItem(selectedItem.id, { rating: r } as any)} />
                <div className="flex gap-1.5">
                  <button onClick={() => updateItem(selectedItem.id, { is_pinned: !selectedItem.is_pinned } as any)}
                    className={`p-1 rounded ${selectedItem.is_pinned ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}>
                    <Pin className={`w-3.5 h-3.5 ${selectedItem.is_pinned ? 'fill-amber-500' : ''}`} />
                  </button>
                  <button onClick={() => updateItem(selectedItem.id, { is_featured: !selectedItem.is_featured } as any)}
                    className={`p-1 rounded text-[10px] font-bold ${selectedItem.is_featured ? 'text-purple-500 bg-purple-50' : 'text-gray-400 hover:text-purple-500'}`}>
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm('Delete this resource?')) deleteItem(selectedItem.id) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>

              {selectedItem.author_name && (
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <User className="w-3 h-3" /> {selectedItem.author_name}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <Clock className="w-3 h-3" /> {new Date(selectedItem.created_at).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                {selectedItem.view_count > 0 && <span className="ml-2">{selectedItem.view_count} views</span>}
              </div>

              {(selectedItem.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedItem.tags.map(tag => (
                    <span key={tag} className="text-[8px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                      <Hash className="w-2 h-2" />{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Summary + insights */}
            {selectedItem.summary && (
              <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/30">
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Summary</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">{selectedItem.summary}</p>
                {selectedItem.key_insights && selectedItem.key_insights.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase">Key Insights</p>
                    {selectedItem.key_insights.map((ins, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <Sparkles className="w-2.5 h-2.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <span className="text-[10px] text-gray-600">{ins}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedItem.description && !selectedItem.content && (
                <p className="text-xs text-gray-600 leading-relaxed">{selectedItem.description}</p>
              )}
              {selectedItem.content && (
                <div className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap font-mono">
                  {selectedItem.content}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Resource Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-np-dark">Add Resource</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Title</label>
                <input value={addForm.title} onChange={e => setAddForm({ ...addForm, title: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Description</label>
                <textarea value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })}
                  rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Category</label>
                <select value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                  <option value="general">General</option>
                  <option value="white-paper">White Paper</option>
                  <option value="case-study">Case Study</option>
                  <option value="guide">Guide</option>
                </select></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Tags (comma separated)</label>
                <input value={addForm.tags} onChange={e => setAddForm({ ...addForm, tags: e.target.value })} placeholder="marketing, strategy, Q1"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none placeholder-gray-300" /></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Content</label>
                <textarea value={addForm.content} onChange={e => setAddForm({ ...addForm, content: e.target.value })}
                  rows={6} placeholder="Paste content, notes, or leave empty..."
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none placeholder-gray-300 font-mono" /></div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-4 py-2 rounded-lg border border-gray-200">Cancel</button>
              <button onClick={addItem} disabled={!addForm.title.trim()}
                className="text-xs font-bold text-white bg-np-blue px-4 py-2 rounded-lg disabled:opacity-40">Add Resource</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
