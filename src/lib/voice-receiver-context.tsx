'use client'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { receiverIdentity } from '@/lib/voice-identity'
import {
  applyCallEvent, createRinger, isMicrophoneError, shouldRing, MIC_BLOCKED_MESSAGE,
  type CallEvent, type Ringer,
} from '@/lib/voice-call-state'
import {
  keepRemoteAudioPlaying, listOutputDevices, loadVoiceSdk, setOutputDevice as routeOutput,
  unlockCallAudio, type OutputDevice,
} from '@/lib/voice-audio'

// Persistent inbound Device — the browser softphone's registration layer.
// Mounted once in the dashboard layout so it survives route changes; the UI that
// renders a ringing call (components/incoming-call-banner.tsx) consumes `calls`
// from this context.
//
// EVERY eligible tab registers — there is deliberately NO leader election.
//   An earlier version elected one tab per browser over BroadcastChannel to
//   avoid redundant registrations. It caused a silent, total failure: a tab that
//   won the vote but never actually registered (mic denied, token error, hard
//   close without `pagehide` firing) kept the crown while every other tab sat
//   dormant, so inbound calls rang nobody and fell to voicemail with the UI
//   showing "another tab is handling calls". Leadership and registration were
//   separate facts with nothing tying them together, and there was no way back.
//
//   Twilio forks an incoming call to EVERY endpoint registered under an
//   identity and the first to accept wins, so redundant registration is normal,
//   supported behaviour — not a bug. The cost is N WebSockets and N ringtones
//   when several tabs are open; the benefit is that "am I reachable?" has one
//   answer per tab, decided by that tab, visible in that tab. For a phone,
//   availability beats tidiness.
//
// Registration is DELIBERATELY opt-in ("Enable browser calling"):
//   * device.register() needs no mic permission, but call.accept() does — so
//     without an up-front opt-in the FIRST real call would hit the browser's mic
//     prompt mid-ring while a live caller waits in silence, and a mis-clicked
//     "Block" would break answering with no re-prompt.
//   * That same click is a user gesture, which is what unblocks the browser's
//     autoplay policy so the incoming ringtone is actually audible.
// Once enabled we remember it per-browser and re-register silently on later
// loads (the mic grant persists for the origin, so no prompt reappears).
//
// ── THE "RINGING STOPS WHEN YOU CLICK" BUG ───────────────────────────────────
// The lifecycle effect below used to depend on the `user` OBJECT. WorkspaceContext
// replaces that object on every Supabase onAuthStateChange event (SIGNED_IN /
// TOKEN_REFRESHED fire on window focus and on token refresh), so a click that
// refocused the window re-ran the effect, which called teardown(): the Device was
// destroyed mid-ring and the ringing call vanished. Nothing in the UI dismissed
// it; the registration underneath it was being torn down. The effect now keys on
// user.id, which is stable for the life of the session. Teardown happens only on
// a genuine change: org switch, disable, sign-out.
//
// ── THE RINGER IS OURS, NOT THE SDK'S ────────────────────────────────────────
// The SDK's built-in ringtone is switched off (device.audio.incoming(false)) and
// replaced by one <audio> element driven ONLY by the call list, through
// shouldRing() in voice-call-state.ts. On phones the SDK's ringtone was created
// and played outside any tap, so the browser could block it or iOS could pause
// it, with no way back. Ours is unlocked by the first tap anywhere in the Hub,
// and every later tap can only START it if a call is ringing and it is not
// playing. No tap can stop it: only Answer, Decline, or the far side ending the
// call changes the list.

type ReceiverStatus =
  | 'unsupported'   // no WebRTC in this browser
  | 'off'           // staff user, not enabled on this browser yet
  | 'starting'      // acquiring mic / token / registering
  | 'ready'         // THIS TAB is registered — calls will ring here
  | 'error'         // NOT receiving calls; `error` explains why

export type IncomingCallPhase = 'ringing' | 'connected'

