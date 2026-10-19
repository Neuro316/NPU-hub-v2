'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  createOutboundStore, type OutboundSnapshot, type OutboundStore, type PlaceResult,
} from '@/lib/voice-call-state'
import {
  createRingback, ensureMicrophone, hangupOnServer, keepRemoteAudioPlaying, listOutputDevices,
  loadVoiceSdk, loadedVoiceSdk, primeCallTones, setOutputDevice as routeOutput, unlockCallAudio,
  type OutputDevice,
} from '@/lib/voice-audio'

// The Hub's one outbound browser call, at the app level.
//
// Mounted once in the dashboard layout (beside VoiceReceiverProvider), so a call
// belongs to no page and navigating between Hub pages never ends it. Every
// place that starts or shows an outbound call goes through here: the top Call
// button, the /crm/dialer page, and VoipCall (contact Call buttons,
// Conversations). There is one live call at a time; placeCall() refuses while
// one is live. The call logic itself (End at every stage, ringback, the
// server hangup backstop) is createOutboundCall in voice-call-state.ts, run by
// createOutboundStore.

export interface OutboundTarget {
  contactId: string
  /** Contact name, or '' to show the number. */
  name: string
  phone: string
  /** Org line to call FROM. Omit / null for the server's default caller ID. */
  lineE164?: string | null
}

interface OutboundCallValue {
  snapshot: OutboundSnapshot<OutboundTarget>
  /** True from Call until the call is gone. */
  live: boolean
  /**
   * Place a call. Call it synchronously from the Call tap: it wakes call audio
   * and primes the ringback tone first (phones only allow that inside a
   * gesture), then asks for the microphone and dials.
   */
  placeCall: (target: OutboundTarget) => PlaceResult
  hangUp: () => void
  setMuted: (muted: boolean) => void
  sendDigits: (digits: string) => void
  /** Selectable audio outputs for the live call. Empty where unsupported (iOS Safari). */
  outputDevices: OutputDevice[]
  outputDeviceId: string
  setOutputDevice: (id: string) => void
}

const IDLE_SNAPSHOT: OutboundSnapshot<OutboundTarget> = {
  session: 0, stage: 'idle', target: null, connectedAt: null, muted: false, ended: null,
}

const OutboundCallContext = createContext<OutboundCallValue>({
  snapshot: IDLE_SNAPSHOT,
  live: false,
  placeCall: () => ({ ok: false, reason: 'busy' }),
  hangUp: () => {}, setMuted: () => {}, sendDigits: () => {},
  outputDevices: [], outputDeviceId: 'default', setOutputDevice: () => {},
})

export function useOutboundCall() {
  return useContext(OutboundCallContext)
}

export const ALREADY_ON_CALL_MESSAGE = 'You are already on a call. End it before starting another.'

function setupFor(target: OutboundTarget) {
  return {
    ensureMicrophone,
    async prepare() {
      const res = await fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: target.contactId,
          ...(target.lineE164 ? { line_e164: target.lineE164 } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false as const, message: data?.error || 'Could not start the call.' }
      if (data.log_warning) console.warn('Voice log warning:', data.log_warning)
      await loadVoiceSdk()
      return {
        ok: true as const,
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
    createDevice: (token: string) =>
      new (loadedVoiceSdk().Device)(token, { logLevel: 1, codecPreferences: ['opus', 'pcmu'] as any }),
    // Phones can leave the far side's audio element paused; see voice-audio.ts.
    onRemoteAudio: keepRemoteAudioPlaying,
    ringback: createRingback(),
    hangupOnServer,
    later: (fn: () => void, ms: number) => setTimeout(fn, ms),
  }
}

export function OutboundCallProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<OutboundStore<OutboundTarget> | null>(null)
  if (!storeRef.current) storeRef.current = createOutboundStore<OutboundTarget>(setupFor)
  const store = storeRef.current

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_SNAPSHOT)
  const live = snapshot.stage !== 'idle'

  // Only the layout unmounting (sign-out, leaving the dashboard) ends a call.
  useEffect(() => () => { storeRef.current?.dispose() }, [])

  // Load the SDK early so a Call tap can wake its audio synchronously.
  useEffect(() => { loadVoiceSdk().catch(() => { /* retried when a call starts */ }) }, [])

  const placeCall = useCallback((target: OutboundTarget): PlaceResult => {
    // Inside the tap, before anything awaits.
    unlockCallAudio()
    primeCallTones()
    return store.place(target)
  }, [store])

  // ── Speaker (output selection), where the browser supports it ─────────────
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])
  const [outputDeviceId, setOutputDeviceId] = useState('default')
  useEffect(() => {
    if (snapshot.stage !== 'connected') { setOutputDevices([]); setOutputDeviceId('default'); return }
    const device = store.controller?.device
    setOutputDevices(listOutputDevices(device))
  }, [snapshot.stage, snapshot.session, store])
  const setOutputDevice = useCallback((id: string) => {
    routeOutput(store.controller?.device, id).then(ok => { if (ok) setOutputDeviceId(id) })
  }, [store])

  const value = useMemo<OutboundCallValue>(() => ({
    snapshot, live, placeCall,
    hangUp: () => store.hangUp(),
    setMuted: (m: boolean) => store.setMuted(m),
    sendDigits: (d: string) => store.sendDigits(d),
    outputDevices, outputDeviceId, setOutputDevice,
  }), [snapshot, live, placeCall, store, outputDevices, outputDeviceId, setOutputDevice])

  return <OutboundCallContext.Provider value={value}>{children}</OutboundCallContext.Provider>
}
