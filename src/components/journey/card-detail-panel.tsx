'use client'

import { useState, useEffect } from 'react'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { STATUS_CONFIG } from '@/lib/types/journey'
import { X, ChevronDown } from 'lucide-react'

interface CardDetailPanelProps {
  card: JourneyCard | null
  phases: JourneyPhase[]
  onClose: () => void
  onUpdate: (id: string, updates: Partial<JourneyCard>) => Promise<any>
}

export function CardDetailPanel({ card, phases, onClose, onUpdate }: CardDetailPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<JourneyCard['status']>('not_started')
  const [phaseId, setPhaseId] = useState('')

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setDescription(card.description || '')
      setStatus(card.status)
      setPhaseId(card.phase_id)
    }
  }, [card])

  if (!card) return null

  const handleSave = async (field: string, value: any) => {
    await onUpdate(card.id, { [field]: value })
  }

  const currentPhase = phases.find(p => p.id === phaseId)
  const statusConfig = STATUS_CONFIG[status]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-xl border-l border-gray-100 
                      flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: currentPhase?.color || '#386797' }}
            />
            <span className="text-xs text-gray-400">{currentPhase?.label}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Title */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title !== card.title && handleSave('title', title)}
            className="text-lg font-semibold text-np-dark w-full bg-transparent 
                       focus:outline-none focus:border-b focus:border-np-blue"
          />

          {/* Status */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</label>
            <div className="flex gap-2 mt-2">
              {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map(key => (
                <button
                  key={key}
                  onClick={() => { setStatus(key); handleSave('status', key) }}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors
                    ${status === key 
                      ? 'border-current' 
                      : 'border-transparent hover:border-gray-200'
                    }`}
                  style={{
                    backgroundColor: STATUS_CONFIG[key].bg,
                    color: STATUS_CONFIG[key].color,
                  }}
                >
                  {STATUS_CONFIG[key].label}
                </button>
              ))}
            </div>
          </div>

          {/* Phase */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Phase</label>
            <select
              value={phaseId}
              onChange={e => { setPhaseId(e.target.value); handleSave('phase_id', e.target.value) }}
              className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 
                         focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
            >
              {phases.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => description !== card.description && handleSave('description', description)}
              placeholder="Add a description..."
              rows={4}
              className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 
                         focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue
                         placeholder-gray-300 resize-none"
            />
          </div>

          {/* Custom Fields (placeholder for future) */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Fields</label>
            <p className="text-xs text-gray-400 mt-2">Coming soon: attach custom fields, assets, linked tasks, and AI analysis to this card.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 text-xs text-gray-400">
          Created {new Date(card.created_at).toLocaleDateString()}
          {card.updated_at !== card.created_at && (
            <> · Updated {new Date(card.updated_at).toLocaleDateString()}</>
          )}
        </div>
      </div>
    </div>
  )
}
