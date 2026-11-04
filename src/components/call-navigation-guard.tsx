'use client'

// While a call is live (outbound at any stage, or any inbound call ringing or
// connected), keeps navigation inside the Hub client-side so the call and its
// audio carry on, asks before anything that would leave, and warns on refresh or
// tab close. Renders nothing. Mounted once in the (dashboard) layout, inside both
// call providers. Rules and tests: src/lib/call-navigation-guard.ts.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useOutboundCall } from '@/lib/voice-outbound-context'
import { useVoiceReceiver } from '@/lib/voice-receiver-context'
import {
  setCallLive, decideAnchorClick, createBeforeUnloadGuard, confirmLeaveDuringCall,
} from '@/lib/call-navigation-guard'

export function CallNavigationGuard() {
  const router = useRouter()
  const { live: outboundLive } = useOutboundCall()
  const { calls } = useVoiceReceiver()
  const live = outboundLive || calls.length > 0
  const unloadGuard = useRef<ReturnType<typeof createBeforeUnloadGuard> | null>(null)

  useEffect(() => {
    setCallLive(live)
    if (!unloadGuard.current) unloadGuard.current = createBeforeUnloadGuard(window)
    unloadGuard.current.set(live)
  }, [live])

  // Off on unmount (sign-out, leaving the Hub layout).
  useEffect(() => () => { setCallLive(false); unloadGuard.current?.set(false) }, [])

  useEffect(() => {
    if (!live) return
    // Bubble phase on document: next/link has already handled (and prevented) its
    // own clicks by the time this runs, so only plain anchors reach the decision.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const d = decideAnchorClick({
        href: a.getAttribute('href') || '',
        origin: window.location.origin,
        target: a.getAttribute('target'),
        download: a.hasAttribute('download'),
        modified: e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      })
      if (d.kind === 'client') { e.preventDefault(); router.push(d.path) }
      else if (d.kind === 'leave' && !confirmLeaveDuringCall()) e.preventDefault()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [live, router])

  return null
}
