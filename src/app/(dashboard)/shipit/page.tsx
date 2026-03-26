'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useTaskData } from '@/lib/hooks/use-task-data'
import { ArrowLeft, Plus, Send, ChevronDown, ChevronUp, Loader2, Download, Trash2, RefreshCw, ExternalLink, X, Rocket, Sparkles, FileText, FolderOpen, Globe, Check, Kanban, ClipboardPaste } from 'lucide-react'

const SECTIONS = [
  { id: 'project', icon: '01', title: 'The Project', fields: [
    { id: 'what', label: 'What are you shipping? (Be specific)', placeholder: "Not 'a website' but 'a 5-page website with booking integration'" },
    { id: 'who', label: 'Who is it for?', placeholder: 'Specific person or audience. Name them.' },
    { id: 'why', label: 'Why does it matter to them?', placeholder: 'What change does it create in their life?' },
  ]},
  { id: 'fear', icon: '02', title: 'Name the Fear', fields: [
    { id: 'worst', label: "What's the worst that could happen?", placeholder: 'Be honest. Say it out loud.' },
    { id: 'lizard', label: "What's the lizard brain telling you?", placeholder: "'It's not ready.' 'People will judge.' 'What if it fails?'" },
    { id: 'fear-truth', label: 'Is this fear protecting you or holding you back?', placeholder: 'Most fears about shipping are about ego, not safety.' },
  ]},
  { id: 'thrash', icon: '03', title: 'Thrashing', subtitle: '"Thrashing" is making changes. Do it early, not late. Late thrashing kills projects.', fields: [
    { id: 'decisions', label: 'What decisions are still unmade?', placeholder: 'List every open question. These will block you later.' },
    { id: 'approvers', label: 'Who needs to approve or give input?', placeholder: 'Get their input NOW, not at the deadline.' },
    { id: 'cut', label: 'What scope can you cut to ship on time?', placeholder: "What's nice-to-have vs. must-have?" },
  ]},
  { id: 'blockers', icon: '04', title: 'Blockers & Dependencies', fields: [
    { id: 'waiting', label: 'What are you waiting on from others?', placeholder: 'Assets, approvals, information, access...' },
    { id: 'missing', label: 'What skills or resources are you missing?', placeholder: 'Be honest about gaps.' },
    { id: 'one-blocker', label: "What's the ONE thing blocking progress right now?", placeholder: 'If you could only fix one thing, what would unblock everything?' },
  ]},
  { id: 'work', icon: '05', title: 'The Actual Work', fields: [
    { id: 'milestones', label: 'What are the 3-5 major milestones to shipping?', placeholder: '1. First draft complete\n2. Feedback incorporated\n3. Final review\n4. Ship', rows: 3 },
    { id: '30min', label: 'What can you do in the next 30 minutes?', placeholder: 'The smallest possible action. Do it now.' },
  ]},
  { id: 'ship', icon: '06', title: 'Ship It!', fields: [
    { id: 'announce', label: 'Who will you tell when it ships?', placeholder: 'Accountability matters. Tell someone your ship date.' },
    { id: 'celebrate', label: 'How will you celebrate?', placeholder: 'Shipping deserves recognition. Plan something.' },
    { id: 'next', label: 'What will you ship next?', placeholder: 'Shipping is a practice. What\'s after this?' },
  ]},
]

const ALL_FIELD_IDS = SECTIONS.flatMap(s => s.fields.map(f => f.id))

// Map keywords in AI responses to section field IDs
interface InsertTarget {
  fieldId: string
  label: string
  content: string
}

