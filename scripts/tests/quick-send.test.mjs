// Unit tests for Quick Send (src/lib/quick-send.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: only resources marked Available to send can be sent,
// an email over Resend's 40 MB encoded limit is refused before anything is read or
// sent, a send writes one record per resource plus one timeline entry, and opening
// or sending Quick Send from the call screen leaves the live call alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runQuickSend, resolveSelection, isSelectable, checkAttachmentSize, base64Size, groupByCategory,
  sendButtonLabel, attachmentsSelectedLabel, defaultQuickSendNote, submitQuickSend, readQuickSendSettings,
  MAX_ENCODED_ATTACHMENT_BYTES, MAX_RAW_ATTACHMENT_BYTES, RESEND_MAX_EMAIL_BYTES,
} from '../../src/lib/quick-send.ts'
import { createOutboundCall } from '../../src/lib/voice-call-state.ts'

const ORG = '00000000-0000-0000-0000-000000000001'
const OTHER_ORG = 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629'
const USER = 'u-1'
const CONTACT = 'c-1'
const MB = 1024 * 1024

const res = (id, over = {}) => ({
  media_asset_id: id, category_id: 'cat-programs', name: `${id}.pdf`, description: null,
  mime_type: 'application/pdf', file_size: 1000, storage_path: `${ORG}/assets/${id}.pdf`,
  url: `https://x/${id}.pdf`, available: true, archived_at: null, ...over,
})

const RESOURCES = [
  res('home-program'),
  res('phase-1'),
  res('draft', { available: false }),
  res('old', { archived_at: '2026-10-01T00:00:00Z' }),
  res('link-only', { storage_path: null }),
]

/** Fake database, storage and Resend. `log` records every write and call. */
function fakeDeps({ resources = RESOURCES, settings = { from_email: 'cameron@neuroprogeny.com', from_name: 'Neuro Progeny' },
  contact = { id: CONTACT, org_id: ORG, first_name: 'Jane', email: 'jane@example.com' }, resend = { ok: true, id: 're_123' },
  bytes = n => new Uint8Array(n) } = {}) {
  const log = { downloads: [], emails: [], sends: [], timeline: [] }
  const deps = {
    loadContact: async (org, id) => (contact && contact.id === id && contact.org_id === org ? contact : null),
    loadResources: async () => resources,
    loadSettings: async () => settings,
    loadSender: async () => ({ name: 'Cameron Allen', email: 'cameron@neuroprogeny.com' }),
    download: async path => { log.downloads.push(path); const r = resources.find(x => x.storage_path === path); return bytes(r?.file_size ?? 0) },
    sendEmail: async (payload, key) => { log.emails.push({ payload, key }); return resend },
    insertSends: async rows => { log.sends.push(...rows); return {} },
    insertTimeline: async row => { log.timeline.push(row); return {} },
    newId: () => 'batch-1',
    now: () => '2026-10-31T17:00:00.000Z',
  }
  return { deps, log }
}

const input = (over = {}) => ({
  orgId: ORG, userId: USER, contactId: CONTACT, mediaAssetIds: ['home-program', 'phase-1'],
  toEmail: 'jane@example.com', note: 'Hi Jane, here they are.\n\nCameron', ...over,
})

// ── Only flagged resources are selectable ────────────────────────────────────

test('only resources marked Available to send, not archived, with a file are selectable', () => {
  assert.deepEqual(RESOURCES.filter(isSelectable).map(r => r.media_asset_id), ['home-program', 'phase-1'])
})

test('a resource that is not available, archived or link-only cannot be selected', () => {
  for (const id of ['draft', 'old', 'link-only', 'not-in-quick-send']) {
    const sel = resolveSelection(['home-program', id], RESOURCES)
    assert.equal(sel.ok, false, id)
  }
  assert.equal(resolveSelection([], RESOURCES).ok, false)
  assert.equal(resolveSelection('home-program', RESOURCES).ok, false)
  assert.equal(resolveSelection(['home-program', 'home-program'], RESOURCES).ok, false)
})

test('sending a resource that is not available sends nothing and writes nothing', async () => {
  const { deps, log } = fakeDeps()
  const out = await runQuickSend(deps, input({ mediaAssetIds: ['home-program', 'draft'] }))
  assert.equal(out.status, 400)
  assert.equal(log.emails.length, 0)
  assert.equal(log.downloads.length, 0)
  assert.equal(log.sends.length + log.timeline.length, 0)
})

test('a contact in another org is refused before anything is read', async () => {
  const { deps, log } = fakeDeps({ contact: { id: CONTACT, org_id: OTHER_ORG, first_name: 'X', email: 'x@example.com' } })
  const out = await runQuickSend(deps, input())
  assert.equal(out.status, 404)
  assert.equal(log.downloads.length + log.emails.length, 0)
})

