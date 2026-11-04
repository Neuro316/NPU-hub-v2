// src/lib/call-navigation-guard.ts
// Keeps a live call alive while the user moves around the Hub.
//
// The call lives in OutboundCallProvider / VoiceReceiverProvider, which sit in
// src/app/(dashboard)/layout.tsx. They survive any CLIENT-SIDE navigation between
// pages of that layout group. Three things end a call instead:
//   1. a full page load (a plain <a href>, window.location, a refresh, closing the tab)
//   2. client-side navigation OUT of the (dashboard) group (/login, /policies, /p/...),
//      which unmounts the layout and with it the providers
//   3. nothing else; a Hub page opened in a new tab leaves this tab's call alone,
//      but during a call we keep the user in this tab anyway (openHubPage)
//
// CallNavigationGuard (src/components/call-navigation-guard.tsx) uses this module
// to turn same-tab anchor clicks into client-side navigation while a call is live,
// to ask before anything that must leave, and to set a beforeunload warning.
//
// No relative imports: scripts/tests/call-navigation-guard.test.mjs loads this
// file directly under node's type stripping.

export const LEAVE_ON_CALL_MESSAGE = 'You are on a call. Leaving this page will end it.'

/**
 * Top-level route segments of src/app/(dashboard). Navigating between these keeps
 * the call. The test compares this list with the folder, so a new page fails the
 * test until it is added here.
 */
export const DASHBOARD_SEGMENTS = [
  'activity-log', 'advisory', 'analytics', 'auditor', 'calendar', 'campaigns', 'crm', 'ehr',
  'equipment', 'finance', 'financial', 'flowcharts', 'forms', 'guest-sheet', 'icps', 'ideas',
  'integrations', 'journeys', 'library', 'media', 'media-affiliates', 'media-appearances',
  'meetings', 'platform-advisor', 'rocks', 'settings', 'shipit', 'social', 'sops', 'tasks',
  'team', 'tickets', 'university-access', 'usage-analytics',
] as const
const DASHBOARD = new Set<string>(DASHBOARD_SEGMENTS)

// ── Live flag, readable outside React (window.location call sites) ───────────

let callLive = false
export function setCallLive(live: boolean) { callLive = live }
export function isCallLive() { return callLive }

/** True when it is fine to leave: no live call, or the user confirmed. */
export function confirmLeaveDuringCall(confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): boolean {
  return !callLive || confirmFn(LEAVE_ON_CALL_MESSAGE)
}

/**
 * Open a Hub page. Normally a new tab, as before; during a call the page opens in
 * this tab through the client router instead, so the user stays with the call.
 */
export function openHubPage(path: string, navigate: (path: string) => void) {
  if (callLive) navigate(path)
  else window.open(path, '_blank')
}

// ── Anchor clicks ────────────────────────────────────────────────────────────

export type AnchorDecision =
  | { kind: 'ignore' }                    // not ours to handle: let the browser do it
  | { kind: 'client'; path: string }      // a Hub page: navigate client-side, call kept
  | { kind: 'leave' }                     // leaves the Hub layout: confirm first

/** Is this pathname inside the (dashboard) layout group? */
export function isDashboardPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true
  const first = pathname.replace(/^\/+/, '').split('/')[0]
  return DASHBOARD.has(first)
}

/**
 * What to do with a click on an anchor while a call is live.
 * `modified` is a ctrl / meta / shift / middle click: the user asked for a new
 * tab or window, which does not touch this tab's call, so it is left alone.
 */
export function decideAnchorClick(a: {
  href: string
  origin: string
  target?: string | null
  download?: boolean
  modified?: boolean
}): AnchorDecision {
  if (a.modified || a.download) return { kind: 'ignore' }
  let url: URL
  try { url = new URL(a.href, a.origin) } catch { return { kind: 'ignore' } }
  if (url.origin !== a.origin) return { kind: 'ignore' }              // another site
  if (url.pathname.startsWith('/api/')) return { kind: 'ignore' }     // a download or file
  const path = url.pathname + url.search + url.hash
  if (isDashboardPath(url.pathname)) return { kind: 'client', path }  // also turns a new-tab Hub link into this tab
  // Same site, outside the Hub layout (login, policies, public pages). In a new
  // tab that is harmless; in this tab it ends the call.
  const newTab = !!a.target && a.target !== '_self'
  return newTab ? { kind: 'ignore' } : { kind: 'leave' }
}

// ── beforeunload ─────────────────────────────────────────────────────────────

interface EventTargetLike {
  addEventListener(type: string, fn: (e: any) => any): void
  removeEventListener(type: string, fn: (e: any) => any): void
}

/** Adds the refresh / close-tab warning while a call is live, and removes it after. */
export function createBeforeUnloadGuard(target: EventTargetLike) {
  let active = false
  const handler = (e: any) => {
    e.preventDefault()
    // Browsers show their own wording; returnValue is what makes them ask.
    e.returnValue = LEAVE_ON_CALL_MESSAGE
    return LEAVE_ON_CALL_MESSAGE
  }
  return {
    set(live: boolean) {
      if (live && !active) { target.addEventListener('beforeunload', handler); active = true }
      else if (!live && active) { target.removeEventListener('beforeunload', handler); active = false }
    },
    get active() { return active },
  }
}
