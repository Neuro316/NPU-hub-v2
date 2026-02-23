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
  Upload, FileSpreadsheet, Map, List, Sparkles, Link2
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
   DEPENDENCY JOURNEY MAP
   Visual flow of rocks with dependency arrows
   ═══════════════════════════════════════════════ */
interface RockDep {
  id: string
  source_rock_id: string
  target_rock_id: string
  relationship: string
  notes: string | null
}

function DependencyJourney({ rocks, dependencies, onClickRock }: {
  rocks: RockWithProgress[]; dependencies: RockDep[]
  onClickRock: (id: string) => void
}) {
  // Build adjacency for topological sort
  const adjacency = useMemo(() => {
    const adj: Record<string, string[]> = {}
    const incoming: Record<string, number> = {}
    rocks.forEach(r => { adj[r.id] = []; incoming[r.id] = 0 })

    dependencies.forEach(d => {
      if (d.relationship === 'depends_on') {
        // source depends_on target → target must come first → target→source edge
        if (adj[d.target_rock_id]) {
          adj[d.target_rock_id].push(d.source_rock_id)
          incoming[d.source_rock_id] = (incoming[d.source_rock_id] || 0) + 1
        }
      } else if (d.relationship === 'blocks') {
        // source blocks target → source must come first → source→target edge
        if (adj[d.source_rock_id]) {
          adj[d.source_rock_id].push(d.target_rock_id)
          incoming[d.target_rock_id] = (incoming[d.target_rock_id] || 0) + 1
        }
      }
      // 'supports' doesn't imply ordering, skip
    })

    return { adj, incoming }
  }, [rocks, dependencies])

  // Topological sort into layers
  const layers = useMemo(() => {
    const { adj, incoming } = adjacency
    const inDeg = { ...incoming }
    const result: string[][] = []
    let queue = Object.keys(inDeg).filter(k => (inDeg[k] || 0) === 0)

    while (queue.length > 0) {
      result.push([...queue])
      const next: string[] = []
      for (const node of queue) {
        for (const neighbor of (adj[node] || [])) {
          inDeg[neighbor]--
          if (inDeg[neighbor] === 0) next.push(neighbor)
        }
      }
      queue = next
    }

    // Add any rocks not in deps as a final layer
    const placed = new Set(result.flat())
    const orphans = rocks.filter(r => !placed.has(r.id)).map(r => r.id)
    if (orphans.length > 0) result.push(orphans)

    return result
  }, [adjacency, rocks])

  const rockMap = useMemo(() => {
    const m: Record<string, RockWithProgress> = {}
    rocks.forEach(r => { m[r.id] = r })
    return m
  }, [rocks])

  // Relationship labels between layers
  const getRelLabel = (sourceId: string, targetId: string) => {
    const dep = dependencies.find(d =>
      (d.source_rock_id === sourceId && d.target_rock_id === targetId) ||
      (d.source_rock_id === targetId && d.target_rock_id === sourceId)
    )
    if (!dep) return null
    return dep.relationship.replace('_', ' ')
  }

  if (dependencies.length === 0) {
    return (
      <div className="text-center py-8">
        <Link2 size={28} className="mx-auto text-gray-200 mb-2" />
        <p className="text-xs text-gray-400">No dependencies defined yet.</p>
        <p className="text-[11px] text-gray-400 mt-1">Use AI Advisor on a rock detail page to auto-detect dependencies.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-start gap-3 min-w-max">
        {layers.map((layer, li) => (
          <div key={li} className="flex flex-col gap-2 items-center">
            {/* Layer label */}
            <div className="text-[9px] font-bold text-gray-300 uppercase tracking-wider mb-1">
              {li === 0 ? 'Foundation' : li === layers.length - 1 && layers.length > 1 ? 'Outcome' : `Phase ${li + 1}`}
            </div>
            {layer.map(rockId => {
              const r = rockMap[rockId]
              if (!r) return null
              const jc = getJourneyColor(r.progress_pct, r.status as RockStatus)
              return (
                <button key={r.id} onClick={() => onClickRock(r.id)}
                  className="w-48 rounded-xl p-3 border-2 text-left transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer"
                  style={{ background: jc.bg, borderColor: jc.border }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <StatusDot status={r.status} />
                    <span className="text-[10px] font-bold truncate" style={{ color: jc.text }}>{r.title}</span>
                  </div>
                  <ProgressBar pct={r.progress_pct} height={6} />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] font-semibold" style={{ color: jc.text }}>{r.progress_pct}%</span>
                    <span className="text-[9px]" style={{ color: jc.text }}>{r.tasks_done}/{r.task_count} tasks</span>
                  </div>
                  {r.owner_name && r.owner_name !== 'Unassigned' && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Avatar initials={r.owner_initials || '??'} size={14} color={r.color} />
                      <span className="text-[9px]" style={{ color: jc.text }}>{r.owner_name?.split(' ')[0]}</span>
                    </div>
                  )}
                </button>
              )
            })}
            {/* Arrow to next layer */}
            {li < layers.length - 1 && (
              <div className="flex items-center text-gray-300 my-1">
                <ArrowRight size={16} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
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
    </div>
  )
}

/* ═══════════════════════════════════════════════
   CSV IMPORT MODAL
   Parses CSV/TSV for rock titles
   ═══════════════════════════════════════════════ */
function ImportModal({ onImport, members, onClose }: {
  onImport: (rocks: Array<{ title: string; description: string; owner_id: string; quarter: string }>) => void
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

    // Detect delimiter
    const delim = lines[0].includes('\t') ? '\t' : ','

    // Check if first row is header
    const firstRow = lines[0].toLowerCase()
    const hasHeader = firstRow.includes('title') || firstRow.includes('rock') || firstRow.includes('name')
    const dataLines = hasHeader ? lines.slice(1) : lines

    const rows = dataLines.map(line => {
      const cols = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
      return {
        title: cols[0] || '',
        description: cols[1] || '',
        owner_id: '', // Will be assigned in UI
        quarter: cols[2] || 'Q1 2026',
      }
    }).filter(r => r.title)

    setParsedRows(rows)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      setCsvText(text)
      parseCSV(text)
    }
    reader.readAsText(file)
  }

  const addManualRow = () => {
    setManualRows(prev => [...prev, { title: '', description: '', owner_id: '', quarter: 'Q1 2026' }])
  }

  const updateManualRow = (i: number, key: string, val: string) => {
    setManualRows(prev => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r))
  }

  const removeManualRow = (i: number) => {
    setManualRows(prev => prev.filter((_, idx) => idx !== i))
  }

  const importRows = mode === 'paste' ? parsedRows : manualRows.filter(r => r.title.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}>
      <div className="w-full max-w-xl max-h-[80vh] bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-np-dark">Import Rocks</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-100 px-5">
          <button onClick={() => setMode('paste')}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              mode === 'paste' ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent'
            }`}>
            <FileSpreadsheet size={11} className="inline mr-1" /> CSV / Google Sheet
          </button>
          <button onClick={() => setMode('manual')}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              mode === 'manual' ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent'
            }`}>
            <Plus size={11} className="inline mr-1" /> Manual Bulk Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {mode === 'paste' && (
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                  Upload CSV or paste from Google Sheets
                </label>
                <p className="text-[10px] text-gray-400 mt-0.5 mb-2">
                  Expected columns: Title, Description (optional), Quarter (optional)
                </p>
                <div className="flex gap-2 mb-2">
                  <input type="file" ref={fileRef} accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-np-blue bg-np-blue/5 rounded-lg border border-np-blue/20">
                    <Upload size={11} /> Upload File
                  </button>
                </div>
                <textarea value={csvText}
                  onChange={e => { setCsvText(e.target.value); parseCSV(e.target.value) }}
                  placeholder={'Title, Description, Quarter\nCharlotte Location Launch, Open new clinic in Charlotte, Q1 2026\nHire 3 Practitioners, Recruit and onboard, Q1 2026'}
                  rows={5}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>

              {parsedRows.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Preview ({parsedRows.length} rocks)
                  </span>
                  <div className="mt-1 space-y-1">
                    {parsedRows.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-np-light rounded-lg">
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
                        <BadgePill text={r.quarter || 'Q1 2026'} color="#6B7280" bgColor="#F3F4F6" />
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
                <div key={i} className="flex items-start gap-2 p-2 bg-np-light rounded-lg">
                  <span className="text-[10px] font-bold text-gray-300 w-4 mt-2">{i + 1}</span>
                  <div className="flex-1 space-y-1">
                    <input value={r.title} onChange={e => updateManualRow(i, 'title', e.target.value)}
                      placeholder="Rock title..."
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    <input value={r.description} onChange={e => updateManualRow(i, 'description', e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
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
                    {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'].map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                  <button onClick={() => removeManualRow(i)} className="text-gray-300 hover:text-red-400 mt-2">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button onClick={addManualRow}
                className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">
                + Add Row
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">{importRows.length} rock{importRows.length !== 1 ? 's' : ''} ready</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
            <button onClick={() => { onImport(importRows); onClose() }}
              disabled={importRows.length === 0}
              className="px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors disabled:opacity-50">
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
  const [form, setForm] = useState({
    title: '', description: '', owner_id: '', quarter: 'Q1 2026',
    due_date: '', color: DEFAULT_ROCK_COLORS[0],
  })
  const [doneColumnIds, setDoneColumnIds] = useState<Set<string>>(new Set())

  // Load dependencies
  const loadDeps = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('rock_dependencies')
      .select('*')
      .eq('org_id', currentOrg.id)
    if (data) setDependencies(data)
  }, [currentOrg?.id])

  useEffect(() => {
    if (!currentOrg) return
    supabase.from('kanban_columns').select('id, title').eq('org_id', currentOrg.id)
      .then(({ data }) => {
        if (data) setDoneColumnIds(new Set(
          data.filter(c => c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')).map(c => c.id)
        ))
      })
    loadDeps()
  }, [currentOrg?.id, loadDeps])

  // Auto-switch to journey view when deps exist
  useEffect(() => {
    if (dependencies.length > 0 && view === 'list') {
      // Don't auto-switch, but show badge
    }
  }, [dependencies])

  const toggleExpand = async (rockId: string) => {
    if (expandedId === rockId) {
      setExpandedId(null)
      setExpandedTasks([])
      return
    }
    setExpandedId(rockId)
    const { data } = await supabase
      .from('kanban_tasks')
      .select('*')
      .eq('rock_id', rockId)
      .order('sort_order')
    setExpandedTasks(data || [])
  }

  const handleCreate = async () => {
    if (!form.title.trim()) return
    setCreating(true)
    try {
      await addRock({
        title: form.title.trim(),
        description: form.description || null,
        owner_id: form.owner_id || null,
        quarter: form.quarter || null,
        due_date: form.due_date || null,
        color: form.color,
        status: 'on_track',
      })
      setShowCreate(false)
      setForm({ title: '', description: '', owner_id: '', quarter: 'Q1 2026', due_date: '', color: DEFAULT_ROCK_COLORS[0] })
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  const handleBulkImport = async (rows: Array<{ title: string; description: string; owner_id: string; quarter: string }>) => {
    const batchId = `import_${Date.now()}`
    for (const row of rows) {
      await addRock({
        title: row.title,
        description: row.description || null,
        owner_id: row.owner_id || null,
        quarter: row.quarter || 'Q1 2026',
        color: DEFAULT_ROCK_COLORS[Math.floor(Math.random() * DEFAULT_ROCK_COLORS.length)],
        status: 'on_track',
      })
    }
    fetchData()
  }

  const getTaskStatus = (t: KanbanTask) => {
    if (doneColumnIds.has(t.column_id)) return 'done'
    return 'active'
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
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('list')}
              className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                view === 'list' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400'
              }`}>
              <List size={11} className="inline mr-0.5" /> List
            </button>
            <button onClick={() => setView('journey')}
              className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                view === 'journey' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400'
              }`}>
              <Map size={11} className="inline mr-0.5" /> Journey
              {dependencies.length > 0 && (
                <span className="ml-0.5 px-1 py-0 text-[8px] bg-teal text-white rounded-full">{dependencies.length}</span>
              )}
            </button>
          </div>

          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors">
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
          <DependencyJourney
            rocks={rocks}
            dependencies={dependencies}
            onClickRock={(id) => router.push(`/rocks/${id}`)}
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
                <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/70 cursor-pointer transition-colors ${isExpanded ? 'bg-np-light' : 'hover:bg-gray-50/50'}`}>
                  <button onClick={() => toggleExpand(r.id)} className="p-0 bg-transparent border-none cursor-pointer">
                    <ChevronRight size={13} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  {/* Color dot matching journey colors */}
                  <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: jc.bg, borderColor: jc.border }} />
                  <StatusDot status={r.status} />
                  <span onClick={() => router.push(`/rocks/${r.id}`)}
                    className="text-xs font-semibold text-np-dark truncate cursor-pointer hover:text-np-blue transition-colors"
                    style={{ flex: '0 0 180px' }}>
                    {r.title}
                  </span>
                  <Avatar initials={r.owner_initials || '??'} size={22} color={r.color} />
                  <div className="flex-1 flex items-center gap-2">
                    <ProgressBar pct={r.progress_pct} />
                    <span className="text-[11px] font-bold text-np-dark w-8 text-right">{r.progress_pct}%</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{r.tasks_done}/{r.task_count}</span>
                  <span className="text-[10px] text-gray-400">{r.due_date ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}</span>
                </div>

                {isExpanded && (
                  <div className="bg-np-light px-4 py-2 pl-12 border-b border-gray-100">
                    {expandedTasks.length === 0 && (
                      <p className="text-[11px] text-gray-400 py-2">No tasks linked. Open rock to add tasks with RACI.</p>
                    )}
                    {expandedTasks.slice(0, 4).map(t => {
                      const st = getTaskStatus(t)
                      return (
                        <div key={t.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <span className="font-semibold" style={{ color: st === 'done' ? '#16A34A' : '#2A9D8F' }}>
                            {st === 'done' ? '✓' : '◐'}
                          </span>
                          <button onClick={() => router.push(`/tasks?task=${t.id}`)}
                            className={`flex-1 text-left hover:text-np-blue hover:underline transition-colors ${st === 'done' ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                            {t.title}
                          </button>
                          {/* RACI pills */}
                          {t.custom_fields && Object.keys(t.custom_fields).some(k => k.startsWith('raci_') && t.custom_fields[k]) && (
                            <div className="flex gap-0.5">
                              {[
                                { key: 'raci_responsible', label: 'R', color: '#2563EB' },
                                { key: 'raci_accountable', label: 'A', color: '#DC2626' },
                                { key: 'raci_consulted', label: 'C', color: '#D97706' },
                                { key: 'raci_informed', label: 'I', color: '#6B7280' },
                              ].filter(r => t.custom_fields?.[r.key]).map(r => (
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
                        className="text-[10px] text-np-blue font-semibold flex items-center gap-1 mt-1 bg-transparent border-none cursor-pointer hover:text-np-dark">
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
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-np-blue bg-np-blue/5 rounded-lg border border-np-blue/20">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
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
                  className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Owner</label>
                  <select value={form.owner_id} onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.user_id || m.id} value={m.user_id || ''}>{m.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Quarter</label>
                  <select value={form.quarter} onChange={e => setForm(p => ({ ...p, quarter: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                    {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'].map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full mt-0.5 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Color</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {DEFAULT_ROCK_COLORS.slice(0, 5).map(c => (
                      <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                        className="w-6 h-6 rounded-full transition-transform"
                        style={{
                          background: c,
                          border: form.color === c ? '2px solid #3E3E3E' : '2px solid transparent',
                          transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                        }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title.trim() || creating}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-dark transition-colors disabled:opacity-50">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Target size={12} />}
                Create Rock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onImport={handleBulkImport}
          members={members}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
