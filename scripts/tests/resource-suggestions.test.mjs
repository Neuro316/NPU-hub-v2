// Unit tests for "Suggested from your call" (src/lib/resources/suggest.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: suggestions only ever name available resources; no transcript
// means Claude is never called; a failed or slow call falls back to the normal sheet (null);
// the transcript Claude sees carries the contact's first name only, with emails, phone
// numbers and links redacted; the note ends with the standard closing line and the sender's
// first name and has no em dashes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  suggestFromCall, validateSuggestion, cleanTranscript, composeNote, noDashes,
  STANDARD_CLOSING, MAX_SUGGESTED,
} from '../../src/lib/resources/suggest.ts'

const RES = [
  { id: 'r-sleep', name: 'Sleep and the nervous system', description: 'How sleep shapes regulation' },
  { id: 'r-hrv', name: 'HRV basics', description: null },
  { id: 'r-kids', name: 'Parenting a sensitive child', description: 'For parents' },
]
const TRANSCRIPT = 'You: Thanks for making the time.\n\nSharon McCoy: My sleep has been rough and I keep hearing about HRV.'
const OPTS = { contactFirstName: 'Sharon', senderFirstName: 'Cameron', resources: RES }

function deps({ transcript = TRANSCRIPT, reply, fail = false } = {}) {
  const calls = []
  return {
    calls,
    findTranscript: async () => (transcript ? { text: transcript, at: '2026-11-04T15:00:00Z' } : null),
    callModel: async (input) => {
      calls.push(input)
      if (fail) throw new Error('ai_status_529')
      return reply ?? { resource_ids: ['r-sleep', 'r-hrv'], note: 'Thanks for telling me about your sleep. The HRV guide is a good start.' }
    },
  }
}

test('suggestions only include available resource ids', async () => {
  const d = deps({ reply: { resource_ids: ['r-hrv', 'made-up', 'r-hrv', 42, 'r-sleep', 'r-deleted'], note: 'Short note.' } })
  const s = await suggestFromCall(OPTS, d)
  assert.deepEqual(s.resource_ids, ['r-hrv', 'r-sleep'])
  for (const id of s.resource_ids) assert.ok(RES.some(r => r.id === id))
})

test('validateSuggestion drops unknown ids and caps the list', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, description: null }))
  const v = validateSuggestion({ resource_ids: many.map(r => r.id).concat(['nope']), note: 'Hi.' }, many)
  assert.equal(v.resource_ids.length, MAX_SUGGESTED)
  assert.ok(!v.resource_ids.includes('nope'))
  assert.equal(validateSuggestion(null, RES), null)
  assert.equal(validateSuggestion(['r-hrv'], RES), null)
  assert.deepEqual(validateSuggestion({ resource_ids: 'r-hrv', note: 7 }, RES), { resource_ids: [], personal: null })
})

test('no transcript means no call to Claude', async () => {
  const d = deps({ transcript: null })
  assert.equal(await suggestFromCall(OPTS, d), null)
  assert.equal(d.calls.length, 0)
})

test('an empty or whitespace transcript is no transcript', async () => {
  const d = deps({ transcript: '   \n\n  ' })
  assert.equal(await suggestFromCall(OPTS, d), null)
  assert.equal(d.calls.length, 0)
})

test('an empty library means no call to Claude', async () => {
  const d = deps()
  assert.equal(await suggestFromCall({ ...OPTS, resources: [] }, d), null)
  assert.equal(d.calls.length, 0)
})

test('a failed transcript lookup means no call and no suggestion', async () => {
  const d = deps()
  d.findTranscript = async () => { throw new Error('db down') }
  assert.equal(await suggestFromCall(OPTS, d), null)
  assert.equal(d.calls.length, 0)
})

test('a failed Claude call falls back to the normal sheet (null)', async () => {
  const d = deps({ fail: true })
  assert.equal(await suggestFromCall(OPTS, d), null)
  assert.equal(d.calls.length, 1)
})

test('an unusable reply falls back to the normal sheet (null)', async () => {
  assert.equal(await suggestFromCall(OPTS, deps({ reply: 'not json' })), null)
  assert.equal(await suggestFromCall(OPTS, deps({ reply: { resource_ids: ['made-up'], note: '' } })), null)
})

test('Claude sees the first name only, and no emails, phones or links', async () => {
  const d = deps({ transcript: 'You: What is your email?\n\nSharon McCoy: sharon.mccoy@example.com, or call 828-734-7558. My site is https://example.com/me' })
  await suggestFromCall(OPTS, d)
  const sent = d.calls[0].transcript
  assert.ok(sent.startsWith('You: What is your email?'))
  assert.ok(sent.includes('Sharon: [email], or call [phone]. My site is [link]'))
  assert.ok(!sent.includes('McCoy'))
  assert.ok(!sent.includes('@'))
  assert.equal(d.calls[0].contactFirstName, 'Sharon')
  assert.deepEqual(Object.keys(d.calls[0]).sort(), ['contactFirstName', 'resources', 'transcript'])
})

test('cleanTranscript labels an unnamed caller "Caller"', () => {
  assert.equal(cleanTranscript('You: Hi.\n\n+18287347558: Hello.', ''), 'You: Hi.\n\nCaller: Hello.')
})

test('the note ends with the standard closing line and the sender first name, no em dashes', async () => {
  const s = await suggestFromCall(OPTS, deps({ reply: { resource_ids: ['r-sleep'], note: 'You mentioned sleep — this guide helps.  It is short.' } }))
  assert.equal(s.note, `You mentioned sleep, this guide helps. It is short.\n\n${STANDARD_CLOSING}\n\nCameron`)
  assert.ok(!s.note.includes('—'))
  assert.equal(s.call_at, '2026-11-04T15:00:00Z')
})

test('noDashes and composeNote', () => {
  assert.equal(noDashes('a—b — c 2–3'), 'a, b, c 2-3')
  assert.equal(composeNote('  One.  Two. ', 'Paul'), `One. Two.\n\n${STANDARD_CLOSING}\n\nPaul`)
})

test('a reply with ids but no note still suggests the files', async () => {
  const s = await suggestFromCall(OPTS, deps({ reply: { resource_ids: ['r-kids'], note: '' } }))
  assert.deepEqual(s, { resource_ids: ['r-kids'], note: null, call_at: '2026-11-04T15:00:00Z' })
})
