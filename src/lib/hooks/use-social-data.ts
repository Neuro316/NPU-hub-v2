'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

export interface SocialPost {
  id: string
  org_id: string
  brand: string
  campaign_id: string | null
  content_original: string | null
  platform_versions: any[]
  media_asset_ids: string[]
  hashtags: string[]
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  scheduled_at: string | null
  published_at: string | null
  ai_suggestions: Record<string, any>
  trend_keywords: string[]
  brand_alignment_score: number | null
  custom_fields: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PlatformFormat {
  id: string
  platform: string
  format_name: string
  width: number
  height: number
  aspect_ratio: string | null
  category: string
  is_active: boolean
}

export function useSocialData() {
  const { currentOrg } = useWorkspace()
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [formats, setFormats] = useState<PlatformFormat[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [postRes, formatRes] = await Promise.all([
      supabase.from('social_posts').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('platform_formats').select('*').eq('is_active', true).order('platform'),
    ])
    if (postRes.data) setPosts(postRes.data)
    if (formatRes.data) setFormats(formatRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const addPost = async (post: Partial<SocialPost>) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('social_posts').insert({ org_id: currentOrg.id, ...post }).select().single()
    if (data && !error) setPosts(prev => [data, ...prev])
    return { data, error }
  }

  const updatePost = async (id: string, updates: Partial<SocialPost>) => {
    const { data, error } = await supabase
      .from('social_posts').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (data && !error) setPosts(prev => prev.map(p => p.id === id ? data : p))
    return { data, error }
  }

  const deletePost = async (id: string) => {
    const { error } = await supabase.from('social_posts').delete().eq('id', id)
    if (!error) setPosts(prev => prev.filter(p => p.id !== id))
    return { error }
  }

  return { posts, formats, loading, refresh: fetchData, addPost, updatePost, deletePost }
}
