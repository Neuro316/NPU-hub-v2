'use client'

import { useState } from 'react'
import type { JourneyPhase, JourneyCard } from '@/lib/types/journey'
import { JourneyCardItem } from './journey-card-item'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

interface PhaseColumnProps {
  phase: JourneyPhase
  cards: JourneyCard[]
  onAddCard: (phaseId: string, title: string, rowIndex: number) => Promise<any>
  onUpdateCard: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDeleteCard: (id: string) => Promise<any>
  onCardClick: (card: JourneyCard) => void
  onUpdatePhase: (id: string, updates: Partial<JourneyPhase>) => Promise<any>
  onDeletePhase: (id: string) => Promise<any>
}

export function PhaseColumn({
  phase,
  cards,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onCardClick,
  onUpdatePhase,
  onDeletePhase,
}: PhaseColumnProps) {
  const [addingCard, setAddingCard] = useState(false)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [label, setLabel] = useState(phase.label)

  // Group cards by row
  const rowGroups = cards.reduce<Record<number, JourneyCard[]>>((acc, card) => {
    const row = card.row_index || 0
    if (!acc[row]) acc[row] = []
    acc[row].push(card)
    return acc
  }, {})

  const rowNumbers = Object.keys(rowGroups).map(Number).sort((a, b) => a - b)
  if (rowNumbers.length === 0) rowNumbers.push(0)

  const handleAddCard = async () => {
    if (!newCardTitle.trim()) return
    const maxRow = rowNumbers.length > 0 ? Math.max(...rowNumbers) : 0
    await onAddCard(phase.id, newCardTitle.trim(), 0)
    setNewCardTitle('')
    setAddingCard(false)
  }

  const handleLabelSave = async () => {
    if (label.trim() && label !== phase.label) {
      await onUpdatePhase(phase.id, { label: label.trim() })
    }
    setEditingLabel(false)
  }

  return (
    <div className="flex-shrink-0 w-72">
      {/* Phase Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: phase.color }}
          />
          {editingLabel ? (
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={handleLabelSave}
              onKeyDown={e => e.key === 'Enter' && handleLabelSave()}
              className="text-sm font-semibold text-np-dark bg-transparent border-b border-np-blue focus:outline-none"
              autoFocus
            />
          ) : (
            <h3 className="text-sm font-semibold text-np-dark">{phase.label}</h3>
          )}
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {cards.length}
          </span>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded hover:bg-gray-100"
          >
            <MoreHorizontal className="w-4 h-4 text-gray-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 
                            rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
              <button
                onClick={() => { setEditingLabel(true); setMenuOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                <Pencil className="w-3 h-3" /> Rename Phase
              </button>
              <button
                onClick={() => { onDeletePhase(phase.id); setMenuOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >
                <Trash2 className="w-3 h-3" /> Delete Phase
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {rowNumbers.map(rowNum => (
          <div key={rowNum} className="space-y-2">
            {(rowGroups[rowNum] || [])
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(card => (
                <JourneyCardItem
                  key={card.id}
                  card={card}
                  onUpdate={onUpdateCard}
                  onDelete={onDeleteCard}
                  onClick={onCardClick}
                />
              ))}
          </div>
        ))}

        {/* Add Card */}
        {addingCard ? (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <input
              value={newCardTitle}
              onChange={e => setNewCardTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCard()
                if (e.key === 'Escape') { setAddingCard(false); setNewCardTitle('') }
              }}
              placeholder="Card title..."
              className="w-full text-sm border-none focus:outline-none text-np-dark placeholder-gray-300"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleAddCard} className="btn-primary text-xs py-1 px-3">
                Add
              </button>
              <button
                onClick={() => { setAddingCard(false); setNewCardTitle('') }}
                className="btn-secondary text-xs py-1 px-3"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingCard(true)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-gray-400 
                       hover:text-np-dark hover:bg-gray-50 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add card
          </button>
        )}
      </div>
    </div>
  )
}
