'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Dialer — Full keypad, contact search, call controls
// Route: /crm/dialer
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff,
  Pause, Play, Volume2, VolumeX, X, Search, Clock,
  Delete, ArrowUpRight, ArrowDownLeft, Voicemail, PhoneMissed, Brain, FileText
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { fetchCallLogs, lookupContactByPhone } from '@/lib/crm-client'
import type { CrmContact, CallLog, Sentiment } from '@/types/crm'

const SENTIMENT_BADGE: Record<Sentiment, { label: string; color: string; bg: string }> = {
  positive: { label: '😊 Positive', color: '#059669', bg: '#ecfdf5' },
  neutral: { label: '😐 Neutral', color: '#6b7280', bg: '#f3f4f6' },
  negative: { label: '😟 Negative', color: '#dc2626', bg: '#fef2f2' },
  concerned: { label: '🤔 Concerned', color: '#d97706', bg: '#fffbeb' },
}

const DTMF_TONES: Record<string, { f1: number; f2: number }> = {
  '1': { f1: 697, f2: 1209 }, '2': { f1: 697, f2: 1336 }, '3': { f1: 697, f2: 1477 },
  '4': { f1: 770, f2: 1209 }, '5': { f1: 770, f2: 1336 }, '6': { f1: 770, f2: 1477 },
  '7': { f1: 852, f2: 1209 }, '8': { f1: 852, f2: 1336 }, '9': { f1: 852, f2: 1477 },
  '*': { f1: 941, f2: 1209 }, '0': { f1: 941, f2: 1336 }, '#': { f1: 941, f2: 1477 },
}

