'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Plus, X, Trash2, Loader2, ArrowRight,
  CheckCircle2, Circle, Clock, MoreHorizontal, Edit3, ChevronDown, ChevronRight
} from 'lucide-react'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'

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
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set())
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set())
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Mouse-based drag state
  const [dragging, setDragging] = useState<{
    cardId: string
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    width: number
    active: boolean
  } | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [dropTarget, setDropTarget] = useState<{
    phaseId: string
    rowIdx: number
    insertIdx: number
    newRow?: boolean
  } | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // ── Data Loading ──
  const loadData = useCallback(async () => {
    if (!currentOrg?.id) return
    setLoading(true)
    const [pRes, cRes] = await Promise.all([
      supabase.from('journey_phases').select('*').eq('org_id', currentOrg.id).order('sort_order'),
      supabase.from('journey_cards').select('*').eq('org_id', currentOrg.id).order('sort_order'),
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
      org_id: currentOrg.id, phase_key: phaseKey, label: newPhaseName.trim(), color, sort_order: phases.length,
    }).select().single()
    if (data) { setPhases(prev => [...prev, data]); setNewPhaseName(''); setAddingPhase(false) }
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
    const rowCards = cards.filter(c => c.phase_id === phaseId && c.row_index === row)
    const maxSort = rowCards.length > 0 ? Math.max(...rowCards.map(c => c.sort_order)) + 1 : 0
    const { data } = await supabase.from('journey_cards').insert({
      org_id: currentOrg.id, phase_id: phaseId, title: newCardTitle.trim(),
      description: '', status: 'not_started', row_index: row, sort_order: maxSort, custom_fields: {},
    }).select().single()
    if (data) { setCards(prev => [...prev, data]); setNewCardTitle(''); setAddingCardAt(null) }
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

  // ── MOUSE DRAG ──
  const handleMouseDown = useCallback((e: React.MouseEvent, cardId: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setDragging({
      cardId,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      width: rect.width, active: false,
    })
  }, [])

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
      setDragging(prev => {
        if (!prev) return null
        if (!prev.active) {
          const dx = e.clientX - prev.startX
          const dy = e.clientY - prev.startY
          if (Math.sqrt(dx * dx + dy * dy) < 5) return prev
          return { ...prev, active: true }
        }
        return prev
      })

      // Find drop target
      let best: typeof dropTarget = null
      for (const [key, el] of Object.entries(rowRefs.current)) {
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (e.clientY >= rect.top - 10 && e.clientY <= rect.bottom + 10 &&
            e.clientX >= rect.left - 20 && e.clientX <= rect.right + 20) {
          const parts = key.split(':')
          const phaseId = parts[0]
          const rowIdx = parseInt(parts[1])
          const cardEls = el.querySelectorAll('[data-cardid]')
          let insertIdx = cardEls.length
          for (let i = 0; i < cardEls.length; i++) {
            const cr = cardEls[i].getBoundingClientRect()
            if (e.clientX < cr.left + cr.width / 2) { insertIdx = i; break }
          }
          best = { phaseId, rowIdx, insertIdx }
          break
        }
      }

      // Check new-row zones
      if (!best) {
        const newRowEls = document.querySelectorAll('[data-newrow]')
        newRowEls.forEach(el => {
          const rect = el.getBoundingClientRect()
          if (e.clientY >= rect.top && e.clientY <= rect.bottom &&
              e.clientX >= rect.left && e.clientX <= rect.right) {
            const phaseId = el.getAttribute('data-newrow')
            if (phaseId) best = { phaseId, rowIdx: -1, insertIdx: 0, newRow: true }
          }
        })
      }
      setDropTarget(best)
    }

    const handleMouseUp = () => {
      if (dragging && dragging.active && dropTarget) {
        performDrop(dragging.cardId, dropTarget)
      }
      setDragging(null)
      setDropTarget(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, dropTarget, cards, phases])

  const performDrop = async (cardId: string, target: NonNullable<typeof dropTarget>) => {
    const card = cards.find(c => c.id === cardId)
    if (!card) return

    if (target.newRow) {
      const newRow = getNextRow(target.phaseId)
      // Optimistic
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, phase_id: target.phaseId, row_index: newRow, sort_order: 0 } : c))
      // Reindex source row
      const srcRow = cards.filter(c => c.phase_id === card.phase_id && c.row_index === card.row_index && c.id !== cardId).sort((a, b) => a.sort_order - b.sort_order)
      for (let i = 0; i < srcRow.length; i++) {
        await supabase.from('journey_cards').update({ sort_order: i }).eq('id', srcRow[i].id)
      }
      await supabase.from('journey_cards').update({ phase_id: target.phaseId, row_index: newRow, sort_order: 0, updated_at: new Date().toISOString() }).eq('id', cardId)
      return
    }

    // Get target row cards excluding dragged
    const targetRowCards = cards
      .filter(c => c.phase_id === target.phaseId && c.row_index === target.rowIdx && c.id !== cardId)
      .sort((a, b) => a.sort_order - b.sort_order)

    // Build new order
    const reordered: { id: string; sort_order: number; phase_id?: string; row_index?: number }[] = []
    let idx = 0
    let placed = false
    for (let i = 0; i < targetRowCards.length; i++) {
      if (idx === target.insertIdx && !placed) {
        reordered.push({ id: cardId, sort_order: idx, phase_id: target.phaseId, row_index: target.rowIdx })
        idx++; placed = true
      }
      reordered.push({ id: targetRowCards[i].id, sort_order: idx })
      idx++
    }
    if (!placed) {
      reordered.push({ id: cardId, sort_order: idx, phase_id: target.phaseId, row_index: target.rowIdx })
    }

    // Reindex source row if different
    const sourceReindex: { id: string; sort_order: number }[] = []
    if (card.phase_id !== target.phaseId || card.row_index !== target.rowIdx) {
      const srcRow = cards.filter(c => c.phase_id === card.phase_id && c.row_index === card.row_index && c.id !== cardId).sort((a, b) => a.sort_order - b.sort_order)
      srcRow.forEach((c, i) => sourceReindex.push({ id: c.id, sort_order: i }))
    }

    // Optimistic update
    setCards(prev => {
      const next = [...prev]
      for (const u of reordered) {
        const i = next.findIndex(c => c.id === u.id)
        if (i >= 0) {
          next[i] = { ...next[i], sort_order: u.sort_order, ...(u.phase_id ? { phase_id: u.phase_id } : {}), ...(u.row_index !== undefined ? { row_index: u.row_index } : {}) }
        }
      }
      for (const u of sourceReindex) {
        const i = next.findIndex(c => c.id === u.id)
        if (i >= 0) next[i] = { ...next[i], sort_order: u.sort_order }
      }
      return next
    })

    // Persist
    for (const u of [...reordered, ...sourceReindex]) {
      const payload: Record<string, unknown> = { sort_order: u.sort_order, updated_at: new Date().toISOString() }
      if ('phase_id' in u && u.phase_id) payload.phase_id = u.phase_id
      if ('row_index' in u && u.row_index !== undefined) payload.row_index = u.row_index
      await supabase.from('journey_cards').update(payload).eq('id', u.id)
    }
  }

  const isDraggingActive = dragging?.active || false
  const draggedCard = isDraggingActive ? cards.find(c => c.id === dragging?.cardId) : null
  const draggedPhase = draggedCard ? phases.find(p => p.id === draggedCard.phase_id) : null
  const totalCards = cards.length

  // ── Loading ──
  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#F5F6FA]" style={{ userSelect: isDraggingActive ? 'none' : 'auto' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-7 pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Journey Builder</h1>
            <p className="text-sm text-gray-500 mt-1">{currentOrg?.name} · {phases.length} paths · {totalCards} cards</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAddingPhase(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Plus className="w-4 h-4" /> Add Path
            </button>
          </div>
        </div>
        {addingPhase && (
          <div className="flex items-center gap-2 mt-3">
            <input value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPhase()}
              placeholder="Path name (e.g. Acquisition, Onboarding)" className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-72 outline-none focus:ring-2 focus:ring-blue-100" autoFocus />
            <button onClick={addPhase} className="px-3 py-2 bg-[#386797] text-white rounded-lg text-sm font-medium">Add</button>
            <button onClick={() => { setAddingPhase(false); setNewPhaseName('') }}><X className="w-4 h-4 text-gray-400" /></button>
          </div>
        )}
      </div>

      {/* Scrollable Canvas */}
      <div className="flex-1 overflow-auto px-7 pb-7">
        <div className="flex flex-col gap-5">
          {phases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ArrowRight className="w-8 h-8 text-gray-300 mb-4" />
              <h3 className="text-sm font-semibold text-gray-700 mb-1">No Paths Yet</h3>
              <p className="text-xs text-gray-500 mb-4">Add your first path to start building the journey.</p>
              <button onClick={() => setAddingPhase(true)} className="px-4 py-2 bg-[#386797] text-white rounded-lg text-xs font-medium">Add First Path</button>
            </div>
          ) : (
            [...phases].sort((a, b) => a.sort_order - b.sort_order).map(phase => {
              const rowNumbers = getRowNumbers(phase.id)
              const phaseCards = getPhaseCards(phase.id)

              const isPhaseCollapsed = collapsedPhases.has(phase.id)
              const togglePhase = () => setCollapsedPhases(prev => {
                const next = new Set(prev)
                next.has(phase.id) ? next.delete(phase.id) : next.add(phase.id)
                return next
              })

              return (
                <div key={phase.id} className="flex bg-white rounded-2xl border border-gray-200/80">
                  {/* Phase sidebar */}
                  <div className="flex-shrink-0 w-44 flex flex-col justify-center px-5 py-6 rounded-l-2xl" style={{ borderRight: `4px solid ${phase.color}`, background: `${phase.color}08` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={togglePhase} className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
                        {isPhaseCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {editingPhase === phase.id ? (
                        <input value={editPhaseLabel} onChange={e => setEditPhaseLabel(e.target.value)}
                          onBlur={() => updatePhaseLabel(phase.id, editPhaseLabel)} onKeyDown={e => e.key === 'Enter' && updatePhaseLabel(phase.id, editPhaseLabel)}
                          className="text-sm font-bold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent w-full" autoFocus />
                      ) : (
                        <h3 className="text-sm font-bold text-gray-900 cursor-pointer hover:text-blue-700"
                          onDoubleClick={() => { setEditingPhase(phase.id); setEditPhaseLabel(phase.label) }}>{phase.label}</h3>
                      )}
                      <span className="text-xs text-gray-400">({phaseCards.length})</span>
                    </div>
                    <span className="text-[11px] text-gray-400 ml-[22px]">{rowNumbers.length} row{rowNumbers.length !== 1 ? 's' : ''}</span>
                    <div className="flex gap-1 mt-3 ml-[22px]">
                      <button onClick={() => { setAddingCardAt({ phaseId: phase.id, row: getNextRow(phase.id) }); setNewCardTitle('') }}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded"><Plus className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deletePhase(phase.id)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>

                  {/* Rows area */}
                  {!isPhaseCollapsed && <div className="p-4 flex-1 min-w-0">
                    {rowNumbers.map((rowIdx, ri) => {
                      const rowCards = getRowCards(phase.id, rowIdx)
                      const rowKey = `${phase.id}:${rowIdx}`
                      const isDropRow = dropTarget && !dropTarget.newRow && dropTarget.phaseId === phase.id && dropTarget.rowIdx === rowIdx
                      const isCollapsed = collapsedRows.has(rowKey)
                      const toggleRow = () => setCollapsedRows(prev => {
                        const next = new Set(prev)
                        next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey)
                        return next
                      })

                      return (
                        <div key={rowIdx}>
                          {/* Row toggle header */}
                          <div className="flex items-center gap-1.5 px-1 py-1">
                            <button onClick={toggleRow} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors">
                              {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              <span className="text-[10px] font-medium">Row {ri + 1}</span>
                            </button>
                            <span className="text-[9px] text-gray-300">{rowCards.length} card{rowCards.length !== 1 ? 's' : ''}</span>
                          </div>

                          {!isCollapsed && (
                          <div ref={el => { rowRefs.current[rowKey] = el }}
                            className="flex items-start gap-0 flex-nowrap rounded-xl transition-colors"
                            style={{ minHeight: 80, padding: '8px 4px', paddingBottom: 12, overflowX: 'auto', background: isDropRow ? `${phase.color}08` : 'transparent' }}>
                            {rowCards.map((card, cardIdx) => {
                              const status = STATUS_CONFIG[card.status]
                              const StatusIcon = status.icon
                              const isBeingDragged = isDraggingActive && dragging?.cardId === card.id
                              const showInsertBefore = isDropRow && dropTarget?.insertIdx === cardIdx && dragging?.cardId !== card.id

                              return (
                                <div key={card.id} className="flex items-start flex-shrink-0">
                                  {/* Insert indicator */}
                                  <div className="flex-shrink-0 rounded transition-all" style={{
                                    width: showInsertBefore ? 4 : 0, background: phase.color,
                                    minHeight: 80, margin: showInsertBefore ? '0 6px' : 0,
                                  }} />

                                  {/* Card */}
                                  <div data-cardid={card.id} onMouseDown={e => handleMouseDown(e, card.id)}
                                    className="group relative bg-white rounded-xl shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing select-none"
                                    style={{ width: 170, border: `2px solid ${phase.color}25`, opacity: isBeingDragged ? 0.25 : 1 }}>
                                    <div className="h-1 rounded-t-[10px]" style={{ background: phase.color }} />
                                    <div className="p-1.5">
                                      <div className="flex items-start gap-1.5">
                                        <button onClick={e => { e.stopPropagation(); cycleStatus(card) }} className="mt-0.5 flex-shrink-0" title={status.label}>
                                          <StatusIcon className="w-4 h-4" style={{ color: status.color }} fill={card.status === 'done' ? status.color : 'none'} />
                                        </button>
                                        <span className="text-xs font-medium text-gray-900 leading-tight line-clamp-2">{card.title}</span>
                                      </div>
                                      {card.description && <p className="text-[10px] text-gray-500 mt-1 leading-relaxed line-clamp-2 ml-[22px]">{card.description}</p>}
                                      {card.tags && card.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1.5 ml-[22px]">
                                          {card.tags.map(tag => {
                                            const s = getTagStyle(tag)
                                            return <span key={tag} className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ background: s.bg, color: s.text }}>{tag}</span>
                                          })}
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between mt-2 ml-[22px]">
                                        <span className="text-[8px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide" style={{ background: status.bg, color: status.color }}>{status.label}</span>
                                        <div>
                                          <button
                                            onMouseDown={e => e.stopPropagation()}
                                            onClick={e => {
                                              e.stopPropagation()
                                              if (cardMenuOpen === card.id) {
                                                setCardMenuOpen(null)
                                                setMenuPos(null)
                                              } else {
                                                const rect = e.currentTarget.getBoundingClientRect()
                                                setMenuPos({ top: rect.top - 72, left: rect.left - 100 })
                                                setCardMenuOpen(card.id)
                                              }
                                            }}
                                            className="p-1 text-gray-300 hover:text-gray-600 rounded opacity-0 group-hover:opacity-100"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                                        </div>
                                      </div>
                                    </div>
                                    {/* Grip dots */}
                                    <div className="absolute top-2.5 right-2 opacity-30 group-hover:opacity-50">
                                      <div className="flex flex-col gap-0.5">
                                        {[0,1,2].map(r => <div key={r} className="flex gap-0.5">{[0,1].map(c => <div key={c} className="w-[3px] h-[3px] rounded-full bg-gray-400" />)}</div>)}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Arrow */}
                                  {cardIdx < rowCards.length - 1 && (
                                    <div className="flex-shrink-0 flex items-center px-1 pt-5">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                            {/* End-of-row insert indicator */}
                            {isDropRow && dropTarget && dropTarget.insertIdx >= rowCards.length && dragging && (
                              <div className="flex-shrink-0 rounded" style={{ width: 4, background: phase.color, minHeight: 80, margin: '0 6px' }} />
                            )}

                            {/* Add card */}
                            {!isDraggingActive && (
                              <>
                                {rowCards.length > 0 && (
                                  <div className="flex-shrink-0 flex items-center px-1 pt-5">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                                  </div>
                                )}
                                <button onClick={() => { setAddingCardAt({ phaseId: phase.id, row: rowIdx }); setNewCardTitle('') }}
                                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 text-xs font-medium hover:border-blue-300 hover:text-blue-500 whitespace-nowrap"
                                  style={{ minHeight: 60 }}>
                                  <Plus className="w-3.5 h-3.5" /> Add Card
                                </button>
                              </>
                            )}
                          </div>
                          )}

                          {/* Row divider */}
                          {ri < rowNumbers.length - 1 && <div className="border-b border-dashed border-gray-200 mx-1 my-1" />}
                        </div>
                      )
                    })}

                    {/* Add row / new row drop zone */}
                    <div data-newrow={phase.id}
                      className="mt-2 px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors"
                      style={{
                        border: isDraggingActive ? '2px dashed #D1D5DB' : 'none',
                        background: dropTarget?.newRow && dropTarget?.phaseId === phase.id ? `${phase.color}10` : 'transparent',
                      }}>
                      <Plus className="w-3.5 h-3.5" />
                      {isDraggingActive ? 'Drop to create new row' : `Add Row to ${phase.label}`}
                    </div>

                    {/* Inline add card form */}
                    {addingCardAt?.phaseId === phase.id && (
                      <div className="flex items-center gap-2 mt-2 ml-1">
                        <input value={newCardTitle} onChange={e => setNewCardTitle(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addCard(addingCardAt.phaseId, addingCardAt.row)}
                          placeholder="Card title..." className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-56 outline-none focus:ring-2 focus:ring-blue-100" autoFocus />
                        <button onClick={() => addCard(addingCardAt.phaseId, addingCardAt.row)} className="px-2.5 py-1.5 bg-[#386797] text-white rounded-lg text-[11px] font-medium">Add</button>
                        <button onClick={() => setAddingCardAt(null)}><X className="w-3.5 h-3.5 text-gray-400" /></button>
                      </div>
                    )}
                  </div>}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Floating drag ghost */}
      {isDraggingActive && draggedCard && draggedPhase && (
        <div className="fixed pointer-events-none z-[9999]" style={{
          left: mousePos.x - (dragging?.offsetX || 0), top: mousePos.y - (dragging?.offsetY || 0),
          width: dragging?.width || 170, opacity: 0.85, transform: 'rotate(2deg) scale(1.02)',
        }}>
          <div className="bg-white rounded-xl shadow-2xl" style={{ border: `2px solid ${draggedPhase.color}50` }}>
            <div className="h-1 rounded-t-[10px]" style={{ background: draggedPhase.color }} />
            <div className="p-1.5">
              <div className="flex items-start gap-1.5">
                <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0 mt-0.5" />
                <span className="text-xs font-medium text-gray-900">{draggedCard.title}</span>
              </div>
              {draggedCard.description && <p className="text-[10px] text-gray-500 mt-1 ml-[22px]">{draggedCard.description}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Card Detail Panel */}
      <CardDetailPanel
        card={editingCard}
        phases={phases}
        onClose={() => setEditingCard(null)}
        onUpdate={async (id, updates) => { await updateCard(id, updates); setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c)) }}
        onDelete={async (id) => { await deleteCard(id); setEditingCard(null) }}
        onDuplicate={async (card, targetPhaseId, targetRow) => {
          if (!currentOrg?.id) return
          const rowCards = cards.filter(c => c.phase_id === targetPhaseId && c.row_index === targetRow)
          const maxSort = rowCards.length > 0 ? Math.max(...rowCards.map(c => c.sort_order)) + 1 : 0
          const { data } = await supabase.from('journey_cards').insert({
            org_id: currentOrg.id, phase_id: targetPhaseId, title: card.title + ' (copy)',
            description: card.description, status: card.status, row_index: targetRow,
            sort_order: maxSort, custom_fields: card.custom_fields,
          }).select().single()
          if (data) setCards(prev => [...prev, data])
        }}
        orgId={currentOrg?.id}
      />

      {/* Card context menu - portaled to body to escape overflow clipping */}
      {mounted && cardMenuOpen && menuPos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => { setCardMenuOpen(null); setMenuPos(null) }} />
          <div style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999, width: 112 }}
            className="bg-white rounded-lg shadow-xl border py-1">
            <button onClick={() => {
              const c = cards.find(x => x.id === cardMenuOpen)
              if (c) setEditingCard(c)
              setCardMenuOpen(null); setMenuPos(null)
            }} className="w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Edit3 className="w-3 h-3" /> Edit
            </button>
            <button onClick={() => {
              if (cardMenuOpen) deleteCard(cardMenuOpen)
              setMenuPos(null)
            }} className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
