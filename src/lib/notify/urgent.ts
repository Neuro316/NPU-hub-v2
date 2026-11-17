// src/lib/notify/urgent.ts
// Server only. An urgent notification: one text now to the rule's recipient, through public.hub_sms_outbox.
// Sends only when the org's notification mode is live AND the type's rule is urgent; a rule set to the brief is
// never texted on its own (the 8 AM brief carries it), and off drops it. Carries no name, address or message text.
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSettings, HUB_URL } from './settings'
import { maySend, routeItem, type NotificationType } from './rules'

const TEXT: Partial<Record<NotificationType, string>> = {
  discovery_no_show: 'A discovery call was missed. Open the contact in the Hub to reach out:',
}

/** Returns what happened: 'queued', or why nothing was sent. */
export async function notifyUrgent(db: SupabaseClient, orgId: string, type: NotificationType, contactId: string | null): Promise<string> {
  const s = await loadSettings(db, orgId)
  const rule = s.rules[type]
  const route = routeItem(rule)
  if (route !== 'text_now') return route === 'brief' ? 'held_for_brief' : 'dropped'
  if (!maySend(s.mode)) return `mode_${s.mode}`
  const link = contactId ? `${HUB_URL}/crm/contacts?id=${contactId}` : HUB_URL
  const { error } = await db.from('hub_sms_outbox').insert({ org_id: orgId, user_id: rule.recipient, source: `hub-urgent:${type}`, body: `${TEXT[type] ?? 'Something needs you in the Hub:'} ${link}` })
  if (error) throw new Error(`urgent queue: ${error.code ?? 'unknown'}`)
  return 'queued'
}
