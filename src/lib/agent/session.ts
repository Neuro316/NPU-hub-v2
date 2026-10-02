// src/lib/agent/session.ts
// Sessions, the per-session message cap and the per-user rate limit (rulings 8, 10, 20),
// counted from the database so they hold across serverless instances (AG9).
import type { SupabaseClient } from '@supabase/supabase-js'
import { RATE_LIMIT, type AgentMode, type AgentPolicy } from './config'

export type SessionCheck = { ok: true; sessionId: string } | { ok: false; status: number; message: string }

export async function rateLimited(db: SupabaseClient, userId: string, mode: AgentMode): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT.minutes * 60_000).toISOString()
  const { count, error } = await db.from('agent_runs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('mode', mode).gte('created_at', since)
  if (error) return true // an unreadable count fails closed
  return (count ?? 0) >= RATE_LIMIT.runs
}

/** Opens a session, or continues one the caller owns, and counts this message against its cap. */
export async function useSession(db: SupabaseClient, i: {
  org: string; userId: string; mode: AgentMode; surface: 'wizard' | 'panel'; sessionId?: unknown; campaignId?: string | null; policy: AgentPolicy
}): Promise<SessionCheck> {
  if (typeof i.sessionId === 'string' && i.sessionId) {
    const { data, error } = await db.from('agent_sessions').select('id, message_count')
      .eq('id', i.sessionId).eq('org_id', i.org).eq('user_id', i.userId).eq('mode', i.mode).maybeSingle()
    if (error) return { ok: false, status: 503, message: 'The conversation could not be loaded. Try again.' }
    if (!data) return { ok: false, status: 404, message: 'That conversation was not found. Start a new one.' }
    const n = (data as any).message_count as number
    if (n >= i.policy.session_messages) return { ok: false, status: 429, message: 'This conversation has reached its message limit. Start a new one.' }
    const { data: upd } = await db.from('agent_sessions').update({ message_count: n + 1, last_at: new Date().toISOString() })
      .eq('id', i.sessionId).eq('message_count', n).select('id')
    if ((upd?.length ?? 0) !== 1) return { ok: false, status: 409, message: 'Another message in this conversation is still running. Wait for it, then try again.' }
    return { ok: true, sessionId: i.sessionId }
  }
  const { data, error } = await db.from('agent_sessions').insert({ org_id: i.org, user_id: i.userId, mode: i.mode, surface: i.surface,
    campaign_id: i.campaignId ?? null, message_count: 1 }).select('id').single()
  if (error || !data) return { ok: false, status: 503, message: 'A conversation could not be started. Try again.' }
  return { ok: true, sessionId: (data as any).id }
}
