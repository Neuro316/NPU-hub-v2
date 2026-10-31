// Unit tests for answered-call transcripts (src/lib/voice-intelligence.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: the completion callback writes ONLY to the call log
// row its transcript names, only after a valid Twilio signature, and the text is
// labeled by speaker from the recording's channels.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  handleIntelligenceCallback, formatSpeakerTranscript, channelSpeakers,
  requestCallTranscript, sha256Hex, INTELLIGENCE_API,
} from '../../src/lib/voice-intelligence.ts'

const twilio = createRequire(import.meta.url)('twilio')

const ACCOUNT = 'AC' + '1'.repeat(32)
const OTHER_ACCOUNT = 'AC' + '2'.repeat(32)
const TOKEN = 'test-auth-token'
const URL_BASE = 'https://hub.neuroprogeny.com/api/twilio/intelligence'
const ROW_A = '11111111-1111-4111-8111-111111111111'
const ROW_B = '22222222-2222-4222-8222-222222222222'
const TRANSCRIPT = 'GT' + 'a'.repeat(32)

const SENTENCES = [
  { media_channel: 1, transcript: 'Hi Sharon, thanks for making the time.', start_time: 0.5, sentence_index: 0 },
  { media_channel: 2, transcript: 'Of course.', start_time: 3.1, sentence_index: 1 },
  { media_channel: 2, transcript: 'Happy to talk.', start_time: 4.0, sentence_index: 2 },
  { media_channel: 1, transcript: 'Great.', start_time: 6.2, sentence_index: 3 },
]

/** Fake database and Twilio API. `updates` records every write. */
function fakeDeps({ transcriptStatus = 'completed', customerKey = ROW_B, rows } = {}) {
  const table = rows ?? {
    [ROW_A]: { id: ROW_A, direction: 'outbound', account_sid: ACCOUNT, contact_label: 'Someone Else' },
    [ROW_B]: { id: ROW_B, direction: 'outbound', account_sid: ACCOUNT, contact_label: 'Sharon McCoy' },
  }
  const updates = []
  const gets = []
  return {
    updates, gets,
    deps: {
      async authTokenForAccount(sid) { return sid === ACCOUNT ? TOKEN : null },
      async getJson(url, creds) {
        gets.push({ url, creds })
        if (url === `${INTELLIGENCE_API}/Transcripts/${TRANSCRIPT}`) return { sid: TRANSCRIPT, status: transcriptStatus, customer_key: customerKey }
        if (url.startsWith(`${INTELLIGENCE_API}/Transcripts/${TRANSCRIPT}/Sentences`)) return { sentences: SENTENCES, meta: { next_page_url: null } }
        throw new Error('unexpected GET ' + url)
      },
      async findCallLog(id) { return table[id] ?? null },
      async updateCallLog(id, fields) { updates.push({ id, fields }); return table[id] ? 1 : 0 },
    },
  }
}

/** A callback signed the way Twilio signs a JSON webhook (bodySHA256 in the URL). */
function signedJson(payload, token = TOKEN) {
  const rawBody = JSON.stringify(payload)
  const url = `${URL_BASE}?bodySHA256=${sha256Hex(rawBody)}`
  return { rawBody, url, contentType: 'application/json', signature: twilio.getExpectedTwilioSignature(token, url, {}) }
}

/** A callback signed the classic way (form params). */
function signedForm(params, token = TOKEN) {
  const rawBody = new URLSearchParams(params).toString()
  return { rawBody, url: URL_BASE, contentType: 'application/x-www-form-urlencoded', signature: twilio.getExpectedTwilioSignature(token, URL_BASE, params) }
}

const payload = { account_sid: ACCOUNT, transcript_sid: TRANSCRIPT, event_type: 'voice_intelligence_transcript_available' }

// ── Writes to the right row ──────────────────────────────────────────────────

test('a signed completion callback writes the labeled transcript to the row its customer_key names', async () => {
  const f = fakeDeps({ customerKey: ROW_B })
  const res = await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.equal(res.status, 200)
  assert.equal(f.updates.length, 1)
  assert.equal(f.updates[0].id, ROW_B)
  assert.equal(f.updates[0].fields.transcription_status, 'completed')
  assert.equal(f.updates[0].fields.transcript,
    'You: Hi Sharon, thanks for making the time.\n\nSharon McCoy: Of course. Happy to talk.\n\nYou: Great.')
})

test('the other row is never touched', async () => {
  const f = fakeDeps({ customerKey: ROW_A })
  await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.deepEqual(f.updates.map(u => u.id), [ROW_A])
})

test('a form-encoded signed callback is accepted too', async () => {
  const f = fakeDeps()
  const res = await handleIntelligenceCallback(signedForm({ AccountSid: ACCOUNT, TranscriptSid: TRANSCRIPT }), f.deps)
  assert.equal(res.status, 200)
  assert.equal(f.updates[0].id, ROW_B)
})

test('a failed transcript marks the row failed with no text', async () => {
  const f = fakeDeps({ transcriptStatus: 'failed' })
  const res = await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.equal(res.status, 200)
  assert.deepEqual(f.updates, [{ id: ROW_B, fields: { transcript: null, transcription_status: 'failed' } }])
})

