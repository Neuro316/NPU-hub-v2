'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, ProgressBar, BadgePill, Avatar, PriorityBadge } from '@/components/shared/meeting-rock-ui'
import { ROCK_STATUS_CONFIG, DEFAULT_ROCK_COLORS } from '@/lib/types/rocks'
import type { Rock, RockStatus, RockWithProgress } from '@/lib/types/rocks'
import { createClient } from '@/lib/supabase-browser'
import type { KanbanTask } from '@/lib/types/tasks'
import {
  Plus, ChevronRight, ArrowRight, Target, X, Loader2,
  Upload, FileSpreadsheet, Map, List, Link2, GripVertical, Trash2
} from 'lucide-react'

/* ═══════════════════════════════════════════════
   JOURNEY CARD COLORS
   Orange (0%) → Yellow (1-99%) → Blue (100%)
   ═══════════════════════════════════════════════ */
function getJourneyColor(pct: number, status: RockStatus) {
  if (status === 'complete' || pct >= 100) return { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8', label: 'Complete' }
  if (pct > 0) return { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', label: 'In Progress' }
  return { bg: '#FFEDD5', border: '#F97316', text: '#C2410C', label: 'Not Started' }
}

/* ═══════════════════════════════════════════════
   DEPENDENCY TYPE
   ═══════════════════════════════════════════════ */
interface RockDep {
  id: string
  source_rock_id: string
  target_rock_id: string
  relationship: string
  notes: string | null
}

/* ═══════════════════════════════════════════════
   DRAGGABLE JOURNEY MAP
   Free-form 2D canvas with drag-to-move and
   drag-between-rocks to create/reassign deps
   ═══════════════════════════════════════════════ */
function DraggableJourney({ rocks, dependencies, onClickRock, onUpdateDep, onDeleteDep, onCreateDep }: {
  rocks: RockWithProgress[]
  dependencies: RockDep[]
  onClickRock: (id: string) => void
  onUpdateDep: (depId: string, updates: Partial<RockDep>) => void
  onDeleteDep: (depId: string) => void
  onCreateDep: (sourceId: string, targetId: string, relationship: string) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)

  // Position state — each rock gets an {x, y} position
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [linking, setLinking] = useState<string | null>(null)
  const [linkTarget, setLinkTarget] = useState<string | null>(null)
  const [linkRelationship, setLinkRelationship] = useState<string>('depends_on')
  const svgRef = useRef<SVGSVGElement>(null)

  // Auto-layout rocks in a grid if no saved positions
  useEffect(() => {
    if (rocks.length === 0) return
    const existing = { ...positions }
    let needsLayout = false

    // Build adjacency for topological sort
    const adj: Record<string, string[]> = {}
    const incoming: Record<string, number> = {}
    rocks.forEach(r => { adj[r.id] = []; incoming[r.id] = 0 })
    dependencies.forEach(d => {
      if (d.relationship === 'depends_on' && adj[d.target_rock_id]) {
        adj[d.target_rock_id].push(d.source_rock_id)
        incoming[d.source_rock_id] = (incoming[d.source_rock_id] || 0) + 1
      } else if (d.relationship === 'blocks' && adj[d.source_rock_id]) {
        adj[d.source_rock_id].push(d.target_rock_id)
        incoming[d.target_rock_id] = (incoming[d.target_rock_id] || 0) + 1
      }
    })

    // Topological sort into layers
    const layers: string[][] = []
    const inDeg = { ...incoming }
    let queue = Object.keys(inDeg).filter(k => (inDeg[k] || 0) === 0)
    while (queue.length > 0) {
      layers.push([...queue])
      const next: string[] = []
      for (const node of queue) {
        for (const neighbor of (adj[node] || [])) {
          inDeg[neighbor]--
          if (inDeg[neighbor] === 0) next.push(neighbor)
        }
      }
      queue = next
    }
    const placed = new Set(layers.flat())
    const orphans = rocks.filter(r => !placed.has(r.id)).map(r => r.id)
    if (orphans.length > 0) layers.push(orphans)

    // Assign positions by layer
    layers.forEach((layer, li) => {
      layer.forEach((rockId, ri) => {
        if (!existing[rockId]) {
          existing[rockId] = { x: 40 + li * 240, y: 40 + ri * 140 }
          needsLayout = true
        }
      })
    })

    if (needsLayout) setPositions(existing)
  }, [rocks.length, dependencies.length])

  // Mouse move handler for dragging
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left - dragOffset.x, rect.width - 200))
    const y = Math.max(0, Math.min(e.clientY - rect.top - dragOffset.y, rect.height - 120))
    setPositions(prev => ({ ...prev, [dragging]: { x, y } }))
  }, [dragging, dragOffset])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const startDrag = (rockId: string, e: React.MouseEvent) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const pos = positions[rockId] || { x: 0, y: 0 }
    setDragOffset({ x: e.clientX - rect.left - pos.x, y: e.clientY - rect.top - pos.y })
    setDragging(rockId)
  }

  const startLink = (rockId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setLinking(rockId)
  }

  const finishLink = (targetId: string) => {
    if (linking && linking !== targetId) {
      onCreateDep(linking, targetId, linkRelationship)
    }
    setLinking(null); setLinkTarget(null)
  }

  const rockMap = useMemo(() => {
    const m: Record<string, RockWithProgress> = {}
    rocks.forEach(r => { m[r.id] = r })
    return m
  }, [rocks])

  // Compute arrow paths
  const arrows = useMemo(() => {
    return dependencies.map(dep => {
      const from = positions[dep.source_rock_id]
      const to = positions[dep.target_rock_id]
      if (!from || !to) return null
      const fx = from.x + 100 // center of card (200w)
      const fy = from.y + 55 // center of card (~110h)
      const tx = to.x + 100
      const ty = to.y + 55
      return { ...dep, fx, fy, tx, ty }
    }).filter(Boolean) as Array<RockDep & { fx: number; fy: number; tx: number; ty: number }>
  }, [dependencies, positions])

  const relColors: Record<string, string> = {
    depends_on: '#F59E0B',
    blocks: '#EF4444',
    supports: '#3B82F6',
  }

  if (rocks.length === 0) {
    return (
      <div className="text-center py-12">
        <Link2 size={28} className="mx-auto text-gray-200 mb-2" />
        <p className="text-xs text-gray-400">No rocks to display. Create rocks first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-gray-400 font-semibold uppercase tracking-wider">Drag rocks to reposition</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-400">Click <span className="bg-violet-100 text-violet-600 px-1 rounded font-bold">⊕</span> to link dependencies</span>
        <span className="text-gray-300">|</span>
        {linking && (
          <span className="text-violet-600 font-semibold animate-pulse">
            🔗 Now click a target rock to create link...
            <button onClick={() => setLinking(null)} className="ml-1 text-gray-400 hover:text-red-400">Cancel</button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-gray-400">Link type:</span>
          <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}
            className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded">
            <option value="depends_on">Depends On</option>
            <option value="blocks">Blocks</option>
            <option value="supports">Supports</option>
          </select>
        </div>
      </div>

      {/* Canvas */}
      <div ref={canvasRef}
        className="relative bg-gray-50 border border-gray-200 rounded-xl overflow-hidden cursor-default"
        style={{ height: Math.max(500, (rocks.length * 140) + 100) }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}>

        {/* SVG arrows layer */}
        <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          <defs>
            <marker id="arrowhead-amber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#F59E0B" />
            </marker>
            <marker id="arrowhead-red" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#EF4444" />
            </marker>
            <marker id="arrowhead-blue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#3B82F6" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const color = relColors[a.relationship] || '#9CA3AF'
            const markerId = a.relationship === 'blocks' ? 'arrowhead-red' : a.relationship === 'supports' ? 'arrowhead-blue' : 'arrowhead-amber'
            // Curved path
            const dx = a.tx - a.fx
            const dy = a.ty - a.fy
            const cx1 = a.fx + dx * 0.4
            const cy1 = a.fy
            const cx2 = a.fx + dx * 0.6
            const cy2 = a.ty
            return (
              <g key={a.id || i}>
                <path
                  d={`M ${a.fx} ${a.fy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${a.tx} ${a.ty}`}
                  stroke={color} strokeWidth="2" fill="none" strokeDasharray={a.relationship === 'supports' ? '6,4' : 'none'}
                  markerEnd={`url(#${markerId})`} opacity={0.7}
                />
                {/* Relationship label at midpoint */}
                <text x={(a.fx + a.tx) / 2} y={(a.fy + a.ty) / 2 - 6}
                  fill={color} fontSize="9" fontWeight="bold" textAnchor="middle" opacity={0.8}>
                  {a.relationship.replace('_', ' ')}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Rock cards */}
        {rocks.map(r => {
          const pos = positions[r.id] || { x: 0, y: 0 }
          const jc = getJourneyColor(r.progress_pct, r.status as RockStatus)
          const isDragging = dragging === r.id
          const isLinkSource = linking === r.id

          return (
            <div key={r.id}
              className={`absolute w-[200px] rounded-xl border-2 select-none transition-shadow ${
                isDragging ? 'shadow-xl z-30 scale-105' : isLinkSource ? 'shadow-lg z-20 ring-2 ring-violet-400' : linking ? 'cursor-pointer hover:ring-2 hover:ring-violet-300' : 'shadow-sm z-10 hover:shadow-md'
              }`}
              style={{
                left: pos.x, top: pos.y,
                background: jc.bg, borderColor: jc.border,
                cursor: isDragging ? 'grabbing' : linking ? 'crosshair' : 'grab',
              }}
              onMouseDown={e => { if (!linking) startDrag(r.id, e) }}
              onClick={() => { if (linking) finishLink(r.id) }}>

              {/* Card header with grip + link button */}
              <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
                {!linking && (
                  <GripVertical size={12} className="text-gray-400 opacity-50 shrink-0 cursor-grab" />
                )}
                <StatusDot status={r.status} />
                <span className="text-[11px] font-bold truncate flex-1" style={{ color: jc.text }}>{r.title}</span>
                {/* Link button */}
                <button onClick={e => startLink(r.id, e)} title="Create dependency link"
                  className="w-5 h-5 rounded flex items-center justify-center text-violet-400 hover:bg-violet-100 hover:text-violet-600 transition-colors text-[11px] font-bold shrink-0">
                  ⊕
                </button>
              </div>

              {/* Progress */}
              <div className="px-3 pb-1">
                <ProgressBar pct={r.progress_pct} height={5} />
              </div>

              {/* Meta */}
              <div className="flex items-center justify-between px-3 pb-2.5">
                <span className="text-[9px] font-semibold" style={{ color: jc.text }}>{r.progress_pct}%</span>
                <span className="text-[9px]" style={{ color: jc.text }}>{r.tasks_done}/{r.task_count} tasks</span>
              </div>

              {/* Owner + open button */}
              <div className="flex items-center justify-between px-3 pb-2.5">
                {r.owner_name && r.owner_name !== 'Unassigned' && (
                  <div className="flex items-center gap-1">
                    <Avatar initials={r.owner_initials || '??'} size={14} color={r.color} />
                    <span className="text-[9px]" style={{ color: jc.text }}>{r.owner_name?.split(' ')[0]}</span>
                  </div>
                )}
                <button onClick={e => { e.stopPropagation(); onClickRock(r.id) }}
                  className="text-[9px] font-semibold hover:underline" style={{ color: jc.text }}>
                  Open →
                </button>
              </div>
            </div>
          )
        })}

        {/* Dependency delete zone — shown when any dep arrow is right-clicked */}
      </div>

      {/* Legend + dependency list */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {[
            { label: 'Not Started', bg: '#FFEDD5', border: '#F97316' },
            { label: 'In Progress', bg: '#FEF3C7', border: '#F59E0B' },
            { label: 'Complete', bg: '#DBEAFE', border: '#3B82F6' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className="w-4 h-3 rounded border-2" style={{ background: item.bg, borderColor: item.border }} />
              <span className="text-[10px] text-gray-500">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {[
            { label: 'Depends On', color: '#F59E0B', dash: false },
            { label: 'Blocks', color: '#EF4444', dash: false },
            { label: 'Supports', color: '#3B82F6', dash: true },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className="w-5 h-0 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />
              <span className="text-[10px] text-gray-500">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Dependency list for editing/deleting */}
      {dependencies.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-lg p-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Dependencies ({dependencies.length})
          </span>
          <div className="mt-1.5 space-y-1">
            {dependencies.map(dep => {
              const src = rockMap[dep.source_rock_id]
              const tgt = rockMap[dep.target_rock_id]
              if (!src || !tgt) return null
              return (
                <div key={dep.id} className="flex items-center gap-2 text-[11px] py-1.5 px-2 bg-gray-50 rounded-lg group">
                  <span className="font-medium text-np-dark truncate" style={{ maxWidth: 140 }}>{src.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                    dep.relationship === 'blocks' ? 'bg-red-100 text-red-600' :
                    dep.relationship === 'depends_on' ? 'bg-amber-100 text-amber-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>{dep.relationship.replace('_', ' ')}</span>
                  <ArrowRight size={10} className="text-gray-300 shrink-0" />
                  <span className="font-medium text-np-dark truncate flex-1" style={{ maxWidth: 140 }}>{tgt.title}</span>
                  <button onClick={() => onDeleteDep(dep.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   IMPORT MODAL
   ═══════════════════════════════════════════════ */
function ImportModal({ onImport, members, onClose }: {
  onImport: (rows: Array<{ title: string; description: string; owner_id: string; quarter: string }>) => void
  members: Array<{ user_id: string | null; display_name: string }>
  onClose: () => void
}) {
  const [mode, setMode] = useState<'paste' | 'manual'>('paste')
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<Array<{ title: string; description: string; owner_id: string; quarter: string }>>([])
  const [manualRows, setManualRows] = useState<Array<{ title: string; description: string; owner_id: string; quarter: string }>>([
    { title: '', description: '', owner_id: '', quarter: 'Q1 2026' }
  ])
  const fileRef = useRef<HTMLInputElement>(null)

  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length === 0) return
    const delim = lines[0].includes('\t') ? '\t' : ','
    const firstRow = lines[0].toLowerCase()
    const hasHeader = firstRow.includes('title') || firstRow.includes('rock') || firstRow.includes('name')
    const dataLines = hasHeader ? lines.slice(1) : lines
    const rows = dataLines.map(line => {
      const cols = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
      return { title: cols[0] || '', description: cols[1] || '', owner_id: '', quarter: cols[2] || 'Q1 2026' }
    }).filter(r => r.title)
    setParsedRows(rows)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => { const text = evt.target?.result as string; setCsvText(text); parseCSV(text) }
    reader.readAsText(file)
  }

  const addManualRow = () => setManualRows(prev => [...prev, { title: '', description: '', owner_id: '', quarter: 'Q1 2026' }])
  const updateManualRow = (i: number, key: string, val: string) => setManualRows(prev => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r))
  const removeManualRow = (i: number) => setManualRows(prev => prev.filter((_, idx) => idx !== i))

  const importRows = mode === 'paste' ? parsedRows : manualRows.filter(r => r.title.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[80vh] bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-np-dark">Import Rocks</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>
        <div className="flex border-b border-gray-100 px-5">
          <button onClick={() => setMode('paste')}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              mode === 'paste' ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent'
            }`}><FileSpreadsheet size={11} className="inline mr-1" /> CSV / Google Sheet</button>
          <button onClick={() => setMode('manual')}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              mode === 'manual' ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent'
            }`}><Plus size={11} className="inline mr-1" /> Manual Bulk Add</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {mode === 'paste' && (
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Upload CSV or paste from Google Sheets</label>
                <p className="text-[10px] text-gray-400 mt-0.5 mb-2">Columns: Title, Description (opt), Quarter (opt)</p>
                <div className="flex gap-2 mb-2">
                  <input type="file" ref={fileRef} accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-np-blue bg-blue-50 rounded-lg border border-blue-200">
                    <Upload size={11} /> Upload File
                  </button>
                </div>
                <textarea value={csvText} onChange={e => { setCsvText(e.target.value); parseCSV(e.target.value) }}
                  placeholder={'Title, Description, Quarter\nCharlotte Location Launch, Open new clinic, Q1 2026'}
                  rows={5} className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>
              {parsedRows.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Preview ({parsedRows.length} rocks)</span>
                  <div className="mt-1 space-y-1">
                    {parsedRows.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <span className="text-[10px] font-bold text-gray-300 w-4">{i + 1}</span>
                        <span className="text-xs font-medium text-np-dark flex-1 truncate">{r.title}</span>
                        <select value={r.owner_id}
                          onChange={e => setParsedRows(prev => prev.map((row, idx) => idx === i ? { ...row, owner_id: e.target.value } : row))}
                          className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md">
                          <option value="">Owner</option>
                          {members.filter(m => m.user_id).map(m => (
                            <option key={m.user_id} value={m.user_id!}>{m.display_name?.split(' ')[0]}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {mode === 'manual' && (
            <div className="space-y-2">
              {manualRows.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg">
                  <span className="text-[10px] font-bold text-gray-300 w-4 mt-2">{i + 1}</span>
                  <div className="flex-1 space-y-1">
                    <input value={r.title} onChange={e => updateManualRow(i, 'title', e.target.value)}
                      placeholder="Rock title..." className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    <input value={r.description} onChange={e => updateManualRow(i, 'description', e.target.value)}
                      placeholder="Description (optional)" className="w-full px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white focus:outline-none" />
                  </div>
                  <select value={r.owner_id} onChange={e => updateManualRow(i, 'owner_id', e.target.value)}
                    className="text-[10px] px-1.5 py-1.5 border border-gray-200 rounded-md mt-1">
                    <option value="">Owner</option>
                    {members.filter(m => m.user_id).map(m => (
                      <option key={m.user_id} value={m.user_id!}>{m.display_name?.split(' ')[0]}</option>
                    ))}
                  </select>
                  <select value={r.quarter} onChange={e => updateManualRow(i, 'quarter', e.target.value)}
                    className="text-[10px] px-1.5 py-1.5 border border-gray-200 rounded-md mt-1">
                    {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'].map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                  <button onClick={() => removeManualRow(i)} className="text-gray-300 hover:text-red-400 mt-2"><X size={12} /></button>
                </div>
              ))}
              <button onClick={addManualRow}
                className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-blue-200">+ Add Row</button>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">{importRows.length} rock{importRows.length !== 1 ? 's' : ''} ready</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
            <button onClick={() => { onImport(importRows); onClose() }} disabled={importRows.length === 0}
              className="px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg disabled:opacity-50">
              Import {importRows.length} Rock{importRows.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */
export default function RocksPage() {
  const { currentOrg } = useWorkspace()
  const { rocks, loading, addRock, fetchData } = useRockData()
  const { members } = useTeamData()
  const router = useRouter()
  const supabase = createClient()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<KanbanTask[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<'list' | 'journey'>('list')
  const [dependencies, setDependencies] = useState<RockDep[]>([])
  const [form, setForm] = useState({ title: '', description: '', owner_id: '', quarter: 'Q1 2026', due_date: '', color: DEFAULT_ROCK_COLORS[0] })
  const [doneColumnIds, setDoneColumnIds] = useState<Set<string>>(new Set())

  const loadDeps = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase.from('rock_dependencies').select('*').eq('org_id', currentOrg.id)
    if (data) setDependencies(data)
  }, [currentOrg?.id])

  useEffect(() => {
    if (!currentOrg) return
    supabase.from('kanban_columns').select('id, title').eq('org_id', currentOrg.id).then(({ data }) => {
      if (data) setDoneColumnIds(new Set(
        data.filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')).map(c => c.id)
      ))
    })
    loadDeps()
  }, [currentOrg?.id, loadDeps])

  const handleCreateDep = async (sourceId: string, targetId: string, relationship: string) => {
    if (!currentOrg) return
    const { error } = await supabase.from('rock_dependencies').upsert({
      org_id: currentOrg.id, source_rock_id: sourceId, target_rock_id: targetId, relationship,
    }, { onConflict: 'source_rock_id,target_rock_id' })
    if (!error) loadDeps()
  }

  const handleDeleteDep = async (depId: string) => {
    await supabase.from('rock_dependencies').delete().eq('id', depId)
    loadDeps()
  }

  const handleUpdateDep = async (depId: string, updates: Partial<RockDep>) => {
    await supabase.from('rock_dependencies').update(updates).eq('id', depId)
    loadDeps()
  }

  const toggleExpand = async (rockId: string) => {
    if (expandedId === rockId) { setExpandedId(null); setExpandedTasks([]); return }
    setExpandedId(rockId)
    const { data } = await supabase.from('kanban_tasks').select('*').eq('rock_id', rockId).order('sort_order')
    setExpandedTasks(data || [])
  }

  const handleCreate = async () => {
    if (!form.title.trim()) return
    setCreating(true)
    await addRock({ title: form.title.trim(), description: form.description || null, owner_id: form.owner_id || null,
      quarter: form.quarter || null, due_date: form.due_date || null, color: form.color, status: 'on_track' })
    setShowCreate(false)
    setForm({ title: '', description: '', owner_id: '', quarter: 'Q1 2026', due_date: '', color: DEFAULT_ROCK_COLORS[0] })
    setCreating(false)
  }

  const handleBulkImport = async (rows: Array<{ title: string; description: string; owner_id: string; quarter: string }>) => {
    for (const row of rows) {
      await addRock({ title: row.title, description: row.description || null, owner_id: row.owner_id || null,
        quarter: row.quarter || 'Q1 2026', color: DEFAULT_ROCK_COLORS[Math.floor(Math.random() * DEFAULT_ROCK_COLORS.length)], status: 'on_track' })
    }
    fetchData()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Quarterly Rocks</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {rocks[0]?.quarter || 'Q1 2026'} · {rocks.length} rock{rocks.length !== 1 ? 's' : ''} · {currentOrg?.name}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('list')}
              className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                view === 'list' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400'
              }`}><List size={11} className="inline mr-0.5" /> List</button>
            <button onClick={() => setView('journey')}
              className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                view === 'journey' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400'
              }`}><Map size={11} className="inline mr-0.5" /> Journey
              {dependencies.length > 0 && <span className="ml-0.5 px-1 py-0 text-[8px] bg-teal text-white rounded-full">{dependencies.length}</span>}
            </button>
          </div>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200">
            <Upload size={10} /> Import
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors">
            <Plus size={13} /> New Rock
          </button>
        </div>
      </div>

      {/* Journey View */}
      {view === 'journey' && (
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Map size={14} className="text-teal" />
            <span className="text-sm font-bold text-np-dark">Rock Dependency Journey</span>
          </div>
          <DraggableJourney
            rocks={rocks} dependencies={dependencies}
            onClickRock={id => router.push(`/rocks/${id}`)}
            onUpdateDep={handleUpdateDep} onDeleteDep={handleDeleteDep} onCreateDep={handleCreateDep}
          />
        </div>
      )}

      {/* List View */}
      {view === 'list' && rocks.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {rocks.map(r => {
            const isExpanded = expandedId === r.id
            const jc = getJourneyColor(r.progress_pct, r.status as RockStatus)
            return (
              <div key={r.id}>
                <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/70 cursor-pointer transition-colors ${isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}>
                  <button onClick={() => toggleExpand(r.id)} className="p-0 bg-transparent border-none cursor-pointer">
                    <ChevronRight size={13} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: jc.bg, borderColor: jc.border }} />
                  <StatusDot status={r.status} />
                  <span onClick={() => router.push(`/rocks/${r.id}`)}
                    className="text-xs font-semibold text-np-dark truncate cursor-pointer hover:text-np-blue transition-colors"
                    style={{ flex: '0 0 180px' }}>{r.title}</span>
                  <Avatar initials={r.owner_initials || '??'} size={22} color={r.color} />
                  <div className="flex-1 flex items-center gap-2">
                    <ProgressBar pct={r.progress_pct} />
                    <span className="text-[11px] font-bold text-np-dark w-8 text-right">{r.progress_pct}%</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{r.tasks_done}/{r.task_count}</span>
                  <span className="text-[10px] text-gray-400">
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
                  </span>
                </div>
                {isExpanded && (
                  <div className="bg-gray-50 px-4 py-2 pl-12 border-b border-gray-100">
                    {expandedTasks.length === 0 && <p className="text-[11px] text-gray-400 py-2">No tasks linked. Open rock to add tasks with RACI.</p>}
                    {expandedTasks.slice(0, 4).map(t => {
                      const st = doneColumnIds.has(t.column_id) ? 'done' : 'active'
                      return (
                        <div key={t.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <span className="font-semibold" style={{ color: st === 'done' ? '#16A34A' : '#2A9D8F' }}>{st === 'done' ? '✓' : '◐'}</span>
                          <button onClick={() => router.push(`/tasks?task=${t.id}`)}
                            className={`flex-1 text-left hover:text-np-blue hover:underline ${st === 'done' ? 'text-gray-400 line-through' : 'text-np-dark'}`}>{t.title}</button>
                          {t.custom_fields && Object.keys(t.custom_fields).some(k => k.startsWith('raci_') && t.custom_fields[k]) && (
                            <div className="flex gap-0.5">
                              {[{ key: 'raci_responsible', label: 'R', color: '#2563EB' }, { key: 'raci_accountable', label: 'A', color: '#DC2626' },
                                { key: 'raci_consulted', label: 'C', color: '#D97706' }, { key: 'raci_informed', label: 'I', color: '#6B7280' }]
                                .filter(r => t.custom_fields?.[r.key]).map(r => (
                                  <span key={r.key} className="text-[7px] font-bold w-3 h-3 rounded flex items-center justify-center text-white"
                                    style={{ background: r.color }}>{r.label}</span>
                                ))}
                            </div>
                          )}
                          <PriorityBadge priority={t.priority} />
                        </div>
                      )
                    })}
                    {expandedTasks.length > 4 && (
                      <button onClick={() => router.push(`/rocks/${r.id}`)}
                        className="text-[10px] text-np-blue font-semibold flex items-center gap-1 mt-1">
                        View all {expandedTasks.length} tasks <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {view === 'list' && rocks.length === 0 && (
        <div className="text-center py-16">
          <Target size={40} className="mx-auto text-gray-200 mb-3" />
          <h2 className="text-sm font-semibold text-np-dark">No rocks yet</h2>
          <p className="text-xs text-gray-400 mt-1 mb-4">Create your first quarterly rock or import from a spreadsheet.</p>
          <div className="flex justify-center gap-2">
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-np-blue bg-blue-50 rounded-lg border border-blue-200">
              <Upload size={11} /> Import from CSV
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-np-blue rounded-lg">
              <Plus size={11} /> Create Rock
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">New Rock</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Rock Title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Charlotte Location Launch"
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What does success look like?" rows={2}
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none resize-none" />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Owner</label>
                <select value={form.owner_id} onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg">
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.user_id || m.id} value={m.user_id || ''}>{m.display_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => {
                    const d = e.target.value
                    const dt = new Date(d + 'T00:00:00')
                    const m = dt.getMonth()
                    const y = dt.getFullYear()
                    const q = m < 3 ? 1 : m < 6 ? 2 : m < 9 ? 3 : 4
                    setForm(p => ({ ...p, due_date: d, quarter: `Q${q} ${y}` }))
                  }}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Quarter <span className="text-gray-300 normal-case">(auto from date)</span></label>
                  <select value={form.quarter} onChange={e => setForm(p => ({ ...p, quarter: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg">
                    {(() => {
                      const baseYear = form.due_date ? new Date(form.due_date + 'T00:00:00').getFullYear() : new Date().getFullYear()
                      const opts: string[] = []
                      for (let y = baseYear; y <= baseYear + 1; y++) {
                        for (let q = 1; q <= 4; q++) opts.push(`Q${q} ${y}`)
                      }
                      return opts.map(q => <option key={q} value={q}>{q}</option>)
                    })()}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Color</label>
                <div className="flex gap-1.5 mt-1.5">
                  {DEFAULT_ROCK_COLORS.slice(0, 5).map(c => (
                    <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                      className="w-6 h-6 rounded-full transition-transform"
                      style={{ background: c, border: form.color === c ? '2px solid #3E3E3E' : '2px solid transparent',
                        transform: form.color === c ? 'scale(1.15)' : 'scale(1)' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title.trim() || creating}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Target size={12} />} Create Rock
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && <ImportModal onImport={handleBulkImport} members={members} onClose={() => setShowImport(false)} />}
    </div>
  )
}
