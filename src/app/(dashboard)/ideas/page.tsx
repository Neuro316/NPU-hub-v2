'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { Plus, Lightbulb, Star, Archive, ThumbsUp, MessageSquare } from 'lucide-react'

interface Idea {
  id: string
  org_id: string
  title: string
  description: string | null
  category: string
  status: string
  votes: number
  custom_fields: Record<string, any>
  created_by: string | null
  created_at: string
}

export default function IdeasPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [category, setCategory] = useState('general')
  const supabase = createClient()

  useEffect(() => {
    if (!currentOrg) return
    supabase.from('ideas').select('*').eq('org_id', currentOrg.id).order('votes', { ascending: false })
      .then(({ data }) => { if (data) setIdeas(data); setLoading(false) })
  }, [currentOrg?.id])

  const handleAdd = async () => {
    if (!title.trim() || !currentOrg) return
    const { data } = await supabase.from('ideas')
      .insert({ org_id: currentOrg.id, title: title.trim(), description: desc.trim() || null, category, status: 'new', votes: 0, custom_fields: {} })
      .select().single()
    if (data) setIdeas(prev => [data, ...prev])
    setTitle(''); setDesc(''); setAdding(false)
  }

  const vote = async (id: string, current: number) => {
    await supabase.from('ideas').update({ votes: current + 1 }).eq('id', id)
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, votes: current + 1 } : i))
  }

  if (orgLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading ideas...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Ideas</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {ideas.length} ideas</p>
        </div>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> New Idea
        </button>
      </div>

      {adding && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Idea title..."
            className="w-full text-sm font-semibold border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the idea..." rows={3}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
          <div className="flex gap-2">
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none">
              <option value="general">General</option><option value="campaign">Campaign</option><option value="product">Product</option>
              <option value="content">Content</option><option value="feature">Feature</option>
            </select>
            <button onClick={handleAdd} className="btn-primary text-xs py-1.5 px-4">Add Idea</button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {ideas.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Lightbulb className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Idea Board</h2>
          <p className="text-sm text-gray-500 mb-6">Capture ideas, vote on the best ones, link them to tasks and campaigns.</p>
          <button onClick={() => setAdding(true)} className="btn-primary">Add First Idea</button>
        </div>
      ) : (
        <div className="space-y-2">
          {ideas.map(idea => (
            <div key={idea.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-start gap-3 hover:shadow-sm transition-all">
              <button onClick={() => vote(idea.id, idea.votes)}
                className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg bg-gray-50 hover:bg-np-blue/10 text-gray-400 hover:text-np-blue transition-colors flex-shrink-0">
                <ThumbsUp className="w-4 h-4" />
                <span className="text-[10px] font-bold">{idea.votes}</span>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-sm font-semibold text-np-dark">{idea.title}</h3>
                  <span className="text-[8px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase font-medium">{idea.category}</span>
                </div>
                {idea.description && <p className="text-xs text-gray-500 line-clamp-2">{idea.description}</p>}
                <p className="text-[9px] text-gray-400 mt-1">{new Date(idea.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
