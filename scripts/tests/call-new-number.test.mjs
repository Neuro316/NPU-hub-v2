// Unit tests for calling a number that is not a contact (src/lib/call-new-number.ts).
// Run: npm run test:voice   (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: tapping Call on a full number places the call at
// once (the call is dialing before any contact lookup finishes); an unknown
// number creates exactly one contact, a known one creates none, and calling the
// same unknown number twice reuses the first contact.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contactForNumber, contactIdForCall, newContactRow, needsName, splitName, phoneKey, isFullNumber,
  NEW_CONTACT_FIRST_NAME, NEW_CONTACT_SOURCE,
} from '../../src/lib/call-new-number.ts'
import { createOutboundStore } from '../../src/lib/voice-call-state.ts'

const ORG = 'org-np'
const OTHER_ORG = 'org-sensorium'

/** A contacts table scoped by org, like the crm-client lookup and createContact. */
function fakeContacts(rows = []) {
  const table = [...rows]
  const created = []
  return {
    table, created,
    deps: {
      async findInOrg(orgId, key) {
        return table.filter(c => c.org_id === orgId && phoneKey(c.phone).endsWith(key.slice(-4)))
      },
      async create(row) {
        const c = { id: `new-${table.length + 1}`, ...row }
        table.push(c); created.push(c)
        return c
      },
    },
  }
}

test('numbers match on their last 10 digits, whatever the formatting', () => {
  assert.equal(phoneKey('+1 (828) 555-0100'), '8285550100')
  assert.equal(phoneKey('828.555.0100'), '8285550100')
  assert.equal(isFullNumber('828-555-0100'), true)
  assert.equal(isFullNumber('555-0100'), false)
})

test('an unknown number creates exactly one contact: "Unknown", source "Outbound call"', async () => {
  const db = fakeContacts()
  const { contact, created } = await contactForNumber(db.deps, ORG, '+18285550100')
  assert.equal(created, true)
  assert.equal(db.created.length, 1)
  assert.deepEqual(db.created[0], { id: contact.id, ...newContactRow(ORG, '+18285550100') })
  assert.equal(db.created[0].first_name, NEW_CONTACT_FIRST_NAME)
  assert.equal(db.created[0].last_name, '')
  assert.equal(db.created[0].source, NEW_CONTACT_SOURCE)
  assert.equal(db.created[0].phone, '+18285550100')
})

test('a known number creates none and uses the existing contact', async () => {
  const db = fakeContacts([{ id: 'c1', org_id: ORG, first_name: 'Melissa', last_name: 'Allen', phone: '(828) 555-0100' }])
  const { contact, created } = await contactForNumber(db.deps, ORG, '+18285550100')
  assert.equal(created, false)
  assert.equal(contact.id, 'c1')
  assert.equal(db.created.length, 0)
})

test('the same last four digits on a different number is not a match', async () => {
  const db = fakeContacts([{ id: 'c1', org_id: ORG, first_name: 'Pat', last_name: 'Lee', phone: '+17045550100' }])
  const { created } = await contactForNumber(db.deps, ORG, '+18285550100')
  assert.equal(created, true)
})

test('calling the same unknown number twice reuses the first contact', async () => {
  const db = fakeContacts()
  const first = await contactForNumber(db.deps, ORG, '+18285550100')
  const second = await contactForNumber(db.deps, ORG, '828-555-0100')
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.contact.id, first.contact.id)
  assert.equal(db.created.length, 1)
})

test("only the current org is matched: another org's contact is never used", async () => {
  const db = fakeContacts([{ id: 'other', org_id: OTHER_ORG, first_name: 'Sam', last_name: 'X', phone: '+18285550100' }])
  const { contact, created } = await contactForNumber(db.deps, ORG, '+18285550100')
  assert.equal(created, true)
  assert.notEqual(contact.id, 'other')
})

// ── The call is placed in the tap, and logged against the resolved contact ──

const flush = () => new Promise(r => setImmediate(r))

