// src/lib/mail/priority.ts
// The Inbox priority pill and what triage learns from it (feat/drafts-inbox-review, hub_247).
//   a correction   one hub_priority_feedback row: ids, the old and the new priority, a reason code, who and when.
//                  No email text, and no address: the sender is reached through message_id.
//   the guide      when triage sets the priority of a new email, the org's corrections from the last 90 days for
//                  the SAME sender address are read (sender address only, never a subject or a body). The ones for
//                  the SAME category as triage's answer decide: the newest one's priority wins. They are also given
//                  to the model as plain lines (category, from, to, reason), so its summary reads the same way.
import type { SupabaseClient } from '@supabase/supabase-js'

export const PRIORITY_VALUES = ['urgent', 'normal', 'low'] as const
export type PriorityValue = (typeof PRIORITY_VALUES)[number]
export const PRIORITY_REASONS = ['deadline', 'client', 'lead', 'partner', 'not_important'] as const
export type PriorityReason = (typeof PRIORITY_REASONS)[number]
export const REASON_TEXT: Record<PriorityReason, string> = {
  deadline: 'deadline', client: 'client', lead: 'lead', partner: 'partner', not_important: 'not important',
}
export const GUIDE_DAYS = 90

export interface Correction { category: string | null; from_priority: string | null; to_priority: PriorityValue; reason: string | null; created_at: string }

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const escLike = (s: string) => s.replace(/[\\%_]/g, (x) => '\\' + x)

/** The org's corrections for one sender address, newest first, from the last GUIDE_DAYS days. Empty on any read error
 *  (before hub_247 is applied the table is missing, and triage goes on as before). */
export async function loadGuide(db: SupabaseClient, connectionId: string, fromAddress: string | null, now: number): Promise<Correction[]> {
  const addr = lower(fromAddress)
  if (!addr.includes('@')) return []
  const { data: conn } = await db.from('hub_mail_connections').select('org_id').eq('id', connectionId).maybeSingle()
  const orgId = (conn as any)?.org_id
  if (!orgId) return []
  const since = new Date(now - GUIDE_DAYS * 86_400_000).toISOString()
  const { data: fb, error } = await db.from('hub_priority_feedback').select('message_id, from_priority, to_priority, reason, created_at')
    .eq('org_id', orgId).gte('created_at', since).order('created_at', { ascending: false }).limit(200)
  if (error || !fb?.length) return []
  const ids = Array.from(new Set((fb as any[]).map((f) => f.message_id)))
  const { data: msgs, error: mErr } = await db.from('hub_mail_messages').select('id, category').in('id', ids).ilike('from_address', escLike(addr))
  if (mErr || !msgs?.length) return []
  const cat = new Map((msgs as any[]).map((m) => [m.id as string, (m.category ?? null) as string | null]))
  return (fb as any[]).filter((f) => cat.has(f.message_id) && PRIORITY_VALUES.includes(f.to_priority))
    .map((f) => ({ category: cat.get(f.message_id) ?? null, from_priority: f.from_priority ?? null, to_priority: f.to_priority, reason: f.reason ?? null, created_at: f.created_at }))
}

/** Triage's priority, corrected by the newest correction for the same category (the guide is newest first). */
export function applyGuide<T extends { category: string; priority: string }>(t: T, guide: Correction[]): T & { guided: boolean } {
  const hit = guide.find((g) => g.category === t.category)
  return hit && hit.to_priority !== t.priority ? { ...t, priority: hit.to_priority, guided: true } : { ...t, guided: false }
}

/** The lines the model reads: category and priorities only. */
export function guideLines(guide: Correction[]): string[] {
  return guide.slice(0, 10).map((g) => `- ${g.category ?? 'uncategorised'}: changed from ${g.from_priority ?? 'unset'} to ${g.to_priority}${g.reason && (PRIORITY_REASONS as readonly string[]).includes(g.reason) ? ` (${REASON_TEXT[g.reason as PriorityReason]})` : ''}`)
}

const MEANS: Record<PriorityValue, string> = {
  urgent: 'needs a reply or action today',
  normal: 'needs attention this week',
  low: 'no action needed',
}
/** "Why this priority" in the review pane: a person's correction, or triage's rule for that level. */
export function priorityWhy(priority: string | null, category: string | null, correction: { reason: string | null; byViewer: boolean } | null): string {
  if (!priority) return 'Not classified yet.'
  const p = (PRIORITY_VALUES as readonly string[]).includes(priority) ? (priority as PriorityValue) : null
  if (!p) return 'Not classified yet.'
  if (correction) {
    const why = correction.reason && (PRIORITY_REASONS as readonly string[]).includes(correction.reason) ? `: ${REASON_TEXT[correction.reason as PriorityReason]}` : ''
    return `Set to ${p} by ${correction.byViewer ? 'you' : 'a teammate'}${why}.`
  }
  return `Triage marked it ${p} (${MEANS[p]})${category ? ` as ${category.replace(/_/g, ' ')}` : ''}.`
}
