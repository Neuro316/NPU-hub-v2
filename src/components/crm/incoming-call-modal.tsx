'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff } from 'lucide-react'
import { useVoiceReceiver } from '@/lib/voice-receiver-context'
import { useWorkspace } from '@/lib/workspace-context'
import { formatUsPhone } from '@/lib/phone'

// Ringing / in-call UI for inbound browser calls. Mounted once in the dashboard
// layout so a call can arrive on any page.
//
// Declining (or ignoring) does NOT hang up on the caller: rejecting this leg
// ends only the browser leg, Twilio's <Dial> completes, and the caller falls
// through to the voicemail greeting + <Record> in the same TwiML document.

type Phase = 'ringing' | 'connected' | 'ended'

export default function IncomingCallModal() {
  const { incoming, clearIncoming } = useVoiceReceiver()
  const { currentOrg } = useWorkspace()

  const [phase, setPhase] = useState<Phase>('ringing')
  const [callerName, setCallerName] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const call = incoming?.call
  const from = incoming?.from || ''

  // Reset per call.
  useEffect(() => {
    if (!incoming) return
    setPhase('ringing'); setDuration(0); setMuted(false); setCallerName(null)
  }, [incoming])

  // Who's calling — same normalized match the webhook threads the call with.
  useEffect(() => {
    if (!incoming || !currentOrg || !from) return
    let cancelled = false
    fetch(`/api/comms/caller-lookup?org_id=${encodeURIComponent(currentOrg.id)}&phone=${encodeURIComponent(from)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.contact?.name && !d.contact.is_placeholder) setCallerName(d.contact.name)
      })
      .catch(() => { /* the number alone is enough to answer */ })
    return () => { cancelled = true }
  }, [incoming, currentOrg, from])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const accept = useCallback(async () => {
    if (!call) return
    try {
      call.accept()
      setPhase('connected')
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)

      call.on('disconnect', () => {
        if (timerRef.current) clearInterval(timerRef.current)
        setPhase('ended')
        setTimeout(clearIncoming, 1200)
      })

      // Report who picked up. The org-shared identity can't tell the server this,
      // so the answering browser does. Fire-and-forget: bookkeeping must never
      // interfere with a live call.
      if (incoming?.callSid) {
        fetch('/api/voice/answered', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_sid: incoming.callSid }),
        }).catch(() => { /* non-fatal */ })
      }
    } catch (e) {
      console.error('[incoming-call] accept failed:', e)
      clearIncoming()
    }
  }, [call, incoming?.callSid, clearIncoming])

  const decline = useCallback(() => {
    try { call?.reject() } catch { /* already gone */ }
    clearIncoming()
  }, [call, clearIncoming])

  const hangUp = useCallback(() => {
    try { call?.disconnect() } catch { /* already gone */ }
    if (timerRef.current) clearInterval(timerRef.current)
    clearIncoming()
  }, [call, clearIncoming])

  const toggleMute = useCallback(() => {
    if (!call) return
    const next = !muted
    try { call.mute(next); setMuted(next) } catch { /* sdk tolerance */ }
  }, [call, muted])

  if (!incoming) return null

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const display = callerName || formatUsPhone(from) || 'Unknown caller'

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/30 backdrop-blur-[2px]">
      <div className="w-[320px] rounded-2xl bg-white shadow-2xl border border-gray-100 p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${
            phase === 'ringing' ? 'bg-np-blue/10 animate-pulse' : 'bg-green-50'
          }`}>
            <PhoneIncoming size={22} className={phase === 'ringing' ? 'text-np-blue' : 'text-green-600'} />
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {phase === 'ringing' ? 'Incoming call' : phase === 'connected' ? 'On call' : 'Call ended'}
          </p>
          <p className="text-base font-bold text-np-dark mt-1 truncate max-w-full">{display}</p>
          {callerName && (
            <p className="text-[11px] text-gray-400 font-mono">{formatUsPhone(from)}</p>
          )}
          {phase === 'connected' && (
            <p className="text-xs text-green-600 font-medium mt-1">{mmss(duration)}</p>
          )}

          {phase === 'ringing' && (
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={decline}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200"
              >
                <PhoneOff size={14} /> Decline
              </button>
              <button
                onClick={accept}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700"
              >
                <Phone size={14} /> Accept
              </button>
            </div>
          )}

          {phase === 'connected' && (
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={toggleMute}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold ${
                  muted ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />} {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={hangUp}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
              >
                <PhoneOff size={14} /> Hang up
              </button>
            </div>
          )}

          {phase === 'ringing' && (
            <p className="text-[9px] text-gray-400 mt-4">
              Decline or ignore and the caller hears your voicemail greeting.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
