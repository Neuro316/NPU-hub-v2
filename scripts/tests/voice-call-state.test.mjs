// Unit tests for the softphone call list and ringer (src/lib/voice-call-state.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The property under test: a ringing call stops ringing ONLY on Answer, Decline,
// or the far side ending it. Taps anywhere else must never silence it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCallEvent, shouldRing, createRinger, isMicrophoneError,
  createOutboundCall, createOutboundStore, MIC_BLOCKED_MESSAGE,
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

// ── Outbound calls: End at every stage, ringback ─────────────────────────────

function fakeCall() {
  const handlers = {}
  const c = {
    disconnects: 0, status_: 'connecting', muted: null, digits: '',
    on(ev, fn) { (handlers[ev] ||= []).push(fn) },
    emit(ev, ...args) { for (const fn of handlers[ev] || []) fn(...args) },
    status() { return c.status_ },
    disconnect() { c.disconnects++; c.status_ = 'closed'; c.emit('disconnect') },
    mute(m) { c.muted = m },
    sendDigits(d) { c.digits += d },
  }
  return c
}

/** A controller wired to fakes. `quietDisconnect` = the SDK reports nothing on disconnect(). */
function harness({ mic = { ok: true }, prep, quietDisconnect = false } = {}) {
  const log = { stages: [], ended: [], server: [], remote: 0, ringback: [], timers: [] }
  const call = fakeCall()
  if (quietDisconnect) call.disconnect = () => { call.disconnects++ }
  let releaseConnect
  const connectGate = new Promise(r => { releaseConnect = r })
  const device = {
    destroyed: 0, disconnectAlls: 0, gated: false,
    async connect() { if (device.gated) await connectGate; return call },
    disconnectAll() { device.disconnectAlls++ },
    destroy() { device.destroyed++ },
  }
  let grantMic
  const micGate = mic === 'gated' ? new Promise(r => { grantMic = r }) : null
  const ctl = createOutboundCall({
    ensureMicrophone: () => micGate ?? Promise.resolve(mic),
    prepare: async () => prep ?? { ok: true, token: 't', params: { To: '+1' }, callLogId: 'log-1' },
    createDevice: () => device,
    onStage: s => log.stages.push(s),
    onEnded: info => log.ended.push(info),
    onRemoteAudio: () => { log.remote++ },
    ringback: { start: () => log.ringback.push('start'), stop: () => log.ringback.push('stop') },
    hangupOnServer: id => log.server.push(id),
    later: (fn, ms) => { log.timers.push({ fn, ms }) },
  })
  const runTimers = () => { for (const t of log.timers.splice(0)) t.fn() }
  return { ctl, call, device, log, runTimers, releaseConnect: () => releaseConnect(), grantMic: () => grantMic({ ok: true }) }
}

test('End while connected hangs up, backs up on the server, then goes idle', async () => {
  const h = harness()
  await h.ctl.start()
  h.call.emit('accept')
  assert.equal(h.ctl.stage, 'connected')
  h.ctl.hangUp()
  assert.equal(h.call.disconnects, 1)
  assert.ok(h.device.disconnectAlls >= 1)
  assert.deepEqual(h.log.server, ['log-1'])
  assert.equal(h.ctl.stage, 'idle')
  assert.deepEqual(h.log.ended, [{ error: null, wasConnected: true }])
  // The device is destroyed later, not in the same tick as the hangup.
  assert.equal(h.device.destroyed, 0)
  h.runTimers()
  assert.equal(h.device.destroyed, 1)
})

test('End while ringing hangs up a call that never connected', async () => {
  const h = harness()
  await h.ctl.start()
  h.call.emit('ringing', true)
  assert.equal(h.ctl.stage, 'ringing')
  h.ctl.hangUp()
  assert.equal(h.call.disconnects, 1)
  assert.deepEqual(h.log.server, ['log-1'])
  assert.deepEqual(h.log.ended, [{ error: null, wasConnected: false }])
})

test('End stays on "ending" until the SDK reports the call closed', async () => {
  const h = harness({ quietDisconnect: true })
  await h.ctl.start()
  h.call.emit('accept')
  h.ctl.hangUp()
  assert.equal(h.ctl.stage, 'ending')
  assert.equal(h.log.ended.length, 0)
  h.call.emit('disconnect')
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.log.ended.length, 1)
})

test('End with no disconnect event still finishes after the timeout', async () => {
  const h = harness({ quietDisconnect: true })
  await h.ctl.start()
  h.ctl.hangUp()
  assert.equal(h.ctl.stage, 'ending')
  h.runTimers()
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.log.ended.length, 1)
})

test('pressing End again while ending finishes at once', async () => {
  const h = harness({ quietDisconnect: true })
  await h.ctl.start()
  h.ctl.hangUp()
  h.ctl.hangUp()
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.log.ended.length, 1)
})

