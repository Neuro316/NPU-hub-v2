// Unit tests for recording playback through the Hub proxy (src/lib/recording-media.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: the proxy asks Twilio for a mono MP3 of any
// recording, and answers a browser's byte-range requests the way <audio> needs
// (206 with Content-Range, 416 past the end, long ranges shortened).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playbackMediaUrl, parseByteRange, planRangeResponse, MAX_RANGE_BYTES } from '../../src/lib/recording-media.ts'

const BASE = 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1'

test('playback asks Twilio for a mono MP3 of any stored recording URL', () => {
  assert.equal(playbackMediaUrl(BASE), `${BASE}.mp3?RequestedChannels=1`)
  assert.equal(playbackMediaUrl(`${BASE}.mp3`), `${BASE}.mp3?RequestedChannels=1`)
  assert.equal(playbackMediaUrl(`${BASE}.wav`), `${BASE}.wav?RequestedChannels=1`)
  assert.equal(playbackMediaUrl(`${BASE}.mp3?RequestedChannels=2`), `${BASE}.mp3?RequestedChannels=1`)
})

test('byte ranges: open-ended, closed, suffix, past the end, malformed', () => {
  assert.deepEqual(parseByteRange('bytes=0-', 1000), { start: 0, end: 999 })
  assert.deepEqual(parseByteRange('bytes=0-1', 1000), { start: 0, end: 1 })
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { start: 900, end: 999 })
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 })
  assert.equal(parseByteRange('bytes=1000-', 1000), 'unsatisfiable')
  assert.equal(parseByteRange(null, 1000), null)
  assert.equal(parseByteRange('bytes=0-1,5-9', 1000), null)
  assert.equal(parseByteRange('bytes=-', 1000), null)
})

test('the browser\'s first request (bytes=0-) gets a 206 with the full size', () => {
  const plan = planRangeResponse('bytes=0-', 339800)
  assert.equal(plan.status, 206)
  assert.equal(plan.headers['Content-Range'], 'bytes 0-339799/339800')
  assert.equal(plan.headers['Content-Length'], '339800')
})

test('a long range is shortened so a buffered reply stays under the Vercel limit', () => {
  const size = 30 * 1024 * 1024
  const plan = planRangeResponse('bytes=0-', size)
  assert.equal(plan.status, 206)
  assert.equal(plan.end, MAX_RANGE_BYTES - 1)
  assert.equal(plan.headers['Content-Range'], `bytes 0-${MAX_RANGE_BYTES - 1}/${size}`)
  const next = planRangeResponse(`bytes=${MAX_RANGE_BYTES}-`, size)
  assert.equal(next.start, MAX_RANGE_BYTES)
})

test('past the end is a 416 that states the size; no Range is a plain 200', () => {
  assert.deepEqual(planRangeResponse('bytes=5000-', 1000), { status: 416, headers: { 'Content-Range': 'bytes */1000' } })
  assert.deepEqual(planRangeResponse(null, 1000), { status: 200 })
})
