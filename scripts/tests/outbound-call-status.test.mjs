// Unit tests for outbound call status (src/lib/outbound-call-status.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The property under test: an outbound call log leaves 'ringing' through the call
// lifecycle, ends with a status the table allows, a duration and an end time, and
// the second callback for the same call never undoes or double counts the first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapTwilioCallStatus, parseOutboundStatusEvent, outboundCallUpdate,
} from '../../src/lib/outbound-call-status.ts'

const PARENT = 'CA' + 'p'.repeat(32)
const CHILD = 'CA' + 'c'.repeat(32)
const NOW = '2026-10-31T13:00:00.000Z'
const ALLOWED = new Set(['ringing', 'in_progress', 'completed', 'missed', 'voicemail', 'failed'])

const childEvent = (CallStatus, extra = {}) => ({ CallSid: CHILD, ParentCallSid: PARENT, CallStatus, ...extra })
const dialAction = (DialCallStatus, extra = {}) => ({ CallSid: PARENT, CallStatus: 'in-progress', DialCallSid: CHILD, DialCallStatus, ...extra })

test('every mapped status is one call_logs_status_check allows', () => {
  for (const s of ['queued', 'initiated', 'ringing', 'in-progress', 'answered', 'completed', 'busy', 'no-answer', 'failed', 'canceled']) {
    const m = mapTwilioCallStatus(s)
    if (m !== null) assert.ok(ALLOWED.has(m), `${s} -> ${m}`)
  }
  assert.equal(mapTwilioCallStatus('in-progress'), 'in_progress')
})

test('the child leg is tied to the row by ParentCallSid, the dial action by CallSid', () => {
  assert.equal(parseOutboundStatusEvent(childEvent('completed', { CallDuration: '42' })).parentCallSid, PARENT)
  assert.equal(parseOutboundStatusEvent(dialAction('completed', { DialCallDuration: '42' })).parentCallSid, PARENT)
  assert.equal(parseOutboundStatusEvent({ CallSid: CHILD, CallStatus: 'completed' }), null)
})

test('answered moves ringing to in_progress', () => {
  const ev = parseOutboundStatusEvent(childEvent('in-progress'))
  assert.deepEqual(outboundCallUpdate({ status: 'ringing', duration_seconds: 0 }, ev, NOW),
    { updates: { status: 'in_progress' }, becameFinal: false })
})

test('a completed call gets its duration and end time', () => {
  const ev = parseOutboundStatusEvent(childEvent('completed', { CallDuration: '95' }))
  assert.deepEqual(outboundCallUpdate({ status: 'in_progress', duration_seconds: 0 }, ev, NOW),
    { updates: { status: 'completed', duration_seconds: 95, ended_at: NOW }, becameFinal: true })
})

test('a completed call closes straight from ringing too (answered event lost)', () => {
  const ev = parseOutboundStatusEvent(dialAction('completed', { DialCallDuration: '12' }))
  const r = outboundCallUpdate({ status: 'ringing', duration_seconds: 0 }, ev, NOW)
  assert.equal(r.updates.status, 'completed')
  assert.equal(r.updates.duration_seconds, 12)
})

test('no answer, busy, failed and canceled end as failed with 0 seconds', () => {
  for (const s of ['no-answer', 'busy', 'failed', 'canceled']) {
    const r = outboundCallUpdate({ status: 'ringing', duration_seconds: 0 }, parseOutboundStatusEvent(childEvent(s)), NOW)
    assert.deepEqual(r, { updates: { status: 'failed', duration_seconds: 0, ended_at: NOW }, becameFinal: true }, s)
  }
})

test('the second callback for a finished call does not reopen it or count twice', () => {
  const closed = { status: 'completed', duration_seconds: 95 }
  assert.equal(outboundCallUpdate(closed, parseOutboundStatusEvent(dialAction('completed', { DialCallDuration: '95' })), NOW), null)
  assert.equal(outboundCallUpdate(closed, parseOutboundStatusEvent(childEvent('in-progress')), NOW), null)
  assert.equal(outboundCallUpdate(closed, parseOutboundStatusEvent(childEvent('no-answer')), NOW), null)
})

test('a longer duration from the later callback is kept, without closing it again', () => {
  const r = outboundCallUpdate({ status: 'completed', duration_seconds: 94 }, parseOutboundStatusEvent(childEvent('completed', { CallDuration: '96' })), NOW)
  assert.deepEqual(r, { updates: { duration_seconds: 96 }, becameFinal: false })
})

test('ringing events and voicemail rows are left alone', () => {
  assert.equal(outboundCallUpdate({ status: 'ringing', duration_seconds: 0 }, parseOutboundStatusEvent(childEvent('ringing')), NOW), null)
  assert.equal(outboundCallUpdate({ status: 'voicemail', duration_seconds: 8 }, parseOutboundStatusEvent(childEvent('completed', { CallDuration: '8' })), NOW), null)
})
