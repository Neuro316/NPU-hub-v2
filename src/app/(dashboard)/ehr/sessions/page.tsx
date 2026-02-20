'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  ClipboardList, Plus, Search, Users, Calendar, Clock, Brain, Wand2, Send,
  ChevronDown, ChevronRight, Check, X, Save, AlertTriangle, History,
  Loader2, Mic, Eye, FileText, Activity, Zap, Sun, Waves, Sparkles, Heart
} from 'lucide-react'

/* ═══ TYPES ═══ */
interface EnrolledClient {
  id: string; first_name: string; last_name: string; email?: string; phone?: string
  pipeline_stage?: string; tags: string[]; custom_fields?: Record<string, any>
}

interface Protocol {
  id: string; contact_id: string
  nf_enabled: boolean; nf_sites?: string; nf_frequency?: string; nf_duration_min?: number; nf_notes?: string
  vr_enabled: boolean; vr_program?: string; vr_hrv_target?: string; vr_duration_min?: number; vr_notes?: string
  vest_enabled: boolean; vest_exercises?: string; vest_duration_min?: number; vest_notes?: string
  prop_enabled: boolean; prop_exercises?: string; prop_duration_min?: number; prop_notes?: string
  tdcs_enabled: boolean; tdcs_montage?: string; tdcs_current_ma?: number; tdcs_duration_min?: number; tdcs_notes?: string
  rl_helmet_enabled: boolean; rl_helmet_program?: string; rl_helmet_duration_min?: number; rl_helmet_notes?: string
  rl_bed_enabled: boolean; rl_bed_program?: string; rl_bed_duration_min?: number; rl_bed_notes?: string
  hbot_enabled: boolean; hbot_pressure_ata?: number; hbot_duration_min?: number; hbot_notes?: string
  vns_enabled: boolean; vns_device?: string; vns_settings?: string; vns_duration_min?: number; vns_notes?: string
  updated_at: string
}

interface SessionNote {
  id: string; contact_id: string; protocol_id?: string; session_date: string; session_time?: string
  tech_name?: string; status: string; general_notes?: string; client_reported?: string; ai_raw_input?: string
  nf_completed: boolean; nf_modified: boolean; nf_session_notes?: string; nf_modifications?: string
  vr_completed: boolean; vr_modified: boolean; vr_session_notes?: string; vr_modifications?: string
  vest_completed: boolean; vest_modified: boolean; vest_session_notes?: string; vest_modifications?: string
  prop_completed: boolean; prop_modified: boolean; prop_session_notes?: string; prop_modifications?: string
  tdcs_completed: boolean; tdcs_modified: boolean; tdcs_session_notes?: string; tdcs_modifications?: string
  rl_helmet_completed: boolean; rl_helmet_modified: boolean; rl_helmet_session_notes?: string; rl_helmet_modifications?: string
  rl_bed_completed: boolean; rl_bed_modified: boolean; rl_bed_session_notes?: string; rl_bed_modifications?: string
  hbot_completed: boolean; hbot_modified: boolean; hbot_session_notes?: string; hbot_modifications?: string
  vns_completed: boolean; vns_modified: boolean; vns_session_notes?: string; vns_modifications?: string
  created_at: string
}

interface ProtocolHistoryEntry {
  id: string; change_type: string; change_summary: string; previous_values?: any; new_values?: any; created_at: string
}

