// ═══════════════════════════════════════════════════════════════
// NPU CRM — Supabase Client Operations
// All CRM database queries go through here
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase-browser'
import type {
  CrmContact, Conversation, Message, CallLog, EmailCampaign,
  CrmTask, ContactNote, LifecycleEvent, ActivityLogEntry,
  Sequence, SequenceStep, SequenceEnrollment, ContactSearchParams, SavedFilter,
  TeamMember, OrgEmailDailyStats,
  ContactTagCategory, ContactTagDefinition, ContactRelationship,
  RelationshipType, ContactNetworkScore, NetworkEvent,
  NetworkGraphData, NetworkNode, NetworkEdge, NetworkCluster
} from '@/types/crm'

const supabase = () => createClient()

// ─── Contacts ───

export async function fetchContacts(params: ContactSearchParams = {}) {
  const sb = supabase()
  let query = sb
    .from('contacts')
    .select('*', { count: 'exact' })
    .is('merged_into_id', null)
    .order('updated_at', { ascending: false })

  if (params.q) {
    // Try ilike on name/email first (more reliable than search_vector which may not be populated)
    query = query.or(`first_name.ilike.%${params.q}%,last_name.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%`)
  }
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
    .select('*')
    .eq('id', id)
    .single()
  if (error) { console.error('fetchContact error:', error); throw error }
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
    .select('*, contacts(first_name, last_name)')
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

export async function createConversation(contactId: string, channel: 'sms' | 'voice' | 'email', orgId: string) {
  const { data: existing } = await supabase()
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .maybeSingle()

  if (existing) return existing.id as string

  const { data, error } = await supabase()
    .from('conversations')
    .insert({ contact_id: contactId, channel, org_id: orgId, unread_count: 0 })
    .select()
    .single()
  if (error) throw error
  return data.id as string
}

export async function fetchKanbanColumns(orgId: string) {
  const { data, error } = await supabase()
    .from('kanban_columns')
    .select('*')
    .eq('org_id', orgId)
    .order('position')
  if (error) {
    return [
      { id: 'backlog', name: 'Backlog' },
      { id: 'todo', name: 'To Do' },
      { id: 'in_progress', name: 'In Progress' },
      { id: 'review', name: 'Review' },
      { id: 'done', name: 'Done' },
    ]
  }
  return data || []
}

// ─── Team Members ───

export async function fetchTeamMembers(orgId?: string) {
  let query = supabase()
    .from('team_profiles')
    .select('*')
    .eq('status', 'active')
    .order('display_name')

  if (orgId) query = query.eq('org_id', orgId)

  const { data, error } = await query
  if (error) {
    console.error('fetchTeamMembers error:', error)
    return [] as TeamMember[]
  }
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

// ═══════════════════════════════════════════════════════════════
// Network Intelligence Client Functions
// ═══════════════════════════════════════════════════════════════

// ── Tag Management ──

export async function fetchTagCategories() {
  const { data, error } = await supabase()
    .from('contact_tag_categories')
    .select('*, tags:contact_tag_definitions(*)')
    .order('sort_order')
  if (error) throw error
  return data as ContactTagCategory[]
}

export async function createTagDefinition(tag: Partial<ContactTagDefinition>) {
  const { data, error } = await supabase().from('contact_tag_definitions').insert(tag).select().single()
  if (error) throw error
  return data
}

export async function deleteTagDefinition(id: string) {
  const { error } = await supabase().from('contact_tag_definitions').delete().eq('id', id)
  if (error) throw error
}

// ── Contact Tag Assignment (structured junction table) ──

export async function fetchContactStructuredTags(contactId: string) {
  const { data, error } = await supabase()
    .from('contact_tags')
    .select('*, tag_definition:contact_tag_definitions(*)')
    .eq('contact_id', contactId)
  if (error) throw error
  return data || []
}

export async function addContactTag(contactId: string, tagDefinitionId: string, orgId: string) {
  const { error } = await supabase()
    .from('contact_tags')
    .upsert({ contact_id: contactId, tag_definition_id: tagDefinitionId, org_id: orgId }, { onConflict: 'contact_id,tag_definition_id' })
  if (error) throw error
}

export async function removeContactTag(contactId: string, tagDefinitionId: string) {
  const { error } = await supabase()
    .from('contact_tags')
    .delete()
    .eq('contact_id', contactId)
    .eq('tag_definition_id', tagDefinitionId)
  if (error) throw error
}

// ── Relationships ──

export async function fetchContactRelationships(contactId: string) {
  const { data, error } = await supabase()
    .from('contact_relationships')
    .select('*, from_contact:contacts!contact_relationships_from_contact_id_fkey(id,first_name,last_name,tags,pipeline_stage,email,phone), to_contact:contacts!contact_relationships_to_contact_id_fkey(id,first_name,last_name,tags,pipeline_stage,email,phone)')
    .or(`from_contact_id.eq.${contactId},to_contact_id.eq.${contactId}`)
  if (error) throw error
  return data as ContactRelationship[]
}

export async function fetchAllRelationships(orgId: string) {
  const { data, error } = await supabase()
    .from('contact_relationships')
    .select('*')
    .eq('org_id', orgId)
  if (error) throw error
  return data as ContactRelationship[]
}

export async function createRelationship(rel: { org_id: string; from_contact_id: string; to_contact_id: string; relationship_type: string; notes?: string; strength?: number; created_by?: string }) {
  const { data, error } = await supabase().from('contact_relationships').insert(rel).select().single()
  if (error) throw error
  return data
}

export async function deleteRelationship(id: string) {
  const { error } = await supabase().from('contact_relationships').delete().eq('id', id)
  if (error) throw error
}

export async function fetchRelationshipTypes(orgId?: string) {
  let q = supabase().from('relationship_types').select('*').eq('is_active', true).order('sort_order')
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) throw error
  return data as RelationshipType[]
}

// ── Network Graph ──

export async function fetchNetworkGraph(orgId: string): Promise<NetworkGraphData> {
  const sb = supabase()
  const [contactsRes, relsRes, scoresRes, typesRes] = await Promise.all([
    sb.from('contacts').select('id,first_name,last_name,tags,pipeline_stage,last_contacted_at,phone,email,address_city,address_state,preferred_name,reason_for_contact,occupation,instagram_handle,linkedin_url').eq('org_id', orgId).is('merged_into_id', null),
    sb.from('contact_relationships').select('*').eq('org_id', orgId),
    sb.from('contact_interaction_score').select('*').eq('org_id', orgId),
    sb.from('relationship_types').select('*').eq('org_id', orgId),
  ])

  const scoreMap = new Map((scoresRes.data || []).map((s: any) => [s.contact_id, s]))
  const typeMap = new Map((typesRes.data || []).map((t: any) => [t.name, t]))

  const nodes: NetworkNode[] = (contactsRes.data || []).map((c: any) => {
    const score = scoreMap.get(c.id) as any
    return {
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown',
      avatar: `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase(),
      tags: c.tags || [],
      pipeline_stage: c.pipeline_stage,
      relationship_count: score?.relationship_count || 0,
      interaction_score: score?.interaction_score || 0,
      network_centrality: score?.network_centrality || 0,
      bridge_score: score?.bridge_score || 0,
      cluster_id: score?.cluster_id,
      phone: c.phone, email: c.email,
      address_city: c.address_city, address_state: c.address_state,
      preferred_name: c.preferred_name, reason_for_contact: c.reason_for_contact,
      occupation: c.occupation, instagram_handle: c.instagram_handle, linkedin_url: c.linkedin_url,
    }
  })

  const edges: NetworkEdge[] = (relsRes.data || []).map((r: any) => {
    const typeConfig = typeMap.get(r.relationship_type)
    return {
      id: r.id, from: r.from_contact_id, to: r.to_contact_id,
      type: r.relationship_type,
      label: typeConfig?.label || r.relationship_type,
      strength: r.strength, color: typeConfig?.color,
    }
  })

  // Recompute relationship counts from actual edges (scores table may be stale)
  const edgeCounts = new Map<string, number>()
  edges.forEach(e => {
    edgeCounts.set(e.from, (edgeCounts.get(e.from) || 0) + 1)
    edgeCounts.set(e.to, (edgeCounts.get(e.to) || 0) + 1)
  })
  nodes.forEach(n => {
    const fromEdges = edgeCounts.get(n.id) || 0
    if (fromEdges > n.relationship_count) n.relationship_count = fromEdges
  })

  const clusters = detectClusters(nodes, edges)
  return { nodes, edges, clusters }
}

function detectClusters(nodes: NetworkNode[], edges: NetworkEdge[]): NetworkCluster[] {
  const parent = new Map<string, string>()
  nodes.forEach(n => parent.set(n.id, n.id))
  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(a: string, b: string) { parent.set(find(a), find(b)) }
  edges.forEach(e => union(e.from, e.to))

  const groups = new Map<string, string[]>()
  nodes.forEach(n => {
    const root = find(n.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(n.id)
  })

  let cid = 0
  const clusters: NetworkCluster[] = []
  groups.forEach(ids => {
    if (ids.length >= 2) {
      const clusterNodes = nodes.filter(n => ids.includes(n.id))
      const allTags = clusterNodes.flatMap(n => n.tags)
      const tagCounts = new Map<string, number>()
      allTags.forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1))
      const dominant = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0])
      clusters.push({ id: cid, contact_ids: ids, dominant_tags: dominant })
      ids.forEach(id => { const n = nodes.find(n => n.id === id); if (n) n.cluster_id = cid })
      cid++
    }
  })
  return clusters
}

export function findBridgeContacts(targetIds: Set<string>, edges: NetworkEdge[], nodes: NetworkNode[]): string[] {
  const bridges: string[] = []
  nodes.forEach(n => {
    if (targetIds.has(n.id)) return
    const connected = new Set<string>()
    edges.forEach(e => {
      if (e.from === n.id && targetIds.has(e.to)) connected.add(e.to)
      if (e.to === n.id && targetIds.has(e.from)) connected.add(e.from)
    })
    if (connected.size >= 2) bridges.push(n.id)
  })
  return bridges
}

// ── Network Events ──

export async function fetchNetworkEvents(orgId: string) {
  const { data, error } = await supabase().from('network_events').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (error) throw error
  return data as NetworkEvent[]
}

export async function createNetworkEvent(event: Partial<NetworkEvent>) {
  const { data, error } = await supabase().from('network_events').insert(event).select().single()
  if (error) throw error
  return data
}

// ── Seed helper ──

export async function seedNetworkIntelligence(orgId: string) {
  const { error } = await supabase().rpc('seed_network_intelligence', { p_org_id: orgId })
  if (error) throw error
}

export async function computeNetworkScores(orgId: string) {
  const { error } = await supabase().rpc('compute_contact_network_scores', { p_org_id: orgId })
  if (error) throw error
}

// ── Phone Lookup (for dialer auto-match) ──

export async function lookupContactByPhone(phone: string, orgId?: string): Promise<CrmContact | null> {
  const sb = supabase()
  // Strip to digits, match last 10
  const clean = phone.replace(/[^0-9]/g, '')
  const last10 = clean.length > 10 ? clean.slice(-10) : clean
  if (last10.length < 7) return null

  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .is('merged_into_id', null)
    .not('phone', 'is', null)
    .filter('phone', 'neq', '')
  if (error || !data) return null

  // Client-side match on last 10 digits
  const match = data.find(c => {
    const cClean = (c.phone || '').replace(/[^0-9]/g, '')
    const cLast10 = cClean.length > 10 ? cClean.slice(-10) : cClean
    return cLast10 === last10
  })
  return match ? match as CrmContact : null
}
