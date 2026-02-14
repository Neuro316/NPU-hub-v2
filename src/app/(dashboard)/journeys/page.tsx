'use client'

import { useState } from 'react'
import { useJourneyData } from '@/lib/hooks/use-journey-data'
import { useWorkspace } from '@/lib/workspace-context'
import { PathGroup } from '@/components/journey/path-row'
import { CardDetailPanel } from '@/components/journey/card-detail-panel'
import type { JourneyCard } from '@/lib/types/journey'
import { PHASE_COLORS } from '@/lib/types/journey'
import { Plus, Wand2, Route, Loader2, X, Sparkles } from 'lucide-react'

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

const AI_SYSTEM = `You are a customer journey architect. Given a business description, generate a complete customer journey map with paths and cards.

RULES:
- Return ONLY valid JSON, no markdown, no commentary
- Each path represents a major phase (e.g., Marketing, Sales, Onboarding, Program, Off-boarding)
- Each path has cards representing specific touchpoints, steps, or deliverables
- Cards should be ordered logically within each path
- Use row_index to create parallel tracks within a path (e.g., row 0 = Facebook Ads, row 1 = Organic Social)
- Keep card titles short and specific (2-5 words)
- Generate 3-7 paths with 3-10 cards each

JSON FORMAT:
{
  "paths": [
    {
      "name": "Marketing",
      "key": "marketing",
      "color": "#8B5CF6",
      "cards": [
        { "title": "Facebook Ads", "row": 0 },
        { "title": "Instagram Reels", "row": 0 },
        { "title": "Podcast Episodes", "row": 1 },
        { "title": "Blog / SEO", "row": 1 },
        { "title": "Lead Magnet", "row": 0 }
      ]
    }
  ]
}`

