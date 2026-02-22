'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Conversations — Unified inbox for SMS, voice, email
// Route: /crm/conversations
// Queries existing: conversations, crm_messages, call_logs
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  Search, Phone, MessageCircle, Mail, Filter, Send, X, Check, CheckCheck, Clock,
  ArrowUpRight, ArrowDownLeft, PhoneMissed, Voicemail, Archive, User, RefreshCw, Plus
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { createConversation, fetchContacts } from '@/lib/crm-client'
import { useWorkspace } from '@/lib/workspace-context'
import type { CrmContact, Conversation, Message, CallLog } from '@/types/crm'

type ChannelFilter = 'all' | 'sms' | 'voice' | 'email'
type DirectionFilter = 'both' | 'inbound' | 'outbound'

interface ThreadItem {
  id: string
  contact_id: string
  contact_name: string
  contact_initials: string
  contact_phone: string | null
  channel: string
  last_message_at: string
  unread_count: number
  snoozed_until: string | null
  last_preview: string
}

interface TimelineEntry {
  id: string
  type: 'sms' | 'call'
  direction: string
  body: string | null
  status: string
  duration_seconds: number | null
  ai_summary: string | null
  sentiment: string | null
  created_at: string
}

function fmtTime(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtFullTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtDuration(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function ConversationsPage() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [threads, setThreads] = useState<ThreadItem[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('both')
  const [searchQuery, setSearchQuery] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // New conversation state
  const [showNewConv, setShowNewConv] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<CrmContact[]>([])
  const [searchingContacts, setSearchingContacts] = useState(false)

  // Load threads from existing conversations table
  useEffect(() => { loadThreads() }, [channelFilter])

  async function loadThreads() {
    setLoading(true)
    let query = supabase
      .from('conversations')
      .select('*, contacts!inner(first_name, last_name, phone, email, tags, pipeline_stage)')
      .order('last_message_at', { ascending: false })
      .limit(100)

    if (channelFilter !== 'all') query = query.eq('channel', channelFilter)

    const { data } = await query
    if (data) {
      const mapped: ThreadItem[] = data.map((d: any) => ({
        id: d.id,
        contact_id: d.contact_id,
        contact_name: `${d.contacts.first_name} ${d.contacts.last_name}`,
        contact_initials: `${d.contacts.first_name?.[0] || ''}${d.contacts.last_name?.[0] || ''}`,
        contact_phone: d.contacts.phone,
        channel: d.channel,
        last_message_at: d.last_message_at || d.updated_at,
        unread_count: d.unread_count || 0,
        snoozed_until: d.snoozed_until,
        last_preview: '', // will be set from messages
      }))

      const filtered = searchQuery
        ? mapped.filter(t => t.contact_name.toLowerCase().includes(searchQuery.toLowerCase()))
        : mapped

      setThreads(filtered)
    }
    setLoading(false)
  }

  // Load messages + calls for selected thread
  useEffect(() => {
    if (!selectedThread) { setTimeline([]); return }
    loadTimeline(selectedThread)
  }, [selectedThread?.id, directionFilter])

  async function loadTimeline(thread: ThreadItem) {
    const entries: TimelineEntry[] = []

    // Load SMS messages
    if (thread.channel === 'sms' || thread.channel === 'email') {
      let msgQuery = supabase
        .from('crm_messages')
        .select('*')
        .eq('conversation_id', thread.id)
        .order('created_at', { ascending: true })

      if (directionFilter !== 'both') msgQuery = msgQuery.eq('direction', directionFilter)

      const { data: msgs } = await msgQuery
      if (msgs) {
        msgs.forEach((m: any) => entries.push({
          id: m.id, type: 'sms', direction: m.direction,
          body: m.body, status: m.status,
          duration_seconds: null, ai_summary: null, sentiment: null,
          created_at: m.sent_at || m.created_at,
        }))
      }
    }

    // Load calls for this contact
    if (thread.channel === 'voice' || thread.channel === 'sms') {
      let callQuery = supabase
        .from('call_logs')
        .select('*')
        .eq('contact_id', thread.contact_id)
        .order('started_at', { ascending: true })

      if (directionFilter !== 'both') callQuery = callQuery.eq('direction', directionFilter)

      const { data: calls } = await callQuery
      if (calls) {
        calls.forEach((c: any) => entries.push({
          id: c.id, type: 'call', direction: c.direction,
          body: null, status: c.status,
          duration_seconds: c.duration_seconds, ai_summary: c.ai_summary,
          sentiment: c.sentiment,
          created_at: c.started_at,
        }))
      }
    }

    // Sort by time
    entries.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    setTimeline(entries)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  async function sendSms() {
    if (!newMessage.trim() || !selectedThread || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: selectedThread.contact_id, body: newMessage.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setNewMessage('')
        inputRef.current?.focus()
        loadTimeline(selectedThread)
      }
    } catch (e) { console.error('Send failed:', e) }
    setSending(false)
  }

  const unreadTotal = threads.reduce((s, t) => s + t.unread_count, 0)

  // ── New conversation: contact search ──
  const searchNewContacts = async (q: string) => {
    setContactSearch(q)
    if (q.length < 2) { setContactResults([]); return }
    setSearchingContacts(true)
    try {
      const res = await fetchContacts({ org_id: currentOrg?.id, q, limit: 10 })
      setContactResults(res.contacts)
    } catch (e) { console.error(e) }
    finally { setSearchingContacts(false) }
  }

  const startConversation = async (contact: CrmContact) => {
    try {
      const convId = await createConversation(contact.id, 'sms', currentOrg?.id || '')
      setShowNewConv(false)
      setContactSearch('')
      setContactResults([])
      await loadThreads()
      const thread = threads.find(t => t.id === convId) || {
        id: convId, contact_id: contact.id,
        contact_name: `${contact.first_name} ${contact.last_name}`,
        contact_initials: `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`,
        contact_phone: contact.phone || null, channel: 'sms',
        last_message_at: new Date().toISOString(), unread_count: 0,
        snoozed_until: null, last_preview: '',
      }
      setSelectedThread(thread)
    } catch (e) { console.error(e); alert('Failed to start conversation') }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 rounded-xl overflow-hidden border border-gray-100 bg-white animate-in fade-in duration-300">
      {/* ─── LEFT: Thread List ─── */}
      <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-50">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-sm font-bold text-np-dark">
              Conversations
              {unreadTotal > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-[8px] font-bold rounded-full">{unreadTotal}</span>
              )}
            </h2>
            <div className="flex gap-1">
              <button onClick={() => setShowNewConv(true)} title="New conversation"
                className="p-1.5 rounded-md bg-np-blue text-white hover:bg-np-dark transition-colors">
                <Plus size={13} />
              </button>
              <button onClick={() => setShowFilters(!showFilters)}
                className={`p-1.5 rounded-md transition-colors ${showFilters ? 'bg-np-blue/10 text-np-blue' : 'hover:bg-gray-50 text-gray-400'}`}>
                <Filter size={13} />
              </button>
              <button onClick={loadThreads} className="p-1.5 rounded-md hover:bg-gray-50 text-gray-400">
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); loadThreads() }}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder:text-gray-300" />
          </div>

          {showFilters && (
            <div className="mt-2.5 space-y-2">
              {/* Channel */}
              <div className="flex bg-gray-50 rounded-lg p-0.5">
                {([
                  { key: 'all', label: 'All' },
                  { key: 'sms', label: 'SMS', Icon: MessageCircle },
                  { key: 'voice', label: 'Voice', Icon: Phone },
                  { key: 'email', label: 'Email', Icon: Mail },
                ] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => setChannelFilter(key)}
                    className={`flex-1 py-1.5 text-[9px] font-medium rounded-md transition-all ${
                      channelFilter === key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'
                    }`}>{label}</button>
                ))}
              </div>
              {/* Direction */}
              <div className="flex bg-gray-50 rounded-lg p-0.5">
                {([
                  { key: 'both', label: 'Both' },
                  { key: 'inbound', label: 'Incoming', Icon: ArrowDownLeft },
                  { key: 'outbound', label: 'Outgoing', Icon: ArrowUpRight },
                ] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => setDirectionFilter(key)}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] font-medium rounded-md transition-all ${
                      directionFilter === key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Threads */}
        <div className="flex-1 overflow-auto">
          {loading && <p className="text-[10px] text-gray-400 text-center py-12">Loading...</p>}
          {!loading && threads.length === 0 && <p className="text-[10px] text-gray-400 text-center py-12">No conversations found</p>}
          {threads.map(thread => (
            <button key={thread.id} onClick={() => setSelectedThread(thread)}
              className={`w-full flex items-start gap-2.5 p-3 border-b border-gray-50 text-left transition-colors ${
                selectedThread?.id === thread.id ? 'bg-np-blue/5' : 'hover:bg-gray-50/50'
              }`}>
              <div className="relative flex-shrink-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${thread.unread_count > 0 ? 'bg-np-blue/10' : 'bg-gray-100'}`}>
                  <span className={`text-[9px] font-bold ${thread.unread_count > 0 ? 'text-np-blue' : 'text-gray-400'}`}>
                    {thread.contact_initials}
                  </span>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-gray-100 flex items-center justify-center">
                  {thread.channel === 'sms' && <MessageCircle size={8} className="text-blue-500" />}
                  {thread.channel === 'voice' && <Phone size={8} className="text-green-500" />}
                  {thread.channel === 'email' && <Mail size={8} className="text-amber-500" />}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className={`text-xs truncate ${thread.unread_count > 0 ? 'font-bold text-np-dark' : 'font-medium text-np-dark'}`}>
                    {thread.contact_name}
                  </p>
                  <span className="text-[8px] text-gray-400 flex-shrink-0 ml-2">{fmtTime(thread.last_message_at)}</span>
                </div>
                <p className={`text-[10px] truncate ${thread.unread_count > 0 ? 'text-gray-600' : 'text-gray-400'}`}>
                  {thread.contact_phone || 'No phone'}
                </p>
              </div>
              {thread.unread_count > 0 && (
                <div className="w-4 h-4 rounded-full bg-np-blue flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[7px] font-bold text-white">{thread.unread_count}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── RIGHT: Message Thread ─── */}
      <div className="flex-1 flex flex-col">
        {!selectedThread ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageCircle size={32} className="mx-auto text-gray-400/20 mb-3" />
              <p className="text-sm text-gray-400">Select a conversation</p>
              <p className="text-[10px] text-gray-300 mt-1">Filter by channel and direction above</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-np-blue/10 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-np-blue">{selectedThread.contact_initials}</span>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-np-dark">{selectedThread.contact_name}</h3>
                  <p className="text-[10px] text-gray-400">{selectedThread.contact_phone || ''} · {selectedThread.channel}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Link href={`/crm/contacts?open=${selectedThread.contact_id}`}
                  className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-400" title="View contact"><User size={14} /></Link>
                <button onClick={async () => {
                  if (!confirm('Archive this conversation? It will be hidden from the list.')) return
                  await supabase.from('conversations').update({ status: 'archived' }).eq('id', selectedThread.id)
                  setSelectedThread(null)
                  loadThreads()
                }} className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-400" title="Archive"><Archive size={14} /></button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {timeline.map((entry, i) => {
                const isOut = entry.direction === 'outbound'
                const prev = timeline[i - 1]
                const showTime = !prev || new Date(entry.created_at).getTime() - new Date(prev.created_at).getTime() > 600000

                return (
                  <div key={entry.id}>
                    {showTime && (
                      <div className="flex items-center gap-3 my-3">
                        <div className="flex-1 h-px bg-gray-100" />
                        <span className="text-[8px] text-gray-300">{fmtFullTime(entry.created_at)}</span>
                        <div className="flex-1 h-px bg-gray-100" />
                      </div>
                    )}

                    {entry.type === 'call' ? (
                      <div className="flex justify-center">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-full">
                          {entry.status === 'missed' ? <PhoneMissed size={10} className="text-red-500" /> :
                           entry.direction === 'outbound' ? <ArrowUpRight size={10} className="text-np-blue" /> :
                           <ArrowDownLeft size={10} className="text-green-500" />}
                          <span className="text-[9px] text-gray-500">
                            {entry.direction === 'outbound' ? 'Outgoing' : 'Incoming'} call
                            {entry.duration_seconds ? ` · ${fmtDuration(entry.duration_seconds)}` : ''}
                            {entry.status === 'missed' ? ' · Missed' : ''}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 ${
                          isOut ? 'bg-np-blue text-white rounded-br-md' : 'bg-gray-100 text-np-dark rounded-bl-md'
                        }`}>
                          <p className="text-xs whitespace-pre-wrap break-words">{entry.body || '(no content)'}</p>
                          <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <span className={`text-[7px] ${isOut ? 'text-white/50' : 'text-gray-400'}`}>
                              {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                            {isOut && entry.status === 'delivered' && <CheckCheck size={10} className="text-white/50" />}
                            {isOut && entry.status === 'sent' && <Check size={10} className="text-white/50" />}
                            {isOut && entry.status === 'queued' && <Clock size={10} className="text-white/50" />}
                          </div>
                        </div>
                      </div>
                    )}

                    {entry.type === 'call' && entry.ai_summary && (
                      <div className="flex justify-center mt-1">
                        <p className="text-[8px] text-gray-400 italic max-w-[60%] text-center">{entry.ai_summary}</p>
                      </div>
                    )}
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Compose */}
            {selectedThread.channel === 'sms' && (
              <div className="p-3 border-t border-gray-100">
                <div className="flex items-end gap-2">
                  <textarea ref={inputRef} value={newMessage} onChange={e => setNewMessage(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSms() } }}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-100 rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-np-blue/30 text-np-dark placeholder:text-gray-300 max-h-24"
                    style={{ minHeight: '36px' }}
                    onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = '36px'; t.style.height = Math.min(t.scrollHeight, 96) + 'px' }} />
                  <button onClick={sendSms} disabled={!newMessage.trim() || sending}
                    className="w-9 h-9 rounded-xl bg-np-blue hover:bg-np-dark disabled:bg-gray-200 flex items-center justify-center transition-all flex-shrink-0">
                    <Send size={14} className="text-white" />
                  </button>
                </div>
                <p className="text-[8px] text-gray-300 mt-1 px-1">{newMessage.length > 0 ? `${newMessage.length} chars · ` : ''}Enter to send</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── New Conversation Modal ── */}
      {showNewConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Conversation</h3>
              <button onClick={() => { setShowNewConv(false); setContactSearch(''); setContactResults([]) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Search Contact</label>
              <div className="relative mt-1">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={contactSearch} onChange={e => searchNewContacts(e.target.value)} placeholder="Name, email, or phone..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" autoFocus />
              </div>
            </div>
            <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
              {searchingContacts && <p className="text-[10px] text-gray-400 text-center py-3">Searching...</p>}
              {contactResults.map(c => (
                <button key={c.id} onClick={() => startConversation(c)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-np-dark flex items-center justify-center text-[9px] font-bold text-white">
                    {`${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-np-dark">{c.first_name} {c.last_name}</p>
                    <p className="text-[10px] text-gray-400">{c.phone || c.email || 'No contact info'}</p>
                  </div>
                </button>
              ))}
              {contactSearch.length >= 2 && !searchingContacts && contactResults.length === 0 && (
                <p className="text-[10px] text-gray-400 text-center py-3">No contacts found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
