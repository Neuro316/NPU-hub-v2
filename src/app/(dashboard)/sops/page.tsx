'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  FileText, Plus, Search, Trash2, Pencil, X, Save, Loader2, Wand2, Sparkles,
  ChevronDown, ChevronRight, Clock, User, Wrench, Link2, Route, ArrowRight,
  GripVertical, Copy, Eye, Check, AlertCircle, Play, BookOpen,
} from 'lucide-react'

interface SOP {
  id: string
  org_id: string
  title: string
  description: string | null
  category: string | null
  status: 'draft' | 'review' | 'published' | 'archived'
  owner_id: string | null
  version: number
  linked_journey_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

interface SOPStep {
  id: string
  sop_id: string
  org_id: string
  step_number: number
  title: string
  instructions: string | null
  responsible_role: string | null
  tools_needed: string | null
  estimated_minutes: number | null
  linked_card_id: string | null
  sort_order: number
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  { value: 'review', label: 'In Review', color: '#F59E0B', bg: '#FEF3C7' },
  { value: 'published', label: 'Published', color: '#10B981', bg: '#D1FAE5' },
  { value: 'archived', label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
]

const CATEGORIES = [
  'marketing', 'sales', 'onboarding', 'operations', 'support',
  'content', 'finance', 'hr', 'product', 'general',
]

const AI_SOP_SYSTEM = `You are an SOP writer and journey architect. Given a topic, generate a detailed SOP with steps AND a matching customer journey.

RULES:
- Return ONLY valid JSON, no markdown
- SOP steps should be clear, actionable, with responsible roles and time estimates
- Journey paths should map to major SOP sections
- Link SOP steps to journey cards by matching titles

JSON FORMAT:
{
  "sop": {
    "title": "SOP Title",
    "description": "Brief overview",
    "category": "operations",
    "steps": [
      { "title": "Step Name", "instructions": "Detailed instructions...", "responsible_role": "Role Name", "tools_needed": "Tool list", "estimated_minutes": 15 }
    ]
  },
  "journey": {
    "paths": [
      {
        "name": "Phase Name",
        "key": "phase_key",
        "color": "#8B5CF6",
        "cards": [
          { "title": "Card matching SOP step", "description": "Visual representation", "row_index": 0, "automation": "manual" }
        ]
      }
    ]
  }
}`

export default function SOPsPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  const [sops, setSOPs] = useState<SOP[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

  // Selected SOP detail
  const [selected, setSelected] = useState<SOP | null>(null)
  const [steps, setSteps] = useState<SOPStep[]>([])
  const [stepsLoading, setStepsLoading] = useState(false)
  const [editingStep, setEditingStep] = useState<string | null>(null)
  const [linkedCards, setLinkedCards] = useState<Record<string, any>>({})

  // Create/edit SOP
  const [showCreate, setShowCreate] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCategory, setEditCategory] = useState('general')
  const [saving, setSaving] = useState(false)

  // AI generation
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)

  // Run mode (visual walkthrough)
  const [runMode, setRunMode] = useState(false)
  const [runStep, setRunStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())

