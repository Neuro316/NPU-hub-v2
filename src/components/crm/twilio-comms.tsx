'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, MessageCircle, Send, X, Mic, MicOff, Volume2, Plus } from 'lucide-react'
import type { CrmContact } from '@/types/crm'
import { updateContact } from '@/lib/crm-client'
import {
  createRingback, ensureMicrophone, hangupOnServer, keepRemoteAudioPlaying, loadVoiceSdk,
  loadedVoiceSdk, primeCallTones, unlockCallAudio,
} from '@/lib/voice-audio'
import { createOutboundCall, type OutboundCall } from '@/lib/voice-call-state'

// ── SMS Compose Modal ──

export function SmsCompose({ contact, onClose, onSent }: {
  contact: CrmContact
  onClose: () => void
  onSent?: () => void
}) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSend = async () => {
    if (!body.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contact.id, body: body.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to send'); setSending(false); return }
      if (data.log_warning) console.warn('SMS log warning:', data.log_warning)
      onSent?.()
      onClose()
    } catch {
      setError('Network error')
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 p-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={14} className="text-blue-500" />
            <h3 className="text-sm font-bold text-np-dark">Text Message</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
        </div>

        <div className="text-xs text-gray-400 mb-2">
          To: <span className="font-medium text-np-dark">{contact.first_name} {contact.last_name}</span>
          <span className="ml-2 text-gray-400">{contact.phone}</span>
        </div>

        <textarea
          ref={inputRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={4}
          maxLength={1600}
          placeholder="Type your message..."
          className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleSend() }}
        />

        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] text-gray-400">{body.length}/1600 · ⌘+Enter to send</span>
          <div className="flex gap-2">
            {error && <span className="text-[10px] text-red-500 self-center">{error}</span>}
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
            <button
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-blue-600 transition-colors"
            >
              <Send size={11} /> {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── No Phone Prompt ──

function NoPhonePrompt({ contact, onClose, onSaved }: {
  contact: CrmContact
  onClose: () => void
  onSaved?: (phone: string) => void
}) {
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!phone.trim()) return
    setSaving(true)
    try {
      await updateContact(contact.id, { phone: phone.trim() })
      onSaved?.(phone.trim())
      onClose()
    } catch { alert('Failed to save phone number') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-xs bg-white rounded-xl shadow-2xl border border-gray-100 p-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Phone size={14} className="text-green-500" />
          <h3 className="text-sm font-bold text-np-dark">Add Phone Number</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">{contact.first_name} {contact.last_name} doesn't have a phone number yet.</p>
        <input
          value={phone} onChange={e => setPhone(e.target.value)}
          placeholder="+1 (828) 555-1234"
          className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-300"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
          <button onClick={handleSave} disabled={saving || !phone.trim()}
            className="px-3 py-1.5 bg-green-500 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-green-600 transition-colors">
            {saving ? 'Saving...' : 'Save & Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── VoIP Call Interface ──

type CallState = 'idle' | 'connecting' | 'ringing' | 'connected' | 'ending' | 'ended' | 'error'

export function VoipCall({ contact, onClose, onEnded, lineE164 }: {
  contact: CrmContact
  onClose: () => void
  onEnded?: () => void
  /** Org line to call FROM (Conversations line dropdown). Omit for the org default. */
  lineE164?: string | null
}) {
  const [callState, setCallState] = useState<CallState>('idle')
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  // The live call, through the shared controller (voice-call-state.ts), which
  // owns End at every stage: while connecting, ringing, and connected.
  const outboundRef = useRef<OutboundCall | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // ── REDIAL-LOOP GUARD ──────────────────────────────────────────────────────
  // onEnded is held in a ref, NOT in startCall's dependency array, and the start
  // effect fires at most once per mount.
  //
  // The bug this fixes: startCall used to depend on `onEnded`, and the mount
  // effect depended on `startCall`. A caller passing an INLINE onEnded (a new
  // function identity every render) made startCall a new identity every render
  // too, so the effect re-ran — tearing down the device and IMMEDIATELY PLACING
  // A NEW CALL. Since onEnded typically triggers a state update, each ended call
  // re-rendered the parent and redialed: an infinite outbound loop, billed per
  // call. It stayed hidden because ContactCommsButtons never passes onEnded
  // (undefined is a stable identity); the Conversations call-back was the first
  // caller to pass one.
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const startedRef = useRef(false)

  const startCall = useCallback(async () => {
    setError('')
    const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
    const ctl = createOutboundCall({
      // Asked before minting a token and a call row, so a blocked mic gets a
      // clear message instead of a silent failed call.
      ensureMicrophone,
      async prepare() {
        const res = await fetch('/api/voice/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contact.id, ...(lineE164 ? { line_e164: lineE164 } : {}) }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, message: data.error || 'Failed to connect' }
        // Log any warnings from the server (e.g. call log failed)
        if (data.log_warning) console.warn('Voice log warning:', data.log_warning)
        await loadVoiceSdk()
        return {
          ok: true,
          token: data.token,
          params: {
            To: data.contact_phone, CallerId: data.caller_id ?? '', OrgId: data.org_id ?? '',
            // Lets inbound-call stamp external_call_sid on THIS row from the
            // parent CallSid, which is what recording-ready matches on.
            CallLogId: data.call_log_id ?? '',
          },
          callLogId: data.call_log_id ?? null,
        }
      },
      // prepare() loaded the SDK, so this is synchronous.
      createDevice: (token) => new (loadedVoiceSdk().Device)(token, { logLevel: 1, codecPreferences: ['opus', 'pcmu'] as any }),
      onStage: (stage) => {
        if (stage === 'dialing') setCallState('connecting')
        else if (stage === 'ringing' || stage === 'ending') setCallState(stage)
        else if (stage === 'connected') {
          setCallState('connected')
          setDuration(0)
          stopTimer()
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
        }
      },
      onEnded: ({ error: err }) => {
        stopTimer()
        setMuted(false)
        if (err) { console.error('Call error:', err); setError(err); setCallState('error'); return }
        setCallState('ended')
        // Via the ref: calling onEnded directly would put it in this callback's
        // dependency chain and re-arm the redial loop.
        onEndedRef.current?.()
      },
      // Phones can leave the far side's audio element paused; see voice-audio.ts.
      onRemoteAudio: keepRemoteAudioPlaying,
      ringback: createRingback(),
      hangupOnServer,
      later: (fn, ms) => setTimeout(fn, ms),
    })
    outboundRef.current = ctl
    // The Call tap primed audio (ContactCommsButtons, and the app-wide tap
    // listener in voice-receiver-context); this covers a still-sticky gesture.
    unlockCallAudio()
    primeCallTones()
    await ctl.start()
    // lineE164 is read once at dial time; the mount effect below still runs
    // exactly once (startedRef), so a changing prop can never redial.
  }, [contact.id, lineE164])

  useEffect(() => {
    // Exactly one dial per mount. Even if this effect were somehow re-run, the
    // guard prevents a second call from being placed — a redial must require a
    // deliberate remount (closing the panel and clicking Call again).
    if (startedRef.current) return
    startedRef.current = true
    startCall()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      outboundRef.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // End at any stage. The controller hangs up and reports back through
  // onEnded once the call is actually gone; the panel follows that.
  const handleHangup = () => {
    const ctl = outboundRef.current
    if (ctl && ctl.stage !== 'idle') ctl.hangUp()
    else { setCallState('ended'); onEndedRef.current?.() }
  }

  const toggleMute = () => {
    if (outboundRef.current?.mute(!muted)) setMuted(!muted)
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const stateConfig: Record<CallState, { color: string; pulse: boolean; label: string }> = {
    idle: { color: '#6b7280', pulse: false, label: 'Initializing...' },
    connecting: { color: '#3b82f6', pulse: true, label: 'Connecting...' },
    ringing: { color: '#f59e0b', pulse: true, label: 'Ringing...' },
    ending: { color: '#6b7280', pulse: true, label: 'Hanging up...' },
    connected: { color: '#22c55e', pulse: false, label: formatDuration(duration) },
    ended: { color: '#6b7280', pulse: false, label: 'Call ended' },
    error: { color: '#ef4444', pulse: false, label: 'Failed' },
  }

  const cfg = stateConfig[callState]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 pt-6 pb-4 text-center" style={{ background: cfg.color + '08' }}>
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3 ${cfg.pulse ? 'animate-pulse' : ''}`}
            style={{ background: cfg.color + '20' }}>
            <Phone size={24} style={{ color: cfg.color }} />
          </div>
          <p className="text-sm font-bold text-np-dark">{contact.first_name} {contact.last_name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{contact.phone}</p>
          <p className="text-xs font-medium mt-2" style={{ color: cfg.color }}>{cfg.label}</p>
        </div>

        {error && <div className="px-4 py-2 bg-red-50 text-[10px] text-red-600 text-center">{error}</div>}

        <div className="flex items-center justify-center gap-4 p-5">
          {callState === 'connected' && (
            <button onClick={toggleMute}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-red-100' : 'bg-gray-100 hover:bg-gray-200'}`}>
              {muted ? <MicOff size={16} className="text-red-500" /> : <Mic size={16} className="text-gray-600" />}
            </button>
          )}

          {(callState === 'idle' || callState === 'connecting' || callState === 'ringing' || callState === 'connected' || callState === 'ending') && (
            <button onClick={handleHangup}
              className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg">
              <PhoneOff size={20} className="text-white" />
            </button>
          )}

          {(callState === 'ended' || callState === 'error') && (
            <button onClick={onClose}
              className="px-6 py-2.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full hover:bg-gray-200 transition-colors">
              Close
            </button>
          )}

          {callState === 'connected' && (
            <div className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center">
              <Volume2 size={16} className="text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Inline Action Buttons (always visible) ──

export function ContactCommsButtons({ contact, size = 'sm', onContactUpdated, onEmailClick }: {
  contact: CrmContact
  size?: 'sm' | 'md'
  onContactUpdated?: (updated: Partial<CrmContact>) => void
  onEmailClick?: () => void
}) {
  const [showSms, setShowSms] = useState(false)
  const [showCall, setShowCall] = useState(false)
  const [showAddPhone, setShowAddPhone] = useState(false)
  const [localPhone, setLocalPhone] = useState(contact.phone || '')

  const hasPhone = !!(localPhone || contact.phone)
  const px = size === 'sm' ? 'p-1' : 'px-2.5 py-1.5'
  const iconSize = size === 'sm' ? 10 : 13
  const labelClass = size === 'md' ? 'text-[10px] font-medium' : ''

  const handlePhoneSaved = (phone: string) => {
    setLocalPhone(phone)
    onContactUpdated?.({ phone })
  }

  return (
    <>
      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
        {/* Call */}
        <button
          onClick={() => {
            // Inside the tap: wake call audio before VoipCall mounts and dials.
            if (hasPhone) { unlockCallAudio(); primeCallTones(); setShowCall(true) } else setShowAddPhone(true)
          }}
          className={`${px} rounded flex items-center gap-1 transition-colors ${hasPhone ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'}`}
          title={hasPhone ? `Call ${localPhone || contact.phone}` : 'Add phone to call'}
        >
          <Phone size={iconSize} className={hasPhone ? 'text-green-600' : 'text-gray-400'} />
          {size === 'md' && <span className={`${labelClass} ${hasPhone ? 'text-green-700' : 'text-gray-400'}`}>Call</span>}
        </button>

        {/* Text */}
        <button
          onClick={() => hasPhone ? setShowSms(true) : setShowAddPhone(true)}
          className={`${px} rounded flex items-center gap-1 transition-colors ${hasPhone ? 'bg-blue-50 hover:bg-blue-100' : 'bg-gray-50 hover:bg-gray-100'}`}
          title={hasPhone ? `Text ${localPhone || contact.phone}` : 'Add phone to text'}
        >
          <MessageCircle size={iconSize} className={hasPhone ? 'text-blue-500' : 'text-gray-400'} />
          {size === 'md' && <span className={`${labelClass} ${hasPhone ? 'text-blue-700' : 'text-gray-400'}`}>Text</span>}
        </button>

        {/* Email */}
        {contact.email ? (
          <button
            onClick={() => onEmailClick ? onEmailClick() : window.open(`mailto:${contact.email}`)}
            className={`${px} rounded flex items-center gap-1 bg-amber-50 hover:bg-amber-100 transition-colors`}
            title={`Email ${contact.email}`}>
            <Send size={iconSize} className="text-amber-600" />
            {size === 'md' && <span className={`${labelClass} text-amber-700`}>Email</span>}
          </button>
        ) : (
          <span className={`${px} rounded flex items-center gap-1 bg-gray-50 cursor-default`} title="No email">
            <Send size={iconSize} className="text-gray-300" />
            {size === 'md' && <span className={`${labelClass} text-gray-400`}>Email</span>}
          </span>
        )}
      </div>

      {showAddPhone && (
        <NoPhonePrompt
          contact={{ ...contact, phone: localPhone || contact.phone }}
          onClose={() => setShowAddPhone(false)}
          onSaved={handlePhoneSaved}
        />
      )}
      {showSms && hasPhone && (
        <SmsCompose
          contact={{ ...contact, phone: localPhone || contact.phone }}
          onClose={() => setShowSms(false)}
        />
      )}
      {showCall && hasPhone && (
        <VoipCall
          contact={{ ...contact, phone: localPhone || contact.phone }}
          onClose={() => setShowCall(false)}
        />
      )}
    </>
  )
}
