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
  | 'unsupported'   // no WebRTC/BroadcastChannel path available
  | 'off'           // staff user, not enabled on this browser yet
  | 'starting'      // acquiring mic / token / registering
  | 'ready'         // registered — calls will ring here
  | 'follower'      // another tab in this browser holds the registration
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
  /** Set by the ringing UI once a call is answered/dismissed. */
  clearIncoming: () => void
}

const VoiceReceiverContext = createContext<VoiceReceiverValue>({
  status: 'off', error: '', identity: null, incoming: null,
  enable: async () => {}, disable: () => {}, clearIncoming: () => {},
})

export function useVoiceReceiver() {
  return useContext(VoiceReceiverContext)
}

const ENABLED_KEY = 'npu_hub_voice_receiver_enabled'
const CHANNEL_NAME = 'npu-voice-receiver'
const ELECTION_WAIT_MS = 400

export function VoiceReceiverProvider({ children }: { children: React.ReactNode }) {
  const { user, currentOrg } = useWorkspace()

  const [status, setStatus] = useState<ReceiverStatus>('off')
  const [error, setError] = useState('')
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [isLeader, setIsLeader] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const deviceRef = useRef<any>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef<string>('')
  const orgIdRef = useRef<string | null>(null)

  const identity = currentOrg ? receiverIdentity(currentOrg.id) : null

  // ── Leader election ──────────────────────────────────────────────────────
  // Every tab of this browser shares one identity, and Twilio forks an incoming
  // call to EVERY registration — so N open tabs would ring N times. One tab
  // registers; the rest sit as followers and take over when it goes away.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof BroadcastChannel === 'undefined') { setIsLeader(true); return }  // no election possible: act alone

    tabIdRef.current = Math.random().toString(36).slice(2)
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    let leader = false
    let electionTimer: ReturnType<typeof setTimeout> | null = null

    const claim = () => {
      electionTimer = setTimeout(() => {
        leader = true
        setIsLeader(true)
        channel.postMessage({ type: 'leader', id: tabIdRef.current })
      }, ELECTION_WAIT_MS)
      channel.postMessage({ type: 'who', id: tabIdRef.current })
    }

    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data || {}
      if (msg.id === tabIdRef.current) return
      if (msg.type === 'who' && leader) {
        channel.postMessage({ type: 'leader', id: tabIdRef.current })
      }
      if (msg.type === 'leader' && !leader) {
        if (electionTimer) { clearTimeout(electionTimer); electionTimer = null }
        setIsLeader(false)
      }
      if (msg.type === 'bye' && !leader) {
        // Stagger so two followers don't both claim on the same tick.
        setTimeout(claim, Math.floor(Math.random() * 200))
      }
    }

    claim()

    const relinquish = () => {
      if (leader) channel.postMessage({ type: 'bye', id: tabIdRef.current })
    }
    window.addEventListener('pagehide', relinquish)

    return () => {
      relinquish()
      window.removeEventListener('pagehide', relinquish)
      if (electionTimer) clearTimeout(electionTimer)
      channel.close()
      channelRef.current = null
    }
  }, [])

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
  const enable = useCallback(async () => {
    if (!currentOrg) return
    try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
    setEnabled(true)
    if (!isLeader) { setStatus('follower'); return }
    await register(currentOrg.id, true)
  }, [currentOrg, isLeader, register])

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
    if (!isLeader) {
      teardown()
      setStatus('follower')
      return
    }
    // Mic was already granted when this browser opted in — don't re-prompt.
    register(currentOrg.id, false)
    return () => { teardown() }
  }, [user, currentOrg?.id, enabled, isLeader])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recovery: sleep, network changes, tab restore ─────────────────────────
  // The signalling WebSocket drops on sleep/Wi-Fi switches; the SDK reconnects in
  // many cases but not all, so nudge it whenever the tab comes back to life.
  useEffect(() => {
    if (!enabled || !isLeader) return
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
  }, [enabled, isLeader])

  return (
    <VoiceReceiverContext.Provider
      value={{ status, error, identity, incoming, enable, disable, clearIncoming }}
    >
      {children}
    </VoiceReceiverContext.Provider>
  )
}
