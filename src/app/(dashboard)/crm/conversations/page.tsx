'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Conversations — Unified inbox for SMS, voice, email
// Route: /crm/conversations
// Queries existing: conversations, crm_messages, call_logs
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, Phone, MessageCircle, Mail, Filter, Send, X, Check, CheckCheck, Clock,
  ArrowUpRight, ArrowDownLeft, PhoneMissed, Voicemail, Archive, User, RefreshCw, Plus
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { createConversation, fetchContacts } from '@/lib/crm-client'
import { useWorkspace } from '@/lib/workspace-context'
import { useOrgLines } from '@/lib/hooks/use-org-lines'
import { formatUsPhone } from '@/lib/phone'
import { fmtListStamp, fmtFull } from '@/lib/date-format'
import type { CrmContact } from '@/types/crm'
import { buildTimeline, TimelineStream, LineBadge, type TimelineEntry } from '@/components/crm/comms-timeline'
import { VoipCall } from '@/components/crm/twilio-comms'

// Channel is no longer a list filter — one card per contact covers all channels.
type DirectionFilter = 'both' | 'inbound' | 'outbound'

// Line dropdown value: 'all', or one of the org's numbers (E.164).
const LINE_ALL = 'all'
const lineStorageKey = (orgId: string) => `npu_hub_conversations_line:${orgId}`

interface ThreadItem {
  id: string
  contact_id: string
  contact_name: string
  contact_initials: string
  contact_phone: string | null
  channel: string
  /** Newest event of any kind on this thread: text, call, voicemail or missed. */
  last_activity_at: string
  unread_count: number
  snoozed_until: string | null
  last_preview: string
  /** The org line this thread most recently used; null = the org default line. */
  line_e164: string | null
}

