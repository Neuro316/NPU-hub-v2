'use client'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { receiverIdentity } from '@/lib/voice-identity'

// Persistent inbound Device — the browser softphone's registration layer.
// Mounted once in the dashboard layout so it survives route changes; the UI that
// renders a ringing call consumes `incoming` from this context.
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

type ReceiverStatus =
  | 'unsupported'   // no WebRTC in this browser
  | 'off'           // staff user, not enabled on this browser yet
  | 'starting'      // acquiring mic / token / registering
  | 'ready'         // THIS TAB is registered — calls will ring here
  | 'error'         // NOT receiving calls; `error` explains why

interface IncomingCall {
  call: any
  from: string
  callSid: string
}

interface VoiceReceiverValue {
  status: ReceiverStatus
  error: string
  identity: string | null
  incoming: IncomingCall | null
  enable: () => Promise<void>
  disable: () => void
  /** Force THIS tab to (re)register — recovery from a dropped connection. */
  ringHere: () => Promise<void>
  /** Set by the ringing UI once a call is answered/dismissed. */
  clearIncoming: () => void
}

const VoiceReceiverContext = createContext<VoiceReceiverValue>({
  status: 'off', error: '', identity: null, incoming: null,
  enable: async () => {}, disable: () => {}, ringHere: async () => {},
  clearIncoming: () => {},
})

export function useVoiceReceiver() {
  return useContext(VoiceReceiverContext)
}

const ENABLED_KEY = 'npu_hub_voice_receiver_enabled'

export function VoiceReceiverProvider({ children }: { children: React.ReactNode }) {
  const { user, currentOrg } = useWorkspace()

  const [status, setStatus] = useState<ReceiverStatus>('off')
  const [error, setError] = useState('')
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [enabled, setEnabled] = useState(false)

  const deviceRef = useRef<any>(null)
  const orgIdRef = useRef<string | null>(null)

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
    setIncoming(null)
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
      const { Device } = await import('@twilio/voice-sdk')

      teardown()
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ['opus', 'pcmu'] as any,
      })
      deviceRef.current = device
      orgIdRef.current = orgId

      device.on('registered', () => { setStatus('ready'); setError('') })
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
        setIncoming({
          call,
          from: call?.parameters?.From || '',
          callSid: call?.parameters?.CallSid || '',
        })
        // If the caller hangs up or Twilio's <Dial> times out into voicemail,
        // the call is cancelled — drop the ringing UI so it can't be answered
        // into a call that no longer exists.
        call.on('cancel', () => setIncoming(prev => (prev?.call === call ? null : prev)))
        call.on('disconnect', () => setIncoming(prev => (prev?.call === call ? null : prev)))
        call.on('reject', () => setIncoming(prev => (prev?.call === call ? null : prev)))
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
  }, [fetchToken, teardown])

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

  const clearIncoming = useCallback(() => setIncoming(null), [])

  // Restore the per-browser opt-in on load.
  useEffect(() => {
    try { setEnabled(localStorage.getItem(ENABLED_KEY) === '1') } catch { /* private mode */ }
  }, [])

  // ── Lifecycle: (re)register when org / leadership / opt-in changes ────────
  // currentOrg.id is a dependency because the identity is org-derived: switching
  // workspaces must move the registration to the new org's identity.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setStatus('unsupported'); return
    }
    if (!user || !currentOrg || !enabled) {
      teardown()
      setStatus(enabled ? 'starting' : 'off')
      return
    }
    // Mic was already granted when this browser opted in — don't re-prompt.
    register(currentOrg.id, false)
    return () => { teardown() }
  }, [user, currentOrg?.id, enabled])  // eslint-disable-line react-hooks/exhaustive-deps

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
      value={{ status, error, identity, incoming, enable, disable, ringHere, clearIncoming }}
    >
      {children}
    </VoiceReceiverContext.Provider>
  )
}
