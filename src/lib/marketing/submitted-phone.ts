// src/lib/marketing/submitted-phone.ts
// The one rule for a phone number typed into a public form, used by form intake and by lead devices.
//
//   - A contact's phone is filled only while it is blank. A number already there is never overwritten.
//   - An SMS consent counts only for the number on the contact, which is the number typed or the one just filled.
//   - A public form can be filled in with someone else's details, and record_consent lifts a STOP on the number
//     it records, so a number with an active suppression never takes a consent from here.
//
// Nothing here logs a number: only ids and error codes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'

export interface SettledPhone { phone: string | null; filled: boolean }
export type SmsConsentBlock = 'phone_differs' | 'number_suppressed' | 'check_failed'

const readPhone = async (db: SupabaseClient, contactId: string): Promise<string | null> => {
  const { data } = await db.from('contacts').select('phone').eq('id', contactId).maybeSingle()
  return (data as any)?.phone ?? null
}

/** Fills a blank phone with the submitted one. The write is conditional on the value just read, so a number saved in between stands. */
export async function settleSubmittedPhone(db: SupabaseClient, contactId: string, submitted: string | null): Promise<SettledPhone> {
  const current = await readPhone(db, contactId)
  if (!submitted || String(current ?? '').trim()) return { phone: current, filled: false }
  const update = db.from('contacts').update({ phone: submitted }).eq('id', contactId)
  const { data, error } = await (current === null ? update.is('phone', null) : update.eq('phone', current)).select('id')
  if (error) {
    console.error(`[submitted-phone] contact=${contactId} fill failed: ${error.code ?? 'unknown'}`)
    return { phone: current, filled: false }
  }
  if ((data ?? []).length) return { phone: submitted, filled: true }
  return { phone: await readPhone(db, contactId), filled: false }
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
