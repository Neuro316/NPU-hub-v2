'use client'

import { useEffect, useState } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Loader2, AlertTriangle, PhoneCall,
} from 'lucide-react'
import { useVoiceReceiver, type IncomingCall } from '@/lib/voice-receiver-context'
import { useWorkspace } from '@/lib/workspace-context'
import { useOrgLines } from '@/lib/hooks/use-org-lines'
import { formatUsPhone } from '@/lib/phone'

// Inbound-call UI for the browser softphone: a banner PINNED to the top of the
// viewport, above everything else, on every Hub page.
//
// It replaces the centered modal. That modal was not being dismissed by its
// own UI — it had no backdrop click, no Escape, no auto-dismiss — it vanished
// because the receiver provider tore the Twilio Device down on every auth event
// (see the header note in voice-receiver-context.tsx). The banner keeps the same
// contract on purpose and states it plainly here:
//
//   * NO backdrop, NO click-outside close, NO Escape close, NO auto-dismiss.
//   * A call leaves the banner ONLY by Answer, Decline, the caller hanging up,
//     Twilio's <Dial> timing out into voicemail, or the call ending after it
//     was answered. Those are the provider's cancel / disconnect / reject events.
//   * It is rendered ONCE, in the dashboard layout, outside the page tree, so
//     route changes and page re-renders below it cannot unmount it.
//
// The newest ringing call is shown with Answer / Decline. A connected call is
// shown with duration, Mute and Hang up. Anything beyond those two is queued and
// counted ("+N waiting") — never dropped.

// Height the layout reserves so page content is not hidden under the banner.
export const CALL_BANNER_HEIGHT_PX = 56

/** True when the banner is on screen; the layout uses this to offset content. */
export function useCallBannerVisible(): boolean {
  const { calls } = useVoiceReceiver()
  return calls.length > 0
}