const MODALITIES = [
  { key: 'nf', label: 'Neurofeedback', icon: Brain, color: 'text-blue-500', bg: 'bg-blue-50' },
  { key: 'vr', label: 'VR Biofeedback', icon: Eye, color: 'text-purple-500', bg: 'bg-purple-50' },
  { key: 'vest', label: 'Vestibular', icon: Waves, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { key: 'prop', label: 'Proprioception', icon: Activity, color: 'text-green-500', bg: 'bg-green-50' },
  { key: 'tdcs', label: 'tDCS', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50' },
  { key: 'rl_helmet', label: 'Red Light Helmet', icon: Sun, color: 'text-red-400', bg: 'bg-red-50' },
  { key: 'rl_bed', label: 'Red Light Bed', icon: Sun, color: 'text-orange-400', bg: 'bg-orange-50' },
  { key: 'hbot', label: 'Hyperbaric', icon: Heart, color: 'text-teal-500', bg: 'bg-teal-50' },
  { key: 'vns', label: 'Vagus Nerve Stim', icon: Sparkles, color: 'text-indigo-500', bg: 'bg-indigo-50' },
] as const

type ModalityKey = typeof MODALITIES[number]['key']

const EMPTY_NOTE: Partial<SessionNote> = {
  session_date: new Date().toISOString().slice(0, 10),
  session_time: new Date().toTimeString().slice(0, 5),
  status: 'draft', general_notes: '', client_reported: '',
  nf_completed: false, nf_modified: false, vr_completed: false, vr_modified: false,
  vest_completed: false, vest_modified: false, prop_completed: false, prop_modified: false,
  tdcs_completed: false, tdcs_modified: false, rl_helmet_completed: false, rl_helmet_modified: false,
  rl_bed_completed: false, rl_bed_modified: false, hbot_completed: false, hbot_modified: false,
  vns_completed: false, vns_modified: false,
}

export default function SessionNotesPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const supabase = createClient()

  /* ─── State ─── */
  const [clients, setClients] = useState<EnrolledClient[]>([])
  const [search, setSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<EnrolledClient | null>(null)
  const [protocol, setProtocol] = useState<Protocol | null>(null)
  const [protocolHistory, setProtocolHistory] = useState<ProtocolHistoryEntry[]>([])
  const [note, setNote] = useState<Partial<SessionNote>>(EMPTY_NOTE)
  const [pastNotes, setPastNotes] = useState<SessionNote[]>([])
  const [saving, setSaving] = useState(false)

  // AI Chat
  const [aiInput, setAiInput] = useState('')
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiMessages, setAiMessages] = useState<{ role: string; text: string }[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  // View toggles
  const [view, setView] = useState<'note' | 'protocol' | 'history'>('note')
  const [showProtocolEditor, setShowProtocolEditor] = useState(false)

  /* ─── Load enrolled clients ─── */
  const loadClients = useCallback(async () => {
    if (!currentOrg) return
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, pipeline_stage, tags, custom_fields')
      .eq('org_id', currentOrg.id)
      .or('pipeline_stage.ilike.%enroll%,pipeline_stage.ilike.%active%,pipeline_stage.ilike.%program%,tags.cs.{enrolled}')
      .order('last_name', { ascending: true })
    setClients(data || [])
  }, [currentOrg?.id])

  useEffect(() => { loadClients() }, [loadClients])

  /* ─── Load protocol + notes when client selected ─── */
  const loadClientData = useCallback(async (clientId: string) => {
    if (!currentOrg) return
    const [protoRes, notesRes, histRes] = await Promise.all([
      supabase.from('ehr_protocols').select('*').eq('contact_id', clientId).eq('org_id', currentOrg.id).maybeSingle(),
      supabase.from('ehr_session_notes').select('*').eq('contact_id', clientId).eq('org_id', currentOrg.id).order('session_date', { ascending: false }).limit(20),
      protocol ? supabase.from('ehr_protocol_history').select('*').eq('protocol_id', protocol.id).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    ])
    setProtocol(protoRes.data || null)
    setPastNotes((notesRes.data as SessionNote[]) || [])
    if (protoRes.data?.id) {
      const { data: hist } = await supabase.from('ehr_protocol_history').select('*').eq('protocol_id', protoRes.data.id).order('created_at', { ascending: false }).limit(20)
      setProtocolHistory(hist || [])
    } else {
      setProtocolHistory([])
    }
    // Reset note form
    setNote({
      ...EMPTY_NOTE,
      contact_id: clientId,
      protocol_id: protoRes.data?.id,
      tech_name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || '',
    })
    setAiMessages([])
    setView('note')
  }, [currentOrg?.id, user])

  const selectClient = (c: EnrolledClient) => {
    setSelectedClient(c)
    loadClientData(c.id)
  }

  /* ─── Filter + sort clients ─── */
  const filteredClients = useMemo(() => {
    let list = clients
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.last_name.localeCompare(b.last_name))
  }, [clients, search])

  /* ─── Save session note ─── */
  const saveNote = async (status?: string) => {
    if (!currentOrg || !selectedClient) return
    setSaving(true)
    const payload = {
      ...note,
      org_id: currentOrg.id,
      contact_id: selectedClient.id,
      protocol_id: protocol?.id || null,
      tech_id: user?.id,
      status: status || note.status || 'draft',
    }
    if ((note as any).id) {
      await supabase.from('ehr_session_notes').update(payload).eq('id', (note as any).id)
    } else {
      const { data } = await supabase.from('ehr_session_notes').insert(payload).select().single()
      if (data) setNote(prev => ({ ...prev, id: data.id }))
    }
    setSaving(false)
    loadClientData(selectedClient.id)
  }

  /* ─── Save protocol ─── */
  const saveProtocol = async (proto: Partial<Protocol>) => {
    if (!currentOrg || !selectedClient) return
    const payload = { ...proto, org_id: currentOrg.id, contact_id: selectedClient.id }
    if (protocol?.id) {
      await supabase.from('ehr_protocols').update(payload).eq('id', protocol.id)
      // Log history
      await supabase.from('ehr_protocol_history').insert({
        org_id: currentOrg.id, protocol_id: protocol.id, contact_id: selectedClient.id,
        changed_by: user?.id, change_type: 'modified', change_summary: 'Protocol updated',
        previous_values: protocol, new_values: payload,
      })
    } else {
      const { data } = await supabase.from('ehr_protocols').insert(payload).select().single()
      if (data) {
        await supabase.from('ehr_protocol_history').insert({
          org_id: currentOrg.id, protocol_id: data.id, contact_id: selectedClient.id,
          changed_by: user?.id, change_type: 'created', change_summary: 'Protocol created',
          new_values: payload,
        })
      }
    }
    loadClientData(selectedClient.id)
    setShowProtocolEditor(false)
  }

  /* ─── AI Assistant ─── */
  const processAiInput = async () => {
    if (!aiInput.trim() || !selectedClient || !currentOrg) return
    const userMsg = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setAiProcessing(true)

    const protocolSummary = protocol ? MODALITIES.map(m => {
      const enabled = (protocol as any)[`${m.key}_enabled`]
      if (!enabled) return null
      const fields = Object.entries(protocol)
        .filter(([k, v]) => k.startsWith(m.key + '_') && k !== `${m.key}_enabled` && v)
        .map(([k, v]) => `${k.replace(m.key + '_', '')}: ${v}`)
        .join(', ')
      return `${m.label}: ${fields}`
    }).filter(Boolean).join('\n') : 'No protocol set up yet.'

    const systemPrompt = `You are an AI clinical documentation assistant for Sensorium Neuro Wellness / Neuro Progeny. You help techs fill out session notes from plain language descriptions.

CLIENT: ${selectedClient.first_name} ${selectedClient.last_name}
CURRENT PROTOCOL:
${protocolSummary}

SESSION DATE: ${note.session_date}

MODALITIES AVAILABLE: ${MODALITIES.map(m => m.label).join(', ')}

YOUR JOB:
1. When the tech describes what happened in plain language, parse it into structured session note fields.
2. If they say "client completed everything" or "completed per protocol", mark all enabled modalities as completed with no modifications.
3. If they mention a modification (e.g. "changed NF sites to Pz"), mark that modality as modified, record the modification, and note it differs from protocol.
4. If they say "make permanent change" or "update the protocol", output a JSON block tagged with <protocol_update> containing the fields to change.
5. Always respond with a <session_data> JSON block containing the fields to update on the session note.

RESPONSE FORMAT:
Provide a brief confirmation message, then include:
<session_data>
{
  "nf_completed": true/false,
  "nf_modified": false,
  "nf_session_notes": "...",
  "vr_completed": true/false,
  ...any fields that should be updated
  "general_notes": "...",
  "client_reported": "..."
}
</session_data>

If protocol should be permanently updated:
<protocol_update>
{
  "nf_sites": "new value",
  "change_summary": "Changed NF sites from X to Y"
}
</protocol_update>

Keep responses concise. Use clinical but accessible language. No em dashes.`

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...aiMessages.map(m => ({ role: m.role === 'assistant' ? 'ai' : m.role, content: m.text })),
            { role: 'user', content: userMsg },
          ],
          campaignContext: { systemOverride: systemPrompt },
        }),
      })
      const data = await res.json()
      const aiText = data.content || data.message || data.text || ''

      setAiMessages(prev => [...prev, { role: 'assistant', text: aiText }])

      // Parse session_data
      const sessionMatch = aiText.match(/<session_data>([\s\S]*?)<\/session_data>/)
      if (sessionMatch) {
        try {
          const parsed = JSON.parse(sessionMatch[1])
          setNote(prev => ({ ...prev, ...parsed, ai_raw_input: (prev.ai_raw_input || '') + '\n' + userMsg }))
        } catch {}
      }

      // Parse protocol_update
      const protoMatch = aiText.match(/<protocol_update>([\s\S]*?)<\/protocol_update>/)
      if (protoMatch && protocol) {
        try {
          const updates = JSON.parse(protoMatch[1])
          const summary = updates.change_summary || 'AI-modified protocol'
          delete updates.change_summary
          const updated = { ...protocol, ...updates }
          await supabase.from('ehr_protocols').update(updates).eq('id', protocol.id)
          await supabase.from('ehr_protocol_history').insert({
            org_id: currentOrg.id, protocol_id: protocol.id, contact_id: selectedClient.id,
            changed_by: user?.id, change_type: 'ai_modified', change_summary: summary,
            previous_values: protocol, new_values: updated,
          })
          loadClientData(selectedClient.id)
        } catch {}
      }
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'assistant', text: 'Error processing request. Please try again.' }])
    }
    setAiProcessing(false)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div className="flex gap-4 h-[calc(100vh-6rem)]">
      {/* ═══ LEFT PANEL: Client List ═══ */}
      <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-50">
          <h2 className="text-xs font-bold text-np-dark mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-np-blue" /> Enrolled Clients
          </h2>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
          </div>
        </div>

        {/* Today's schedule header */}
        <div className="px-3 py-2 bg-np-blue/5 border-b border-gray-50">
          <p className="text-[9px] font-bold text-np-blue uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Today · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredClients.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">No enrolled clients found</p>
              <p className="text-[10px] text-gray-300 mt-1">Add contacts to the Enrolled pipeline stage in CRM</p>
            </div>
          ) : (
            filteredClients.map(c => (
              <button key={c.id} onClick={() => selectClient(c)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors
                  ${selectedClient?.id === c.id ? 'bg-np-blue/5 border-l-2 border-l-np-blue' : ''}`}>
                <p className="text-xs font-semibold text-np-dark">{c.last_name}, {c.first_name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{c.pipeline_stage || 'Enrolled'}</p>
              </button>
            ))
          )}
        </div>

        <div className="p-2 border-t border-gray-50 text-center">
          <p className="text-[9px] text-gray-300">{filteredClients.length} enrolled</p>
        </div>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedClient ? (
          <div className="flex-1 flex items-center justify-center bg-white border border-gray-100 rounded-2xl">
            <div className="text-center">
              <ClipboardList className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Session Notes</h2>
              <p className="text-sm text-gray-400">Select a client from the list to start a session note</p>
            </div>
          </div>
        ) : (
          <>
            {/* Client header + tabs */}
            <div className="bg-white border border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-np-dark">{selectedClient.first_name} {selectedClient.last_name}</h2>
                <p className="text-[10px] text-gray-400">{selectedClient.email} · {selectedClient.pipeline_stage || 'Enrolled'}</p>
              </div>
              <div className="flex items-center gap-1">
                {(['note', 'protocol', 'history'] as const).map(v => (
                  <button key={v} onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${view === v ? 'bg-np-blue text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                    {v === 'note' ? 'Session Note' : v === 'protocol' ? 'Protocol' : 'History'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden border border-t-0 border-gray-100 rounded-b-2xl">
              {/* ─── SESSION NOTE VIEW ─── */}
              {view === 'note' && (
                <div className="flex-1 flex overflow-hidden">
                  {/* Note form */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Date/Time/Tech row */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Date</label>
                        <input type="date" value={note.session_date || ''} onChange={e => setNote(n => ({ ...n, session_date: e.target.value }))}
                          className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Time</label>
                        <input type="time" value={note.session_time || ''} onChange={e => setNote(n => ({ ...n, session_time: e.target.value }))}
                          className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Tech</label>
                        <input value={note.tech_name || ''} onChange={e => setNote(n => ({ ...n, tech_name: e.target.value }))}
                          className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                      </div>
                    </div>

                    {/* Modality cards */}
                    <div>
                      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Modalities</h3>
                      <div className="space-y-2">
                        {MODALITIES.map(m => {
                          const enabled = protocol ? (protocol as any)[`${m.key}_enabled`] : false
                          const completed = (note as any)[`${m.key}_completed`]
                          const modified = (note as any)[`${m.key}_modified`]
                          const Icon = m.icon
                          return (
                            <div key={m.key} className={`border rounded-xl p-3 transition-colors ${enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50/50 opacity-60'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`w-6 h-6 rounded-md ${m.bg} flex items-center justify-center`}>
                                    <Icon className={`w-3.5 h-3.5 ${m.color}`} />
                                  </div>
                                  <span className="text-xs font-semibold text-np-dark">{m.label}</span>
                                  {!enabled && <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Not in protocol</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
                                    <input type="checkbox" checked={!!completed}
                                      onChange={e => setNote(n => ({ ...n, [`${m.key}_completed`]: e.target.checked }))}
                                      className="accent-green-500 w-3 h-3" /> Done
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-amber-600 cursor-pointer">
                                    <input type="checkbox" checked={!!modified}
                                      onChange={e => setNote(n => ({ ...n, [`${m.key}_modified`]: e.target.checked }))}
                                      className="accent-amber-500 w-3 h-3" /> Modified
                                  </label>
                                </div>
                              </div>
                              {/* Protocol summary line */}
                              {enabled && protocol && (
                                <p className="text-[10px] text-gray-400 mt-1.5 ml-8">
                                  {Object.entries(protocol).filter(([k, v]) => k.startsWith(m.key + '_') && k !== `${m.key}_enabled` && v).map(([k, v]) => `${k.replace(m.key + '_', '').replace(/_/g, ' ')}: ${v}`).join(' · ') || 'No details set'}
                                </p>
                              )}
                              {/* Modification note */}
                              {modified && (
                                <textarea value={(note as any)[`${m.key}_modifications`] || ''}
                                  onChange={e => setNote(n => ({ ...n, [`${m.key}_modifications`]: e.target.value }))}
                                  placeholder="Describe the modification..."
                                  rows={2}
                                  className="mt-2 w-full px-3 py-1.5 text-xs border border-amber-200 bg-amber-50/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200" />
                              )}
                              {/* Session notes */}
                              {(completed || modified) && (
                                <textarea value={(note as any)[`${m.key}_session_notes`] || ''}
                                  onChange={e => setNote(n => ({ ...n, [`${m.key}_session_notes`]: e.target.value }))}
                                  placeholder="Session notes for this modality..."
                                  rows={2}
                                  className="mt-2 w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* General notes */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">General Notes</label>
                      <textarea value={note.general_notes || ''} onChange={e => setNote(n => ({ ...n, general_notes: e.target.value }))}
                        rows={3} placeholder="Overall session observations..."
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Client Reported</label>
                      <textarea value={note.client_reported || ''} onChange={e => setNote(n => ({ ...n, client_reported: e.target.value }))}
                        rows={2} placeholder="What the client shared about their experience..."
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <p className="text-[10px] text-gray-400">Status: <span className="font-medium text-np-dark">{note.status || 'draft'}</span></p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => saveNote('draft')} disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
                          <Save className="w-3 h-3 inline mr-1" /> Save Draft
                        </button>
                        <button onClick={() => saveNote('completed')} disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors disabled:opacity-50">
                          <Check className="w-3 h-3 inline mr-1" /> Complete
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ─── AI Chat Panel ─── */}
                  <div className="w-80 border-l border-gray-100 flex flex-col bg-gray-50/50">
                    <div className="px-4 py-3 border-b border-gray-100 bg-white">
                      <h3 className="text-xs font-bold text-np-dark flex items-center gap-1.5">
                        <Wand2 className="w-3.5 h-3.5 text-purple-500" /> AI Session Assistant
                      </h3>
                      <p className="text-[9px] text-gray-400 mt-0.5">Describe the session in plain language</p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {aiMessages.length === 0 && (
                        <div className="text-center py-6">
                          <Sparkles className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                          <p className="text-[10px] text-gray-400">Try: "Client completed everything per protocol"</p>
                          <p className="text-[10px] text-gray-300 mt-1">or: "Modified NF to Pz, everything else per protocol"</p>
                          <p className="text-[10px] text-gray-300 mt-1">or: "Make the NF change permanent"</p>
                        </div>
                      )}
                      {aiMessages.map((m, i) => (
                        <div key={i} className={`${m.role === 'user' ? 'ml-8' : 'mr-4'}`}>
                          <div className={`px-3 py-2 rounded-xl text-xs ${m.role === 'user' ? 'bg-np-blue text-white ml-auto' : 'bg-white border border-gray-200 text-np-dark'}`}>
                            {m.text.replace(/<session_data>[\s\S]*?<\/session_data>/g, '').replace(/<protocol_update>[\s\S]*?<\/protocol_update>/g, '').trim() || 'Fields updated.'}
                          </div>
                        </div>
                      ))}
                      {aiProcessing && (
                        <div className="flex items-center gap-2 px-3 py-2">
                          <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />
                          <span className="text-[10px] text-gray-400">Processing...</span>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    <div className="p-3 border-t border-gray-100 bg-white">
                      <div className="flex gap-2">
                        <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), processAiInput())}
                          placeholder="Describe the session..."
                          disabled={aiProcessing}
                          className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:opacity-50" />
                        <button onClick={processAiInput} disabled={aiProcessing || !aiInput.trim()}
                          className="px-2.5 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── PROTOCOL VIEW ─── */}
              {view === 'protocol' && (
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-np-dark">Protocol Sheet</h3>
                    <button onClick={() => setShowProtocolEditor(!showProtocolEditor)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-np-blue bg-np-blue/5 hover:bg-np-blue/10 rounded-lg transition-colors">
                      {showProtocolEditor ? <><X className="w-3 h-3" /> Cancel</> : <><FileText className="w-3 h-3" /> {protocol ? 'Edit Protocol' : 'Create Protocol'}</>}
                    </button>
                  </div>

                  {!protocol && !showProtocolEditor ? (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-gray-400 mb-3">No protocol set up for this client</p>
                      <button onClick={() => setShowProtocolEditor(true)}
                        className="text-xs font-medium text-np-blue hover:underline">Create Protocol</button>
                    </div>
                  ) : (
                    <ProtocolEditor
                      protocol={protocol || ({} as Protocol)}
                      editing={showProtocolEditor}
                      onSave={saveProtocol}
                    />
                  )}
                </div>
              )}

              {/* ─── HISTORY VIEW ─── */}
              {view === 'history' && (
                <div className="flex-1 overflow-y-auto p-5">
                  <h3 className="text-sm font-bold text-np-dark mb-4">Session & Protocol History</h3>

                  {/* Protocol changes */}
                  {protocolHistory.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-[10px] font-bold text-purple-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <History className="w-3 h-3" /> Protocol Changes
                      </h4>
                      <div className="space-y-2">
                        {protocolHistory.map(h => (
                          <div key={h.id} className="border border-gray-100 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium
                                ${h.change_type === 'created' ? 'bg-green-100 text-green-700' : h.change_type === 'ai_modified' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                                {h.change_type === 'ai_modified' ? 'AI Modified' : h.change_type}
                              </span>
                              <span className="text-[9px] text-gray-400">{new Date(h.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-np-dark">{h.change_summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Past session notes */}
                  <h4 className="text-[10px] font-bold text-np-blue uppercase tracking-wider mb-2 flex items-center gap-1">
                    <ClipboardList className="w-3 h-3" /> Past Sessions
                  </h4>
                  {pastNotes.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">No past sessions recorded</p>
                  ) : (
                    <div className="space-y-2">
                      {pastNotes.map(n => {
                        const completedMods = MODALITIES.filter(m => (n as any)[`${m.key}_completed`])
                        const modifiedMods = MODALITIES.filter(m => (n as any)[`${m.key}_modified`])
                        return (
                          <div key={n.id} className="border border-gray-100 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-np-dark">{new Date(n.session_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium
                                ${n.status === 'completed' ? 'bg-green-100 text-green-700' : n.status === 'reviewed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                {n.status}
                              </span>
                            </div>
                            {completedMods.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {completedMods.map(m => (
                                  <span key={m.key} className={`text-[9px] px-1.5 py-0.5 rounded ${m.bg} ${m.color} font-medium`}>{m.label}</span>
                                ))}
                              </div>
                            )}
                            {modifiedMods.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {modifiedMods.map(m => (
                                  <span key={m.key} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" /> {m.label} modified
                                  </span>
                                ))}
                              </div>
                            )}
                            {n.general_notes && <p className="text-[10px] text-gray-500 mt-1">{n.general_notes}</p>}
                            {n.tech_name && <p className="text-[9px] text-gray-400 mt-1">Tech: {n.tech_name}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═══ Protocol Editor Sub-component ═══ */
function ProtocolEditor({ protocol, editing, onSave }: { protocol: Partial<Protocol>; editing: boolean; onSave: (p: Partial<Protocol>) => void }) {
  const [draft, setDraft] = useState<Record<string, any>>({ ...protocol })

  useEffect(() => { setDraft({ ...protocol }) }, [protocol])

  const toggle = (key: string) => setDraft(d => ({ ...d, [key]: !d[key] }))
  const set = (key: string, val: any) => setDraft(d => ({ ...d, [key]: val }))

  const PROTO_FIELDS: Record<string, { label: string; fields: { key: string; label: string; type: 'text' | 'number' }[] }> = {
    nf: { label: 'Neurofeedback', fields: [{ key: 'nf_sites', label: 'Sites', type: 'text' }, { key: 'nf_frequency', label: 'Frequency/Protocol', type: 'text' }, { key: 'nf_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'nf_notes', label: 'Notes', type: 'text' }] },
    vr: { label: 'VR Biofeedback', fields: [{ key: 'vr_program', label: 'Program', type: 'text' }, { key: 'vr_hrv_target', label: 'HRV Target', type: 'text' }, { key: 'vr_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'vr_notes', label: 'Notes', type: 'text' }] },
    vest: { label: 'Vestibular', fields: [{ key: 'vest_exercises', label: 'Exercises', type: 'text' }, { key: 'vest_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'vest_notes', label: 'Notes', type: 'text' }] },
    prop: { label: 'Proprioception', fields: [{ key: 'prop_exercises', label: 'Exercises', type: 'text' }, { key: 'prop_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'prop_notes', label: 'Notes', type: 'text' }] },
    tdcs: { label: 'tDCS', fields: [{ key: 'tdcs_montage', label: 'Montage', type: 'text' }, { key: 'tdcs_current_ma', label: 'Current (mA)', type: 'number' }, { key: 'tdcs_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'tdcs_notes', label: 'Notes', type: 'text' }] },
    rl_helmet: { label: 'Red Light Helmet', fields: [{ key: 'rl_helmet_program', label: 'Program', type: 'text' }, { key: 'rl_helmet_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'rl_helmet_notes', label: 'Notes', type: 'text' }] },
    rl_bed: { label: 'Red Light Bed', fields: [{ key: 'rl_bed_program', label: 'Program', type: 'text' }, { key: 'rl_bed_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'rl_bed_notes', label: 'Notes', type: 'text' }] },
    hbot: { label: 'Hyperbaric', fields: [{ key: 'hbot_pressure_ata', label: 'Pressure (ATA)', type: 'number' }, { key: 'hbot_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'hbot_notes', label: 'Notes', type: 'text' }] },
    vns: { label: 'Vagus Nerve Stim', fields: [{ key: 'vns_device', label: 'Device', type: 'text' }, { key: 'vns_settings', label: 'Settings', type: 'text' }, { key: 'vns_duration_min', label: 'Duration (min)', type: 'number' }, { key: 'vns_notes', label: 'Notes', type: 'text' }] },
  }

  return (
    <div className="space-y-3">
      {MODALITIES.map(m => {
        const enabled = !!draft[`${m.key}_enabled`]
        const Icon = m.icon
        const fields = PROTO_FIELDS[m.key]?.fields || []
        return (
          <div key={m.key} className={`border rounded-xl overflow-hidden transition-colors ${enabled ? 'border-gray-200' : 'border-gray-100'}`}>
            <button onClick={() => editing && toggle(`${m.key}_enabled`)}
              className={`w-full flex items-center justify-between px-4 py-3 ${editing ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg ${m.bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${m.color}`} />
                </div>
                <span className="text-xs font-semibold text-np-dark">{m.label}</span>
              </div>
              <div className={`w-8 h-4.5 rounded-full transition-colors flex items-center ${enabled ? 'bg-green-500 justify-end' : 'bg-gray-200 justify-start'}`}>
                <div className="w-3.5 h-3.5 rounded-full bg-white shadow mx-0.5" />
              </div>
            </button>
            {enabled && (
              <div className="px-4 pb-3 grid grid-cols-2 gap-2 border-t border-gray-50 pt-3">
                {fields.map(f => (
                  <div key={f.key} className={f.type === 'text' && f.key.endsWith('notes') ? 'col-span-2' : ''}>
                    <label className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mb-0.5 block">{f.label}</label>
                    {editing ? (
                      <input type={f.type} value={draft[f.key] || ''} onChange={e => set(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                    ) : (
                      <p className="text-xs text-np-dark py-1">{draft[f.key] || <span className="text-gray-300 italic">Not set</span>}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {editing && (
        <div className="flex justify-end pt-2">
          <button onClick={() => onSave(draft)}
            className="px-4 py-2 text-xs font-medium text-white bg-np-blue hover:bg-np-blue/90 rounded-lg transition-colors">
            <Save className="w-3 h-3 inline mr-1" /> Save Protocol
          </button>
        </div>
      )}
    </div>
  )
}
