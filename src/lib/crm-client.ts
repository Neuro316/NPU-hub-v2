// ═══════════════════════════════════════════════════════════════
// NPU CRM — Supabase Client Operations
// All CRM database queries go through here
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase-browser'
import type {
  CrmContact, Conversation, Message, CallLog, EmailCampaign,
  CrmTask, ContactNote, LifecycleEvent, ActivityLogEntry,
  Sequence, SequenceStep, SequenceEnrollment, ContactSearchParams, SavedFilter,
  TeamMember, OrgEmailDailyStats
} from '@/types/crm'

const supabase = () => createClient()

// ─── Contacts ───

export async function fetchContacts(params: ContactSearchParams = {}) {
  const sb = supabase()
  let query = sb
    .from('contacts')
    .select('*, team_members!contacts_assigned_to_fkey(display_name, email)', { count: 'exact' })
    .is('merged_into_id', null)
    .order('updated_at', { ascending: false })

  if (params.q) query = query.textSearch('search_vector', params.q, { type: 'websearch' })
  if (params.tags?.length) query = query.overlaps('tags', params.tags)
  if (params.pipeline_stage) query = query.eq('pipeline_stage', params.pipeline_stage)
  if (params.assigned_to) query = query.eq('assigned_to', params.assigned_to)
  if (params.last_contacted_before) query = query.lte('last_contacted_at', params.last_contacted_before)
  if (params.last_contacted_after) query = query.gte('last_contacted_at', params.last_contacted_after)

  const limit = params.limit || 50
  const offset = params.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) throw error
  return { contacts: (data || []) as CrmContact[], total: count || 0 }
}