function detectInsertTargets(text: string): InsertTarget[] {
  const targets: InsertTarget[] = []
  const lower = text.toLowerCase()

  // Detect numbered lists (milestones pattern)
  const numberedList = text.match(/(?:^|\n)\s*\d+[\.\)]\s+.+/gm)
  if (numberedList && numberedList.length >= 2) {
    const content = numberedList.map(l => l.replace(/^\s*/, '')).join('\n')
    if (lower.includes('milestone') || lower.includes('deliverable') || lower.includes('step') || lower.includes('phase')) {
      targets.push({ fieldId: 'milestones', label: 'Milestones', content })
    }
  }

  // Detect blockers
  if (lower.includes('blocker') || lower.includes('blocking') || lower.includes('stuck') || lower.includes('obstacle')) {
    const blockContent = extractRelevantContent(text, ['blocker', 'blocking', 'stuck', 'obstacle', 'waiting'])
    if (blockContent) targets.push({ fieldId: 'one-blocker', label: 'Top Blocker', content: blockContent })
  }

  // Detect waiting/dependencies
  if (lower.includes('waiting on') || lower.includes('depend') || lower.includes('need from')) {
    const waitContent = extractRelevantContent(text, ['waiting', 'depend', 'need from', 'require'])
    if (waitContent) targets.push({ fieldId: 'waiting', label: 'Waiting On', content: waitContent })
  }

  // Detect missing skills/resources
  if (lower.includes('missing') || lower.includes('gap') || lower.includes('lack') || lower.includes('skill')) {
    const missContent = extractRelevantContent(text, ['missing', 'gap', 'lack', 'skill', 'resource'])
    if (missContent) targets.push({ fieldId: 'missing', label: 'Missing Skills', content: missContent })
  }

  // Detect quick action / 30-min task
  if (lower.includes('30 minute') || lower.includes('right now') || lower.includes('quick win') || lower.includes('first step') || lower.includes('next 30')) {
    const quickContent = extractRelevantContent(text, ['30 minute', 'right now', 'quick win', 'first step', 'immediately', 'next 30'])
    if (quickContent) targets.push({ fieldId: '30min', label: '30-Min Action', content: quickContent })
  }

  // Detect scope cuts / thrashing
  if (lower.includes('cut') || lower.includes('scope') || lower.includes('nice-to-have') || lower.includes('simplify')) {
    const cutContent = extractRelevantContent(text, ['cut', 'scope', 'nice-to-have', 'simplify', 'drop', 'remove'])
    if (cutContent) targets.push({ fieldId: 'cut', label: 'Scope Cuts', content: cutContent })
  }

  // Detect decisions
  if (lower.includes('decision') || lower.includes('decide') || lower.includes('open question')) {
    const decContent = extractRelevantContent(text, ['decision', 'decide', 'open question', 'unanswered'])
    if (decContent) targets.push({ fieldId: 'decisions', label: 'Unmade Decisions', content: decContent })
  }

  // Fallback: if numbered list found but no specific match, offer milestones
  if (numberedList && numberedList.length >= 2 && targets.length === 0) {
    const content = numberedList.map(l => l.replace(/^\s*/, '')).join('\n')
    targets.push({ fieldId: 'milestones', label: 'Milestones', content })
  }

  return targets
}

// Extract the most relevant paragraph/sentences from AI text for a given topic
function extractRelevantContent(text: string, keywords: string[]): string {
  const sentences = text.split(/(?<=[.!?\n])\s+/)
  const relevant = sentences.filter(s => {
    const sl = s.toLowerCase()
    return keywords.some(k => sl.includes(k))
  })
  if (relevant.length > 0) return relevant.join(' ').trim()
  // Fallback: return bullet points or numbered items
  const bullets = text.match(/(?:^|\n)\s*[-*]\s+.+/gm)
  if (bullets) return bullets.map(b => b.trim()).join('\n')
  return ''
}

// Map /insert commands to field IDs
const INSERT_COMMANDS: Record<string, string> = {
  milestones: 'milestones',
  blockers: 'one-blocker',
  blocker: 'one-blocker',
  waiting: 'waiting',
  missing: 'missing',
  '30min': '30min',
  quickwin: '30min',
  scope: 'cut',
  decisions: 'decisions',
  what: 'what',
  who: 'who',
  why: 'why',
  fear: 'worst',
  announce: 'announce',
  next: 'next',
}

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning', color: '#9CA3AF' },
  { value: 'in-progress', label: 'In Progress', color: '#386797' },
  { value: 'blocked', label: 'Blocked', color: '#EA580C' },
  { value: 'shipped', label: 'Shipped!', color: '#10B981' },
]

const AI_SYSTEM = `You are a sharp, encouraging ShipIt coach embedded inside a project shipping journal inspired by Seth Godin's Linchpin and Shipping concepts. Your role is to help users overcome resistance, clarify their thinking, and actually ship.

Your personality: direct, warm, no-BS. You ask forward-facing questions that orient toward emerging possibilities, NEVER backward into past failures. You use motivational interviewing principles. You believe all behavior is adaptive, capacity over pathology.

When evaluating a user's journal:
- Identify what's strong and specific
- Call out vagueness with a kind challenge ("'A website' isn't something you can ship. What exactly are the deliverables?")
- Notice when fear is disguised as planning
- Suggest concrete next actions when things feel stuck
- Use "Name 3 things" structure when helpful
- Time-anchor questions to create urgency ("What can happen by Friday?")

Keep responses concise (2-4 sentences per point). Use plain language. No em dashes. No corporate jargon. Be the coach who sees through excuses but never shames.

When asked to evaluate the full journal, give a structured assessment covering: clarity score, shipping readiness, biggest risk, and one recommended action.`