  // Fetch SOPs
  const fetchSOPs = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase
      .from('sops')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('updated_at', { ascending: false })
    if (data) setSOPs(data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchSOPs() }, [fetchSOPs])

  // Fetch steps when SOP selected
  const fetchSteps = async (sopId: string) => {
    setStepsLoading(true)
    const { data } = await supabase
      .from('sop_steps')
      .select('*')
      .eq('sop_id', sopId)
      .order('sort_order')
    if (data) {
      setSteps(data)
      // Fetch linked journey cards
      const cardIds = data.filter(s => s.linked_card_id).map(s => s.linked_card_id!)
      if (cardIds.length > 0) {
        const { data: cards } = await supabase
          .from('journey_cards')
          .select('id, title, status, phase_id')
          .in('id', cardIds)
        if (cards) {
          const map: Record<string, any> = {}
          cards.forEach(c => { map[c.id] = c })
          setLinkedCards(map)
        }
      }
    }
    setStepsLoading(false)
  }

  const selectSOP = (sop: SOP) => {
    setSelected(sop)
    setRunMode(false)
    setRunStep(0)
    setCompletedSteps(new Set())
    fetchSteps(sop.id)
  }

  // CRUD
  const createSOP = async () => {
    if (!currentOrg || !editTitle.trim()) return
    setSaving(true)
    const { data } = await supabase.from('sops').insert({
      org_id: currentOrg.id,
      title: editTitle.trim(),
      description: editDesc || null,
      category: editCategory,
      status: 'draft',
    }).select().single()
    if (data) {
      setSOPs(p => [data, ...p])
      selectSOP(data)
    }
    setShowCreate(false)
    setEditTitle('')
    setEditDesc('')
    setSaving(false)
  }

  const updateSOP = async (id: string, updates: Partial<SOP>) => {
    const { data } = await supabase.from('sops')
      .update(updates)
      .eq('id', id)
      .select().single()
    if (data) {
      setSOPs(p => p.map(s => s.id === id ? data : s))
      if (selected?.id === id) setSelected(data)
    }
  }

  const deleteSOP = async (id: string) => {
    if (!confirm('Delete this SOP and all its steps?')) return
    await supabase.from('sops').delete().eq('id', id)
    setSOPs(p => p.filter(s => s.id !== id))
    if (selected?.id === id) { setSelected(null); setSteps([]) }
  }

  // Step CRUD
  const addStep = async () => {
    if (!selected || !currentOrg) return
    const { data } = await supabase.from('sop_steps').insert({
      sop_id: selected.id,
      org_id: currentOrg.id,
      step_number: steps.length + 1,
      title: 'New Step',
      instructions: '',
      sort_order: steps.length,
    }).select().single()
    if (data) {
      setSteps(p => [...p, data])
      setEditingStep(data.id)
    }
  }

  const updateStep = async (id: string, updates: Partial<SOPStep>) => {
    const { data } = await supabase.from('sop_steps')
      .update(updates)
      .eq('id', id)
      .select().single()
    if (data) setSteps(p => p.map(s => s.id === id ? data : s))
  }

  const deleteStep = async (id: string) => {
    await supabase.from('sop_steps').delete().eq('id', id)
    setSteps(p => p.filter(s => s.id !== id))
  }

  // AI Generation (SOP + Journey)
  const runAI = async () => {
    if (!currentOrg || !aiPrompt.trim()) return
    setAiLoading(true)
    setAiResult(null)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: aiPrompt }],
          brandSettings: null,
          campaignContext: { type: 'sop_builder', systemOverride: AI_SOP_SYSTEM },
        }),
      })
      const data = await res.json()
      const text = data.response || data.content || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      const parsed = JSON.parse(jsonMatch[0])

      // Create SOP
      const sopData = parsed.sop
      const { data: newSop } = await supabase.from('sops').insert({
        org_id: currentOrg.id,
        title: sopData.title,
        description: sopData.description || '',
        category: sopData.category || 'general',
        status: 'draft',
      }).select().single()

      let journeyCreated = false

      if (newSop) {
        // Create SOP steps
        const cardTitleToId: Record<string, string> = {}

        // Create journey if provided
        if (parsed.journey?.paths) {
          for (let i = 0; i < parsed.journey.paths.length; i++) {
            const path = parsed.journey.paths[i]
            const { data: phase } = await supabase.from('journey_phases').insert({
              org_id: currentOrg.id,
              phase_key: path.key || path.name.toLowerCase().replace(/\s+/g, '_'),
              label: path.name,
              color: path.color || ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'][i % 5],
              sort_order: i,
            }).select().single()

            if (phase) {
              // Link SOP to journey
              await supabase.from('sops').update({ linked_journey_id: phase.id }).eq('id', newSop.id)

              for (let j = 0; j < (path.cards || []).length; j++) {
                const card = path.cards[j]
                const { data: newCard } = await supabase.from('journey_cards').insert({
                  org_id: currentOrg.id,
                  phase_id: phase.id,
                  title: card.title,
                  description: card.description || '',
                  row_index: card.row_index || 0,
                  sort_order: j,
                  custom_fields: { automation: card.automation || 'manual' },
                }).select().single()
                if (newCard) cardTitleToId[card.title] = newCard.id
              }
              journeyCreated = true
            }
          }
        }

        // Create SOP steps with card links
        for (let k = 0; k < (sopData.steps || []).length; k++) {
          const step = sopData.steps[k]
          await supabase.from('sop_steps').insert({
            sop_id: newSop.id,
            org_id: currentOrg.id,
            step_number: k + 1,
            title: step.title,
            instructions: step.instructions || '',
            responsible_role: step.responsible_role || '',
            tools_needed: step.tools_needed || '',
            estimated_minutes: step.estimated_minutes || null,
            linked_card_id: cardTitleToId[step.title] || null,
            sort_order: k,
          })
        }

        setSOPs(p => [{ ...newSop, linked_journey_id: newSop.linked_journey_id } as SOP, ...p])
        selectSOP(newSop)
        setAiResult(`Created "${sopData.title}" with ${sopData.steps?.length || 0} steps${journeyCreated ? ' and matching journey map' : ''}.`)
      }

      setAiOpen(false)
      setAiPrompt('')
    } catch (err: any) {
      alert('AI generation failed: ' + err.message)
    }
    setAiLoading(false)
  }

  // Generate journey from existing SOP
  const generateJourneyFromSOP = async () => {
    if (!selected || !currentOrg || steps.length === 0) return

    const { data: phase } = await supabase.from('journey_phases').insert({
      org_id: currentOrg.id,
      phase_key: selected.category || 'sop_flow',
      label: selected.title.replace(' SOP', ''),
      color: '#3B82F6',
      sort_order: 0,
    }).select().single()

    if (phase) {
      for (let i = 0; i < steps.length; i++) {
        const { data: card } = await supabase.from('journey_cards').insert({
          org_id: currentOrg.id,
          phase_id: phase.id,
          title: steps[i].title,
          description: steps[i].instructions || '',
          row_index: 0,
          sort_order: i,
        }).select().single()

        if (card) {
          await updateStep(steps[i].id, { linked_card_id: card.id })
        }
      }

      await updateSOP(selected.id, { linked_journey_id: phase.id })
      setAiResult(`Journey created from "${selected.title}". View it in Journey Builder.`)
      setTimeout(() => setAiResult(null), 5000)
    }
  }

  // Filtered list
  const filtered = sops.filter(s => {
    if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && s.status !== filterStatus) return false
    if (filterCategory && s.category !== filterCategory) return false
    return true
  })

  const totalMinutes = steps.reduce((sum, s) => sum + (s.estimated_minutes || 0), 0)

  if (orgLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4">
      {/* Left: SOP List */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold text-np-dark">SOPs</h1>
            <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} - Standard Operating Procedures</p>
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Plus className="w-3.5 h-3.5" /> New SOP
          </button>
          <button onClick={() => setAiOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-xs font-medium hover:opacity-90">
            <Wand2 className="w-3.5 h-3.5" /> AI Create
          </button>
        </div>

        {/* Search + filters */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search SOPs..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-xs" />
        </div>

        <div className="flex gap-1 mb-2 flex-wrap">
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} onClick={() => setFilterStatus(filterStatus === s.value ? null : s.value)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all
                ${filterStatus === s.value ? '' : 'opacity-50'}`}
              style={{ backgroundColor: s.bg, color: s.color }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* SOP list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto mt-8" />}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">No SOPs yet. Create one to get started.</p>
            </div>
          )}
          {filtered.map(sop => {
            const status = STATUS_OPTIONS.find(s => s.value === sop.status)!
            const isSelected = selected?.id === sop.id
            return (
              <button key={sop.id} onClick={() => selectSOP(sop)}
                className={`w-full text-left p-3 rounded-xl transition-colors
                  ${isSelected ? 'bg-np-blue/10 border border-np-blue/20' : 'bg-white border border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-start justify-between">
                  <p className="text-xs font-medium text-np-dark truncate flex-1">{sop.title}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2"
                    style={{ backgroundColor: status.bg, color: status.color }}>{status.label}</span>
                </div>
                {sop.description && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sop.description}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  {sop.category && (
                    <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded capitalize">{sop.category}</span>
                  )}
                  {sop.linked_journey_id && (
                    <span className="text-[9px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Route className="w-2.5 h-2.5" /> Journey linked
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: SOP Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <BookOpen className="w-16 h-16 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Select or Create an SOP</h2>
              <p className="text-sm text-gray-500 max-w-md">
                SOPs document your team's processes step-by-step. Each SOP can link to a visual journey map for
                a bird's-eye view. AI can generate both simultaneously.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            {/* SOP Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <select value={selected.status}
                    onChange={e => updateSOP(selected.id, { status: e.target.value as SOP['status'] })}
                    className="text-[10px] px-2 py-0.5 rounded-full border-0 font-medium"
                    style={{
                      backgroundColor: STATUS_OPTIONS.find(s => s.value === selected.status)?.bg,
                      color: STATUS_OPTIONS.find(s => s.value === selected.status)?.color,
                    }}>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <select value={selected.category || 'general'}
                    onChange={e => updateSOP(selected.id, { category: e.target.value })}
                    className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded border-0 capitalize">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {totalMinutes > 0 && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> ~{totalMinutes} min total
                    </span>
                  )}
                </div>
                <input value={selected.title}
                  onChange={e => {
                    setSelected({ ...selected, title: e.target.value })
                    // Debounced save
                    clearTimeout((window as any).__sopTitleTimer)
                    ;(window as any).__sopTitleTimer = setTimeout(() => updateSOP(selected.id, { title: e.target.value }), 500)
                  }}
                  className="text-lg font-semibold text-np-dark border-0 p-0 w-full focus:outline-none" />
                <input value={selected.description || ''}
                  onChange={e => {
                    setSelected({ ...selected, description: e.target.value })
                    clearTimeout((window as any).__sopDescTimer)
                    ;(window as any).__sopDescTimer = setTimeout(() => updateSOP(selected.id, { description: e.target.value }), 500)
                  }}
                  placeholder="Add a description..."
                  className="text-xs text-gray-500 border-0 p-0 w-full focus:outline-none mt-1" />
              </div>
              <div className="flex items-center gap-1.5">
                {!selected.linked_journey_id && steps.length > 0 && (
                  <button onClick={generateJourneyFromSOP}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100">
                    <Route className="w-3.5 h-3.5" /> Create Journey
                  </button>
                )}
                {selected.linked_journey_id && (
                  <a href="/journeys"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100">
                    <Route className="w-3.5 h-3.5" /> View Journey
                  </a>
                )}
                <button onClick={() => { setRunMode(!runMode); setRunStep(0); setCompletedSteps(new Set()) }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg
                    ${runMode ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                  <Play className="w-3.5 h-3.5" /> {runMode ? 'Exit Run' : 'Run SOP'}
                </button>
                <button onClick={() => deleteSOP(selected.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* AI Result banner */}
            {aiResult && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
                <Check className="w-4 h-4" /> {aiResult}
                <button onClick={() => setAiResult(null)} className="ml-auto"><X className="w-3 h-3" /></button>
              </div>
            )}

            {/* Steps */}
            <div className="space-y-2">
              {stepsLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />}

              {/* Run mode progress bar */}
              {runMode && steps.length > 0 && (
                <div className="mb-3 p-3 bg-green-50 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-green-800">
                      Step {runStep + 1} of {steps.length}
                    </span>
                    <span className="text-xs text-green-600">
                      {completedSteps.size}/{steps.length} completed
                    </span>
                  </div>
                  <div className="w-full bg-green-200 rounded-full h-1.5">
                    <div className="bg-green-600 h-1.5 rounded-full transition-all"
                      style={{ width: `${(completedSteps.size / steps.length) * 100}%` }} />
                  </div>
                </div>
              )}

              {steps.map((step, idx) => {
                const isEditing = editingStep === step.id
                const isRunActive = runMode && runStep === idx
                const isCompleted = completedSteps.has(step.id)
                const linkedCard = step.linked_card_id ? linkedCards[step.linked_card_id] : null

                return (
                  <div key={step.id}
                    className={`border rounded-xl p-3 transition-all
                      ${isRunActive ? 'border-green-400 bg-green-50/50 shadow-md' : isCompleted ? 'border-green-200 bg-green-50/30' : 'border-gray-100'}
                      ${isEditing ? 'ring-1 ring-np-blue/30' : ''}`}>

                    <div className="flex items-start gap-3">
                      {/* Step number / checkbox */}
                      <div className="flex-shrink-0">
                        {runMode ? (
                          <button onClick={() => {
                            const next = new Set(completedSteps)
                            if (isCompleted) next.delete(step.id)
                            else next.add(step.id)
                            setCompletedSteps(next)
                            if (!isCompleted && runStep === idx && idx < steps.length - 1) setRunStep(idx + 1)
                          }}
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                              ${isCompleted ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-green-100'}`}>
                            {isCompleted ? <Check className="w-4 h-4" /> : idx + 1}
                          </button>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-np-blue/10 flex items-center justify-center text-xs font-bold text-np-blue">
                            {idx + 1}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input value={step.title}
                              onChange={e => setSteps(p => p.map(s => s.id === step.id ? { ...s, title: e.target.value } : s))}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm font-medium" />
                            <textarea value={step.instructions || ''}
                              onChange={e => setSteps(p => p.map(s => s.id === step.id ? { ...s, instructions: e.target.value } : s))}
                              placeholder="Step-by-step instructions..."
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs h-20 resize-none" />
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-[9px] text-gray-400 block mb-0.5">Responsible</label>
                                <input value={step.responsible_role || ''}
                                  onChange={e => setSteps(p => p.map(s => s.id === step.id ? { ...s, responsible_role: e.target.value } : s))}
                                  placeholder="Role..." className="w-full px-2 py-1 border border-gray-200 rounded text-[11px]" />
                              </div>
                              <div className="flex-1">
                                <label className="text-[9px] text-gray-400 block mb-0.5">Tools</label>
                                <input value={step.tools_needed || ''}
                                  onChange={e => setSteps(p => p.map(s => s.id === step.id ? { ...s, tools_needed: e.target.value } : s))}
                                  placeholder="Tools..." className="w-full px-2 py-1 border border-gray-200 rounded text-[11px]" />
                              </div>
                              <div className="w-20">
                                <label className="text-[9px] text-gray-400 block mb-0.5">Minutes</label>
                                <input type="number" value={step.estimated_minutes || ''}
                                  onChange={e => setSteps(p => p.map(s => s.id === step.id ? { ...s, estimated_minutes: parseInt(e.target.value) || null } : s))}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-[11px]" />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => { updateStep(step.id, step); setEditingStep(null) }}
                                className="px-3 py-1 bg-np-blue text-white rounded text-[11px] font-medium">Save</button>
                              <button onClick={() => setEditingStep(null)} className="text-[11px] text-gray-400">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className={`text-sm font-medium ${isCompleted ? 'text-green-700 line-through' : 'text-np-dark'}`}>
                              {step.title}
                            </p>
                            {step.instructions && (
                              <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{step.instructions}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                              {step.responsible_role && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <User className="w-3 h-3" /> {step.responsible_role}
                                </span>
                              )}
                              {step.tools_needed && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <Wrench className="w-3 h-3" /> {step.tools_needed}
                                </span>
                              )}
                              {step.estimated_minutes && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <Clock className="w-3 h-3" /> ~{step.estimated_minutes}m
                                </span>
                              )}
                              {linkedCard && (
                                <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <Link2 className="w-3 h-3" /> {linkedCard.title}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      {!runMode && !isEditing && (
                        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100"
                          style={{ opacity: 1 }}>
                          <button onClick={() => setEditingStep(step.id)}
                            className="p-1 text-gray-400 hover:text-np-blue rounded"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteStep(step.id)}
                            className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}

                      {runMode && isRunActive && !isCompleted && (
                        <button onClick={() => {
                          const next = new Set(completedSteps)
                          next.add(step.id)
                          setCompletedSteps(next)
                          if (idx < steps.length - 1) setRunStep(idx + 1)
                        }}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium flex-shrink-0">
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Add step */}
              {!runMode && (
                <button onClick={addStep}
                  className="w-full border border-dashed border-gray-200 rounded-xl p-3 text-xs text-gray-400
                    hover:border-np-blue/30 hover:text-np-blue hover:bg-np-blue/5 transition-colors flex items-center justify-center gap-1.5">
                  <Plus className="w-4 h-4" /> Add Step
                </button>
              )}

              {/* Run complete */}
              {runMode && completedSteps.size === steps.length && steps.length > 0 && (
                <div className="text-center py-6 bg-green-50 rounded-xl">
                  <Check className="w-10 h-10 text-green-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-green-800">SOP Complete!</p>
                  <p className="text-xs text-green-600 mt-1">All {steps.length} steps completed.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create SOP modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-np-dark mb-4">New SOP</h3>
            <div className="space-y-3">
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                placeholder="SOP Title" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" autoFocus />
              <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                placeholder="Description (optional)" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
              <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm capitalize">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">Cancel</button>
                <button onClick={createSOP} disabled={saving || !editTitle.trim()}
                  className="flex-1 px-3 py-2 bg-np-blue text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI SOP + Journey modal */}
      {aiOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => !aiLoading && setAiOpen(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-np-dark">AI SOP + Journey Generator</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Describe a process or workflow. AI will create a written SOP with steps AND a visual journey map.
              Both stay linked so updating one reflects in the other.
            </p>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
              placeholder="e.g. New client onboarding process: discovery call, contract signing, kickoff meeting, initial assessment, first deliverable"
              className="w-full h-28 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setAiOpen(false)} disabled={aiLoading}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">Cancel</button>
              <button onClick={runAI} disabled={aiLoading || !aiPrompt.trim()}
                className="flex-1 px-3 py-2 bg-gradient-to-r from-purple-600 to-np-blue text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Generate SOP + Journey'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