test('End while dialing (waiting on the mic) never places the call', async () => {
  const h = harness({ mic: 'gated' })
  const started = h.ctl.start()
  assert.equal(h.ctl.stage, 'dialing')
  h.ctl.hangUp()
  assert.equal(h.ctl.stage, 'idle')
  h.grantMic()
  await started
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.call.disconnects, 0)
  assert.equal(h.log.ended.length, 1)
})

test('End while connect() is in flight hangs up the call when it arrives', async () => {
  const h = harness()
  h.device.gated = true
  const started = h.ctl.start()
  await flush(); await flush()
  assert.equal(h.ctl.stage, 'dialing')
  h.ctl.hangUp()
  assert.equal(h.ctl.stage, 'idle')
  h.releaseConnect()
  await started
  assert.equal(h.call.disconnects, 1, 'the late call is hung up')
  assert.deepEqual(h.log.server, ['log-1'])
  assert.equal(h.ctl.call, null)
  // A late event from that call cannot bring the screen back.
  h.call.emit('accept')
  assert.equal(h.ctl.stage, 'idle')
})

test('the far side hanging up ends the call', async () => {
  const h = harness()
  await h.ctl.start()
  h.call.emit('accept')
  h.call.emit('disconnect')
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.log.server.length, 0, 'no server hangup when nobody pressed End')
})

test('a call error ends the call with a message', async () => {
  const h = harness()
  await h.ctl.start()
  h.call.emit('error', { code: 31401 })
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.log.ended[0].error, MIC_BLOCKED_MESSAGE)
})

test('a blocked mic or a failed token ends before dialing', async () => {
  const a = harness({ mic: { ok: false, message: 'mic' } })
  await a.ctl.start()
  assert.equal(a.log.ended[0].error, 'mic')
  const b = harness({ prep: { ok: false, message: 'no token' } })
  await b.ctl.start()
  assert.equal(b.log.ended[0].error, 'no token')
  assert.equal(b.device.destroyed + b.device.disconnectAlls, 0)
})

test('local ringback plays from the Call tap until the network sends early media', async () => {
  const h = harness()
  await h.ctl.start()
  assert.deepEqual(h.log.ringback, ['start'])
  h.call.emit('ringing', true)
  assert.deepEqual(h.log.ringback, ['start', 'stop'])
  assert.equal(h.log.remote, 1, 'remote audio starts at ringing, for early media')
})

test('with no early media, local ringback plays until answer', async () => {
  const h = harness()
  await h.ctl.start()
  h.call.emit('ringing', false)
  assert.deepEqual(h.log.ringback, ['start'])
  h.call.emit('accept')
  assert.deepEqual(h.log.ringback, ['start', 'stop'])
  assert.equal(h.log.remote, 1)
})

test('ringback stops on End and on a failed call', async () => {
  const h = harness()
  await h.ctl.start()
  h.ctl.hangUp()
  assert.equal(h.log.ringback.at(-1), 'stop')
  const e = harness()
  await e.ctl.start()
  e.call.emit('error', { message: 'x' })
  assert.equal(e.log.ringback.at(-1), 'stop')
})

test('mute and keypad act on the live call only while connected', async () => {
  const h = harness()
  await h.ctl.start()
  assert.equal(h.ctl.mute(true), false)
  h.call.emit('accept')
  assert.equal(h.ctl.mute(true), true)
  assert.equal(h.call.muted, true)
  h.ctl.sendDigits('5')
  assert.equal(h.call.digits, '5')
})

test('dispose ends a live call', async () => {
  const h = harness({ quietDisconnect: true })
  await h.ctl.start()
  h.ctl.dispose()
  assert.equal(h.ctl.stage, 'idle')
  assert.equal(h.call.disconnects, 1)
})

test('shouldRing: a call ringing over a live outbound call is silent', () => {
  const calls = [call('A')]
  assert.equal(shouldRing(calls, false), true)
  assert.equal(shouldRing(calls, true), false)
})

// ── App-level outbound store (OutboundCallProvider) ──────────────────────────

/** A store whose every call gets fresh fakes; `calls` lists them in order. */
function storeHarness({ gateMic = false } = {}) {
  const made = []
  let clock = 1000
  const store = createOutboundStore((target) => {
    const call = fakeCall()
    const device = {
      destroyed: 0, disconnectAlls: 0,
      async connect() { return call },
      disconnectAll() { device.disconnectAlls++ },
      destroy() { device.destroyed++ },
    }
    let grant
    const mic = gateMic ? new Promise(r => { grant = r }) : Promise.resolve({ ok: true })
    const rec = { target, call, device, server: [], timers: [], grant: () => grant({ ok: true }) }
    made.push(rec)
    return {
      ensureMicrophone: () => mic,
      prepare: async () => ({ ok: true, token: 't', params: { To: target.phone }, callLogId: `log-${made.length}` }),
      createDevice: () => device,
      onRemoteAudio: () => {},
      ringback: { start() {}, stop() {} },
      hangupOnServer: id => rec.server.push(id),
      later: (fn) => { rec.timers.push(fn) },
    }
  }, () => clock)
  return { store, made, tick: (ms) => { clock += ms } }
}

