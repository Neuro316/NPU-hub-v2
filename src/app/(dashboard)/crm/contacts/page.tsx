'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Search, Plus, Tag, X, Settings2, GripVertical, Check, Eye, EyeOff, Sparkles, Loader2,
  ArrowUp, ArrowDown, ArrowUpDown, Pencil
} from 'lucide-react'
import { fetchContacts, bulkUpdateContacts, createContact, fetchTeamMembers, fetchRelationshipTypes, createRelationship, updateContact } from '@/lib/crm-client'
import type { CrmContact, ContactSearchParams, TeamMember, RelationshipType } from '@/types/crm'
import { STAGE_COLORS } from '@/types/crm'
import ContactDetail from '@/components/crm/contact-detail'
import CrossOrgContactsPanel from '@/components/crm/cross-org-contacts-panel'
import { useWorkspace } from '@/lib/workspace-context'

const TAG_COLORS: Record<string, string> = {
  VIP: '#FBBF24', 'Hot Lead': '#F87171', Partner: '#34D399', Referral: '#2A9D8F',
  Practitioner: '#9CAF88', Investor: '#A78BFA', Speaker: '#E76F51', Collaborator: '#228DC4',
}
const SOURCE_OPTIONS = ['Website','Referral','Social Media','Event','Cold Outreach','Podcast','Workshop','Mastermind Alumni','Partner','Google Search','Conference','YouTube','Other']

function ContactTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] || '#94a3b8'
  return <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ background: color + '18', color }}>{tag}</span>
}

interface NewContactForm {
  first_name: string; last_name: string; email: string; phone: string
  company: string; source: string; pipeline_id: string; pipeline_stage: string; assigned_to: string
  tags: string[]; newTag: string
  connect_to_id: string; connect_to_name: string; connect_type: string; connect_strength: number
  address_street: string; address_city: string; address_state: string; address_zip: string
  reason_for_contact: string; preferred_name: string; date_of_birth: string
  timezone: string; preferred_contact_method: string
  occupation: string; industry: string; how_heard_about_us: string
  instagram_handle: string; linkedin_url: string
  emergency_contact_name: string; emergency_contact_phone: string
  referred_by_name: string; referred_by_contact_id: string; source_other: string
}
const emptyForm: NewContactForm = {
  first_name:'', last_name:'', email:'', phone:'', company:'', source:'', pipeline_id:'', pipeline_stage:'', assigned_to:'',
  tags:[], newTag:'', connect_to_id:'', connect_to_name:'', connect_type:'', connect_strength:3,
  address_street:'', address_city:'', address_state:'', address_zip:'', reason_for_contact:'',
  preferred_name:'', date_of_birth:'', timezone:'America/New_York', preferred_contact_method:'',
  occupation:'', industry:'', how_heard_about_us:'',
  instagram_handle:'', linkedin_url:'', emergency_contact_name:'', emergency_contact_phone:'',
  referred_by_name:'', referred_by_contact_id:'', source_other:'',
}

