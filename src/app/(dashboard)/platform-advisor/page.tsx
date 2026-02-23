'use client'

// ═══════════════════════════════════════════════════════════════
// Platform Advisor — AI-powered UX recommendations, tutorial
// management, and help request analytics
// Route: /platform-advisor — ADMIN ONLY
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import {
  Brain, Sparkles, AlertTriangle, Info, CheckCircle2, Loader2,
  BookOpen, MessageCircleQuestion, TrendingDown, RefreshCw, Shield,
  ChevronDown, ChevronRight, XCircle, Check, Eye, Trash2,
  Zap, ArrowRight, ToggleLeft, ToggleRight, Clock
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { PermissionGate } from '@/lib/hooks/use-permissions'

type Tab = 'advisor' | 'tutorials' | 'help_analytics'

interface Recommendation {
  id: string
  category: string
  title: string
  description: string
  severity: string
  action_items: { action: string; target: string; detail: string }[]
  status: string
  generated_at: string
}

interface Tutorial {
  id: string
  title: string
  description: string
  target_page: string
  category: string
  steps: { title: string; content: string; page_path?: string }[]
  trigger_patterns: string[]
  view_count: number
  is_published: boolean
  generated_from: string
  created_at: string
}

interface HelpStat {
  category: string
  count: number
  pages: Record<string, number>
  unhelpful: number
  sample_questions: string[]
}

const SEVERITY_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string }> = {
  critical: { icon: XCircle, color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
  warning: { icon: AlertTriangle, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  info: { icon: Info, color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  success: { icon: CheckCircle2, color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' },
}

const CATEGORY_LABELS: Record<string, string> = {
  redundancy: 'Redundancy',
  ux: 'UX Improvement',
  sunset: 'Sunset Candidate',
  performance: 'Performance',
  tutorial: 'Tutorial Needed',
  adoption: 'Adoption Gap',
}

function PlatformAdvisorContent() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [tab, setTab] = useState<Tab>('advisor')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [generatingTutorials, setGeneratingTutorials] = useState(false)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [tutorials, setTutorials] = useState<Tutorial[]>([])
  const [helpStats, setHelpStats] = useState<HelpStat[]>([])
  const [expandedRec, setExpandedRec] = useState<string | null>(null)
  const [expandedTut, setExpandedTut] = useState<string | null>(null)
  const [totalHelpRequests, setTotalHelpRequests] = useState(0)

  const loadData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    // Load recommendations
    const { data: recs } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('generated_at', { ascending: false })
      .limit(50)
    setRecommendations((recs as Recommendation[]) || [])

    // Load tutorials
    const { data: tuts } = await supabase
      .from('tutorials')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false })
    setTutorials((tuts as Tutorial[]) || [])

    // Load help request analytics
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: helps } = await supabase
      .from('help_requests')
      .select('question, category, page_context, helpful')
      .eq('org_id', currentOrg.id)
      .gte('occurred_at', since)
      .limit(500)

    setTotalHelpRequests(helps?.length || 0)

    // Aggregate help stats by category
    const catMap: Record<string, HelpStat> = {}
    ;(helps || []).forEach(h => {
      const cat = h.category || 'general'
      if (!catMap[cat]) {
        catMap[cat] = { category: cat, count: 0, pages: {}, unhelpful: 0, sample_questions: [] }
      }
      catMap[cat].count++
      if (h.page_context) catMap[cat].pages[h.page_context] = (catMap[cat].pages[h.page_context] || 0) + 1
      if (h.helpful === false) catMap[cat].unhelpful++
      if (catMap[cat].sample_questions.length < 5) catMap[cat].sample_questions.push(h.question)
    })
    setHelpStats(Object.values(catMap).sort((a, b) => b.count - a.count))

    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { loadData() }, [loadData])

  // Run AI scan
  const runScan = async () => {
    if (!currentOrg || scanning) return
    setScanning(true)
    try {
      const res = await fetch('/api/ai/platform-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: currentOrg.id }),
      })
      const data = await res.json()
      if (data.recommendations) {
        await loadData()
      }
    } catch (err) {
      console.error('Scan failed:', err)
    } finally {
      setScanning(false)
    }
  }

  // Generate tutorials from help patterns
  const generateTutorials = async () => {
    if (!currentOrg || generatingTutorials) return
    setGeneratingTutorials(true)
    try {
      const res = await fetch('/api/ai/generate-tutorials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: currentOrg.id }),
      })
      const data = await res.json()
      if (data.tutorials) {
        await loadData()
        setTab('tutorials')
      }
    } catch (err) {
      console.error('Tutorial generation failed:', err)
    } finally {
      setGeneratingTutorials(false)
    }
  }

  // Toggle tutorial published status
  const togglePublished = async (tutId: string, current: boolean) => {
    await supabase.from('tutorials').update({ is_published: !current }).eq('id', tutId)
    setTutorials(prev => prev.map(t => t.id === tutId ? { ...t, is_published: !current } : t))
  }

  // Delete tutorial
  const deleteTutorial = async (tutId: string) => {
    await supabase.from('tutorials').delete().eq('id', tutId)
    setTutorials(prev => prev.filter(t => t.id !== tutId))
  }

  // Update recommendation status
  const updateRecStatus = async (recId: string, status: string) => {
    await supabase.from('ai_recommendations').update({ status }).eq('id', recId)
    setRecommendations(prev => prev.map(r => r.id === recId ? { ...r, status } : r))
  }

  const openRecs = recommendations.filter(r => r.status === 'open')
  const closedRecs = recommendations.filter(r => r.status !== 'open')
  const publishedTuts = tutorials.filter(t => t.is_published)
  const draftTuts = tutorials.filter(t => !t.is_published)

  const TABS: { id: Tab; label: string; icon: any; badge?: number }[] = [
    { id: 'advisor', label: 'AI Advisor', icon: Brain, badge: openRecs.length },
    { id: 'tutorials', label: 'Tutorials', icon: BookOpen, badge: tutorials.length },
    { id: 'help_analytics', label: 'Help Analytics', icon: MessageCircleQuestion, badge: totalHelpRequests },
  ]

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark flex items-center gap-2">
            <Brain size={20} className="text-purple-500" /> Platform Advisor
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">AI-powered recommendations, auto-generated tutorials, and help pattern analytics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={generateTutorials} disabled={generatingTutorials}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal text-white rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-all">
            {generatingTutorials ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
            {generatingTutorials ? 'Generating...' : 'Generate Tutorials'}
          </button>
          <button onClick={runScan} disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-all">
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {scanning ? 'Scanning...' : 'Run AI Scan'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Open Recommendations', value: openRecs.length, icon: AlertTriangle, color: '#f59e0b' },
          { label: 'Published Tutorials', value: publishedTuts.length, icon: BookOpen, color: '#2A9D8F' },
          { label: 'Help Requests (30d)', value: totalHelpRequests, icon: MessageCircleQuestion, color: '#228DC4' },
          { label: 'Draft Tutorials', value: draftTuts.length, icon: Clock, color: '#8b5cf6' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon size={13} style={{ color: kpi.color }} />
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{kpi.label}</span>
            </div>
            <p className="text-2xl font-bold text-np-dark">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-0.5 bg-gray-50 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === t.id ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400'
            }`}>
            <t.icon size={12} /> {t.label}
            {(t.badge ?? 0) > 0 && (
              <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                tab === t.id ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-100 text-gray-400'
              }`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-8 h-8 rounded-lg bg-purple-100 animate-pulse" /></div>
      ) : (
        <>
          {/* ═══ AI ADVISOR TAB ═══ */}
          {tab === 'advisor' && (
            <div className="space-y-3">
              {openRecs.length === 0 && !scanning ? (
                <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                  <Brain size={36} className="mx-auto text-purple-200 mb-3" />
                  <p className="text-sm font-medium text-gray-500">No recommendations yet</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Click "Run AI Scan" to analyze your platform usage data</p>
                  <button onClick={runScan} disabled={scanning}
                    className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700">
                    <Sparkles size={12} className="inline mr-1.5" /> Run First Scan
                  </button>
                </div>
              ) : (
                <>
                  {openRecs.map(rec => {
                    const sev = SEVERITY_CONFIG[rec.severity] || SEVERITY_CONFIG.info
                    const SevIcon = sev.icon
                    const expanded = expandedRec === rec.id
                    return (
                      <div key={rec.id} className="bg-white rounded-xl border overflow-hidden transition-all"
                        style={{ borderColor: sev.border }}>
                        <button
                          onClick={() => setExpandedRec(expanded ? null : rec.id)}
                          className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50/50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: sev.bg }}>
                            <SevIcon size={14} style={{ color: sev.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: sev.bg, color: sev.color }}>
                                {CATEGORY_LABELS[rec.category] || rec.category}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-np-dark mt-1">{rec.title}</h4>
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{rec.description}</p>
                          </div>
                          <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>

                        {expanded && (
                          <div className="px-4 pb-4 border-t border-gray-50">
                            <p className="text-xs text-gray-600 mt-3 mb-3 leading-relaxed">{rec.description}</p>

                            {rec.action_items?.length > 0 && (
                              <div className="space-y-2 mb-4">
                                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Action Items</p>
                                {rec.action_items.map((item, i) => (
                                  <div key={i} className="flex items-start gap-2 pl-2">
                                    <ArrowRight size={10} className="text-np-blue flex-shrink-0 mt-1" />
                                    <div>
                                      <span className="text-xs font-medium text-np-dark">{item.action}</span>
                                      {item.target && <span className="text-[10px] text-gray-400 ml-1.5">{item.target}</span>}
                                      {item.detail && <p className="text-[10px] text-gray-500 mt-0.5">{item.detail}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex gap-2">
                              <button onClick={() => updateRecStatus(rec.id, 'accepted')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 text-[10px] font-medium rounded-lg hover:bg-green-100">
                                <Check size={10} /> Accept
                              </button>
                              <button onClick={() => updateRecStatus(rec.id, 'completed')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded-lg hover:bg-blue-100">
                                <CheckCircle2 size={10} /> Mark Complete
                              </button>
                              <button onClick={() => updateRecStatus(rec.id, 'dismissed')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 text-gray-400 text-[10px] font-medium rounded-lg hover:bg-gray-100">
                                <XCircle size={10} /> Dismiss
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Closed recommendations */}
                  {closedRecs.length > 0 && (
                    <div className="mt-6">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Resolved ({closedRecs.length})
                      </p>
                      <div className="space-y-1">
                        {closedRecs.slice(0, 10).map(rec => (
                          <div key={rec.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                            {rec.status === 'completed' && <CheckCircle2 size={12} className="text-green-500" />}
                            {rec.status === 'accepted' && <Check size={12} className="text-blue-500" />}
                            {rec.status === 'dismissed' && <XCircle size={12} className="text-gray-400" />}
                            <span className="text-xs text-gray-500 line-through">{rec.title}</span>
                            <span className="text-[9px] text-gray-400 ml-auto capitalize">{rec.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ TUTORIALS TAB ═══ */}
          {tab === 'tutorials' && (
            <div className="space-y-4">
              {/* Published */}
              <div>
                <h3 className="text-sm font-bold text-np-dark mb-2 flex items-center gap-1.5">
                  <Eye size={14} className="text-green-500" /> Published ({publishedTuts.length})
                </h3>
                {publishedTuts.length === 0 ? (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
                    No published tutorials. Generate some and toggle them on.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {publishedTuts.map(t => (
                      <TutorialCard key={t.id} tutorial={t} expanded={expandedTut === t.id}
                        onToggle={() => setExpandedTut(expandedTut === t.id ? null : t.id)}
                        onPublishToggle={() => togglePublished(t.id, t.is_published)}
                        onDelete={() => deleteTutorial(t.id)} />
                    ))}
                  </div>
                )}
              </div>

              {/* Drafts */}
              <div>
                <h3 className="text-sm font-bold text-np-dark mb-2 flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-500" /> Drafts ({draftTuts.length})
                </h3>
                {draftTuts.length === 0 ? (
                  <div className="bg-gray-50 rounded-lg p-6 text-center">
                    <BookOpen size={24} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400 mb-3">No draft tutorials</p>
                    <button onClick={generateTutorials} disabled={generatingTutorials}
                      className="px-4 py-2 bg-teal text-white text-xs font-medium rounded-lg hover:bg-teal/90">
                      {generatingTutorials ? 'Generating...' : 'Generate from Help Patterns'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {draftTuts.map(t => (
                      <TutorialCard key={t.id} tutorial={t} expanded={expandedTut === t.id}
                        onToggle={() => setExpandedTut(expandedTut === t.id ? null : t.id)}
                        onPublishToggle={() => togglePublished(t.id, t.is_published)}
                        onDelete={() => deleteTutorial(t.id)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ HELP ANALYTICS TAB ═══ */}
          {tab === 'help_analytics' && (
            <div className="space-y-4">
              {helpStats.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                  <MessageCircleQuestion size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-gray-500">No help requests yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    As users ask questions via the Help Bot, patterns will appear here
                  </p>
                </div>
              ) : (
                helpStats.map(stat => (
                  <div key={stat.category} className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-np-dark capitalize">{stat.category.replace('_', ' ')}</span>
                        <span className="text-[10px] px-2 py-0.5 bg-np-blue/10 text-np-blue rounded-full font-bold">
                          {stat.count} requests
                        </span>
                        {stat.unhelpful > 0 && (
                          <span className="text-[10px] px-2 py-0.5 bg-red-50 text-red-500 rounded-full font-bold">
                            {stat.unhelpful} unhelpful
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Top pages for this category */}
                    {Object.keys(stat.pages).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Object.entries(stat.pages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([page, count]) => (
                          <span key={page} className="text-[9px] px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full">
                            {page} ({count})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Sample questions */}
                    <div className="space-y-1">
                      {stat.sample_questions.map((q, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <MessageCircleQuestion size={10} className="text-gray-300 flex-shrink-0 mt-1" />
                          <p className="text-[10px] text-gray-500 italic">&quot;{q}&quot;</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Tutorial Card Component ───
function TutorialCard({ tutorial, expanded, onToggle, onPublishToggle, onDelete }: {
  tutorial: Tutorial; expanded: boolean; onToggle: () => void
  onPublishToggle: () => void; onDelete: () => void
}) {
  return (
    <div className={`bg-white rounded-xl border ${tutorial.is_published ? 'border-green-100' : 'border-gray-100'} overflow-hidden`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50/50">
        <BookOpen size={14} className={tutorial.is_published ? 'text-green-500' : 'text-gray-400'} />
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold text-np-dark">{tutorial.title}</h4>
          <p className="text-[10px] text-gray-400">{tutorial.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[9px] text-gray-400">{tutorial.steps.length} steps</span>
          <span className="text-[9px] text-gray-400">{tutorial.view_count} views</span>
          <ChevronDown size={12} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-50">
          <div className="space-y-2 mt-3 mb-4">
            {tutorial.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 pl-2">
                <span className="text-[9px] font-bold text-np-blue bg-np-blue/10 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <div>
                  <p className="text-xs font-medium text-np-dark">{step.title}</p>
                  <p className="text-[10px] text-gray-500">{step.content}</p>
                  {step.page_path && (
                    <span className="text-[9px] text-np-blue">📍 {step.page_path}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {tutorial.trigger_patterns?.length > 0 && (
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-gray-400 uppercase mb-1">Trigger Questions</p>
              <div className="flex flex-wrap gap-1">
                {tutorial.trigger_patterns.map((p, i) => (
                  <span key={i} className="text-[9px] px-2 py-0.5 bg-purple-50 text-purple-500 rounded-full">{p}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onPublishToggle}
              className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium rounded-lg ${
                tutorial.is_published
                  ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                  : 'bg-green-50 text-green-600 hover:bg-green-100'
              }`}>
              {tutorial.is_published ? <><ToggleRight size={10} /> Unpublish</> : <><ToggleLeft size={10} /> Publish</>}
            </button>
            <button onClick={onDelete}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-400 text-[10px] font-medium rounded-lg hover:bg-red-100">
              <Trash2 size={10} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlatformAdvisorPage() {
  return (
    <PermissionGate module="platform_advisor" level="view">
      <PlatformAdvisorContent />
    </PermissionGate>
  )
}
