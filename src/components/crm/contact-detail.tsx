'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  X, Phone, Mail, MessageCircle, Tag, Clock, CheckCircle2, AlertTriangle,
  TrendingUp, Send, Pencil, Trash2, Plus, User, Activity, Brain,
  Route, Target, Calendar, FileText, Sparkles, ChevronRight, Heart,
  ArrowRightLeft, GraduationCap, BarChart3, Shield, ExternalLink, Paperclip, GitBranch, MapPin, ChevronDown, Upload, FolderOpen,
  Globe, Lightbulb, Linkedin, Instagram, Twitter, Youtube, BookOpen, Mic, Link2, ThumbsUp, ThumbsDown, Workflow
} from 'lucide-react'
import {
  fetchContact, updateContact, deleteContact, fetchNotes, createNote,
  fetchActivityLog, fetchTasks, updateTask, fetchLifecycleEvents,
  fetchCallLogs, fetchConversations, fetchMessages,
  fetchContactRelationships, createRelationship, deleteRelationship,
  fetchRelationshipTypes, fetchContacts,
  fetchTagCategories, addContactTag, removeContactTag, fetchContactStructuredTags
} from '@/lib/crm-client'
import type { CrmContact, ContactNote, CrmTask, CallLog, ActivityLogEntry, TeamMember, ContactRelationship, RelationshipType, ContactTagCategory } from '@/types/crm'
import { ContactCommsButtons } from '@/components/crm/twilio-comms'
import { CrmTaskCard, CrmTaskDetail } from '@/components/crm/crm-task-card'
import ContactCommPanel from '@/components/crm/contact-comm-panel'
import EmailComposer from '@/components/crm/email-composer'
import { createClient } from '@/lib/supabase-browser'

interface TimelineEvent {
  id: string
  event_type: string
  title: string
  description?: string
  metadata?: Record<string, any>
  occurred_at: string
}

const EVENT_ICONS: Record<string, any> = {
  call_completed: Phone, sms_sent: Send, sms_received: MessageCircle,
  email_sent: Mail, email_opened: Mail, pipeline_changed: ArrowRightLeft,
  task_created: CheckCircle2, task_completed: CheckCircle2,
  note_added: FileText, quiz_completed: Brain, mastermind_enrolled: GraduationCap,
  lifecycle_event: Activity, health_score_changed: Heart,
  tag_added: Tag, tag_removed: Tag,
}

const EVENT_COLORS: Record<string, string> = {
  call_completed: '#8b5cf6', sms_sent: '#3b82f6', sms_received: '#10b981',
  email_sent: '#f59e0b', pipeline_changed: '#ec4899', task_created: '#6b7280',
  task_completed: '#22c55e', note_added: '#64748b', quiz_completed: '#386797',
  mastermind_enrolled: '#059669', health_score_changed: '#ef4444',
}

const HEALTH_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  thriving: { color: '#22c55e', bg: '#f0fdf4', label: 'Thriving' },
  stable: { color: '#3b82f6', bg: '#eff6ff', label: 'Stable' },
  at_risk: { color: '#f59e0b', bg: '#fffbeb', label: 'At Risk' },
  critical: { color: '#ef4444', bg: '#fef2f2', label: 'Critical' },
}

const MASTERMIND_STATUS: Record<string, { color: string; label: string }> = {
  prospect: { color: '#6b7280', label: 'Prospect' },
  enrolled: { color: '#3b82f6', label: 'Enrolled' },
  active: { color: '#22c55e', label: 'Active' },
  completed: { color: '#8b5cf6', label: 'Completed' },
  graduated: { color: '#059669', label: 'Graduated' },
  alumni: { color: '#64748b', label: 'Alumni' },
}

// Default Drive folder for Podcast pipeline contacts
const PODCAST_DRIVE_FOLDER = 'https://drive.google.com/drive/u/0/folders/13a4Pn8vLyaWwtfJEU935Z_Q40jxsM4_p'