test('no From address set up refuses the send', async () => {
  const { deps, log } = fakeDeps({ settings: null })
  const out = await runQuickSend(deps, input())
  assert.equal(out.status, 409)
  assert.equal(log.emails.length, 0)
  assert.equal(readQuickSendSettings({ from_email: 'not an email' }, 'NP'), null)
  assert.deepEqual(readQuickSendSettings({ from_email: 'cameron@neuroprogeny.com' }, 'Neuro Progeny'),
    { from_email: 'cameron@neuroprogeny.com', from_name: 'Neuro Progeny' })
})

// ── Size limit ───────────────────────────────────────────────────────────────

test('the limit is on the base64 size, inside Resend\'s 40 MB', () => {
  assert.equal(base64Size(3), 4)
  assert.equal(base64Size(4), 8)
  assert.ok(MAX_ENCODED_ATTACHMENT_BYTES < RESEND_MAX_EMAIL_BYTES)
  assert.equal(checkAttachmentSize([MAX_RAW_ATTACHMENT_BYTES]).ok, true)
  assert.equal(checkAttachmentSize([MAX_RAW_ATTACHMENT_BYTES + 3]).ok, false)
  // 31 MB of files is over 40 MB once encoded.
  const over = checkAttachmentSize([16 * MB, 15 * MB])
  assert.equal(over.ok, false)
  assert.match(over.message, /Send fewer files at once/)
})

test('files over the limit are refused before any file is downloaded or sent', async () => {
  const big = [res('a', { file_size: 16 * MB }), res('b', { file_size: 15 * MB })]
  const { deps, log } = fakeDeps({ resources: big })
  const out = await runQuickSend(deps, input({ mediaAssetIds: ['a', 'b'] }))
  assert.equal(out.status, 413)
  assert.equal(log.downloads.length, 0)
  assert.equal(log.emails.length, 0)
})

test('a stored file larger than its recorded size is caught after download', async () => {
  const lying = [res('a', { file_size: 1000 })]
  const { deps, log } = fakeDeps({ resources: lying, bytes: () => new Uint8Array(31 * MB) })
  const out = await runQuickSend(deps, input({ mediaAssetIds: ['a'] }))
  assert.equal(out.status, 413)
  assert.equal(log.emails.length, 0)
})

// ── The send, its records and its timeline entry ─────────────────────────────

test('a send emails the files attached, from the org sender, Reply-To the staff member', async () => {
  const { deps, log } = fakeDeps()
  const out = await runQuickSend(deps, input())
  assert.equal(out.status, 200)
  assert.equal(log.emails.length, 1)
  const { payload, key } = log.emails[0]
  assert.equal(payload.from, 'Neuro Progeny <cameron@neuroprogeny.com>')
  assert.doesNotMatch(payload.from, /mail\.neuroprogeny\.com/)
  assert.deepEqual(payload.to, ['jane@example.com'])
  assert.equal(payload.reply_to, 'cameron@neuroprogeny.com')
  assert.deepEqual(payload.attachments.map(a => a.filename), ['home-program.pdf', 'phase-1.pdf'])
  assert.equal(Buffer.from(payload.attachments[0].content, 'base64').length, 1000)
  assert.match(payload.text, /Hi Jane, here they are/)
  assert.equal(key, 'quick-send-batch-1')
})

test('a send writes one record per resource and one timeline entry', async () => {
  const { deps, log } = fakeDeps()
  await runQuickSend(deps, input())
  assert.equal(log.sends.length, 2)
  for (const row of log.sends) {
    assert.equal(row.status, 'sent')
    assert.equal(row.batch_id, 'batch-1')
    assert.equal(row.contact_id, CONTACT)
    assert.equal(row.sent_by, USER)
    assert.equal(row.resend_message_id, 're_123')
    assert.equal(row.to_email, 'jane@example.com')
  }
  assert.deepEqual(log.sends.map(r => r.media_asset_id), ['home-program', 'phase-1'])
  assert.equal(log.timeline.length, 1)
  const tl = log.timeline[0]
  assert.equal(tl.event_type, 'quick_send')
  assert.equal(tl.contact_id, CONTACT)
  assert.equal(tl.title, 'Quick Send: 2 resources emailed')
  assert.match(tl.description, /home-program\.pdf, phase-1\.pdf\. Sent by Cameron Allen to jane@example\.com/)
  assert.equal(tl.occurred_at, '2026-10-31T17:00:00.000Z')
})

test('a refused email writes failed records, no timeline entry, and says the domain is unverified', async () => {
  const { deps, log } = fakeDeps({ resend: { ok: false, status: 403, name: 'validation_error', message: 'The neuroprogeny.com domain is not verified.' } })
  const out = await runQuickSend(deps, input())
  assert.equal(out.status, 502)
  assert.match(out.body.error, /neuroprogeny\.com is not verified in Resend/)
  assert.match(out.body.error, /nothing was sent/)
  assert.equal(log.sends.length, 2)
  assert.ok(log.sends.every(r => r.status === 'failed' && r.resend_message_id === null))
  assert.equal(log.timeline.length, 0)
})