export interface IncomingCall {
  /** Stable React key: the Twilio CallSid, else a local id. */
  id: string
  call: any
  /** The real caller. From the `caller` custom parameter when the line forwards
   *  to a cell (callerId then overwrites the leg's From), else the leg's From. */
  from: string
  callSid: string
  /** The org line (E.164) that was dialled, from the `line` custom parameter. */
  line: string
  phase: IncomingCallPhase
  receivedAt: number
  connectedAt: number | null
  muted: boolean
}

interface VoiceReceiverValue {
  status: ReceiverStatus
  error: string
  identity: string | null
  /** Every live inbound call, newest first: the ringing ones and the connected
   *  one. A call leaves this list ONLY when it is answered-then-ended, declined,
   *  hung up, cancelled by the caller, or timed out by Twilio's <Dial>. */
  calls: IncomingCall[]
  /** The newest live call. Kept for callers that only knew one. */
  incoming: IncomingCall | null
  enable: () => Promise<void>
  disable: () => void
  /** Force THIS tab to (re)register — recovery from a dropped connection. */
  ringHere: () => Promise<void>
  answer: (id: string) => void
  decline: (id: string) => void
  hangUp: (id: string) => void
  setMuted: (id: string, muted: boolean) => void
  /** Send DTMF on a connected call (in-call keypad). */
  sendDigits: (id: string, digits: string) => void
  /** Why the last call could not connect (blocked mic), for the call UI. '' = none. */
  callError: string
  clearCallError: () => void
  /** True until a tap has unlocked the ringtone on this page load (phones). */
  ringerLocked: boolean
  /** Selectable audio outputs. Empty where the browser cannot choose (iOS Safari). */
  outputDevices: OutputDevice[]
  outputDeviceId: string
  setOutputDevice: (id: string) => void
  /** @deprecated Drops the newest call from the list without touching the call. */
  clearIncoming: () => void
}

const VoiceReceiverContext = createContext<VoiceReceiverValue>({
  status: 'off', error: '', identity: null, calls: [], incoming: null,
  enable: async () => {}, disable: () => {}, ringHere: async () => {},
  answer: () => {}, decline: () => {}, hangUp: () => {}, setMuted: () => {},
  sendDigits: () => {}, callError: '', clearCallError: () => {}, ringerLocked: false,
  outputDevices: [], outputDeviceId: 'default', setOutputDevice: () => {},
  clearIncoming: () => {},
})

export function useVoiceReceiver() {
  return useContext(VoiceReceiverContext)
}

const ENABLED_KEY = 'npu_hub_voice_receiver_enabled'

// The same ringtone the SDK plays, from the same Twilio CDN it already loads.
const RINGTONE_URL = 'https://sdk.twilio.com/js/client/sounds/releases/1.0.0/incoming.mp3'

