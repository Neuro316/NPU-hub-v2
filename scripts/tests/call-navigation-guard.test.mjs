// Unit tests for the call navigation guard (src/lib/call-navigation-guard.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: while a call is live, a Hub link is navigated
// client-side (the call providers stay mounted), anything that would leave the Hub
// layout asks first, and the refresh / close-tab warning is set only while a call
// is live.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DASHBOARD_SEGMENTS, decideAnchorClick, isDashboardPath, createBeforeUnloadGuard,
  setCallLive, confirmLeaveDuringCall, LEAVE_ON_CALL_MESSAGE,
} from '../../src/lib/call-navigation-guard.ts'

const ORIGIN = 'https://hub.neuroprogeny.com'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('DASHBOARD_SEGMENTS lists every page folder of the (dashboard) layout', () => {
  const dir = path.join(root, 'src', 'app', '(dashboard)')
  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('_'))
    .map(d => d.name).sort()
  assert.deepEqual([...DASHBOARD_SEGMENTS].sort(), folders)
})

test('a contact card link is navigated client-side, query and hash kept', () => {
  assert.deepEqual(decideAnchorClick({ href: '/crm/contacts?open=abc#notes', origin: ORIGIN }),
    { kind: 'client', path: '/crm/contacts?open=abc#notes' })
  assert.deepEqual(decideAnchorClick({ href: `${ORIGIN}/crm/pipelines`, origin: ORIGIN }),
    { kind: 'client', path: '/crm/pipelines' })
  assert.equal(isDashboardPath('/'), true)
})

test('a Hub page meant for a new tab opens in this tab during a call', () => {
  assert.deepEqual(decideAnchorClick({ href: '/guest-sheet/1', origin: ORIGIN, target: '_blank' }),
    { kind: 'client', path: '/guest-sheet/1' })
})

test('leaving the Hub layout in this tab asks first; in a new tab it is harmless', () => {
  assert.deepEqual(decideAnchorClick({ href: '/policies', origin: ORIGIN }), { kind: 'leave' })
  assert.deepEqual(decideAnchorClick({ href: '/login', origin: ORIGIN }), { kind: 'leave' })
  assert.deepEqual(decideAnchorClick({ href: '/p/landing', origin: ORIGIN, target: '_blank' }), { kind: 'ignore' })
})

test('other sites, downloads, API files and modified clicks are left to the browser', () => {
  assert.equal(decideAnchorClick({ href: 'https://www.linkedin.com/in/x', origin: ORIGIN, target: '_blank' }).kind, 'ignore')
  assert.equal(decideAnchorClick({ href: '/api/backup', origin: ORIGIN }).kind, 'ignore')
  assert.equal(decideAnchorClick({ href: '/crm/contacts', origin: ORIGIN, download: true }).kind, 'ignore')
  assert.equal(decideAnchorClick({ href: '/crm/contacts', origin: ORIGIN, modified: true }).kind, 'ignore')
})

function fakeWindow() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]) },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn)) },
    count(type) { return (listeners.get(type) || []).length },
  }
}

test('beforeunload is set only while a call is live', () => {
  const w = fakeWindow()
  const guard = createBeforeUnloadGuard(w)
  assert.equal(w.count('beforeunload'), 0, 'nothing before a call')
  guard.set(true)
  assert.equal(w.count('beforeunload'), 1, 'set when the call goes live')
  guard.set(true)
  assert.equal(w.count('beforeunload'), 1, 'never twice')
  const e = { prevented: false, preventDefault() { this.prevented = true }, returnValue: undefined }
  w.listeners.get('beforeunload')[0](e)
  assert.equal(e.prevented, true)
  assert.equal(e.returnValue, LEAVE_ON_CALL_MESSAGE)
  guard.set(false)
  assert.equal(w.count('beforeunload'), 0, 'removed when the call ends')
  assert.equal(guard.active, false)
})

