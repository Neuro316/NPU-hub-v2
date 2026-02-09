'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { JourneyPhase, JourneyCard } from '@/lib/types/journey'

export function useJourneyData() {
  const { currentOrg } = useWorkspace()
  const [phases, setPhases] = useState<JourneyPhase[]>([])
  const [cards, setCards] = useState<JourneyCard[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [phasesRes, cardsRes] = await Promise.all([
      supabase
        .from('journey_phases')
        .select('*')
        .eq('org_id', currentOrg.id)
        .order('sort_order'),
      supabase
        .from('journey_cards')
        .select('*')
        .eq('org_id', currentOrg.id)
        .order('sort_order'),
    ])

    if (phasesRes.data) setPhases(phasesRes.data)
    if (cardsRes.data) setCards(cardsRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const addPhase = async (label: string, phaseKey: string, color: string) => {
    if (!currentOrg) return
    const maxOrder = phases.length > 0 ? Math.max(...phases.map(p => p.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('journey_phases')
      .insert({
        org_id: currentOrg.id,
        phase_key: phaseKey,
        label,
        color,
        sort_order: maxOrder,
      })
      .select()
      .single()

    if (data && !error) {
      setPhases(prev => [...prev, data])
    }
    return { data, error }
  }

  const updatePhase = async (id: string, updates: Partial<JourneyPhase>) => {
    const { data, error } = await supabase
      .from('journey_phases')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (data && !error) {
      setPhases(prev => prev.map(p => p.id === id ? data : p))
    }
    return { data, error }
  }

  const deletePhase = async (id: string) => {
    const { error } = await supabase
      .from('journey_phases')
      .delete()
      .eq('id', id)

    if (!error) {
      setPhases(prev => prev.filter(p => p.id !== id))
      setCards(prev => prev.filter(c => c.phase_id !== id))
    }
    return { error }
  }

  const addCard = async (phaseId: string, title: string, rowIndex: number = 0) => {
    if (!currentOrg) return
    const phaseCards = cards.filter(c => c.phase_id === phaseId)
    const maxOrder = phaseCards.length > 0 ? Math.max(...phaseCards.map(c => c.sort_order)) + 1 : 0

    const { data, error } = await supabase
      .from('journey_cards')
      .insert({
        org_id: currentOrg.id,
        phase_id: phaseId,
        title,
        row_index: rowIndex,
        sort_order: maxOrder,
      })
      .select()
      .single()

    if (data && !error) {
      setCards(prev => [...prev, data])
    }
    return { data, error }
  }

  const updateCard = async (id: string, updates: Partial<JourneyCard>) => {
    const { data, error } = await supabase
      .from('journey_cards')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (data && !error) {
      setCards(prev => prev.map(c => c.id === id ? data : c))
    }
    return { data, error }
  }

  const deleteCard = async (id: string) => {
    const { error } = await supabase
      .from('journey_cards')
      .delete()
      .eq('id', id)

    if (!error) {
      setCards(prev => prev.filter(c => c.id !== id))
    }
    return { error }
  }

  const moveCard = async (cardId: string, newPhaseId: string, newSortOrder: number) => {
    return updateCard(cardId, { phase_id: newPhaseId, sort_order: newSortOrder } as any)
  }

  return {
    phases,
    cards,
    loading,
    refresh: fetchData,
    addPhase,
    updatePhase,
    deletePhase,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
  }
}
