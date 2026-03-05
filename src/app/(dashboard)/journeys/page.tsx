'use client'

import { useState, useEffect, useRef, useCallback, DragEvent } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Plus, X, Trash2, Loader2, GripVertical, ChevronRight,
  MoreHorizontal, Edit3, Wand2, ArrowRight,
  CheckCircle2, Circle, Clock
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================
interface JourneyPhase {
  id: string
  org_id: string
  phase_key: string
  label: string
  color: string
  sort_order: number
}

interface JourneyCard {
  id: string
  org_id: string
  phase_id: string
  title: string
  description: string
  status: 'not_started' | 'in_progress' | 'done'
  row_index: number
  sort_order: number
  tags?: string[]
  custom_fields: Record<string, any>
  created_at: string
  updated_at: string
}

const STATUS_CONFIG = {
  not_started: { label: 'Not Started', color: '#9CA3AF', icon: Circle, bg: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#F59E0B', icon: Clock, bg: '#FFFBEB' },
  done:        { label: 'Done',        color: '#10B981', icon: CheckCircle2, bg: '#ECFDF5' },
} as const

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  'PAID TRAFFIC':   { bg: '#FCE7F3', text: '#DB2777' },
  'LEAD MAGNET':    { bg: '#FCE7F3', text: '#DB2777' },
  'ORGANIC':        { bg: '#D1FAE5', text: '#059669' },
  'QUIZ / ASSESSMENT': { bg: '#FCE7F3', text: '#DB2777' },
  'PODCAST':        { bg: '#EDE9FE', text: '#7C3AED' },
  'EMAIL':          { bg: '#DBEAFE', text: '#2563EB' },
  'AUTOMATION':     { bg: '#FEF3C7', text: '#D97706' },
  'ONBOARDING':     { bg: '#CFFAFE', text: '#0891B2' },
  'CLINICAL':       { bg: '#FEE2E2', text: '#DC2626' },
  'CONTENT':        { bg: '#E0E7FF', text: '#4F46E5' },
}