test('leaving asks only during a call', () => {
  let asked = 0
  const confirmNo = () => { asked++; return false }
  setCallLive(false)
  assert.equal(confirmLeaveDuringCall(confirmNo), true)
  assert.equal(asked, 0)
  setCallLive(true)
  assert.equal(confirmLeaveDuringCall(confirmNo), false)
  assert.equal(confirmLeaveDuringCall(() => true), true)
  assert.equal(asked, 1)
  setCallLive(false)
})

// ── Structure: what keeps a Dialer call alive across CRM navigation ─────────
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

test('every CRM tab and sidebar page link is a client-side next/link', () => {
  const crm = read('src', 'app', '(dashboard)', 'crm', 'layout.tsx')
  assert.match(crm, /import Link from 'next\/link'/)
  const tabs = [...crm.matchAll(/\{ href: '([^']+)', label: '([^']+)'/g)].map(m => m[2])
  assert.deepEqual(tabs, ['Dashboard', 'Contacts', 'Duplicates', 'Pipelines', 'Network', 'Conversations',
    'Dialer', 'Campaigns', 'Sequences', 'Tasks', 'Import', 'Analytics', 'Settings'])
  assert.match(crm, /<Link\s+key=\{item\.href\}\s+href=\{item\.href\}/, 'tabs render as <Link>')
  assert.doesNotMatch(crm, /<a\s|window\.location|location\.href/, 'no full-page navigation in the tab bar')
  const sidebar = read('src', 'components', 'sidebar.tsx')
  // Internal sidebar items are <Link>; the only plain <a> items are external links (new tab).
  for (const m of sidebar.matchAll(/<a\b[^>]*>/g)) assert.match(m[0], /target="_blank"/, `plain sidebar link: ${m[0]}`)
})

test('the call providers sit above the page and call UI error boundaries', () => {
  const layout = read('src', 'app', '(dashboard)', 'layout.tsx')
  const at = (s) => { const i = layout.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i }
  const provider = at('<OutboundCallProvider>')
  assert.ok(provider < at('<VoiceReceiverProvider>'))
  assert.ok(at('<VoiceReceiverProvider>') < at('<CallUiBoundary area="shell">'))
  assert.ok(at('<CallUiBoundary area="shell">') < at('<ContentBoundary>'))
  assert.ok(at('<ContentBoundary>') < at('<DashboardContent>'))
  assert.ok(at('<CallUiBoundary area="call-ui">') < at('<IncomingCallBanner />'))
  // A page crash is caught inside the layout, so the providers stay mounted.
  assert.ok(fs.existsSync(path.join(root, 'src', 'app', '(dashboard)', 'error.tsx')))
})

test('Dialer, Conversations, contacts and Pipelines never hang up on unmount', () => {
  const files = [
    ['src', 'app', '(dashboard)', 'crm', 'dialer', 'page.tsx'],
    ['src', 'app', '(dashboard)', 'crm', 'conversations', 'page.tsx'],
    ['src', 'app', '(dashboard)', 'crm', 'contacts', 'page.tsx'],
    ['src', 'app', '(dashboard)', 'crm', 'pipelines', 'page.tsx'],
    ['src', 'components', 'crm', 'contact-detail.tsx'],
    ['src', 'components', 'crm', 'twilio-comms.tsx'],
  ]
  for (const f of files) {
    const src = read(...f)
    // No Twilio Device of their own: the call belongs to OutboundCallProvider.
    assert.doesNotMatch(src, /new Device\(|\.destroy\(\)|disconnectAll/, f.join('/'))
    // Every hangUp is a named End control, never an effect cleanup.
    for (const m of src.matchAll(/hangUp\(([^)]*)\)/g)) {
      assert.match(m[1], /^'(dialer_end|call_panel)'$/, `${f.join('/')}: hangUp(${m[1]})`)
    }
    assert.doesNotMatch(src, /return \(\) => \{?[^\n]*hangUp/, `${f.join('/')}: hangUp in a cleanup`)
  }
})
