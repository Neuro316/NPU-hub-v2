'use client'

import { useState, useRef, DragEvent } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { FlowCard } from './flow-card'
import { Plus, Pencil, Check, Trash2, ChevronRight, GripVertical } from 'lucide-react'

interface PathGroupProps {
  phase: JourneyPhase
  cards: JourneyCard[]
  onAddCard: (phaseId: string, title: string, rowIndex: number) => Promise<any>
  onUpdateCard: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDeleteCard: (id: string) => Promise<any>
  onCardClick: (card: JourneyCard) => void
  onUpdatePhase: (id: string, updates: Partial<JourneyPhase>) => Promise<any>
  onDeletePhase: (id: string) => Promise<any>
}

export function PathGroup({
  phase, cards, onAddCard, onUpdateCard, onDeleteCard,
  onCardClick, onUpdatePhase, onDeletePhase,
}: PathGroupProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(phase.label)
  const [addingCard, setAddingCard] = useState<number | null>(null)
  const [addingAtPosition, setAddingAtPosition] = useState<{ row: number; afterIdx: number } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  // Group cards by row_index
  const rowGroups: Record<number, JourneyCard[]> = {}
  cards.forEach(card => {
    const row = card.row_index || 0
    if (!rowGroups[row]) rowGroups[row] = []
    rowGroups[row].push(card)
  })
  const rowNumbers = Object.keys(rowGroups).map(Number).sort((a, b) => a - b)
  if (rowNumbers.length === 0) rowNumbers.push(0)

  const nextRowIndex = rowNumbers.length > 0 ? Math.max(...rowNumbers) + 1 : 0

  const handleSaveLabel = async () => {
    if (label.trim() && label !== phase.label) {
      await onUpdatePhase(phase.id, { label: label.trim() })
    }
    setEditing(false)
  }

  const handleAddCard = async (rowIdx: number) => {
    if (!newTitle.trim()) return
    await onAddCard(phase.id, newTitle.trim(), rowIdx)
    setNewTitle('')
    setAddingCard(null)
  }

  // Insert card at specific position within a row
  const handleInsertCard = async (rowIdx: number, afterSortOrder: number) => {
    if (!newTitle.trim()) return
    const rowCards = (rowGroups[rowIdx] || []).sort((a, b) => a.sort_order - b.sort_order)

    // Shift all cards after the insertion point
    const insertOrder = afterSortOrder + 1
    for (const card of rowCards) {
      if (card.sort_order >= insertOrder) {
        await onUpdateCard(card.id, { sort_order: card.sort_order + 1 } as any)
      }
    }

    await onAddCard(phase.id, newTitle.trim(), rowIdx)
    // Now fix its sort_order to the insertion point
    setNewTitle('')
    setAddingAtPosition(null)
  }

  // ── Drag & Drop ──
  const handleDragStart = (e: DragEvent, card: JourneyCard) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      cardId: card.id,
      fromPhaseId: phase.id,
      fromRow: card.row_index || 0,
      sortOrder: card.sort_order,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(targetId)
  }

  const handleDragLeave = () => {
    setDragOverTarget(null)
  }

  const handleDrop = async (e: DragEvent, targetRow: number, targetSortOrder: number) => {
    e.preventDefault()
    setDragOverTarget(null)

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      const { cardId, fromRow, sortOrder: fromSortOrder } = data

      if (!cardId) return

      const rowCards = (rowGroups[targetRow] || []).sort((a, b) => a.sort_order - b.sort_order)

      // Shift cards at and after target position
      for (const card of rowCards) {
        if (card.id !== cardId && card.sort_order >= targetSortOrder) {
          await onUpdateCard(card.id, { sort_order: card.sort_order + 1 } as any)
        }
      }

      // Move the dragged card
      await onUpdateCard(cardId, {
        row_index: targetRow,
        sort_order: targetSortOrder,
      } as any)
    } catch {}
  }

  const handleMoveCard = async (cardId: string, direction: 'left' | 'right', rowIdx: number) => {
    const rowCards = (rowGroups[rowIdx] || []).sort((a, b) => a.sort_order - b.sort_order)
    const idx = rowCards.findIndex(c => c.id === cardId)
    if (idx < 0) return
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rowCards.length) return

    const currentOrder = rowCards[idx].sort_order
    const swapOrder = rowCards[swapIdx].sort_order

    await onUpdateCard(rowCards[idx].id, { sort_order: swapOrder } as any)
    await onUpdateCard(rowCards[swapIdx].id, { sort_order: currentOrder } as any)
  }

  const handleMoveCardVertical = async (cardId: string, direction: 'up' | 'down', currentRow: number) => {
    const currentRowIdx = rowNumbers.indexOf(currentRow)
    if (currentRowIdx < 0) return

    let targetRow: number
    if (direction === 'up' && currentRowIdx > 0) {
      targetRow = rowNumbers[currentRowIdx - 1]
    } else if (direction === 'down' && currentRowIdx < rowNumbers.length - 1) {
      targetRow = rowNumbers[currentRowIdx + 1]
    } else {
      return
    }

    await onUpdateCard(cardId, { row_index: targetRow } as any)
  }

  const handleAddSubRow = () => {
    setAddingCard(nextRowIndex)
  }

  return (
    <div className="flex group/path">
      {/* Path Label */}
      <div
        className="flex-shrink-0 w-44 flex flex-col justify-center px-3 py-3 rounded-l-xl border-r-4"
        style={{ backgroundColor: phase.color + '08', borderRightColor: phase.color }}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: phase.color }} />

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
              <span className="text-xs font-bold truncate" style={{ color: phase.color }}>{phase.label}</span>
              <span className="text-[9px] text-gray-400">({cards.length})</span>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1 ml-5">
          <span className="text-[9px] text-gray-400">{rowNumbers.length} row{rowNumbers.length !== 1 ? 's' : ''}</span>
          <button onClick={() => setEditing(true)}
            className="opacity-0 group-hover/path:opacity-100 transition-opacity text-gray-400 hover:text-gray-600">
            <Pencil className="w-2.5 h-2.5" />
          </button>
          <button onClick={() => { if (confirm('Delete this path and all its cards?')) onDeletePhase(phase.id) }}
            className="opacity-0 group-hover/path:opacity-100 transition-opacity text-gray-400 hover:text-red-500">
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Sub-rows */}
      <div className="flex-1 flex flex-col bg-gray-50/50 rounded-r-xl min-w-0">
        {rowNumbers.map((rowNum, rowIdx) => {
          const rowCards = (rowGroups[rowNum] || []).sort((a, b) => a.sort_order - b.sort_order)

          return (
            <div
              key={rowNum}
              className="flex items-center gap-1 px-4 py-3 min-h-[80px] overflow-x-auto"
              style={{ borderBottom: rowIdx < rowNumbers.length - 1 ? '1px dashed #E5E7EB' : 'none' }}
            >
              <div className="flex-shrink-0 w-1 h-8 rounded-full opacity-40" style={{ backgroundColor: phase.color }} />

              {/* Drop zone at start of row */}
              <div
                className={`flex-shrink-0 w-2 h-16 rounded transition-all mx-0.5 ${
                  dragOverTarget === `drop-${rowNum}-start` ? 'bg-np-blue w-3' : 'bg-transparent hover:bg-gray-200'
                }`}
                onDragOver={e => handleDragOver(e, `drop-${rowNum}-start`)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, rowNum, 0)}
              />

              {rowCards.map((card, cardIdx) => (
                <div key={card.id} className="flex items-center gap-0.5 flex-shrink-0">
                  {/* Card (draggable) */}
                  <div
                    draggable
                    onDragStart={e => handleDragStart(e, card)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <FlowCard
                      card={card}
                      pathColor={phase.color}
                      canMoveLeft={cardIdx > 0}
                      canMoveRight={cardIdx < rowCards.length - 1}
                      canMoveUp={rowIdx > 0}
                      canMoveDown={rowIdx < rowNumbers.length - 1}
                      onMoveLeft={() => handleMoveCard(card.id, 'left', rowNum)}
                      onMoveRight={() => handleMoveCard(card.id, 'right', rowNum)}
                      onMoveUp={() => handleMoveCardVertical(card.id, 'up', rowNum)}
                      onMoveDown={() => handleMoveCardVertical(card.id, 'down', rowNum)}
                      onClick={() => onCardClick(card)}
                    />
                  </div>

                  {/* Arrow + drop zone between cards */}
                  <div className="flex items-center flex-shrink-0">
                    <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
                    <div
                      className={`flex-shrink-0 w-2 h-16 rounded transition-all ${
                        dragOverTarget === `drop-${rowNum}-${cardIdx}` ? 'bg-np-blue w-3' : 'bg-transparent hover:bg-gray-200'
                      }`}
                      onDragOver={e => handleDragOver(e, `drop-${rowNum}-${cardIdx}`)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, rowNum, card.sort_order + 1)}
                    />
                  </div>
                </div>
              ))}

              {/* Add card inline at position */}
              {addingAtPosition?.row === rowNum ? (
                <div className="flex-shrink-0 bg-white border border-np-blue/30 rounded-lg p-2 w-44 shadow-sm">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddCard(rowNum)
                      if (e.key === 'Escape') { setAddingAtPosition(null); setNewTitle('') }
                    }}
                    placeholder="Card title..." className="w-full text-xs border-none focus:outline-none placeholder-gray-300" autoFocus />
                  <div className="flex gap-1 mt-1.5">
                    <button onClick={() => handleAddCard(rowNum)} className="text-[10px] bg-np-blue text-white px-2 py-0.5 rounded font-medium">Add</button>
                    <button onClick={() => { setAddingAtPosition(null); setNewTitle('') }} className="text-[10px] text-gray-400 px-2 py-0.5 rounded">Cancel</button>
                  </div>
                </div>
              ) : addingCard === rowNum ? (
                <div className="flex-shrink-0 bg-white border border-gray-200 rounded-lg p-2 w-44">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCard(rowNum); if (e.key === 'Escape') { setAddingCard(null); setNewTitle('') } }}
                    placeholder="Card title..." className="w-full text-xs border-none focus:outline-none placeholder-gray-300" autoFocus />
                  <div className="flex gap-1 mt-1.5">
                    <button onClick={() => handleAddCard(rowNum)} className="text-[10px] bg-np-blue text-white px-2 py-0.5 rounded font-medium">Add</button>
                    <button onClick={() => { setAddingCard(null); setNewTitle('') }} className="text-[10px] text-gray-400 px-2 py-0.5 rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingCard(rowNum)}
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 border border-dashed border-gray-200 rounded-lg text-[9px] text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors whitespace-nowrap">
                  <Plus className="w-3 h-3" /> Add Card
                </button>
              )}
            </div>
          )
        })}

        {/* Add sub-row */}
        {addingCard === nextRowIndex ? (
          <div className="flex items-center gap-3 px-4 py-3 border-t border-dashed border-gray-200">
            <div className="flex-shrink-0 w-1 h-8 rounded-full opacity-40" style={{ backgroundColor: phase.color }} />
            <div className="flex-shrink-0 bg-white border border-gray-200 rounded-lg p-2 w-44">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddCard(nextRowIndex); if (e.key === 'Escape') { setAddingCard(null); setNewTitle('') } }}
                placeholder="First card in new row..." className="w-full text-xs border-none focus:outline-none placeholder-gray-300" autoFocus />
              <div className="flex gap-1 mt-1.5">
                <button onClick={() => handleAddCard(nextRowIndex)} className="text-[10px] bg-np-blue text-white px-2 py-0.5 rounded font-medium">Add</button>
                <button onClick={() => { setAddingCard(null); setNewTitle('') }} className="text-[10px] text-gray-400 px-2 py-0.5 rounded">Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={handleAddSubRow}
            className="flex items-center gap-1.5 px-4 py-2 text-[9px] text-gray-400 hover:text-np-dark transition-colors border-t border-dashed border-gray-100">
            <Plus className="w-3 h-3" /> Add Row to {phase.label}
          </button>
        )}
      </div>
    </div>
  )
}
