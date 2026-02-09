'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  Panel,
  EdgeProps,
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useJourneyData } from '@/lib/hooks/use-journey-data'
import { useWorkspace } from '@/lib/workspace-context'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import JourneyNode from '@/components/journey/journey-node'
import type { JourneyCard } from '@/lib/types/journey'
import { STATUS_CONFIG, PHASE_COLORS } from '@/lib/types/journey'
import { Plus, Wand2, Trash2, X, Pencil } from 'lucide-react'

// Custom edge with delete button
function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data, selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
            className="flex gap-1"
          >
            <button
              onClick={() => data?.onDelete(id)}
              className="bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600 shadow-md"
              title="Delete connection"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { journeyCard: JourneyNode }
const edgeTypes = { deletable: DeletableEdge }

const CARD_W = 190
const CARD_H = 80
const COL_GAP = 60
const ROW_GAP = 50
const TOP_HEADER = 70
const LEFT_LABELS = 160
const COL_WIDTH = CARD_W + COL_GAP

export default function JourneysPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const {
    phases, cards, loading,
    addPhase, updatePhase, deletePhase,
    addCard, updateCard, deleteCard,
  } = useJourneyData()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedCard, setSelectedCard] = useState<JourneyCard | null>(null)
  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseLabel, setNewPhaseLabel] = useState('')
  const [addingRow, setAddingRow] = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('')
  const [rowLabels, setRowLabels] = useState<string[]>([])
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editRowLabel, setEditRowLabel] = useState('')

  // Derive row labels from card data
  useEffect(() => {
    if (cards.length === 0) return
    const maxRow = Math.max(...cards.map(c => c.row_index || 0), 0)
    const existing = [...rowLabels]
    while (existing.length <= maxRow) {
      existing.push(`Route ${existing.length + 1}`)
    }
    if (existing.length !== rowLabels.length) {
      setRowLabels(existing)
    }
  }, [cards])

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges(eds => eds.filter(e => e.id !== edgeId))
  }, [setEdges])

  // Build nodes from phases/cards in grid layout
  useEffect(() => {
    if (phases.length === 0) return

    const newNodes: Node[] = []
    const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order)

    // Determine rows
    const maxRow = cards.length > 0 ? Math.max(...cards.map(c => c.row_index || 0)) : 0
    const rowCount = Math.max(maxRow + 1, rowLabels.length, 1)

    // Phase header nodes
    sortedPhases.forEach((phase, colIdx) => {
      const phaseColor = phase.color || PHASE_COLORS[phase.phase_key] || '#386797'
      const x = LEFT_LABELS + colIdx * COL_WIDTH

      newNodes.push({
        id: `header-${phase.id}`,
        type: 'default',
        position: { x, y: 0 },
        data: { label: phase.label },
        draggable: false,
        selectable: false,
        style: {
          background: `${phaseColor}15`,
          border: `2px solid ${phaseColor}`,
          borderRadius: '10px',
          padding: '6px 16px',
          fontSize: '12px',
          fontWeight: 700,
          color: phaseColor,
          width: CARD_W,
          textAlign: 'center' as const,
        },
      })
    })

    // Row label nodes
    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      const y = TOP_HEADER + rowIdx * (CARD_H + ROW_GAP)
      newNodes.push({
        id: `rowlabel-${rowIdx}`,
        type: 'default',
        position: { x: 0, y: y + 10 },
        data: { label: rowLabels[rowIdx] || `Route ${rowIdx + 1}` },
        draggable: false,
        selectable: false,
        style: {
          background: '#F9FAFB',
          border: '1px solid #E5E7EB',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '11px',
          fontWeight: 600,
          color: '#6B7280',
          width: LEFT_LABELS - 20,
          textAlign: 'right' as const,
        },
      })
    }

    // Card nodes in grid positions
    sortedPhases.forEach((phase, colIdx) => {
      const phaseColor = phase.color || PHASE_COLORS[phase.phase_key] || '#386797'
      const phaseCards = cards.filter(c => c.phase_id === phase.id)

      phaseCards.forEach(card => {
        const rowIdx = card.row_index || 0
        const x = LEFT_LABELS + colIdx * COL_WIDTH
        const y = TOP_HEADER + rowIdx * (CARD_H + ROW_GAP)

        newNodes.push({
          id: card.id,
          type: 'journeyCard',
          position: { x, y },
          data: {
            title: card.title,
            description: card.description,
            status: card.status,
            phaseColor,
            cardId: card.id,
            onStatusChange: handleStatusCycle,
            onEdit: handleCardEdit,
          },
        })
      })
    })

    setNodes(newNodes)
  }, [phases, cards, rowLabels])

  // Auto-generate default edges (cards in same row, adjacent phases)
  useEffect(() => {
    if (phases.length === 0 || cards.length === 0) return

    const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order)
    const newEdges: Edge[] = []

    sortedPhases.forEach((phase, colIdx) => {
      if (colIdx === 0) return
      const prevPhase = sortedPhases[colIdx - 1]
      const prevPhaseColor = prevPhase.color || PHASE_COLORS[prevPhase.phase_key] || '#386797'

      const prevCards = cards.filter(c => c.phase_id === prevPhase.id)
      const currCards = cards.filter(c => c.phase_id === phase.id)

      // Connect cards in same row between adjacent phases
      prevCards.forEach(prevCard => {
        const matchingCard = currCards.find(c => (c.row_index || 0) === (prevCard.row_index || 0))
        if (matchingCard) {
          newEdges.push({
            id: `auto-${prevCard.id}-${matchingCard.id}`,
            source: prevCard.id,
            target: matchingCard.id,
            type: 'deletable',
            data: { onDelete: handleDeleteEdge },
            style: { stroke: prevPhaseColor, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: prevPhaseColor, width: 14, height: 14 },
          })
        }
      })
    })

    setEdges(prev => {
      // Keep user-drawn edges, replace auto edges
      const userEdges = prev.filter(e => !e.id.startsWith('auto-'))
      return [...userEdges, ...newEdges]
    })
  }, [phases, cards])

  const handleStatusCycle = useCallback((cardId: string) => {
    const card = cards.find(c => c.id === cardId)
    if (!card) return
    const order: Array<JourneyCard['status']> = ['not_started', 'in_progress', 'done']
    const currentIdx = order.indexOf(card.status)
    const nextStatus = order[(currentIdx + 1) % order.length]
    updateCard(cardId, { status: nextStatus })
  }, [cards, updateCard])

  const handleCardEdit = useCallback((cardId: string) => {
    const card = cards.find(c => c.id === cardId)
    if (card) setSelectedCard(card)
  }, [cards])

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds =>
      addEdge({
        ...params,
        type: 'deletable',
        data: { onDelete: handleDeleteEdge },
        animated: true,
        style: { stroke: '#386797', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#386797', width: 14, height: 14 },
      }, eds)
    )
  }, [setEdges, handleDeleteEdge])

  const handleAddPhase = async () => {
    if (!newPhaseLabel.trim()) return
    const key = newPhaseLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const colors = Object.values(PHASE_COLORS)
    const color = colors[phases.length % colors.length]
    await addPhase(newPhaseLabel.trim(), key, color)
    setNewPhaseLabel('')
    setAddingPhase(false)
  }

  const handleAddRow = () => {
    if (!newRowLabel.trim()) return
    setRowLabels(prev => [...prev, newRowLabel.trim()])
    setNewRowLabel('')
    setAddingRow(false)
  }

  const handleEditRow = (idx: number) => {
    setEditingRow(idx)
    setEditRowLabel(rowLabels[idx] || `Route ${idx + 1}`)
  }

  const handleSaveRowEdit = () => {
    if (editingRow === null) return
    setRowLabels(prev => {
      const next = [...prev]
      next[editingRow] = editRowLabel.trim() || `Route ${editingRow + 1}`
      return next
    })
    setEditingRow(null)
  }

  const handleDeleteRow = (idx: number) => {
    setRowLabels(prev => prev.filter((_, i) => i !== idx))
    // TODO: reassign cards in this row
  }

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <div className="animate-pulse text-gray-400">Loading journey...</div>
      </div>
    )
  }

  if (phases.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <div className="card p-12 text-center max-w-md">
          <div className="w-16 h-16 bg-np-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Wand2 className="w-8 h-8 text-np-blue" />
          </div>
          <h2 className="text-xl font-semibold text-np-dark mb-2">Build Your Journey</h2>
          <p className="text-sm text-gray-500 mb-6">
            Map your customer journey with phases across the top and parallel routes down the side. Draw arrows to show how paths converge.
          </p>
          <button onClick={() => setAddingPhase(true)} className="btn-primary">
            Create First Phase
          </button>
          {addingPhase && (
            <div className="mt-4">
              <input
                value={newPhaseLabel}
                onChange={e => setNewPhaseLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') setAddingPhase(false) }}
                placeholder="Phase name..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 mb-2"
                autoFocus
              />
              <div className="flex gap-2 justify-center">
                <button onClick={handleAddPhase} className="btn-primary text-xs py-1.5 px-4">Add</button>
                <button onClick={() => setAddingPhase(false)} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-48px)] -m-6">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: 'deletable' }}
        connectionLineStyle={{ stroke: '#386797', strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
        selectionOnDrag
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E5E7EB" />
        <Controls showInteractive={false} className="!bg-white !border-gray-200 !rounded-xl !shadow-sm" />

        {/* Top toolbar */}
        <Panel position="top-left" className="flex gap-2">
          <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-gray-100 px-4 py-2.5 flex items-center gap-4">
            <h1 className="text-sm font-semibold text-np-dark">Journey Builder</h1>
            <span className="text-xs text-gray-400">{currentOrg?.name}</span>
          </div>
        </Panel>

        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={() => setAddingRow(true)}
            className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-1.5 text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Row
          </button>
          <button
            onClick={() => setAddingPhase(true)}
            className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-1.5 text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Phase
          </button>
          <button
            className="bg-np-blue text-white rounded-xl shadow-sm px-3 py-2 flex items-center gap-1.5 text-xs font-medium hover:bg-np-blue/90 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" /> AI Journey Creator
          </button>
        </Panel>

        {/* Add Phase Modal */}
        {addingPhase && (
          <Panel position="top-center">
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 w-64 mt-14">
              <h3 className="text-xs font-semibold text-np-dark mb-2">New Phase</h3>
              <input
                value={newPhaseLabel}
                onChange={e => setNewPhaseLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseLabel('') } }}
                placeholder="Phase name..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 mb-2"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleAddPhase} className="btn-primary text-xs py-1 px-3 flex-1">Add</button>
                <button onClick={() => { setAddingPhase(false); setNewPhaseLabel('') }} className="btn-secondary text-xs py-1 px-3">Cancel</button>
              </div>
            </div>
          </Panel>
        )}

        {/* Add Row Modal */}
        {addingRow && (
          <Panel position="top-center">
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 w-64 mt-14">
              <h3 className="text-xs font-semibold text-np-dark mb-2">New Row</h3>
              <input
                value={newRowLabel}
                onChange={e => setNewRowLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddRow(); if (e.key === 'Escape') { setAddingRow(false); setNewRowLabel('') } }}
                placeholder="Row label (e.g., Meta Ads Path)..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 mb-2"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleAddRow} className="btn-primary text-xs py-1 px-3 flex-1">Add</button>
                <button onClick={() => { setAddingRow(false); setNewRowLabel('') }} className="btn-secondary text-xs py-1 px-3">Cancel</button>
              </div>
            </div>
          </Panel>
        )}

        {/* Legend */}
        <Panel position="bottom-left">
          <div className="bg-white/90 backdrop-blur rounded-xl shadow-sm border border-gray-100 px-3 py-2">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              <strong>Drag</strong> handle → handle to connect · <strong>Click arrow</strong> then ✕ to delete · <strong>Double-click</strong> card to edit · <strong>Delete key</strong> removes selected
            </p>
          </div>
        </Panel>
      </ReactFlow>

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
