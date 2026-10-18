'use client'

import { useEffect, useState } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Loader2, AlertTriangle, PhoneCall,
  Grid3x3, Volume2,
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

// Phones (and touch tablets in portrait) get the full-screen call overlay
// instead of the banner. Desktop, including a narrow desktop window with a
// mouse wider than a phone, keeps the banner exactly as before.
const NARROW_QUERY = '(max-width: 767px), (max-width: 1023px) and (pointer: coarse)'

export function useIsNarrowCallScreen(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(mq.matches)
    update()
    try { mq.addEventListener('change', update) } catch { mq.addListener(update) }
    return () => {
      try { mq.removeEventListener('change', update) } catch { mq.removeListener(update) }
    }
  }, [])
  return narrow
}

/** True when the banner is on screen; the layout uses this to offset content.
 *  The phone overlay covers the screen instead, so it reserves nothing. */
export function useCallBannerVisible(): boolean {
  const { calls } = useVoiceReceiver()
  const narrow = useIsNarrowCallScreen()
  return calls.length > 0 && !narrow
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

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/**
 * Phone layout: a fixed full-screen overlay at the top layer, from any Hub page.
 * Same contract as the banner: no backdrop close, no Escape, no auto-dismiss,
 * and no tap outside the buttons does anything. Ringing shows Answer and
 * Decline; connected shows Mute, Keypad, Speaker (only where the browser can
 * choose an output) and Hang up, all in the bottom half for a thumb.
 */
function MobileCallOverlay({ entry, lineLabel, now, otherCall, queued }: {
  entry: IncomingCall
  lineLabel: string | null
  now: number
  /** The connected call, when `entry` is a second call ringing over it. */
  otherCall: IncomingCall | null
  queued: number
}) {
  const { currentOrg } = useWorkspace()
  const {
    answer, decline, hangUp, setMuted, sendDigits, ringerLocked,
    outputDevices, outputDeviceId, setOutputDevice,
  } = useVoiceReceiver()
  const callerName = useCallerName(entry.from, currentOrg?.id)
  const number = formatUsPhone(entry.from)
  const display = callerName || number || 'Unknown caller'
  const ringing = entry.phase === 'ringing'
  const seconds = entry.connectedAt ? Math.max(0, Math.floor((now - entry.connectedAt) / 1000)) : 0

  const [confirming, setConfirming] = useState(false)
  const [keypad, setKeypad] = useState(false)
  const [digits, setDigits] = useState('')
  useEffect(() => { if (!otherCall) setConfirming(false) }, [otherCall])
  useEffect(() => { setKeypad(false); setDigits('') }, [entry.id, entry.phase])

  const onAnswer = () => {
    if (otherCall) setConfirming(true)
    else answer(entry.id)
  }

  // Speaker: cycle through the outputs the browser exposes. Hidden when it
  // cannot choose (iOS Safari), where the phone's own audio route applies.
  const canSpeaker = outputDevices.length > 1
  const currentOutput = outputDevices.find(d => d.id === outputDeviceId) ?? outputDevices[0]
  const nextOutput = () => {
    if (!canSpeaker) return
    const i = outputDevices.findIndex(d => d.id === outputDeviceId)
    setOutputDevice(outputDevices[(i + 1) % outputDevices.length].id)
  }

  const bigBtn = 'flex flex-col items-center gap-2 text-white text-sm font-semibold select-none'
  const ctlBtn = 'flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl text-xs font-semibold select-none'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ringing ? `Incoming call from ${display}` : `On call with ${display}`}
      data-testid="incoming-call-overlay"
      className={`fixed inset-0 z-[2000] flex flex-col text-white overscroll-none touch-manipulation ${
        ringing ? 'bg-gradient-to-b from-np-blue to-np-dark' : 'bg-np-dark'
      }`}
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 24px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
      }}
    >
      {/* Who + which line */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center min-h-0" aria-live="assertive">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
          {ringing ? 'Incoming call' : `On call · ${mmss(seconds)}`}
        </p>
        {lineLabel && (
          <span className="mt-3 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold">{lineLabel}</span>
        )}
        <span className="relative mt-6 flex h-20 w-20 items-center justify-center">
          {ringing && <span className="absolute inline-flex h-full w-full rounded-full bg-white/30 animate-ping" />}
          <span className={`relative inline-flex h-20 w-20 items-center justify-center rounded-full ${ringing ? 'bg-white/20' : 'bg-green-500/30'}`}>
            {ringing ? <PhoneIncoming size={32} /> : <PhoneCall size={32} className="text-green-300" />}
          </span>
        </span>
        <p className="mt-5 text-3xl font-bold leading-tight break-words max-w-full">{display}</p>
        {callerName && number && <p className="mt-1 text-base font-mono text-white/70">{number}</p>}
        {ringing && otherCall && (
          <p className="mt-4 text-sm text-white/80">You are on another call. Answering ends it.</p>
        )}
        {ringing && ringerLocked && (
          <p className="mt-4 text-xs text-white/60">No ringtone? Tap anywhere to turn sound on. Tapping does not end the call.</p>
        )}
        {queued > 0 && (
          <p className="mt-3 text-xs text-white/60">
            +{queued} more {queued === 1 ? 'call' : 'calls'} waiting
          </p>
        )}
        {!ringing && keypad && (
          <p className="mt-4 min-h-[2rem] text-2xl font-mono tracking-widest">{digits}</p>
        )}
      </div>

      {/* Actions: bottom half, thumb reach */}
      <div className="px-6">
        {ringing ? (
          confirming ? (
            <div className="flex flex-col items-center gap-4" role="alertdialog" aria-label="End current call and answer?">
              <p className="text-base font-semibold">End current call and answer?</p>
              <div className="flex w-full gap-4">
                <button type="button" onClick={() => setConfirming(false)}
                  className="flex-1 h-14 rounded-2xl bg-white/15 active:bg-white/25 text-base font-semibold">
                  Cancel
                </button>
                <button type="button" onClick={() => { setConfirming(false); answer(entry.id) }}
                  className="flex-1 h-14 rounded-2xl bg-green-500 active:bg-green-400 text-base font-semibold">
                  Yes, answer
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-around pb-4">
              <button type="button" onClick={() => decline(entry.id)} className={bigBtn} aria-label="Decline, send to voicemail">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 active:bg-red-500 shadow-lg">
                  <PhoneOff size={32} />
                </span>
                Decline
              </button>
              <button type="button" onClick={onAnswer} className={bigBtn} aria-label="Answer">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500 active:bg-green-400 shadow-lg">
                  <Phone size={32} />
                </span>
                Answer
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center gap-5 pb-2">
            {keypad ? (
              <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                {DTMF_KEYS.map(d => (
                  <button key={d} type="button"
                    onClick={() => { sendDigits(entry.id, d); setDigits(p => (p + d).slice(-20)) }}
                    className="h-14 rounded-2xl bg-white/10 active:bg-white/25 text-2xl font-light select-none">
                    {d}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={`grid w-full max-w-xs gap-3 ${canSpeaker ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <button type="button" onClick={() => setMuted(entry.id, !entry.muted)} aria-pressed={entry.muted}
                className={`${ctlBtn} ${entry.muted ? 'bg-amber-400 text-np-dark' : 'bg-white/10 active:bg-white/25'}`}>
                {entry.muted ? <MicOff size={24} /> : <Mic size={24} />}
                {entry.muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" onClick={() => setKeypad(k => !k)} aria-pressed={keypad}
                className={`${ctlBtn} ${keypad ? 'bg-white/30' : 'bg-white/10 active:bg-white/25'}`}>
                <Grid3x3 size={24} />
                {keypad ? 'Hide keypad' : 'Keypad'}
              </button>
              {canSpeaker && (
                <button type="button" onClick={nextOutput}
                  className={`${ctlBtn} bg-white/10 active:bg-white/25`}>
                  <Volume2 size={24} />
                  <span className="truncate max-w-full px-1">{currentOutput?.label || 'Speaker'}</span>
                </button>
              )}
            </div>
            <button type="button" onClick={() => hangUp(entry.id)} className={bigBtn} aria-label="Hang up">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 active:bg-red-500 shadow-lg">
                <PhoneOff size={32} />
              </span>
              Hang up
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** A call that could not connect (for example, the microphone is blocked). */
function CallErrorNotice() {
  const { callError, clearCallError } = useVoiceReceiver()
  if (!callError) return null
  return (
    <div role="alert" className="fixed inset-x-3 top-3 z-[2100] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg md:left-auto md:w-96">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <p className="flex-1">{callError}</p>
        <button type="button" onClick={clearCallError} className="font-semibold underline">Dismiss</button>
      </div>
    </div>
  )
}

export function IncomingCallBanner() {
  const { calls } = useVoiceReceiver()
  const { currentOrg } = useWorkspace()
  const { labelFor } = useOrgLines(currentOrg?.id)
  const narrow = useIsNarrowCallScreen()

  // Newest ringing call on top, the connected call (if any) beneath it. Everything
  // else is queued and counted; it stays in `calls` untouched, still ringing.
  const newestRinging = calls.find(c => c.phase === 'ringing') ?? null
  const connected = calls.find(c => c.phase === 'connected') ?? null
  const rows = [newestRinging, connected].filter((c): c is IncomingCall => !!c)
  const queued = calls.length - rows.length
  const now = useNow(!!connected)

  if (narrow) {
    // One call fills the screen: the newest ringing one, else the connected one.
    const shown = newestRinging ?? connected
    return (
      <>
        {shown && (
          <MobileCallOverlay
            key={shown.id}
            entry={shown}
            lineLabel={labelFor(shown.line)}
            now={now}
            otherCall={connected && connected.id !== shown.id ? connected : null}
            queued={calls.length - 1 - (connected && connected.id !== shown.id ? 1 : 0)}
          />
        )}
        <CallErrorNotice />
        {!shown && <ReceiverStatusPill offset={false} />}
      </>
    )
  }

  return (
    <>
      <CallErrorNotice />
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
