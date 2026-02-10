'use client'

import { useState } from 'react'
import { useJourneyData } from '@/lib/hooks/use-journey-data'
import { useWorkspace } from '@/lib/workspace-context'
import { PhaseColumn } from '@/components/journey/phase-column'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import type { JourneyCard } from '@/lib/types/journey'
import { Plus, LayoutTemplate } from 'lucide-react'

const PHASE_COLORS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#386797',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316',
]

export default function JourneysPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const {
    phases, cards, loading,
    addPhase, updatePhase, deletePhase,
    addCard, updateCard, deleteCard,
  } = useJourneyData()

  const [selectedCard, setSelectedCard] = useState<JourneyCard | null>(null)
  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseLabel, setNewPhaseLabel] = useState('')

  const handleAddPhase = async () => {
    if (!newPhaseLabel.trim()) return
    const key = newPhaseLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const color = PHASE_COLORS[phases.length % PHASE_COLORS.length]
    await addPhase(newPhaseLabel.trim(), key, color)
    setNewPhaseLabel('')
    setAddingPhase(false)
  }

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading journey...</div>
      </div>
    )
  }

  const hasPhases = phases.length > 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-np-dark">Journey Builder</h1>
          <p className="text-sm text-gray-500 mt-1">
            Visual pipeline for {currentOrg?.name || 'your organization'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAddingPhase(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Phase
          </button>
        </div>
      </div>

      {/* Empty State */}
      {!hasPhases && (
        <div className="card p-12 text-center">
          <LayoutTemplate className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">No journey phases yet</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Start building your pipeline by adding phases. Each phase represents a stage
            in your customer or participant journey.
          </p>
          <button
            onClick={() => setAddingPhase(true)}
            className="btn-primary"
          >
            Create First Phase
          </button>
        </div>
      )}

      {/* Add Phase Input */}
      {addingPhase && (
        <div className="mb-6 card p-4 max-w-sm">
          <input
            value={newPhaseLabel}
            onChange={e => setNewPhaseLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddPhase()
              if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseLabel('') }
            }}
            placeholder="Phase name (e.g., Awareness, Onboarding)..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 
                       focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue
                       placeholder-gray-300 mb-3"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleAddPhase} className="btn-primary text-xs py-1.5 px-4">
              Add Phase
            </button>
            <button
              onClick={() => { setAddingPhase(false); setNewPhaseLabel('') }}
              className="btn-secondary text-xs py-1.5 px-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pipeline Board */}
      {hasPhases && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {phases.map(phase => (
              <PhaseColumn
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

            {/* Add Phase Column */}
            <div className="flex-shrink-0 w-72">
              <button
                onClick={() => setAddingPhase(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-8
                           border-2 border-dashed border-gray-200 rounded-xl
                           text-sm text-gray-400 hover:text-np-dark hover:border-gray-300
                           transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Phase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card Detail Panel */}
      <CardDetailPanel
        card={selectedCard}
        phases={phases}
        onClose={() => setSelectedCard(null)}
        onUpdate={updateCard}
      />
    </div>
  )
}
