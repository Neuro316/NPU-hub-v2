'use client'

// ═══════════════════════════════════════════════════════════════
// Shared merged communications timeline.
// One timestamp-sorted stream per contact, UNIONing:
//   - crm_messages  (texts / MMS)
//   - call_logs     (calls / voicemails / missed)
// Used by BOTH the /crm/conversations comms tab and the contact-card panel so
// they render identically. Voicemails get an in-browser player pointed at the
// authenticated proxy (/api/comms/recording/[id]) + inline transcript.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Voicemail, Loader2, PhoneMissed, ArrowUpRight, ArrowDownLeft,
  Check, CheckCheck, Clock, Paperclip, PhoneCall,
} from 'lucide-react'

export type TimelineKind = 'text' | 'call' | 'voicemail' | 'missed'

export interface TimelineEntry {
  id: string                       // crm_messages.id or call_logs.id (proxy key for voicemail)
  kind: TimelineKind
  direction: 'inbound' | 'outbound'
  body: string | null
  status: string | null
  created_at: string
  duration_seconds?: number | null
  transcript?: string | null
  transcription_status?: string | null
  recording_available?: boolean
  media_urls?: string[]
  ai_summary?: string | null
}

// ── Data: load + merge both tables for a contact ──
// Pass conversationId to scope texts to a single thread (comms tab), or omit to
// load all of a contact's texts (contact card). Calls are always by contact_id
// (call_logs has no conversation_id).
export async function buildTimeline(
  supabase: SupabaseClient,
  opts: { contactId: string; conversationId?: string; directionFilter?: 'both' | 'inbound' | 'outbound' }
): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = []

  // Texts — crm_messages has no contact_id, so join via conversations.
  let msgQ = supabase.from('crm_messages').select('*, conversations!inner(contact_id)')
  if (opts.conversationId) msgQ = msgQ.eq('conversation_id', opts.conversationId)
  else msgQ = msgQ.eq('conversations.contact_id', opts.contactId)
  const { data: msgs } = await msgQ
  ;(msgs || []).forEach((m: any) => entries.push({
    id: m.id,
    kind: 'text',
    direction: m.direction,
    body: m.body,
    status: m.status,
    created_at: m.sent_at || m.created_at,
    media_urls: Array.isArray(m.media_urls) ? m.media_urls : [],
  }))

  // Calls / voicemails / missed — by contact.
  const { data: calls } = await supabase
    .from('call_logs')
    .select('*')
    .eq('contact_id', opts.contactId)
    .order('started_at', { ascending: true })
  ;(calls || []).forEach((c: any) => {
    const kind: TimelineKind =
      c.status === 'voicemail' ? 'voicemail' : c.status === 'missed' ? 'missed' : 'call'
    entries.push({
      id: c.id,
      kind,
      direction: c.direction,
      body: null,
      status: c.status,
      created_at: c.started_at,
      duration_seconds: c.duration_seconds,
      transcript: c.transcript,
      transcription_status: c.transcription_status,
      recording_available: !!c.recording_url,
      ai_summary: c.ai_summary,
    })
  })

  const filtered = opts.directionFilter && opts.directionFilter !== 'both'
    ? entries.filter(e => e.direction === opts.directionFilter)
    : entries
  filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  return filtered
}

