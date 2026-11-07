// src/lib/marketing/submitted-phone.ts
// The one rule for a phone number typed into a public form, used by form intake and by lead devices.
//
//   - A contact's phone is filled only while it is blank. A number already there is never overwritten.
//   - When the number just filled is already on another contact in the org, both cards get a system note
//     naming and linking the other, so a person can choose who receives texts on it. Inbound texts keep
//     routing as they do now (match_contact_by_phone: the oldest contact with the number).
//   - An SMS consent counts only for the number on the contact, which is the number typed or the one just filled.
//   - A public form can be filled in with someone else's details, and record_consent lifts a STOP on the number
//     it records, so a number with an active suppression never takes a consent from here.
//
// Nothing here logs a number or a name: only ids and error codes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'

export interface SettledPhone { phone: string | null; filled: boolean }
export type SmsConsentBlock = 'phone_differs' | 'number_suppressed' | 'check_failed'

export interface PhoneHolder { id: string; first_name?: string | null; last_name?: string | null; created_at?: string | null }

const HUB_ORIGIN = 'https://hub.neuroprogeny.com'
const MAX_SHARED = 25

export const contactLink = (id: string) => `${HUB_ORIGIN}/crm/contacts?id=${id}`
export const lastTen = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-10)
const nameOf = (c: PhoneHolder) => [c.first_name, c.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ') || 'Unnamed contact'

/** Pure: who inbound texts on the number reach today, the same order as match_contact_by_phone. */
export function currentReceiver(holders: PhoneHolder[]): PhoneHolder {
  return holders.slice().sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0]
}

/** Pure: one note for the contact just filled, and one for each other contact with the number. No message content. */
export function sharedNumberNotes(filled: PhoneHolder, others: PhoneHolder[], phone: string, source: string): Array<{ contact_id: string; body: string }> {
  const receiver = currentReceiver([filled, ...others])
  const goesTo = (self: PhoneHolder) => receiver.id === self.id ? 'this contact' : `${nameOf(receiver)} (${contactLink(receiver.id)})`
  const tail = (self: PhoneHolder) => `Inbound texts on this number currently go to ${goesTo(self)}. Choose who should receive texts on it.`
  const list = others.map((o) => `${nameOf(o)} (${contactLink(o.id)})`).join('; ')
  return [
    { contact_id: filled.id, body: `Shared phone number: ${phone} was added to this contact from ${source} and is also on ${list}. ${tail(filled)}` },
    ...others.map((o) => ({
      contact_id: o.id,
      body: `Shared phone number: ${phone} on this contact was also added to ${nameOf(filled)} (${contactLink(filled.id)}) from ${source}. ${tail(o)}`,
    })),
  ]
}

const readPhone = async (db: SupabaseClient, contactId: string): Promise<string | null> => {
  const { data } = await db.from('contacts').select('phone').eq('id', contactId).maybeSingle()
  return (data as any)?.phone ?? null
}

/** Never throws: a note that cannot be written is logged by code and the submission carries on. */
async function noteSharedNumber(db: SupabaseClient, contactId: string, phone: string, source: string): Promise<void> {
  const digits = lastTen(phone)
  if (digits.length !== 10) return
  const { data: me, error: meErr } = await db.from('contacts').select('id, org_id, first_name, last_name, created_at').eq('id', contactId).maybeSingle()
  if (meErr || !me) { console.error(`[submitted-phone] contact=${contactId} shared check failed: ${meErr?.code ?? 'no row'}`); return }
  // The filter narrows by the last four digits; the exact match is on the last ten, as inbound routing does.
  const { data: rows, error } = await db.from('contacts').select('id, first_name, last_name, phone, created_at')
    .eq('org_id', (me as any).org_id).is('merged_into_id', null).neq('id', contactId).like('phone', `%${digits.slice(-4)}%`).limit(500)
  if (error) { console.error(`[submitted-phone] contact=${contactId} shared check failed: ${error.code ?? 'unknown'}`); return }
  const others = ((rows ?? []) as any[]).filter((r) => lastTen(r.phone) === digits).slice(0, MAX_SHARED)
  if (!others.length) return
  const notes = sharedNumberNotes(me as PhoneHolder, others, phone, source)
    .map((n) => ({ ...n, org_id: (me as any).org_id, author_id: null, type: 'system', pinned: false }))
  const { error: nErr } = await db.from('contact_notes').insert(notes)
  if (nErr) console.error(`[submitted-phone] contact=${contactId} shared note failed: ${nErr.code ?? 'unknown'}`)
}

/**
 * Fills a blank phone with the submitted one. The write is conditional on the value just read, so a number saved
 * in between stands. source names where the number came from, for the shared number note.
 */
export async function settleSubmittedPhone(db: SupabaseClient, contactId: string, submitted: string | null, source: string): Promise<SettledPhone> {
  const current = await readPhone(db, contactId)
  if (!submitted || String(current ?? '').trim()) return { phone: current, filled: false }
  const update = db.from('contacts').update({ phone: submitted }).eq('id', contactId)
  const { data, error } = await (current === null ? update.is('phone', null) : update.eq('phone', current)).select('id')
  if (error) {
    console.error(`[submitted-phone] contact=${contactId} fill failed: ${error.code ?? 'unknown'}`)
    return { phone: current, filled: false }
  }
  if (!(data ?? []).length) return { phone: await readPhone(db, contactId), filled: false }
  await noteSharedNumber(db, contactId, submitted, source)
  return { phone: submitted, filled: true }
}

/** Why an SMS consent may not be recorded, or null when it may. A failed check refuses, because recording could lift a STOP. */
export async function smsConsentBlock(db: SupabaseClient, orgId: string, settled: SettledPhone, submitted: string | null): Promise<SmsConsentBlock | null> {
  if (!submitted || toE164(String(settled.phone ?? '')) !== submitted) return 'phone_differs'
  const addresses = Array.from(new Set([submitted, String(settled.phone ?? '').trim()]))
  const { data, error } = await db.from('suppressions').select('id')
    .eq('org_id', orgId).eq('channel', 'sms').in('address', addresses).is('lifted_at', null).limit(1)
  if (error) {
    console.error(`[submitted-phone] org=${orgId} suppression check failed: ${error.code ?? 'unknown'}`)
    return 'check_failed'
  }
  return (data ?? []).length ? 'number_suppressed' : null
}