export async function fetchContact(id: string) {
  const { data, error } = await supabase()
    .from('contacts')
    .select('*, team_members!contacts_assigned_to_fkey(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as CrmContact
}

export async function createContact(contact: Partial<CrmContact>) {
  const { data, error } = await supabase()
    .from('contacts')
    .insert(contact)
    .select()
    .single()
  if (error) throw error
  return data as CrmContact
}

export async function updateContact(id: string, updates: Partial<CrmContact>) {
  const { data, error } = await supabase()
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as CrmContact
}

// ─── Conversations & Messages ───

export async function fetchConversations(channel?: string) {
  let query = supabase()
    .from('conversations')
    .select('*, contacts!inner(first_name, last_name, phone, email, tags, pipeline_stage)')
    .order('last_message_at', { ascending: false })

  if (channel) query = query.eq('channel', channel)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as (Conversation & { contacts: CrmContact })[]
}

export async function fetchMessages(conversationId: string) {
  const { data, error } = await supabase()
    .from('crm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as Message[]
}

export async function sendMessage(conversationId: string, body: string, userId: string) {
  const { data, error } = await supabase()
    .from('crm_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      body,
      status: 'queued',
      sent_by: userId,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data as Message
}

// ─── Call Logs ───

export async function fetchCallLogs(contactId?: string, limit = 50) {
  let query = supabase()
    .from('call_logs')
    .select('*, contacts!inner(first_name, last_name, phone)')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as (CallLog & { contacts: Pick<CrmContact, 'first_name' | 'last_name' | 'phone'> })[]
}

// ─── Email Campaigns ───

export async function fetchCampaigns() {
  const { data, error } = await supabase()
    .from('email_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as EmailCampaign[]
}

export async function createCampaign(campaign: Partial<EmailCampaign>) {
  const { data, error } = await supabase()
    .from('email_campaigns')
    .insert(campaign)
    .select()
    .single()
  if (error) throw error
  return data as EmailCampaign
}

export async function updateCampaign(id: string, updates: Partial<EmailCampaign>) {
  const { data, error } = await supabase()
    .from('email_campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as EmailCampaign
}

// ─── Tasks ───

export async function fetchTasks(filters?: { assigned_to?: string; status?: string; contact_id?: string }) {
  let query = supabase()
    .from('tasks')
    .select('*, contacts(first_name, last_name), team_members!tasks_assigned_to_fkey(display_name)')
    .order('created_at', { ascending: false })

  if (filters?.assigned_to) query = query.eq('assigned_to', filters.assigned_to)
  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.contact_id) query = query.eq('contact_id', filters.contact_id)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as CrmTask[]
}

export async function createTask(task: Partial<CrmTask>) {
  const { data, error } = await supabase()
    .from('tasks')
    .insert(task)
    .select()
    .single()
  if (error) throw error
  return data as CrmTask
}

export async function updateTask(id: string, updates: Partial<CrmTask>) {
  const { data, error } = await supabase()
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as CrmTask
}

// ─── Notes ───

export async function fetchNotes(contactId: string) {
  const { data, error } = await supabase()
    .from('contact_notes')
    .select('*')
    .eq('contact_id', contactId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as ContactNote[]
}

export async function createNote(note: Partial<ContactNote>) {
  const { data, error } = await supabase()
    .from('contact_notes')
    .insert(note)
    .select()
    .single()
  if (error) throw error
  return data as ContactNote
}

// ─── Lifecycle Events ───

export async function fetchLifecycleEvents(contactId: string) {
  const { data, error } = await supabase()
    .from('contact_lifecycle_events')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return (data || []) as LifecycleEvent[]
}

export async function createLifecycleEvent(event: Partial<LifecycleEvent>) {
  const { data, error } = await supabase()
    .from('contact_lifecycle_events')
    .insert(event)
    .select()
    .single()
  if (error) throw error
  return data as LifecycleEvent
}

// ─── Activity Log ───

export async function fetchActivityLog(contactId: string, limit = 50) {
  const { data, error } = await supabase()
    .from('activity_log')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []) as ActivityLogEntry[]
}

// ─── Sequences ───

export async function fetchSequences() {
  const { data, error } = await supabase()
    .from('sequences')
    .select('*, sequence_steps(*)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as Sequence[]
}

export async function fetchEnrollments(contactId?: string) {
  let query = supabase()
    .from('sequence_enrollments')
    .select('*, sequences(name, description), contacts(first_name, last_name)')
    .order('enrolled_at', { ascending: false })

  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as SequenceEnrollment[]
}

export async function createSequence(seq: Partial<Sequence>) {
  const { data, error } = await supabase()
    .from('sequences')
    .insert(seq)
    .select()
    .single()
  if (error) throw error
  return data as Sequence
}

export async function createSequenceStep(step: Partial<SequenceStep>) {
  const { data, error } = await supabase()
    .from('sequence_steps')
    .insert(step)
    .select()
    .single()
  if (error) throw error
  return data as SequenceStep
}

// ─── Team Members ───

export async function fetchTeamMembers() {
  const { data, error } = await supabase()
    .from('team_members')
    .select('*')
    .eq('is_active', true)
    .order('display_name')
  if (error) throw error
  return (data || []) as TeamMember[]
}

// ─── Saved Filters ───

export async function fetchSavedFilters(userId: string) {
  const { data, error } = await supabase()
    .from('user_saved_filters')
    .select('*')
    .eq('user_id', userId)
    .order('name')
  if (error) throw error
  return (data || []) as SavedFilter[]
}

export async function saveSavedFilter(filter: Partial<SavedFilter>) {
  const { data, error } = await supabase()
    .from('user_saved_filters')
    .insert(filter)
    .select()
    .single()
  if (error) throw error
  return data as SavedFilter
}

// ─── Email Stats ───

export async function fetchEmailStats(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
  const { data, error } = await supabase()
    .from('org_email_daily_stats')
    .select('*')
    .eq('org_id', orgId)
    .gte('date', since)
    .order('date', { ascending: true })
  if (error) throw error
  return (data || []) as OrgEmailDailyStats[]
}

// ─── Bulk Actions ───

export async function bulkUpdateContacts(
  contactIds: string[],
  action: string,
  params: Record<string, unknown>
) {
  const res = await fetch('/api/contacts/bulk-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_ids: contactIds, action, params }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Realtime subscription helper ───

export function subscribeToCrmTable(
  table: 'crm_messages' | 'call_logs' | 'conversations' | 'tasks' | 'activity_log',
  callback: (payload: any) => void,
  filter?: { column: string; value: string }
) {
  const sb = supabase()
  const config: any = { event: '*', schema: 'public', table }
  if (filter) config.filter = `${filter.column}=eq.${filter.value}`

  const channel = sb
    .channel(`crm-${table}-${filter?.value || 'all'}`)
    .on('postgres_changes', config, callback)
    .subscribe()

  return () => { sb.removeChannel(channel) }
}
