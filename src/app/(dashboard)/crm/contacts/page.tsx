'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Search, Plus, Tag, X
} from 'lucide-react'
import { fetchContacts, bulkUpdateContacts, createContact, fetchTeamMembers, fetchRelationshipTypes, createRelationship } from '@/lib/crm-client'
import type { CrmContact, ContactSearchParams, TeamMember, RelationshipType } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'
import ContactDetail from '@/components/crm/contact-detail'
import { useWorkspace } from '@/lib/workspace-context'

const TAG_COLORS: Record<string, string> = {
  VIP: '#FBBF24', 'Hot Lead': '#F87171', Partner: '#34D399', Referral: '#2A9D8F',
  Practitioner: '#9CAF88', Investor: '#A78BFA', Speaker: '#E76F51', Collaborator: '#228DC4',
}
const SOURCE_OPTIONS = ['Website','Referral','Social Media','Event','Cold Outreach','Podcast','Workshop','Mastermind Alumni','Partner','Other']

function ContactTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] || '#94a3b8'
  return <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ background: color + '18', color }}>{tag}</span>
}

interface NewContactForm {
  first_name: string; last_name: string; email: string; phone: string
  company: string; source: string; pipeline_stage: string; assigned_to: string
  tags: string[]; newTag: string
  connect_to_id: string; connect_to_name: string; connect_type: string; connect_strength: number
}
const emptyForm: NewContactForm = { first_name:'', last_name:'', email:'', phone:'', company:'', source:'', pipeline_stage:'', assigned_to:'', tags:[], newTag:'', connect_to_id:'', connect_to_name:'', connect_type:'', connect_strength:3 }

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

  useEffect(() => { fetchTeamMembers().then(setTeamMembers).catch(console.error) }, [])
  useEffect(() => { if (currentOrg) fetchRelationshipTypes(currentOrg.id).then(setRelTypes).catch(console.error) }, [currentOrg])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: ContactSearchParams = { limit, offset: page * limit }
      if (search) params.q = search
      if (stageFilter) params.pipeline_stage = stageFilter
      if (tagFilter) params.tags = [tagFilter]
      const res = await fetchContacts(params)
      setContacts(res.contacts); setTotal(res.total)
    } catch (e) { console.error('Contact load error:', e) }
    finally { setLoading(false) }
  }, [search, stageFilter, tagFilter, page])

  useEffect(() => { load() }, [load])

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => selected.size === contacts.length ? setSelected(new Set()) : setSelected(new Set(contacts.map(c => c.id)))

  const handleBulkAction = async (action: string, params: Record<string, unknown>) => {
    if (!selected.size) return
    try { await bulkUpdateContacts(Array.from(selected), action, params); setSelected(new Set()); load() }
    catch (e) { console.error('Bulk action error:', e) }
  }

  const handleCreate = async () => {
    if (!form.first_name || !form.email || !currentOrg) return
    setCreating(true)
    try {
      const newContact = await createContact({
        org_id: currentOrg.id, first_name: form.first_name, last_name: form.last_name,
        email: form.email, phone: form.phone || undefined, source: form.source || undefined,
        pipeline_stage: form.pipeline_stage || 'New Lead', assigned_to: form.assigned_to || undefined,
        tags: form.tags, custom_fields: form.company ? { company: form.company } : undefined,
        sms_consent: false, email_consent: true, do_not_contact: false,
      })
      if (form.connect_to_id && form.connect_type && newContact?.id) {
        await createRelationship({
          org_id: currentOrg.id,
          from_contact_id: newContact.id,
          to_contact_id: form.connect_to_id,
          relationship_type: form.connect_type,
          strength: form.connect_strength,
        }).catch(e => console.warn('Connection create skipped:', e))
      }
      setShowCreate(false); setForm(emptyForm); setConnSearchResults([]); setConnSearchQuery(''); load()
    } catch (e) { console.error(e); alert('Failed to create contact') }
    finally { setCreating(false) }
  }

  const addTag = () => { const t = form.newTag.trim(); if (t && !form.tags.includes(t)) setForm(p => ({ ...p, tags: [...p.tags, t], newTag: '' })) }
  const removeTag = (t: string) => setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }))
  const handleConnSearchInForm = async (q: string) => {
    setConnSearchQuery(q)
    if (q.length < 2) { setConnSearchResults([]); return }
    try { const res = await fetchContacts({ q, limit: 6 }); setConnSearchResults(res.contacts) } catch (e) { console.error(e) }
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
          {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
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
        <div className="flex items-center gap-2 px-4 py-2 bg-np-blue/5 border border-np-blue/20 rounded-lg">
          <span className="text-xs font-semibold text-np-blue">{selected.size} selected</span>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => { const t = prompt('Tag name:'); if (t) handleBulkAction('add_tags', { tags: [t] }) }}
              className="px-2 py-1 text-[10px] font-medium bg-white border border-gray-100 rounded-md hover:bg-gray-50">
              <Tag size={10} className="inline mr-0.5" /> Add Tag
            </button>
            <button onClick={() => { const s = prompt('Pipeline stage:'); if (s) handleBulkAction('set_pipeline_stage', { pipeline_stage: s }) }}
              className="px-2 py-1 text-[10px] font-medium bg-white border border-gray-100 rounded-md hover:bg-gray-50">Set Stage</button>
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
                {['Name','Company','Source','Stage','Tags','Last Contact','Assigned'].map(h =>
                  <th key={h} className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => {
                const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()
                const sc = STAGE_COLORS[c.pipeline_stage || ''] || '#94a3b8'
                return (
                  <tr key={c.id} onClick={() => setSelectedContactId(c.id)} className="border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors cursor-pointer">
                    <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-teal w-3 h-3" />
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-np-dark flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{initials}</div>
                        <div><p className="text-xs font-semibold text-np-dark">{c.first_name} {c.last_name}</p><p className="text-[10px] text-gray-400">{c.email}</p></div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-600">{c.custom_fields?.company as string || '--'}</td>
                    <td className="py-2 px-3"><span className="text-[10px] px-1.5 py-0.5 bg-np-blue/8 text-np-blue rounded-full font-medium">{c.source || '--'}</span></td>
                    <td className="py-2 px-3">
                      {c.pipeline_stage ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: sc + '18', color: sc }}>{c.pipeline_stage}</span> : <span className="text-[10px] text-gray-400">--</span>}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-0.5 flex-wrap">
                        {c.tags?.slice(0,2).map(t => <ContactTag key={t} tag={t} />)}
                        {(c.tags?.length||0)>2 && <span className="text-[9px] text-gray-400">+{c.tags!.length-2}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[10px] text-gray-400">{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Never'}</td>
                    <td className="py-2 px-3 text-[10px] text-gray-600">{(c.assigned_member as any)?.display_name || '--'}</td>
                  </tr>
                )
              })}
              {contacts.length === 0 && !loading && <tr><td colSpan={8} className="py-12 text-center text-xs text-gray-400">No contacts found</td></tr>}
              {loading && <tr><td colSpan={8} className="py-12 text-center text-xs text-gray-400">Loading...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-400">Showing {page*limit+1} to {Math.min((page+1)*limit,total)} of {total}</p>
          <div className="flex gap-1">
            <button disabled={page===0} onClick={() => setPage(p=>p-1)} className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50">Prev</button>
            <button disabled={(page+1)*limit>=total} onClick={() => setPage(p=>p+1)} className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      <ContactDetail contactId={selectedContactId} onClose={() => setSelectedContactId(null)} onUpdate={load} />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Contact</h3>
              <button onClick={() => { setShowCreate(false); setForm(emptyForm) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">First Name *</label>
                  <input value={form.first_name} onChange={e => setForm(p=>({...p,first_name:e.target.value}))} placeholder="Jane" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Last Name</label>
                  <input value={form.last_name} onChange={e => setForm(p=>({...p,last_name:e.target.value}))} placeholder="Smith" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(p=>({...p,email:e.target.value}))} placeholder="jane@example.com" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(p=>({...p,phone:e.target.value}))} placeholder="+1 828 555 1234" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Company</label>
                <input value={form.company} onChange={e => setForm(p=>({...p,company:e.target.value}))} placeholder="Acme Corp" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Source</label>
                  <select value={form.source} onChange={e => setForm(p=>({...p,source:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">Select source</option>{SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Pipeline Stage</label>
                  <select value={form.pipeline_stage} onChange={e => setForm(p=>({...p,pipeline_stage:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                    <option value="">Select stage</option>{PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assigned To</label>
                <select value={form.assigned_to} onChange={e => setForm(p=>({...p,assigned_to:e.target.value}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                  <option value="">Unassigned</option>{teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select></div>
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
              <button onClick={() => { setShowCreate(false); setForm(emptyForm) }} className="px-3 py-2 text-xs text-gray-400 hover:text-np-dark">Cancel</button>
              <button onClick={handleCreate} disabled={!form.first_name || !form.email || creating}
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