export default function ConversationsPage() {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const [threads, setThreads] = useState<ThreadItem[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null)
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('both')
  const [searchQuery, setSearchQuery] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  // Why this exists: /api/sms/send answers 403 for a contact without SMS consent
  // or on the DNC list, and that refusal is CORRECT. It was previously invisible
  // — sendSms checked only data.success, never res.ok — so the Send button just
  // did nothing and the operator could not tell "blocked" from "broken".
  const [sendError, setSendError] = useState('')
  // Same reason as sendError, for the thread rather than the composer: clearing
  // the unread badge is a WRITE, and it was previously assumed to succeed.
  const [threadError, setThreadError] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  // Call-back: the contact currently being dialed via the existing VoipCall path.
  const [callBackContact, setCallBackContact] = useState<CrmContact | null>(null)
  const [callBackError, setCallBackError] = useState('')
  // Read inside the stable handleCallBackEnded without making it a dependency.
  const selectedThreadRef = useRef<ThreadItem | null>(null)
  selectedThreadRef.current = selectedThread
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Lines ──────────────────────────────────────────────────────────────
  // The org's numbers come from /api/comms/lines (never a browser read of
  // crm_twilio, which carries credentials). The dropdown renders only when the
  // org has two or more lines, so a single-line or no-line org (Sensorium) sees
  // exactly the page it saw before. Selection persists per org.
  const { lines, defaultLine, loaded: linesLoaded, labelFor } = useOrgLines(currentOrg?.id)
  const [selectedLine, setSelectedLine] = useState<string>(LINE_ALL)
  const showLines = lines.length >= 2

  useEffect(() => {
    if (!currentOrg) return
    let stored = LINE_ALL
    try { stored = localStorage.getItem(lineStorageKey(currentOrg.id)) || LINE_ALL } catch { /* private mode */ }
    setSelectedLine(stored)
  }, [currentOrg?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A remembered line that is no longer one of the org's numbers falls back to
  // "All lines" rather than filtering everything out.
  useEffect(() => {
    if (!linesLoaded) return
    if (selectedLine !== LINE_ALL && !lines.some(l => l.phone === selectedLine)) setSelectedLine(LINE_ALL)
  }, [linesLoaded, lines, selectedLine])

  const chooseLine = (value: string) => {
    setSelectedLine(value)
    if (currentOrg) {
      try { localStorage.setItem(lineStorageKey(currentOrg.id), value) } catch { /* private mode */ }
    }
  }

  // Which line a reply or callback leaves from: the dropdown when one is
  // chosen, else the thread's own line, else null (the server's unchanged
  // default path: getVoiceCallerId for calls, the Messaging Service for texts).
  const effectiveLine: string | null =
    selectedLine !== LINE_ALL ? selectedLine : (selectedThread?.line_e164 || null)
  const effectiveLineLabel = labelFor(effectiveLine)

  // Load threads from existing conversations table. Re-runs when the line
  // filter changes (and once the default line is known, since NULL rows belong
  // to it).
  useEffect(() => { loadThreads() }, [selectedLine, defaultLine]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadThreads() {
    setLoading(true)
    let query = supabase
      .from('conversations')
      .select('*, contacts!inner(first_name, last_name, phone, email, tags, pipeline_stage)')
      // Hide threads removed from Conversations. status='closed' is what the
      // archive action sets; the row and all its records stay in the CRM, and
      // bumpConversation flips it back to 'open' if that number contacts again.
      // (Previously there was NO status filter at all, so archiving — which was
      // itself failing on the CHECK constraint — could never have hidden a thread.)
      .neq('status', 'closed')
      // Order by ANY activity, not only texts. last_activity_at is maintained
      // by migration 209's triggers plus bumpConversation, from each event's
      // own timestamp. NULLS LAST keeps threads with no events at the bottom;
      // last_message_at is the tiebreak for any row 209's backfill left null.
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100)

    // Line filter. NULL line_e164 means "the org's default line", so the default
    // line's view includes those rows; any other line matches exactly.
    if (selectedLine !== LINE_ALL) {
      query = selectedLine === defaultLine
        ? query.or(`line_e164.eq.${selectedLine},line_e164.is.null`)
        : query.eq('line_e164', selectedLine)
    }

    const { data } = await query
    if (data) {
      const mapped: ThreadItem[] = data.map((d: any) => ({
        id: d.id,
        contact_id: d.contact_id,
        contact_name: `${d.contacts.first_name} ${d.contacts.last_name}`,
        contact_initials: `${d.contacts.first_name?.[0] || ''}${d.contacts.last_name?.[0] || ''}`,
        contact_phone: d.contacts.phone,
        channel: d.channel,
        last_activity_at: d.last_activity_at || d.last_message_at || d.updated_at,
        unread_count: d.unread_count || 0,
        snoozed_until: d.snoozed_until,
        last_preview: d.last_message_preview || '',
        line_e164: d.line_e164 || null,
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
    // Merge crm_messages (texts) + call_logs (calls/voicemails/missed) into one
    // timestamp-sorted stream. Texts scoped to this thread; calls by contact.
    const entries = await buildTimeline(supabase, {
      contactId: thread.contact_id,
      conversationId: thread.id,
      directionFilter,
    })
    setTimeline(entries)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  // Remove from Conversations. Goes through the admin-gated route rather than a
  // direct browser write, and — unlike the previous version — the failure is
  // SURFACED. The old one wrote status='archived', which the CHECK constraint
  // (open|snoozed|closed) rejected on every attempt, with the error unchecked.
  async function archiveThread() {
    if (!selectedThread) return
    if (!confirm(
      'Remove this conversation from the list?\n\n' +
      'The contact, their calls, voicemails and texts all stay in the CRM — only the ' +
      'thread is hidden. It comes back automatically if this number contacts you again.'
    )) return
    try {
      const res = await fetch('/api/comms/conversation/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedThread.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not remove the conversation')
      setSelectedThread(null)
      loadThreads()
    } catch (e: any) {
      alert(e?.message || 'Could not remove the conversation')
    }
  }

  // Call back the person in this thread, reusing the EXISTING outbound path
  // (VoipCall -> /api/voice/token -> transient Device). Not a new outbound flow,
  // and not gated behind the browser-calling receiver toggle — outbound has
  // always minted its own Device. It needs mic permission, which the receiver
  // opt-in already grants if enabled; otherwise the browser prompts here.
  async function startCallBack() {
    if (!selectedThread) return
    setCallBackError('')
    // Fetch the real contact row rather than casting a stub — VoipCall posts
    // contact_id and renders the contact's name/phone. Unknown placeholder
    // contacts work unchanged: they carry the caller's number.
    const { data: contact } = await supabase
      .from('contacts').select('*').eq('id', selectedThread.contact_id).maybeSingle()
    if (!contact?.phone) {
      setCallBackError('No phone number on this contact to call back.')
      return
    }
    setCallBackContact(contact as CrmContact)
  }

  // Call ended: unmount the dialer, then refresh the thread. Stable identity via
  // useCallback so it can never destabilise VoipCall's effects.
  const handleCallBackEnded = useCallback(() => {
    const thread = selectedThreadRef.current
    setTimeout(() => {
      setCallBackContact(null)
      if (thread) loadTimeline(thread)
    }, 1200)   // let "Call ended" register before the panel disappears
  }, [])

  // Opening a thread clears its unread badge (staff UPDATE, 067 WITH CHECK).
  async function openThread(thread: ThreadItem) {
    setSelectedThread(thread)
    // A refusal belongs to the contact it was raised for. Carrying it across a
    // thread switch would accuse the next contact of the previous one's block.
    setSendError('')
    setThreadError('')
    if (thread.unread_count > 0) {
      // The badge is cleared locally only once the write is KNOWN to have landed.
      // Clearing it optimistically made a rejected UPDATE (the 067 WITH CHECK can
      // refuse it) look like success until a reload silently put the badge back.
      const { error } = await supabase.from('conversations')
        .update({ unread_count: 0 }).eq('id', thread.id)
      if (error) {
        console.error('[conversations] clearing unread_count failed:', error)
        setThreadError('Could not mark this thread as read.')
        return
      }
      setThreads(prev => prev.map(t => (t.id === thread.id ? { ...t, unread_count: 0 } : t)))
    }
  }

  async function sendSms() {
    if (!newMessage.trim() || !selectedThread || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selectedThread.contact_id,
          body: newMessage.trim(),
          // Pinned line, when one applies (dropdown, else the thread's line).
          ...(effectiveLine ? { line_e164: effectiveLine } : {}),
        }),
      })
      // Parsed defensively: an error response is not guaranteed to carry a JSON
      // body, and a throw here would land in the catch as a bare "Unexpected
      // token" that says nothing about the actual refusal.
      const data: { success?: boolean; error?: string } =
        await res.json().catch(() => ({}))

      // The refusal is the product, not a failure to swallow. A 403 is the
      // consent gate working; the operator has to be able to READ it. The draft
      // is deliberately left in the box on every failure path so nothing the
      // operator typed is lost to an error they did not cause.
      if (!res.ok) {
        setSendError(data.error || `Send failed (${res.status})`)
        return
      }
      if (!data.success) {
        setSendError(data.error || 'Send failed for an unknown reason')
        return
      }

      setNewMessage('')
      inputRef.current?.focus()
      loadTimeline(selectedThread)
      // A pinned send moved the thread onto that line; keep the card in step.
      if (effectiveLine && selectedThread.line_e164 !== effectiveLine) {
        const moved = { ...selectedThread, line_e164: effectiveLine }
        setSelectedThread(moved)
        setThreads(prev => prev.map(t => (t.id === moved.id ? moved : t)))
      }
    } catch (e: any) {
      setSendError(e?.message ? `Send failed: ${e.message}` : 'Send failed: network error')
    } finally {
      // finally, not a trailing statement: every branch above returns early, and
      // a trailing setSending(false) would be skipped and wedge the button.
      setSending(false)
    }
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

  // New conversation state
  const [showNewConv, setShowNewConv] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<CrmContact[]>([])
  const [searchingContacts, setSearchingContacts] = useState(false)

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
        last_activity_at: new Date().toISOString(), unread_count: 0,
        snoozed_until: null, last_preview: '', line_e164: null,
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

          {/* Line dropdown — only for an org with two or more numbers. */}
          {showLines && (
            <select
              value={selectedLine}
              onChange={e => chooseLine(e.target.value)}
              title="Which of your phone lines to show"
              className="w-full mb-2 px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg text-np-dark focus:outline-none focus:ring-1 focus:ring-np-blue/30"
            >
              <option value={LINE_ALL}>All lines</option>
              {lines.map(l => (
                <option key={l.phone} value={l.phone} title={formatUsPhone(l.phone)}>
                  {l.nickname || formatUsPhone(l.phone)}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); loadThreads() }}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder:text-gray-300" />
          </div>

          {showFilters && (
            <div className="mt-2.5 space-y-2">
              {/* Channel */}
              {/* The channel filter chips were removed here. With one card per
                  contact they filtered on the card's FIRST-TOUCH channel, so
                  picking "SMS" would hide a thread full of texts merely because
                  it began with a call. The direction filter below still works —
                  it filters the timeline, not the card. */}
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
            <button key={thread.id} onClick={() => openThread(thread)}
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
                  <span className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <LineBadge label={labelFor(thread.line_e164 || defaultLine)} />
                    <span className="text-[8px] text-gray-400" title={fmtFull(thread.last_activity_at)}>
                      {fmtListStamp(thread.last_activity_at)}
                    </span>
                  </span>
                </div>
                <p className={`text-[10px] truncate ${thread.unread_count > 0 ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>
                  {thread.last_preview || thread.contact_phone || 'No phone'}
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
                  <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                    <span>{selectedThread.contact_phone || ''} · {selectedThread.channel}</span>
                    <LineBadge label={labelFor(selectedThread.line_e164 || defaultLine)} />
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Link href={`/crm/contacts?open=${selectedThread.contact_id}`}
                  className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-400" title="View contact"><User size={14} /></Link>
                <button onClick={archiveThread}
                  className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-400"
                  title="Remove from Conversations"><Archive size={14} /></button>
              </div>
            </div>

            {/* Messages — merged text + call + voicemail stream */}
            <div className="flex-1 overflow-auto p-4">
              {callBackError && (
                <p className="text-[10px] text-red-600 text-center mb-2">{callBackError}</p>
              )}
              {threadError && (
                <p role="alert" className="text-[10px] text-red-600 text-center mb-2">{threadError}</p>
              )}
              <TimelineStream
                entries={timeline}
                emptyLabel="No messages in this conversation yet"
                onCallBack={startCallBack}
                lineLabel={labelFor}
              />
              <div ref={bottomRef} />
            </div>

            {/* Compose. Gated on having a phone number, NOT on the card's
                channel: one card per contact now covers calls AND texts, so a
                thread that happened to start with a call would otherwise hide
                the composer forever. */}
            {!!selectedThread.contact_phone && (
              <div className="p-3 border-t border-gray-100">
                {sendError && (
                  <p role="alert" className="text-[10px] text-red-600 mb-1.5 px-1">{sendError}</p>
                )}
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
                <p className="text-[8px] text-gray-300 mt-1 px-1">
                  {newMessage.length > 0 ? `${newMessage.length} chars · ` : ''}Enter to send
                  {effectiveLineLabel ? ` · Sending as ${effectiveLineLabel}` : ''}
                </p>
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

      {/* Call back — the existing outbound VoipCall component. It auto-starts
          on mount and posts to /api/voice/token with contact_id (and the
          effective line as the caller ID when one applies). */}
      {callBackContact && (
        <VoipCall
          key={callBackContact.id}
          contact={callBackContact}
          lineE164={effectiveLine}
          onClose={() => setCallBackContact(null)}
          // Tear the panel down when the call ends so nothing can re-dial, then
          // refresh the thread so the new outbound call appears. VoipCall now
          // guards against redialing on its own; unmounting here is the second
          // layer — a dead panel can't start anything.
          onEnded={handleCallBackEnded}
        />
      )}
    </div>
  )
}
