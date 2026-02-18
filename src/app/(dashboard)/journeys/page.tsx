'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import type { JourneyCard, JourneyPhase } from '@/lib/types/journey'
import { STATUS_CONFIG, PHASE_COLORS } from '@/lib/types/journey'
import {
  Plus, Wand2, Route, Loader2, X, Sparkles, GripVertical, Copy, Link2,
  Trash2, ArrowRight, ChevronDown, FileText, Zap, Hand, RefreshCw,
  Maximize2, Minimize2, ZoomIn, ZoomOut, Move, Eye, Pencil,
} from 'lucide-react'

const PATH_COLORS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#386797', '#EC4899', '#06B6D4', '#84CC16', '#F97316',
]

const QUICK_PROMPTS = [
  'Mastermind cohort launch: marketing, sales, onboarding, 12-week program, off-boarding with alumni community',
  'Online course: lead gen, nurture sequence, sales page, enrollment, curriculum delivery, graduation',
  'Coaching business: awareness, discovery call, enrollment, 1:1 sessions, progress tracking, testimonials',
  'SaaS product: acquisition, trial, onboarding, activation, retention, expansion, referral',
]

const AI_SYSTEM = `You are a customer journey architect and SOP writer. Given a business description, generate a complete customer journey map AND matching SOPs.

RULES:
- Return ONLY valid JSON, no markdown
- Each path = major phase (Marketing, Sales, Onboarding, Program, Off-boarding)
- Each path has cards = specific touchpoints or deliverables
- Cards use row_index for parallel tracks (row 0 = Facebook Ads, row 1 = Organic)
- Keep card titles short (2-5 words)
- Generate 3-7 paths with 3-10 cards each
- For EACH path, generate a matching SOP with step-by-step instructions
- SOP steps map to journey cards where applicable

JSON FORMAT:
{
  "paths": [
    {
      "name": "Marketing",
      "key": "marketing",
      "color": "#8B5CF6",
      "cards": [
        { "title": "Facebook Ads", "description": "Run targeted ads...", "row_index": 0, "automation": "automated" },
        { "title": "Organic Social", "description": "Daily posts...", "row_index": 1, "automation": "manual" }
      ]
    }
  ],
  "sops": [
    {
      "title": "Marketing Launch SOP",
      "description": "Step-by-step for launching marketing phase",
      "category": "marketing",
      "steps": [
        { "title": "Set Up Ad Account", "instructions": "Go to Facebook Business Manager...", "responsible_role": "Marketing Lead", "estimated_minutes": 30, "linked_card_title": "Facebook Ads" },
        { "title": "Create Content Calendar", "instructions": "Plan 30 days of content...", "responsible_role": "Content Creator", "estimated_minutes": 60, "linked_card_title": "Organic Social" }
      ]
    }
  ]
}`

interface DragState {
  cardId: string
  startX: number
  startY: number
  origPhase: string
  origRow: number
  origSort: number
}