function getTagStyle(tag: string) {
  const upper = tag.toUpperCase()
  return TAG_COLORS[upper] || { bg: '#F3F4F6', text: '#6B7280' }
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function JourneysPage() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [phases, setPhases] = useState<JourneyPhase[]>([])
  const [cards, setCards] = useState<JourneyCard[]>([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')
  const [editingPhase, setEditingPhase] = useState<string | null>(null)
  const [editPhaseLabel, setEditPhaseLabel] = useState('')
  const [addingCardAt, setAddingCardAt] = useState<{ phaseId: string; row: number } | null>(null)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [editingCard, setEditingCard] = useState<JourneyCard | null>(null)
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null)

  // Drag state
  const [dragCardId, setDragCardId] = useState<string | null>(null)
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const rowEnterCount = useRef<Record<string, number>>({})

  // ── Data Loading ──
  const loadData = useCallback(async () => {
    if (!currentOrg?.id) return
    setLoading(true)

    const [pRes, cRes] = await Promise.all([
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

    if (pRes.data) setPhases(pRes.data)
    if (cRes.data) setCards(cRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { loadData() }, [loadData])

  // ── Phase CRUD ──
  const addPhase = async () => {
    if (!newPhaseName.trim() || !currentOrg?.id) return
    const phaseKey = newPhaseName.trim().toLowerCase().replace(/\s+/g, '_')
    const colors = ['#E91E8C', '#386797', '#10B981', '#F59E0B', '#7C3AED', '#DC2626', '#0891B2']
    const color = colors[phases.length % colors.length]

    const { data } = await supabase.from('journey_phases').insert({
      org_id: currentOrg.id,
      phase_key: phaseKey,
      label: newPhaseName.trim(),
      color,
      sort_order: phases.length,
    }).select().single()

    if (data) {
      setPhases(prev => [...prev, data])
      setNewPhaseName('')
      setAddingPhase(false)
    }
  }

  const updatePhaseLabel = async (phaseId: string, label: string) => {
    await supabase.from('journey_phases').update({ label }).eq('id', phaseId)
    setPhases(prev => prev.map(p => p.id === phaseId ? { ...p, label } : p))
    setEditingPhase(null)
  }

  const deletePhase = async (phaseId: string) => {
    if (!confirm('Delete this path and all its cards?')) return
    await supabase.from('journey_cards').delete().eq('phase_id', phaseId)
    await supabase.from('journey_phases').delete().eq('id', phaseId)
    setPhases(prev => prev.filter(p => p.id !== phaseId))
    setCards(prev => prev.filter(c => c.phase_id !== phaseId))
  }

  // ── Card CRUD ──
  const addCard = async (phaseId: string, row: number) => {
    if (!newCardTitle.trim() || !currentOrg?.id) return
    const phaseCards = cards.filter(c => c.phase_id === phaseId && c.row_index === row)
    const maxSort = phaseCards.length > 0 ? Math.max(...phaseCards.map(c => c.sort_order)) + 1 : 0

    const { data } = await supabase.from('journey_cards').insert({
      org_id: currentOrg.id,
      phase_id: phaseId,
      title: newCardTitle.trim(),
      description: '',
      status: 'not_started',
      row_index: row,
      sort_order: maxSort,
      custom_fields: {},
    }).select().single()

    if (data) {
      setCards(prev => [...prev, data])
      setNewCardTitle('')
      setAddingCardAt(null)
    }
  }

  const updateCard = async (cardId: string, updates: Partial<JourneyCard>) => {
    await supabase.from('journey_cards').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', cardId)
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...updates } : c))
  }

  const deleteCard = async (cardId: string) => {
    await supabase.from('journey_cards').delete().eq('id', cardId)
    setCards(prev => prev.filter(c => c.id !== cardId))
    setCardMenuOpen(null)
  }

  const cycleStatus = (card: JourneyCard) => {
    const order: JourneyCard['status'][] = ['not_started', 'in_progress', 'done']
    const next = order[(order.indexOf(card.status) + 1) % order.length]
    updateCard(card.id, { status: next })
  }

  // ── DRAG & DROP ──
  const handleDragStart = (e: DragEvent<HTMLDivElement>, card: JourneyCard) => {
    e.stopPropagation()
    setDragCardId(card.id)
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    const el = e.currentTarget as HTMLElement
    requestAnimationFrame(() => { el.style.opacity = '0.4' })
  }

  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
    setDragCardId(null)
    setHoverRow(null)
    rowEnterCount.current = {}
  }

  const handleRowDragEnter = (e: DragEvent, rowKey: string) => {
    e.preventDefault()
    rowEnterCount.current[rowKey] = (rowEnterCount.current[rowKey] || 0) + 1
    setHoverRow(rowKey)
  }

  const handleRowDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleRowDragLeave = (e: DragEvent, rowKey: string) => {
    rowEnterCount.current[rowKey] = (rowEnterCount.current[rowKey] || 0) - 1
    if (rowEnterCount.current[rowKey] <= 0) {
      rowEnterCount.current[rowKey] = 0
      if (hoverRow === rowKey) setHoverRow(null)
    }
  }

  // Calculate insertion index from mouse X position
  const getInsertIndex = (e: DragEvent): number => {
    const mouseX = e.clientX
    const rowEl = (e.currentTarget as HTMLElement)
    // Find all card elements in this row using data attributes
    const cardEls = rowEl.querySelectorAll('[data-card-id]')
    
    for (let i = 0; i < cardEls.length; i++) {
      const rect = cardEls[i].getBoundingClientRect()
      const cardCenter = rect.left + rect.width / 2
      if (mouseX < cardCenter) {
        return i
      }
    }
    // Mouse is past all cards — append to end
    return cardEls.length
  }

  const handleRowDrop = async (e: DragEvent, targetPhaseId: string, targetRow: number) => {
    e.preventDefault()
    e.stopPropagation()

    const theCardId = e.dataTransfer.getData('text/plain') || dragCardId
    if (!theCardId) return

    const card = cards.find(c => c.id === theCardId)
    if (!card) return

    // Figure out where in the row the user dropped
    const insertAt = getInsertIndex(e)

    // Get existing cards in this row (excluding the dragged one)
    const targetRowCards = cards
      .filter(c => c.phase_id === targetPhaseId && c.row_index === targetRow && c.id !== theCardId)
      .sort((a, b) => a.sort_order - b.sort_order)

    // Build new order: insert the dragged card at insertAt
    const reordered: { id: string; sort_order: number; phase_id?: string; row_index?: number }[] = []
    let idx = 0
    let inserted = false

    for (let i = 0; i < targetRowCards.length; i++) {
      if (idx === insertAt && !inserted) {
        reordered.push({ id: theCardId, sort_order: idx, phase_id: targetPhaseId, row_index: targetRow })
        idx++
        inserted = true
      }
      reordered.push({ id: targetRowCards[i].id, sort_order: idx })
      idx++
    }
    if (!inserted) {
      reordered.push({ id: theCardId, sort_order: idx, phase_id: targetPhaseId, row_index: targetRow })
    }

    // Also reindex the source row if card moved to a different row
    const sourceReindex: { id: string; sort_order: number }[] = []
    if (card.phase_id !== targetPhaseId || card.row_index !== targetRow) {
      const sourceRowCards = cards
        .filter(c => c.phase_id === card.phase_id && c.row_index === card.row_index && c.id !== theCardId)
        .sort((a, b) => a.sort_order - b.sort_order)
      sourceRowCards.forEach((c, i) => {
        sourceReindex.push({ id: c.id, sort_order: i })
      })
    }

    // Optimistic update
    setCards(prev => {
      const next = [...prev]
      for (const u of reordered) {
        const i = next.findIndex(c => c.id === u.id)
        if (i >= 0) {
          next[i] = {
            ...next[i],
            sort_order: u.sort_order,
            ...(u.phase_id ? { phase_id: u.phase_id } : {}),
            ...(u.row_index !== undefined ? { row_index: u.row_index } : {}),
          }
        }
      }
      for (const u of sourceReindex) {
        const i = next.findIndex(c => c.id === u.id)
        if (i >= 0) {
          next[i] = { ...next[i], sort_order: u.sort_order }
        }
      }
      return next
    })

    // Persist all updates
    const allUpdates = [...reordered, ...sourceReindex]
    for (const u of allUpdates) {
      const payload: Record<string, unknown> = { sort_order: u.sort_order, updated_at: new Date().toISOString() }
      if ('phase_id' in u && u.phase_id) payload.phase_id = u.phase_id
      if ('row_index' in u && u.row_index !== undefined) payload.row_index = u.row_index
      await supabase.from('journey_cards').update(payload).eq('id', u.id)
    }

    setDragCardId(null)
    setHoverRow(null)
    rowEnterCount.current = {}
  }

  // ── Helpers ──
  const getPhaseCards = (phaseId: string) => cards.filter(c => c.phase_id === phaseId)
  const getRowCards = (phaseId: string, row: number) =>
    cards.filter(c => c.phase_id === phaseId && c.row_index === row).sort((a, b) => a.sort_order - b.sort_order)
  const getRowNumbers = (phaseId: string) => {
    const phaseCards = getPhaseCards(phaseId)
    const rows = Array.from(new Set(phaseCards.map(c => c.row_index || 0))).sort((a, b) => a - b)
    return rows.length > 0 ? rows : [0]
  }
  const getNextRow = (phaseId: string) => {
    const rows = getRowNumbers(phaseId)
    return Math.max(...rows, -1) + 1
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50/50">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 py-4 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Journey Builder</h1>
            <p className="text-xs text-gray-500 mt-0.5">{currentOrg?.name} — drag cards to any row or between cards</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddingPhase(true)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Path
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-[#386797] text-white text-xs font-medium flex items-center gap-1.5 hover:bg-[#2d5578] transition-colors">
              <Wand2 className="w-3.5 h-3.5" /> AI Journey Creator
            </button>
          </div>
        </div>

        {addingPhase && (
          <div className="flex items-center gap-2 mt-3">
            <input
              value={newPhaseName}
              onChange={e => setNewPhaseName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPhase()}
              placeholder="Path name (e.g. Acquisition, Onboarding)"
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-72 focus:ring-2 focus:ring-[#386797]/20 focus:border-[#386797] outline-none"
              autoFocus
            />
            <button onClick={addPhase} className="px-3 py-2 bg-[#386797] text-white rounded-lg text-xs font-medium">Add</button>
            <button onClick={() => { setAddingPhase(false); setNewPhaseName('') }} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {phases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <ArrowRight className="w-7 h-7 text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">No Paths Yet</h3>
            <p className="text-xs text-gray-500 mb-4 max-w-sm">
              Add your first path to start mapping the customer journey.
            </p>
            <button
              onClick={() => setAddingPhase(true)}
              className="px-4 py-2 bg-[#386797] text-white rounded-lg text-xs font-medium"
            >
              Add First Path
            </button>
          </div>
        ) : (
          [...phases].sort((a, b) => a.sort_order - b.sort_order).map(phase => {
            const rowNumbers = getRowNumbers(phase.id)
            const phaseCards = getPhaseCards(phase.id)

            return (
              <div key={phase.id} className="bg-white rounded-xl border border-gray-100">
                {/* ── Phase Header ── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: phase.color }} />
                    {editingPhase === phase.id ? (
                      <input
                        value={editPhaseLabel}
                        onChange={e => setEditPhaseLabel(e.target.value)}
                        onBlur={() => updatePhaseLabel(phase.id, editPhaseLabel)}
                        onKeyDown={e => e.key === 'Enter' && updatePhaseLabel(phase.id, editPhaseLabel)}
                        className="text-sm font-semibold text-gray-900 border-b-2 border-[#386797] outline-none bg-transparent px-0"
                        autoFocus
                      />
                    ) : (
                      <h3
                        className="text-sm font-semibold text-gray-900 cursor-pointer hover:text-[#386797]"
                        onDoubleClick={() => { setEditingPhase(phase.id); setEditPhaseLabel(phase.label) }}
                      >
                        {phase.label}
                      </h3>
                    )}
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                      {phaseCards.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setAddingCardAt({ phaseId: phase.id, row: getNextRow(phase.id) }); setNewCardTitle('') }}
                      className="p-1.5 text-gray-400 hover:text-[#386797] hover:bg-blue-50 rounded-lg transition-colors"
                      title="Add new row"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deletePhase(phase.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* ── Rows ── */}
                <div className="p-3 space-y-2">
                  {rowNumbers.map(rowIdx => {
                    const rowCards = getRowCards(phase.id, rowIdx)
                    const rowKey = `${phase.id}:${rowIdx}`
                    const isRowHovered = hoverRow === rowKey && dragCardId !== null

                    return (
                      <div
                        key={rowIdx}
                        className={`flex items-start gap-2 rounded-lg p-2 transition-all min-h-[70px] ${
                          isRowHovered
                            ? 'bg-blue-50 ring-2 ring-[#386797]/30'
                            : dragCardId
                              ? 'bg-gray-50/30'
                              : ''
                        }`}
                        onDragEnter={e => handleRowDragEnter(e, rowKey)}
                        onDragOver={handleRowDragOver}
                        onDragLeave={e => handleRowDragLeave(e, rowKey)}
                        onDrop={e => handleRowDrop(e, phase.id, rowIdx)}
                      >
                        {/* Row label */}
                        <div className="flex-shrink-0 w-7 flex items-center justify-center pt-3">
                          <span className="text-[9px] text-gray-400 font-medium">{rowIdx + 1}</span>
                        </div>

                        {/* Cards */}
                        <div className="flex-1 flex items-start gap-2 flex-wrap">
                          {rowCards.map((card, cardIdx) => {
                            const status = STATUS_CONFIG[card.status]
                            const StatusIcon = status.icon
                            const isBeingDragged = dragCardId === card.id

                            return (
                              <div key={card.id} className={`flex items-start ${dragCardId && !isBeingDragged ? 'pointer-events-none' : ''}`} data-card-id={card.id}>
                                {/* The Card */}
                                <div
                                  draggable={!dragCardId}
                                  onDragStart={e => handleDragStart(e, card)}
                                  onDragEnd={handleDragEnd}
                                  className={`group relative bg-white rounded-lg border-2 shadow-sm hover:shadow-md 
                                    transition-all w-[200px] cursor-grab active:cursor-grabbing select-none
                                    ${isBeingDragged ? 'opacity-30 scale-95' : 'opacity-100'}
                                  `}
                                  style={{ borderColor: `${phase.color}30`, pointerEvents: dragCardId && !isBeingDragged ? 'none' : 'auto' }}
                                >
                                  <div className="h-1 rounded-t-[5px]" style={{ backgroundColor: phase.color }} />

                                  <div className="p-2.5">
                                    <div className="flex items-start gap-1.5">
                                      <button
                                        onClick={e => { e.stopPropagation(); cycleStatus(card) }}
                                        className="mt-0.5 flex-shrink-0 transition-colors"
                                        title={status.label}
                                      >
                                        <StatusIcon
                                          className="w-3.5 h-3.5"
                                          style={{ color: status.color }}
                                          fill={card.status === 'done' ? status.color : 'none'}
                                        />
                                      </button>
                                      <span className="text-xs font-medium text-gray-900 leading-tight line-clamp-2">
                                        {card.title}
                                      </span>
                                    </div>

                                    {card.description && (
                                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed line-clamp-2 ml-5">
                                        {card.description}
                                      </p>
                                    )}

                                    {card.tags && card.tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5 ml-5">
                                        {card.tags.map(tag => {
                                          const style = getTagStyle(tag)
                                          return (
                                            <span
                                              key={tag}
                                              className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                              style={{ backgroundColor: style.bg, color: style.text }}
                                            >
                                              {tag}
                                            </span>
                                          )
                                        })}
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between mt-2 ml-5">
                                      <span
                                        className="text-[8px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                        style={{ backgroundColor: status.bg, color: status.color }}
                                      >
                                        {status.label}
                                      </span>
                                      <div className="relative">
                                        <button
                                          onClick={e => { e.stopPropagation(); setCardMenuOpen(cardMenuOpen === card.id ? null : card.id) }}
                                          className="p-1 text-gray-300 hover:text-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                          <MoreHorizontal className="w-3.5 h-3.5" />
                                        </button>
                                        {cardMenuOpen === card.id && (
                                          <div className="absolute right-0 top-6 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50 w-32">
                                            <button
                                              onClick={() => { setEditingCard(card); setCardMenuOpen(null) }}
                                              className="w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                            >
                                              <Edit3 className="w-3 h-3" /> Edit
                                            </button>
                                            <button
                                              onClick={() => deleteCard(card.id)}
                                              className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                                            >
                                              <Trash2 className="w-3 h-3" /> Delete
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="absolute top-2 right-2 text-gray-200 group-hover:text-gray-400 transition-colors">
                                    <GripVertical className="w-3 h-3" />
                                  </div>
                                </div>

                                {cardIdx < rowCards.length - 1 && (
                                  <div className="flex-shrink-0 flex items-center px-0.5 pt-4">
                                    <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {!dragCardId && (
                            <button
                              onClick={() => { setAddingCardAt({ phaseId: phase.id, row: rowIdx }); setNewCardTitle('') }}
                              className="flex-shrink-0 w-[40px] min-h-[56px] rounded-lg border-2 border-dashed border-gray-200 
                                flex items-center justify-center text-gray-400 hover:text-[#386797] hover:border-[#386797] 
                                hover:bg-blue-50/30 transition-all"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {isRowHovered && (
                            <div className="flex-shrink-0 w-[120px] min-h-[56px] rounded-lg border-2 border-dashed border-[#386797] bg-blue-50/80 flex items-center justify-center">
                              <span className="text-[10px] font-medium text-[#386797]">Drop here</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* New row drop zone */}
                  {dragCardId && (
                    <div
                      className={`mx-9 rounded-lg border-2 border-dashed transition-all min-h-[50px] flex items-center justify-center ${
                        hoverRow === `${phase.id}:${getNextRow(phase.id)}`
                          ? 'border-[#386797] bg-blue-50/80'
                          : 'border-gray-200 bg-gray-50/30'
                      }`}
                      onDragEnter={e => handleRowDragEnter(e, `${phase.id}:${getNextRow(phase.id)}`)}
                      onDragOver={handleRowDragOver}
                      onDragLeave={e => handleRowDragLeave(e, `${phase.id}:${getNextRow(phase.id)}`)}
                      onDrop={e => handleRowDrop(e, phase.id, getNextRow(phase.id))}
                    >
                      <span className="text-[10px] text-gray-400">Drop to create new row</span>
                    </div>
                  )}

                  {addingCardAt?.phaseId === phase.id && (
                    <div className="flex items-center gap-2 ml-9 mt-1">
                      <input
                        value={newCardTitle}
                        onChange={e => setNewCardTitle(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addCard(addingCardAt.phaseId, addingCardAt.row)}
                        placeholder="Card title..."
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-56 focus:ring-2 focus:ring-[#386797]/20 focus:border-[#386797] outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => addCard(addingCardAt.phaseId, addingCardAt.row)}
                        className="px-2.5 py-1.5 bg-[#386797] text-white rounded-lg text-[10px] font-medium"
                      >
                        Add
                      </button>
                      <button onClick={() => setAddingCardAt(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Card Edit Modal ── */}
      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingCard(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Edit Card</h3>
              <button onClick={() => setEditingCard(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Title</label>
                <input
                  value={editingCard.title}
                  onChange={e => setEditingCard({ ...editingCard, title: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#386797]/20 focus:border-[#386797] outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Description</label>
                <textarea
                  value={editingCard.description}
                  onChange={e => setEditingCard({ ...editingCard, description: e.target.value })}
                  rows={3}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-[#386797]/20 focus:border-[#386797] outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</label>
                <div className="flex gap-2 mt-1">
                  {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map(key => {
                    const cfg = STATUS_CONFIG[key]
                    const Icon = cfg.icon
                    return (
                      <button
                        key={key}
                        onClick={() => setEditingCard({ ...editingCard, status: key })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          editingCard.status === key
                            ? 'border-current'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        style={{ color: cfg.color, backgroundColor: editingCard.status === key ? cfg.bg : 'transparent' }}
                      >
                        <Icon className="w-3 h-3" fill={key === 'done' ? cfg.color : 'none'} />
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Tags (comma separated)</label>
                <input
                  value={(editingCard.tags || []).join(', ')}
                  onChange={e => setEditingCard({ ...editingCard, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  placeholder="e.g. PAID TRAFFIC, LEAD MAGNET"
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#386797]/20 focus:border-[#386797] outline-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditingCard(null)} className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 rounded-lg">
                Cancel
              </button>
              <button
                onClick={async () => {
                  await updateCard(editingCard.id, {
                    title: editingCard.title,
                    description: editingCard.description,
                    status: editingCard.status,
                    tags: editingCard.tags,
                    custom_fields: editingCard.custom_fields,
                  })
                  setEditingCard(null)
                }}
                className="px-4 py-2 bg-[#386797] text-white text-xs font-medium rounded-lg hover:bg-[#2d5578]"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
