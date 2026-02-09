'use client'

import { useState } from 'react'
import { STATUS_CONFIG } from '@/lib/types/journey'
import type { JourneyCard } from '@/lib/types/journey'
import { MoreHorizontal, Pencil, Trash2, ChevronRight } from 'lucide-react'

interface JourneyCardItemProps {
  card: JourneyCard
  onUpdate: (id: string, updates: Partial<JourneyCard>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  onClick: (card: JourneyCard) => void
}

export function JourneyCardItem({ card, onUpdate, onDelete, onClick }: JourneyCardItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(card.title)
  const status = STATUS_CONFIG[card.status]

  const handleStatusCycle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const order: Array<JourneyCard['status']> = ['not_started', 'in_progress', 'done']
    const currentIdx = order.indexOf(card.status)
    const nextStatus = order[(currentIdx + 1) % order.length]
    await onUpdate(card.id, { status: nextStatus })
  }

  const handleTitleSave = async () => {
    if (title.trim() && title !== card.title) {
      await onUpdate(card.id, { title: title.trim() })
    }
    setEditing(false)
  }

  return (
    <div
      className="group bg-white border border-gray-100 rounded-lg p-3 hover:border-gray-200 
                 hover:shadow-sm transition-all cursor-pointer relative"
      onClick={() => !editing && onClick(card)}
    >
      {/* Status indicator + Title */}
      <div className="flex items-start gap-2">
        <button
          onClick={handleStatusCycle}
          className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full border-2 transition-colors"
          style={{ 
            borderColor: status.color, 
            backgroundColor: card.status === 'done' ? status.color : 'transparent' 
          }}
          title={`Status: ${status.label} (click to change)`}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={e => e.key === 'Enter' && handleTitleSave()}
              className="text-sm font-medium text-np-dark w-full bg-transparent 
                         border-b border-np-blue focus:outline-none"
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <p className="text-sm font-medium text-np-dark truncate">{card.title}</p>
          )}
          {card.description && !editing && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{card.description}</p>
          )}
        </div>
      </div>

      {/* Menu */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="p-1 rounded hover:bg-gray-100"
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-400" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 
                          rounded-lg shadow-lg z-20 py-1 min-w-[120px]">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); setMenuOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              <Pencil className="w-3 h-3" /> Rename
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(card.id); setMenuOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="mt-2 flex items-center justify-between">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ backgroundColor: status.bg, color: status.color }}
        >
          {status.label}
        </span>
        <ChevronRight className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}