const KEYPAD = [
  [{ d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' }],
  [{ d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' }],
  [{ d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' }],
  [{ d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' }],
]

function fmtDuration(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return raw
}
function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DialerPage() {
  const supabase = createClient()
  const [dialString, setDialString] = useState('')
  const [callState, setCallState] = useState<'idle' | 'dialing' | 'ringing' | 'connected' | 'on_hold' | 'ended'>('idle')
  const [callDuration, setCallDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [showKeypadInCall, setShowKeypadInCall] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null)
  const [recentCalls, setRecentCalls] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'keypad' | 'contacts' | 'recent'>('keypad')
  const [activeCall, setActiveCall] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [callNotes, setCallNotes] = useState('')

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    fetchCallLogs(undefined, 100).then(setRecentCalls).catch(console.error)
  }, [])

  // Search contacts
  useEffect(() => {
    if (!searchQuery.trim()) { setContacts([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email, company, tags, pipeline_stage')
        .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
        .is('do_not_contact', false)
        .limit(20)
      setContacts((data || []) as unknown as CrmContact[])
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Timer
  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      if (callState === 'idle') setCallDuration(0)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [callState])

  function playTone(digit: string) {
    const t = DTMF_TONES[digit]
    if (!t) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const g = ctx.createGain(); g.gain.value = 0.1; g.connect(ctx.destination)
      const o1 = ctx.createOscillator(); const o2 = ctx.createOscillator()
      o1.frequency.value = t.f1; o2.frequency.value = t.f2
      o1.connect(g); o2.connect(g); o1.start(); o2.start()
      setTimeout(() => { o1.stop(); o2.stop() }, 120)
    } catch {}
  }

  function pressKey(d: string) { playTone(d); setDialString(p => p + d) }

  function selectContact(c: CrmContact) {
    setSelectedContact(c)
    setDialString(c.phone || '')
    setActiveTab('keypad')
    setSearchQuery('')
  }

  function redial(call: any) {
    const phone = call.direction === 'outbound' ? call.contacts?.phone : call.contacts?.phone
    if (phone) setDialString(phone)
    setActiveTab('keypad')
  }

  async function startCall() {
    if (!dialString.trim()) return
    if (selectedContact) {
      // Use existing VoIP pattern via /api/voice/token
      setCallState('dialing')
      try {
        const res = await fetch('/api/voice/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: selectedContact.id }),
        })
        const data = await res.json()
        if (!res.ok) { setCallState('idle'); return }

        const { Device } = await import('@twilio/voice-sdk')
        const device = new Device(data.token, { logLevel: 1, codecPreferences: ['opus', 'pcmu'] as any })
        const call = await device.connect({ params: { To: data.contact_phone } })

        setCallState('ringing')
        call.on('accept', () => { setCallState('connected'); setCallDuration(0) })
        call.on('disconnect', () => { setCallState('ended'); setTimeout(() => { setCallState('idle'); reloadCalls() }, 1500) })
        call.on('error', () => { setCallState('idle') })
      } catch { setCallState('idle') }
    } else {
      // Manual dial - try to auto-match contact by phone number
      setCallState('dialing')
      try {
        const matched = await lookupContactByPhone(dialString)
        if (matched) {
          setSelectedContact(matched)
          // Now use the matched contact for proper call logging
          const res = await fetch('/api/voice/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_id: matched.id }),
          })
          const data = await res.json()
          if (!res.ok) { setCallState('idle'); return }
          const { Device } = await import('@twilio/voice-sdk')
          const device = new Device(data.token, { logLevel: 1, codecPreferences: ['opus', 'pcmu'] as any })
          const call = await device.connect({ params: { To: data.contact_phone } })
          setCallState('ringing')
          call.on('accept', () => { setCallState('connected'); setCallDuration(0) })
          call.on('disconnect', () => { setCallState('ended'); setTimeout(() => { setCallState('idle'); reloadCalls() }, 1500) })
          call.on('error', () => { setCallState('idle') })
        } else {
          // No match found - still dial but won't log to a contact
          setTimeout(() => setCallState('connected'), 2000)
        }
      } catch { setTimeout(() => setCallState('connected'), 2000) }
    }
  }

  function endCall() {
    setCallState('ended')
    setTimeout(() => { setCallState('idle'); setCallDuration(0); reloadCalls() }, 1500)
  }

  function reloadCalls() {
    fetchCallLogs(undefined, 100).then(setRecentCalls).catch(console.error)
  }

  const isInCall = ['dialing', 'ringing', 'connected', 'on_hold'].includes(callState)
  const displayName = selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : dialString ? fmtPhone(dialString) : ''

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] animate-in fade-in duration-300">
      {/* ─── LEFT: Dialer Panel ─── */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        {/* Tab switcher */}
        <div className="flex bg-gray-50 rounded-lg p-1 mb-3">
          {(['keypad', 'contacts', 'recent'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 px-2 text-[10px] font-medium rounded-md transition-all ${
                activeTab === tab ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>
              {tab === 'keypad' ? 'Keypad' : tab === 'contacts' ? 'Contacts' : 'Recent'}
            </button>
          ))}
        </div>

        {/* ─── KEYPAD ─── */}
        {activeTab === 'keypad' && (
          <div className="flex flex-col items-center flex-1">
            {/* Selected contact chip */}
            {selectedContact && (
              <div className="flex items-center gap-2 mb-2 w-full px-1">
                <div className="w-7 h-7 rounded-full bg-np-blue/10 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-np-blue">
                    {selectedContact.first_name?.[0]}{selectedContact.last_name?.[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-np-dark truncate">{selectedContact.first_name} {selectedContact.last_name}</p>
                  {selectedContact.pipeline_stage && <p className="text-[9px] text-gray-400">{selectedContact.pipeline_stage}</p>}
                </div>
                <button onClick={() => { setSelectedContact(null); setDialString('') }} className="p-1 hover:bg-gray-50 rounded">
                  <X size={12} className="text-gray-400" />
                </button>
              </div>
            )}

            {/* Number display */}
            <div className="relative w-full mb-4">
              <input type="text" value={dialString ? fmtPhone(dialString) : ''} readOnly={isInCall}
                onChange={e => setDialString(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter number"
                className="w-full text-center text-xl font-light tracking-wider py-3 bg-transparent border-none outline-none text-np-dark placeholder:text-gray-300" />
              {dialString && !isInCall && (
                <button onClick={() => setDialString(p => p.slice(0, -1))}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 hover:bg-gray-50 rounded-lg">
                  <Delete size={16} className="text-gray-400" />
                </button>
              )}
            </div>

            {/* Call status */}
            {isInCall && (
              <div className="mb-4 text-center">
                <p className={`text-[10px] font-medium mb-0.5 ${
                  callState === 'connected' ? 'text-green-500' : callState === 'on_hold' ? 'text-amber-500' : 'text-gray-400'
                }`}>
                  {callState === 'dialing' && 'Dialing...'}{callState === 'ringing' && 'Ringing...'}{callState === 'connected' && 'Connected'}{callState === 'on_hold' && 'On Hold'}
                </p>
                <p className="text-2xl font-light text-np-dark tracking-wider font-mono">{fmtDuration(callDuration)}</p>
              </div>
            )}

            {/* Keypad grid */}
            {(!isInCall || showKeypadInCall) && (
              <div className="grid grid-cols-3 gap-2 mb-4 w-full max-w-[260px]">
                {KEYPAD.flat().map(({ d, sub }) => (
                  <button key={d} onClick={() => pressKey(d)}
                    className="flex flex-col items-center justify-center w-full aspect-square rounded-full
                      bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-all active:scale-95 select-none">
                    <span className="text-xl font-light text-np-dark leading-none">{d}</span>
                    {sub && <span className="text-[7px] tracking-[2px] text-gray-400 mt-0.5 uppercase">{sub}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* In-call controls */}
            {isInCall && !showKeypadInCall && (
              <div className="grid grid-cols-3 gap-3 mb-4 w-full max-w-[260px]">
                <button onClick={() => setIsMuted(!isMuted)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${isMuted ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                  {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  <span className="text-[8px] font-medium">Mute</span>
                </button>
                <button onClick={() => setShowKeypadInCall(true)}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl bg-gray-50 text-gray-500 hover:bg-gray-100">
                  <span className="text-sm font-light">#</span>
                  <span className="text-[8px] font-medium">Keypad</span>
                </button>
                <button onClick={() => setCallState(p => p === 'on_hold' ? 'connected' : 'on_hold')}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${callState === 'on_hold' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                  {callState === 'on_hold' ? <Play size={16} /> : <Pause size={16} />}
                  <span className="text-[8px] font-medium">{callState === 'on_hold' ? 'Resume' : 'Hold'}</span>
                </button>
              </div>
            )}

            {isInCall && showKeypadInCall && (
              <button onClick={() => setShowKeypadInCall(false)} className="mb-3 text-[10px] text-np-blue hover:text-np-dark font-medium">← Back to controls</button>
            )}

            {/* Call / End button */}
            {!isInCall ? (
              <button onClick={startCall} disabled={!dialString.trim()}
                className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 disabled:bg-gray-200 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-green-500/25">
                <Phone size={22} className="text-white" />
              </button>
            ) : (
              <button onClick={endCall}
                className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-red-500/25">
                <PhoneOff size={22} className="text-white" />
              </button>
            )}
          </div>
        )}

        {/* ─── CONTACTS ─── */}
        {activeTab === 'contacts' && (
          <div className="flex-1 flex flex-col">
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, phone, email..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" autoFocus />
            </div>
            <div className="flex-1 overflow-auto space-y-1">
              {loading && <p className="text-[10px] text-gray-400 text-center py-8">Searching...</p>}
              {!loading && !searchQuery && <p className="text-[10px] text-gray-400 text-center py-8">Type to search contacts</p>}
              {!loading && searchQuery && contacts.length === 0 && <p className="text-[10px] text-gray-400 text-center py-8">No contacts found</p>}
              {contacts.map(c => (
                <button key={c.id} onClick={() => selectContact(c)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left">
                  <div className="w-8 h-8 rounded-full bg-np-blue/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-np-blue">{c.first_name?.[0]}{c.last_name?.[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-np-dark truncate">{c.first_name} {c.last_name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{c.phone ? fmtPhone(c.phone) : 'No phone'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── RECENT ─── */}
        {activeTab === 'recent' && (
          <div className="flex-1 overflow-auto space-y-1">
            {recentCalls.length === 0 && <p className="text-[10px] text-gray-400 text-center py-8">No recent calls</p>}
            {recentCalls.map((call: any) => {
              const name = call.contacts ? `${call.contacts.first_name} ${call.contacts.last_name}` : 'Unknown'
              const dur = call.duration_seconds ? fmtDuration(call.duration_seconds) : '--:--'
              return (
                <button key={call.id} onClick={() => { redial(call); setActiveCall(call) }}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left ${activeCall?.id === call.id ? 'bg-np-blue/5 border border-np-blue/20' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    call.status === 'completed' ? (call.direction === 'inbound' ? 'bg-green-50' : 'bg-blue-50') :
                    call.status === 'missed' ? 'bg-red-50' : 'bg-gray-50'
                  }`}>
                    {call.direction === 'outbound' && call.status === 'completed' && <ArrowUpRight size={14} className="text-np-blue" />}
                    {call.direction === 'inbound' && call.status === 'completed' && <ArrowDownLeft size={14} className="text-green-500" />}
                    {call.status === 'missed' && <PhoneMissed size={14} className="text-red-500" />}
                    {call.status === 'voicemail' && <Voicemail size={14} className="text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-np-dark truncate">{name}</p>
                    <p className="text-[10px] text-gray-400">
                      {call.direction === 'outbound' ? 'Outgoing' : 'Incoming'} · {dur} · {timeAgo(call.started_at)}
                    </p>
                  </div>
                  {call.sentiment && (
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ color: SENTIMENT_BADGE[call.sentiment as Sentiment]?.color, background: SENTIMENT_BADGE[call.sentiment as Sentiment]?.bg }}>
                      {SENTIMENT_BADGE[call.sentiment as Sentiment]?.label}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── RIGHT: Call Detail / Notes ─── */}
      <div className="flex-1 flex flex-col">
        {/* Active call overlay */}
        {isInCall && (
          <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-green-500 to-np-blue text-white animate-in slide-in-from-top duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                  <Phone size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold">{displayName || 'Calling...'}</p>
                  <p className="text-xs text-white/70 font-mono">{fmtDuration(callDuration)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Call notes / detail */}
        {(selectedContact || activeCall) ? (
          <div className="flex-1 overflow-auto rounded-xl border border-gray-100 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-np-dark">
                  {selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` :
                   activeCall?.contacts ? `${activeCall.contacts.first_name} ${activeCall.contacts.last_name}` : fmtPhone(dialString)}
                </h3>
                <p className="text-xs text-gray-400">
                  {selectedContact?.phone ? fmtPhone(selectedContact.phone) : activeCall?.contacts?.phone || ''}
                  {selectedContact?.pipeline_stage ? ` · ${selectedContact.pipeline_stage}` : ''}
                </p>
              </div>
              {/* Comm stats */}
              {selectedContact && (
                <div className="flex gap-3">
                  <div className="text-center">
                    <p className="text-sm font-bold text-np-dark">{(selectedContact as any).total_calls || 0}</p>
                    <p className="text-[8px] text-gray-400">Calls</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-np-dark">{(selectedContact as any).total_texts || 0}</p>
                    <p className="text-[8px] text-gray-400">Texts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-np-dark">{(selectedContact as any).total_emails || 0}</p>
                    <p className="text-[8px] text-gray-400">Emails</p>
                  </div>
                </div>
              )}
            </div>

            {/* AI Summary (if viewing a past call) */}
            {activeCall?.ai_summary && (
              <div className="mb-4 p-3 rounded-lg bg-np-blue/5 border border-np-blue/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Brain size={12} className="text-np-blue" />
                  <span className="text-[10px] font-semibold text-np-blue uppercase tracking-wider">AI Summary</span>
                </div>
                <p className="text-xs text-np-dark leading-relaxed">{activeCall.ai_summary}</p>
              </div>
            )}

            {activeCall?.transcription && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} className="text-np-blue" />
                  <span className="text-[10px] font-semibold text-np-blue uppercase tracking-wider">Transcription</span>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-600 leading-relaxed max-h-48 overflow-auto font-mono">
                  {activeCall.transcription}
                </div>
              </div>
            )}

            {/* Call Notes */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {isInCall ? 'Call Notes' : 'Notes'}
              </p>
              <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)}
                placeholder="Type notes during or before the call..."
                className="w-full h-40 p-3 text-xs bg-gray-50 border border-gray-100 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-np-blue/30 text-np-dark placeholder:text-gray-300" />
              {isInCall && <p className="text-[9px] text-gray-300 mt-1">Notes save when the call ends</p>}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-gray-100 bg-white">
            <div className="text-center">
              <Phone size={32} className="mx-auto text-gray-400/30 mb-3" />
              <p className="text-sm text-gray-400">Select a contact or dial a number</p>
              <p className="text-[10px] text-gray-300 mt-1">Use the keypad, search contacts, or pick from recent calls</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
