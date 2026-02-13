'use client'

import { useState } from 'react'
import { useJourneyData } from '@/lib/hooks/use-journey-data'
import { useWorkspace } from '@/lib/workspace-context'
import { PathGroup } from '@/components/journey/path-row'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import type { JourneyCard } from '@/lib/types/journey'
import { PHASE_COLORS } from '@/lib/types/journey'
import { Plus, Wand2, Route } from 'lucide-react'

const PATH_COLORS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#386797', '#EC4899', '#06B6D4', '#84CC16', '#F97316',
]

export default function JourneysPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const {
    phases, cards, loading,
    addPhase, updatePhase, deletePhase,
    addCard, updateCard, deleteCard,
  } = useJourneyData()

  const [selectedCard, setSelectedCard] = useState<JourneyCard | null>(null)
  const [addingPath, setAddingPath] = useState(false)
  const [newPathLabel, setNewPathLabel] = useState('')

  const handleDuplicate = async (card: JourneyCard, targetPhaseId: string, targetRow: number) => {
    await addCard(targetPhaseId, card.title, targetRow)
    // Note: custom_fields will need to be copied in a follow-up update
  }

  const handleAddPath = async () => {
    if (!newPathLabel.trim()) return
    const key = newPathLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const color = PATH_COLORS[phases.length % PATH_COLORS.length]
    await addPhase(newPathLabel.trim(), key, color)
    setNewPathLabel('')
    setAddingPath(false)
  }

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading journey...</div>
      </div>
    )
  }

  const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Journey Builder</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentOrg?.name} · {phases.length} paths · {cards.length} cards
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAddingPath(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Path
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" /> AI Journey Creator
          </button>
        </div>
      </div>

      {/* Add Path Input */}
      {addingPath && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 max-w-sm">
          <h3 className="text-xs font-semibold text-np-dark mb-2">New Path</h3>
          <input
            value={newPathLabel}
            onChange={e => setNewPathLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddPath()
              if (e.key === 'Escape') { setAddingPath(false); setNewPathLabel('') }
            }}
            placeholder="Path name (e.g., Marketing, Sales, Onboarding)..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleAddPath} className="btn-primary text-xs py-1.5 px-4">Add Path</button>
            <button onClick={() => { setAddingPath(false); setNewPathLabel('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {phases.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Route className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Map Your Customer Journey</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create paths for each major flow: Marketing, Sales, Onboarding, Program, Off-boarding.
            Each path can have multiple rows for parallel tracks (e.g., Marketing might have
            Facebook Ads, Social Media, Podcast, and Referral rows).
          </p>
          <button onClick={() => setAddingPath(true)} className="btn-primary">
            Create First Path
          </button>
        </div>
      )}

      {/* Path Groups */}
      <div className="space-y-3">
        {sortedPhases.map(phase => (
          <PathGroup
            key={phase.id}
            phase={phase}
            cards={cards.filter(c => c.phase_id === phase.id)}
            onAddCard={addCard}
            onUpdateCard={updateCard}
            onDeleteCard={deleteCard}
            onCardClick={setSelectedCard}
            onUpdatePhase={updatePhase}
            onDeletePhase={deletePhase}
          />
        ))}

        {/* Add Path */}
        {phases.length > 0 && (
          <button
            onClick={() => setAddingPath(true)}
            className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Path
          </button>
        )}
      </div>

      {/* Card Detail Panel */}
      <CardDetailPanel
        card={selectedCard}
        phases={phases}
        onClose={() => setSelectedCard(null)}
        onUpdate={updateCard}
        onDelete={deleteCard}
        onDuplicate={handleDuplicate}
        orgId={currentOrg?.id}
      />
    </div>
  )
}