// Who's calling — same normalized match the webhook threads the call with.
function useCallerName(from: string, orgId: string | undefined): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    setName(null)
    if (!orgId || !from) return
    let cancelled = false
    fetch(`/api/comms/caller-lookup?org_id=${encodeURIComponent(orgId)}&phone=${encodeURIComponent(from)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.contact?.name && !d.contact.is_placeholder) setName(d.contact.name)
      })
      .catch(() => { /* the number alone is enough to answer */ })
    return () => { cancelled = true }
  }, [from, orgId])
  return name
}

// One-second tick while any call is connected, for the duration readout.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function CallRow({ entry, lineLabel, now, otherCallConnected }: {
  entry: IncomingCall
  lineLabel: string | null
  now: number
  /** A different call is live right now. Answering this one must end that one,
   *  so Answer asks first instead of doing it silently. */
  otherCallConnected: boolean
}) {
  const { currentOrg } = useWorkspace()
  const { answer, decline, hangUp, setMuted } = useVoiceReceiver()
  const callerName = useCallerName(entry.from, currentOrg?.id)
  const display = callerName || formatUsPhone(entry.from) || 'Unknown caller'
  const ringing = entry.phase === 'ringing'
  const seconds = entry.connectedAt ? Math.max(0, Math.floor((now - entry.connectedAt) / 1000)) : 0

  // Inline "End current call and answer?" — only while another call is live.
  // If that call ends on its own while the question is up, the question is
  // moot and goes away; Answer then accepts directly.
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (!otherCallConnected) setConfirming(false) }, [otherCallConnected])
  const onAnswer = () => {
    if (otherCallConnected) setConfirming(true)
    else answer(entry.id)
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`flex items-center gap-3 px-4 h-14 text-white ${ringing ? 'bg-np-blue' : 'bg-np-dark'}`}
    >
      {/* Ring indicator */}
      <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center">
        {ringing && <span className="absolute inline-flex h-full w-full rounded-full bg-white/40 animate-ping" />}
        <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full ${ringing ? 'bg-white/20' : 'bg-green-500/30'}`}>
          {ringing ? <PhoneIncoming size={16} /> : <PhoneCall size={16} className="text-green-300" />}
        </span>
      </span>

      {/* Who + which line */}
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70 leading-tight">
            {ringing ? 'Incoming call' : `On call · ${mmss(seconds)}`}
          </p>
          <p className="text-sm font-bold truncate leading-tight">
            {display}
            {callerName && (
              <span className="ml-2 text-[11px] font-mono font-normal text-white/70">{formatUsPhone(entry.from)}</span>
            )}
          </p>
        </div>
        {lineLabel && (
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-semibold whitespace-nowrap">
            {lineLabel}
          </span>
        )}
      </div>

      {/* Exactly two actions per phase. */}
      {ringing ? (
        confirming ? (
          <div className="flex items-center gap-2 flex-shrink-0" role="alertdialog" aria-label="End current call and answer?">
            <span className="text-xs font-semibold">End current call and answer?</span>
            <button
              type="button"
              onClick={() => { setConfirming(false); answer(entry.id) }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-white text-xs font-semibold shadow"
            >
              <Phone size={14} /> Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => decline(entry.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold"
              title="Send this caller to voicemail"
            >
              <PhoneOff size={14} /> Decline
            </button>
            <button
              type="button"
              onClick={onAnswer}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-white text-xs font-semibold shadow"
              title={otherCallConnected ? 'You are on another call; you will be asked to confirm' : undefined}
            >
              <Phone size={14} /> Answer
            </button>
          </div>
        )
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setMuted(entry.id, !entry.muted)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold ${
              entry.muted ? 'bg-amber-400 text-np-dark' : 'bg-white/15 hover:bg-white/25'
            }`}
          >
            {entry.muted ? <MicOff size={14} /> : <Mic size={14} />} {entry.muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            onClick={() => hangUp(entry.id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow"
          >
            <PhoneOff size={14} /> Hang up
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Receiver registration state, always visible so it is obvious when this tab
 * is NOT going to ring. Sits top-right (below the banner while one is up).
 */
function ReceiverStatusPill({ offset }: { offset: boolean }) {
  const { status, error, enable, ringHere } = useVoiceReceiver()
  const { currentOrg } = useWorkspace()
  if (!currentOrg || status === 'unsupported') return null

  const top = offset ? { top: CALL_BANNER_HEIGHT_PX + 8 } : { top: 8 }
  const base = 'fixed right-3 z-[999] flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium shadow-sm'

  if (status === 'ready') {
    return (
      <div style={top} className={`${base} bg-white border-green-200 text-green-700`} title="Incoming calls ring on this tab">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Calls ring here
      </div>
    )
  }
  if (status === 'starting') {
    return (
      <div style={top} className={`${base} bg-white border-amber-200 text-amber-700`}>
        <Loader2 size={11} className="animate-spin" /> Connecting calls…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div style={top} className={`${base} bg-red-50 border-red-200 text-red-700`} title={error}>
        <AlertTriangle size={11} /> Not receiving calls
        <button type="button" onClick={ringHere} className="ml-1 underline font-semibold">Reconnect</button>
      </div>
    )
  }
  // 'off': enabled nowhere on this browser.
  return (
    <div style={top} className={`${base} bg-white border-gray-200 text-gray-500`} title="Browser calling is off on this tab">
      <PhoneOff size={11} /> Browser calling off
      <button type="button" onClick={enable} className="ml-1 underline font-semibold text-np-blue">Enable</button>
    </div>
  )
}

export function IncomingCallBanner() {
  const { calls } = useVoiceReceiver()
  const { currentOrg } = useWorkspace()
  const { labelFor } = useOrgLines(currentOrg?.id)

  // Newest ringing call on top, the connected call (if any) beneath it. Everything
  // else is queued and counted; it stays in `calls` untouched, still ringing.
  const newestRinging = calls.find(c => c.phase === 'ringing') ?? null
  const connected = calls.find(c => c.phase === 'connected') ?? null
  const rows = [newestRinging, connected].filter((c): c is IncomingCall => !!c)
  const queued = calls.length - rows.length
  const now = useNow(!!connected)

  return (
    <>
      {rows.length > 0 && (
        <div className="fixed inset-x-0 top-0 z-[1000] shadow-lg" data-testid="incoming-call-banner">
          {rows.map(entry => (
            <CallRow
              key={entry.id}
              entry={entry}
              lineLabel={labelFor(entry.line)}
              now={now}
              otherCallConnected={!!connected && connected.id !== entry.id}
            />
          ))}
          {queued > 0 && (
            <div className="bg-np-dark/95 text-white/80 text-[10px] font-medium px-4 py-1 border-t border-white/10">
              +{queued} more {queued === 1 ? 'call' : 'calls'} waiting — they keep ringing until answered or declined.
            </div>
          )}
        </div>
      )}
      <ReceiverStatusPill offset={rows.length > 0} />
    </>
  )
}

export default IncomingCallBanner