// ── Formatting helpers ──
function fmtDuration(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function fmtClock(d: string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// Call-back affordance shared by the voicemail + missed/incoming call cards.
// Presentational only: the page that owns the call UI passes onCallBack.
function CallBackButton({ onCallBack, label = 'Call back' }: {
  onCallBack: () => void
  label?: string
}) {
  return (
    <button
      onClick={onCallBack}
      className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 hover:bg-green-100 text-green-700 text-[9px] font-semibold transition-colors"
      title={label}
    >
      <PhoneCall size={9} /> {label}
    </button>
  )
}

// ── Voicemail: player (authenticated proxy) + inline transcript ──
export function VoicemailPlayer({ entry, onCallBack }: {
  entry: TimelineEntry
  onCallBack?: () => void
}) {
  return (
    <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-2.5 max-w-[85%]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Voicemail size={12} className="text-purple-500" />
        <span className="text-[10px] font-semibold text-np-dark">Voicemail</span>
        {(entry.duration_seconds ?? 0) > 0 && (
          <span className="text-[8px] text-gray-400">· {fmtDuration(entry.duration_seconds!)}</span>
        )}
        {onCallBack && <span className="ml-auto"><CallBackButton onCallBack={onCallBack} /></span>}
      </div>
      {entry.recording_available ? (
        <audio controls preload="none" className="w-full h-8" src={`/api/comms/recording/${entry.id}`}>
          Your browser does not support audio playback.
        </audio>
      ) : (
        <p className="text-[9px] text-gray-400 italic">Recording not available yet</p>
      )}
      {entry.transcript ? (
        <p className="text-[10px] text-gray-600 mt-1.5 whitespace-pre-wrap leading-snug">{entry.transcript}</p>
      ) : entry.transcription_status === 'pending' ? (
        <p className="text-[9px] text-gray-400 mt-1.5 flex items-center gap-1">
          <Loader2 size={9} className="animate-spin" /> Transcribing…
        </p>
      ) : entry.transcription_status === 'failed' ? (
        <p className="text-[9px] text-gray-300 mt-1.5 italic">Transcript unavailable</p>
      ) : null}
    </div>
  )
}

// ── Text bubble (inbound left / outbound right), with MMS media ──
function TextBubble({ entry }: { entry: TimelineEntry }) {
  const isOut = entry.direction === 'outbound'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 ${
        isOut ? 'bg-np-blue text-white rounded-br-md' : 'bg-gray-100 text-np-dark rounded-bl-md'
      }`}>
        {(entry.media_urls?.length ?? 0) > 0 && (
          <div className="space-y-1 mb-1">
            {entry.media_urls!.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer"
                className={`flex items-center gap-1 text-[10px] underline ${isOut ? 'text-white/90' : 'text-np-blue'}`}>
                <Paperclip size={9} /> Attachment {entry.media_urls!.length > 1 ? i + 1 : ''}
              </a>
            ))}
          </div>
        )}
        {entry.body && <p className="text-xs whitespace-pre-wrap break-words">{entry.body}</p>}
        <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className={`text-[7px] ${isOut ? 'text-white/50' : 'text-gray-400'}`}>{fmtClock(entry.created_at)}</span>
          {isOut && entry.status === 'delivered' && <CheckCheck size={10} className="text-white/50" />}
          {isOut && entry.status === 'sent' && <Check size={10} className="text-white/50" />}
          {isOut && entry.status === 'queued' && <Clock size={10} className="text-white/50" />}
        </div>
      </div>
    </div>
  )
}

// ── Call / missed centered rows ──
function CallRow({ entry, onCallBack }: { entry: TimelineEntry; onCallBack?: () => void }) {
  const isMissed = entry.kind === 'missed'
  // Offer call-back on anything the caller initiated that we may not have taken:
  // missed calls, and inbound calls generally.
  const showCallBack = !!onCallBack && (isMissed || entry.direction === 'inbound')
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-full">
        {isMissed ? <PhoneMissed size={10} className="text-red-500" />
          : entry.direction === 'outbound' ? <ArrowUpRight size={10} className="text-np-blue" />
          : <ArrowDownLeft size={10} className="text-green-500" />}
        <span className="text-[9px] text-gray-500">
          {entry.direction === 'outbound' ? 'Outgoing' : 'Incoming'} {isMissed ? 'call · Missed' : 'call'}
          {(entry.duration_seconds ?? 0) > 0 ? ` · ${fmtDuration(entry.duration_seconds!)}` : ''}
        </span>
        <span className="text-[8px] text-gray-300 ml-1">{fmtClock(entry.created_at)}</span>
        {showCallBack && (
          <span className="ml-1.5"><CallBackButton onCallBack={onCallBack!} /></span>
        )}
      </div>
    </div>
  )
}

// ── The stream ──
export function TimelineStream({ entries, emptyLabel = 'No messages yet', onCallBack }: {
  entries: TimelineEntry[]
  emptyLabel?: string
  /** Omit to render the timeline read-only (e.g. the contact card panel). */
  onCallBack?: () => void
}) {
  if (!entries.length) {
    return <p className="text-[10px] text-gray-300 text-center py-8">{emptyLabel}</p>
  }
  return (
    <div className="space-y-2">
      {entries.map(entry => {
        if (entry.kind === 'text') return <TextBubble key={entry.id} entry={entry} />
        if (entry.kind === 'voicemail') {
          return (
            <div key={entry.id} className="flex justify-start">
              <VoicemailPlayer entry={entry} onCallBack={onCallBack} />
            </div>
          )
        }
        return <CallRow key={entry.id} entry={entry} onCallBack={onCallBack} />
      })}
    </div>
  )
}
