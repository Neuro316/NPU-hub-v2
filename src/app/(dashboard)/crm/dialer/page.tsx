'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Dialer — Call log, browser calling, AI transcription
// Route: /crm/dialer
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff,
  Pause, Play, Clock, FileText, Brain, Search, Filter
} from 'lucide-react'
import { fetchCallLogs } from '@/lib/crm-client'
import type { CallLog, Sentiment } from '@/types/crm'

const SENTIMENT_BADGE: Record<Sentiment, { label: string; color: string; bg: string }> = {
  positive: { label: '😊 Positive', color: '#059669', bg: '#ecfdf5' },
  neutral: { label: '😐 Neutral', color: '#6b7280', bg: '#f3f4f6' },
  negative: { label: '😟 Negative', color: '#dc2626', bg: '#fef2f2' },
  concerned: { label: '🤔 Concerned', color: '#d97706', bg: '#fffbeb' },
}

function CallCard({ call, onSelect, isActive }: { call: any; onSelect: () => void; isActive: boolean }) {
  const name = call.contacts ? `${call.contacts.first_name} ${call.contacts.last_name}` : call.contact_id?.slice(0, 8) || 'Unknown'
  const dur = call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}` : '--:--'
  const isInbound = call.direction === 'inbound'
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing
  const statusColors: Record<string, string> = {
    completed: '#059669', missed: '#dc2626', 'in-progress': '#2A9D8F', ringing: '#d97706', voicemail: '#6b7280'
  }

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isActive ? 'border-np-blue bg-np-blue/5 shadow-sm' : 'border-gray-100/50 hover:border-gray-100 hover:bg-gray-50/30'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <DirIcon size={14} className={isInbound ? 'text-blue-500' : 'text-np-blue'} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-np-dark truncate">{name}</p>
          <p className="text-[10px] text-gray-400">{call.contacts?.phone || '--'}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono text-gray-600">{dur}</p>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColors[call.status] || '#94a3b8' }} />
            <span className="text-[9px] text-gray-400 capitalize">{call.status}</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">
        {new Date(call.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>
      {call.sentiment && (
        <span
          className="inline-block mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ color: SENTIMENT_BADGE[call.sentiment as Sentiment]?.color, background: SENTIMENT_BADGE[call.sentiment as Sentiment]?.bg }}
        >
          {SENTIMENT_BADGE[call.sentiment as Sentiment]?.label}
        </span>
      )}
    </button>
  )
}

export default function DialerPage() {
  const [calls, setCalls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCall, setActiveCall] = useState<any>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [isOnCall, setIsOnCall] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [callTimer, setCallTimer] = useState(0)

  useEffect(() => {
    fetchCallLogs(undefined, 100).then(setCalls).catch(console.error).finally(() => setLoading(false))
  }, [])

  // Call timer
  useEffect(() => {
    if (!isOnCall) return
    const interval = setInterval(() => setCallTimer(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isOnCall])

  const filteredCalls = calls.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false
    if (search) {
      const name = `${c.contacts?.first_name || ''} ${c.contacts?.last_name || ''} ${c.contacts?.phone || ''}`.toLowerCase()
      if (!name.includes(search.toLowerCase())) return false
    }
    return true
  })

  const startCall = () => {
    setIsOnCall(true)
    setCallTimer(0)
    // In production: fetch voice token from /api/voice/token and init Twilio Client SDK
  }

  const endCall = () => {
    setIsOnCall(false)
    setCallTimer(0)
  }

  const formatTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] animate-in fade-in duration-300">
      {/* Call List */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        {/* Search */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search calls..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
          />
        </div>

        {/* Filter */}
        <div className="flex gap-1 mb-3">
          {['', 'completed', 'missed', 'voicemail'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                filterStatus === s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {/* Call List */}
        <div className="flex-1 overflow-auto space-y-1.5">
          {loading && <p className="text-xs text-gray-400 text-center py-8">Loading calls...</p>}
          {filteredCalls.map(c => (
            <CallCard key={c.id} call={c} isActive={activeCall?.id === c.id} onSelect={() => setActiveCall(c)} />
          ))}
          {!loading && filteredCalls.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No calls found</p>
          )}
        </div>
      </div>

      {/* Detail / Active Call Panel */}
      <div className="flex-1 flex flex-col">
        {/* Active Call Overlay */}
        {isOnCall && (
          <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-teal to-np-dark text-white animate-in slide-in-from-top duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                  <Phone size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {activeCall ? `${activeCall.contacts?.first_name} ${activeCall.contacts?.last_name}` : 'Calling...'}
                  </p>
                  <p className="text-xs text-white/70 font-mono">{formatTimer(callTimer)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red-500' : 'bg-white/20 hover:bg-white/30'}`}
                >
                  {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button onClick={endCall} className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all">
                  <PhoneOff size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeCall ? (
          <div className="flex-1 overflow-auto rounded-xl border border-gray-100 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-np-dark">
                  {activeCall.contacts?.first_name} {activeCall.contacts?.last_name}
                </h3>
                <p className="text-xs text-gray-400">{activeCall.contacts?.phone} · {activeCall.direction} · {new Date(activeCall.started_at).toLocaleString()}</p>
              </div>
              {!isOnCall && activeCall.contacts?.phone && (
                <button onClick={startCall} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
                  <Phone size={13} /> Call Back
                </button>
              )}
            </div>

            {/* AI Summary */}
            {activeCall.ai_summary && (
              <div className="mb-4 p-3 rounded-lg bg-np-blue/5 border border-np-blue/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Brain size={12} className="text-np-blue" />
                  <span className="text-[10px] font-semibold text-np-blue uppercase tracking-wider">AI Summary</span>
                </div>
                <p className="text-xs text-np-dark leading-relaxed">{activeCall.ai_summary}</p>
              </div>
            )}

            {/* Transcription */}
            {activeCall.transcription && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} className="text-np-blue" />
                  <span className="text-[10px] font-semibold text-np-blue uppercase tracking-wider">Transcription</span>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-600 leading-relaxed max-h-64 overflow-auto font-mono">
                  {activeCall.transcription}
                </div>
              </div>
            )}

            {/* Call Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-gray-50">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Duration</p>
                <p className="text-sm font-bold text-np-dark">
                  {activeCall.duration_seconds ? `${Math.floor(activeCall.duration_seconds / 60)}m ${activeCall.duration_seconds % 60}s` : 'N/A'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Status</p>
                <p className="text-sm font-bold text-np-dark capitalize">{activeCall.status}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Direction</p>
                <p className="text-sm font-bold text-np-dark capitalize">{activeCall.direction}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Sentiment</p>
                {activeCall.sentiment ? (
                  <span className="text-sm font-bold" style={{ color: SENTIMENT_BADGE[activeCall.sentiment as Sentiment]?.color }}>
                    {SENTIMENT_BADGE[activeCall.sentiment as Sentiment]?.label}
                  </span>
                ) : <p className="text-sm text-gray-400">N/A</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-gray-100 bg-white">
            <div className="text-center">
              <Phone size={32} className="mx-auto text-gray-400/30 mb-3" />
              <p className="text-sm text-gray-400">Select a call to view details</p>
              <p className="text-[10px] text-gray-400 mt-1">Or start a new call from a contact record</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