const target = (id) => ({ contactId: id, name: `Contact ${id}`, phone: '+15555550100' })

test('store: a call survives a route change (every subscriber unmounting)', async () => {
  const { store, made } = storeHarness()
  // The Dialer page subscribes and places a call.
  const dialerSeen = []
  const unsubDialer = store.subscribe(() => dialerSeen.push(store.getSnapshot().stage))
  const res = store.place(target('A'))
  assert.equal(res.ok, true)
  await flush(); await flush()
  made[0].call.emit('accept')
  assert.equal(store.getSnapshot().stage, 'connected')
  // Navigate away: the Dialer unmounts.
  unsubDialer()
  assert.equal(made[0].call.disconnects, 0, 'unmounting a page never hangs up')
  assert.equal(store.getSnapshot().stage, 'connected')
  // Another page mounts and sees the same live call.
  let seen = null
  const unsubOther = store.subscribe(() => { seen = store.getSnapshot() })
  assert.equal(store.getSnapshot().session, res.session)
  assert.equal(store.getSnapshot().target.contactId, 'A')
  // End from the new page.
  store.hangUp()
  assert.equal(made[0].call.disconnects, 1)
  assert.equal(seen.stage, 'idle')
  assert.equal(seen.ended.session, res.session)
  assert.equal(seen.ended.wasConnected, true)
  unsubOther()
})

test('store: only one live call at a time', async () => {
  const { store, made } = storeHarness()
  const first = store.place(target('A'))
  assert.equal(first.ok, true)
  const second = store.place(target('B'))
  assert.deepEqual(second, { ok: false, reason: 'busy' })
  assert.equal(made.length, 1, 'the second call was never set up')
  await flush(); await flush()
  made[0].call.emit('accept')
  assert.deepEqual(store.place(target('B')), { ok: false, reason: 'busy' })
  // Once the first call is gone, a new one can be placed.
  made[0].call.emit('disconnect')
  const third = store.place(target('B'))
  assert.equal(third.ok, true)
  assert.equal(third.session, first.session + 1)
})

test('store: End while dialing never places the call', async () => {
  const { store, made } = storeHarness({ gateMic: true })
  store.place(target('A'))
  assert.equal(store.getSnapshot().stage, 'dialing')
  store.hangUp()
  assert.equal(store.getSnapshot().stage, 'idle')
  made[0].grant()
  await flush(); await flush()
  assert.equal(made[0].call.disconnects, 0)
  assert.equal(store.getSnapshot().stage, 'idle')
})

test('store: End while ringing and while connected hangs up with the server backstop', async () => {
  for (const answered of [false, true]) {
    const { store, made } = storeHarness()
    store.place(target('A'))
    await flush(); await flush()
    assert.equal(store.getSnapshot().stage, 'ringing')
    if (answered) made[0].call.emit('accept')
    store.hangUp()
    assert.equal(made[0].call.disconnects, 1)
    assert.deepEqual(made[0].server, ['log-1'])
    assert.equal(store.getSnapshot().stage, 'idle')
    assert.equal(store.getSnapshot().ended.wasConnected, answered)
  }
})

test('store: connect time, mute and a failed call are reported in the snapshot', async () => {
  const { store, made, tick } = storeHarness()
  store.place(target('A'))
  await flush(); await flush()
  tick(5000)
  made[0].call.emit('accept')
  assert.equal(store.getSnapshot().connectedAt, 6000)
  store.setMuted(true)
  assert.equal(store.getSnapshot().muted, true)
  assert.equal(made[0].call.muted, true)
  made[0].call.emit('error', { message: 'Network lost' })
  const snap = store.getSnapshot()
  assert.equal(snap.stage, 'idle')
  assert.equal(snap.muted, false)
  assert.equal(snap.ended.error, 'Network lost')
})

test('store: a late event from an ended call cannot touch the next call', async () => {
  const { store, made } = storeHarness()
  store.place(target('A'))
  await flush(); await flush()
  store.hangUp()
  store.place(target('B'))
  await flush(); await flush()
  made[0].call.emit('accept')
  made[0].call.emit('disconnect')
  assert.equal(store.getSnapshot().stage, 'ringing')
  assert.equal(store.getSnapshot().target.contactId, 'B')
})