const AI_HORMOZI = `You are an elite business strategist combining Alex Hormozi's value creation framework with Seth Godin's shipping mindset. You help users define irresistible offers and then ship them.

Your approach follows Hormozi's Value Equation: Value = (Dream Outcome x Perceived Likelihood of Achievement) / (Time Delay x Effort & Sacrifice)

CONVERSATION FLOW (guide the user through these in order, one at a time):

1. THE REAL PROBLEM: "What's the actual problem you're solving? Not the surface symptom, the root cause that keeps people up at night."
2. WHO HAS IT WORST: "Who experiences this problem most painfully? Be specific. Name the person. What's their day like?"
3. DREAM OUTCOME: "If this worked perfectly, what transformation would they experience? Not features. The before/after of their life."
4. THE GRAND SLAM OFFER: "What would make this so valuable they'd feel stupid saying no? What bonuses, guarantees, or urgency would stack the value?"
5. THE MECHANICS: "What's the actual work? Break it into concrete deliverables with deadlines."
6. WHAT COULD KILL IT: "What are the 3 things most likely to make this fail? Be honest."

RULES:
- Ask ONE question at a time. Wait for their answer before moving on.
- When they give a vague answer, push harder: "That's surface level. Go deeper. Why does THAT matter?"
- Use their answers to populate concrete milestones and blockers.
- After completing the interview, summarize into ShipIt journal sections.
- When summarizing, use numbered lists for milestones and bullet points for blockers.
- Keep responses to 2-4 sentences. Be direct. No fluff.
- Track which steps are complete. When the user seems ready, suggest: "Ready to populate your journal? I'll organize everything we discussed into your ShipIt sections."

You are not gentle. You are kind but relentless about clarity and specificity.`

function buildJournalText(meta: any, sections: Record<string, string>) {
  let text = `SHIPIT JOURNAL: ${meta.name || 'Untitled'}\nShip Date: ${meta.shipDate || 'Not set'}\nStatus: ${meta.status || 'planning'}\n`
  if (meta.description) text += `Vision: ${meta.description}\n`
  text += '\n'
  for (const sec of SECTIONS) {
    text += `[${sec.icon}] ${sec.title}\n`
    for (const f of sec.fields) {
      text += `  ${f.label}\n  > ${sections[f.id] || '(not yet filled in)'}\n\n`
    }
  }
  return text
}

