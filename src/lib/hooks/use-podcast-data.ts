// ─── Media Appearances / Podcast Data Hook ───
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type {
  Podcast, PodcastQuestion, PodcastFutureIdea, AdvisoryVoice, PodcastChecklist
} from '@/lib/types/podcast'
import { DEFAULT_ADVISORY_VOICES, DEFAULT_CHECKLIST } from '@/lib/types/podcast'

export function usePodcastData() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id

  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [futureIdeas, setFutureIdeas] = useState<PodcastFutureIdea[]>([])
  const [advisoryVoices, setAdvisoryVoices] = useState<AdvisoryVoice[]>([])
  const [loading, setLoading] = useState(true)

  // ─── Fetch all data ───
  const fetchData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [podRes, ideasRes, voicesRes] = await Promise.all([
        supabase.from('podcasts').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('podcast_future_ideas').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('advisory_voices').select('*').eq('org_id', orgId).order('sort_order'),
      ])
      setPodcasts(podRes.data || [])
      setFutureIdeas(ideasRes.data || [])

      // Seed default voices if none exist
      let voices = voicesRes.data || []
      if (voices.length === 0) {
        const seeds = DEFAULT_ADVISORY_VOICES.map(v => ({ ...v, org_id: orgId }))
        const { data: seeded } = await supabase.from('advisory_voices').insert(seeds).select()
        voices = seeded || []
      }
      setAdvisoryVoices(voices)
    } catch (e) {
      console.error('Podcast fetch error:', e)
    }
    setLoading(false)
  }, [orgId, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Podcast CRUD ───
  const addPodcast = async (data: Partial<Podcast>) => {
    if (!orgId) return null
    const { data: row, error } = await supabase
      .from('podcasts')
      .insert({ ...data, org_id: orgId })
      .select()
      .single()
    if (error) { console.error(error); return null }
    // Seed default checklist
    if (row) {
      const checks = DEFAULT_CHECKLIST.map((label, i) => ({
        podcast_id: row.id, label, completed: false, sort_order: i,
      }))
      await supabase.from('podcast_checklist').insert(checks)
    }
    setPodcasts(prev => [row, ...prev])
    return row
  }

  const updatePodcast = async (id: string, updates: Partial<Podcast>) => {
    const { data: row, error } = await supabase
      .from('podcasts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) { console.error(error); return null }
    setPodcasts(prev => prev.map(p => p.id === id ? row : p))
    return row
  }

  const deletePodcast = async (id: string) => {
    await supabase.from('podcasts').delete().eq('id', id)
    setPodcasts(prev => prev.filter(p => p.id !== id))
  }

  // ─── Questions CRUD ───
  const fetchQuestions = async (podcastId: string): Promise<PodcastQuestion[]> => {
    const { data } = await supabase
      .from('podcast_questions')
      .select('*')
      .eq('podcast_id', podcastId)
      .order('sort_order')
    return data || []
  }

  const addQuestion = async (podcastId: string, question: string, source = 'manual') => {
    if (!orgId) return null
    const { data: row } = await supabase
      .from('podcast_questions')
      .insert({ podcast_id: podcastId, org_id: orgId, question, source })
      .select()
      .single()
    return row
  }

  const updateQuestion = async (id: string, updates: Partial<PodcastQuestion>) => {
    const { data: row } = await supabase
      .from('podcast_questions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    return row
  }

  const deleteQuestion = async (id: string) => {
    await supabase.from('podcast_questions').delete().eq('id', id)
  }

  const bulkAddQuestions = async (podcastId: string, questions: string[], source = 'ai') => {
    if (!orgId) return []
    const rows = questions.map((q, i) => ({
      podcast_id: podcastId, org_id: orgId, question: q, source, sort_order: i
    }))
    const { data } = await supabase.from('podcast_questions').insert(rows).select()
    return data || []
  }

  // ─── Checklist CRUD ───
  const fetchChecklist = async (podcastId: string): Promise<PodcastChecklist[]> => {
    const { data } = await supabase
      .from('podcast_checklist')
      .select('*')
      .eq('podcast_id', podcastId)
      .order('sort_order')
    return data || []
  }

  const toggleChecklistItem = async (id: string, completed: boolean) => {
    await supabase.from('podcast_checklist').update({ completed }).eq('id', id)
  }

  const addChecklistItem = async (podcastId: string, label: string) => {
    const { data: row } = await supabase
      .from('podcast_checklist')
      .insert({ podcast_id: podcastId, label })
      .select()
      .single()
    return row
  }

  // ─── Future Ideas CRUD ───
  const addFutureIdea = async (title: string, description?: string, sourcePodcastId?: string) => {
    if (!orgId) return null
    const { data: row } = await supabase
      .from('podcast_future_ideas')
      .insert({ org_id: orgId, title, description, source_podcast_id: sourcePodcastId })
      .select()
      .single()
    if (row) setFutureIdeas(prev => [row, ...prev])
    return row
  }

  const updateFutureIdea = async (id: string, updates: Partial<PodcastFutureIdea>) => {
    const { data: row } = await supabase
      .from('podcast_future_ideas')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (row) setFutureIdeas(prev => prev.map(i => i.id === id ? row : i))
    return row
  }

  const deleteFutureIdea = async (id: string) => {
    await supabase.from('podcast_future_ideas').delete().eq('id', id)
    setFutureIdeas(prev => prev.filter(i => i.id !== id))
  }

  // ─── Advisory Voices CRUD ───
  const addVoice = async (data: Partial<AdvisoryVoice>) => {
    if (!orgId) return null
    const { data: row } = await supabase
      .from('advisory_voices')
      .insert({ ...data, org_id: orgId })
      .select()
      .single()
    if (row) setAdvisoryVoices(prev => [...prev, row])
    return row
  }

  const updateVoice = async (id: string, updates: Partial<AdvisoryVoice>) => {
    const { data: row } = await supabase
      .from('advisory_voices')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (row) setAdvisoryVoices(prev => prev.map(v => v.id === id ? row : v))
    return row
  }

  const deleteVoice = async (id: string) => {
    await supabase.from('advisory_voices').delete().eq('id', id)
    setAdvisoryVoices(prev => prev.filter(v => v.id !== id))
  }

  const toggleVoice = async (id: string, active: boolean) => {
    return updateVoice(id, { active })
  }

  return {
    podcasts, futureIdeas, advisoryVoices, loading,
    addPodcast, updatePodcast, deletePodcast,
    fetchQuestions, addQuestion, updateQuestion, deleteQuestion, bulkAddQuestions,
    fetchChecklist, toggleChecklistItem, addChecklistItem,
    addFutureIdea, updateFutureIdea, deleteFutureIdea,
    addVoice, updateVoice, deleteVoice, toggleVoice,
    refetch: fetchData,
  }
}
