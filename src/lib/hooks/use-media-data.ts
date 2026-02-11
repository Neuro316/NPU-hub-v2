'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

export interface MediaAsset {
  id: string
  org_id: string
  collection_id: string | null
  name: string
  url: string
  thumbnail_url: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  file_size: number | null
  tags: string[]
  brand: 'np' | 'sensorium' | 'both'
  ai_generated: boolean
  usage_count: number
  custom_fields: Record<string, any>
  created_at: string
}

export interface MediaCollection {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string
  sort_order: number
}

export function useMediaData() {
  const { currentOrg } = useWorkspace()
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [collections, setCollections] = useState<MediaCollection[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [assetRes, colRes] = await Promise.all([
      supabase.from('media_assets').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('media_collections').select('*').eq('org_id', currentOrg.id).order('sort_order'),
    ])
    if (assetRes.data) setAssets(assetRes.data)
    if (colRes.data) setCollections(colRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const addAsset = async (asset: Partial<MediaAsset>) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('media_assets').insert({ org_id: currentOrg.id, ...asset }).select().single()
    if (data && !error) setAssets(prev => [data, ...prev])
    return { data, error }
  }

  const updateAsset = async (id: string, updates: Partial<MediaAsset>) => {
    const { data, error } = await supabase
      .from('media_assets').update(updates).eq('id', id).select().single()
    if (data && !error) setAssets(prev => prev.map(a => a.id === id ? data : a))
    return { data, error }
  }

  const deleteAsset = async (id: string) => {
    const { error } = await supabase.from('media_assets').delete().eq('id', id)
    if (!error) setAssets(prev => prev.filter(a => a.id !== id))
    return { error }
  }

  const addCollection = async (name: string, color: string) => {
    if (!currentOrg) return
    const maxOrder = collections.length > 0 ? Math.max(...collections.map(c => c.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('media_collections').insert({ org_id: currentOrg.id, name, color, sort_order: maxOrder }).select().single()
    if (data && !error) setCollections(prev => [...prev, data])
    return { data, error }
  }

  const deleteCollection = async (id: string) => {
    const { error } = await supabase.from('media_collections').delete().eq('id', id)
    if (!error) setCollections(prev => prev.filter(c => c.id !== id))
    return { error }
  }

  return { assets, collections, loading, refresh: fetchData, addAsset, updateAsset, deleteAsset, addCollection, deleteCollection }
}
