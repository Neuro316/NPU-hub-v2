'use client'

import { useState, DragEvent } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { FlowCard } from './flow-card'
import { Plus, Pencil, Check, Trash2, ChevronRight } from 'lucide-react'

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

// ════════════════════════════════════════════════
// Drop Zone component
// ════════════════════════════════════════════════
function DropZone({
  active, onDragOver, onDragLeave, onDrop,
}: {
  active: boolean
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={`flex-shrink-0 rounded transition-all ${
        active
          ? 'w-4 h-16 bg-np-blue/30 border-2 border-dashed border-np-blue'
          : 'w-1.5 h-12 bg-transparent hover:bg-gray-200 hover:w-3'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  )
}

export function PathGroup({
  phase, cards, onAddCard, onUpdateCard, onDeleteCard,
  onCardClick, onUpdatePhase, onDeletePhase,
}: PathGroupProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(phase.label)
  const [addingCard, setAddingCard] = useState<number | null>(null)
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

  // ── Drag & Drop ──
  const handleDragStart = (e: DragEvent, card: JourneyCard) => {
    e.dataTransfer.setData('application/x-journey-card', JSON.stringify({
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

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDragOverTarget(null)
    }
  }

  const handleDrop = async (e: DragEvent, targetRow: number, targetSortOrder: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverTarget(null)

    const raw = e.dataTransfer.getData('application/x-journey-card')
    if (!raw) return

    try {
      const data = JSON.parse(raw)
      const { cardId, fromPhaseId } = data
      if (!cardId) return

      const rowCards = (rowGroups[targetRow] || []).sort((a, b) => a.sort_order - b.sort_order)

      // Shift cards at and after target position
      for (const card of rowCards) {
        if (card.id !== cardId && card.sort_order >= targetSortOrder) {
          await onUpdateCard(card.id, { sort_order: card.sort_order + 1 } as any)
        }
      }

      // Move the dragged card
      const updates: Record<string, any> = {
        row_index: targetRow,
        sort_order: targetSortOrder,
      }

      // Cross-path: update phase_id
      if (fromPhaseId !== phase.id) {
        updates.phase_id = phase.id
      }

      await onUpdateCard(cardId, updates as any)
    } catch {}
  }

  // Drop on the whole row area (end of row)
  const handleRowDrop = async (e: DragEvent, targetRow: number) => {
    const rowCards = (rowGroups[targetRow] || [])
    const maxOrder = rowCards.length > 0 ? Math.max(...rowCards.map(c => c.sort_order)) + 1 : 0
    await handleDrop(e, targetRow, maxOrder)
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
              className={`flex items-center gap-0.5 px-4 py-3 min-h-[80px] overflow-x-auto transition-colors ${
                dragOverTarget === `row-${rowNum}` ? 'bg-blue-50/50' : ''
              }`}
              style={{ borderBottom: rowIdx < rowNumbers.length - 1 ? '1px dashed #E5E7EB' : 'none' }}
              onDragOver={e => { e.preventDefault(); setDragOverTarget(`row-${rowNum}`) }}
              onDragLeave={e => {
                const related = e.relatedTarget as HTMLElement | null
                if (!related || !(e.currentTarget as HTMLElement).contains(related)) setDragOverTarget(null)
              }}
              onDrop={e => handleRowDrop(e, rowNum)}
            >
              <div className="flex-shrink-0 w-1 h-8 rounded-full opacity-40 mr-2" style={{ backgroundColor: phase.color }} />

              {/* Drop zone at start of row */}
              <DropZone
                active={dragOverTarget === `drop-${rowNum}-start`}
                onDragOver={e => handleDragOver(e, `drop-${rowNum}-start`)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, rowNum, 0)}
              />

              {rowCards.map((card, cardIdx) => (
                <div key={card.id} className="flex items-center flex-shrink-0">
                  {/* Draggable card */}
                  <div
                    draggable
                    onDragStart={e => handleDragStart(e, card)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <FlowCard
                      card={card}
                      pathColor={phase.color}
                      onClick={() => onCardClick(card)}
                    />
                  </div>

                  {/* Arrow + drop zone after each card */}
                  <div className="flex items-center flex-shrink-0">
                    <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0 mx-0.5" />
                    <DropZone
                      active={dragOverTarget === `drop-${rowNum}-${cardIdx}`}
                      onDragOver={e => handleDragOver(e, `drop-${rowNum}-${cardIdx}`)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, rowNum, card.sort_order + 1)}
                    />
                  </div>
                </div>
              ))}

              {/* Add card button */}
              {addingCard === rowNum ? (
                <div className="flex-shrink-0 bg-white border border-gray-200 rounded-lg p-2 w-44 ml-1">
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
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 border border-dashed border-gray-200 rounded-lg text-[9px] text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors whitespace-nowrap ml-1">
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