export default function ShipItPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const supabase = createClient()
  const { createProjectFromShipIt } = useTaskData()

  const [projects, setProjects] = useState<any[]>([])
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [currentId, setCurrentId] = useState<string | null>(null)

  // Editor state
  const [meta, setMeta] = useState({ name: '', shipDate: '', description: '', status: 'planning' })
  const [sectionData, setSectionData] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(SECTIONS.map(s => s.id)))
  const [saving, setSaving] = useState(false)

  // Google Docs state
  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // AI Chat
  const [chatMsgs, setChatMsgs] = useState<Array<{ role: string; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [hormoziMode, setHormoziMode] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current?.scrollHeight || 0) }, [chatMsgs])

  // Google proxy helper
  const googleCall = async (action: string, payload: any = {}) => {
    if (!currentOrg) return null
    try {
      const res = await fetch('/api/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: currentOrg.id, action, ...payload }),
      })
      return await res.json()
    } catch { return null }
  }

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase.from('shipit_projects').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
    if (data) setProjects(data)
    setLoading(false)
  }, [currentOrg?.id])
  useEffect(() => { fetchProjects() }, [fetchProjects])

  // Open project
  const openProject = (id: string) => {
    const p = projects.find(x => x.id === id)
    if (!p) return
    setCurrentId(id)
    setMeta({ name: p.name || '', shipDate: p.ship_date || '', description: p.description || '', status: p.status || 'planning' })
    setSectionData(p.sections || {})
    setChatMsgs(p.chat_history || [])
    setDocUrl(p.doc_url || null)
    setDocId(p.doc_id || null)
    setFolderUrl(p.folder_url || null)
    setFolderId(p.folder_id || null)
    setLinkedProjectId(p.project_id || null)
    setExpanded(new Set(SECTIONS.map(s => s.id)))
    setSyncMsg('')
    setView('editor')
  }

  // New project
  const createProject = () => {
    setCurrentId(null)
    setMeta({ name: '', shipDate: '', description: '', status: 'planning' })
    setSectionData({})
    setChatMsgs([])
    setDocUrl(null); setDocId(null); setFolderUrl(null); setFolderId(null)
    setLinkedProjectId(null)
    setExpanded(new Set(SECTIONS.map(s => s.id)))
    setSyncMsg('')
    setView('editor')
  }

  // Create Task Manager project from ShipIt
  const handleCreateTaskProject = async () => {
    if (!currentId || !meta.name.trim()) return
    setCreatingProject(true)
    try {
      const result = await createProjectFromShipIt(
        currentId,
        meta.name,
        meta.description || null,
        meta.shipDate || null,
        sectionData
      )
      if (result.projectId) {
        setLinkedProjectId(result.projectId)
        // Update local projects list
        setProjects(prev => prev.map(p => p.id === currentId ? { ...p, project_id: result.projectId } : p))
        alert(`Project created with ${result.tasksCreated} tasks!`)
      }
    } catch (e) {
      console.error('Failed to create project:', e)
    }
    setCreatingProject(false)
  }

  // Save
  const saveProject = async () => {
    if (!meta.name.trim() || !meta.shipDate || !currentOrg) return
    setSaving(true)

    const payload: any = {
      org_id: currentOrg.id,
      name: meta.name.trim(),
      ship_date: meta.shipDate,
      description: meta.description,
      status: meta.status,
      sections: sectionData,
      chat_history: chatMsgs,
      doc_url: docUrl, doc_id: docId, folder_url: folderUrl, folder_id: folderId,
    }

    if (currentId) {
      await supabase.from('shipit_projects').update(payload).eq('id', currentId)
    } else {
      const { data } = await supabase.from('shipit_projects').insert(payload).select().single()
      if (data) setCurrentId(data.id)
    }
    await fetchProjects()
    setSaving(false)

    // Background sync to Google Doc (non-blocking)
    if (docId) {
      setSyncMsg('Syncing...')
      googleCall('updateShipitDoc', {
        docId, project: { name: meta.name, shipDate: meta.shipDate, description: meta.description, status: meta.status, sections: sectionData }
      }).then(r => {
        setSyncMsg(r?.success ? 'Synced to Doc' : '')
        setTimeout(() => setSyncMsg(''), 2500)
      })
    }
  }

  // Delete
  const deleteProject = async () => {
    if (!currentId || !confirm('Delete this ShipIt project?')) return
    await supabase.from('shipit_projects').delete().eq('id', currentId)
    await fetchProjects()
    setView('list')
  }

  // Back (auto-save)
  const goBack = async () => {
    if (meta.name.trim() && meta.shipDate) await saveProject()
    setView('list')
  }

  // ── GOOGLE DOCS ──

  // Export: create folder + doc or sync existing
  const handleExport = async () => {
    setExporting(true)

    // Scenario A: doc already linked
    if (docId) {
      const r = await googleCall('updateShipitDoc', {
        docId, project: { name: meta.name, shipDate: meta.shipDate, description: meta.description, status: meta.status, sections: sectionData }
      })
      setExporting(false)
      setShowExport(false)
      if (r?.success && docUrl) window.open(docUrl, '_blank')
      return
    }

    // Scenario B: Apps Script connected, create new
    const folderR = await googleCall('createFolder', { folderName: 'ShipIt - ' + meta.name, parentType: 'shipit' })
    if (folderR?.success) {
      setFolderId(folderR.folderId); setFolderUrl(folderR.folderUrl)

      const docR = await googleCall('createDoc', { docName: 'ShipIt Journal - ' + meta.name, folderId: folderR.folderId, template: 'shipit' })
      if (docR?.success) {
        setDocId(docR.docId); setDocUrl(docR.docUrl)

        // Push content
        await googleCall('updateShipitDoc', {
          docId: docR.docId, project: { name: meta.name, shipDate: meta.shipDate, description: meta.description, status: meta.status, sections: sectionData }
        })

        // Save doc/folder refs to Supabase
        if (currentId) {
          await supabase.from('shipit_projects').update({
            doc_url: docR.docUrl, doc_id: docR.docId,
            folder_url: folderR.folderUrl, folder_id: folderR.folderId,
          }).eq('id', currentId)
        }

        setExporting(false); setShowExport(false)
        window.open(docR.docUrl, '_blank')
        return
      }
    }

    // Scenario C: Fallback HTML download
    setExporting(false); setShowExport(false)
    exportHTML()
  }

  // Sync from Doc (pull changes back)
  const syncFromDoc = async () => {
    if (!docId) return
    setSyncing(true)
    const r = await googleCall('getShipitDocContent', { docId })
    if (r?.success && r.sections) {
      const merged = { ...sectionData }
      Object.entries(r.sections).forEach(([k, v]) => { if (v) merged[k] = v as string })
      setSectionData(merged)
      setSyncMsg('Pulled from Doc!')
      setTimeout(() => setSyncMsg(''), 2500)
    } else {
      setSyncMsg('Sync failed')
      setTimeout(() => setSyncMsg(''), 2500)
    }
    setSyncing(false)
  }

  // HTML fallback export
  const exportHTML = () => {
    let html = `<h1 style="color:#386797">ShipIt Journal: ${meta.name || 'Untitled'}</h1>`
    html += `<p><strong>Ship Date:</strong> ${meta.shipDate} | <strong>Status:</strong> ${meta.status}</p>`
    if (meta.description) html += `<p><em>${meta.description}</em></p><hr/>`
    for (const sec of SECTIONS) {
      html += `<h2 style="color:#386797">${sec.icon}. ${sec.title}</h2>`
      for (const f of sec.fields) {
        html += `<h3>${f.label}</h3><p style="white-space:pre-wrap">${sectionData[f.id] || '<em style="color:#999">Not yet filled in</em>'}</p>`
      }
    }
    const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ShipIt - ${meta.name}</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:20px;color:#333;line-height:1.7}h1{color:#386797;border-bottom:3px solid #386797;padding-bottom:8px}h2{color:#386797;margin-top:32px}</style></head><body>${html}</body></html>`], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ShipIt-${meta.name || 'Untitled'}.html`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── AI ──

  const askAISection = (section: any) => {
    const filled = section.fields.some((f: any) => sectionData[f.id]?.trim())
    const prompt = filled
      ? `Evaluate my "${section.title}" section. Is it specific enough? What's missing?`
      : `Help me think through the "${section.title}" section. What should I consider?`
    sendChatMsg(prompt)
  }

  const sendChatMsg = async (msg: string) => {
    if (!msg.trim() || aiLoading) return
    const newMsgs = [...chatMsgs, { role: 'user', content: msg.trim() }]
    setChatMsgs(newMsgs)
    setChatInput('')
    setAiLoading(true)

    const journalContext = buildJournalText(meta, sectionData)
    const apiMessages = [
      { role: 'user', content: `Here is the current state of my ShipIt Journal:\n\n${journalContext}\n\n---\n\nNow here is my question:` },
      { role: 'assistant', content: "Got it. I've reviewed your journal. What would you like to work on?" },
      ...newMsgs,
    ]

    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, campaignContext: { type: 'shipit_coach', systemOverride: hormoziMode ? AI_HORMOZI : AI_SYSTEM } }),
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { content: 'Connection error. Please try again.' } }
      const reply = data.content || data.error || 'No response.'
      setChatMsgs([...newMsgs, { role: 'assistant', content: reply.replace(/\*\*/g, '').replace(/\u2014/g, ', ').replace(/\u2013/g, ', ') }])
    } catch {
      setChatMsgs([...newMsgs, { role: 'assistant', content: 'Connection error. Check that your API key is configured.' }])
    }
    setAiLoading(false)
  }

  const sendChat = async () => {
    // Handle /insert commands
    const insertMatch = chatInput.trim().match(/^\/insert\s+(\w+)/i)
    if (insertMatch) {
      const key = insertMatch[1].toLowerCase()
      const fieldId = INSERT_COMMANDS[key]
      if (fieldId && chatMsgs.length > 0) {
        const lastAi = [...chatMsgs].reverse().find(m => m.role === 'assistant')
        if (lastAi) {
          handleInsertContent(fieldId, lastAi.content)
          setChatInput('')
          return
        }
      }
      setChatInput('')
      setChatMsgs(prev => [...prev, { role: 'user', content: chatInput.trim() }, { role: 'assistant', content: `Unknown insert target "${key}". Try: milestones, blockers, waiting, missing, 30min, scope, decisions` }])
      return
    }
    await sendChatMsg(chatInput)
  }

  // Insert AI content into a section field
  const [insertSuccess, setInsertSuccess] = useState<string | null>(null)
  const handleInsertContent = (fieldId: string, content: string) => {
    const existing = sectionData[fieldId] || ''
    const newContent = existing ? `${existing}\n\n${content}` : content
    setSectionData(prev => ({ ...prev, [fieldId]: newContent }))
    // Find the section and field label for the success message
    const field = SECTIONS.flatMap(s => s.fields).find(f => f.id === fieldId)
    setInsertSuccess(`Inserted into "${field?.label || fieldId}"`)
    setTimeout(() => setInsertSuccess(null), 2000)
    // Auto-expand the section containing this field
    const section = SECTIONS.find(s => s.fields.some(f => f.id === fieldId))
    if (section) setExpanded(prev => { const n = new Set(prev); n.add(section.id); return n })
  }

  const toggleSection = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const filledCount = ALL_FIELD_IDS.filter(id => sectionData[id]?.trim()).length
  const progress = Math.round((filledCount / ALL_FIELD_IDS.length) * 100)

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  // ── LIST VIEW ──
  if (view === 'list') return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2"><Rocket className="w-5 h-5" /> ShipIt Journal</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">Ship projects. Name fears. Cut thrash. Get it done.</p>
        </div>
        <button onClick={createProject} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> New ShipIt
        </button>
      </div>

      {loading ? <div className="text-center py-8 text-gray-400 text-sm">Loading...</div> :
       projects.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <div className="w-16 h-16 rounded-full bg-np-blue/10 flex items-center justify-center mx-auto mb-4"><Rocket className="w-7 h-7 text-np-blue" /></div>
          <h2 className="text-lg font-semibold text-np-dark mb-2">Ready to Ship Something?</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">The ShipIt Journal helps you identify what's blocking your project, name the fear, cut the thrash, and actually get it done.</p>
          <button onClick={createProject} className="bg-np-blue text-white text-sm py-2.5 px-5 rounded-lg font-medium">Start Your First ShipIt</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map(p => {
            const filled = ALL_FIELD_IDS.filter(id => (p.sections || {})[id]?.trim()).length
            const prog = Math.round((filled / ALL_FIELD_IDS.length) * 100)
            const st = STATUS_OPTIONS.find(s => s.value === p.status) || STATUS_OPTIONS[0]
            const days = p.ship_date ? Math.ceil((new Date(p.ship_date).getTime() - Date.now()) / 86400000) : null
            return (
              <div key={p.id} onClick={() => openProject(p.id)}
                className="bg-white border border-gray-100 rounded-xl p-4 cursor-pointer hover:shadow-md transition-all"
                style={{ borderLeftWidth: 3, borderLeftColor: st.color }}>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-bold text-np-dark">{p.name || 'Untitled'}</h3>
                  <div className="flex items-center gap-1.5">
                    {p.project_id && (
                      <span className="text-[9px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Kanban className="w-2.5 h-2.5" /> Linked
                      </span>
                    )}
                    <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style={{ backgroundColor: st.color + '18', color: st.color }}>{st.label}</span>
                  </div>
                </div>
                {p.description && <p className="text-[11px] text-gray-500 truncate mb-2">{p.description}</p>}
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-2">
                  {days !== null && <span className={days < 0 ? 'text-red-500 font-bold' : days <= 3 ? 'text-orange-500 font-bold' : ''}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Ship TODAY' : `${days}d left`}</span>}
                  <span className="flex items-center gap-1.5">
                    {p.doc_id && <FileText className="w-3 h-3 text-green-500" />}
                    {filled}/{ALL_FIELD_IDS.length} fields
                  </span>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${prog}%`, backgroundColor: st.color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── EDITOR VIEW ──
  return (
    <div className="h-[calc(100vh-72px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-gray-400 hover:text-np-dark"><ArrowLeft className="w-4 h-4" /></button>
          <h1 className="text-base font-semibold text-np-dark">{currentId ? meta.name || 'ShipIt' : 'New ShipIt'}</h1>
          <span className="text-[10px] bg-np-blue/10 text-np-blue px-2 py-0.5 rounded font-bold">{progress}%</span>
          {syncMsg && <span className="text-[9px] text-green-600 bg-green-50 px-2 py-0.5 rounded font-medium">{syncMsg}</span>}
        </div>
        <div className="flex items-center gap-2">
          {docId && (
            <button onClick={syncFromDoc} disabled={syncing}
              className="text-[10px] font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1 disabled:opacity-50">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sync from Doc
            </button>
          )}
          <button onClick={() => setShowExport(true)} className="text-[10px] font-medium text-gray-500 hover:text-np-blue flex items-center gap-1">
            <Download className="w-3 h-3" /> {docId ? 'Sync to Doc' : 'Export'}
          </button>
          {currentId && !linkedProjectId && (
            <button onClick={handleCreateTaskProject} disabled={creatingProject || !meta.name.trim()}
              className="text-[10px] font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2 py-1.5 rounded-lg border border-emerald-200 disabled:opacity-40">
              {creatingProject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Kanban className="w-3 h-3" />} Create Project
            </button>
          )}
          {linkedProjectId && (
            <Link href={`/tasks?project=${linkedProjectId}`}
              className="text-[10px] font-medium text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-1.5 rounded-lg border border-emerald-200 hover:bg-emerald-100">
              <Kanban className="w-3 h-3" /> View Project
            </Link>
          )}
          {currentId && <button onClick={deleteProject} className="text-[10px] font-medium text-gray-400 hover:text-red-500 flex items-center gap-1"><Trash2 className="w-3 h-3" /></button>}
          <button onClick={saveProject} disabled={saving || !meta.name.trim() || !meta.shipDate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-np-blue text-white rounded-lg text-[10px] font-bold disabled:opacity-40">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Save
          </button>
        </div>
      </div>

      {/* Quick Links Bar */}
      {(docUrl || folderUrl) && (
        <div className="flex items-center gap-3 mb-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
          <span className="text-[9px] font-bold text-blue-500 uppercase">Linked:</span>
          {docUrl && (
            <a href={docUrl} target="_blank" rel="noopener" className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
              <FileText className="w-3 h-3" /> Google Doc <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {folderUrl && (
            <a href={folderUrl} target="_blank" rel="noopener" className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
              <FolderOpen className="w-3 h-3" /> Drive Folder <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <span className="text-[9px] text-gray-400 ml-auto">Edit the Doc directly, then use Sync from Doc to pull changes back</span>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setShowExport(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-[440px]">
            <h3 className="text-base font-bold text-np-dark mb-2">
              {docId ? 'Sync to Google Doc' : 'Export to Google Docs'}
            </h3>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              {docId
                ? 'This project is linked to a Google Doc. Exporting will update it with your latest changes and open it.'
                : 'This will create a Google Doc and project folder in your Drive, then sync your journal content.'}
            </p>

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-4 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${docId ? 'bg-green-500' : 'bg-green-500'}`} />
              <span className="text-[10px] text-gray-600">
                {docId ? 'Linked to existing Google Doc' : 'Google Drive connected via Apps Script'}
              </span>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-4 text-[10px] text-gray-500 leading-relaxed">
              <p className="font-bold text-gray-600 mb-1">What gets exported:</p>
              <p>&#10003; Project details and ship date</p>
              <p>&#10003; All 6 journal sections with your answers</p>
              <p>&#10003; Formatted with Neuro Progeny branding</p>
              <p>&#10003; Synced to Google Drive</p>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowExport(false)} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { exportHTML(); setShowExport(false) }} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                Download HTML
              </button>
              <button onClick={handleExport} disabled={exporting}
                className="text-xs font-bold text-white bg-np-blue px-4 py-1.5 rounded-lg hover:bg-np-blue/90 disabled:opacity-50 flex items-center gap-1.5">
                {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                {docId ? 'Sync & Open' : 'Create Google Doc'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Split layout */}
      <div className="flex-1 grid grid-cols-[1fr_340px] gap-3 min-h-0">
        {/* LEFT: Form */}
        <div className="overflow-y-auto space-y-3 pr-1">
          {/* Meta bar */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Project Name *</label>
                <input value={meta.name} onChange={e => setMeta(p => ({ ...p, name: e.target.value }))}
                  placeholder="What are you shipping?" className="w-full text-sm font-semibold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Ship Date *</label>
                <input type="date" value={meta.shipDate} onChange={e => setMeta(p => ({ ...p, shipDate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Vision</label>
                <input value={meta.description} onChange={e => setMeta(p => ({ ...p, description: e.target.value }))}
                  placeholder="One sentence: what does success look like?" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Status</label>
                <select value={meta.status} onChange={e => setMeta(p => ({ ...p, status: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Sections */}
          {SECTIONS.map(sec => {
            const isOpen = expanded.has(sec.id)
            return (
              <div key={sec.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <button onClick={() => toggleSection(sec.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-mono font-bold bg-np-blue/10 text-np-blue px-1.5 py-0.5 rounded">{sec.icon}</span>
                    <span className="text-sm font-semibold text-np-dark">{sec.title}</span>
                  </div>
                  {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-3">
                    {sec.subtitle && <p className="text-[11px] text-gray-400 italic">{sec.subtitle}</p>}
                    {sec.fields.map(f => (
                      <div key={f.id}>
                        <label className="text-[11px] font-medium text-gray-500 block mb-1">{f.label}</label>
                        <textarea value={sectionData[f.id] || ''} onChange={e => setSectionData(p => ({ ...p, [f.id]: e.target.value }))}
                          placeholder={f.placeholder} rows={(f as any).rows || 2}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 resize-vertical" />
                      </div>
                    ))}
                    <button onClick={() => askAISection(sec)}
                      className="flex items-center gap-1.5 text-[10px] font-medium text-teal-600 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5 hover:bg-teal-100 transition-colors">
                      <Sparkles className="w-3 h-3" /> Ask AI about this section
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* RIGHT: AI Coach */}
        <div className="bg-white border border-gray-100 rounded-xl flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center ${hormoziMode ? 'bg-gradient-to-br from-orange-500 to-red-500' : 'bg-gradient-to-br from-teal-500 to-np-blue'}`}>
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-np-dark">{hormoziMode ? 'Hormozi Mode' : 'ShipIt Coach'}</div>
              <div className="text-[9px] text-gray-400">{hormoziMode ? 'Value equation + deep problem definition' : 'AI assistant to help you ship'}</div>
            </div>
            <button onClick={() => { setHormoziMode(!hormoziMode); if (!hormoziMode && chatMsgs.length === 0) setChatInput("Let's define this project using the Hormozi framework") }}
              className={`px-2 py-1 text-[9px] font-bold rounded-md border transition-colors ${
                hormoziMode ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-orange-50 hover:text-orange-500 hover:border-orange-200'
              }`}>
              {hormoziMode ? 'Hormozi ON' : 'Hormozi'}
            </button>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
            {chatMsgs.length === 0 && (
              <div className="text-center py-8 px-3">
                <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-3">
                  <Sparkles className="w-5 h-5 text-teal-500" />
                </div>
                <p className="text-xs text-gray-500 mb-1">I'm your ShipIt coach.</p>
                <p className="text-[10px] text-gray-400 mb-4">Fill in your journal and I'll help you sharpen your thinking and get this thing shipped.</p>
                <div className="space-y-1.5">
                  {(hormoziMode
                    ? ["Let's define this project using the Hormozi framework", "What's the REAL problem I'm solving?", "Help me build a Grand Slam offer", "Who has this problem the worst?"]
                    : ['Evaluate my full journal', "What's my biggest shipping risk?", 'Help me clarify my project scope', 'Am I thrashing or making progress?']
                  ).map(q => (
                    <button key={q} onClick={() => setChatInput(q)}
                      className="w-full text-left text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:bg-np-blue/5 hover:border-np-blue/20 hover:text-np-blue transition-all">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMsgs.map((msg, i) => {
              const targets = msg.role === 'assistant' ? detectInsertTargets(msg.content) : []
              return (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[88%] px-3 py-2 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user' ? 'bg-np-blue text-white rounded-br-sm' : 'bg-gray-50 border border-gray-100 text-gray-700 rounded-bl-sm'
                  }`}>{msg.content}</div>
                  {targets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 ml-1">
                      {targets.map((t, ti) => (
                        <button key={ti} onClick={() => handleInsertContent(t.fieldId, t.content)}
                          className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium bg-teal-50 text-teal-600 border border-teal-200 rounded-md hover:bg-teal-100 transition-colors">
                          <ClipboardPaste className="w-2.5 h-2.5" /> Insert → {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {aiLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 text-teal-500 animate-spin" />
                  <span className="text-[10px] text-gray-400">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* Success indicator */}
          {insertSuccess && (
            <div className="mx-3 mb-1 px-3 py-1.5 bg-teal-50 text-teal-600 text-[10px] font-medium rounded-lg flex items-center gap-1.5">
              <Check className="w-3 h-3" /> {insertSuccess}
            </div>
          )}
          <div className="px-3 py-2.5 border-t border-gray-100">
            <div className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder="Ask about your project... or /insert milestones"
                className="flex-1 text-[11px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/20 placeholder-gray-300" />
              <button onClick={sendChat} disabled={aiLoading || !chatInput.trim()}
                className="px-3 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-40">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            {chatMsgs.some(m => m.role === 'assistant') && (
              <p className="text-[9px] text-gray-400 mt-1.5 px-1">
                Type <span className="font-mono bg-gray-100 px-1 rounded">/insert milestones</span> to insert last AI response into a section
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
