// Unit tests for the softphone call list and ringer (src/lib/voice-call-state.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The property under test: a ringing call stops ringing ONLY on Answer, Decline,
// or the far side ending it. Taps anywhere else must never silence it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCallEvent, shouldRing, createRinger, isMicrophoneError,
} from '../../src/lib/voice-call-state.ts'

const call = (id, phase = 'ringing') => ({ id, phase, connectedAt: null, muted: false })

/** A fake HTMLAudioElement. `blockPlay` simulates a browser autoplay refusal. */
function fakeAudio({ blockPlay = false } = {}) {
  const a = {
    loop: false, muted: false, paused: true, currentTime: 0,
    plays: 0, pauses: 0, blockPlay,
    play() {
      a.plays++
      if (a.blockPlay) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
      a.paused = false
      return Promise.resolve()
    },
    pause() { a.pauses++; a.paused = true },
  }
  return a
}
const flush = () => new Promise(r => setTimeout(r, 0))

// ── Call list ────────────────────────────────────────────────────────────────

test('an incoming call rings', () => {
  const calls = applyCallEvent([], { type: 'incoming', entry: call('A') })
  assert.equal(shouldRing(calls), true)
})

test('answering stops ringing', () => {
  let calls = applyCallEvent([], { type: 'incoming', entry: call('A') })
  calls = applyCallEvent(calls, { type: 'accepted', id: 'A', at: 1 })
  assert.equal(calls[0].phase, 'connected')
  assert.equal(calls[0].connectedAt, 1)
  assert.equal(shouldRing(calls), false)
})

test('declining or a remote cancel stops ringing and removes the call', () => {
  for (const id of ['A']) {
    let calls = applyCallEvent([], { type: 'incoming', entry: call(id) })
    calls = applyCallEvent(calls, { type: 'ended', id })
    assert.deepEqual(calls, [])
    assert.equal(shouldRing(calls), false)
  }
})

test('ending a different call does not stop this one ringing', () => {
  let calls = applyCallEvent([], { type: 'incoming', entry: call('A') })
  calls = applyCallEvent(calls, { type: 'incoming', entry: call('B') })
  calls = applyCallEvent(calls, { type: 'ended', id: 'B' })
  assert.deepEqual(calls.map(c => c.id), ['A'])
  assert.equal(shouldRing(calls), true)
})

test('a second call keeps the first one, newest first', () => {
  let calls = applyCallEvent([], { type: 'incoming', entry: call('A') })
  calls = applyCallEvent(calls, { type: 'incoming', entry: call('B') })
  assert.deepEqual(calls.map(c => c.id), ['B', 'A'])
})

test('a call ringing over a connected call is shown but silent, and rings once that call ends', () => {
  let calls = [call('A', 'connected')]
  calls = applyCallEvent(calls, { type: 'incoming', entry: call('B') })
  assert.equal(shouldRing(calls), false)
  calls = applyCallEvent(calls, { type: 'ended', id: 'A' })
  assert.equal(shouldRing(calls), true)
})

test('mute changes only the mute flag', () => {
  let calls = [call('A', 'connected')]
  calls = applyCallEvent(calls, { type: 'muted', id: 'A', muted: true })
  assert.equal(calls[0].muted, true)
  assert.equal(calls[0].phase, 'connected')
})

test('a late duplicate accept keeps the first connect time', () => {
  let calls = applyCallEvent([call('A')], { type: 'accepted', id: 'A', at: 5 })
  calls = applyCallEvent(calls, { type: 'accepted', id: 'A', at: 9 })
  assert.equal(calls[0].connectedAt, 5)
})

// ── Ringer ───────────────────────────────────────────────────────────────────

test('ringer plays on ring and stops on sync(false)', async () => {
  const a = fakeAudio()
  const r = createRinger(() => a)
  r.sync(true)
  await flush()
  assert.equal(a.paused, false)
  assert.equal(a.loop, true)
  assert.equal(a.muted, false)
  r.sync(false)
  assert.equal(a.paused, true)
  assert.equal(r.ringing, false)
})

test('taps while ringing never pause or mute the ringer', async () => {
  const a = fakeAudio()
  const r = createRinger(() => a)
  r.sync(true)
  await flush()
  for (let i = 0; i < 10; i++) r.onUserGesture()
  await flush()
  assert.equal(a.paused, false)
  assert.equal(a.muted, false)
  assert.equal(a.pauses, 0)
  assert.equal(r.ringing, true)
})

test('a tap restarts a ringer the browser blocked or paused', async () => {
  const a = fakeAudio({ blockPlay: true })
  const r = createRinger(() => a)
  r.sync(true)
  await flush()
  assert.equal(a.paused, true, 'autoplay blocked: no sound yet')
  assert.equal(r.unlocked, false)
  a.blockPlay = false // a tap is a user gesture
  r.onUserGesture()
  await flush()
  assert.equal(a.paused, false)
  assert.equal(r.unlocked, true)
  // iOS interrupts playback (e.g. audio session change): the next tap resumes it.
  a.pause()
  r.onUserGesture()
  await flush()
  assert.equal(a.paused, false)
})

test('a tap while idle unlocks silently and leaves the ringer stopped', async () => {
  const a = fakeAudio()
  const r = createRinger(() => a)
  r.onUserGesture()
  await flush()
  assert.equal(r.unlocked, true)
  assert.equal(a.paused, true)
  assert.equal(r.ringing, false)
  // After unlock, a call rings with sound.
  r.sync(true)
  await flush()
  assert.equal(a.paused, false)
  assert.equal(a.muted, false)
})

test('a call arriving during the idle unlock still rings', async () => {
  const a = fakeAudio()
  const r = createRinger(() => a)
  r.onUserGesture() // unlock in flight
  r.sync(true)      // call arrives before the unlock promise settles
  await flush()
  assert.equal(a.paused, false)
  assert.equal(a.muted, false)
})

test('the ringer survives a missing Audio implementation', () => {
  const r = createRinger(() => null)
  r.sync(true)
  r.onUserGesture()
  r.sync(false)
  assert.equal(r.ringing, false)
})

// ── Errors ───────────────────────────────────────────────────────────────────

test('microphone errors are recognized', () => {
  assert.equal(isMicrophoneError({ code: 31401 }), true)
  assert.equal(isMicrophoneError({ code: 31208 }), true)
  assert.equal(isMicrophoneError({ name: 'NotAllowedError' }), true)
  assert.equal(isMicrophoneError({ originalError: { name: 'NotAllowedError' } }), true)
  assert.equal(isMicrophoneError({ code: 31005 }), false)
  assert.equal(isMicrophoneError(null), false)
})
