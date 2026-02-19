'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  X, Phone, Mail, MessageCircle, Tag, Clock, CheckCircle2, AlertTriangle,
  TrendingUp, Send, Pencil, Trash2, Plus, User, Activity, Brain,
  Route, Target, Calendar, FileText, Sparkles, ChevronRight, Heart,
  ArrowRightLeft, GraduationCap, BarChart3, Shield, ExternalLink, Paperclip, GitBranch
} from 'lucide-react'
import {
  fetchContact, updateContact, fetchNotes, createNote,
  fetchActivityLog, fetchTasks, updateTask, fetchLifecycleEvents,
  fetchCallLogs, fetchConversations, fetchMessages,
  fetchContactRelationships, createRelationship, deleteRelationship,
  fetchRelationshipTypes, fetchContacts
} from '@/lib/crm-client'
import type { CrmContact, ContactNote, CrmTask, CallLog, ActivityLogEntry, TeamMember, ContactRelationship, RelationshipType } from '@/types/crm'
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

interface ContactDetailProps {
  contactId: string | null
  onClose: () => void
  onUpdate?: () => void
}

export default function ContactDetail({ contactId, onClose, onUpdate }: ContactDetailProps) {
  const supabase = createClient()
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [tab, setTab] = useState<'overview' | 'connections' | 'timeline' | 'tasks' | 'notes' | 'comms' | 'stats'>('overview')
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
  const [relationships, setRelationships] = useState<ContactRelationship[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [showAddConnection, setShowAddConnection] = useState(false)
  const [connForm, setConnForm] = useState({ to_contact_id: '', relationship_type: '', strength: 3, notes: '' })
  const [connSearch, setConnSearch] = useState('')
  const [allContacts, setAllContacts] = useState<CrmContact[]>([])
  const [connSearching, setConnSearching] = useState(false)

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    try {
      const c = await fetchContact(contactId)
      setContact(c)

      // Load supplemental data independently
      fetchNotes(contactId).then(setNotes).catch(e => console.warn('Notes load skipped:', e))
      fetchTasks({ contact_id: contactId }).then(setTasks).catch(e => console.warn('Tasks load skipped:', e))
      fetchCallLogs(contactId, 10).then(setCalls).catch(e => console.warn('Calls load skipped:', e))
      fetchContactRelationships(contactId).then(setRelationships).catch(e => console.warn('Relationships load skipped:', e))
      fetchRelationshipTypes(c.org_id).then(setRelTypes).catch(e => console.warn('RelTypes load skipped:', e))
      fetchContacts({ limit: 200 }).then(res => setAllContacts(res.contacts.filter(ct => ct.id !== contactId))).catch(e => console.warn('Contacts load skipped:', e))

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

  const TABS = [
    { key: 'overview', label: 'Overview', icon: User },
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
                    {contact.first_name[0]}{contact.last_name[0]}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-np-dark">{contact.first_name} {contact.last_name}</h3>
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
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
              </div>

              {/* Quick contacts */}
              <div className="flex gap-2 mt-3 flex-wrap">
                <ContactCommsButtons contact={contact} size="md" onEmailClick={() => setShowEmailComposer(true)} />
                {contact.phone && <span className="text-[9px] text-gray-400 self-center">{contact.phone}</span>}
                {contact.email && <span className="text-[9px] text-gray-400 self-center">{contact.email}</span>}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mt-2.5">
                {(contact.tags || []).map(tag => (
                  <span key={tag} className="flex items-center gap-0.5 text-[9px] font-medium bg-np-blue/8 text-np-blue px-2 py-0.5 rounded-full group">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="opacity-0 group-hover:opacity-100 hover:text-red-500">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input value={newTag} onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="+ tag" className="text-[9px] w-14 bg-transparent border-none outline-none placeholder-gray-300" />
                </div>
              </div>
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
                        {contact.acquisition_utm && (
                          <div className="text-[10px]"><span className="text-gray-400">UTM:</span> <span className="font-mono text-gray-500">{JSON.stringify(contact.acquisition_utm)}</span></div>
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
                        <Link href={`/crm/contacts?id=${contact.id}&view=mastermind`}
                          className="text-[10px] text-emerald-600 hover:underline flex items-center gap-0.5">
                          View program data <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Pipeline + Stage */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Target className="w-3 h-3" /> Pipeline
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {['New Lead', 'Contacted', 'Qualified', 'Discovery', 'Proposal', 'Enrolled', 'Active', 'Graduated'].map(stage => (
                        <button key={stage}
                          onClick={() => updateContact(contact.id, { pipeline_stage: stage }).then(() => { load(); onUpdate?.() })}
                          className={`text-[9px] font-medium px-2.5 py-1 rounded-full border transition-all ${
                            contact.pipeline_stage === stage
                              ? 'bg-np-blue text-white border-np-blue'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-np-blue/30'
                          }`}>
                          {stage}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity — LIVE COUNTERS */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Communication Activity
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-green-50/50 rounded-lg p-2.5 text-center border border-green-100/50">
                        <Phone className="w-3.5 h-3.5 mx-auto text-green-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_calls || 0}</p>
                        <p className="text-[9px] text-gray-400">Calls</p>
                      </div>
                      <div className="bg-blue-50/50 rounded-lg p-2.5 text-center border border-blue-100/50">
                        <MessageCircle className="w-3.5 h-3.5 mx-auto text-blue-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_texts || 0}</p>
                        <p className="text-[9px] text-gray-400">Texts</p>
                      </div>
                      <div className="bg-amber-50/50 rounded-lg p-2.5 text-center border border-amber-100/50">
                        <Mail className="w-3.5 h-3.5 mx-auto text-amber-500 mb-1" />
                        <p className="text-lg font-bold text-np-dark">{(contact as any).total_emails || 0}</p>
                        <p className="text-[9px] text-gray-400">Emails</p>
                      </div>
                    </div>
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
                  {contact.custom_fields && Object.keys(contact.custom_fields).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Custom Fields</h4>
                      <div className="space-y-1">
                        {Object.entries(contact.custom_fields).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{key}:</span>
                            <span className="font-medium text-np-dark">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lifecycle Events */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lifecycle</h4>
                    <div className="text-[10px] text-gray-500">
                      Created {new Date(contact.created_at).toLocaleDateString()}
                      {contact.last_contacted_at && (
                        <span> · Last contact {new Date(contact.last_contacted_at).toLocaleDateString()}</span>
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
                </>
              )}

              {/* CONNECTIONS TAB */}
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

              {/* TASKS TAB — Now with CrmTaskCard + RACI */}
              {tab === 'tasks' && (
                <>
                  {/* Add Task button — opens full modal identical to edit */}
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
                          {(call.duration_seconds ?? 0) > 0 && ` · ${Math.floor((call.duration_seconds ?? 0) / 60)}:${String((call.duration_seconds ?? 0) % 60).padStart(2, '0')}`}
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

              {/* STATS TAB — Full comm breakdown */}
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

      {/* Task Detail Modal — Edit existing */}
      {selectedTask && (
        <CrmTaskDetail
          task={selectedTask}
          teamMembers={teamMembers}
          onUpdate={handleTaskUpdate}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Task Create Modal — identical UI to edit */}
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
          onClose={() => { setShowEmailComposer(false); setEmailResourceAttach(null) }}
          onSent={() => { load(); onUpdate?.() }}
          attachResource={emailResourceAttach}
        />
      )}
    </div>
  )
}