function ContactDriveSection({ contact, updateContact, load }: {
  contact: CrmContact
  updateContact: (id: string, updates: Partial<CrmContact>) => Promise<any>
  load: () => void
}) {
  const [driveFiles, setDriveFiles] = useState<any[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [driveFolder, setDriveFolder] = useState('')
  const [driveError, setDriveError] = useState('')
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null)

  const orgId = contact.org_id

  // Check Drive connection status
  useEffect(() => {
    if (!orgId) return
    fetch('/api/drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', orgId }),
    }).then(r => r.json()).then(d => setDriveConnected(d.connected ?? false)).catch(() => setDriveConnected(false))
  }, [orgId])

  // Connect Google Drive
  const connectDrive = async () => {
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'authUrl', orgId }),
      })
      const data = await res.json()
      if (data.success && data.url) {
        window.open(data.url, '_blank')
      }
    } catch {
      setDriveError('Failed to get auth URL')
    }
  }

  // Auto-set drive folder for Podcast pipeline contacts
  const effectiveDriveFolder = (contact.custom_fields?.drive_folder as string) ||
    (contact.pipeline_stage && ['Podcasts', 'Podcast'].some(p =>
      (contact as any).pipeline_name?.toLowerCase().includes(p.toLowerCase())
    ) ? PODCAST_DRIVE_FOLDER : '')

  useEffect(() => {
    setDriveFolder((contact.custom_fields?.drive_folder as string) || '')
  }, [contact.id, contact.custom_fields?.drive_folder])

  // Load files from Drive folder
  const loadDriveFiles = async (folderUrl?: string) => {
    const url = folderUrl || effectiveDriveFolder
    if (!url || !orgId) return
    setLoadingFiles(true)
    setDriveError('')
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', folderUrl: url, orgId }),
      })
      const data = await res.json()
      if (data.success) {
        setDriveFiles(data.files || [])
      } else if (data.needsAuth) {
        setDriveConnected(false)
        setDriveError('Google Drive not connected')
      } else {
        setDriveError(data.error || 'Failed to load files')
      }
    } catch {
      setDriveError('Connection error')
    }
    setLoadingFiles(false)
  }

  useEffect(() => {
    if (effectiveDriveFolder && driveConnected) loadDriveFiles(effectiveDriveFolder)
  }, [contact.id, effectiveDriveFolder, driveConnected])

  // Upload file to Drive
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !effectiveDriveFolder || !orgId) return
    setUploading(true)
    setDriveError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folderUrl', effectiveDriveFolder)
      formData.append('orgId', orgId)
      const res = await fetch('/api/drive', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        loadDriveFiles()
      } else {
        setDriveError(data.error || 'Upload failed')
      }
    } catch {
      setDriveError('Upload error')
    }
    setUploading(false)
    e.target.value = ''
  }

  // Delete file from Drive
  const handleDelete = async (fileId: string) => {
    if (!confirm('Delete this file from Google Drive?')) return
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', fileId, orgId }),
      })
      const data = await res.json()
      if (data.success) {
        setDriveFiles(prev => prev.filter(f => f.id !== fileId))
      }
    } catch {}
  }

  // Save drive folder URL
  const saveDriveFolder = async () => {
    await updateContact(contact.id, { custom_fields: { ...contact.custom_fields, drive_folder: driveFolder } } as any)
    load()
    if (driveFolder) loadDriveFiles(driveFolder)
  }

  // Create contact subfolder in the podcast Drive
  const createContactFolder = async () => {
    const parentUrl = PODCAST_DRIVE_FOLDER
    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown'
    setDriveError('')
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createFolder', folderUrl: parentUrl, folderName: contactName, orgId }),
      })
      const data = await res.json()
      if (data.success && data.folder?.webViewLink) {
        const folderUrl = data.folder.webViewLink
        setDriveFolder(folderUrl)
        await updateContact(contact.id, { custom_fields: { ...contact.custom_fields, drive_folder: folderUrl } } as any)
        load()
        loadDriveFiles(folderUrl)
      } else {
        setDriveError(data.error || 'Failed to create folder')
      }
    } catch {
      setDriveError('Connection error')
    }
  }

  const formatSize = (bytes: string) => {
    const b = parseInt(bytes)
    if (!b || isNaN(b)) return ''
    if (b < 1024) return `${b} B`
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
    return `${(b / 1048576).toFixed(1)} MB`
  }

  // Still checking connection status
  if (driveConnected === null) {
    return (
      <div className="space-y-2">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Files & Drive
        </h4>
        <p className="text-[10px] text-gray-400 text-center py-2">Checking connection...</p>
      </div>
    )
  }

  // Not connected Ã¢â‚¬â€ show connect button
  if (!driveConnected) {
    return (
      <div className="space-y-2">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Files & Drive
        </h4>
        <button onClick={connectDrive}
          className="w-full flex items-center justify-center gap-2 text-xs bg-np-blue text-white px-3 py-2 rounded-lg font-medium hover:bg-np-blue/90">
          <ExternalLink className="w-3.5 h-3.5" /> Connect Google Drive
        </button>
        {driveError && <p className="text-[10px] text-red-500">{driveError}</p>}
        <p className="text-[10px] text-gray-400 italic text-center">Connect your org&apos;s Google Drive to upload and manage files.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Files & Drive
        </h4>
        <div className="flex items-center gap-2">
          {effectiveDriveFolder && (
            <label className={`flex items-center gap-1 text-[10px] font-medium cursor-pointer ${uploading ? 'text-gray-300' : 'text-np-blue hover:underline'}`}>
              <Upload className="w-3 h-3" /> {uploading ? 'Uploading...' : 'Upload'}
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          )}
          {effectiveDriveFolder && (
            <a href={effectiveDriveFolder} target="_blank" rel="noopener"
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-np-blue font-medium">
              <ExternalLink className="w-3 h-3" /> Open
            </a>
          )}
        </div>
      </div>

      {/* Drive folder URL */}
      <div className="flex gap-1.5">
        <input
          value={driveFolder}
          onChange={e => setDriveFolder(e.target.value)}
          onBlur={saveDriveFolder}
          onKeyDown={e => e.key === 'Enter' && saveDriveFolder()}
          placeholder="https://drive.google.com/drive/folders/..."
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300"
        />
        {!driveFolder && !effectiveDriveFolder && (
          <button onClick={createContactFolder}
            className="flex items-center gap-1 text-[10px] bg-green-500 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-green-600 whitespace-nowrap">
            <Plus className="w-3 h-3" /> Create Folder
          </button>
        )}
      </div>

      {driveError && <p className="text-[10px] text-red-500">{driveError}</p>}

      {/* Drive Files */}
      {loadingFiles ? (
        <p className="text-[10px] text-gray-400 text-center py-2">Loading files...</p>
      ) : driveFiles.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {driveFiles.map(file => (
            <div key={file.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
              <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <a href={file.webViewLink} target="_blank" rel="noopener"
                className="text-xs text-gray-700 flex-1 truncate hover:text-np-blue">{file.name}</a>
              <span className="text-[9px] text-gray-300 flex-shrink-0">{formatSize(file.size)}</span>
              <button onClick={() => handleDelete(file.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : effectiveDriveFolder ? (
        <p className="text-[10px] text-gray-400 italic text-center py-2">No files in this folder yet.</p>
      ) : (
        <p className="text-[10px] text-gray-400 italic text-center py-2">No Drive folder connected. Paste a URL or create one.</p>
      )}

      {/* Refresh button */}
      {effectiveDriveFolder && !loadingFiles && (
        <button onClick={() => loadDriveFiles()} className="text-[9px] text-gray-400 hover:text-np-blue">
          Refresh files
        </button>
      )}
    </div>
  )
}

import type { CardConfig } from '@/app/(dashboard)/crm/pipelines/page'

interface ContactDetailProps {
  contactId: string | null
  onClose: () => void
  onUpdate?: () => void
  cardConfig?: CardConfig
}

export default function ContactDetail({ contactId, onClose, onUpdate, cardConfig }: ContactDetailProps) {
  const show = (key: keyof NonNullable<CardConfig>['sections']) =>
    !cardConfig || cardConfig.sections[key] !== false
  const supabase = createClient()
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [tab, setTab] = useState<'overview' | 'intel' | 'connections' | 'timeline' | 'tasks' | 'notes' | 'comms' | 'stats'>('overview')
  const [engagementTopics, setEngagementTopics] = useState<any[]>([])
  const [showEngagementForm, setShowEngagementForm] = useState(false)
  const [engTopic, setEngTopic] = useState('')
  const [engChannel, setEngChannel] = useState('email')
  const [engResponse, setEngResponse] = useState(false)
  const [engSentiment, setEngSentiment] = useState('neutral')
  const [engNotes, setEngNotes] = useState('')
  const [referralChain, setReferralChain] = useState<any[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [calls, setCalls] = useState<CallLog[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [pipelineResources, setPipelineResources] = useState<any[]>([])
  const [emailResourceAttach, setEmailResourceAttach] = useState<any | null>(null)
  const [newNote, setNewNote] = useState('')
  const [newTag, setNewTag] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showTaskCreate, setShowTaskCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<CrmTask | null>(null)
  const [showEmailComposer, setShowEmailComposer] = useState(false)
  const [emailInitialSubject, setEmailInitialSubject] = useState('')
  const [emailInitialBody, setEmailInitialBody] = useState('')
  const [relationships, setRelationships] = useState<ContactRelationship[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [showAddConnection, setShowAddConnection] = useState(false)
  const [connForm, setConnForm] = useState({ to_contact_id: '', relationship_type: '', strength: 3, notes: '' })
  const [connSearch, setConnSearch] = useState('')
  const [allContacts, setAllContacts] = useState<CrmContact[]>([])
  const [connSearching, setConnSearching] = useState(false)
  const [expandedComm, setExpandedComm] = useState<'calls' | 'texts' | 'emails' | null>(null)
  const [conversations, setConversations] = useState<any[]>([])
  const [editingInfo, setEditingInfo] = useState(false)
  const [tagCategories, setTagCategories] = useState<ContactTagCategory[]>([])
  const [contactTagIds, setContactTagIds] = useState<Set<string>>(new Set())
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [showSeqEnroll, setShowSeqEnroll] = useState(false)
  const [availableSequences, setAvailableSequences] = useState<{ id: string; name: string }[]>([])
  const [enrollingSeq, setEnrollingSeq] = useState(false)
  const [pipelineConfigs, setPipelineConfigs] = useState<{ id: string; name: string; stages: { name: string; color: string }[]; is_default?: boolean }[]>([])
  const [infoForm, setInfoForm] = useState({
    source: '', address_street: '', address_city: '', address_state: '', address_zip: '',
    reason_for_contact: '', date_of_birth: '', preferred_name: '', timezone: 'America/New_York',
    preferred_contact_method: '', occupation: '', industry: '', how_heard_about_us: '',
    instagram_handle: '', linkedin_url: '', twitter_handle: '', tiktok_handle: '',
    youtube_url: '', facebook_url: '', website_url: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    referred_by_contact_id: '', referred_by_search: '',
    due_date: '', due_date_action: '',
  })
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerForm, setHeaderForm] = useState({ first_name: '', last_name: '', email: '', phone: '', company: '' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mediaAppearances, setMediaAppearances] = useState<{ id: string; title: string; platform: string | null; status: string; type: string }[]>([])

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    try {
      const c = await fetchContact(contactId)
      setContact(c)
      setInfoForm({
        source: c.source || '',
        address_street: c.address_street || '', address_city: c.address_city || '',
        address_state: c.address_state || '', address_zip: c.address_zip || '',
        reason_for_contact: c.reason_for_contact || '', date_of_birth: c.date_of_birth || '',
        preferred_name: c.preferred_name || '', timezone: c.timezone || 'America/New_York',
        preferred_contact_method: c.preferred_contact_method || '',
        occupation: c.occupation || '', industry: c.industry || '',
        how_heard_about_us: c.how_heard_about_us || '',
        instagram_handle: c.instagram_handle || '', linkedin_url: c.linkedin_url || '',
        twitter_handle: (c as any).twitter_handle || '', tiktok_handle: (c as any).tiktok_handle || '',
        youtube_url: (c as any).youtube_url || '', facebook_url: (c as any).facebook_url || '',
        website_url: (c as any).website_url || '',
        emergency_contact_name: c.emergency_contact_name || '',
        emergency_contact_phone: c.emergency_contact_phone || '',
        referred_by_contact_id: c.referred_by_contact_id || '', referred_by_search: '',
        due_date: (c as any).due_date || '', due_date_action: (c as any).due_date_action || '',
      })

      // Load supplemental data independently
      fetchNotes(contactId).then(setNotes).catch(e => console.warn('Notes load skipped:', e))
      fetchTasks({ contact_id: contactId }).then(setTasks).catch(e => console.warn('Tasks load skipped:', e))
      fetchCallLogs(contactId, 20).then(setCalls).catch(e => console.warn('Calls load skipped:', e))
      fetchConversations().then(convs => {
        setConversations(convs.filter(cv => cv.contact_id === contactId))
      }).catch(e => console.warn('Conversations load skipped:', e))
      fetchTagCategories().then(setTagCategories).catch(e => console.warn('Tag categories load skipped:', e))
      fetchContactStructuredTags(contactId).then(tags => {
        setContactTagIds(new Set(tags.map((t: any) => t.tag_definition_id)))
      }).catch(e => console.warn('Structured tags load skipped:', e))

      // Load pipeline configurations
      supabase.from('org_settings').select('setting_value')
        .eq('org_id', c.org_id).eq('setting_key', 'crm_pipelines').maybeSingle()
        .then(({ data }) => {
          if (data?.setting_value?.pipelines) setPipelineConfigs(data.setting_value.pipelines)
        })
      fetchContactRelationships(contactId).then(setRelationships).catch(e => console.warn('Relationships load skipped:', e))
      fetchRelationshipTypes(c.org_id).then(setRelTypes).catch(e => console.warn('RelTypes load skipped:', e))
      fetchContacts({ org_id: c.org_id, limit: 200 }).then(res => setAllContacts(res.contacts.filter(ct => ct.id !== contactId))).catch(e => console.warn('Contacts load skipped:', e))

      // Load team members for RACI (status='active' matches actual DB column)
      supabase.from('team_profiles').select('*').eq('org_id', c.org_id).eq('status', 'active')
        .then(({ data }) => { if (data) setTeamMembers(data as TeamMember[]) })

      // Load pipeline resources for this contact's stage
      supabase.from('pipeline_resources').select('*').eq('org_id', c.org_id).eq('is_active', true).order('sort_order')
        .then(({ data }) => { if (data) setPipelineResources(data) })

      // Timeline
      try {
        const { data } = await supabase
          .from('contact_timeline')
          .select('*')
          .eq('contact_id', contactId)
          .order('occurred_at', { ascending: false })
          .limit(50)
        setTimeline(data || [])
      } catch (e) { console.warn('Timeline load skipped:', e) }

      // Engagement topics
      Promise.resolve(supabase.from('contact_engagement_topics').select('*').eq('contact_id', contactId).order('outreach_date', { ascending: false }))
        .then(({ data }: { data: any }) => { if (data) setEngagementTopics(data) }).catch(() => {})

      // Media appearances where this contact is the host
      supabase.from('media_appearances').select('id, title, platform, status, type')
        .eq('host_contact_id', contactId).order('created_at', { ascending: false })
        .then(({ data }) => { if (data) setMediaAppearances(data) })

      // Referral chain (walk up referred_by chain)
      const chain: any[] = []
      let current = c
      let depth = 0
      while (current?.referred_by_contact_id && depth < 10) {
        try {
          const ref = await fetchContact(current.referred_by_contact_id)
          if (ref) { chain.push(ref); current = ref; depth++ }
          else break
        } catch { break }
      }
      setReferralChain(chain)
    } catch (e) { console.error('ContactDetail load error:', e) }
    setLoading(false)
  }, [contactId])

  useEffect(() => { load() }, [load])

  // Realtime: re-fetch tasks when they change (from Kanban board moves)
  useEffect(() => {
    if (!contactId) return
    const ch = supabase.channel(`contact-tasks-${contactId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tasks',
        filter: `contact_id=eq.${contactId}`
      }, () => {
        fetchTasks({ contact_id: contactId }).then(setTasks).catch(() => {})
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [contactId])

  if (!contactId) return null

  const health = HEALTH_CONFIG[contact?.health_tier || 'stable'] || HEALTH_CONFIG.stable
  const mastermind = contact?.mastermind_status ? MASTERMIND_STATUS[contact.mastermind_status] : null

  const handleAddNote = async () => {
    if (!newNote.trim() || !contact) return
    await createNote({ contact_id: contact.id, org_id: contact.org_id, body: newNote, type: 'manual' })
    setNewNote('')
    load()
  }

  const handleAddTag = async () => {
    if (!newTag.trim() || !contact) return
    const tags = [...(contact.tags || []), newTag.trim()]
    await updateContact(contact.id, { tags })
    setNewTag('')
    load()
    onUpdate?.()
  }

  const removeTag = async (tag: string) => {
    if (!contact) return
    const tags = (contact.tags || []).filter(t => t !== tag)
    await updateContact(contact.id, { tags })
    load()
    onUpdate?.()
  }

  const handleToggleTask = async (task: CrmTask) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    try {
      await updateTask(task.id, { status: newStatus })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    } catch (e) { console.error(e) }
  }

  const handleChangeTaskStatus = async (taskId: string, status: string) => {
    try {
      await updateTask(taskId, { status: status as any })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: status as any } : t))
    } catch (e) { console.error(e) }
  }

  const handleTaskUpdate = (id: string, updates: Partial<CrmTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    setSelectedTask(prev => prev?.id === id ? { ...prev, ...updates } : prev)
  }

  const handleConnSearch = async (q: string) => {
    setConnSearch(q)
  }

  const filteredContacts = allContacts.filter(c => {
    if (!connSearch) return true
    const name = `${c.first_name} ${c.last_name}`.toLowerCase()
    return name.includes(connSearch.toLowerCase())
  })

  const handleAddConnection = async () => {
    if (!contact || !connForm.to_contact_id || !connForm.relationship_type) return
    try {
      await createRelationship({
        org_id: contact.org_id,
        from_contact_id: contact.id,
        to_contact_id: connForm.to_contact_id,
        relationship_type: connForm.relationship_type,
        strength: connForm.strength,
        notes: connForm.notes || undefined,
      })
      setConnForm({ to_contact_id: '', relationship_type: '', strength: 3, notes: '' })
      setConnSearch('')
      load()
    } catch (e) { console.error(e); alert('Failed to create connection') }
  }

  const handleDeleteConnection = async (relId: string) => {
    try { await deleteRelationship(relId); load() }
    catch (e) { console.error(e) }
  }

  const openSeqEnroll = async () => {
    setShowSeqEnroll(true)
    const { data } = await supabase.from('sequences').select('id, name').eq('is_active', true).order('name')
    setAvailableSequences(data || [])
  }

  const handleSeqEnroll = async (sequenceId: string) => {
    if (!contact) return
    setEnrollingSeq(true)
    try {
      const res = await fetch('/api/sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence_id: sequenceId, contact_id: contact.id }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to enroll'); return }
      setShowSeqEnroll(false)
      load()
    } catch (e) { console.error(e); alert('Failed to enroll') }
    finally { setEnrollingSeq(false) }
  }

  const handleSaveInfo = async () => {
    if (!contact) return
    try {
      await updateContact(contact.id, {
        source: infoForm.source || null,
        address_street: infoForm.address_street || null,
        address_city: infoForm.address_city || null,
        address_state: infoForm.address_state || null,
        address_zip: infoForm.address_zip || null,
        reason_for_contact: infoForm.reason_for_contact || null,
        date_of_birth: infoForm.date_of_birth || null,
        preferred_name: infoForm.preferred_name || null,
        timezone: infoForm.timezone || null,
        preferred_contact_method: infoForm.preferred_contact_method || null,
        occupation: infoForm.occupation || null,
        industry: infoForm.industry || null,
        how_heard_about_us: infoForm.how_heard_about_us || null,
        instagram_handle: infoForm.instagram_handle || null,
        linkedin_url: infoForm.linkedin_url || null,
        twitter_handle: infoForm.twitter_handle || null,
        tiktok_handle: infoForm.tiktok_handle || null,
        youtube_url: infoForm.youtube_url || null,
        facebook_url: infoForm.facebook_url || null,
        website_url: infoForm.website_url || null,
        emergency_contact_name: infoForm.emergency_contact_name || null,
        emergency_contact_phone: infoForm.emergency_contact_phone || null,
        referred_by_contact_id: infoForm.referred_by_contact_id || null,
        due_date: infoForm.due_date || null,
        due_date_action: infoForm.due_date_action || null,
        due_date_notified: infoForm.due_date ? false : null,
      } as any)
      setEditingInfo(false)
      load()
      onUpdate?.()
    } catch (e) { console.error(e) }
  }

  const handleToggleTag = async (tagDefId: string) => {
    if (!contact) return
    try {
      if (contactTagIds.has(tagDefId)) {
        await removeContactTag(contact.id, tagDefId)
        setContactTagIds(prev => { const n = new Set(prev); n.delete(tagDefId); return n })
      } else {
        await addContactTag(contact.id, tagDefId, contact.org_id)
        setContactTagIds(prev => new Set(prev).add(tagDefId))
      }
      load()
      onUpdate?.()
    } catch (e) { console.error(e) }
  }

  const handleLogEngagement = async () => {
    if (!contact || !engTopic.trim()) return
    try {
      await supabase.from('contact_engagement_topics').insert({
        org_id: contact.org_id,
        contact_id: contact.id,
        topic: engTopic.trim(),
        channel: engChannel,
        got_response: engResponse,
        response_sentiment: engResponse ? engSentiment : null,
        response_notes: engNotes || null,
      })
      // Refresh
      const { data } = await supabase.from('contact_engagement_topics').select('*').eq('contact_id', contact.id).order('outreach_date', { ascending: false })
      if (data) setEngagementTopics(data)
      // Recompute stats
      try { await supabase.rpc('compute_engagement_stats', { p_contact_id: contact.id }) } catch {}
      setShowEngagementForm(false)
      setEngTopic(''); setEngNotes(''); setEngResponse(false); setEngSentiment('neutral')
      load()
    } catch (e) { console.error(e) }
  }

  const TABS = [
    { key: 'overview', label: 'Overview', icon: User },
    { key: 'intel', label: 'Intel', icon: Lightbulb },
    { key: 'connections', label: 'Connections', icon: GitBranch },
    { key: 'timeline', label: 'Timeline', icon: Activity },
    { key: 'tasks', label: 'Tasks', icon: CheckCircle2 },
    { key: 'notes', label: 'Notes', icon: FileText },
    { key: 'comms', label: 'Comms', icon: MessageCircle },
    { key: 'stats', label: 'Stats', icon: BarChart3 },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white shadow-2xl border-l border-gray-100 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-gray-400">Loading contact...</div>
          </div>
        ) : contact ? (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-np-blue flex items-center justify-center text-white font-bold text-sm">
                    {contact.first_name[0]}{contact.last_name?.[0] || ''}
                  </div>
                  {editingHeader ? (
                    <div className="space-y-1.5">
                      <div className="flex gap-1.5">
                        <input value={headerForm.first_name} onChange={e => setHeaderForm(p => ({ ...p, first_name: e.target.value }))}
                          placeholder="First name" className="w-24 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                        <input value={headerForm.last_name} onChange={e => setHeaderForm(p => ({ ...p, last_name: e.target.value }))}
                          placeholder="Last name" className="w-24 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                      </div>
                      <div className="flex gap-1.5">
                        <input value={headerForm.email} onChange={e => setHeaderForm(p => ({ ...p, email: e.target.value }))}
                          placeholder="Email" className="w-36 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                        <input value={headerForm.phone} onChange={e => setHeaderForm(p => ({ ...p, phone: e.target.value }))}
                          placeholder="Phone" className="w-28 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                      </div>
                      <input value={headerForm.company} onChange={e => setHeaderForm(p => ({ ...p, company: e.target.value }))}
                        placeholder="Company" className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                      <div className="flex gap-1.5">
                        <button onClick={async () => {
                          try {
                            await updateContact(contact.id, {
                              first_name: headerForm.first_name || contact.first_name,
                              last_name: headerForm.last_name,
                              email: headerForm.email || undefined,
                              phone: headerForm.phone || undefined,
                              company: headerForm.company || undefined,
                            } as any)
                            setEditingHeader(false); load(); onUpdate?.()
                          } catch (e: any) { alert('Save failed: ' + (e?.message || '')) }
                        }}
                          className="px-2.5 py-1 text-[10px] font-bold text-white bg-np-blue rounded-md hover:bg-np-dark">Save</button>
                        <button onClick={() => setEditingHeader(false)} className="px-2.5 py-1 text-[10px] text-gray-400">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-sm font-bold text-np-dark">{contact.first_name} {contact.last_name}</h3>
                      {(contact as any).company && <p className="text-[10px] text-gray-400">{(contact as any).company}</p>}
                      <div className="flex items-center gap-2 mt-0.5">
                        {contact.pipeline_stage && (
                          <span className="text-[9px] font-bold bg-np-blue/10 text-np-blue px-1.5 py-0.5 rounded">{contact.pipeline_stage}</span>
                        )}
                        {mastermind && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: mastermind.color + '18', color: mastermind.color }}>
                            {mastermind.label}
                          </span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: health.bg, color: health.color }}>
                          {health.label} ({contact.health_score || 50})
                        </span>
                        {(contact as any).archived_at && (
                          <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Archived</span>
                        )}
                      </div>
                      {/* Social / contact quick links */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="text-[10px] text-gray-500 hover:text-np-blue transition-colors">{contact.email}</a>
                        )}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`} className="text-[10px] text-gray-500 hover:text-np-blue transition-colors">{contact.phone}</a>
                        )}
                        {contact.linkedin_url && (
                          <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#0A66C2] font-medium hover:underline">LinkedIn</a>
                        )}
                        {contact.instagram_handle && (() => {
                          const raw = String(contact.instagram_handle)
                          const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '').replace(/^@/, '')
                          return <a href={`https://instagram.com/${handle}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-pink-500 font-medium hover:underline">@{handle}</a>
                        })()}
                        {contact.twitter_handle && (
                          <a href={`https://x.com/${String(contact.twitter_handle).replace('@','')}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-600 font-medium hover:underline">ð• {contact.twitter_handle}</a>
                        )}
                        {contact.tiktok_handle && (
                          <a href={`https://tiktok.com/@${String(contact.tiktok_handle).replace('@','')}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-700 font-medium hover:underline">TikTok</a>
                        )}
                        {contact.youtube_url && (
                          <a href={contact.youtube_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-red-500 font-medium hover:underline">YouTube</a>
                        )}
                        {contact.website_url && (
                          <a href={contact.website_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-np-blue font-medium hover:underline">{String(contact.website_url).replace(/https?:\/\/(www\.)?/, '')}</a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!editingHeader && (
                    <>
                      <button onClick={() => {
                        setHeaderForm({
                          first_name: contact.first_name || '',
                          last_name: contact.last_name || '',
                          email: contact.email || '',
                          phone: contact.phone || '',
                          company: (contact as any).company || '',
                        })
                        setEditingHeader(true)
                      }} className="p-1.5 rounded hover:bg-gray-100" title="Edit contact">
                        <Pencil className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <button onClick={() => setShowDeleteConfirm(true)} className="p-1.5 rounded hover:bg-red-50" title="Delete contact">
                        <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                      </button>
                    </>
                  )}
                  <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
                </div>
              </div>

              {/* Delete confirmation */}
              {showDeleteConfirm && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-semibold text-red-700">Delete {contact.first_name} {contact.last_name}?</p>
                  <p className="text-[10px] text-red-600 mt-1">This will permanently remove this contact and all associated connections, notes, tasks, and activity.</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => {
                      setDeleting(true)
                      try {
                        await deleteContact(contact.id)
                        setShowDeleteConfirm(false)
                        onClose()
                        onUpdate?.()
                      } catch (e: any) { alert('Delete failed: ' + (e?.message || '')) }
                      finally { setDeleting(false) }
                    }} disabled={deleting}
                      className="px-3 py-1.5 text-[10px] font-bold text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
                      {deleting ? 'Deleting...' : 'Yes, Delete'}
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-[10px] text-gray-500">Cancel</button>
                  </div>
                </div>
              )}

              {/* Quick action buttons */}
              <div className="flex gap-2 mt-3 flex-wrap">
                <ContactCommsButtons contact={contact} size="md" onEmailClick={() => setShowEmailComposer(true)} />
                <div className="w-px h-6 bg-gray-200 self-center" />
                <button onClick={() => {
                  setHeaderForm({
                    first_name: contact.first_name || '',
                    last_name: contact.last_name || '',
                    email: contact.email || '',
                    phone: contact.phone || '',
                    company: (contact as any).company || '',
                  })
                  setInfoForm(p => ({
                    ...p,
                    source: contact.source || '',
                    address_street: contact.address_street || '',
                    address_city: contact.address_city || '',
                    address_state: contact.address_state || '',
                    address_zip: contact.address_zip || '',
                    reason_for_contact: contact.reason_for_contact || '',
                    date_of_birth: contact.date_of_birth || '',
                    preferred_name: contact.preferred_name || '',
                    timezone: contact.timezone || 'America/New_York',
                    preferred_contact_method: contact.preferred_contact_method || '',
                    occupation: contact.occupation || '',
                    industry: contact.industry || '',
                    how_heard_about_us: contact.how_heard_about_us || '',
                    instagram_handle: contact.instagram_handle || '',
                    linkedin_url: contact.linkedin_url || '',
                    twitter_handle: (contact as any).twitter_handle || '',
                    tiktok_handle: (contact as any).tiktok_handle || '',
                    youtube_url: (contact as any).youtube_url || '',
                    facebook_url: (contact as any).facebook_url || '',
                    website_url: (contact as any).website_url || '',
                    emergency_contact_name: contact.emergency_contact_name || '',
                    emergency_contact_phone: contact.emergency_contact_phone || '',
                    referred_by_contact_id: contact.referred_by_contact_id || '',
                    referred_by_search: '',
                  }))
                  setEditingInfo(true)
                }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                {!(contact as any).archived_at ? (
                  <button onClick={async () => {
                    if (!confirm('Archive this contact? They will be hidden from the main list.')) return
                    try {
                      await updateContact(contact.id, { archived_at: new Date().toISOString() } as any)
                      load(); onUpdate?.()
                    } catch (e: any) { alert('Archive failed: ' + (e?.message || '')) }
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
                    <Shield className="w-3 h-3" /> Archive
                  </button>
                ) : (
                  <button onClick={async () => {
                    try {
                      await updateContact(contact.id, { archived_at: null } as any)
                      load(); onUpdate?.()
                    } catch (e: any) { alert('Restore failed: ' + (e?.message || '')) }
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                    <Shield className="w-3 h-3" /> Restore
                  </button>
                )}
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-red-500 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
                <div className="relative">
                  <button onClick={openSeqEnroll}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
                    <Workflow className="w-3 h-3" /> Sequence
                  </button>
                  {showSeqEnroll && (
                    <div className="absolute top-full mt-1 right-0 w-56 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50">
                      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1">Enroll in Sequence</p>
                      {availableSequences.length === 0 && <p className="text-[10px] text-gray-400 px-2 py-3 text-center">No active sequences</p>}
                      {availableSequences.map(seq => (
                        <button key={seq.id} onClick={() => handleSeqEnroll(seq.id)} disabled={enrollingSeq}
                          className="w-full text-left px-2.5 py-2 text-xs text-np-dark hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50">
                          {seq.name}
                        </button>
                      ))}
                      <button onClick={() => setShowSeqEnroll(false)} className="w-full text-center text-[10px] text-gray-400 mt-1 py-1 hover:text-gray-600">Cancel</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Tags */}
              {/* Tag pills (compact, managed in Overview tab) */}
              {(contact.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {(contact.tags || []).slice(0, 5).map(tag => (
                    <span key={tag} className="text-[9px] font-medium bg-np-blue/8 text-np-blue px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                  {(contact.tags?.length || 0) > 5 && <span className="text-[9px] text-gray-400">+{contact.tags!.length - 5}</span>}
                </div>
              )}
            </div>

            {/* Tab bar */}
            <div className="flex gap-0.5 px-3 py-1.5 border-b border-gray-100 flex-shrink-0 bg-gray-50/50 overflow-x-auto">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all whitespace-nowrap ${
                    tab === t.key ? 'bg-white shadow-sm text-np-blue' : 'text-gray-500 hover:text-np-dark'
                  }`}>
                  <t.icon className="w-3 h-3" /> {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* OVERVIEW TAB */}
              {tab === 'overview' && (
                <>
                  {/* Contact Info Card */}
                  {show('contact_info') && (() => {
                    const hasPhone = !!contact.phone
                    const hasEmail = !!contact.email
                    const hasAddress = !!(contact.address_street || contact.address_city)
                    const hasProfessional = !!(contact.occupation || contact.industry || contact.custom_fields?.company)
                    const hasSocial = !!(contact.instagram_handle || contact.linkedin_url || contact.how_heard_about_us || contact.referred_by_contact)
                    const hasAny = hasPhone || hasEmail || !!contact.preferred_name || hasAddress || !!contact.reason_for_contact || hasProfessional || !!contact.date_of_birth || hasSocial
                    const cfg = cardConfig
                    const empty = (label: string) => (
                      <button onClick={() => setEditingInfo(true)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-np-blue/5 transition-colors group">
                        <div className="w-3.5 h-3.5 rounded-full border border-dashed border-gray-300 flex-shrink-0 group-hover:border-np-blue/50 transition-colors" />
                        <p className="text-[11px] text-gray-400 italic group-hover:text-np-blue transition-colors">+ Add {label}</p>
                      </button>
                    )
                    return (
                      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                        {contact.preferred_name && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <User className="w-3.5 h-3.5 text-np-blue flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Goes By</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.preferred_name}</p>
                            </div>
                          </div>
                        )}
                        {hasPhone ? (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Phone className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Phone</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.phone}</p>
                            </div>
                            {contact.preferred_contact_method && (
                              <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-np-blue/10 text-np-blue">Prefers {contact.preferred_contact_method}</span>
                            )}
                          </div>
                        ) : cfg && empty('Phone')}
                        {hasEmail ? (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Mail className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Email</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.email}</p>
                            </div>
                          </div>
                        ) : cfg && empty('Email')}
                        {show('address') && (hasAddress ? (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <MapPin className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Address</p>
                              <p className="text-[12px] font-medium text-np-dark">
                                {[contact.address_street, contact.address_city, contact.address_state, contact.address_zip].filter(Boolean).join(', ')}
                              </p>
                            </div>
                          </div>
                        ) : cfg && empty('Address'))}
                        {contact.reason_for_contact && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Target className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Primary Reason</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.reason_for_contact}</p>
                            </div>
                          </div>
                        )}
                        {show('professional') && (hasProfessional ? (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Professional</p>
                              <p className="text-[12px] font-medium text-np-dark">
                                {[contact.occupation, contact.industry, contact.custom_fields?.company as string].filter(Boolean).join(' Ã‚Â· ')}
                              </p>
                            </div>
                          </div>
                        ) : cfg && empty('Occupation / Industry'))}
                        {contact.date_of_birth && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Calendar className="w-3.5 h-3.5 text-pink-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Date of Birth</p>
                              <p className="text-[12px] font-medium text-np-dark">{new Date(contact.date_of_birth + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                          </div>
                        )}
                        {show('social_attribution') && ((contact.instagram_handle || contact.linkedin_url) ? (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <ExternalLink className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Social</p>
                              <div className="flex gap-3">
                                {contact.instagram_handle && (() => {
                                  const raw = String(contact.instagram_handle)
                                  const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '').replace(/^@/, '')
                                  return <a href={`https://instagram.com/${handle}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-pink-500 hover:underline">@{handle}</a>
                                })()}
                                {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#0A66C2] hover:underline">LinkedIn</a>}
                                {contact.twitter_handle && <a href={`https://x.com/${String(contact.twitter_handle).replace('@','')}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-700 hover:underline">ð• {contact.twitter_handle}</a>}
                                {contact.tiktok_handle && <a href={`https://tiktok.com/@${String(contact.tiktok_handle).replace('@','')}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-700 hover:underline">TikTok</a>}
                                {contact.youtube_url && <a href={contact.youtube_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-red-500 hover:underline">YouTube</a>}
                                {contact.website_url && <a href={contact.website_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-np-blue hover:underline">{String(contact.website_url).replace(/https?:\/\/(www\.)?/, '')}</a>}
                              </div>
                            </div>
                          </div>
                        ) : cfg && empty('Social handles'))}
                        {show('social_attribution') && contact.how_heard_about_us && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Route className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">How They Found Us</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.how_heard_about_us}</p>
                            </div>
                          </div>
                        )}
                        {show('social_attribution') && contact.referred_by_contact && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Heart className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Referred By</p>
                              <p className="text-[12px] font-medium text-np-dark">{contact.referred_by_contact.first_name} {contact.referred_by_contact.last_name}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Emergency + Consent + Billing row */}
                  {(show('consent_billing') || show('emergency_contact')) && <div className="grid grid-cols-3 gap-2">
                    {show('emergency_contact') && (contact.emergency_contact_name ? (
                      <div className="bg-red-50/50 rounded-lg p-2 border border-red-100/50">
                        <p className="text-[8px] font-bold text-red-500 uppercase">Emergency</p>
                        <p className="text-[10px] font-medium text-np-dark mt-0.5">{contact.emergency_contact_name}</p>
                        <p className="text-[9px] text-gray-400">{contact.emergency_contact_phone}</p>
                      </div>
                    ) : cardConfig && (
                      <button onClick={() => setEditingInfo(true)}
                        className="rounded-lg p-2 border border-dashed border-gray-200 bg-gray-50/50 hover:border-np-blue/40 hover:bg-np-blue/5 transition-colors text-left w-full">
                        <p className="text-[8px] font-bold text-gray-400 uppercase">Emergency</p>
                        <p className="text-[10px] text-gray-300 italic mt-0.5">+ Add contact</p>
                      </button>
                    ))}
                    <div className={`rounded-lg p-2 border ${contact.informed_consent_signed ? 'bg-green-50/50 border-green-100/50' : 'bg-amber-50/50 border-amber-100/50'}`}>
                      <p className="text-[8px] font-bold uppercase" style={{ color: contact.informed_consent_signed ? '#16a34a' : '#d97706' }}>Consent</p>
                      <p className="text-[10px] font-medium text-np-dark mt-0.5">{contact.informed_consent_signed ? 'Signed' : 'Not Signed'}</p>
                      {contact.informed_consent_signed_at && <p className="text-[8px] text-gray-400">{new Date(contact.informed_consent_signed_at).toLocaleDateString()}</p>}
                    </div>
                    <div className={`rounded-lg p-2 border ${contact.billing_info_saved ? 'bg-green-50/50 border-green-100/50' : 'bg-gray-50 border-gray-100'}`}>
                      <p className="text-[8px] font-bold uppercase" style={{ color: contact.billing_info_saved ? '#16a34a' : '#6b7280' }}>Billing</p>
                      <p className="text-[10px] font-medium text-np-dark mt-0.5">{contact.billing_info_saved ? 'Saved' : 'None'}</p>
                    </div>
                  </div>}

                  {/* Due Date */}
                  <div className={`rounded-lg p-2 border ${(contact as any).due_date ? 'bg-amber-50/50 border-amber-100/50' : 'bg-gray-50 border-gray-100'}`}>
                    <p className="text-[8px] font-bold uppercase" style={{ color: (contact as any).due_date ? '#d97706' : '#6b7280' }}>Due Date</p>
                    {(contact as any).due_date ? (
                      <>
                        <p className="text-[10px] font-medium text-np-dark mt-0.5">{new Date((contact as any).due_date + 'T00:00:00').toLocaleDateString()}</p>
                        {(contact as any).due_date_action && <p className="text-[9px] text-gray-500 mt-0.5">{(contact as any).due_date_action}</p>}
                      </>
                    ) : (
                      <p className="text-[10px] font-medium text-np-dark mt-0.5">None</p>
                    )}
                  </div>

                  {/* Subscription Banner */}
                  {contact.subscription_status && (
                    <div className={`rounded-xl p-3 border ${contact.subscription_status === 'active' ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-100' : contact.subscription_status === 'past_due' ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: contact.subscription_status === 'active' ? '#059669' : contact.subscription_status === 'past_due' ? '#d97706' : '#6b7280' }}>
                            Subscription: {contact.subscription_status}
                          </p>
                          {contact.subscription_plan && <p className="text-[11px] font-medium text-np-dark mt-0.5">{contact.subscription_plan}</p>}
                        </div>
                        <div className="text-right">
                          {contact.subscription_start && <p className="text-[9px] text-gray-400">Start: {new Date(contact.subscription_start).toLocaleDateString()}</p>}
                          {contact.subscription_end && <p className="text-[9px] text-gray-400">Expires: {new Date(contact.subscription_end).toLocaleDateString()}</p>}
                        </div>
                      </div>
                    </div>
                  )}


                  {/* Demographics */}
                  {show('demographics') && (contact.race || contact.gender_identity || contact.ethnicity || contact.primary_language || contact.education_level || contact.household_income_range || contact.marital_status || contact.disability_status || contact.veteran_status) && (
                    <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                      <div className="px-3 py-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Demographics</span>
                      </div>
                      {contact.gender_identity && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Gender Identity</p><p className="text-[11px] font-medium text-np-dark">{contact.gender_identity}</p></div></div>}
                      {contact.sex_assigned_at_birth && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Sex Assigned at Birth</p><p className="text-[11px] font-medium text-np-dark">{contact.sex_assigned_at_birth}</p></div></div>}
                      {contact.race && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Race</p><p className="text-[11px] font-medium text-np-dark">{contact.race}</p></div></div>}
                      {contact.ethnicity && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Ethnicity</p><p className="text-[11px] font-medium text-np-dark">{contact.ethnicity}</p></div></div>}
                      {contact.primary_language && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Primary Language</p><p className="text-[11px] font-medium text-np-dark">{contact.primary_language}</p></div></div>}
                      {contact.marital_status && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Marital Status</p><p className="text-[11px] font-medium text-np-dark">{contact.marital_status}</p></div></div>}
                      {contact.education_level && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Education</p><p className="text-[11px] font-medium text-np-dark">{contact.education_level}</p></div></div>}
                      {contact.household_income_range && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Household Income</p><p className="text-[11px] font-medium text-np-dark">{contact.household_income_range}</p></div></div>}
                      {contact.veteran_status && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Veteran Status</p><p className="text-[11px] font-medium text-np-dark">Veteran</p></div></div>}
                      {contact.disability_status && <div className="flex items-center gap-3 px-3 py-2"><div className="flex-1"><p className="text-[9px] text-gray-400 uppercase tracking-wider">Disability Status</p><p className="text-[11px] font-medium text-np-dark">{contact.disability_status}</p></div></div>}
                    </div>
                  )}

                  {/* Minor / Guardian */}
                  {show('minor_guardian') && contact.is_minor && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wider mb-2">Minor Client</p>
                      {(contact.guardian_first_name || contact.guardian_last_name) && (
                        <p className="text-xs font-semibold text-np-dark">{contact.guardian_first_name} {contact.guardian_last_name}</p>
                      )}
                      {contact.guardian_relationship && <p className="text-[10px] text-gray-500">{contact.guardian_relationship}</p>}
                      {contact.guardian_phone && <p className="text-[10px] text-gray-500">{contact.guardian_phone}</p>}
                      {contact.guardian_email && <p className="text-[10px] text-gray-500">{contact.guardian_email}</p>}
                    </div>
                  )}

                  {/* Tag Picker Dropdown */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Tags
                    </h4>
                    {/* Current tags */}
                    <div className="flex flex-wrap gap-1">
                      {(contact.tags || []).map(tag => {
                        const tagDef = tagCategories.flatMap((cat: any) => cat.tags || []).find((t: any) => t.name === tag)
                        const color = tagDef?.color || '#94a3b8'
                        return (
                          <span key={tag} className="inline-flex items-center gap-0.5 text-[9px] font-medium px-2 py-0.5 rounded-full group"
                            style={{ backgroundColor: color + '18', color }}>
                            {tag}
                            <button onClick={() => {
                              if (tagDef) { removeContactTag(contact.id, tagDef.id).then(() => { load(); onUpdate?.() }).catch(console.error) }
                              else { removeTag(tag) }
                            }} className="opacity-0 group-hover:opacity-100 hover:text-red-500 ml-0.5">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                    {/* Dropdown to add tags */}
                    <div className="relative">
                      <select
                        value=""
                        onChange={async (e) => {
                          const val = e.target.value
                          if (val === '__custom__') {
                            const custom = prompt('Enter custom tag name:')
                            if (custom?.trim() && contact) {
                              const tags = [...(contact.tags || []), custom.trim()]
                              await updateContact(contact.id, { tags })
                              load(); onUpdate?.()
                            }
                          } else if (val) {
                            await handleToggleTag(val)
                          }
                        }}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white appearance-none cursor-pointer"
                      >
                        <option value="">+ Add tag...</option>
                        {tagCategories.map(cat => (
                          <optgroup key={cat.id} label={cat.name}>
                            {(cat as any).tags?.filter((t: any) => !contactTagIds.has(t.id)).map((tag: any) => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                          </optgroup>
                        ))}
                        <option value="__custom__">Type a custom tag...</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Edit Info */}
                  {!editingInfo ? (
                    <button onClick={() => setEditingInfo(true)}
                      className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-np-blue transition-colors">
                      <Pencil className="w-2.5 h-2.5" /> Edit all contact info
                    </button>
                  ) : null}

                  {/* Full Edit Modal */}
                  {editingInfo && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setEditingInfo(false)} />
                      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        {/* Modal header */}
                        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
                          <div>
                            <h3 className="text-sm font-bold text-np-dark">Edit Contact</h3>
                            <p className="text-[10px] text-gray-400 mt-0.5">{contact.first_name} {contact.last_name}</p>
                          </div>
                          <button onClick={() => setEditingInfo(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                            <X className="w-4 h-4 text-gray-400" />
                          </button>
                        </div>

                        <div className="px-5 py-4 space-y-5">

                          {/* Section: Name & Contact */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Name & Contact</p>
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">First Name</label>
                                  <input value={headerForm.first_name} onChange={e => setHeaderForm(p => ({ ...p, first_name: e.target.value }))}
                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Last Name</label>
                                  <input value={headerForm.last_name} onChange={e => setHeaderForm(p => ({ ...p, last_name: e.target.value }))}
                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Email</label>
                                  <input type="email" value={headerForm.email} onChange={e => setHeaderForm(p => ({ ...p, email: e.target.value }))}
                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Phone</label>
                                  <input type="tel" value={headerForm.phone} onChange={e => setHeaderForm(p => ({ ...p, phone: e.target.value }))}
                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Company</label>
                                  <input value={headerForm.company} onChange={e => setHeaderForm(p => ({ ...p, company: e.target.value }))}
                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                                <div>
                                  <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Preferred Name</label>
                                  <input value={infoForm.preferred_name} onChange={e => setInfoForm(p => ({ ...p, preferred_name: e.target.value }))}
                                    placeholder="Nickname" className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Section: Social Media & Web */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Social Media & Web</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Instagram</label>
                                <input value={infoForm.instagram_handle} onChange={e => setInfoForm(p => ({ ...p, instagram_handle: e.target.value }))}
                                  placeholder="@handle or URL" className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">X / Twitter</label>
                                <input value={infoForm.twitter_handle} onChange={e => setInfoForm(p => ({ ...p, twitter_handle: e.target.value }))}
                                  placeholder="@handle" className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">TikTok</label>
                                <input value={infoForm.tiktok_handle} onChange={e => setInfoForm(p => ({ ...p, tiktok_handle: e.target.value }))}
                                  placeholder="@handle" className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">LinkedIn</label>
                                <input value={infoForm.linkedin_url} onChange={e => setInfoForm(p => ({ ...p, linkedin_url: e.target.value }))}
                                  placeholder="https://linkedin.com/in/..." className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">YouTube</label>
                                <input value={infoForm.youtube_url} onChange={e => setInfoForm(p => ({ ...p, youtube_url: e.target.value }))}
                                  placeholder="https://youtube.com/@..." className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Website</label>
                                <input value={infoForm.website_url} onChange={e => setInfoForm(p => ({ ...p, website_url: e.target.value }))}
                                  placeholder="https://..." className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                            </div>
                          </div>

                          {/* Section: Professional */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Professional</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Occupation</label>
                                <input value={infoForm.occupation} onChange={e => setInfoForm(p => ({ ...p, occupation: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Industry</label>
                                <input value={infoForm.industry} onChange={e => setInfoForm(p => ({ ...p, industry: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                            </div>
                          </div>

                          {/* Section: Personal */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Personal</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Date of Birth</label>
                                <input type="date" value={infoForm.date_of_birth} onChange={e => setInfoForm(p => ({ ...p, date_of_birth: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Timezone</label>
                                <select value={infoForm.timezone} onChange={e => setInfoForm(p => ({ ...p, timezone: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                                  {['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'].map(tz =>
                                    <option key={tz} value={tz}>{tz.replace('America/','').replace('Pacific/','').replace('_',' ')}</option>
                                  )}
                                </select>
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Preferred Contact</label>
                                <select value={infoForm.preferred_contact_method} onChange={e => setInfoForm(p => ({ ...p, preferred_contact_method: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                                  <option value="">No preference</option>
                                  <option value="call">Call</option><option value="text">Text</option><option value="email">Email</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Source</label>
                                <select value={infoForm.source} onChange={e => setInfoForm(p => ({ ...p, source: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                                  <option value="">Select source...</option>
                                  {['Website','Referral','Social Media','Event','Cold Outreach','Podcast','Workshop','Mastermind Alumni','Partner','Google Search','Conference','YouTube','Other'].map(o =>
                                    <option key={o} value={o}>{o}</option>
                                  )}
                                </select>
                              </div>
                            </div>
                            <div className="mt-2">
                              <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">How They Heard About Us</label>
                              <select value={infoForm.how_heard_about_us} onChange={e => setInfoForm(p => ({ ...p, how_heard_about_us: e.target.value }))}
                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                                <option value="">Select...</option>
                                {['Referral','Social Media','Podcast','Workshop','Google Search','Conference','YouTube','Other'].map(o =>
                                  <option key={o} value={o}>{o}</option>
                                )}
                              </select>
                            </div>
                            <div className="mt-2">
                              <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Reason for Contact</label>
                              <input value={infoForm.reason_for_contact} onChange={e => setInfoForm(p => ({ ...p, reason_for_contact: e.target.value }))}
                                placeholder="e.g. Interested in Immersive Mastermind"
                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                            </div>
                          </div>

                          {/* Section: Address */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Mailing Address</p>
                            <input value={infoForm.address_street} onChange={e => setInfoForm(p => ({ ...p, address_street: e.target.value }))}
                              placeholder="Street" className="w-full mb-1.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                            <div className="grid grid-cols-3 gap-1.5">
                              <input value={infoForm.address_city} onChange={e => setInfoForm(p => ({ ...p, address_city: e.target.value }))} placeholder="City"
                                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              <input value={infoForm.address_state} onChange={e => setInfoForm(p => ({ ...p, address_state: e.target.value }))} placeholder="State"
                                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              <input value={infoForm.address_zip} onChange={e => setInfoForm(p => ({ ...p, address_zip: e.target.value }))} placeholder="Zip"
                                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                            </div>
                          </div>

                          {/* Section: Emergency Contact */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-red-400 mb-2">Emergency Contact</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Name</label>
                                <input value={infoForm.emergency_contact_name} onChange={e => setInfoForm(p => ({ ...p, emergency_contact_name: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Phone</label>
                                <input value={infoForm.emergency_contact_phone} onChange={e => setInfoForm(p => ({ ...p, emergency_contact_phone: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                            </div>
                          </div>

                          {/* Section: Due Date Action */}
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-2">Due Date Action</p>
                            <div className="space-y-2">
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Due Date</label>
                                <input type="date" value={infoForm.due_date} onChange={e => setInfoForm(p => ({ ...p, due_date: e.target.value }))}
                                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                              <div>
                                <label className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">Action on Due Date</label>
                                <button type="button" onClick={() => setInfoForm(p => ({ ...p, due_date_action: 'Turn off access to xRegulation' }))}
                                  className={`w-full mt-0.5 px-2 py-1.5 text-xs border rounded-lg text-left transition-colors ${infoForm.due_date_action === 'Turn off access to xRegulation' ? 'border-np-blue bg-np-blue/5 text-np-blue' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                  Turn off access to xRegulation
                                </button>
                                <input value={infoForm.due_date_action === 'Turn off access to xRegulation' ? '' : infoForm.due_date_action}
                                  onChange={e => setInfoForm(p => ({ ...p, due_date_action: e.target.value }))}
                                  placeholder="Or type a custom action..."
                                  className="w-full mt-1.5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                              </div>
                            </div>
                          </div>

                        </div>

                        {/* Sticky footer */}
                        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex justify-end gap-2 rounded-b-2xl">
                          <button onClick={() => setEditingInfo(false)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                          <button onClick={async () => {
                            if (!contact) return
                            try {
                              // Save header fields (name/email/phone/company)
                              await updateContact(contact.id, {
                                first_name: headerForm.first_name || contact.first_name,
                                last_name: headerForm.last_name,
                                email: headerForm.email || undefined,
                                phone: headerForm.phone || undefined,
                                company: headerForm.company || undefined,
                              } as any)
                              // Save info fields
                              await handleSaveInfo()
                            } catch (e) { console.error(e) }
                          }} className="px-4 py-2 bg-np-blue text-white text-xs font-semibold rounded-lg hover:bg-np-blue/90 transition-colors">
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Attribution */}
                  {(contact.acquisition_source || contact.acquisition_campaign) && (
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-3 border border-purple-100/50">
                      <h4 className="text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Route className="w-3 h-3" /> Acquisition Path
                      </h4>
                      <div className="space-y-1">
                        {contact.acquisition_source && (
                          <div className="text-[10px]"><span className="text-gray-400">Source:</span> <span className="font-medium text-np-dark">{contact.acquisition_source}</span></div>
                        )}
                        {contact.acquisition_campaign && (
                          <div className="text-[10px]"><span className="text-gray-400">Campaign:</span> <span className="font-medium text-np-dark">{contact.acquisition_campaign}</span></div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mastermind Progress */}
                  {contact.mastermind_user_id && (
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-3 border border-emerald-100/50">
                      <h4 className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <GraduationCap className="w-3 h-3" /> Mastermind Program
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{
                          backgroundColor: (mastermind?.color || '#6b7280') + '18',
                          color: mastermind?.color || '#6b7280'
                        }}>
                          {mastermind?.label || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Pipeline + Stage */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Target className="w-3 h-3" /> Pipeline
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Pipeline selector */}
                      <select
                        value={contact.pipeline_id || pipelineConfigs.find(p => p.is_default)?.id || ''}
                        onChange={async (e) => {
                          const pid = e.target.value
                          if (!pid) {
                            await updateContact(contact.id, { pipeline_id: null, pipeline_stage: null } as any)
                          } else {
                            const pipeline = pipelineConfigs.find(p => p.id === pid)
                            const firstStage = pipeline?.stages?.[0]?.name || 'New Lead'
                            await updateContact(contact.id, { pipeline_id: pid, pipeline_stage: firstStage } as any)
                          }
                          load(); onUpdate?.()
                        }}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white"
                      >
                        <option value="">No pipeline</option>
                        {pipelineConfigs.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {/* Stage selector */}
                      <select
                        value={contact.pipeline_stage || ''}
                        onChange={async (e) => {
                          await updateContact(contact.id, { pipeline_stage: e.target.value } as any)
                          load(); onUpdate?.()
                        }}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white"
                      >
                        <option value="">No stage</option>
                        {(() => {
                          const contactPipeline = pipelineConfigs.find(p => p.id === contact.pipeline_id)
                            || pipelineConfigs.find(p => p.is_default)
                          return (contactPipeline?.stages || []).map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                          ))
                        })()}
                      </select>
                    </div>
                  </div>

                  {/* Files & Google Drive */}
                  <ContactDriveSection contact={contact} updateContact={updateContact} load={load} />

                  {/* Clickable Communication Counters */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Communication Activity
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => setExpandedComm(expandedComm === 'calls' ? null : 'calls')}
                        className={`rounded-lg p-2.5 text-center border transition-all ${expandedComm === 'calls' ? 'bg-green-100 border-green-300 ring-1 ring-green-200' : 'bg-green-50/50 border-green-100/50 hover:bg-green-100/50'}`}>
                        <Phone className="w-3.5 h-3.5 mx-auto text-green-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_calls || 0}</p>
                        <p className="text-[9px] text-gray-400">Calls</p>
                      </button>
                      <button onClick={() => setExpandedComm(expandedComm === 'texts' ? null : 'texts')}
                        className={`rounded-lg p-2.5 text-center border transition-all ${expandedComm === 'texts' ? 'bg-blue-100 border-blue-300 ring-1 ring-blue-200' : 'bg-blue-50/50 border-blue-100/50 hover:bg-blue-100/50'}`}>
                        <MessageCircle className="w-3.5 h-3.5 mx-auto text-blue-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_texts || 0}</p>
                        <p className="text-[9px] text-gray-400">Texts</p>
                      </button>
                      <button onClick={() => setExpandedComm(expandedComm === 'emails' ? null : 'emails')}
                        className={`rounded-lg p-2.5 text-center border transition-all ${expandedComm === 'emails' ? 'bg-amber-100 border-amber-300 ring-1 ring-amber-200' : 'bg-amber-50/50 border-amber-100/50 hover:bg-amber-100/50'}`}>
                        <Mail className="w-3.5 h-3.5 mx-auto text-amber-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_emails || 0}</p>
                        <p className="text-[9px] text-gray-400">Emails</p>
                      </button>
                    </div>

                    {/* Expanded Call History */}
                    {expandedComm === 'calls' && (
                      <div className="bg-green-50/30 rounded-xl p-2 space-y-1.5 border border-green-100/50 max-h-48 overflow-y-auto">
                        <p className="text-[9px] font-bold text-green-600 uppercase tracking-wider px-1">Call History</p>
                        {calls.length === 0 ? (
                          <p className="text-[10px] text-gray-400 text-center py-3">No calls recorded</p>
                        ) : calls.map(call => (
                          <div key={call.id} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${call.direction === 'inbound' ? 'bg-green-100' : 'bg-blue-100'}`}>
                              <Phone className={`w-2.5 h-2.5 ${call.direction === 'inbound' ? 'text-green-600' : 'text-blue-600'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-np-dark">
                                {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                                {(call.duration_seconds ?? 0) > 0 && ` Ã‚Â· ${Math.floor((call.duration_seconds ?? 0) / 60)}:${String((call.duration_seconds ?? 0) % 60).padStart(2, '0')}`}
                              </p>
                              {call.ai_summary && <p className="text-[9px] text-gray-400 truncate">{call.ai_summary}</p>}
                            </div>
                            <span className="text-[8px] text-gray-300 flex-shrink-0">{new Date(call.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Expanded Text History */}
                    {expandedComm === 'texts' && (
                      <div className="bg-blue-50/30 rounded-xl p-2 space-y-1.5 border border-blue-100/50 max-h-48 overflow-y-auto">
                        <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wider px-1">Text Messages</p>
                        {conversations.filter(cv => cv.channel === 'sms').length === 0 ? (
                          <p className="text-[10px] text-gray-400 text-center py-3">No text messages</p>
                        ) : conversations.filter(cv => cv.channel === 'sms').map(cv => (
                          <Link key={cv.id} href={`/crm/conversations?id=${cv.id}`}
                            className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg hover:bg-blue-50/50 transition-colors">
                            <MessageCircle className="w-3 h-3 text-blue-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-np-dark">{cv.unread_count > 0 ? `${cv.unread_count} unread` : 'View thread'}</p>
                            </div>
                            <span className="text-[8px] text-gray-300">{cv.last_message_at ? new Date(cv.last_message_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Expanded Email History */}
                    {expandedComm === 'emails' && (
                      <div className="bg-amber-50/30 rounded-xl p-2 space-y-1.5 border border-amber-100/50 max-h-48 overflow-y-auto">
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wider px-1">Email History</p>
                        {conversations.filter(cv => cv.channel === 'email').length === 0 ? (
                          <p className="text-[10px] text-gray-400 text-center py-3">No emails</p>
                        ) : conversations.filter(cv => cv.channel === 'email').map(cv => (
                          <Link key={cv.id} href={`/crm/conversations?id=${cv.id}`}
                            className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg hover:bg-amber-50/50 transition-colors">
                            <Mail className="w-3 h-3 text-amber-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-np-dark">{cv.unread_count > 0 ? `${cv.unread_count} unread` : 'View thread'}</p>
                            </div>
                            <span className="text-[8px] text-gray-300">{cv.last_message_at ? new Date(cv.last_message_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                          </Link>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-np-dark">{tasks.length}</p>
                        <p className="text-[8px] text-gray-400">Open Tasks</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-np-dark">{notes.length}</p>
                        <p className="text-[8px] text-gray-400">Notes</p>
                      </div>
                    </div>
                  </div>

                  {/* Custom Fields */}
                  {contact.custom_fields && Object.keys(contact.custom_fields).filter(k => k !== 'company').length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Custom Fields</h4>
                      <div className="space-y-1">
                        {Object.entries(contact.custom_fields).filter(([k]) => k !== 'company').map(([key, val]) => (
                          <div key={key} className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{key}:</span>
                            <span className="font-medium text-np-dark">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lifecycle */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lifecycle</h4>
                    <div className="text-[10px] text-gray-500">
                      Created {new Date(contact.created_at).toLocaleDateString()}
                      {contact.last_contacted_at && (
                        <span> Ã‚Â· Last contact {new Date(contact.last_contacted_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  {/* Compliance */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Compliance
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                        <div>
                          <p className="text-[11px] font-medium text-np-dark">SMS Consent</p>
                          <p className="text-[9px] text-gray-400">{contact.sms_consent ? 'Can receive text messages' : 'No consent to text'}</p>
                        </div>
                        <button
                          onClick={async () => {
                            await updateContact(contact.id, { sms_consent: !contact.sms_consent })
                            load(); onUpdate?.()
                          }}
                          className={`relative w-9 h-5 rounded-full transition-colors ${contact.sms_consent ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${contact.sms_consent ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                        <div>
                          <p className="text-[11px] font-medium text-np-dark">Do Not Contact</p>
                          <p className="text-[9px] text-gray-400">{contact.do_not_contact ? 'Blocked from all outreach' : 'Available for contact'}</p>
                        </div>
                        <button
                          onClick={async () => {
                            await updateContact(contact.id, { do_not_contact: !contact.do_not_contact })
                            load(); onUpdate?.()
                          }}
                          className={`relative w-9 h-5 rounded-full transition-colors ${contact.do_not_contact ? 'bg-red-500' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${contact.do_not_contact ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Media Appearances */}
                  {mediaAppearances.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Mic className="w-3.5 h-3.5 text-np-blue" />
                        <h4 className="text-xs font-semibold text-np-dark uppercase tracking-wider">Media Appearances</h4>
                      </div>
                      <div className="space-y-1.5">
                        {mediaAppearances.map(a => (
                          <a
                            key={a.id}
                            href="/media-affiliates"
                            className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-np-dark truncate">{a.title}</p>
                              {a.platform && <p className="text-[10px] text-gray-400">{a.platform}</p>}
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              a.status === 'aired' || a.status === 'published' ? 'bg-green-50 text-green-600' :
                              a.status === 'booked' || a.status === 'prepped' ? 'bg-blue-50 text-blue-600' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {a.status.replace(/_/g, ' ')}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* CONNECTIONS TAB */}
              {tab === 'intel' && contact && (
                <div className="space-y-4">

                  {/* â”€â”€ PARTNER SCORE â”€â”€ */}
                  {(contact.outreach_total_score || contact.alignment_score) && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue flex items-center gap-1"><Target className="w-3 h-3" /> Partner Score</p>
                        <div className="flex items-center gap-2">
                          {contact.priority_tier && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${contact.priority_tier === 'A Tier' || contact.priority_tier === 'A' ? 'bg-green-100 text-green-700' : contact.priority_tier === 'B Tier' || contact.priority_tier === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {contact.priority_tier}
                            </span>
                          )}
                          {contact.outreach_total_score && (
                            <span className="text-lg font-black text-np-dark">{contact.outreach_total_score}<span className="text-[10px] font-normal text-gray-400">/20</span></span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: 'Alignment', val: contact.alignment_score, color: 'bg-blue-500' },
                          { label: 'Commercial', val: contact.commercial_relevance_score, color: 'bg-purple-500' },
                          { label: 'Outreach Ease', val: contact.outreach_ease_score, color: 'bg-amber-500' },
                          { label: 'Credibility', val: contact.credibility_score, color: 'bg-green-500' },
                        ].map(({ label, val, color }) => (
                          <div key={label} className="text-center">
                            <p className="text-[8px] text-gray-400 mb-1">{label}</p>
                            <div className="flex gap-0.5 justify-center mb-1">
                              {[1,2,3,4,5].map(i => (
                                <div key={i} className={`w-2 h-2 rounded-sm ${i <= (val || 0) ? color : 'bg-gray-100'}`} />
                              ))}
                            </div>
                            <p className="text-[10px] font-bold text-np-dark">{val ?? 'â€”'}<span className="text-[8px] font-normal text-gray-400">/5</span></p>
                          </div>
                        ))}
                      </div>
                      {contact.fit_category && (
                        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                          {contact.fit_category && <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{contact.fit_category}</span>}
                          {contact.primary_niche && <span className="text-[9px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{contact.primary_niche}</span>}
                          {contact.audience_type && <span className="text-[9px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{contact.audience_type}</span>}
                          {contact.partnership_type && <span className="text-[9px] bg-np-blue/10 text-np-blue px-2 py-0.5 rounded-full font-medium">{contact.partnership_type}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* â”€â”€ OUTREACH STATUS â”€â”€ */}
                  <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-3 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Outreach Status</p>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <p className="text-[8px] text-gray-400 uppercase font-semibold">Status</p>
                        <span className={`inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          contact.outreach_status === 'partner' ? 'bg-green-100 text-green-700' :
                          contact.outreach_status === 'responded' || contact.outreach_status === 'in_relationship' ? 'bg-blue-100 text-blue-700' :
                          contact.outreach_status === 'contacted' ? 'bg-amber-100 text-amber-700' :
                          contact.outreach_status === 'not_a_fit' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {contact.outreach_status ? contact.outreach_status.replace(/_/g,' ').replace(/\w/g,(c:string)=>c.toUpperCase()) : 'Not Started'}
                        </span>
                      </div>
                      {contact.outreach_owner && (
                        <div>
                          <p className="text-[8px] text-gray-400 uppercase font-semibold">Owner</p>
                          <p className="text-[11px] font-semibold text-np-dark mt-0.5">{contact.outreach_owner}</p>
                        </div>
                      )}
                      {contact.outreach_last_touch && (
                        <div>
                          <p className="text-[8px] text-gray-400 uppercase font-semibold">Last Touch</p>
                          <p className="text-[11px] text-np-dark mt-0.5">{new Date(contact.outreach_last_touch).toLocaleDateString()}</p>
                        </div>
                      )}
                      {contact.outreach_follow_up_date && (
                        <div>
                          <p className="text-[8px] text-gray-400 uppercase font-semibold">Follow-up Due</p>
                          <p className={`text-[11px] font-semibold mt-0.5 ${new Date(contact.outreach_follow_up_date) < new Date() ? 'text-red-600' : 'text-np-dark'}`}>
                            {new Date(contact.outreach_follow_up_date).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>
                    {contact.outreach_next_step && (
                      <div className="bg-amber-50 rounded-lg p-2.5 mb-2">
                        <p className="text-[8px] font-bold text-amber-600 uppercase mb-0.5">Next Step</p>
                        <p className="text-[11px] text-amber-800">{contact.outreach_next_step}</p>
                      </div>
                    )}
                    {contact.outreach_response_summary && (
                      <div className="bg-gray-50 rounded-lg p-2.5">
                        <p className="text-[8px] font-bold text-gray-500 uppercase mb-0.5">Response Summary</p>
                        <p className="text-[11px] text-gray-700">{contact.outreach_response_summary}</p>
                      </div>
                    )}
                  </div>

                  {/* â”€â”€ OFFER ANGLE â”€â”€ */}
                  {contact.offer_angle && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-purple-600 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Offer Angle</p>
                      <p className="text-[11px] text-purple-800">{contact.offer_angle}</p>
                    </div>
                  )}

                  {/* â”€â”€ OUTREACH OPENER â”€â”€ */}
                  {contact.outreach_opener && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Initial Outreach Opener</p>
                        <div className="flex gap-1.5">
                          <button onClick={() => navigator.clipboard.writeText(contact.outreach_opener!)}
                            className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">Copy</button>
                          {contact.email && (
                            <button onClick={() => { setEmailInitialSubject('Partnership Opportunity â€” Neuro Progeny'); setEmailInitialBody(contact.outreach_opener!); setShowEmailComposer(true) }}
                              className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-np-blue/10 text-np-blue hover:bg-np-blue/20 transition-colors flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5" /> Send Email
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-700 leading-relaxed italic whitespace-pre-wrap">{contact.outreach_opener}</p>
                    </div>
                  )}

                  {/* â”€â”€ 10-DAY FOLLOW-UP SEQUENCE â”€â”€ */}
                  {(contact.outreach_sequence_started || contact.followup_day3_message || contact.followup_day7_message || contact.followup_day10_message) && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue flex items-center gap-1"><Clock className="w-3 h-3" /> 10-Day Follow-Up Sequence</p>
                        {contact.outreach_sequence_started && (
                          <span className="text-[9px] text-gray-400">Started {new Date(contact.outreach_sequence_started).toLocaleDateString()}</span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {[
                          { day: 3, label: 'Day 3', msg: contact.followup_day3_message, color: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-700' },
                          { day: 7, label: 'Day 7', msg: contact.followup_day7_message, color: 'border-blue-200 bg-blue-50', badge: 'bg-blue-100 text-blue-700' },
                          { day: 10, label: 'Day 10', msg: contact.followup_day10_message, color: 'border-green-200 bg-green-50', badge: 'bg-green-100 text-green-700' },
                        ].filter(f => f.msg).map(({ day, label, msg, color, badge }) => {
                          const dueDate = contact.outreach_sequence_started
                            ? new Date(new Date(contact.outreach_sequence_started).getTime() + day * 86400000)
                            : null
                          const isOverdue = dueDate && dueDate < new Date()
                          return (
                            <div key={day} className={`border rounded-lg p-3 ${color}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>{label}</span>
                                  {dueDate && (
                                    <span className={`text-[9px] ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                                      {isOverdue ? 'Overdue Â· ' : 'Due Â· '}{dueDate.toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={() => navigator.clipboard.writeText(msg!)}
                                    className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-white/60 text-gray-500 hover:bg-white transition-colors">Copy</button>
                                  {contact.email && (
                                    <button onClick={() => { setEmailInitialSubject(`Following up â€” Neuro Progeny`); setEmailInitialBody(msg!); setShowEmailComposer(true) }}
                                      className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-np-blue/10 text-np-blue hover:bg-np-blue/20 transition-colors flex items-center gap-1">
                                      <Mail className="w-2.5 h-2.5" /> Send
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-[10px] text-gray-700 leading-relaxed italic whitespace-pre-wrap">{msg}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* â”€â”€ AUDIENCE & REACH â”€â”€ */}
                  {(contact.total_est_reach || contact.instagram_followers || contact.linkedin_followers || contact.est_audience_size) && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-3 flex items-center gap-1"><Globe className="w-3 h-3" /> Audience & Reach</p>
                      {contact.total_est_reach && (
                        <div className="bg-np-blue/5 rounded-lg p-2.5 mb-3 flex items-center justify-between">
                          <p className="text-[9px] font-bold text-np-blue uppercase">Total Est. Reach</p>
                          <p className="text-base font-black text-np-dark">{Number(contact.total_est_reach).toLocaleString()}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: 'Instagram', val: contact.instagram_followers },
                          { label: 'LinkedIn', val: contact.linkedin_followers },
                          { label: 'YouTube', val: contact.youtube_subscribers },
                          { label: 'TikTok', val: contact.tiktok_followers },
                          { label: 'Twitter/X', val: contact.twitter_followers },
                          { label: 'Facebook', val: contact.facebook_followers },
                          { label: 'Podcast', val: contact.podcast_listeners },
                          { label: 'Email List', val: contact.email_list_subscribers },
                        ].filter(i => i.val).map(({ label, val }) => (
                          <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                            <p className="text-[8px] text-gray-400">{label}</p>
                            <p className="text-[11px] font-bold text-np-dark">{Number(val).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {contact.engagement_rate && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Engagement</p><p className="text-[11px] font-semibold text-np-dark">{contact.engagement_rate}</p></div>}
                        {contact.content_frequency && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Frequency</p><p className="text-[11px] font-semibold text-np-dark">{contact.content_frequency}</p></div>}
                        {contact.content_type && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Content Type</p><p className="text-[11px] font-semibold text-np-dark">{contact.content_type}</p></div>}
                      </div>
                    </div>
                  )}

                  {/* â”€â”€ MARKET INTEL â”€â”€ */}
                  {(contact.market_segment || contact.geographic_market || contact.market_opportunity_notes || contact.competitor_partnerships) && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-np-blue mb-3 flex items-center gap-1"><Brain className="w-3 h-3" /> Market Intel</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {contact.market_segment && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Segment</p><p className="text-[11px] font-semibold text-np-dark">{contact.market_segment}</p></div>}
                        {contact.geographic_market && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Geography</p><p className="text-[11px] font-semibold text-np-dark">{contact.geographic_market}</p></div>}
                        {contact.revenue_potential && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">Revenue Potential</p><p className="text-[11px] font-semibold text-np-dark">{contact.revenue_potential}</p></div>}
                        {contact.npu_sensorium_fit && <div className="bg-gray-50 rounded-lg p-2"><p className="text-[8px] text-gray-400">NPU / Sensorium Fit</p><p className="text-[11px] font-semibold text-np-dark">{contact.npu_sensorium_fit}</p></div>}
                      </div>
                      {contact.competitor_partnerships && (
                        <div className="bg-red-50 rounded-lg p-2.5 mb-2">
                          <p className="text-[8px] font-bold text-red-500 uppercase mb-0.5">Competitor Partnerships</p>
                          <p className="text-[11px] text-red-800">{contact.competitor_partnerships}</p>
                        </div>
                      )}
                      {contact.market_opportunity_notes && (
                        <div className="bg-green-50 rounded-lg p-2.5">
                          <p className="text-[8px] font-bold text-green-600 uppercase mb-0.5">Opportunity Notes</p>
                          <p className="text-[11px] text-green-800">{contact.market_opportunity_notes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* â”€â”€ SOCIAL PROFILES â”€â”€ */}
                  {(contact.linkedin_url || contact.instagram_handle || contact.twitter_handle || contact.website_url || contact.youtube_url || contact.tiktok_handle) && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1"><Globe className="w-3 h-3" /> Social Profiles</p>
                      <div className="space-y-1.5">
                        {contact.linkedin_url && (
                          <a href={contact.linkedin_url} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-[#0A66C2] hover:underline">
                            <Linkedin className="w-3 h-3" /> {contact.linkedin_url.replace(/https?:\/\/(www\.)?linkedin\.com\/in\//, '')}
                          </a>
                        )}
                        {contact.instagram_handle && (() => {
                          const raw = String(contact.instagram_handle)
                          const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '').replace(/^@/, '')
                          return <a href={`https://instagram.com/${handle}`} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-pink-600 hover:underline"><Instagram className="w-3 h-3" /> @{handle}</a>
                        })()}
                        {contact.twitter_handle && (
                          <a href={`https://x.com/${String(contact.twitter_handle).replace('@','')}`} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-gray-700 hover:underline">
                            <Twitter className="w-3 h-3" /> @{contact.twitter_handle}
                          </a>
                        )}
                        {contact.tiktok_handle && (
                          <a href={`https://tiktok.com/@${String(contact.tiktok_handle).replace('@','')}`} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-gray-700 hover:underline">
                            <Globe className="w-3 h-3" /> @{contact.tiktok_handle}
                          </a>
                        )}
                        {contact.youtube_url && (
                          <a href={contact.youtube_url} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-red-600 hover:underline">
                            <Youtube className="w-3 h-3" /> YouTube
                          </a>
                        )}
                        {contact.website_url && (
                          <a href={contact.website_url} target="_blank" rel="noopener" className="flex items-center gap-2 text-[10px] text-np-blue hover:underline">
                            <Link2 className="w-3 h-3" /> {contact.website_url.replace(/https?:\/\/(www\.)?/, '')}
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* â”€â”€ CONTACT TYPE & POPULATION â”€â”€ */}
                  {(contact.contact_type || contact.population_served) && (
                    <div className="grid grid-cols-2 gap-3">
                      {contact.contact_type && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Contact Type</p>
                          <p className="text-[11px] font-semibold text-np-dark">
                            {contact.contact_type.replace(/_/g, ' ').replace(/\w/g, (c: string) => c.toUpperCase())}
                          </p>
                        </div>
                      )}
                      {contact.population_served && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Population Served</p>
                          <p className="text-[11px] text-np-dark">{contact.population_served}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* â”€â”€ KEY DIFFERENTIATOR â”€â”€ */}
                  {contact.key_differentiator && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold text-amber-600 uppercase mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Key Differentiator</p>
                      <p className="text-[11px] text-amber-800">{contact.key_differentiator}</p>
                    </div>
                  )}

                  {/* â”€â”€ TOPICS & PRESENTATIONS â”€â”€ */}
                  {(contact.topics_of_interest?.length || contact.presentation_topics?.length) && (
                    <div className="grid grid-cols-2 gap-3">
                      {contact.topics_of_interest?.length ? (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1.5">Topics of Interest</p>
                          <div className="flex flex-wrap gap-1">
                            {contact.topics_of_interest.map((t: string) => (
                              <span key={t} className="text-[8px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {contact.presentation_topics?.length ? (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><Mic className="w-3 h-3" /> Presentations</p>
                          <div className="flex flex-wrap gap-1">
                            {contact.presentation_topics.map((t: string) => (
                              <span key={t} className="text-[8px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* â”€â”€ PUBLICATIONS â”€â”€ */}
                  {contact.publications && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[9px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><BookOpen className="w-3 h-3" /> Publications</p>
                      <p className="text-[10px] text-gray-700 whitespace-pre-wrap">{contact.publications}</p>
                    </div>
                  )}

                  {/* â”€â”€ AI RESEARCH NOTES â”€â”€ */}
                  {contact.ai_research_notes && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                      <p className="text-[9px] font-bold text-purple-600 uppercase mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> AI Research Notes</p>
                      <p className="text-[10px] text-purple-800 whitespace-pre-wrap">{contact.ai_research_notes}</p>
                    </div>
                  )}

                  {/* â”€â”€ REFERRAL CHAIN â”€â”€ */}
                  {referralChain.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[9px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1"><Route className="w-3 h-3" /> Referral Chain</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-semibold text-np-dark bg-np-blue/10 px-2 py-0.5 rounded-full">
                          {contact.first_name} {contact.last_name}
                        </span>
                        {referralChain.map((ref) => (
                          <div key={ref.id} className="flex items-center gap-1">
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                            <span className="text-[10px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                              referred by {ref.first_name} {ref.last_name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {tab === 'connections' && (
                <>
                  <button onClick={() => setShowAddConnection(!showAddConnection)}
                    className="flex items-center gap-1.5 px-3 py-2 w-full border border-dashed border-gray-200 rounded-lg text-[10px] text-gray-400 hover:border-np-blue hover:text-np-blue transition-colors mb-3">
                    <Plus className="w-3 h-3" /> Add Connection
                  </button>

                  {showAddConnection && (
                    <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2.5 border border-gray-100">
                      <h5 className="text-[10px] font-bold text-np-dark">New Connection</h5>
                      <div>
                        <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Contact</label>
                        <input value={connSearch} onChange={e => setConnSearch(e.target.value)}
                          placeholder="Filter contacts..."
                          className="w-full mt-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 mb-1" />
                        <div className="bg-white border border-gray-100 rounded-lg max-h-36 overflow-y-auto">
                          {filteredContacts.length === 0 ? (
                            <p className="text-[9px] text-gray-400 text-center py-3">No contacts found</p>
                          ) : filteredContacts.map(c => (
                            <button key={c.id} onClick={() => setConnForm(p => ({ ...p, to_contact_id: c.id }))}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                                connForm.to_contact_id === c.id ? 'bg-np-blue/10 text-np-blue font-medium' : 'hover:bg-gray-50'
                              }`}>
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${
                                connForm.to_contact_id === c.id ? 'bg-np-blue' : 'bg-gray-300'
                              }`}>
                                {c.first_name?.[0]}{c.last_name?.[0]}
                              </div>
                              {c.first_name} {c.last_name}
                              {c.pipeline_stage && <span className="text-[8px] text-gray-400 ml-auto">{c.pipeline_stage}</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Relationship</label>
                        <select value={connForm.relationship_type} onChange={e => setConnForm(p => ({ ...p, relationship_type: e.target.value }))}
                          className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                          <option value="">Select type...</option>
                          {relTypes.map(rt => <option key={rt.id} value={rt.name}>{rt.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Strength</label>
                        <div className="flex gap-1 mt-1">
                          {[1,2,3,4,5].map(s => (
                            <button key={s} onClick={() => setConnForm(p => ({ ...p, strength: s }))}
                              className={`w-7 h-7 rounded text-[10px] font-bold ${connForm.strength >= s ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-400'}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Notes</label>
                        <input value={connForm.notes} onChange={e => setConnForm(p => ({ ...p, notes: e.target.value }))}
                          placeholder="Optional notes..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => { setShowAddConnection(false); setConnSearch(''); setConnForm({ to_contact_id: '', relationship_type: '', strength: 3, notes: '' }) }}
                          className="px-3 py-1.5 text-[10px] text-gray-400 hover:text-np-dark">Done</button>
                        <button onClick={handleAddConnection} disabled={!connForm.to_contact_id || !connForm.relationship_type}
                          className="px-3 py-1.5 bg-np-blue text-white text-[10px] font-medium rounded-lg disabled:opacity-40">Add Connection</button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {relationships.map(rel => {
                      const isFrom = rel.from_contact_id === contactId
                      const other = isFrom ? (rel as any).to_contact : (rel as any).from_contact
                      const rtConfig = relTypes.find(rt => rt.name === rel.relationship_type)
                      const label = isFrom ? (rtConfig?.label || rel.relationship_type) : (rtConfig?.reverse_label || rtConfig?.label || rel.relationship_type)
                      if (!other) return null
                      return (
                        <div key={rel.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 group">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                            style={{ backgroundColor: rtConfig?.color || '#6366f1' }}>
                            {other.first_name?.[0]}{other.last_name?.[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-np-dark">{other.first_name} {other.last_name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: (rtConfig?.color || '#6366f1') + '18', color: rtConfig?.color || '#6366f1' }}>
                                {label}
                              </span>
                              <span className="text-[8px] text-gray-400">Strength {rel.strength}/5</span>
                              {rel.notes && <span className="text-[8px] text-gray-400 truncate max-w-[100px]">{rel.notes}</span>}
                            </div>
                          </div>
                          <button onClick={() => handleDeleteConnection(rel.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {relationships.length === 0 && !showAddConnection && (
                    <p className="text-center text-[10px] text-gray-400 py-8">No connections yet. Add one above.</p>
                  )}
                </>
              )}

              {/* TIMELINE TAB */}
              {tab === 'timeline' && (
                <div className="space-y-0">
                  {timeline.length === 0 ? (
                    <p className="text-center text-[10px] text-gray-400 py-8">No activity yet</p>
                  ) : timeline.map((ev, i) => {
                    const Icon = EVENT_ICONS[ev.event_type] || Activity
                    const color = EVENT_COLORS[ev.event_type] || '#94a3b8'
                    return (
                      <div key={ev.id} className="flex gap-3 pb-4 relative">
                        {i < timeline.length - 1 && (
                          <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-100" />
                        )}
                        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10"
                          style={{ backgroundColor: color + '18' }}>
                          <Icon className="w-3 h-3" style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-np-dark">{ev.title}</p>
                          {ev.description && (
                            <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{ev.description}</p>
                          )}
                          <p className="text-[9px] text-gray-300 mt-0.5">
                            {new Date(ev.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* TASKS TAB Ã¢â‚¬â€ Now with CrmTaskCard + RACI */}
              {tab === 'tasks' && (
                <>
                  {/* Add Task button Ã¢â‚¬â€ opens full modal identical to edit */}
                  <button onClick={() => setShowTaskCreate(true)}
                    className="flex items-center gap-1.5 px-3 py-2 w-full border border-dashed border-gray-200 rounded-lg text-[10px] text-gray-400 hover:border-np-blue hover:text-np-blue transition-colors mb-3">
                    <Plus className="w-3 h-3" /> Add Task
                  </button>

                  {/* Task Cards */}
                  <div className="space-y-2">
                    {tasks.map(task => (
                      <CrmTaskCard
                        key={task.id}
                        task={task}
                        teamMembers={teamMembers}
                        onClick={() => setSelectedTask(task)}
                      />
                    ))}
                  </div>
                  {tasks.length === 0 && !showTaskCreate && <p className="text-center text-[10px] text-gray-400 py-8">No tasks for this contact</p>}

                  {/* Sync indicator */}
                  {tasks.some(t => t.hub_task_id) && (
                    <div className="flex items-center gap-1.5 mt-3 px-2 py-1.5 bg-gray-50 rounded-lg">
                      <ExternalLink size={10} className="text-gray-300" />
                      <span className="text-[8px] text-gray-400">
                        {tasks.filter(t => t.hub_task_id).length} of {tasks.length} tasks synced to Hub Board
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* NOTES TAB */}
              {tab === 'notes' && (
                <>
                  <div className="flex gap-2 mb-3">
                    <input value={newNote} onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                      placeholder="Add a note..."
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    <button onClick={handleAddNote} disabled={!newNote.trim()}
                      className="px-3 py-2 bg-np-blue text-white rounded-lg text-xs disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {notes.map(note => (
                      <div key={note.id} className="bg-gray-50 rounded-xl px-3 py-2.5">
                        <p className="text-[11px] text-np-dark whitespace-pre-wrap">{note.body}</p>
                        <p className="text-[9px] text-gray-300 mt-1">
                          {new Date(note.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                  {notes.length === 0 && !newNote && <p className="text-center text-[10px] text-gray-400 py-6">No notes yet</p>}
                </>
              )}

              {/* COMMS TAB */}
              {tab === 'comms' && (
                <div className="space-y-4">
                  {/* Quick Compose */}
                  {contact.email && (
                    <button onClick={() => setShowEmailComposer(true)}
                      className="flex items-center gap-2 w-full px-3 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 rounded-lg hover:from-amber-100 hover:to-orange-100 transition-all">
                      <Send className="w-4 h-4 text-amber-600" />
                      <span className="text-[11px] font-medium text-amber-700">Compose Email to {contact.first_name}</span>
                      <Sparkles className="w-3 h-3 text-amber-400 ml-auto" />
                    </button>
                  )}

                  {/* Pipeline Resources */}
                  {(() => {
                    const stageRes = pipelineResources.filter((r: any) => r.pipeline_stage === contact.pipeline_stage)
                    if (stageRes.length === 0) return null
                    return (
                      <div>
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Paperclip className="w-3 h-3" /> {contact.pipeline_stage} Resources
                        </h4>
                        <div className="space-y-1.5">
                          {stageRes.map((r: any) => (
                            <div key={r.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg group">
                              <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium text-np-dark truncate">{r.name}</p>
                                {r.description && <p className="text-[9px] text-gray-400 truncate">{r.description}</p>}
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {r.file_url && (
                                  <a href={r.file_url} target="_blank" rel="noopener noreferrer"
                                    className="px-2 py-0.5 bg-white border border-gray-200 rounded text-[9px] text-gray-500 hover:text-np-blue">
                                    View
                                  </a>
                                )}
                                {contact.email && (
                                  <button onClick={() => { setEmailResourceAttach(r); setShowEmailComposer(true) }}
                                    className="px-2 py-0.5 bg-np-blue text-white rounded text-[9px] hover:bg-np-dark">
                                    Send
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Call History */}
                  <div>
                    {calls.length > 0 && (
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Call History
                      </h4>
                    )}
                    <div className="space-y-2">
                    {calls.map(call => (
                    <div key={call.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        call.direction === 'inbound' ? 'bg-green-100' : 'bg-blue-100'
                      }`}>
                        <Phone className={`w-3.5 h-3.5 ${call.direction === 'inbound' ? 'text-green-600' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-np-dark">
                          {call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call
                          {(call.duration_seconds ?? 0) > 0 && ` Ã‚Â· ${Math.floor((call.duration_seconds ?? 0) / 60)}:${String((call.duration_seconds ?? 0) % 60).padStart(2, '0')}`}
                        </p>
                        {call.ai_summary && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{call.ai_summary}</p>}
                        <p className="text-[9px] text-gray-300 mt-0.5">{new Date(call.started_at).toLocaleString()}</p>
                      </div>
                      {call.sentiment && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                          call.sentiment === 'positive' ? 'bg-green-50 text-green-600' :
                          call.sentiment === 'negative' ? 'bg-red-50 text-red-600' :
                          call.sentiment === 'concerned' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'
                        }`}>{call.sentiment}</span>
                      )}
                    </div>
                  ))}
                  {calls.length === 0 && !pipelineResources.length && <p className="text-center text-[10px] text-gray-400 py-8">No communications yet</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* STATS TAB Ã¢â‚¬â€ Full comm breakdown */}
              {tab === 'stats' && contactId && (
                <ContactCommPanel contactId={contactId} />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-sm">Contact not found</p>
          </div>
        )}
      </div>

      {/* Task Detail Modal Ã¢â‚¬â€ Edit existing */}
      {selectedTask && (
        <CrmTaskDetail
          task={selectedTask}
          teamMembers={teamMembers}
          onUpdate={handleTaskUpdate}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Task Create Modal Ã¢â‚¬â€ identical UI to edit */}
      {showTaskCreate && contact && (
        <CrmTaskDetail
          createMode
          teamMembers={teamMembers}
          contactId={contact.id}
          orgId={contact.org_id}
          createdBy={contact.org_id}
          onCreate={(newTask) => { setTasks(prev => [newTask, ...prev]); setShowTaskCreate(false) }}
          onClose={() => setShowTaskCreate(false)}
        />
      )}

      {/* Email Composer */}
      {showEmailComposer && contact && (
        <EmailComposer
          contact={contact}
          onClose={() => { setShowEmailComposer(false); setEmailResourceAttach(null); setEmailInitialSubject(''); setEmailInitialBody('') }}
          onSent={() => { load(); onUpdate?.() }}
          attachResource={emailResourceAttach}
          initialSubject={emailInitialSubject}
          initialBody={emailInitialBody}
        />
      )}
    </div>
  )
}
