'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection } from '@/lib/types/meetings'
import {
  ChevronLeft, Clock, Save, Upload, Check, Loader2, Target,
  Trash2, AlertTriangle, Sparkles, FileText, Video, X,
  Brain, TrendingUp, AlertCircle, Users, Calendar,
  Play, Pause, Plus, CheckCircle2, XCircle, CalendarClock, ListTodo, Zap, ChevronDown, ChevronRight, Download, Edit2
} from 'lucide-react'

export default function MeetingDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { currentOrg } = useWorkspace()
  const { rocks } = useRockData()
  const { members } = useTeamData()
  const teamMembers = members.filter(m => m.status === 'active').map(m => m.display_name)
  const supabase = createClient()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'agenda' | 'notes' | 'read_ai' | 'ids' | 'task_review' | 'ai_advisor'>('agenda')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [rockReviews, setRockReviews] = useState<Record<string, string>>({})

  // Timer state
  const [activeTimerIdx, setActiveTimerIdx]   = useState<number | null>(null)
  const [sectionTimes, setSectionTimes]       = useState<Record<number, number>>({})
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // IDS capture state
  const [idsInput, setIdsInput]       = useState('')
  const [idsType, setIdsType]         = useState<'issue'|'decision'|'solution'>('issue')
  const [idsOwner, setIdsOwner]       = useState('')
  const [showIdsForm, setShowIdsForm] = useState(false)

  // Action item capture state
  const [taskInput, setTaskInput]         = useState('')
  const [taskOwner, setTaskOwner]         = useState('')
  const [taskRaciR, setTaskRaciR]         = useState('')
  const [taskRaciA, setTaskRaciA]         = useState('')
  const [taskDesc, setTaskDesc]           = useState('')
  const [taskSubtasks, setTaskSubtasks]   = useState<string[]>([])
  const [showTaskForm, setShowTaskForm]   = useState(false)
  const [taskPriority, setTaskPriority]   = useState<'low'|'medium'|'high'|'urgent'>('medium')
  const [deferDates, setDeferDates]       = useState<Record<string, string>>({})
  const [taskLoading, setTaskLoading]     = useState<Record<string, boolean>>({})
  const [taskDueDate, setTaskDueDate]     = useState('')
  const [expandedSection, setExpandedSection] = useState<number | null>(null)
  const [editingTime, setEditingTime]         = useState(false)
  const [editTimeVal, setEditTimeVal]         = useState('')
  const [editDuration, setEditDuration]       = useState('')
  const [addingSection, setAddingSection]     = useState(false)
  const [newSectionName, setNewSectionName]   = useState('')
  const [newSectionMins, setNewSectionMins]   = useState('10')
  const [editingTitle, setEditingTitle]       = useState(false)
  const [editTitleVal, setEditTitleVal]       = useState('')
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null)
  const [editSectionName, setEditSectionName] = useState('')
  const [editSectionMins, setEditSectionMins] = useState('')
  const [sectionNotes, setSectionNotes]       = useState<Record<number, string>>({})
  const agendaUploadRef = useRef<HTMLInputElement>(null)
  const [agendaUploading, setAgendaUploading] = useState(false)
  const [showAiAgendaBuilder, setShowAiAgendaBuilder] = useState(false)
  const [aiAgendaPrompt, setAiAgendaPrompt]   = useState('')
  const [aiAgendaLoading, setAiAgendaLoading] = useState(false)
  const [gdocLoading, setGdocLoading]         = useState(false)
  const [gdocUrl, setGdocUrl]                 = useState<string | null>(null)
  const [gdocError, setGdocError]             = useState('')
  const [showGdocPanel, setShowGdocPanel]     = useState(false)
  const [gdocAiDesc, setGdocAiDesc]           = useState('')
  const [gdocUseAi, setGdocUseAi]             = useState(false)

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Read AI upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // AI Advisor state
  const [aiIssue, setAiIssue] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<any>(null)
  const [aiError, setAiError] = useState('')
  const [aiMetrics, setAiMetrics] = useState<any>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)

    const { data: m } = await supabase.from('meetings').select('*').eq('id', id).single()
    if (m) {
      setMeeting(m)
      setNotes(m.notes || '')
    }

    const { data: att } = await supabase
      .from('meeting_attendees')
      .select('*, team_profiles:user_id(display_name)')
      .eq('meeting_id', id)

    if (att) {
      setAttendees(att.map((a: any) => ({
        ...a,
        display_name: a.team_profiles?.display_name || 'Unknown',
      })))
    }

    const { data: reviews } = await supabase
      .from('meeting_rock_reviews')
      .select('*')
      .eq('meeting_id', id)

    if (reviews) {
      const map: Record<string, string> = {}
      reviews.forEach((r: any) => { map[r.rock_id] = r.status_at_review || '' })
      setRockReviews(map)
    }

    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const saveNotes = async () => {
    if (!meeting) return
    setSaving(true)
    await supabase.from('meetings').update({ notes, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    setSaving(false)
  }

  const toggleAgendaItem = async (index: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[index] = { ...agenda[index], completed: !agenda[index].completed }
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const updateMeetingStatus = async (status: string) => {
    if (!meeting) return
    setMeeting({ ...meeting, status: status as any })
    await supabase.from('meetings').update({ status, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const saveRockReview = async (rockId: string, status: string) => {
    if (!meeting) return
    setRockReviews(prev => ({ ...prev, [rockId]: status }))
    await supabase.from('meeting_rock_reviews').upsert({
      meeting_id: meeting.id, rock_id: rockId, status_at_review: status,
    }, { onConflict: 'meeting_id,rock_id' })
  }

  // ═══ CREATE GOOGLE DOC ═══
  const createGoogleDoc = async (useAi = false) => {
    if (!meeting || !currentOrg) return
    setGdocLoading(true)
    setGdocError('')
    try {
      const res = await fetch('/api/meetings/create-gdoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          meeting_id: meeting.id,
          use_ai: useAi,
          ai_description: gdocAiDesc,
        }),
      })
      const data = await res.json()
      if (data.needs_auth) {
        setGdocError('Google Drive not connected. Go to Settings → Integrations to connect.')
        return
      }
      if (!res.ok || !data.url) throw new Error(data.error || 'Failed to create doc')
      setGdocUrl(data.url)
      if (data.sections_saved > 0) await load()
      window.open(data.url, '_blank')
    } catch (e: any) {
      setGdocError(e.message)
    } finally {
      setGdocLoading(false)
    }
  }

  // ═══ TITLE EDIT ═══
  const saveTitle = async () => {
    if (!meeting || !editTitleVal.trim()) return
    setMeeting({ ...meeting, title: editTitleVal.trim() })
    await supabase.from('meetings').update({ title: editTitleVal.trim(), updated_at: new Date().toISOString() }).eq('id', meeting.id)
    setEditingTitle(false)
  }

  // ═══ SECTION EDIT / REMOVE ═══
  const saveSectionEdit = async (idx: number) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[idx] = {
      ...agenda[idx],
      section: editSectionName.trim() || agenda[idx].section,
      duration_min: parseInt(editSectionMins) || agenda[idx].duration_min,
    }
    setMeeting({ ...meeting, agenda })
    setEditingSectionIdx(null)
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const removeSection = async (idx: number) => {
    if (!meeting) return
    const agenda = (meeting.agenda || []).filter((_: any, i: number) => i !== idx)
    setMeeting({ ...meeting, agenda })
    if (expandedSection === idx) setExpandedSection(null)
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ═══ MEETING TIME EDIT ═══
  const saveMeetingTime = async () => {
    if (!meeting) return
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (editTimeVal) updates.scheduled_at = new Date(editTimeVal).toISOString()
    if (editDuration) updates.duration_minutes = parseInt(editDuration) || meeting.duration_minutes
    setMeeting({ ...meeting, ...updates, scheduled_at: updates.scheduled_at || meeting.scheduled_at, duration_minutes: updates.duration_minutes || meeting.duration_minutes })
    await supabase.from('meetings').update(updates).eq('id', meeting.id)
    setEditingTime(false)
  }

  // ═══ ADD AGENDA SECTION ON THE FLY ═══
  const addAgendaSection = async () => {
    if (!meeting || !newSectionName.trim()) return
    const newSection = {
      section: newSectionName.trim(),
      duration_min: parseInt(newSectionMins) || 10,
      notes: '',
      completed: false,
      prompts: [],
      talking_points: [],
    }
    const updated = [...(meeting.agenda || []), newSection]
    setMeeting({ ...meeting, agenda: updated })
    setNewSectionName('')
    setNewSectionMins('10')
    setAddingSection(false)
    await supabase.from('meetings').update({ agenda: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ═══ AGENDA SECTION NOTES ═══
  const saveSectionNote = async (idx: number, note: string) => {
    if (!meeting) return
    const agenda = [...(meeting.agenda || [])]
    agenda[idx] = { ...agenda[idx], notes: note }
    setMeeting({ ...meeting, agenda })
    await supabase.from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ═══ AGENDA UPLOAD ═══
  const handleAgendaUpload = async (file: File) => {
    setAgendaUploading(true)
    try {
      const text = await file.text()
      let sections: any[] = []
      if (file.name.endsWith('.json')) {
        const raw = JSON.parse(text)
        const items = Array.isArray(raw) ? raw : (raw.agenda || raw.sections || [])
        sections = items.map((item: any) => ({
          section: item.section || item.title || item.name || 'Untitled',
          duration_min: item.duration_min || item.duration || item.minutes || 10,
          notes: item.notes || item.description || '',
          completed: false,
          prompts: item.prompts || item.talking_points || [],
          talking_points: item.talking_points || item.prompts || [],
        }))
      } else {
        // Plain text / CSV — each line is a section
        const lines = text.split('\n').filter(l => l.trim())
        const dataLines = lines[0]?.toLowerCase().includes('section') ? lines.slice(1) : lines
        sections = dataLines.map(line => {
          // Handle quoted CSV fields
          const parts = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(p => p.replace(/^"|"$/g,'').replace(/""/g,'"').trim()) || line.split(',').map(s=>s.trim())
          const name = parts[0] || line.trim()
          const mins = parseInt(parts[1]) || 10
          const promptsRaw = parts[2] || ''
          const prompts = promptsRaw ? promptsRaw.split(';').map(p=>p.trim()).filter(Boolean) : []
          const notes = parts[3] || ''
          return { section: name, duration_min: mins, notes, completed: false, prompts, talking_points: [] }
        }).filter(s => s.section)
      }
      if (sections.length === 0) { alert('No sections found in file'); return }
      if (!meeting) return
      setMeeting({ ...meeting, agenda: sections })
      await supabase.from('meetings').update({ agenda: sections, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    } catch (e: any) {
      alert('Upload error: ' + e.message)
    } finally {
      setAgendaUploading(false)
    }
  }

  // ═══ DOWNLOAD AGENDA TEMPLATE ═══
  const downloadAgendaTemplate = () => {
    // Download blank template docx
    const a = document.createElement('a')
    a.href = '/api/meetings/agenda-template'
    a.download = 'agenda-template.docx'
    a.click()
  }

  const downloadFilledAgenda = () => {
    // Download this meeting's agenda as a filled docx
    if (!meeting) return
    const a = document.createElement('a')
    a.href = `/api/meetings/agenda-template?meeting_id=${meeting.id}`
    a.download = `${meeting.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-agenda.docx`
    a.click()
  }

  // ═══ AI AGENDA BUILDER ═══
  const buildAiAgenda = async () => {
    if (!meeting || !aiAgendaPrompt.trim()) return
    setAiAgendaLoading(true)
    try {
      const res = await fetch('/api/ai/agenda-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_title: meeting.title,
          meeting_template: meeting.template,
          duration_minutes: meeting.duration_minutes,
          description: aiAgendaPrompt,
        }),
      })
      const data = await res.json()
      if (data.agenda && Array.isArray(data.agenda)) {
        setMeeting({ ...meeting, agenda: data.agenda })
        await supabase.from('meetings').update({ agenda: data.agenda, updated_at: new Date().toISOString() }).eq('id', meeting.id)
        setShowAiAgendaBuilder(false)
        setAiAgendaPrompt('')
      }
    } catch (e: any) {
      alert('AI error: ' + e.message)
    } finally {
      setAiAgendaLoading(false)
    }
  }

  // ═══ TIMER ═══
  const startTimer = (idx: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setActiveTimerIdx(idx)
    timerRef.current = setInterval(() => {
      setSectionTimes(prev => ({ ...prev, [idx]: (prev[idx] || 0) + 1 }))
    }, 1000)
  }

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setActiveTimerIdx(null)
  }

  const toggleTimer = (idx: number) => {
    if (activeTimerIdx === idx) { stopTimer() } else { startTimer(idx) }
  }

  const fmtTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current) } }, [])

  // ═══ IDS ═══
  const addIdsItem = async () => {
    if (!meeting || !idsInput.trim()) return
    const newItem: any = {
      id: crypto.randomUUID(),
      issue_category: idsType,
      description: idsInput.trim(),
      owner_name: idsOwner,
      owner: '',
      status: 'identified',
      resolution: '',
      decisions_needed: '',
      action_items_text: '',
      dependencies_context: '',
      due_date: '',
      created_at: new Date().toISOString(),
    }
    const updated = [...(meeting.ids_items || []), newItem]
    setMeeting({ ...meeting, ids_items: updated })
    setIdsInput('')
    setIdsOwner('')
    setShowIdsForm(false)
    await supabase.from('meetings').update({ ids_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const removeIdsItem = async (id: string) => {
    if (!meeting) return
    const updated = (meeting.ids_items || []).filter((i: any) => i.id !== id)
    setMeeting({ ...meeting, ids_items: updated })
    await supabase.from('meetings').update({ ids_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ═══ ACTION ITEMS / TASK CAPTURE ═══
  const addActionItem = async () => {
    if (!meeting || !taskInput.trim()) return
    const newItem: any = {
      id: crypto.randomUUID(),
      title: taskInput.trim(),
      description: taskDesc,
      owner: '',
      owner_name: taskOwner,
      due_date: taskDueDate,
      status: 'pending',
      task_id: null,
      priority: taskPriority,
      raci_responsible: taskRaciR,
      raci_accountable: taskRaciA,
      raci_consulted: '',
      raci_informed: '',
      subtasks: taskSubtasks.filter(s => s.trim()),
      task_column: '',
    }
    const updated = [...((meeting.action_items || []) as any[]), newItem]
    setMeeting({ ...meeting, action_items: updated as any })
    setTaskInput('')
    setTaskDesc('')
    setTaskOwner('')
    setTaskRaciR('')
    setTaskRaciA('')
    setTaskSubtasks([])
    setTaskDueDate('')
    setShowTaskForm(false)
    await supabase.from('meetings').update({ action_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const approveTask = async (item: any) => {
    if (!meeting || !currentOrg) return
    setTaskLoading(prev => ({ ...prev, [item.id]: true }))
    try {
      // Get first kanban column for org
      const { data: cols } = await supabase.from('kanban_columns').select('id').eq('org_id', currentOrg.id).order('sort_order').limit(1)
      const colId = cols?.[0]?.id
      if (!colId) { alert('No task columns found. Create a column in Task Manager first.'); return }

      // Create kanban task
      const { data: task } = await supabase.from('kanban_tasks').insert({
        org_id: currentOrg.id,
        column_id: colId,
        title: item.title,
        description: item.description || null,
        assignee: item.owner_name || null,
        owner_id: null,
        priority: item.priority || 'medium',
        due_date: item.due_date || null,
        raci_responsible: item.raci_responsible || null,
        raci_accountable: item.raci_accountable || null,
        raci_consulted: item.raci_consulted ? [item.raci_consulted] : [],
        raci_informed: item.raci_informed ? [item.raci_informed] : [],
        source: 'meeting',
        sort_order: 9999,
        visibility: 'everyone',
        custom_fields: { meeting_id: meeting.id, meeting_title: meeting.title },
        rock_tags: [],
        depends_on: [],
        blocked_by: [],
        ai_generated: false,
        milestone: false,
      }).select().single()

      // Create subtasks if any
      if (task && item.subtasks?.length > 0) {
        await supabase.from('subtasks').insert(
          item.subtasks.map((s: string, i: number) => ({
            task_id: task.id, org_id: currentOrg.id, title: s, completed: false, sort_order: i,
          }))
        )
      }

      // Update action item status
      const updated = (meeting.action_items || []).map((a: any) =>
        a.id === item.id ? { ...a, status: 'approved', task_id: task?.id || null } : a
      )
      setMeeting({ ...meeting, action_items: updated as any })
      await supabase.from('meetings').update({ action_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
    } finally {
      setTaskLoading(prev => ({ ...prev, [item.id]: false }))
    }
  }

  const rejectTask = async (id: string) => {
    if (!meeting) return
    const updated = (meeting.action_items || []).map((a: any) => a.id === id ? { ...a, status: 'deleted' } : a)
    setMeeting({ ...meeting, action_items: updated as any })
    await supabase.from('meetings').update({ action_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  const deferTask = async (item: any) => {
    if (!meeting) return
    const deferDate = deferDates[item.id]
    if (!deferDate) { alert('Please set a revisit date before deferring.'); return }

    // If there's a next meeting in chain, migrate there
    const nextId = (meeting as any).next_meeting_id as string | null
    if (nextId) {
      const { data: nm } = await supabase.from('meetings').select('action_items').eq('id', nextId).single()
      if (nm) {
        const existing = ((nm as any).action_items || []) as any[]
        const alreadyThere = existing.some((a: any) => a.id === item.id)
        if (!alreadyThere) {
          await supabase.from('meetings').update({
            action_items: [...existing, { ...item, status: 'pending', deferred_from: meeting.id, defer_revisit_date: deferDate }],
            updated_at: new Date().toISOString(),
          }).eq('id', nextId)
        }
      }
    }

    const updated = (meeting.action_items || []).map((a: any) =>
      a.id === item.id ? { ...a, status: 'deferred', defer_revisit_date: deferDate } : a
    )
    setMeeting({ ...meeting, action_items: updated as any })
    await supabase.from('meetings').update({ action_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
  }

  // ═══ DELETE — chain-aware ═══
  const handleDeleteMeeting = async () => {
    if (!meeting) return
    setIsDeleting(true)

    // Read chain pointers (these columns may not exist yet — that's OK, they'll be null)
    const prevId = (meeting as any).prev_meeting_id as string | null
    const nextId = (meeting as any).next_meeting_id as string | null
    const deferredItems = ((meeting as any).action_items || []).filter((a: any) => a.status === 'deferred')

    // Repair chain
    if (prevId && nextId) {
      await supabase.from('meetings').update({ next_meeting_id: nextId, updated_at: new Date().toISOString() }).eq('id', prevId)
      await supabase.from('meetings').update({ prev_meeting_id: prevId, updated_at: new Date().toISOString() }).eq('id', nextId)
    } else if (prevId) {
      await supabase.from('meetings').update({ next_meeting_id: null, updated_at: new Date().toISOString() }).eq('id', prevId)
    } else if (nextId) {
      await supabase.from('meetings').update({ prev_meeting_id: null, updated_at: new Date().toISOString() }).eq('id', nextId)
    }

    // Migrate deferred items
    if (nextId && deferredItems.length > 0) {
      const { data: nm } = await supabase.from('meetings').select('action_items').eq('id', nextId).single()
      if (nm) {
        const existing = ((nm as any).action_items || []) as any[]
        const existingIds = new Set(existing.map((a: any) => a.id))
        const newItems = deferredItems.filter((d: any) => !existingIds.has(d.id))
        if (newItems.length > 0) {
          await supabase.from('meetings').update({
            action_items: [...existing, ...newItems.map((d: any) => ({ ...d, status: 'pending' }))],
            updated_at: new Date().toISOString(),
          }).eq('id', nextId)
        }
      }
    }

    // Clean up and delete
    await supabase.from('meeting_attendees').delete().eq('meeting_id', meeting.id)
    await supabase.from('meeting_rock_reviews').delete().eq('meeting_id', meeting.id)
    await supabase.from('meetings').delete().eq('id', meeting.id)
    router.push('/meetings')
  }

  // ═══ READ AI UPLOAD ═══
  const handleReadAiUpload = async (file: File) => {
    setUploading(true)
    setUploadError('')

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'm4v'].includes(ext)
      const isBinary = ['pdf', 'docx'].includes(ext)
      let parsed: Record<string, any> = {}

      if (isVideo) {
        // Video files — store as object URL for playback, no text extraction
        const videoUrl = URL.createObjectURL(file)
        parsed = {
          summary: null,
          action_items: [],
          key_topics: [],
          transcript: null,
          video_url: videoUrl,
          video_filename: file.name,
          video_size_mb: (file.size / 1024 / 1024).toFixed(1),
          source: 'video_upload',
          uploaded_at: new Date().toISOString(),
          original_filename: file.name,
        }
      } else if (isBinary) {
        // Binary formats — store filename and show note
        parsed = {
          summary: null,
          action_items: [],
          transcript: null,
          source: 'binary_upload',
          binary_note: `${file.name} uploaded. Open in the appropriate application to view content.`,
          uploaded_at: new Date().toISOString(),
          original_filename: file.name,
        }
      } else {
        const text = await file.text()

        if (ext === 'json') {
          const raw = JSON.parse(text)
          parsed = {
            summary: raw.summary || raw.abstract || raw.overview || null,
            action_items: raw.action_items || raw.actionItems || raw.action_items_list || [],
            key_topics: raw.key_topics || raw.topics || raw.keyTopics || [],
            transcript: raw.transcript || raw.full_transcript || null,
            attendees: raw.attendees || raw.participants || [],
            decisions: raw.decisions || [],
            questions: raw.questions || raw.open_questions || [],
            video_url: raw.video_url || raw.videoUrl || raw.recording_url || null,
            source: 'read_ai',
            uploaded_at: new Date().toISOString(),
            original_filename: file.name,
          }
        } else if (['srt', 'vtt'].includes(ext)) {
          // Subtitle/caption files — strip timestamps, extract text
          const stripped = text
            .replace(/\d+\n/g, '')
            .replace(/\d{2}:\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{2,3}/g, '')
            .replace(/<[^>]+>/g, '')
            .split('\n').map(l => l.trim()).filter(Boolean).join(' ')
          parsed = {
            summary: null,
            action_items: [],
            transcript: stripped,
            source: 'subtitle_file',
            uploaded_at: new Date().toISOString(),
            original_filename: file.name,
          }
        } else {
          // TXT, CSV, MD — parse as transcript with section detection
          const sections: Record<string, string> = {}
          let currentSection = 'transcript'
          const lines = text.split('\n')
          lines.forEach(line => {
            const trimmed = line.trim()
            if (/^(summary|action items|key topics|decisions|questions|transcript)/i.test(trimmed)) {
              currentSection = trimmed.toLowerCase().replace(/[^a-z_]/g, '_').replace(/_+/g, '_')
            } else if (trimmed) {
              if (!sections[currentSection]) sections[currentSection] = ''
              sections[currentSection] += trimmed + '\n'
            }
          })
          const actionLines = (sections.action_items || '').split('\n').filter(l => l.trim())
          const actionItems = actionLines.map(l => ({ description: l.replace(/^[-*\u2022]\s*/, '').trim() }))
          parsed = {
            summary: sections.summary?.trim() || null,
            action_items: actionItems.length > 0 ? actionItems : [],
            transcript: sections.transcript?.trim() || text.trim(),
            source: 'read_ai_text',
            uploaded_at: new Date().toISOString(),
            original_filename: file.name,
          }
        }
      }

      if (meeting) {
        await supabase.from('meetings').update({
          read_ai_data: parsed,
          updated_at: new Date().toISOString(),
        }).eq('id', meeting.id)
        setMeeting({ ...meeting, read_ai_data: parsed })
      }
    } catch (e: any) {
      setUploadError(e.message || 'Failed to parse file')
    }
    setUploading(false)
  }

  // ═══ AI ADVISOR ═══
  const runAiAdvisor = async () => {
    if (!meeting || !currentOrg) return
    setAiLoading(true)
    setAiError('')
    setAiResult(null)

    try {
      const res = await fetch('/api/ai/meeting-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          meeting_id: meeting.id,
          issue_text: aiIssue || `Analyze this meeting: "${meeting.title}"`,
          meeting_notes: notes || meeting.notes || '',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      setAiResult(data.analysis)
      setAiMetrics(data.metrics)
    } catch (e: any) {
      setAiError(e.message || 'AI analysis failed')
    }
    setAiLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue" /></div>
  if (!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate] || MEETING_TEMPLATES.custom
  const attendeeAvatars = attendees.map(a => ({
    initials: (a.display_name || '??').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase(),
  }))

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <button onClick={() => router.push('/meetings')}
        className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark transition-colors">
        <ChevronLeft size={14} /> Back to Meetings
      </button>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* ═══ HEADER ═══ */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <BadgePill text={tmpl.label} color={tmpl.color} />
            {editingTitle ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  autoFocus
                  value={editTitleVal}
                  onChange={e => setEditTitleVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                  className="flex-1 px-2 py-1 text-sm font-semibold border border-np-blue/30 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/40 text-np-dark"
                />
                <button onClick={saveTitle} className="px-2 py-1 bg-np-blue text-white text-[10px] font-semibold rounded-lg">Save</button>
                <button onClick={() => setEditingTitle(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => { setEditTitleVal(meeting.title); setEditingTitle(true) }}
                className="flex items-center gap-1.5 group flex-1 text-left"
              >
                <h2 className="text-base font-bold text-np-dark group-hover:text-np-blue transition-colors">{meeting.title}</h2>
                <Edit2 size={11} className="opacity-0 group-hover:opacity-60 transition-opacity text-np-blue flex-shrink-0" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-400">
            {editingTime ? (
              <div className="flex items-center gap-2">
                <input type="datetime-local"
                  defaultValue={meeting.scheduled_at ? new Date(meeting.scheduled_at).toISOString().slice(0,16) : ''}
                  onChange={e => setEditTimeVal(e.target.value)}
                  className="text-[10px] px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                <input type="number" min="5" max="480" defaultValue={meeting.duration_minutes}
                  onChange={e => setEditDuration(e.target.value)}
                  className="w-16 text-[10px] px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                  placeholder="min" />
                <span className="text-[10px] text-gray-400">min</span>
                <button onClick={saveMeetingTime} className="px-2 py-1 bg-np-blue text-white text-[10px] font-semibold rounded-lg">Save</button>
                <button onClick={() => setEditingTime(false)} className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setEditingTime(true)} className="flex items-center gap-1 hover:text-np-blue group transition-colors">
                <Clock size={11} />
                <span>{meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                }) : 'No date set'} &middot; {meeting.duration_minutes} min</span>
                <Edit2 size={9} className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
              </button>
            )}
            {attendeeAvatars.length > 0 && <AvatarStack list={attendeeAvatars} />}
            <div className="ml-auto flex items-center gap-1.5">
              {meeting.status === 'scheduled' && (
                <button onClick={() => updateMeetingStatus('in_progress')}
                  className="px-2.5 py-1 bg-teal text-white text-[10px] font-semibold rounded-md hover:bg-teal/90 transition-colors">
                  Start Meeting
                </button>
              )}
              {meeting.status === 'in_progress' && (
                <button onClick={() => updateMeetingStatus('completed')}
                  className="px-2.5 py-1 bg-green-500 text-white text-[10px] font-semibold rounded-md hover:bg-green-600 transition-colors">
                  Complete
                </button>
              )}
              <StatusDot status={meeting.status} />
              <span className="text-[10px] capitalize font-medium">{meeting.status.replace('_', ' ')}</span>
              {/* Delete button */}
              <button onClick={() => setShowDeleteConfirm(true)}
                className="ml-2 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                title="Delete meeting">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* ═══ TABS ═══ */}
        <div className="flex border-b border-gray-100 px-5">
          {([
            { key: 'agenda', label: 'Agenda' },
            { key: 'notes', label: 'Notes' },
            { key: 'read_ai', label: 'Read AI' },
            { key: 'ids', label: 'IDS' },
            { key: 'task_review', label: 'Task Review' },
            { key: 'ai_advisor', label: 'AI Advisor' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t.key ? 'text-np-blue border-np-blue' : 'text-gray-400 border-transparent hover:text-np-dark'
              }`}>
              {t.key === 'ai_advisor' && <Sparkles size={10} />}
              {t.key === 'read_ai' && <Brain size={10} />}
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ TAB CONTENT ═══ */}
        <div className="p-5 min-h-[200px]">

          {/* ── AGENDA TAB ── */}
          {tab === 'agenda' && (
            <div className="space-y-0">
              {/* Agenda toolbar */}
              <div className="flex items-center gap-2 pb-3 mb-1 border-b border-gray-100">
                <input ref={agendaUploadRef} type="file" accept=".json,.csv,.txt" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleAgendaUpload(e.target.files[0]) }} />
                <button onClick={() => agendaUploadRef.current?.click()} disabled={agendaUploading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 hover:text-np-dark border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <Upload size={10} />{agendaUploading ? 'Uploading...' : 'Upload Agenda'}
                </button>
                <button onClick={downloadAgendaTemplate}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 hover:text-np-dark border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <FileText size={10} />Download Template
                </button>
                <button onClick={downloadFilledAgenda}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5 transition-colors">
                  <Download size={10} />Export This Agenda
                </button>
                <button onClick={() => setShowAiAgendaBuilder(!showAiAgendaBuilder)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold border rounded-lg transition-colors ${showAiAgendaBuilder ? 'bg-violet-600 text-white border-violet-600' : 'text-violet-600 border-violet-200 hover:bg-violet-50'}`}>
                  <Sparkles size={10} />AI Agenda Builder
                </button>
              </div>

              {/* AI Agenda Builder panel */}
              {showAiAgendaBuilder && (
                <div className="bg-violet-50/60 border border-violet-100 rounded-xl p-4 mb-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={12} className="text-violet-600" />
                    <span className="text-xs font-semibold text-violet-800">AI Agenda Builder</span>
                    <span className="text-[10px] text-violet-500">Claude will build a structured agenda for this meeting type</span>
                  </div>
                  <textarea
                    value={aiAgendaPrompt}
                    onChange={e => setAiAgendaPrompt(e.target.value)}
                    placeholder="Describe the meeting goals, key topics, or any context Claude should know..."
                    rows={3}
                    className="w-full px-3 py-2 text-xs border border-violet-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white resize-none placeholder:text-gray-400"
                  />
                  <div className="flex gap-2">
                    <button onClick={buildAiAgenda} disabled={aiAgendaLoading || !aiAgendaPrompt.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                      {aiAgendaLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      {aiAgendaLoading ? 'Building agenda...' : 'Build Agenda'}
                    </button>
                    <button onClick={() => setShowAiAgendaBuilder(false)} className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                </div>
              )}



              {/* Agenda sections */}
              {(meeting.agenda || []).map((section: AgendaSection, i: number) => (
                <div key={i} className={`border-b border-gray-100 last:border-0 transition-colors ${activeTimerIdx === i ? 'bg-np-blue/5 -mx-5 px-5' : ''}`}>
                  {/* Section header row */}
                  <div className="flex items-center gap-3 py-2.5 group/row">
                    <button onClick={() => toggleAgendaItem(i)}
                      className={`w-[18px] h-[18px] rounded flex items-center justify-center border-2 transition-colors flex-shrink-0 ${
                        section.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-teal'
                      }`}>
                      {section.completed && <Check size={10} className="text-white" strokeWidth={3} />}
                    </button>

                    {editingSectionIdx === i ? (
                      // Inline edit mode
                      <div className="flex items-center gap-2 flex-1">
                        <input autoFocus value={editSectionName} onChange={e => setEditSectionName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveSectionEdit(i); if (e.key === 'Escape') setEditingSectionIdx(null) }}
                          className="flex-1 px-2 py-0.5 text-xs font-medium border border-np-blue/30 rounded focus:outline-none bg-white" />
                        <input type="number" min="1" max="180" value={editSectionMins} onChange={e => setEditSectionMins(e.target.value)}
                          className="w-12 px-1.5 py-0.5 text-xs border border-np-blue/30 rounded focus:outline-none text-center bg-white" />
                        <span className="text-[10px] text-gray-400">min</span>
                        <button onClick={() => saveSectionEdit(i)} className="px-2 py-0.5 bg-np-blue text-white text-[10px] font-semibold rounded">Save</button>
                        <button onClick={() => setEditingSectionIdx(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      // View mode
                      <button
                        onClick={() => setExpandedSection(expandedSection === i ? null : i)}
                        className={`flex items-center gap-1.5 flex-1 text-left transition-colors ${section.completed ? 'text-gray-400' : 'text-np-dark hover:text-np-blue'}`}>
                        {expandedSection === i
                          ? <ChevronDown size={12} className="flex-shrink-0 text-np-blue" />
                          : <ChevronRight size={12} className="flex-shrink-0 text-gray-400" />}
                        <span className={`text-xs font-medium ${section.completed ? 'line-through' : ''}`}>{section.section}</span>
                      </button>
                    )}

                    {editingSectionIdx !== i && (
                      <>
                        {sectionTimes[i] !== undefined && (
                          <span className={`text-[10px] font-mono font-bold ${activeTimerIdx === i ? 'text-np-blue' : 'text-gray-400'}`}>
                            {fmtTime(sectionTimes[i])}
                          </span>
                        )}
                        <button onClick={() => toggleTimer(i)}
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                            activeTimerIdx === i ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-400 hover:bg-np-blue/10 hover:text-np-blue'
                          }`}>
                          {activeTimerIdx === i ? <Pause size={9} /> : <Play size={9} />}
                        </button>
                        <BadgePill text={`${section.duration_min} min`} color="#9CA3AF" bgColor="#F3F4F6" />
                        {/* Edit / Delete — show on row hover */}
                        <button
                          onClick={() => { setEditingSectionIdx(i); setEditSectionName(section.section); setEditSectionMins(String(section.duration_min)) }}
                          className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 text-gray-300 hover:text-np-blue rounded">
                          <Edit2 size={10} />
                        </button>
                        <button
                          onClick={() => removeSection(i)}
                          className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 text-gray-300 hover:text-red-400 rounded">
                          <Trash2 size={10} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Expanded section content */}
                  {expandedSection === i && (
                    <div className="pb-4 pl-7 space-y-3">
                      {/* Prompts / talking points */}
                      {((section.prompts || []).length > 0 || (section.talking_points || []).length > 0) && (
                        <div>
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Discussion Prompts</p>
                          <div className="space-y-1">
                            {[...(section.prompts || []), ...(section.talking_points || [])].map((p, pi) => (
                              <div key={pi} className="flex items-start gap-2 text-[11px] text-gray-600">
                                <span className="text-np-blue mt-0.5">&#8227;</span>
                                <span>{p}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section notes */}
                      <div>
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Section Notes</p>
                        <textarea
                          defaultValue={section.notes || sectionNotes[i] || ''}
                          onBlur={e => saveSectionNote(i, e.target.value)}
                          onChange={e => setSectionNotes(prev => ({ ...prev, [i]: e.target.value }))}
                          placeholder="Add notes for this section..."
                          rows={3}
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none placeholder:text-gray-300"
                        />
                      </div>

                      {/* Quick IDS capture from section */}
                      <div>
                        <button
                          onClick={() => { setShowIdsForm(true) }}
                          className="flex items-center gap-1.5 text-[10px] text-amber-600 hover:text-amber-700 font-medium">
                          <Zap size={9} />Capture IDS item from this section
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {(meeting.agenda || []).length === 0 && (
                <div className="py-8 text-center space-y-2">
                  <p className="text-xs text-gray-400">No agenda items yet.</p>
                  <button onClick={() => setShowAiAgendaBuilder(true)} className="text-xs text-violet-600 hover:underline flex items-center gap-1 mx-auto">
                    <Sparkles size={10} />Build one with AI
                  </button>
                </div>
              )}

              {/* Add section on the fly */}
              <div className="pt-3 mt-1 border-t border-gray-100">
                {addingSection ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Add Agenda Section</p>
                    <div className="flex gap-2">
                      <input
                        value={newSectionName}
                        onChange={e => setNewSectionName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addAgendaSection()}
                        placeholder="Section name (e.g. Budget Review)"
                        autoFocus
                        className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white"
                      />
                      <input
                        type="number" min="1" max="120"
                        value={newSectionMins}
                        onChange={e => setNewSectionMins(e.target.value)}
                        className="w-16 px-2 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white text-center"
                      />
                      <span className="text-xs text-gray-400 self-center">min</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addAgendaSection} disabled={!newSectionName.trim()}
                        className="px-3 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-blue/90 disabled:opacity-50 transition-colors">
                        Add Section
                      </button>
                      <button onClick={() => setAddingSection(false)} className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingSection(true)}
                    className="flex items-center gap-1.5 text-[10px] text-np-blue hover:text-np-dark font-medium transition-colors">
                    <Plus size={10} />Add agenda section
                  </button>
                )}
              </div>

              {/* Rock Review (L10) */}
              {meeting.template === 'level_10' && rocks.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Target size={13} className="text-teal" />
                    <span className="text-xs font-bold text-np-dark">Rock Review</span>
                  </div>
                  {rocks.map(r => (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-gray-100/50 last:border-0">
                      <StatusDot status={rockReviews[r.id] || r.status} />
                      <span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span>
                      <ProgressBar pct={r.progress_pct} className="max-w-[80px]" />
                      <span className="text-[10px] font-bold text-np-dark w-8 text-right">{r.progress_pct}%</span>
                      <select value={rockReviews[r.id] || r.status}
                        onChange={e => saveRockReview(r.id, e.target.value)}
                        className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal/30">
                        <option value="on_track">On Track</option>
                        <option value="at_risk">At Risk</option>
                        <option value="off_track">Off Track</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {/* IDS + Task capture bar */}
              <div className="mt-5 pt-4 border-t border-gray-200 space-y-3">
                {/* IDS Capture */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Zap size={10} className="text-amber-500" />Issues / Decisions / Solutions
                    </span>
                    <button onClick={() => setShowIdsForm(!showIdsForm)}
                      className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
                      <Plus size={10} />Add IDS Item
                    </button>
                  </div>
                  {showIdsForm && (
                    <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2">
                        {(['issue','decision','solution'] as const).map(t => (
                          <button key={t} onClick={() => setIdsType(t)}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-full border transition-colors capitalize ${idsType === t ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'}`}>
                            {t === 'issue' ? '⚡ Issue' : t === 'decision' ? '✓ Decision' : '💡 Solution'}
                          </button>
                        ))}
                      </div>
                      <input value={idsInput} onChange={e => setIdsInput(e.target.value)}
                        placeholder="Describe the issue, decision, or solution..."
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300"
                        onKeyDown={e => e.key === 'Enter' && addIdsItem()} />
                      <div className="flex gap-2">
                        <input value={idsOwner} onChange={e => setIdsOwner(e.target.value)}
                          placeholder="Owner (optional)"
                          className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300" />
                        <button onClick={addIdsItem} disabled={!idsInput.trim()}
                          className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors">
                          Add
                        </button>
                        <button onClick={() => setShowIdsForm(false)} className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {/* IDS items preview */}
                  {(meeting.ids_items || []).length > 0 && (
                    <div className="space-y-1 mt-2">
                      {(meeting.ids_items as any[]).slice(-3).map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">
                          <span className={`font-bold uppercase ${item.issue_category === 'issue' ? 'text-red-500' : item.issue_category === 'decision' ? 'text-green-600' : 'text-np-blue'}`}>
                            {item.issue_category[0].toUpperCase()}
                          </span>
                          <span className="flex-1 truncate">{item.description}</span>
                          {item.owner_name && <span className="text-gray-400">{item.owner_name}</span>}
                        </div>
                      ))}
                      {(meeting.ids_items || []).length > 3 && (
                        <button onClick={() => setTab('ids')} className="text-[10px] text-np-blue hover:underline pl-3">
                          +{(meeting.ids_items || []).length - 3} more → View IDS tab
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Task Capture */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                      <ListTodo size={10} className="text-np-blue" />Action Items / Tasks
                    </span>
                    <button onClick={() => setShowTaskForm(!showTaskForm)}
                      className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
                      <Plus size={10} />Capture Task
                    </button>
                  </div>
                  {showTaskForm && (
                    <div className="bg-np-blue/5 border border-np-blue/10 rounded-xl p-3 space-y-2">
                      <input value={taskInput} onChange={e => setTaskInput(e.target.value)}
                        placeholder="Task name..."
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white"
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addActionItem()} />
                      <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)}
                        placeholder="Description / context (optional)"
                        rows={2}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none bg-white" />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Owner</label>
                          <select value={taskOwner} onChange={e => setTaskOwner(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white">
                            <option value="">— Select owner —</option>
                            {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Priority</label>
                          <select value={taskPriority} onChange={e => setTaskPriority(e.target.value as any)}
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Due Date</label>
                        <input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">RACI — Responsible</label>
                          <select value={taskRaciR} onChange={e => setTaskRaciR(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white">
                            <option value="">— Select —</option>
                            {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">RACI — Accountable</label>
                          <select value={taskRaciA} onChange={e => setTaskRaciA(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white">
                            <option value="">— Select —</option>
                            {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Subtasks */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Subtasks</span>
                          <button onClick={() => setTaskSubtasks(s => [...s, ''])}
                            className="text-[9px] text-np-blue hover:underline">+ Add subtask</button>
                        </div>
                        {taskSubtasks.map((s, i) => (
                          <div key={i} className="flex gap-1 mb-1">
                            <input value={s} onChange={e => setTaskSubtasks(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                              placeholder={`Subtask ${i + 1}`}
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none" />
                            <button onClick={() => setTaskSubtasks(prev => prev.filter((_, j) => j !== i))}
                              className="text-gray-300 hover:text-red-400 px-1"><X size={10} /></button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={addActionItem} disabled={!taskInput.trim()}
                          className="px-3 py-1.5 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-blue/90 disabled:opacity-50 transition-colors">
                          Capture Task
                        </button>
                        <button onClick={() => setShowTaskForm(false)} className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Pending tasks preview */}
                  {((meeting.action_items || []) as any[]).filter((a: any) => a.status === 'pending').length > 0 && (
                    <div className="space-y-1 mt-2">
                      {((meeting.action_items || []) as any[]).filter((a: any) => a.status === 'pending').slice(-3).map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">
                          <ListTodo size={9} className="text-np-blue flex-shrink-0" />
                          <span className="flex-1 truncate font-medium">{item.title}</span>
                          {item.owner_name && <span className="text-gray-400">{item.owner_name}</span>}
                          {item.due_date && <span className="text-gray-300">{item.due_date}</span>}
                        </div>
                      ))}
                      <button onClick={() => setTab('task_review')} className="text-[10px] text-np-blue hover:underline pl-3">
                        Review all tasks →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── NOTES TAB ── */}
          {tab === 'notes' && (
            <div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Click to add meeting notes... Auto-save on blur."
                onBlur={saveNotes}
                rows={12}
                className="w-full p-4 bg-np-light border border-gray-100 rounded-xl text-xs text-np-dark leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder:text-gray-400"
              />
              <div className="flex items-center justify-end mt-2">
                <button onClick={saveNotes}
                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-np-blue hover:bg-np-blue/5 rounded-md transition-colors">
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                  {saving ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}

          {/* ── READ AI TAB ── */}
          {tab === 'read_ai' && (
            <div className="space-y-4">
              {/* Hidden file input */}
              <input ref={fileInputRef} type="file" accept=".json,.txt,.csv,.md,.mp4,.mov,.avi,.webm,.docx,.pdf,.srt,.vtt" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleReadAiUpload(e.target.files[0]) }} />

              {meeting.read_ai_data ? (
                <>
                  {/* Source info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={12} className="text-teal" />
                      <span className="text-[10px] font-semibold text-teal">
                        Read AI Data Loaded
                      </span>
                      {meeting.read_ai_data.original_filename && (
                        <span className="text-[9px] text-gray-400">({meeting.read_ai_data.original_filename})</span>
                      )}
                    </div>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="text-[10px] text-np-blue hover:underline flex items-center gap-1">
                      <Upload size={9} /> Replace
                    </button>
                  </div>

                  {/* Video — inline player for local uploads, link for remote URLs */}
                  {meeting.read_ai_data.video_url && (
                    meeting.read_ai_data.source === 'video_upload' ? (
                      <div className="rounded-xl overflow-hidden border border-gray-100 bg-black">
                        <video controls className="w-full max-h-64" src={meeting.read_ai_data.video_url}>
                          Your browser does not support video playback.
                        </video>
                        <div className="px-3 py-2 bg-gray-50 flex items-center gap-2 text-[10px] text-gray-500">
                          <Video size={10} className="text-violet-600" />
                          <span className="flex-1 truncate">{meeting.read_ai_data.video_filename || meeting.read_ai_data.original_filename}</span>
                          {meeting.read_ai_data.video_size_mb && <span>{meeting.read_ai_data.video_size_mb} MB</span>}
                        </div>
                      </div>
                    ) : (
                      <a href={meeting.read_ai_data.video_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 rounded-lg border border-violet-100 hover:bg-violet-100 transition-colors">
                        <Video size={14} className="text-violet-600" />
                        <span className="text-[11px] font-semibold text-violet-700">Watch Recording</span>
                      </a>
                    )
                  )}

                  {/* Binary file note */}
                  {meeting.read_ai_data.binary_note && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-100">
                      <FileText size={13} className="text-gray-400 flex-shrink-0" />
                      <span className="text-[11px] text-gray-600">{meeting.read_ai_data.binary_note}</span>
                    </div>
                  )}

                  {/* Summary */}
                  {meeting.read_ai_data.summary && (
                    <div className="bg-white border-l-4 border-teal rounded-r-lg p-4">
                      <h4 className="text-[10px] font-bold text-teal uppercase tracking-wider mb-1">Summary</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{meeting.read_ai_data.summary}</p>
                    </div>
                  )}

                  {/* Key Topics */}
                  {meeting.read_ai_data.key_topics?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Key Topics</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {meeting.read_ai_data.key_topics.map((topic: any, i: number) => (
                          <span key={i} className="px-2.5 py-1 bg-gray-50 text-[10px] font-medium text-np-dark rounded-lg border border-gray-100">
                            {typeof topic === 'string' ? topic : topic.topic || topic.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Items */}
                  {meeting.read_ai_data.action_items?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Action Items ({meeting.read_ai_data.action_items.length})
                      </h4>
                      {meeting.read_ai_data.action_items.map((item: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 py-2 border-b border-gray-100/50 last:border-0">
                          <Check size={12} className="text-gray-300 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <span className="text-[11px] text-np-dark">{item.description || item.text || item}</span>
                            {item.assignee && <span className="text-[9px] text-gray-400 ml-2">({item.assignee})</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Decisions */}
                  {meeting.read_ai_data.decisions?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Decisions</h4>
                      {meeting.read_ai_data.decisions.map((d: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 py-1.5">
                          <span className="text-[10px] text-amber-500 font-bold mt-0.5">&#8227;</span>
                          <span className="text-[11px] text-np-dark">{typeof d === 'string' ? d : d.description || d.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Transcript */}
                  {meeting.read_ai_data.transcript && (
                    <details className="group">
                      <summary className="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-np-dark">
                        Transcript
                      </summary>
                      <pre className="mt-2 p-4 bg-gray-50 rounded-lg text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                        {meeting.read_ai_data.transcript}
                      </pre>
                    </details>
                  )}

                  {/* Clear data */}
                  <button onClick={async () => {
                    await supabase.from('meetings').update({ read_ai_data: null, updated_at: new Date().toISOString() }).eq('id', meeting.id)
                    setMeeting({ ...meeting, read_ai_data: null })
                  }}
                    className="text-[9px] text-gray-300 hover:text-red-400 transition-colors">
                    Clear Read AI Data
                  </button>
                </>
              ) : (
                <div
                  className="py-10 border-2 border-dashed border-gray-200 rounded-xl text-center cursor-pointer hover:border-np-blue/30 hover:bg-np-blue/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-np-blue', 'bg-np-blue/5') }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-np-blue', 'bg-np-blue/5') }}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('border-np-blue', 'bg-np-blue/5')
                    if (e.dataTransfer.files[0]) handleReadAiUpload(e.dataTransfer.files[0])
                  }}>
                  {uploading ? (
                    <Loader2 size={24} className="mx-auto text-np-blue animate-spin mb-2" />
                  ) : (
                    <Upload size={24} className="mx-auto text-gray-300 mb-2" />
                  )}
                  <div className="text-xs font-medium text-np-dark">
                    {uploading ? 'Processing...' : 'Drop Read AI export here or click to upload'}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">JSON, TXT, CSV, MD, MP4, MOV, DOCX, PDF, SRT, VTT</div>
                  <p className="text-[9px] text-gray-300 mt-3">Export from Read AI dashboard and upload here to import summary, action items, and transcript</p>
                </div>
              )}

              {uploadError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 text-[10px] rounded-lg">
                  <AlertCircle size={12} /> {uploadError}
                </div>
              )}
            </div>
          )}

          {/* ── IDS TAB ── */}
          {tab === 'ids' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-np-dark flex items-center gap-2">
                  <Zap size={14} className="text-amber-500" />IDS — Identify, Discuss, Solve
                </h3>
                <button onClick={() => { setShowIdsForm(true); setTab('agenda') }}
                  className="flex items-center gap-1 text-[10px] text-np-blue hover:underline">
                  <Plus size={10} />Add Item
                </button>
              </div>

              {(['issue','decision','solution'] as const).map(type => {
                const items = ((meeting.ids_items || []) as any[]).filter((i: any) => i.issue_category === type)
                if (items.length === 0) return null
                const colors = { issue: 'text-red-600 bg-red-50 border-red-100', decision: 'text-green-700 bg-green-50 border-green-100', solution: 'text-np-blue bg-np-blue/5 border-np-blue/10' }
                const labels = { issue: '⚡ Issues', decision: '✓ Decisions', solution: '💡 Solutions' }
                return (
                  <div key={type} className={`rounded-xl border p-4 ${colors[type]}`}>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3">{labels[type]} ({items.length})</h4>
                    <div className="space-y-2">
                      {items.map((item: any) => (
                        <div key={item.id} className="flex items-start gap-3 bg-white/70 rounded-lg p-3">
                          <div className="flex-1">
                            <p className="text-xs font-medium text-np-dark">{item.description}</p>
                            {item.owner_name && <p className="text-[10px] text-gray-400 mt-0.5">Owner: {item.owner_name}</p>}
                            {item.resolution && <p className="text-[10px] text-green-700 mt-1 italic">Resolution: {item.resolution}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <select value={item.status}
                              onChange={async e => {
                                const updated = (meeting.ids_items || []).map((x: any) => x.id === item.id ? { ...x, status: e.target.value } : x)
                                setMeeting({ ...meeting, ids_items: updated as any })
                                await supabase.from('meetings').update({ ids_items: updated, updated_at: new Date().toISOString() }).eq('id', meeting.id)
                              }}
                              className="text-[9px] px-1.5 py-0.5 border border-gray-200 rounded focus:outline-none bg-white">
                              <option value="identified">Identified</option>
                              <option value="discussed">Discussed</option>
                              <option value="solved">Solved</option>
                            </select>
                            <button onClick={() => removeIdsItem(item.id)} className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                              <X size={10} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {((meeting.ids_items || []) as any[]).length === 0 && (
                <div className="py-10 text-center">
                  <Zap size={24} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-xs text-gray-400">No IDS items yet.</p>
                  <button onClick={() => { setShowIdsForm(true); setTab('agenda') }}
                    className="mt-2 text-xs text-np-blue hover:underline">Capture one from the Agenda tab</button>
                </div>
              )}
            </div>
          )}

          {/* ── TASK REVIEW TAB ── */}
          {tab === 'task_review' && (() => {
            const allItems = (meeting.action_items || []) as any[]
            const pending  = allItems.filter(a => a.status === 'pending')
            const approved = allItems.filter(a => a.status === 'approved')
            const deferred = allItems.filter(a => a.status === 'deferred')
            const rejected = allItems.filter(a => a.status === 'deleted')

            const priColor: Record<string, string> = { low: '#9CA3AF', medium: '#3B82F6', high: '#F59E0B', urgent: '#EF4444' }

            return (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-np-dark flex items-center gap-2">
                    <ListTodo size={14} className="text-np-blue" />Task Review
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    <span className="text-green-600 font-semibold">{approved.length} approved</span>
                    <span className="text-amber-600 font-semibold">{deferred.length} deferred</span>
                    <span className="text-red-400 font-semibold">{rejected.length} rejected</span>
                  </div>
                </div>

                {pending.length === 0 && approved.length === 0 && deferred.length === 0 && (
                  <div className="py-10 text-center">
                    <ListTodo size={24} className="mx-auto text-gray-200 mb-2" />
                    <p className="text-xs text-gray-400">No action items captured yet.</p>
                    <button onClick={() => { setShowTaskForm(true); setTab('agenda') }}
                      className="mt-2 text-xs text-np-blue hover:underline">Capture tasks from the Agenda tab</button>
                  </div>
                )}

                {/* Pending — needs review */}
                {pending.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <Clock size={10} />Pending Review ({pending.length})
                    </h4>
                    <div className="space-y-3">
                      {pending.map((item: any) => (
                        <div key={item.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-np-dark">{item.title}</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: priColor[item.priority || 'medium'], backgroundColor: priColor[item.priority || 'medium'] + '20' }}>
                                  {(item.priority || 'medium').toUpperCase()}
                                </span>
                              </div>
                              {item.description && <p className="text-[11px] text-gray-500 leading-relaxed">{item.description}</p>}
                            </div>
                          </div>

                          {/* RACI */}
                          {(item.raci_responsible || item.raci_accountable || item.owner_name) && (
                            <div className="flex flex-wrap gap-3 mb-3 text-[10px]">
                              {item.owner_name && (
                                <span className="flex items-center gap-1"><span className="font-bold text-gray-400">Owner:</span><span className="text-np-dark">{item.owner_name}</span></span>
                              )}
                              {item.raci_responsible && (
                                <span className="flex items-center gap-1"><span className="font-bold text-gray-400">R:</span><span className="text-np-dark">{item.raci_responsible}</span></span>
                              )}
                              {item.raci_accountable && (
                                <span className="flex items-center gap-1"><span className="font-bold text-gray-400">A:</span><span className="text-np-dark">{item.raci_accountable}</span></span>
                              )}
                            </div>
                          )}

                          {/* Subtasks */}
                          {item.subtasks?.length > 0 && (
                            <div className="mb-3 space-y-1">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Subtasks</span>
                              {item.subtasks.map((s: string, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-[10px] text-gray-600">
                                  <div className="w-3 h-3 rounded border border-gray-300 flex-shrink-0" />
                                  {s}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                            <button onClick={() => approveTask(item)} disabled={taskLoading[item.id]}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
                              {taskLoading[item.id] ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                              Accept → Task Manager
                            </button>
                            <div className="flex items-center gap-1 flex-1">
                              <input type="date" value={deferDates[item.id] || ''} onChange={e => setDeferDates(prev => ({ ...prev, [item.id]: e.target.value }))}
                                className="text-[10px] px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none flex-1" />
                              <button onClick={() => deferTask(item)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-lg hover:bg-amber-200 transition-colors">
                                <CalendarClock size={10} />Defer
                              </button>
                            </div>
                            <button onClick={() => rejectTask(item.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-500 text-[10px] font-semibold rounded-lg hover:bg-red-100 transition-colors">
                              <XCircle size={10} />Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approved */}
                {approved.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <CheckCircle2 size={10} />Approved → Task Manager ({approved.length})
                    </h4>
                    <div className="space-y-1.5">
                      {approved.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs">
                          <CheckCircle2 size={11} className="text-green-500 flex-shrink-0" />
                          <span className="text-green-800 font-medium flex-1">{item.title}</span>
                          {item.owner_name && <span className="text-green-600 text-[10px]">{item.owner_name}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Deferred */}
                {deferred.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <CalendarClock size={10} />Deferred — Carries to Next Meeting ({deferred.length})
                    </h4>
                    <div className="space-y-1.5">
                      {deferred.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs">
                          <CalendarClock size={11} className="text-amber-500 flex-shrink-0" />
                          <span className="text-amber-800 font-medium flex-1">{item.title}</span>
                          {item.defer_revisit_date && <span className="text-amber-600 text-[10px]">Revisit: {item.defer_revisit_date}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rejected */}
                {rejected.length > 0 && (
                  <details>
                    <summary className="text-[10px] font-bold text-gray-400 uppercase tracking-widest cursor-pointer hover:text-gray-600">
                      Rejected ({rejected.length})
                    </summary>
                    <div className="space-y-1.5 mt-2">
                      {rejected.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-xs text-gray-400">
                          <XCircle size={11} className="flex-shrink-0" />
                          <span className="line-through flex-1">{item.title}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )
          })()}

          {/* ── AI ADVISOR TAB ── */}
          {tab === 'ai_advisor' && (
            <div className="space-y-4">
              <div className="p-4 bg-violet-50/50 rounded-xl border border-violet-100">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={13} className="text-violet-600" />
                  <span className="text-[11px] font-bold text-violet-800">AI Operations Advisor</span>
                </div>
                <p className="text-[10px] text-violet-600 leading-relaxed">
                  Analyzes your entire platform: all tasks (completed, overdue, abandoned), rocks, team velocity,
                  meeting history, and contacts. Recommends realistic timelines based on actual completion data.
                </p>
              </div>

              {/* Issue input */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  Describe the issue, decision, or topic to analyze
                </label>
                <textarea
                  value={aiIssue}
                  onChange={e => setAiIssue(e.target.value)}
                  placeholder="e.g. We need to hire a marketing person. What's realistic given our current workload and past hiring attempts?"
                  rows={3}
                  className="w-full mt-1 p-3 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-200 placeholder:text-gray-300"
                />
              </div>

              <button onClick={runAiAdvisor} disabled={aiLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 text-white text-xs font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                {aiLoading ? 'Analyzing entire platform...' : 'Run AI Analysis'}
              </button>

              {/* Error */}
              {aiError && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 rounded-lg border border-red-100">
                  <AlertCircle size={12} className="text-red-500 shrink-0" />
                  <span className="text-[10px] text-red-600">{aiError}</span>
                  <button onClick={runAiAdvisor} className="ml-auto text-[10px] font-semibold text-red-500 hover:underline">Retry</button>
                </div>
              )}

              {/* Metrics summary */}
              {aiMetrics && (
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: 'Total Tasks', value: aiMetrics.total_tasks, icon: FileText },
                    { label: 'Completed', value: aiMetrics.completed, icon: Check },
                    { label: 'Overdue', value: aiMetrics.overdue, icon: AlertTriangle },
                    { label: 'Abandoned', value: aiMetrics.abandoned, icon: X },
                    { label: 'Avg Days', value: aiMetrics.avg_completion_days || '?', icon: Clock },
                  ].map((m, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <m.icon size={11} className="mx-auto text-gray-400 mb-1" />
                      <div className="text-sm font-bold text-np-dark">{m.value}</div>
                      <div className="text-[8px] text-gray-400 uppercase tracking-wider">{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Analysis Results */}
              {aiResult && (
                <div className="space-y-4">
                  {/* Summary */}
                  {aiResult.analysis && (
                    <div className="bg-white border-l-4 border-violet-500 rounded-r-lg p-4 space-y-2">
                      <h4 className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Strategic Assessment</h4>
                      <p className="text-xs text-np-dark leading-relaxed">{aiResult.analysis.summary}</p>
                      {aiResult.analysis.historical_patterns && (
                        <div className="mt-2 p-2.5 bg-amber-50 rounded-lg">
                          <span className="text-[9px] font-bold text-amber-600 uppercase">Historical Pattern:</span>
                          <p className="text-[10px] text-amber-800 mt-0.5">{aiResult.analysis.historical_patterns}</p>
                        </div>
                      )}
                      {aiResult.analysis.related_existing_work?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[9px] font-bold text-gray-400 uppercase">Related Existing Work:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {aiResult.analysis.related_existing_work.map((w: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-medium rounded">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiResult.analysis.risk_factors?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[9px] font-bold text-red-400 uppercase">Risk Factors:</span>
                          {aiResult.analysis.risk_factors.map((r: string, i: number) => (
                            <p key={i} className="text-[10px] text-red-600 mt-0.5 flex items-start gap-1">
                              <AlertTriangle size={8} className="mt-0.5 shrink-0" /> {r}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recommended Actions */}
                  {aiResult.recommended_actions?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <TrendingUp size={10} /> Recommended Actions ({aiResult.recommended_actions.length})
                      </h4>
                      <div className="space-y-3">
                        {aiResult.recommended_actions.map((action: any, i: number) => {
                          const priColor = ({ low: '#9CA3AF', medium: '#3B82F6', high: '#F59E0B', urgent: '#EF4444' } as Record<string, string>)[action.suggested_priority || 'medium'] || '#3B82F6'
                          return (
                            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
                              <div className="flex items-start gap-2">
                                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
                                  style={{ background: priColor }}>
                                  {i + 1}
                                </span>
                                <div className="flex-1">
                                  <div className="text-xs font-semibold text-np-dark">{action.title}</div>
                                  <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{action.description}</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Owner</div>
                                  <div className="text-[10px] font-semibold text-np-dark mt-0.5">{action.suggested_owner || 'TBD'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Due Date</div>
                                  <div className="text-[10px] font-semibold text-np-dark mt-0.5">{action.suggested_due_date || 'TBD'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                  <div className="text-[8px] font-bold text-gray-400 uppercase">Priority</div>
                                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: priColor }}>
                                    {(action.suggested_priority || 'medium').toUpperCase()}
                                  </div>
                                </div>
                              </div>

                              {/* Timeline reasoning */}
                              {action.timeline_reasoning && (
                                <div className="p-2.5 bg-blue-50/50 rounded-lg border border-blue-100">
                                  <div className="text-[8px] font-bold text-blue-500 uppercase">Timeline Reasoning</div>
                                  <p className="text-[10px] text-blue-700 mt-0.5">{action.timeline_reasoning}</p>
                                </div>
                              )}

                              {/* RACI */}
                              {action.raci && (
                                <div className="flex gap-3 mt-1">
                                  {Object.entries(action.raci).map(([role, name]) => name ? (
                                    <div key={role} className="text-[9px]">
                                      <span className="font-bold text-gray-400 uppercase">{role[0]}:</span>{' '}
                                      <span className="text-np-dark">{name as string}</span>
                                    </div>
                                  ) : null)}
                                </div>
                              )}

                              {/* Success criteria */}
                              {action.success_criteria && (
                                <p className="text-[9px] text-gray-400 italic mt-1">
                                  Done when: {action.success_criteria}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Accountability & Systemic */}
                  {aiResult.accountability_notes && (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Users size={10} className="text-amber-600" />
                        <span className="text-[9px] font-bold text-amber-600 uppercase">Team Accountability</span>
                      </div>
                      <p className="text-[10px] text-amber-800 leading-relaxed">{aiResult.accountability_notes}</p>
                    </div>
                  )}

                  {aiResult.systemic_recommendations && (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp size={10} className="text-green-600" />
                        <span className="text-[9px] font-bold text-green-600 uppercase">Systemic Recommendation</span>
                      </div>
                      <p className="text-[10px] text-green-800 leading-relaxed">{aiResult.systemic_recommendations}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Loading skeleton */}
              {aiLoading && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-20 bg-violet-50 rounded-xl" />
                  <div className="h-32 bg-gray-50 rounded-xl" />
                  <div className="h-32 bg-gray-50 rounded-xl" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ DELETE CONFIRMATION MODAL ═══ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-np-dark">Delete this meeting?</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 mb-4 space-y-1">
              <p className="text-[10px] text-gray-500">&#8226; The prev/next chain will be repaired automatically</p>
              <p className="text-[10px] text-gray-500">&#8226; Deferred action items will migrate to the next linked meeting</p>
              <p className="text-[10px] text-gray-500">&#8226; Approved tasks in Task Manager are not affected</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={handleDeleteMeeting} disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
                {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