test('an invalid To address is refused', async () => {
  const { deps, log } = fakeDeps()
  const out = await runQuickSend(deps, input({ toEmail: 'jane' }))
  assert.equal(out.status, 400)
  assert.equal(log.emails.length, 0)
})

// ── Labels from the approved design ──────────────────────────────────────────

test('button and footer labels', () => {
  assert.equal(sendButtonLabel(1), 'Send 1 resource')
  assert.equal(sendButtonLabel(3), 'Send 3 resources')
  assert.equal(sendButtonLabel(0, { sheet: true }), 'Select resources to send')
  assert.equal(attachmentsSelectedLabel(1), '1 attachment selected')
  assert.equal(attachmentsSelectedLabel(2), '2 attachments selected')
  assert.equal(defaultQuickSendNote('Jane', 'Cameron'),
    'Hi Jane, it was great to connect. Here are the resources we spoke about. Let me know if you have any questions.\n\nCameron')
})

test('resources are grouped under their categories in order, empty ones left out', () => {
  const cats = [{ id: 'cat-office', name: 'Office Services', sort_order: 1 }, { id: 'cat-programs', name: 'Programs', sort_order: 0 },
    { id: 'cat-supp', name: 'Supplements and Techniques', sort_order: 2 }]
  const groups = groupByCategory([res('b'), res('a'), res('o', { category_id: 'cat-office' })], cats)
  assert.deepEqual(groups.map(g => g.category.name), ['Programs', 'Office Services'])
  assert.deepEqual(groups[0].resources.map(r => r.media_asset_id), ['a', 'b'])
})

// ── The live call is untouched ───────────────────────────────────────────────

function liveCall() {
  const handlers = {}
  const call = {
    disconnects: 0, muted: null, status_: 'open',
    on(ev, fn) { (handlers[ev] ||= []).push(fn) },
    emit(ev, ...a) { for (const fn of handlers[ev] || []) fn(...a) },
    status() { return call.status_ },
    disconnect() { call.disconnects++; call.emit('disconnect') },
    mute(m) { call.muted = m },
    sendDigits() {},
  }
  const device = { destroyed: 0, disconnectAlls: 0, async connect() { return call }, disconnectAll() { device.disconnectAlls++ }, destroy() { device.destroyed++ } }
  const log = { ended: [], server: [] }
  const ctl = createOutboundCall({
    ensureMicrophone: async () => ({ ok: true }),
    prepare: async () => ({ ok: true, token: 't', params: { To: '+1' }, callLogId: 'log-1' }),
    createDevice: () => device,
    onStage: () => {},
    onEnded: info => log.ended.push(info),
    onRemoteAudio: () => {},
    ringback: { start() {}, stop() {} },
    hangupOnServer: id => log.server.push(id),
    later: () => {},
  })
  return { ctl, call, device, log }
}

test('sending from the call screen is one POST and leaves the live call connected', async () => {
  const h = liveCall()
  await h.ctl.start()
  h.call.emit('accept')
  assert.equal(h.ctl.stage, 'connected')

  const requests = []
  const fakeFetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    // The call is still up while the request is in flight.
    assert.equal(h.ctl.stage, 'connected')
    return new Response(JSON.stringify({ ok: true, sent: 2, to: 'jane@example.com' }), { status: 200 })
  }
  const out = await submitQuickSend(fakeFetch, {
    org_id: ORG, contact_id: CONTACT, media_asset_ids: ['home-program', 'phase-1'], to_email: 'jane@example.com', note: 'Hi',
  })

  assert.deepEqual(out, { ok: true, sent: 2, to: 'jane@example.com' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/quick-send/send')
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['contact_id', 'media_asset_ids', 'note', 'org_id', 'to_email'])
  assert.equal(h.ctl.stage, 'connected')
  assert.equal(h.call.disconnects, 0)
  assert.equal(h.call.muted, null)
  assert.equal(h.device.destroyed + h.device.disconnectAlls, 0)
  assert.deepEqual(h.log.server, [])
  assert.deepEqual(h.log.ended, [])
})

test('a failed send from the call screen reports the error and still leaves the call alone', async () => {
  const h = liveCall()
  await h.ctl.start()
  h.call.emit('accept')
  const out = await submitQuickSend(async () => new Response(JSON.stringify({ error: 'One email can carry about 29.8 MB of attachments.' }), { status: 413 }),
    { org_id: ORG, contact_id: CONTACT, media_asset_ids: ['a'], to_email: 'jane@example.com', note: '' })
  assert.equal(out.ok, false)
  assert.match(out.error, /29\.8 MB/)
  const dropped = await submitQuickSend(async () => { throw new TypeError('Failed to fetch') },
    { org_id: ORG, contact_id: CONTACT, media_asset_ids: ['a'], to_email: 'jane@example.com', note: '' })
  assert.equal(dropped.ok, false)
  assert.equal(h.ctl.stage, 'connected')
  assert.equal(h.call.disconnects, 0)
  assert.deepEqual(h.log.ended, [])
})