export default function ContactsPage() {
  const { currentOrg } = useWorkspace()
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [stageFilter, setStageFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [page, setPage] = useState(0)
  const limit = 50
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewContactForm>(emptyForm)
  const [creating, setCreating] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [connSearchResults, setConnSearchResults] = useState<CrmContact[]>([])
  const [connSearchQuery, setConnSearchQuery] = useState('')
  const [pipelineConfigs, setPipelineConfigs] = useState<any[]>([])
  const [bulkPipelineId, setBulkPipelineId] = useState('')
  const [bulkPipelineStage, setBulkPipelineStage] = useState('')
  const [showColumnConfig, setShowColumnConfig] = useState(false)
  const [aiLooking, setAiLooking] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [refSearchResults, setRefSearchResults] = useState<CrmContact[]>([])
  const [refSearchQuery, setRefSearchQuery] = useState('')

  // ── Sorting ──
  const [sortBy, setSortBy] = useState<string>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const SORT_COLUMN_MAP: Record<string, string> = {
    name: 'first_name', email: 'email', phone: 'phone', company: 'source', // company is custom_fields, fallback
    source: 'source', stage: 'pipeline_stage', last_contact: 'last_contacted_at',
    assigned: 'assigned_to', preferred_name: 'preferred_name', date_of_birth: 'date_of_birth',
    city: 'address_city', state: 'address_state', occupation: 'occupation', industry: 'industry',
    instagram: 'instagram_handle', created: 'created_at', timezone: 'timezone',
    contact_method: 'preferred_contact_method', how_heard: 'how_heard_about_us',
    reason: 'reason_for_contact', pipeline: 'pipeline_id',
  }

  const toggleSort = (colKey: string) => {
    const dbCol = SORT_COLUMN_MAP[colKey]
    if (!dbCol) return
    if (sortBy === dbCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(dbCol)
      setSortDir('asc')
    }
  }

  // ── Inline editing ──
  const [editingCell, setEditingCell] = useState<{ contactId: string; colKey: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (contactId: string, colKey: string, currentValue: string) => {
    setEditingCell({ contactId, colKey })
    setEditValue(currentValue)
  }

  const cancelEdit = () => { setEditingCell(null); setEditValue('') }

  const saveEdit = async () => {
    if (!editingCell) return
    const { contactId, colKey } = editingCell
    const fieldMap: Record<string, string> = {
      email: 'email', phone: 'phone', source: 'source',
      preferred_name: 'preferred_name', occupation: 'occupation',
      industry: 'industry', instagram: 'instagram_handle', linkedin: 'linkedin_url',
      city: 'address_city', state: 'address_state', timezone: 'timezone',
      contact_method: 'preferred_contact_method', how_heard: 'how_heard_about_us',
      reason: 'reason_for_contact',
    }
    const dbField = fieldMap[colKey]
    if (!dbField) { cancelEdit(); return }

    try {
      await updateContact(contactId, { [dbField]: editValue || null } as any)
      // Update local state immediately for responsiveness
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, [dbField]: editValue || null } : c))
      cancelEdit()
    } catch (e) { console.error('Inline edit error:', e); cancelEdit() }
  }

  const EDITABLE_COLUMNS = new Set(['email', 'phone', 'source', 'preferred_name', 'occupation', 'industry', 'instagram', 'linkedin', 'city', 'state', 'timezone', 'contact_method', 'how_heard', 'reason'])

  // ── Column configuration ──
  interface ColumnDef { key: string; label: string; defaultVisible: boolean }
  const ALL_COLUMNS: ColumnDef[] = [
    { key: 'name', label: 'Name', defaultVisible: true },
    { key: 'email', label: 'Email', defaultVisible: false },
    { key: 'phone', label: 'Phone', defaultVisible: false },
    { key: 'company', label: 'Company', defaultVisible: true },
    { key: 'source', label: 'Source', defaultVisible: true },
    { key: 'stage', label: 'Stage', defaultVisible: true },
    { key: 'pipeline', label: 'Pipeline', defaultVisible: false },
    { key: 'tags', label: 'Tags', defaultVisible: true },
    { key: 'last_contact', label: 'Last Contact', defaultVisible: true },
    { key: 'assigned', label: 'Assigned', defaultVisible: true },
    { key: 'preferred_name', label: 'Preferred Name', defaultVisible: false },
    { key: 'date_of_birth', label: 'Date of Birth', defaultVisible: false },
    { key: 'city', label: 'City', defaultVisible: false },
    { key: 'state', label: 'State', defaultVisible: false },
    { key: 'occupation', label: 'Occupation', defaultVisible: false },
    { key: 'industry', label: 'Industry', defaultVisible: false },
    { key: 'instagram', label: 'Instagram', defaultVisible: false },
    { key: 'linkedin', label: 'LinkedIn', defaultVisible: false },
    { key: 'created', label: 'Created', defaultVisible: false },
    { key: 'contact_method', label: 'Preferred Method', defaultVisible: false },
    { key: 'timezone', label: 'Timezone', defaultVisible: false },
    { key: 'emergency_contact', label: 'Emergency Contact', defaultVisible: false },
    { key: 'how_heard', label: 'How Heard', defaultVisible: false },
    { key: 'reason', label: 'Reason for Contact', defaultVisible: false },
  ]
  const DEFAULT_COLUMNS = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)
  const [activeColumns, setActiveColumns] = useState<string[]>(DEFAULT_COLUMNS)
  const [dragColIdx, setDragColIdx] = useState<number | null>(null)
  const [dragOverColIdx, setDragOverColIdx] = useState<number | null>(null)

  // Load saved column config
  useEffect(() => {
    if (!currentOrg) return
    const { createClient: cc } = require('@/lib/supabase-browser')
    cc().from('org_settings').select('setting_value').eq('org_id', currentOrg.id).eq('setting_key', 'crm_contact_columns').maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.setting_value?.columns) setActiveColumns(data.setting_value.columns)
      })
  }, [currentOrg?.id])

  // Save column config
  const saveColumnConfig = async (cols: string[]) => {
    if (!currentOrg) return
    const supabase = require('@/lib/supabase-browser').createClient()
    await supabase.from('org_settings').upsert({
      org_id: currentOrg.id, setting_key: 'crm_contact_columns',
      setting_value: { columns: cols },
    }, { onConflict: 'org_id,setting_key' })
    setActiveColumns(cols)
  }

  const toggleColumn = (key: string) => {
    if (key === 'name') return // Name is always visible
    const next = activeColumns.includes(key)
      ? activeColumns.filter(k => k !== key)
      : [...activeColumns, key]
    saveColumnConfig(next)
  }

  const handleColumnDragStart = (idx: number) => { setDragColIdx(idx) }
  const handleColumnDragOver = (idx: number) => { setDragOverColIdx(idx) }
  const handleColumnDrop = (idx: number) => {
    if (dragColIdx === null || dragColIdx === idx) { setDragColIdx(null); setDragOverColIdx(null); return }
    const next = [...activeColumns]
    const [moved] = next.splice(dragColIdx, 1)
    next.splice(idx, 0, moved)
    saveColumnConfig(next)
    setDragColIdx(null)
    setDragOverColIdx(null)
  }

  // Column renderer
  const renderCell = (c: CrmContact, key: string) => {
    const sc = STAGE_COLORS[c.pipeline_stage || ''] || '#94a3b8'
    switch (key) {
      case 'name': {
        const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()
        return (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-np-dark flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{initials}</div>
            <div><p className="text-xs font-semibold text-np-dark">{c.first_name} {c.last_name}</p></div>
          </div>
        )
      }
      case 'email': return <span className="text-[10px] text-gray-500">{c.email || '--'}</span>
      case 'phone': return <span className="text-[10px] text-gray-500">{c.phone || '--'}</span>
      case 'company': return <span className="text-xs text-gray-600">{(c.custom_fields as any)?.company || '--'}</span>
      case 'source': return <span className="text-[10px] px-1.5 py-0.5 bg-np-blue/8 text-np-blue rounded-full font-medium">{c.source || '--'}</span>
      case 'stage': return c.pipeline_stage ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: sc + '18', color: sc }}>{c.pipeline_stage}</span> : <span className="text-[10px] text-gray-400">--</span>
      case 'pipeline': {
        const pl = pipelineConfigs.find((p: any) => p.id === c.pipeline_id)
        return pl ? <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-full font-medium">{pl.name}</span> : <span className="text-[10px] text-gray-400">--</span>
      }
      case 'tags': return <div className="flex gap-0.5 flex-wrap">{c.tags?.slice(0,2).map(t => <ContactTag key={t} tag={t} />)}{(c.tags?.length||0)>2 && <span className="text-[9px] text-gray-400">+{c.tags!.length-2}</span>}</div>
      case 'last_contact': return <span className="text-[10px] text-gray-400">{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Never'}</span>
      case 'assigned': return <span className="text-[10px] text-gray-600">{(c.assigned_member as any)?.display_name || '--'}</span>
      case 'preferred_name': return <span className="text-[10px] text-gray-500">{c.preferred_name || '--'}</span>
      case 'date_of_birth': return <span className="text-[10px] text-gray-500">{c.date_of_birth ? new Date(c.date_of_birth).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '--'}</span>
      case 'city': return <span className="text-[10px] text-gray-500">{c.address_city || (c.custom_fields as any)?.address_city || '--'}</span>
      case 'state': return <span className="text-[10px] text-gray-500">{c.address_state || (c.custom_fields as any)?.address_state || '--'}</span>
      case 'occupation': return <span className="text-[10px] text-gray-500">{c.occupation || (c.custom_fields as any)?.occupation || '--'}</span>
      case 'industry': return <span className="text-[10px] text-gray-500">{c.industry || (c.custom_fields as any)?.industry || '--'}</span>
      case 'instagram': return <span className="text-[10px] text-gray-500">{c.instagram_handle || '--'}</span>
      case 'linkedin': return c.linkedin_url ? <a href={c.linkedin_url} target="_blank" rel="noopener" className="text-[10px] text-np-blue hover:underline" onClick={e => e.stopPropagation()}>Profile</a> : <span className="text-[10px] text-gray-400">--</span>
      case 'created': return <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
      case 'contact_method': return <span className="text-[10px] text-gray-500 capitalize">{c.preferred_contact_method || '--'}</span>
      case 'timezone': return <span className="text-[10px] text-gray-500">{c.timezone?.replace('America/','').replace('_',' ') || '--'}</span>
      case 'emergency_contact': return <span className="text-[10px] text-gray-500">{c.emergency_contact_name || '--'}</span>
      case 'how_heard': return <span className="text-[10px] text-gray-500">{c.how_heard_about_us || '--'}</span>
      case 'reason': return <span className="text-[10px] text-gray-500 truncate max-w-[120px] block">{c.reason_for_contact || '--'}</span>
      default: return <span className="text-[10px] text-gray-400">--</span>
    }
  }

  // Get raw string value for inline editing
  const getCellRawValue = (c: CrmContact, key: string): string => {
    switch (key) {
      case 'email': return c.email || ''
      case 'phone': return c.phone || ''
      case 'source': return c.source || ''
      case 'preferred_name': return c.preferred_name || ''
      case 'occupation': return c.occupation || (c.custom_fields as any)?.occupation || ''
      case 'industry': return c.industry || (c.custom_fields as any)?.industry || ''
      case 'instagram': return c.instagram_handle || ''
      case 'linkedin': return c.linkedin_url || ''
      case 'city': return c.address_city || (c.custom_fields as any)?.address_city || ''
      case 'state': return c.address_state || (c.custom_fields as any)?.address_state || ''
      case 'timezone': return c.timezone || ''
      case 'contact_method': return c.preferred_contact_method || ''
      case 'how_heard': return c.how_heard_about_us || ''
      case 'reason': return c.reason_for_contact || ''
      default: return ''
    }
  }

  useEffect(() => { fetchTeamMembers().then(setTeamMembers).catch(console.error) }, [])
  useEffect(() => { if (currentOrg) fetchRelationshipTypes(currentOrg.id).then(setRelTypes).catch(console.error) }, [currentOrg])
  useEffect(() => {
    if (!currentOrg) return
    const { createClient } = require('@/lib/supabase-browser')
    createClient().from('org_settings').select('setting_value').eq('org_id', currentOrg.id).eq('setting_key', 'crm_pipelines').maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.setting_value?.pipelines) setPipelineConfigs(data.setting_value.pipelines)
      })
  }, [currentOrg?.id])

  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    try {
      const params: ContactSearchParams = { org_id: currentOrg.id, limit, offset: page * limit, sort_by: sortBy, sort_dir: sortDir }
      if (search) params.q = search
      if (stageFilter) params.pipeline_stage = stageFilter
      if (tagFilter) params.tags = [tagFilter]
      const res = await fetchContacts(params)
      setContacts(res.contacts); setTotal(res.total)
    } catch (e) { console.error('Contact load error:', e) }
    finally { setLoading(false) }
  }, [currentOrg?.id, search, stageFilter, tagFilter, page, sortBy, sortDir])

  useEffect(() => { load() }, [load])

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => selected.size === contacts.length ? setSelected(new Set()) : setSelected(new Set(contacts.map(c => c.id)))

  const handleBulkAction = async (action: string, params: Record<string, unknown>) => {
    if (!selected.size) return
    try { await bulkUpdateContacts(Array.from(selected), action, params); setSelected(new Set()); load() }
    catch (e) { console.error('Bulk action error:', e) }
  }

  const handleCreate = async () => {
    if (!form.first_name || !currentOrg) return
    setCreating(true)
    try {
      const customFields: Record<string, any> = {}
      if (form.company) customFields.company = form.company
      if (form.referred_by_name) customFields.referred_by_name = form.referred_by_name
      if (form.referred_by_contact_id) customFields.referred_by_contact_id = form.referred_by_contact_id
      if (form.source_other) customFields.source_other = form.source_other
      if (form.address_street) customFields.address_street = form.address_street
      if (form.address_city) customFields.address_city = form.address_city
      if (form.address_state) customFields.address_state = form.address_state
      if (form.address_zip) customFields.address_zip = form.address_zip
      if (form.reason_for_contact) customFields.reason_for_contact = form.reason_for_contact
      if (form.preferred_name) customFields.preferred_name = form.preferred_name
      if (form.date_of_birth) customFields.date_of_birth = form.date_of_birth
      if (form.timezone && form.timezone !== 'America/New_York') customFields.timezone = form.timezone
      if (form.preferred_contact_method) customFields.preferred_contact_method = form.preferred_contact_method
      if (form.occupation) customFields.occupation = form.occupation
      if (form.industry) customFields.industry = form.industry
      if (form.how_heard_about_us) customFields.how_heard_about_us = form.how_heard_about_us
      if (form.instagram_handle) customFields.instagram_handle = form.instagram_handle
      if (form.linkedin_url) customFields.linkedin_url = form.linkedin_url
      if (form.emergency_contact_name) customFields.emergency_contact_name = form.emergency_contact_name
      if (form.emergency_contact_phone) customFields.emergency_contact_phone = form.emergency_contact_phone
      if (form.pipeline_id) customFields.pipeline_id = form.pipeline_id
      if (form.pipeline_stage) customFields.pipeline_stage = form.pipeline_stage
      if (form.assigned_to) customFields.assigned_to = form.assigned_to

      // Debug: log auth state
      const sb = (await import('@/lib/supabase-browser')).createClient()
      const { data: { user } } = await sb.auth.getUser()
      console.log('Auth user:', user?.id, 'Org:', currentOrg.id)

      // Build minimal payload
      const payload: Record<string, any> = {
        org_id: currentOrg.id,
        first_name: form.first_name,
        last_name: form.last_name || '',
        email: form.email || null,
        phone: form.phone || null,
        source: form.source || null,
        tags: form.tags?.length ? form.tags : [],
        sms_consent: false,
        email_consent: true,
        do_not_contact: false,
      }
      if (Object.keys(customFields).length > 0) payload.custom_fields = customFields
      console.log('Insert payload:', JSON.stringify(payload, null, 2))

      // Try direct insert for better error details
      const { data: newContact, error } = await sb.from('contacts').insert(payload).select().single()
      if (error) {
        console.error('Supabase insert error:', { message: error.message, details: error.details, hint: error.hint, code: error.code })
        throw error
      }
      if (form.connect_to_id && form.connect_type && newContact?.id) {
        await createRelationship({
          org_id: currentOrg.id,
          from_contact_id: newContact.id,
          to_contact_id: form.connect_to_id,
          relationship_type: form.connect_type,
          strength: form.connect_strength,
        }).catch(e => console.warn('Connection create skipped:', e))
      }
      setShowCreate(false); setForm(emptyForm); setConnSearchResults([]); setConnSearchQuery(''); setRefSearchResults([]); setRefSearchQuery(''); setAiResult(null); load()
    } catch (e: any) { console.error('Full create error:', e); alert('Failed to create contact: ' + (e?.message || '') + (e?.details ? ' | Details: ' + e.details : '') + (e?.hint ? ' | Hint: ' + e.hint : '') + (e?.code ? ' | Code: ' + e.code : '')) }
    finally { setCreating(false) }
  }

  const addTag = () => { const t = form.newTag.trim(); if (t && !form.tags.includes(t)) setForm(p => ({ ...p, tags: [...p.tags, t], newTag: '' })) }
  const removeTag = (t: string) => setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }))
  const handleConnSearchInForm = async (q: string) => {
    setConnSearchQuery(q)
    if (q.length < 2) { setConnSearchResults([]); return }
    try { const res = await fetchContacts({ org_id: currentOrg?.id, q, limit: 6 }); setConnSearchResults(res.contacts) } catch (e) { console.error(e) }
  }

  const handleRefSearch = async (q: string) => {
    setRefSearchQuery(q)
    setForm(p => ({ ...p, referred_by_name: q, referred_by_contact_id: '' }))
    if (q.length < 2) { setRefSearchResults([]); return }
    try { const res = await fetchContacts({ org_id: currentOrg?.id, q, limit: 6 }); setRefSearchResults(res.contacts) } catch (e) { console.error(e) }
  }

  const handleAiLookup = async () => {
    const name = `${form.first_name} ${form.last_name}`.trim()
    if (!name || name.length < 3) { setAiResult('Enter a first and last name first.'); return }
    setAiLooking(true); setAiResult(null)
    try {
      const company = form.company ? ` at ${form.company}` : ''
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignContext: {
            systemOverride: `You are a contact research assistant. Given a person's name, search the web for their professional information. Return ONLY a JSON object with these fields (use empty string if not found): {"email":"","phone":"","company":"","occupation":"","industry":"","linkedin_url":"","instagram_handle":"","address_city":"","address_state":"","summary":"brief 1-sentence description of who they are"}. No markdown, no explanation, just the JSON object.`
          },
          messages: [{ role: 'user', content: `Find professional contact information for: ${name}${company}` }],
        }),
      })
      const data = await res.json()
      const text = data?.response || data?.content?.[0]?.text || ''
      // Try to parse JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const info = JSON.parse(jsonMatch[0])
        setForm(p => ({
          ...p,
          email: p.email || info.email || '',
          phone: p.phone || info.phone || '',
          company: p.company || info.company || '',
          occupation: p.occupation || info.occupation || '',
          industry: p.industry || info.industry || '',
          linkedin_url: p.linkedin_url || info.linkedin_url || '',
          instagram_handle: p.instagram_handle || info.instagram_handle || '',
          address_city: p.address_city || info.address_city || '',
          address_state: p.address_state || info.address_state || '',
        }))
        setAiResult(info.summary || 'Fields populated from web search.')
      } else {
        setAiResult('Could not parse results. Try adding a company name.')
      }
    } catch (e) { console.error(e); setAiResult('Lookup failed. Check API key or try again.') }
    finally { setAiLooking(false) }
  }

  const allTags = useMemo(() => {
    const tags = new Set<string>(); contacts.forEach(c => c.tags?.forEach(t => tags.add(t))); return Array.from(tags).sort()
  }, [contacts])

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search contacts, companies, tags..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 placeholder:text-gray-400" />
        </div>
        <select value={stageFilter} onChange={e => { setStageFilter(e.target.value); setPage(0) }}
          className="text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal/30">
          <option value="">All Stages</option>
          {pipelineConfigs.flatMap((p: any) => p.stages || []).map((s: any) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select value={tagFilter} onChange={e => { setTagFilter(e.target.value); setPage(0) }}
          className="text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal/30">
          <option value="">All Tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
          <Plus size={13} /> Add Contact
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-np-blue/5 border border-np-blue/20 rounded-lg flex-wrap">
          <span className="text-xs font-semibold text-np-blue">{selected.size} selected</span>
          <div className="flex gap-1 items-center ml-auto flex-wrap">
            {/* Pipeline assignment */}
            <select value={bulkPipelineId} onChange={e => {
              setBulkPipelineId(e.target.value)
              const pl = pipelineConfigs.find((p: any) => p.id === e.target.value)
              setBulkPipelineStage(pl?.stages?.[0]?.name || '')
            }}
              className="px-2 py-1 text-[10px] bg-white border border-gray-100 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30">
              <option value="">Pipeline...</option>
              {pipelineConfigs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {bulkPipelineId && (
              <>
                <select value={bulkPipelineStage} onChange={e => setBulkPipelineStage(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-white border border-gray-100 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  {(pipelineConfigs.find((p: any) => p.id === bulkPipelineId)?.stages || []).map((s: any) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
                <button onClick={() => { handleBulkAction('set_pipeline', { pipeline_id: bulkPipelineId, pipeline_stage: bulkPipelineStage }); setBulkPipelineId(''); setBulkPipelineStage('') }}
                  className="px-2 py-1 text-[10px] font-bold text-white bg-np-blue rounded-md hover:bg-np-blue/90">Assign</button>
              </>
            )}
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button onClick={() => { const t = prompt('Tag name:'); if (t) handleBulkAction('add_tags', { tags: [t] }) }}
              className="px-2 py-1 text-[10px] font-medium bg-white border border-gray-100 rounded-md hover:bg-gray-50">
              <Tag size={10} className="inline mr-0.5" /> Add Tag
            </button>
            <button onClick={() => handleBulkAction('add_to_dnc', {})}
              className="px-2 py-1 text-[10px] font-medium bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100">DNC</button>
            <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-[10px] text-gray-400 hover:text-np-dark"><X size={12} /></button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400">{total} contacts</p>

      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="w-8 py-2 px-3"><input type="checkbox" checked={selected.size === contacts.length && contacts.length > 0} onChange={toggleAll} className="accent-teal w-3 h-3" /></th>
                {activeColumns.map((colKey, idx) => {
                  const col = ALL_COLUMNS.find(c => c.key === colKey)
                  if (!col) return null
                  return (
                    <th key={colKey}
                      draggable
                      onDragStart={() => handleColumnDragStart(idx)}
                      onDragOver={e => { e.preventDefault(); handleColumnDragOver(idx) }}
                      onDrop={() => handleColumnDrop(idx)}
                      onDragEnd={() => { setDragColIdx(null); setDragOverColIdx(null) }}
                      onClick={() => toggleSort(colKey)}
                      className={`py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400 cursor-pointer select-none whitespace-nowrap transition-colors hover:text-np-dark hover:bg-gray-50
                        ${dragOverColIdx === idx && dragColIdx !== null ? 'bg-np-blue/10' : ''}
                        ${dragColIdx === idx ? 'opacity-40' : ''}
                        ${SORT_COLUMN_MAP[colKey] === sortBy ? 'text-np-blue' : ''}`}>
                      <div className="flex items-center gap-1">
                        <GripVertical className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
                        {col.label}
                        {SORT_COLUMN_MAP[colKey] === sortBy ? (
                          sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5 text-np-blue" /> : <ArrowDown className="w-2.5 h-2.5 text-np-blue" />
                        ) : SORT_COLUMN_MAP[colKey] ? (
                          <ArrowUpDown className="w-2.5 h-2.5 text-gray-200" />
                        ) : null}
                      </div>
                    </th>
                  )
                })}
                <th className="w-8 py-2 px-2">
                  <button onClick={() => setShowColumnConfig(!showColumnConfig)} className="p-1 rounded hover:bg-gray-100 transition-colors" title="Configure columns">
                    <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} onClick={() => setSelectedContactId(c.id)} className="border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors cursor-pointer group">
                  <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-teal w-3 h-3" />
                  </td>
                  {activeColumns.map(colKey => {
                    const isEditing = editingCell?.contactId === c.id && editingCell?.colKey === colKey
                    const isEditable = EDITABLE_COLUMNS.has(colKey)

                    if (isEditing) {
                      return (
                        <td key={colKey} className="py-1 px-2" onClick={e => e.stopPropagation()}>
                          {colKey === 'source' ? (
                            <select value={editValue} onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                              autoFocus
                              className="w-full px-1.5 py-1 text-[10px] border border-np-blue rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/40 bg-white">
                              <option value="">--</option>
                              {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : colKey === 'how_heard' ? (
                            <select value={editValue} onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                              autoFocus
                              className="w-full px-1.5 py-1 text-[10px] border border-np-blue rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/40 bg-white">
                              <option value="">--</option>
                              {['Referral','Social Media','Podcast','Workshop','Google Search','Conference','YouTube','Other'].map(o =>
                                <option key={o} value={o}>{o}</option>
                              )}
                            </select>
                          ) : colKey === 'contact_method' ? (
                            <select value={editValue} onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                              autoFocus
                              className="w-full px-1.5 py-1 text-[10px] border border-np-blue rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/40 bg-white">
                              <option value="">No preference</option>
                              <option value="call">Call</option><option value="text">Text</option><option value="email">Email</option>
                            </select>
                          ) : (
                            <input value={editValue} onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                              autoFocus
                              className="w-full px-1.5 py-1 text-[10px] border border-np-blue rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/40 bg-white" />
                          )}
                        </td>
                      )
                    }

                    return (
                      <td key={colKey} className="py-2 px-3 relative"
                        onDoubleClick={isEditable ? (e) => {
                          e.stopPropagation()
                          const rawVal = getCellRawValue(c, colKey)
                          startEdit(c.id, colKey, rawVal)
                        } : undefined}
                      >
                        {renderCell(c, colKey)}
                        {isEditable && (
                          <button onClick={(e) => { e.stopPropagation(); startEdit(c.id, colKey, getCellRawValue(c, colKey)) }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-300 hover:text-np-blue opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit">
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className="w-8" />
                </tr>
              ))}
              {contacts.length === 0 && !loading && <tr><td colSpan={activeColumns.length + 2} className="py-12 text-center text-xs text-gray-400">No contacts found</td></tr>}
              {loading && <tr><td colSpan={activeColumns.length + 2} className="py-12 text-center text-xs text-gray-400">Loading...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Column config dropdown */}
      {showColumnConfig && (
        <div className="fixed inset-0 z-40" onClick={() => setShowColumnConfig(false)}>
          <div className="absolute right-8 top-48 w-72 bg-white border border-gray-100 rounded-xl shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-200"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-np-dark">Configure Columns</h4>
              <button onClick={() => setShowColumnConfig(false)} className="text-gray-400 hover:text-np-dark"><X size={14} /></button>
            </div>
            <p className="text-[9px] text-gray-400 mb-3">Toggle visibility and drag to reorder in the table header</p>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {ALL_COLUMNS.map(col => {
                const active = activeColumns.includes(col.key)
                const isName = col.key === 'name'
                return (
                  <button key={col.key} onClick={() => !isName && toggleColumn(col.key)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors
                      ${active ? 'bg-np-blue/5 text-np-dark' : 'text-gray-400 hover:bg-gray-50'}
                      ${isName ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}>
                    {active ? <Eye className="w-3 h-3 text-np-blue flex-shrink-0" /> : <EyeOff className="w-3 h-3 flex-shrink-0" />}
                    <span className="text-[11px] font-medium flex-1">{col.label}</span>
                    {isName && <span className="text-[8px] text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded">Required</span>}
                    {active && !isName && <Check className="w-3 h-3 text-green-500 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-gray-100 mt-2 pt-2">
              <button onClick={() => saveColumnConfig(DEFAULT_COLUMNS)}
                className="text-[10px] text-gray-400 hover:text-np-dark font-medium">
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-400">Showing {page*limit+1} to {Math.min((page+1)*limit,total)} of {total}</p>
          <div className="flex gap-1">
            <button disabled={page===0} onClick={() => setPage(p=>p-1)} className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50">Prev</button>
            <button disabled={(page+1)*limit>=total} onClick={() => setPage(p=>p+1)} className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      {currentOrg && <CrossOrgContactsPanel orgId={currentOrg.id} />}

      <ContactDetail contactId={selectedContactId} onClose={() => setSelectedContactId(null)} onUpdate={load} />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Contact</h3>
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); setAiResult(null); setRefSearchQuery(''); setRefSearchResults([]) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-3 items-end">
                <div className="flex-1"><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">First Name *</label>
                  <input value={form.first_name} onChange={e => setForm(p=>({...p,first_name:e.target.value}))} placeholder="Jane" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div className="flex-1"><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Last Name</label>
                  <input value={form.last_name} onChange={e => setForm(p=>({...p,last_name:e.target.value}))} placeholder="Smith" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <button onClick={handleAiLookup} disabled={aiLooking || !form.first_name}
                  title="AI web search to auto-fill contact info"
                  className="mb-0.5 flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-40 transition-colors whitespace-nowrap">
                  {aiLooking ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {aiLooking ? 'Looking up...' : 'AI Lookup'}
                </button>
              </div>
              {aiResult && (
                <div className={`px-3 py-2 rounded-lg text-[11px] ${aiResult.includes('fail') || aiResult.includes('Could not') ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
                  <Sparkles size={10} className="inline mr-1" />{aiResult}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(p=>({...p,email:e.target.value}))} placeholder="jane@example.com" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(p=>({...p,phone:e.target.value}))} placeholder="+1 828 555 1234" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Company</label>
                <input value={form.company} onChange={e => setForm(p=>({...p,company:e.target.value}))} placeholder="Acme Corp" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Source</label>
                  <select value={form.source} onChange={e => setForm(p=>({...p,source:e.target.value,referred_by_name:'',referred_by_contact_id:'',source_other:''}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">Select source</option>{SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Pipeline</label>
                  <select value={form.pipeline_id} onChange={e => {
                    const pid = e.target.value
                    const pl = pipelineConfigs.find((p: any) => p.id === pid)
                    setForm(p => ({ ...p, pipeline_id: pid, pipeline_stage: pl?.stages?.[0]?.name || '' }))
                  }} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">No pipeline</option>
                    {pipelineConfigs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Stage</label>
                  <select value={form.pipeline_stage} onChange={e => setForm(p=>({...p,pipeline_stage:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">Select stage</option>
                    {(pipelineConfigs.find((p: any) => p.id === form.pipeline_id)?.stages || []).map((s: any) => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select></div>
              </div>
              {/* Conditional source fields */}
              {form.source === 'Referral' && (
                <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">Referred By</label>
                  <div className="relative mt-1">
                    <input value={refSearchQuery || form.referred_by_name} onChange={e => handleRefSearch(e.target.value)}
                      placeholder="Search existing contacts or type a name..." className="w-full px-3 py-2 text-xs border border-indigo-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    {refSearchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-100 rounded-lg max-h-32 overflow-y-auto shadow-lg z-10">
                        {refSearchResults.map(c => (
                          <button key={c.id} onClick={() => { setForm(p=>({...p,referred_by_contact_id:c.id,referred_by_name:`${c.first_name} ${c.last_name}`})); setRefSearchQuery(`${c.first_name} ${c.last_name}`); setRefSearchResults([]) }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center text-[8px] font-bold text-indigo-600">{c.first_name?.[0]}{c.last_name?.[0]}</div>
                            {c.first_name} {c.last_name}
                            {c.source && <span className="text-[9px] text-gray-400 ml-auto">{c.source}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {form.referred_by_contact_id && <p className="text-[10px] text-indigo-500 mt-1">Linked to existing contact</p>}
                  {!form.referred_by_contact_id && form.referred_by_name && <p className="text-[10px] text-gray-400 mt-1">Will be saved as a name (not linked to a contact)</p>}
                </div>
              )}
              {form.source === 'Other' && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Please Specify Source</label>
                  <input value={form.source_other} onChange={e => setForm(p=>({...p,source_other:e.target.value}))}
                    placeholder="How did this contact find you?" className="w-full mt-1 px-3 py-2 text-xs border border-amber-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-300" />
                </div>
              )}
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assigned To</label>
                <select value={form.assigned_to} onChange={e => setForm(p=>({...p,assigned_to:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                  <option value="">Unassigned</option>{teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Preferred Name</label>
                  <input value={form.preferred_name} onChange={e => setForm(p=>({...p,preferred_name:e.target.value}))} placeholder="Nickname" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Date of Birth</label>
                  <input type="date" value={form.date_of_birth} onChange={e => setForm(p=>({...p,date_of_birth:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Timezone</label>
                  <select value={form.timezone} onChange={e => setForm(p=>({...p,timezone:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    {['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'].map(tz =>
                      <option key={tz} value={tz}>{tz.replace('America/','').replace('Pacific/','').replace('_',' ')}</option>
                    )}
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Prefers</label>
                  <select value={form.preferred_contact_method} onChange={e => setForm(p=>({...p,preferred_contact_method:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">No preference</option><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option>
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Occupation</label>
                  <input value={form.occupation} onChange={e => setForm(p=>({...p,occupation:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Industry</label>
                  <input value={form.industry} onChange={e => setForm(p=>({...p,industry:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Primary Reason for Contact</label>
                <input value={form.reason_for_contact} onChange={e => setForm(p=>({...p,reason_for_contact:e.target.value}))} placeholder="e.g. Interested in Immersive Mastermind" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">How They Heard About Us</label>
                <select value={form.how_heard_about_us} onChange={e => setForm(p=>({...p,how_heard_about_us:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                  <option value="">Select...</option>
                  {['Referral','Social Media','Podcast','Workshop','Google Search','Conference','YouTube','Other'].map(o =>
                    <option key={o} value={o}>{o}</option>
                  )}
                </select></div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Mailing Address</label>
                <input value={form.address_street} onChange={e => setForm(p=>({...p,address_street:e.target.value}))} placeholder="Street" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                <div className="grid grid-cols-3 gap-2 mt-1.5">
                  <input value={form.address_city} onChange={e => setForm(p=>({...p,address_city:e.target.value}))} placeholder="City" className="px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                  <input value={form.address_state} onChange={e => setForm(p=>({...p,address_state:e.target.value}))} placeholder="State" className="px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                  <input value={form.address_zip} onChange={e => setForm(p=>({...p,address_zip:e.target.value}))} placeholder="Zip" className="px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Instagram</label>
                  <input value={form.instagram_handle} onChange={e => setForm(p=>({...p,instagram_handle:e.target.value}))} placeholder="@handle" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">LinkedIn</label>
                  <input value={form.linkedin_url} onChange={e => setForm(p=>({...p,linkedin_url:e.target.value}))} placeholder="https://linkedin.com/in/..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Emergency Contact</label>
                  <input value={form.emergency_contact_name} onChange={e => setForm(p=>({...p,emergency_contact_name:e.target.value}))} placeholder="Name" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Emergency Phone</label>
                  <input value={form.emergency_contact_phone} onChange={e => setForm(p=>({...p,emergency_contact_phone:e.target.value}))} placeholder="+1 828..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tags</label>
                <div className="flex gap-1 flex-wrap mt-1 mb-1.5">
                  {form.tags.map(t => <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-teal/10 text-teal">{t}<button onClick={() => removeTag(t)} className="hover:text-red-500"><X size={8} /></button></span>)}
                </div>
                <div className="flex gap-1">
                  <input value={form.newTag} onChange={e => setForm(p=>({...p,newTag:e.target.value}))} onKeyDown={e => e.key==='Enter' && (e.preventDefault(),addTag())} placeholder="Add tag..." className="flex-1 px-3 py-1.5 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                  <button onClick={addTag} className="px-2 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100">Add</button>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Connect To Existing Contact</label>
                <div className="relative mt-1">
                  <input value={connSearchQuery} onChange={e => handleConnSearchInForm(e.target.value)}
                    placeholder="Search contacts to connect..." className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                  {connSearchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-100 rounded-lg max-h-32 overflow-y-auto shadow-lg z-10">
                      {connSearchResults.map(c => (
                        <button key={c.id} onClick={() => { setForm(p=>({...p,connect_to_id:c.id,connect_to_name:`${c.first_name} ${c.last_name}`})); setConnSearchQuery(`${c.first_name} ${c.last_name}`); setConnSearchResults([]) }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-np-blue/10 flex items-center justify-center text-[8px] font-bold text-np-blue">{c.first_name?.[0]}{c.last_name?.[0]}</div>
                          {c.first_name} {c.last_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.connect_to_id && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-np-blue/5 rounded-lg">
                      <span className="text-[10px] font-medium text-np-blue">{form.connect_to_name}</span>
                      <button onClick={() => { setForm(p=>({...p,connect_to_id:'',connect_to_name:'',connect_type:''})); setConnSearchQuery('') }} className="text-gray-400 hover:text-red-500"><X size={10} /></button>
                    </div>
                    <select value={form.connect_type} onChange={e => setForm(p=>({...p,connect_type:e.target.value}))}
                      className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                      <option value="">Select relationship...</option>
                      {relTypes.map(rt => <option key={rt.id} value={rt.name}>{rt.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); setAiResult(null); setRefSearchQuery(''); setRefSearchResults([]) }} className="px-3 py-2 text-xs text-gray-400 hover:text-np-dark">Cancel</button>
              <button onClick={handleCreate} disabled={!form.first_name || creating}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
                {creating ? 'Creating...' : 'Create Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