export default function JourneysPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const {
    phases, cards, loading,
    addPhase, updatePhase, deletePhase,
    addCard, updateCard, deleteCard,
  } = useJourneyData()

  const [selectedCard, setSelectedCard] = useState<JourneyCard | null>(null)
  const [addingPath, setAddingPath] = useState(false)
  const [newPathLabel, setNewPathLabel] = useState('')

  // AI Journey Creator
  const [showAI, setShowAI] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiPreview, setAiPreview] = useState<any>(null)
  const [aiError, setAiError] = useState('')
  const [aiCreating, setAiCreating] = useState(false)
  const [aiProgress, setAiProgress] = useState('')

  const handleDuplicate = async (card: JourneyCard, targetPhaseId: string, targetRow: number) => {
    await addCard(targetPhaseId, card.title, targetRow)
  }

  const handleAddPath = async () => {
    if (!newPathLabel.trim()) return
    const key = newPathLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const color = PATH_COLORS[phases.length % PATH_COLORS.length]
    await addPhase(newPathLabel.trim(), key, color)
    setNewPathLabel('')
    setAddingPath(false)
  }

  // AI: Generate journey preview
  const generateJourney = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError('')
    setAiPreview(null)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Generate a customer journey map for: ${aiPrompt.trim()}` }],
          campaignContext: { type: 'journey_creator', systemOverride: AI_SYSTEM },
        }),
      })
      const data = await res.json()
      let content = (data.content || '').trim()

      // Strip markdown fences if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

      const parsed = JSON.parse(content)
      if (parsed.paths && Array.isArray(parsed.paths)) {
        // Assign colors if missing
        parsed.paths.forEach((p: any, i: number) => {
          if (!p.color) p.color = PATH_COLORS[i % PATH_COLORS.length]
          if (!p.key) p.key = p.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        })
        setAiPreview(parsed)
      } else {
        setAiError('AI returned invalid format. Try again.')
      }
    } catch (err: any) {
      setAiError('Failed to parse AI response. Try rephrasing your description.')
    }
    setAiLoading(false)
  }

  // AI: Create all paths and cards from preview
  const createFromPreview = async () => {
    if (!aiPreview?.paths) return
    setAiCreating(true)

    for (const path of aiPreview.paths) {
      setAiProgress(`Creating path: ${path.name}...`)
      const result = await addPhase(path.name, path.key, path.color)
      if (result?.data?.id) {
        for (const card of path.cards || []) {
          await addCard(result.data.id, card.title, card.row || 0)
        }
      }
    }

    setAiProgress('')
    setAiCreating(false)
    setShowAI(false)
    setAiPreview(null)
    setAiPrompt('')
  }

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading journey...</div>
      </div>
    )
  }

  const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order)
  const totalCards = aiPreview?.paths?.reduce((sum: number, p: any) => sum + (p.cards?.length || 0), 0) || 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Journey Builder</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentOrg?.name} · {phases.length} paths · {cards.length} cards
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAddingPath(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Path
          </button>
          <button
            onClick={() => setShowAI(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" /> AI Journey Creator
          </button>
        </div>
      </div>

      {/* Add Path Input */}
      {addingPath && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 max-w-sm">
          <h3 className="text-xs font-semibold text-np-dark mb-2">New Path</h3>
          <input
            value={newPathLabel}
            onChange={e => setNewPathLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddPath()
              if (e.key === 'Escape') { setAddingPath(false); setNewPathLabel('') }
            }}
            placeholder="Path name (e.g., Marketing, Sales, Onboarding)..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleAddPath} className="bg-np-blue text-white text-xs py-1.5 px-4 rounded-lg font-medium">Add Path</button>
            <button onClick={() => { setAddingPath(false); setNewPathLabel('') }} className="bg-gray-100 text-gray-600 text-xs py-1.5 px-4 rounded-lg font-medium">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {phases.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Route className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Map Your Customer Journey</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create paths for each major flow: Marketing, Sales, Onboarding, Program, Off-boarding.
            Each path can have multiple rows for parallel tracks.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setAddingPath(true)} className="bg-white border border-gray-200 text-np-dark text-sm py-2.5 px-5 rounded-lg font-medium">
              Create First Path
            </button>
            <button onClick={() => setShowAI(true)} className="bg-np-blue text-white text-sm py-2.5 px-5 rounded-lg font-medium flex items-center gap-2">
              <Wand2 className="w-4 h-4" /> Generate with AI
            </button>
          </div>
        </div>
      )}

      {/* Path Groups */}
      <div className="space-y-3">
        {sortedPhases.map(phase => (
          <PathGroup
            key={phase.id}
            phase={phase}
            cards={cards.filter(c => c.phase_id === phase.id)}
            onAddCard={addCard}
            onUpdateCard={updateCard}
            onDeleteCard={deleteCard}
            onCardClick={setSelectedCard}
            onUpdatePhase={updatePhase}
            onDeletePhase={deletePhase}
          />
        ))}

        {/* Add Path */}
        {phases.length > 0 && (
          <button
            onClick={() => setAddingPath(true)}
            className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Path
          </button>
        )}
      </div>

      {/* Card Detail Panel */}
      <CardDetailPanel
        card={selectedCard}
        phases={phases}
        onClose={() => setSelectedCard(null)}
        onUpdate={updateCard}
        onDelete={deleteCard}
        onDuplicate={handleDuplicate}
        orgId={currentOrg?.id}
      />

      {/* AI Journey Creator Modal */}
      {showAI && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !aiLoading && !aiCreating && setShowAI(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-np-blue flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-np-dark">AI Journey Creator</h2>
                  <p className="text-[10px] text-gray-400">Describe your business and AI will generate a complete customer journey map</p>
                </div>
              </div>
              <button onClick={() => !aiLoading && !aiCreating && setShowAI(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Input */}
              {!aiPreview && (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1.5">Describe your customer journey</label>
                    <textarea
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      placeholder="e.g., Mastermind cohort: Facebook ads and organic social for marketing, discovery calls for sales, 12-week VR biofeedback program with weekly group coaching, alumni community for retention..."
                      rows={4}
                      className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 resize-none"
                      autoFocus
                    />
                  </div>

                  {/* Quick prompts */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1.5">Quick Start Templates</label>
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_PROMPTS.map((qp, i) => (
                        <button key={i} onClick={() => setAiPrompt(qp)}
                          className="text-left text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:bg-np-blue/5 hover:border-np-blue/20 hover:text-np-blue transition-all leading-relaxed">
                          {qp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {aiError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{aiError}</p>}
                </>
              )}

              {/* Preview */}
              {aiPreview && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-np-dark">Preview: {aiPreview.paths.length} paths, {totalCards} cards</h3>
                    <button onClick={() => { setAiPreview(null); setAiError('') }}
                      className="text-[10px] text-gray-500 hover:text-np-blue">
                      ← Back to edit
                    </button>
                  </div>

                  {aiPreview.paths.map((path: any, pi: number) => (
                    <div key={pi} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: path.color }} />
                        <span className="text-xs font-bold text-np-dark">{path.name}</span>
                        <span className="text-[9px] text-gray-400">{path.cards?.length || 0} cards</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(path.cards || []).map((card: any, ci: number) => (
                          <span key={ci} className="text-[10px] bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-600">
                            {card.row > 0 && <span className="text-gray-300 mr-1">R{card.row}</span>}
                            {card.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}

                  {aiProgress && (
                    <div className="flex items-center gap-2 text-xs text-np-blue bg-np-blue/5 px-3 py-2 rounded-lg">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {aiProgress}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => !aiLoading && !aiCreating && setShowAI(false)}
                className="text-xs text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>

              {!aiPreview ? (
                <button onClick={generateJourney} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-np-blue px-5 py-2 rounded-lg hover:bg-np-blue/90 disabled:opacity-40">
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiLoading ? 'Generating...' : 'Generate Journey'}
                </button>
              ) : (
                <>
                  <button onClick={generateJourney} disabled={aiLoading}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-40">
                    {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    Regenerate
                  </button>
                  <button onClick={createFromPreview} disabled={aiCreating}
                    className="flex items-center gap-1.5 text-xs font-bold text-white bg-green-600 px-5 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {aiCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {aiCreating ? 'Creating...' : `Create ${aiPreview.paths.length} Paths & ${totalCards} Cards`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