export function VoiceReceiverProvider({ children }: { children: React.ReactNode }) {
  const { user, currentOrg } = useWorkspace()
  const userId = user?.id ?? null

  const [status, setStatus] = useState<ReceiverStatus>('off')
  const [error, setError] = useState('')
  const [calls, setCalls] = useState<IncomingCall[]>([])
  const [enabled, setEnabled] = useState(false)
  const [callError, setCallError] = useState('')
  const [ringerLocked, setRingerLocked] = useState(true)
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])
  const [outputDeviceId, setOutputDeviceId] = useState('default')

  const deviceRef = useRef<any>(null)
  const orgIdRef = useRef<string | null>(null)
  // Read inside call handlers without re-binding them.
  const callsRef = useRef<IncomingCall[]>([])
  callsRef.current = calls

  const dispatch = useCallback((ev: CallEvent<IncomingCall>) => {
    setCalls(prev => applyCallEvent(prev, ev))
  }, [])

  // ── Ringer ───────────────────────────────────────────────────────────────
  const ringerRef = useRef<Ringer | null>(null)
  const ringer = () => {
    if (!ringerRef.current && typeof window !== 'undefined') {
      ringerRef.current = createRinger(() => {
        try {
          const a = new Audio(RINGTONE_URL)
          a.preload = 'auto'
          return a
        } catch { return null }
      })
    }
    return ringerRef.current
  }

  // The call list is the only input that can start or stop ringing.
  useEffect(() => {
    ringer()?.sync(shouldRing(calls))
  }, [calls])  // eslint-disable-line react-hooks/exhaustive-deps

  // Every tap anywhere in the Hub: unlock audio for this page load, and restart
  // a ringtone the browser paused. Capture phase and passive, so it runs before
  // and regardless of whatever the tap does on the page, and never blocks it.
  useEffect(() => {
    const opts = { capture: true, passive: true } as const
    const onGesture = () => {
      unlockCallAudio()
      const r = ringer()
      if (!r) return
      r.onUserGesture()
      if (r.unlocked) setRingerLocked(false)
      else setTimeout(() => { if (r.unlocked) setRingerLocked(false) }, 250)
    }
    document.addEventListener('pointerdown', onGesture, opts)
    document.addEventListener('touchend', onGesture, opts)
    document.addEventListener('keydown', onGesture, opts)
    return () => {
      document.removeEventListener('pointerdown', onGesture, opts)
      document.removeEventListener('touchend', onGesture, opts)
      document.removeEventListener('keydown', onGesture, opts)
      ringerRef.current?.dispose()
      ringerRef.current = null
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const identity = currentOrg ? receiverIdentity(currentOrg.id) : null

  // ── Token ────────────────────────────────────────────────────────────────
  const fetchToken = useCallback(async (orgId: string): Promise<string> => {
    const res = await fetch('/api/voice/receiver-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Token request failed (${res.status})`)
    return data.token
  }, [])

  const teardown = useCallback(() => {
    const device = deviceRef.current
    deviceRef.current = null
    if (device) {
      try { device.removeAllListeners?.() } catch { /* sdk version tolerance */ }
      try { device.destroy() } catch { /* already gone */ }
    }
    setCalls([])
    setOutputDevices([])
  }, [])

  // ── Registration ─────────────────────────────────────────────────────────
  const register = useCallback(async (orgId: string, promptForMic: boolean) => {
    setStatus('starting')
    setError('')
    try {
      if (promptForMic) {
        // Pre-warm: acquire and immediately release. The grant persists for the
        // origin, so accept() later is instant and prompt-free.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
      }

      const token = await fetchToken(orgId)
      const { Device } = await loadVoiceSdk()

      teardown()
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ['opus', 'pcmu'] as any,
        // A second inbound call while one is connected must RING (and be shown
        // and queued), not be auto-rejected by the SDK. answer() below ends the
        // connected call before accepting another; the SDK holds one at a time.
        allowIncomingWhileBusy: true,
      })
      deviceRef.current = device
      orgIdRef.current = orgId

      // Our ringer replaces the SDK's (see the header note).
      try { device.audio?.incoming(false) } catch { /* sdk version tolerance */ }

      const refreshOutputs = () => setOutputDevices(listOutputDevices(device))
      try { device.audio?.on?.('deviceChange', refreshOutputs) } catch { /* sdk version tolerance */ }

      device.on('registered', () => { setStatus('ready'); setError(''); refreshOutputs() })
      device.on('unregistered', () => {
        // Only a warning if we still believe we should be receiving.
        setStatus(prev => (prev === 'ready' ? 'starting' : prev))
      })

      device.on('error', (err: any) => {
        console.error('[voice-receiver] device error:', err)
        setStatus('error')
        setError(err?.message || 'Browser calling stopped unexpectedly.')
      })

      // Refresh BEFORE expiry (SDK fires ~3 min out; token TTL is 1 hour).
      device.on('tokenWillExpire', async () => {
        try {
          const fresh = await fetchToken(orgIdRef.current || orgId)
          device.updateToken(fresh)
        } catch (e: any) {
          // Loud on purpose: a silent refresh failure leaves the UI looking fine
          // while the browser has quietly stopped being reachable.
          console.error('[voice-receiver] token refresh failed:', e)
          setStatus('error')
          setError('Your session expired — not receiving calls. Reload the page to reconnect.')
        }
      })

      device.on('incoming', (call: any) => {
        // Custom <Parameter>s from the inbound TwiML (inbound-voice.ts
        // appendRingDial). `caller` is present only when the line forwards to a
        // cell: the <Dial callerId> that makes the cell show a business call
        // also overwrites this leg's From, so the true caller travels here.
        // A plain browser-only line (NP main) has no `caller`, and From is used
        // exactly as before.
        const custom: Map<string, string> | undefined = call?.customParameters
        const caller = (custom?.get?.('caller') || '').trim()
        const callSid = String(call?.parameters?.CallSid || '')
        const entry: IncomingCall = {
          id: callSid || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          call,
          from: caller || call?.parameters?.From || '',
          callSid,
          line: (custom?.get?.('line') || '').trim(),
          phase: 'ringing',
          receivedAt: Date.now(),
          connectedAt: null,
          muted: false,
        }
        // Newest first (applyCallEvent). An existing ringing call is never
        // replaced or dropped because another arrived.
        dispatch({ type: 'incoming', entry })

        // The ONLY ways a call leaves the list: the caller hangs up or Twilio's
        // <Dial> times out into voicemail (cancel), the call ends after being
        // answered (disconnect), or we declined it (reject).
        const drop = () => dispatch({ type: 'ended', id: entry.id })
        call.on('cancel', drop)
        call.on('disconnect', drop)
        call.on('reject', drop)
        call.on('accept', () => {
          dispatch({ type: 'accepted', id: entry.id, at: Date.now() })
          keepRemoteAudioPlaying(call)
        })
        call.on('error', (err: any) => {
          console.error('[voice-receiver] call error:', err)
          if (isMicrophoneError(err)) setCallError(MIC_BLOCKED_MESSAGE)
          drop()
        })
      })

      await device.register()
    } catch (e: any) {
      console.error('[voice-receiver] register failed:', e)
      teardown()
      setStatus('error')
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow the mic for this site, then enable again.'
          : (e?.message || 'Could not start browser calling.')
      )
    }
  }, [fetchToken, teardown, dispatch])

  // ── Call controls ────────────────────────────────────────────────────────
  const findCall = (id: string) => callsRef.current.find(c => c.id === id)

  const answer = useCallback((id: string) => {
    const entry = findCall(id)
    if (!entry) return
    // One live call at a time: end whatever is connected before accepting. The
    // banner asks "End current call and answer?" before calling this while
    // another call is live, so this is never silent from the operator's side.
    for (const other of callsRef.current) {
      if (other.id !== id && other.phase === 'connected') {
        try { other.call.disconnect() } catch { /* already gone */ }
      }
    }
    // Synchronously, inside the Answer tap: stop the ringtone so it does not
    // hold the audio session, wake call audio, then accept in the same tick so
    // the SDK's microphone request and audio playback count as this tap.
    ringerRef.current?.sync(false)
    unlockCallAudio()
    setCallError('')
    try {
      entry.call.accept()
    } catch (e) {
      console.error('[voice-receiver] accept failed:', e)
      if (isMicrophoneError(e)) setCallError(MIC_BLOCKED_MESSAGE)
      dispatch({ type: 'ended', id })
      return
    }
    // Optimistic; the 'accept' event confirms it.
    dispatch({ type: 'accepted', id, at: Date.now() })

    // Report who picked up. The org-shared identity can't tell the server this,
    // so the answering browser does. Fire-and-forget: bookkeeping must never
    // interfere with a live call.
    if (entry.callSid) {
      fetch('/api/voice/answered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_sid: entry.callSid }),
      }).catch(() => { /* non-fatal */ })
    }
  }, [dispatch])

  // Declining does NOT hang up on the caller: rejecting this leg ends only the
  // browser leg, Twilio's <Dial> completes with no-answer, and /ring-complete
  // sends the caller to voicemail.
  const decline = useCallback((id: string) => {
    const entry = findCall(id)
    if (!entry) return
    try { entry.call.reject() } catch { /* already gone */ }
    dispatch({ type: 'ended', id })
  }, [dispatch])

  const hangUp = useCallback((id: string) => {
    const entry = findCall(id)
    if (!entry) return
    try { entry.call.disconnect() } catch { /* already gone */ }
    dispatch({ type: 'ended', id })
  }, [dispatch])

  const setMuted = useCallback((id: string, muted: boolean) => {
    const entry = findCall(id)
    if (!entry) return
    try { entry.call.mute(muted) } catch { /* sdk tolerance */ }
    dispatch({ type: 'muted', id, muted })
  }, [dispatch])

  const sendDigits = useCallback((id: string, digits: string) => {
    const entry = findCall(id)
    if (!entry || entry.phase !== 'connected') return
    try { entry.call.sendDigits(digits) } catch (e) { console.warn('[voice-receiver] sendDigits failed:', e) }
  }, [])

  // Only offered where the browser supports it; a failure keeps the current output.
  const setOutputDevice = useCallback((id: string) => {
    routeOutput(deviceRef.current, id).then(ok => { if (ok) setOutputDeviceId(id) })
  }, [])

  const clearCallError = useCallback(() => setCallError(''), [])

  // ── Public controls ──────────────────────────────────────────────────────
  // Enable ALWAYS registers THIS tab and always prompts for the mic here — the
  // tab you click on is the tab that will ring. (Under the old election a click
  // could set the flag while a different tab did the registering, so the mic was
  // never requested on the tab in front of you.)
  const enable = useCallback(async () => {
    if (!currentOrg) return
    try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
    setEnabled(true)
    await register(currentOrg.id, true)
  }, [currentOrg, register])

  // Manual recovery: force this tab to re-register. Use when a connection was
  // dropped (sleep, network change) or when you simply want calls on THIS tab.
  const ringHere = useCallback(async () => {
    if (!currentOrg) return
    try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
    setEnabled(true)
    // promptForMic true: if the grant was never given on this browser (or was
    // revoked) this is the moment to fix it, rather than failing at accept().
    await register(currentOrg.id, true)
  }, [currentOrg, register])

  const disable = useCallback(() => {
    try { localStorage.removeItem(ENABLED_KEY) } catch { /* private mode */ }
    setEnabled(false)
    teardown()
    setStatus('off')
    setError('')
  }, [teardown])

  const clearIncoming = useCallback(() => setCalls(prev => prev.slice(1)), [])

  // Restore the per-browser opt-in on load.
  useEffect(() => {
    try { setEnabled(localStorage.getItem(ENABLED_KEY) === '1') } catch { /* private mode */ }
  }, [])

  // ── Lifecycle: (re)register when user / org / opt-in changes ─────────────
  // currentOrg.id is a dependency because the identity is org-derived: switching
  // workspaces must move the registration to the new org's identity.
  // userId (NOT the user object) — see the header note: the object is replaced
  // on every auth event, and re-running this effect destroys a ringing call.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setStatus('unsupported'); return
    }
    if (!userId || !currentOrg || !enabled) {
      teardown()
      setStatus(enabled ? 'starting' : 'off')
      return
    }
    // Mic was already granted when this browser opted in — don't re-prompt.
    register(currentOrg.id, false)
    return () => { teardown() }
  }, [userId, currentOrg?.id, enabled])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recovery: sleep, network changes, tab restore ─────────────────────────
  // The signalling WebSocket drops on sleep/Wi-Fi switches; the SDK reconnects in
  // many cases but not all, so nudge it whenever the tab comes back to life.
  useEffect(() => {
    if (!enabled) return
    const revive = () => {
      const device = deviceRef.current
      if (!device || device.state === 'registered' || device.state === 'destroyed') return
      device.register().catch((e: any) => console.warn('[voice-receiver] re-register failed:', e))
    }
    const onVisible = () => { if (document.visibilityState === 'visible') revive() }
    window.addEventListener('online', revive)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', revive)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  return (
    <VoiceReceiverContext.Provider
      value={{
        status, error, identity, calls, incoming: calls[0] ?? null,
        enable, disable, ringHere, answer, decline, hangUp, setMuted, clearIncoming,
        sendDigits, callError, clearCallError, ringerLocked,
        outputDevices, outputDeviceId, setOutputDevice,
      }}
    >
      {children}
    </VoiceReceiverContext.Provider>
  )
}