/** The outbound store wired the way OutboundCallProvider wires it. */
function callHarness(db) {
  const log = { order: [], tokens: [] }
  let storeRef = null
  const store = createOutboundStore((target, session) => ({
    ensureMicrophone: async () => { log.order.push('microphone'); return { ok: true } },
    async prepare() {
      const who = await contactIdForCall(target, patch => storeRef.updateTarget(session, patch))
      if (!who.ok) return { ok: false, message: who.message }
      log.tokens.push(who.contactId)
      return { ok: true, token: 't', params: { To: target.phone }, callLogId: `log-${who.contactId}` }
    },
    createDevice: () => ({ async connect() { return { on() {}, status: () => 'open', disconnect() {} } }, disconnectAll() {}, destroy() {} }),
    onRemoteAudio: () => {},
    ringback: { start() { log.order.push('ringback') }, stop() {} },
    hangupOnServer: () => {},
    later: () => {},
  }))
  storeRef = store
  const callNumber = (phone) => store.place({
    contactId: '', name: '', phone,
    resolveContact: async () => {
      log.order.push('resolve')
      const { contact, created } = await contactForNumber(db.deps, ORG, phone)
      return { id: contact.id, name: `${contact.first_name} ${contact.last_name}`.trim(), created }
    },
  })
  return { store, log, callNumber }
}

test('Call on an unknown number dials at once, then logs against exactly one new contact', async () => {
  const db = fakeContacts()
  const h = callHarness(db)
  const res = h.callNumber('+18285550100')
  // Synchronously, inside the tap: the call is placed and dialing, nothing created yet.
  assert.equal(res.ok, true)
  assert.equal(h.store.getSnapshot().stage, 'dialing')
  // Ringback and the microphone prompt start in the tap; the lookup has not run.
  assert.deepEqual([...h.log.order], ['ringback', 'microphone'])
  assert.equal(db.created.length, 0)
  await flush(); await flush(); await flush()
  assert.deepEqual(h.log.order, ['ringback', 'microphone', 'resolve'], 'the microphone is asked for before any lookup')
  assert.equal(db.created.length, 1)
  assert.deepEqual(h.log.tokens, [db.created[0].id], 'the call is logged against the new contact')
  const target = h.store.getSnapshot().target
  assert.equal(target.contactId, db.created[0].id)
  assert.equal(target.newContact, true, 'the call screen offers "Add name"')
  assert.equal(target.name, '')
})

test('Call on a known number creates no contact and shows its name', async () => {
  const db = fakeContacts([{ id: 'c1', org_id: ORG, first_name: 'Melissa', last_name: 'Allen', phone: '+1 828 555 0100' }])
  const h = callHarness(db)
  h.callNumber('+18285550100')
  await flush(); await flush(); await flush()
  assert.equal(db.created.length, 0)
  assert.deepEqual(h.log.tokens, ['c1'])
  assert.equal(h.store.getSnapshot().target.name, 'Melissa Allen')
  assert.equal(h.store.getSnapshot().target.newContact, false)
})

test('calling the same unknown number twice, the second call reuses the first contact', async () => {
  const db = fakeContacts()
  const h = callHarness(db)
  h.callNumber('+18285550100')
  await flush(); await flush(); await flush()
  h.store.dispose()
  const h2 = callHarness(db)
  h2.callNumber('8285550100')
  await flush(); await flush(); await flush()
  assert.equal(db.created.length, 1)
  assert.deepEqual(h2.log.tokens, [db.created[0].id])
  assert.equal(h2.store.getSnapshot().target.newContact, false)
})

test('if the contact cannot be saved, the call ends with a clear message', async () => {
  const db = fakeContacts()
  db.deps.create = async () => { throw new Error('permission denied') }
  const h = callHarness(db)
  h.callNumber('+18285550100')
  await flush(); await flush(); await flush()
  const snap = h.store.getSnapshot()
  assert.equal(snap.stage, 'idle')
  assert.match(snap.ended.error, /Could not log this number as a contact: permission denied/)
})

test('"Add name" shows for unnamed contacts only; names split into first and last', () => {
  assert.equal(needsName({ first_name: 'Unknown', last_name: '', phone: '+18285550100' }), true)
  assert.equal(needsName({ first_name: 'Unknown', last_name: '+18285550100', phone: '+18285550100' }), true)
  assert.equal(needsName({ first_name: 'Melissa', last_name: 'Allen', phone: '+18285550100' }), false)
  assert.deepEqual(splitName('  Mary Ann  Smith '), { first_name: 'Mary', last_name: 'Ann Smith' })
  assert.deepEqual(splitName('Cher'), { first_name: 'Cher', last_name: '' })
})
