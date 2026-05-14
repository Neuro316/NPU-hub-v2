'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Plus, X, ArrowLeft } from 'lucide-react'
import type { JourneyCard } from '@/lib/types/journey'
import type { CampaignPhase } from '@/lib/types/journey'
import { CARD_STATUS_CONFIG, DEFAULT_CAMPAIGN_PHASES } from '@/lib/types/journey'
import { CampaignPhaseCard } from './campaign-phase-card'
import { CampaignCardModal } from './campaign-card-modal'

interface Campaign {
  id: string
  name: string
  status: string
  phases?: CampaignPhase[] | null
  [key: string]: any
}

interface Props {
  campaign: Campaign
  orgId: string
  onClose: () => void
}

export function CampaignPhaseView({ campaign, orgId, onClose }: Props) {
  const [cards, setCards] = useState<JourneyCard[]>([])
  const [loading, setLoading] = useState(true)
  const [editingCard, setEditingCard] = useState<JourneyCard | null>(null)
  const [addingToPhase, setAddingToPhase] = useState<string | null>(null)
  const supabase = createClient()

  const phases: CampaignPhase[] = (campaign.phases && Array.isArray(campaign.phases) && campaign.phases.length > 0)
    ? campaign.phases
    : DEFAULT_CAMPAIGN_PHASES

  const fetchCards = async () => {
    const { data } = await supabase
      .from('campaign_cards')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('sort_order')
    setCards((data || []) as JourneyCard[])
    setLoading(false)
  }

  useEffect(() => { fetchCards() }, [campaign.id])

  const getPhaseCards = (phaseId: string) => cards.filter(c => c.campaign_phase === phaseId)

  const handleAddCard = async (phaseId: string, title: string) => {
    const phaseCards = getPhaseCards(phaseId)
    const { data } = await supabase.from('campaign_cards').insert({
      org_id: orgId,
      campaign_id: campaign.id,
      campaign_phase: phaseId,
      title,
      status: 'not_started',
      sort_order: phaseCards.length,
      checklist: [],
      testers: [],
      asset_urls: {},
      tracking_ids: {},
    }).select().single()
    if (data) { setCards(prev => [...prev, data as JourneyCard]); setAddingToPhase(null) }
  }

  const handleUpdateCard = async (cardId: string, updates: Partial<JourneyCard>) => {
    const { campaign_phase, ...rest } = updates as any
    const payload: any = { ...rest, updated_at: new Date().toISOString() }
    if (campaign_phase !== undefined) payload.campaign_phase = campaign_phase
    await supabase.from('campaign_cards').update(payload).eq('id', cardId)
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...updates } : c))
  }

  const handleDeleteCard = async (cardId: string) => {
    await supabase.from('campaign_cards').delete().eq('id', cardId)
    setCards(prev => prev.filter(c => c.id !== cardId))
    setEditingCard(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-4 h-4 text-gray-500" /></button>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-np-dark">{campaign.name}</h2>
          <p className="text-[10px] text-gray-400">{cards.length} cards across {phases.length} phases</p>
        </div>
      </div>

      {/* Phase columns */}
      {loading ? (
        <div className="text-center py-12 text-xs text-gray-400">Loading phases...</div>
      ) : (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-3" style={{ minWidth: phases.length * 290 }}>
            {phases.map(phase => {
              const phaseCards = getPhaseCards(phase.id)
              const doneCount = phaseCards.filter(c => c.status === 'done' || c.status === 'approved' || (c as any).status === 'live').length
              return (
                <div key={phase.id} className="w-[280px] flex-shrink-0 flex flex-col rounded-xl overflow-hidden border border-gray-100"
                  style={{ backgroundColor: phase.color + '08' }}>
                  {/* Phase header */}
                  <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: `2px solid ${phase.color}` }}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: phase.color }} />
                      <span className="text-[11px] font-bold text-np-dark">{phase.name}</span>
                    </div>
                    <span className="text-[9px] font-medium text-gray-400">{doneCount}/{phaseCards.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                    {phaseCards.map(card => (
                      <CampaignPhaseCard key={card.id} card={card} phaseColor={phase.color} onClick={() => setEditingCard(card)} />
                    ))}

                    {/* Add card */}
                    {addingToPhase === phase.id ? (
                      <AddCardInline
                        onAdd={(title) => handleAddCard(phase.id, title)}
                        onCancel={() => setAddingToPhase(null)}
                      />
                    ) : (
                      <button onClick={() => setAddingToPhase(phase.id)}
                        className="w-full py-2 text-[10px] text-gray-400 hover:text-np-blue hover:bg-white rounded-lg border border-dashed border-gray-200 hover:border-np-blue/30 flex items-center justify-center gap-1 transition-colors">
                        <Plus className="w-3 h-3" /> Add Card
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Card edit modal */}
      {editingCard && (
        <CampaignCardModal
          card={editingCard}
          phases={phases}
          orgId={orgId}
          onUpdate={(updates) => { handleUpdateCard(editingCard.id, updates); setEditingCard({ ...editingCard, ...updates }) }}
          onDelete={() => handleDeleteCard(editingCard.id)}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  )
}

function AddCardInline({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-2">
      <input value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && title.trim()) onAdd(title.trim()); if (e.key === 'Escape') onCancel() }}
        placeholder="Card title..." autoFocus spellCheck autoCapitalize="sentences"
        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mb-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
      <div className="flex gap-1">
        <button onClick={() => title.trim() && onAdd(title.trim())} className="text-[10px] bg-np-blue text-white px-2.5 py-1 rounded font-medium">Add</button>
        <button onClick={onCancel} className="text-[10px] text-gray-400 px-2 py-1">Cancel</button>
      </div>
    </div>
  )
}