test('a transcript still in progress writes nothing', async () => {
  const f = fakeDeps({ transcriptStatus: 'in-progress' })
  const res = await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.equal(res.status, 202)
  assert.equal(f.updates.length, 0)
})

test('an unknown call log is a no-op 200 so Twilio does not retry forever', async () => {
  const f = fakeDeps({ customerKey: '33333333-3333-4333-8333-333333333333' })
  const res = await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.equal(res.status, 200)
  assert.equal(res.body.matched, false)
  assert.equal(f.updates.length, 0)
})

test('a row whose org is on another Twilio account is not written', async () => {
  const f = fakeDeps({ rows: { [ROW_B]: { id: ROW_B, direction: 'outbound', account_sid: OTHER_ACCOUNT, contact_label: 'X' } } })
  const res = await handleIntelligenceCallback(signedJson(payload), f.deps)
  assert.equal(res.status, 200)
  assert.equal(f.updates.length, 0)
})

// ── Rejects bad signatures ───────────────────────────────────────────────────

test('a wrong signature is rejected with 403 and nothing is read or written', async () => {
  const f = fakeDeps()
  const req = { ...signedJson(payload), signature: 'bm90LWEtcmVhbC1zaWduYXR1cmU=' }
  const res = await handleIntelligenceCallback(req, f.deps)
  assert.equal(res.status, 403)
  assert.equal(f.updates.length, 0)
  assert.equal(f.gets.length, 0)
})

test('a missing signature is rejected', async () => {
  const f = fakeDeps()
  const res = await handleIntelligenceCallback({ ...signedJson(payload), signature: '' }, f.deps)
  assert.equal(res.status, 403)
  assert.equal(f.updates.length, 0)
})

test('a signature made with another token is rejected', async () => {
  const f = fakeDeps()
  const res = await handleIntelligenceCallback(signedJson(payload, 'some-other-token'), f.deps)
  assert.equal(res.status, 403)
  assert.equal(f.updates.length, 0)
})

test('a body changed after signing is rejected (bodySHA256 no longer matches)', async () => {
  const f = fakeDeps()
  const req = signedJson(payload)
  const tampered = { ...req, rawBody: JSON.stringify({ ...payload, transcript_sid: 'GT' + 'b'.repeat(32) }) }
  const res = await handleIntelligenceCallback(tampered, f.deps)
  assert.equal(res.status, 403)
  assert.equal(f.updates.length, 0)
})

test('an account the Hub does not know is rejected', async () => {
  const f = fakeDeps()
  const res = await handleIntelligenceCallback(signedJson({ ...payload, account_sid: OTHER_ACCOUNT }), f.deps)
  assert.equal(res.status, 403)
  assert.equal(f.updates.length, 0)
})

// ── Speaker labels ───────────────────────────────────────────────────────────

test('outbound: channel 1 is the Hub user, channel 2 the contact', () => {
  assert.deepEqual(channelSpeakers('outbound'), { hub: 1, contact: 2 })
})

test('inbound: channel 1 is the caller, channel 2 the Hub user', () => {
  assert.deepEqual(channelSpeakers('inbound'), { hub: 2, contact: 1 })
  assert.equal(formatSpeakerTranscript(SENTENCES, 'inbound', '+18285550100'),
    '+18285550100: Hi Sharon, thanks for making the time.\n\nYou: Of course. Happy to talk.\n\n+18285550100: Great.')
})

test('sentences are ordered by start time and blank ones dropped', () => {
  const out = formatSpeakerTranscript(
    [{ media_channel: 2, transcript: 'Second.', start_time: 2 }, { media_channel: 1, transcript: ' ', start_time: 0 }, { media_channel: 1, transcript: 'First.', start_time: 1 }],
    'outbound', 'Pat')
  assert.equal(out, 'You: First.\n\nPat: Second.')
})

// ── Request ──────────────────────────────────────────────────────────────────

test('requesting a transcript sends the recording, the call log id and channel participants', async () => {
  let sent
  const fetchImpl = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ sid: TRANSCRIPT }), { status: 201 }) }
  const r = await requestCallTranscript({
    creds: { accountSid: ACCOUNT, authToken: TOKEN }, serviceSid: 'GA' + 'c'.repeat(32),
    recordingSid: 'RE' + 'd'.repeat(32), callLogId: ROW_B, direction: 'inbound', contactLabel: 'Sharon McCoy', fetchImpl,
  })
  assert.deepEqual(r, { ok: true, transcriptSid: TRANSCRIPT })
  assert.equal(sent.url, `${INTELLIGENCE_API}/Transcripts`)
  const form = new URLSearchParams(sent.init.body)
  assert.equal(form.get('CustomerKey'), ROW_B)
  const channel = JSON.parse(form.get('Channel'))
  assert.equal(channel.media_properties.source_sid, 'RE' + 'd'.repeat(32))
  assert.deepEqual(channel.participants.map(p => [p.channel_participant, p.full_name]), [[2, 'You'], [1, 'Sharon McCoy']])
})

test('a refused request reports the error instead of throwing', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: 'Service not found' }), { status: 404 })
  const r = await requestCallTranscript({
    creds: { accountSid: ACCOUNT, authToken: TOKEN }, serviceSid: 'GA0', recordingSid: 'RE0',
    callLogId: ROW_B, direction: 'outbound', contactLabel: 'X', fetchImpl,
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /404/)
})
