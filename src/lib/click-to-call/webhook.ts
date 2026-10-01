// src/lib/click-to-call/webhook.ts
// Shared lookup for the two click-to-call webhooks, run only AFTER the signature has
// been verified. The call must be a click-to-call row (it has a 'click_to_call'
// attempt pointing at it), outbound, in the org whose token signed the request, and
// carry this CallSid (or none yet, which is stamped once, guarded).
import type { SupabaseClient } from '@supabase/supabase-js'
import { C2C_EVENT } from './server'

export interface C2CCall {
  id: string; org_id: string; contact_id: string | null; status: string
  from_number: string | null; to_number: string | null; external_call_sid: string | null
}

export async function findClickToCall(
  db: SupabaseClient, callLogId: string, callSid: string, signedOrgId: string | null,
): Promise<C2CCall | null> {
  if (!callLogId || !callSid) return null
  const { data: row, error } = await db.from('call_logs')
    .select('id, org_id, contact_id, direction, status, from_number, to_number, external_call_sid')
    .eq('id', callLogId).maybeSingle()
  if (error || !row || (row as any).direction !== 'outbound') return null
  if (signedOrgId && signedOrgId !== (row as any).org_id) return null
  const { data: attempt, error: aErr } = await db.from('crm_activity_log').select('id')
    .eq('event_type', C2C_EVENT).eq('ref_table', 'call_logs').eq('ref_id', callLogId).limit(1).maybeSingle()
  if (aErr || !attempt) return null
  const sid = (row as any).external_call_sid as string | null
  if (sid && sid !== callSid) return null
  if (!sid) {
    await db.from('call_logs').update({ external_call_sid: callSid }).eq('id', callLogId).is('external_call_sid', null)
  }
  return row as unknown as C2CCall
}
