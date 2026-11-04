// Calling a number that is not a contact yet.
//
// Tapping Call on a full number places the call at once. In the same tap the
// call starts (audio unlocked, microphone asked for, ringback primed) and the
// contact is resolved while it dials: the org's existing contact for that number
// when there is one, matched on the last 10 digits, otherwise a new contact named
// "Unknown" with source "Outbound call". The call is then logged, recorded and
// transcribed against that contact, and the call screen offers "Add name".
//
// No imports: scripts/tests/call-new-number.test.mjs loads this file directly.

export const NEW_CONTACT_FIRST_NAME = 'Unknown'
export const NEW_CONTACT_SOURCE = 'Outbound call'

/** The comparison key for a phone number: its last 10 digits. */
export function phoneKey(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

/** A number complete enough to dial and to match on. */
export function isFullNumber(raw: string | null | undefined): boolean {
  return phoneKey(raw).length === 10
}

export interface NumberContact {
  id: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
}

export interface NumberContactDeps {
  /** This org's live (not merged) contacts whose phone ends in these 10 digits. */
  findInOrg(orgId: string, key: string): Promise<NumberContact[]>
  /** The existing contact creation path (crm-client createContact). */
  create(row: Record<string, unknown>): Promise<NumberContact>
}

/** The row a new contact gets when its number is called before it has a name. */
export function newContactRow(orgId: string, phoneE164: string): Record<string, unknown> {
  return {
    org_id: orgId,
    first_name: NEW_CONTACT_FIRST_NAME,
    last_name: '',
    phone: phoneE164,
    source: NEW_CONTACT_SOURCE,
    tags: [],
    sms_consent: false,
    do_not_contact: false,
  }
}

/**
 * The contact a call to this number is logged against: the org's existing one
 * when the number matches, never a duplicate; otherwise exactly one new contact.
 */
export async function contactForNumber(
  deps: NumberContactDeps, orgId: string, phoneE164: string
): Promise<{ contact: NumberContact; created: boolean }> {
  const key = phoneKey(phoneE164)
  if (key.length !== 10) throw new Error('That is not a full phone number.')
  const found = (await deps.findInOrg(orgId, key)).filter(c => phoneKey(c.phone) === key)
  if (found.length) return { contact: found[0], created: false }
  return { contact: await deps.create(newContactRow(orgId, phoneE164)), created: true }
}

/** A contact still waiting for a name (created by a call, or an unknown caller). */
export function needsName(c: { first_name?: string | null; last_name?: string | null; phone?: string | null } | null | undefined): boolean {
  if (!c) return false
  const first = String(c.first_name || '').trim()
  const last = String(c.last_name || '').trim()
  if (!first && !last) return true
  // Unknown inbound callers are saved as "Unknown" + their number.
  return first === NEW_CONTACT_FIRST_NAME && (!last || phoneKey(last) === phoneKey(c.phone))
}

/** "Jane Doe" -> first and last name for the contact row. */
export function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { first_name: parts[0] || NEW_CONTACT_FIRST_NAME, last_name: parts.slice(1).join(' ') }
}

/**
 * The contact id a call's token is requested for. Called in the call setup
 * AFTER the microphone prompt (so the tap's gesture is spent on audio, not on a
 * database round trip): a picked contact as is, or a typed number resolved now.
 * onResolved updates the call screen (the name, or "Add name" for a new one).
 */
export async function contactIdForCall(
  target: { contactId: string; resolveContact?: () => Promise<{ id: string; name: string; created: boolean }> },
  onResolved: (patch: { contactId: string; name: string; newContact: boolean }) => void
): Promise<{ ok: true; contactId: string } | { ok: false; message: string }> {
  if (target.contactId) return { ok: true, contactId: target.contactId }
  if (!target.resolveContact) return { ok: false, message: 'Could not start the call.' }
  try {
    const c = await target.resolveContact()
    onResolved({ contactId: c.id, name: c.created ? '' : c.name, newContact: c.created })
    return { ok: true, contactId: c.id }
  } catch (e: any) {
    return { ok: false, message: `Could not log this number as a contact: ${e?.message || 'unknown error'}` }
  }
}
