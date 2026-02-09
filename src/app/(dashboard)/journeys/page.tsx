'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
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
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useJourneyData } from '@/lib/hooks/use-journey-data'
import { useWorkspace } from '@/lib/workspace-context'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import JourneyNode from '@/components/journey/journey-node'
import ConvergenceNode from '@/components/journey/convergence-node'
import PhaseLabelNode from '@/components/journey/phase-label-node'
import type { JourneyCard } from '@/lib/types/journey'
import { STATUS_CONFIG, PHASE_COLORS } from '@/lib/types/journey'
import { Plus, Wand2, ZoomIn, ZoomOut } from 'lucide-react'

const nodeTypes = {
  journeyCard: JourneyNode,
  convergence: ConvergenceNode,
  phaseLabel: PhaseLabelNode,
}

const CARD_WIDTH = 220
const CARD_HEIGHT = 140
const H_GAP = 60
const V_GAP = 40
const PHASE_LABEL_WIDTH = 50
const PHASE_START_X = 80

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

  // Build nodes and edges from data
  useEffect(() => {
    if (phases.length === 0) return

    const newNodes: Node[] = []
    const newEdges: Edge[] = []
    let currentY = 0

    phases.forEach((phase, phaseIdx) => {
      const phaseCards = cards.filter(c => c.phase_id === phase.id)
      const phaseColor = phase.color || PHASE_COLORS[phase.phase_key] || '#386797'

      // Group by row
      const rowGroups: Record<number, JourneyCard[]> = {}
      phaseCards.forEach(card => {
        const row = card.row_index || 0
        if (!rowGroups[row]) rowGroups[row] = []
        rowGroups[row].push(card)
      })

      const rowNumbers = Object.keys(rowGroups).map(Number).sort((a, b) => a - b)
      if (rowNumbers.length === 0) rowNumbers.push(0)

      const phaseHeight = rowNumbers.length * (CARD_HEIGHT + V_GAP)

      // Phase label node (vertical text on the left)
      newNodes.push({
        id: `phase-${phase.id}`,
        type: 'phaseLabel',
        position: { x: 0, y: currentY + 10 },
        data: {
          label: phase.label,
          color: phaseColor,
          cardCount: phaseCards.length,
        },
        draggable: false,
        selectable: false,
      })

      // Cards per row
      rowNumbers.forEach((rowNum, rowIdx) => {
        const rowCards = (rowGroups[rowNum] || []).sort((a, b) => a.sort_order - b.sort_order)

        rowCards.forEach((card, cardIdx) => {
          const x = PHASE_START_X + cardIdx * (CARD_WIDTH + H_GAP)
          const y = currentY + rowIdx * (CARD_HEIGHT + V_GAP)

          newNodes.push({
            id: card.id,
            type: 'journeyCard',
            position: { x, y },
            data: {
              title: card.title,
              description: card.description,
              status: card.status,
              phaseLabel: phase.label,
              phaseColor: phaseColor,
              cardId: card.id,
              onStatusChange: handleStatusCycle,
              onEdit: handleCardEdit,
            },
          })

          // Connect cards in same row with arrows
          if (cardIdx > 0) {
            const prevCard = rowCards[cardIdx - 1]
            newEdges.push({
              id: `e-${prevCard.id}-${card.id}`,
              source: prevCard.id,
              target: card.id,
              type: 'smoothstep',
              animated: false,
              style: { stroke: phaseColor, strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: phaseColor,
                width: 16,
                height: 16,
              },
            })
          }
        })
      })

      // Connect last card of each row to first card of next phase (convergence)
      if (phaseIdx < phases.length - 1) {
        const nextPhase = phases[phaseIdx + 1]
        const nextPhaseCards = cards.filter(c => c.phase_id === nextPhase.id)
        const nextFirstRow = nextPhaseCards.filter(c => (c.row_index || 0) === 0).sort((a, b) => a.sort_order - b.sort_order)

        if (nextFirstRow.length > 0) {
          rowNumbers.forEach(rowNum => {
            const rowCards = (rowGroups[rowNum] || []).sort((a, b) => a.sort_order - b.sort_order)
            if (rowCards.length > 0) {
              const lastCard = rowCards[rowCards.length - 1]
              newEdges.push({
                id: `e-phase-${lastCard.id}-${nextFirstRow[0].id}`,
                source: lastCard.id,
                target: nextFirstRow[0].id,
                type: 'smoothstep',
                animated: true,
                style: {
                  stroke: '#9CA3AF',
                  strokeWidth: 1.5,
                  strokeDasharray: '8 4',
                },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#9CA3AF',
                  width: 14,
                  height: 14,
                },
                label: rowNumbers.length > 1 ? '▼' : undefined,
              })
            }
          })
        }
      }

      currentY += phaseHeight + 60
    })

    setNodes(newNodes)
    setEdges(newEdges)
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

  // Allow user-drawn connections
  const onConnect = useCallback((params: Connection) => {
    setEdges(eds =>
      addEdge(
        {
          ...params,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#386797', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#386797',
            width: 16,
            height: 16,
          },
        },
        eds
      )
    )
  }, [setEdges])

  const handleAddPhase = async () => {
    if (!newPhaseLabel.trim()) return
    const key = newPhaseLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const colors = Object.values(PHASE_COLORS)
    const color = colors[phases.length % colors.length]
    await addPhase(newPhaseLabel.trim(), key, color)
    setNewPhaseLabel('')
    setAddingPhase(false)
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
            Create a visual map of your customer journey with phases, cards, and connections showing how people flow through your pipeline.
          </p>
          <button
            onClick={() => setAddingPhase(true)}
            className="btn-primary"
          >
            Create First Phase
          </button>
          {addingPhase && (
            <div className="mt-4">
              <input
                value={newPhaseLabel}
                onChange={e => setNewPhaseLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddPhase()
                  if (e.key === 'Escape') setAddingPhase(false)
                }}
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
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        connectionLineStyle={{ stroke: '#386797', strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#E5E7EB"
        />
        <Controls
          showInteractive={false}
          className="!bg-white !border-gray-200 !rounded-xl !shadow-sm"
        />

        {/* Top toolbar */}
        <Panel position="top-left" className="flex gap-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-2.5 flex items-center gap-4">
            <h1 className="text-base font-semibold text-np-dark">
              Journey Builder
            </h1>
            <span className="text-xs text-gray-400">
              {currentOrg?.name}
            </span>
          </div>
        </Panel>

        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={() => setAddingPhase(true)}
            className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-2 text-sm font-medium text-np-dark hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Phase
          </button>
          <button
            className="bg-np-blue text-white rounded-xl shadow-sm px-3 py-2 flex items-center gap-2 text-sm font-medium hover:bg-np-blue/90 transition-colors"
          >
            <Wand2 className="w-4 h-4" />
            AI Journey Creator
          </button>
        </Panel>

        {/* Add Phase Modal */}
        {addingPhase && (
          <Panel position="top-center">
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 w-72 mt-16">
              <h3 className="text-sm font-semibold text-np-dark mb-3">New Phase</h3>
              <input
                value={newPhaseLabel}
                onChange={e => setNewPhaseLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddPhase()
                  if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseLabel('') }
                }}
                placeholder="Phase name (e.g., Awareness)..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 mb-3"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleAddPhase} className="btn-primary text-xs py-1.5 px-4 flex-1">Add Phase</button>
                <button onClick={() => { setAddingPhase(false); setNewPhaseLabel('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
              </div>
            </div>
          </Panel>
        )}

        {/* Legend */}
        <Panel position="bottom-left">
          <div className="bg-white/90 backdrop-blur rounded-xl shadow-sm border border-gray-100 px-4 py-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">How to connect</p>
            <p className="text-[11px] text-gray-400">
              Drag from a card's right handle to another card's left handle to create a connection arrow.
              Double-click any card to edit. Click the status dot to cycle status.
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
