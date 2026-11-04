'use client'

// Keeps a live call up when part of the Hub crashes.
//
// The call providers (OutboundCallProvider, VoiceReceiverProvider) sit in the
// dashboard layout. A render error anywhere below them with no boundary in the
// way unmounts the whole tree, and unmounting OutboundCallProvider ends the call
// (its dispose). These boundaries sit just inside the providers, so a crash in a
// page, the sidebar, the Guide panel or the call UI itself replaces only that
// part and the call carries on. When the call UI is the part that crashed, the
// fallback still offers Hang up.

import { Component, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { PhoneOff } from 'lucide-react'
import { useOutboundCall } from '@/lib/voice-outbound-context'

interface BoundaryProps {
  area: string
  /** A change of this value clears the error (the route, for page content). */
  resetKey?: string | null
  fallback: (reset: () => void) => ReactNode
  children: ReactNode
}

class Boundary extends Component<BoundaryProps, { failed: boolean; key?: string | null }> {
  state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; key?: string | null }) {
    if (props.resetKey !== state.key) return { failed: false, key: props.resetKey }
    return null
  }

  componentDidCatch(error: unknown) {
    console.error(`[call-safe-boundary] ${this.props.area} crashed; any live call stays connected.`, error)
  }

  render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }))
    return this.props.children
  }
}

/** Page content (sidebar and page). Clears on navigation. */
export function ContentBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <Boundary area="content" resetKey={pathname} fallback={reset => <ContentFallback onRetry={reset} />}>
      {children}
    </Boundary>
  )
}

/** The call UI and everything else inside the providers. */
export function CallUiBoundary({ area, children }: { area: string; children: ReactNode }) {
  return (
    <Boundary area={area} fallback={() => <CallFallbackControls />}>
      {children}
    </Boundary>
  )
}

function ContentFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-np-light flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-np-dark">This page hit an error.</p>
        <p className="mt-1 text-xs text-gray-500">Any call you are on is still connected.</p>
        <button type="button" onClick={onRetry}
          className="mt-4 rounded-lg bg-np-blue px-4 py-2 text-xs font-semibold text-white hover:bg-np-dark">
          Try again
        </button>
      </div>
    </div>
  )
}

/** Minimal live-call controls for when the regular call UI is gone. */
export function CallFallbackControls() {
  const { live, snapshot, hangUp } = useOutboundCall()
  if (!live) return null
  const who = snapshot.target?.name || snapshot.target?.phone || 'Call'
  return (
    <div className="fixed right-3 top-2 z-[2200] flex items-center gap-2 rounded-full bg-np-dark py-1 pl-3 pr-1 text-xs font-semibold text-white shadow-lg">
      <span className="max-w-[40vw] truncate">On call: {who}</span>
      <button type="button" onClick={() => hangUp('call_controls')}
        className="flex items-center gap-1 rounded-full bg-red-500 px-3 py-1.5 hover:bg-red-600">
        <PhoneOff size={12} /> Hang up
      </button>
    </div>
  )
}