export default function JourneysPage() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [phases, setPhases] = useState<JourneyPhase[]>([])
  const [cards, setCards] = useState<JourneyCard[]>([])
  const [mirrors, setMirrors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCard, setSelectedCard] = useState<JourneyCard | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; card: JourneyCard } | null>(null)
  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)
  const [sopCreateResult, setSopCreateResult] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [pRes, cRes] = await Promise.all([
      supabase.from('journey_phases').select('*').eq('org_id', currentOrg.id).order('sort_order'),
      supabase.from('journey_cards').select('*').eq('org_id', currentOrg.id).order('sort_order'),
    ])
    if (pRes.data) setPhases(pRes.data)
    if (cRes.data) setCards(cRes.data)
    // Mirrors table may not exist yet, so query separately
    const mRes = await supabase.from('journey_card_mirrors').select('*').eq('org_id', currentOrg.id)
    setMirrors(mRes.data || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  // ──────── CRUD ────────
  const addPhase = async (name: string) => {
    if (!currentOrg || !name.trim()) return
    const key = name.toLowerCase().replace(/\s+/g, '_')
    const color = PATH_COLORS[phases.length % PATH_COLORS.length]
    const { data } = await supabase.from('journey_phases').insert({
      org_id: currentOrg.id, phase_key: key, label: name.trim(),
      color, sort_order: phases.length,
    }).select().single()
    if (data) setPhases(p => [...p, data])
    setAddingPhase(false)
    setNewPhaseName('')
  }

  const deletePhase = async (id: string) => {
    await supabase.from('journey_phases').delete().eq('id', id)
    setPhases(p => p.filter(x => x.id !== id))
    setCards(c => c.filter(x => x.phase_id !== id))
  }

  const addCard = async (phaseId: string, title: string, rowIndex: number = 0) => {
    if (!currentOrg) return
    const phaseCards = cards.filter(c => c.phase_id === phaseId)
    const maxSort = phaseCards.length > 0 ? Math.max(...phaseCards.map(c => c.sort_order)) + 1 : 0
    const { data } = await supabase.from('journey_cards').insert({
      org_id: currentOrg.id, phase_id: phaseId, title, row_index: rowIndex, sort_order: maxSort,
    }).select().single()
    if (data) setCards(c => [...c, data])
    return data
  }

  const updateCard = async (id: string, updates: Partial<JourneyCard>) => {
    const { data } = await supabase.from('journey_cards')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) setCards(c => c.map(x => x.id === id ? data : x))
    return data
  }

  const deleteCard = async (id: string) => {
    await supabase.from('journey_cards').delete().eq('id', id)
    setCards(c => c.filter(x => x.id !== id))
    if (selectedCard?.id === id) setSelectedCard(null)
  }

  // ──────── DRAG & DROP (any direction) ────────
  const handleDragStart = (e: React.DragEvent, card: JourneyCard) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      cardId: card.id, phaseId: card.phase_id, rowIndex: card.row_index, sortOrder: card.sort_order,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, targetPhaseId: string, targetRow: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(`${targetPhaseId}-${targetRow}`)
  }

  const handleDrop = async (e: React.DragEvent, targetPhaseId: string, targetRow: number) => {
    e.preventDefault()
    setDragOverTarget(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.cardId) {
        // Move card to new phase/row
        const targetCards = cards.filter(c => c.phase_id === targetPhaseId && c.row_index === targetRow)
        const newSort = targetCards.length > 0 ? Math.max(...targetCards.map(c => c.sort_order)) + 1 : 0
        await updateCard(data.cardId, {
          phase_id: targetPhaseId,
          row_index: targetRow,
          sort_order: newSort,
        } as any)
      }
    } catch {}
  }

  // ──────── MIRROR / DUPLICATE ────────
  const duplicateCard = async (card: JourneyCard, targetPhaseId?: string) => {
    if (!currentOrg) return
    const newCard = await addCard(
      targetPhaseId || card.phase_id,
      `${card.title} (copy)`,
      card.row_index
    )
    if (newCard) {
      await updateCard(newCard.id, {
        description: card.description,
        status: 'not_started',
        custom_fields: card.custom_fields,
      })
    }
    return newCard
  }

  const createMirror = async (sourceCard: JourneyCard, targetPhaseId: string) => {
    if (!currentOrg) return
    // Create the mirror card
    const mirrorCard = await addCard(targetPhaseId, `${sourceCard.title}`, sourceCard.row_index)
    if (!mirrorCard) return

    // Copy content
    await updateCard(mirrorCard.id, {
      description: sourceCard.description,
      status: sourceCard.status,
      custom_fields: { ...sourceCard.custom_fields, is_mirror: true, source_id: sourceCard.id },
    })

    // Record the mirror relationship
    await supabase.from('journey_card_mirrors').insert({
      org_id: currentOrg.id,
      source_card_id: sourceCard.id,
      mirror_card_id: mirrorCard.id,
      sync_enabled: true,
    })

    fetchData()
  }

  // ──────── AI GENERATION (Journey + SOP) ────────
  const runAI = async (prompt: string) => {
    if (!currentOrg || !prompt.trim()) return
    setAiLoading(true)
    setSopCreateResult(null)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          brandSettings: null,
          campaignContext: { type: 'journey_builder', systemOverride: AI_SYSTEM },
        }),
      })
      const data = await res.json()
      const text = data.response || data.content || ''

      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      const parsed = JSON.parse(jsonMatch[0])

      // Clear existing data
      if (phases.length > 0) {
        const confirmClear = window.confirm('This will replace your current journey. Continue?')
        if (!confirmClear) { setAiLoading(false); return }
        for (const p of phases) await supabase.from('journey_phases').delete().eq('id', p.id)
      }

      // Create paths and cards
      const newPhases: any[] = []
      const cardIdMap: Record<string, string> = {} // title -> card id mapping for SOP linking

      for (let i = 0; i < (parsed.paths || []).length; i++) {
        const path = parsed.paths[i]
        const { data: phase } = await supabase.from('journey_phases').insert({
          org_id: currentOrg.id,
          phase_key: path.key || path.name.toLowerCase().replace(/\s+/g, '_'),
          label: path.name,
          color: path.color || PATH_COLORS[i % PATH_COLORS.length],
          sort_order: i,
        }).select().single()

        if (phase) {
          newPhases.push(phase)
          for (let j = 0; j < (path.cards || []).length; j++) {
            const card = path.cards[j]
            const { data: newCard } = await supabase.from('journey_cards').insert({
              org_id: currentOrg.id,
              phase_id: phase.id,
              title: card.title,
              description: card.description || '',
              row_index: card.row_index || 0,
              sort_order: j,
              custom_fields: {
                automation: card.automation || 'manual',
                section_label: card.section_label || '',
              },
            }).select().single()
            if (newCard) cardIdMap[card.title] = newCard.id
          }
        }
      }

      // Create SOPs from AI response
      let sopCount = 0
      for (const sop of (parsed.sops || [])) {
        const { data: newSop } = await supabase.from('sops').insert({
          org_id: currentOrg.id,
          title: sop.title,
          description: sop.description || '',
          category: sop.category || 'general',
          status: 'draft',
        }).select().single()

        if (newSop) {
          sopCount++
          for (let k = 0; k < (sop.steps || []).length; k++) {
            const step = sop.steps[k]
            await supabase.from('sop_steps').insert({
              sop_id: newSop.id,
              org_id: currentOrg.id,
              step_number: k + 1,
              title: step.title,
              instructions: step.instructions || '',
              responsible_role: step.responsible_role || '',
              estimated_minutes: step.estimated_minutes || null,
              linked_card_id: step.linked_card_title ? cardIdMap[step.linked_card_title] || null : null,
              sort_order: k,
            })
          }
        }
      }

      if (sopCount > 0) {
        setSopCreateResult(`Created ${sopCount} SOPs linked to this journey. View them in the SOPs section.`)
      }

      fetchData()
      setAiOpen(false)
      setAiPrompt('')
    } catch (err: any) {
      alert('AI generation failed: ' + err.message)
    }
    setAiLoading(false)
  }

  // ──────── GENERATE SOP FROM EXISTING JOURNEY ────────
  const generateSOPFromPhase = async (phase: JourneyPhase) => {
    if (!currentOrg) return
    const phaseCards = cards.filter(c => c.phase_id === phase.id).sort((a, b) => a.sort_order - b.sort_order)

    const { data: sop } = await supabase.from('sops').insert({
      org_id: currentOrg.id,
      title: `${phase.label} SOP`,
      description: `Standard operating procedure for the ${phase.label} phase`,
      category: phase.phase_key,
      status: 'draft',
      linked_journey_id: phase.id,
    }).select().single()

    if (sop) {
      for (let i = 0; i < phaseCards.length; i++) {
        await supabase.from('sop_steps').insert({
          sop_id: sop.id,
          org_id: currentOrg.id,
          step_number: i + 1,
          title: phaseCards[i].title,
          instructions: phaseCards[i].description || 'Document the process for this step.',
          linked_card_id: phaseCards[i].id,
          sort_order: i,
        })
      }
      setSopCreateResult(`Created "${sop.title}" with ${phaseCards.length} steps. View it in SOPs.`)
      setTimeout(() => setSopCreateResult(null), 5000)
    }
  }

  // ──────── CONTEXT MENU ────────
  const handleContextMenu = (e: React.MouseEvent, card: JourneyCard) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, card })
  }

  // Close context menu on click
  useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // ──────── RENDER ────────
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  const isMirror = (cardId: string) => mirrors.some(m => m.mirror_card_id === cardId)
  const getMirrorSource = (cardId: string) => mirrors.find(m => m.mirror_card_id === cardId)

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2">
            <Route className="w-5 h-5 text-np-blue" /> Journey Builder
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} - Drag cards freely between paths and rows</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="p-1.5 hover:bg-white rounded">
              <ZoomOut className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <span className="text-[10px] text-gray-500 w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(Math.min(1.5, zoom + 0.1))} className="p-1.5 hover:bg-white rounded">
              <ZoomIn className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
          <button onClick={() => setAiOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
            <Wand2 className="w-3.5 h-3.5" /> AI Generate Journey + SOPs
          </button>
          <button onClick={() => setAddingPhase(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> Add Path
          </button>
        </div>
      </div>

      {/* SOP creation notification */}
      {sopCreateResult && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 flex-shrink-0">
          <FileText className="w-4 h-4" /> {sopCreateResult}
          <button onClick={() => setSopCreateResult(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Canvas */}
      <div ref={canvasRef} className="flex-1 overflow-auto bg-gray-50/50 rounded-2xl border border-gray-100">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', minWidth: '100%' }}
          className="p-4 space-y-3">

          {phases.length === 0 && !addingPhase && (
            <div className="text-center py-20">
              <Route className="w-16 h-16 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Build Your Customer Journey</h2>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                Create paths (phases) and add cards for each touchpoint. Drag cards freely between paths and rows.
                AI can generate both the journey and matching SOPs in one click.
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setAiOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium">
                  <Wand2 className="w-4 h-4" /> AI Generate
                </button>
                <button onClick={() => setAddingPhase(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
                  <Plus className="w-4 h-4" /> Manual Build
                </button>
              </div>
            </div>
          )}

          {/* Adding phase inline */}
          {addingPhase && (
            <div className="flex items-center gap-2 mb-2">
              <input value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPhase(newPhaseName)}
                placeholder="Path name (e.g. Marketing, Sales, Onboarding)"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-72" autoFocus />
              <button onClick={() => addPhase(newPhaseName)}
                className="px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium">Add</button>
              <button onClick={() => { setAddingPhase(false); setNewPhaseName('') }}
                className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* Path rows */}
          {phases.map((phase) => {
            const phaseCards = cards.filter(c => c.phase_id === phase.id)
            const rowGroups: Record<number, JourneyCard[]> = {}
            phaseCards.forEach(c => {
              const row = c.row_index || 0
              if (!rowGroups[row]) rowGroups[row] = []
              rowGroups[row].push(c)
            })
            const rowNumbers = Object.keys(rowGroups).map(Number).sort((a, b) => a - b)
            if (rowNumbers.length === 0) rowNumbers.push(0)
            const nextRow = Math.max(...rowNumbers, -1) + 1

            return (
              <div key={phase.id} className="bg-white rounded-xl border border-gray-100 p-3">
                {/* Path header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: phase.color }} />
                    <h3 className="text-sm font-semibold text-np-dark">{phase.label}</h3>
                    <span className="text-[10px] text-gray-400">{phaseCards.length} cards</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => generateSOPFromPhase(phase)}
                      title="Generate SOP from this path"
                      className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deletePhase(phase.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                {/* Card rows */}
                {rowNumbers.map(rowIdx => {
                  const rowCards = (rowGroups[rowIdx] || []).sort((a, b) => a.sort_order - b.sort_order)
                  const isDropTarget = dragOverTarget === `${phase.id}-${rowIdx}`

                  return (
                    <div key={rowIdx}
                      className={`flex items-start gap-2 mb-1.5 min-h-[60px] rounded-lg p-1 transition-colors
                        ${isDropTarget ? 'bg-np-blue/10 ring-1 ring-np-blue/30' : ''}`}
                      onDragOver={(e) => handleDragOver(e, phase.id, rowIdx)}
                      onDragLeave={() => setDragOverTarget(null)}
                      onDrop={(e) => handleDrop(e, phase.id, rowIdx)}>

                      {/* Row label */}
                      <div className="w-6 flex-shrink-0 flex items-center justify-center">
                        <span className="text-[9px] text-gray-300 font-mono">{rowIdx}</span>
                      </div>

                      {/* Cards in row */}
                      <div className="flex items-start gap-2 flex-wrap flex-1">
                        {rowCards.map(card => {
                          const status = STATUS_CONFIG[card.status]
                          const fields = card.custom_fields || {}
                          const mirror = isMirror(card.id)

                          return (
                            <div key={card.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, card)}
                              onContextMenu={(e) => handleContextMenu(e, card)}
                              onClick={() => setSelectedCard(card)}
                              className={`group relative bg-white border rounded-xl p-3 w-44 cursor-pointer
                                hover:shadow-md transition-all hover:border-gray-300
                                ${mirror ? 'border-dashed border-purple-300 bg-purple-50/30' : 'border-gray-150'}`}
                              style={{ borderLeftColor: phase.color, borderLeftWidth: 3 }}>

                              {/* Drag handle */}
                              <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 cursor-grab">
                                <GripVertical className="w-3 h-3 text-gray-400" />
                              </div>

                              {/* Mirror badge */}
                              {mirror && (
                                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                                  <Link2 className="w-3 h-3 text-white" />
                                </div>
                              )}

                              {/* Status dot */}
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color }} />
                                <span className="text-[9px] text-gray-400">{status.label}</span>
                                {fields.automation && fields.automation !== 'manual' && (
                                  <Zap className="w-3 h-3 text-amber-400 ml-auto" />
                                )}
                              </div>

                              <p className="text-xs font-medium text-np-dark leading-snug">{card.title}</p>
                              {fields.section_label && (
                                <span className="text-[9px] text-gray-400 mt-0.5 block">{fields.section_label}</span>
                              )}
                            </div>
                          )
                        })}

                        {/* Add card button */}
                        <AddCardInline phaseId={phase.id} rowIndex={rowIdx} onAdd={addCard} />
                      </div>
                    </div>
                  )
                })}

                {/* Add new row */}
                <div className="flex items-center gap-2 mt-1"
                  onDragOver={(e) => handleDragOver(e, phase.id, nextRow)}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleDrop(e, phase.id, nextRow)}>
                  <div className="w-6" />
                  <button onClick={() => {
                    const title = prompt('Card title for new row:')
                    if (title) addCard(phase.id, title, nextRow)
                  }}
                    className={`text-[10px] text-gray-400 hover:text-np-blue px-2 py-1 rounded hover:bg-np-blue/5
                      ${dragOverTarget === `${phase.id}-${nextRow}` ? 'bg-np-blue/10 text-np-blue' : ''}`}>
                    + Add row
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Context menu for card actions */}
      {contextMenu && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => { setSelectedCard(contextMenu.card); setContextMenu(null) }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
            <Pencil className="w-3.5 h-3.5" /> Edit Card
          </button>
          <button onClick={() => { duplicateCard(contextMenu.card); setContextMenu(null) }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
            <Copy className="w-3.5 h-3.5" /> Duplicate Card
          </button>
          {phases.length > 1 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <p className="px-3 py-1 text-[10px] text-gray-400 font-medium">Mirror to path:</p>
              {phases.filter(p => p.id !== contextMenu.card.phase_id).map(p => (
                <button key={p.id}
                  onClick={() => { createMirror(contextMenu.card, p.id); setContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 flex items-center gap-2">
                  <Link2 className="w-3 h-3 text-purple-500" />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
              <div className="border-t border-gray-100 my-1" />
              <p className="px-3 py-1 text-[10px] text-gray-400 font-medium">Copy to path:</p>
              {phases.filter(p => p.id !== contextMenu.card.phase_id).map(p => (
                <button key={p.id}
                  onClick={() => { duplicateCard(contextMenu.card, p.id); setContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                  <Copy className="w-3 h-3" />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
            </>
          )}
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => { deleteCard(contextMenu.card.id); setContextMenu(null) }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2">
            <Trash2 className="w-3.5 h-3.5" /> Delete Card
          </button>
        </div>
      )}

      {/* AI Modal */}
      {aiOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => !aiLoading && setAiOpen(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-np-dark">AI Journey + SOP Generator</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Describe your business or program. AI will create the visual journey map AND written SOPs for each phase.
            </p>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
              placeholder="e.g. 5-week VR biofeedback mastermind: marketing, enrollment, onboarding, weekly sessions, graduation with alumni community"
              className="w-full h-28 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
            <div className="flex flex-wrap gap-1.5 mt-2 mb-4">
              {QUICK_PROMPTS.map((p, i) => (
                <button key={i} onClick={() => setAiPrompt(p)}
                  className="text-[10px] px-2 py-1 bg-gray-100 rounded-full hover:bg-purple-50 hover:text-purple-600 truncate max-w-[200px]">
                  {p.slice(0, 50)}...
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAiOpen(false)} disabled={aiLoading}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">Cancel</button>
              <button onClick={() => runAI(aiPrompt)} disabled={aiLoading || !aiPrompt.trim()}
                className="flex-1 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Generate Journey + SOPs'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card detail panel */}
      {selectedCard && (
        <CardDetailPanel
          card={selectedCard}
          phases={phases}
          orgId={currentOrg?.id}
          onClose={() => setSelectedCard(null)}
          onUpdate={async (id, updates) => {
            const result = await updateCard(id, updates)
            if (result) setSelectedCard(result)
            return { data: result, error: null }
          }}
          onDelete={async (id) => {
            await deleteCard(id)
            return { error: null }
          }}
          onDuplicate={async (card, targetPhaseId, targetRow) => {
            const newCard = await duplicateCard(card, targetPhaseId)
            return newCard
          }}
        />
      )}
    </div>
  )
}

// ──────── Inline add card component ────────
function AddCardInline({ phaseId, rowIndex, onAdd }: {
  phaseId: string; rowIndex: number; onAdd: (phaseId: string, title: string, row: number) => Promise<any>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')

  const handleAdd = async () => {
    if (!title.trim()) return
    await onAdd(phaseId, title.trim(), rowIndex)
    setTitle('')
    setOpen(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-10 h-[60px] border border-dashed border-gray-200 rounded-xl flex items-center justify-center
        text-gray-300 hover:text-np-blue hover:border-np-blue/30 hover:bg-np-blue/5 transition-all flex-shrink-0">
      <Plus className="w-4 h-4" />
    </button>
  )

  return (
    <div className="w-44 flex-shrink-0">
      <input value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' ? handleAdd() : e.key === 'Escape' && setOpen(false)}
        placeholder="Card title..."
        className="w-full px-2 py-1.5 border border-np-blue/30 rounded-lg text-xs bg-np-blue/5" autoFocus />
      <div className="flex gap-1 mt-1">
        <button onClick={handleAdd} className="text-[10px] text-np-blue font-medium">Add</button>
        <button onClick={() => { setOpen(false); setTitle('') }} className="text-[10px] text-gray-400">Cancel</button>
      </div>
    </div>
  )
}
