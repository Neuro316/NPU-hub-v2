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
