'use client'

import { useState } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { FlowCard } from './flow-card'
import { Plus, Pencil, Check, Trash2, ChevronRight } from 'lucide-react'

interface PathRowProps {
  phase: JourneyPhase
  cards: JourneyCard[]
  onAddCard: (phaseId: string, title: string, rowIndex: number) => Promise<any>
  onUpdateCard: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDeleteCard: (id: string) => Promise<any>
  onCardClick: (card: JourneyCard) => void
  onUpdatePhase: (id: string, updates: Partial<JourneyPhase>) => Promise<any>
  onDeletePhase: (id: string) => Promise<any>
  rowIndex: number
}

export function PathRow({
  phase, cards, onAddCard, onUpdateCard, onDeleteCard,
  onCardClick, onUpdatePhase, onDeletePhase, rowIndex,
}: PathRowProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(phase.label)
  const [addingCard, setAddingCard] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const sortedCards = [...cards].sort((a, b) => a.sort_order - b.sort_order)

  const handleSaveLabel = async () => {
    if (label.trim() && label !== phase.label) {
      await onUpdatePhase(phase.id, { label: label.trim() })
    }
    setEditing(false)
  }

  const handleAddCard = async () => {
    if (!newTitle.trim()) return
    await onAddCard(phase.id, newTitle.trim(), rowIndex)
    setNewTitle('')
    setAddingCard(false)
  }

  const handleMoveCard = async (cardId: string, direction: 'left' | 'right') => {
    const idx = sortedCards.findIndex(c => c.id === cardId)
    if (idx < 0) return
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sortedCards.length) return

    const currentOrder = sortedCards[idx].sort_order
    const swapOrder = sortedCards[swapIdx].sort_order

    await onUpdateCard(sortedCards[idx].id, { sort_order: swapOrder } as any)
    await onUpdateCard(sortedCards[swapIdx].id, { sort_order: currentOrder } as any)
  }

  return (
    <div className="flex items-stretch gap-0 group/row">
      {/* Path Label */}
      <div
        className="flex-shrink-0 w-44 flex items-center gap-2 px-3 py-3 rounded-l-xl border-r-4"
        style={{
          backgroundColor: phase.color + '08',
          borderRightColor: phase.color,
        }}
      >
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: phase.color }}
        />

        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') setEditing(false) }}
              className="text-xs font-semibold bg-white border border-gray-200 rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-np-blue"
              autoFocus
            />
            <button onClick={handleSaveLabel} className="text-green-500 hover:text-green-600">
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-xs font-semibold truncate" style={{ color: phase.color }}>
              {phase.label}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="opacity-0 group-hover/row:opacity-100 transition-opacity text-gray-400 hover:text-gray-600"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDeletePhase(phase.id)}
              className="opacity-0 group-hover/row:opacity-100 transition-opacity text-gray-400 hover:text-red-500"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Cards flow */}
      <div className="flex-1 flex items-center gap-3 px-4 py-3 overflow-x-auto bg-gray-50/50 rounded-r-xl min-h-[80px]">
        {sortedCards.map((card, idx) => (
          <div key={card.id} className="flex items-center gap-2">
            <FlowCard
              card={card}
              pathColor={phase.color}
              canMoveLeft={idx > 0}
              canMoveRight={idx < sortedCards.length - 1}
              onMoveLeft={() => handleMoveCard(card.id, 'left')}
              onMoveRight={() => handleMoveCard(card.id, 'right')}
              onClick={() => onCardClick(card)}
            />
            {idx < sortedCards.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            )}
          </div>
        ))}

        {/* Add card */}
        {addingCard ? (
          <div className="flex-shrink-0 bg-white border border-gray-200 rounded-lg p-2 w-44">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCard(); if (e.key === 'Escape') { setAddingCard(false); setNewTitle('') } }}
              placeholder="Card title..."
              className="w-full text-xs border-none focus:outline-none placeholder-gray-300"
              autoFocus
            />
            <div className="flex gap-1 mt-1.5">
              <button onClick={handleAddCard} className="text-[10px] bg-np-blue text-white px-2 py-0.5 rounded font-medium">Add</button>
              <button onClick={() => { setAddingCard(false); setNewTitle('') }} className="text-[10px] text-gray-400 px-2 py-0.5 rounded hover:text-gray-600">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingCard(true)}
            className="flex-shrink-0 flex items-center gap-1 px-3 py-2 border-2 border-dashed border-gray-200 rounded-lg text-[10px] text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Card
          </button>
        )}
      </div>
    </div>
  )
}
