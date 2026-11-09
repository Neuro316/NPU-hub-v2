// src/lib/briefs/run.ts
// The morning brief (scheduling agent, stage 1). Called hourly by /api/cron/briefs, and by POST /api/briefs/test.
//
// Gate: readSchedAgentConfig (org_settings 'hub_sched_agent', exactly 'on', with a recipient). Sent only while the
// ET wall clock reads 8 o'clock, at most once per (recipient, 'morning', ET date): the hub_brief_runs row is
// inserted FIRST as the claim, and a unique violation means it already went. Sent to ONE person, the configured
// recipient: a Slack DM, and an SMS backup only when the Slack DM failed.
//
// Logs and results: ids, counts and short codes only. Never the brief text.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Senders } from '@/lib/lead-alerts/run'
import { isMissingTable } from '@/lib/calendar/scopes'
import { readSchedAgentConfig, SCHED_AGENT_ORG } from './config'
import { composeMorningSlack, composeMorningSms } from './compose'
import { gatherBrief } from './gather'
import { addDays, etDate, isMorningSendHour } from './time'

export interface BriefDeps { db: SupabaseClient; now: () => Date; senders: Senders }

export interface SendResult { slack: string; sms: string; chars: number }

const code = (c: string | null | undefined, fallback: string) => String(c ?? fallback).slice(0, 40)

/** Build and send one brief. SMS only if Slack failed. */
async function buildAndSend(deps: BriefDeps, userId: string, date: string, day: 'today' | 'tomorrow'): Promise<SendResult> {
  const data = await gatherBrief(deps.db, SCHED_AGENT_ORG, userId, date, day, deps.now())
  const text = composeMorningSlack(data)
  const s = await deps.senders.slack(SCHED_AGENT_ORG, userId, text)
  if (s.ok) return { slack: 'sent', sms: 'not_needed', chars: text.length }
  const m = await deps.senders.sms(SCHED_AGENT_ORG, userId, composeMorningSms(data))
  return { slack: code(s.code, 'failed'), sms: m.ok ? 'sent' : code(m.code, 'failed'), chars: text.length }
}

/** One cron tick. */
export async function runMorningBrief(deps: BriefDeps): Promise<Record<string, unknown>> {
  const now = deps.now()
  const cfg = await readSchedAgentConfig(deps.db)
  if (!cfg.enabled || !cfg.recipientUserId) return { skipped: 'off' }
  if (!isMorningSendHour(now)) return { skipped: 'not_send_hour' }
  const forDate = etDate(now)
  const uid = cfg.recipientUserId

  const { error } = await deps.db.from('hub_brief_runs').insert({ owner_user_id: uid, kind: 'morning', for_date: forDate })
  if (error?.code === '23505') return { skipped: 'already_sent', for_date: forDate }
  if (isMissingTable(error)) return { skipped: 'tables_missing' }
  if (error) throw new Error(`claim_${error.code ?? 'unknown'}`)

  let r: SendResult
  try {
    r = await buildAndSend(deps, uid, forDate, 'today')
  } catch (e) {
    // the claim stays: the brief is not retried later in the day (the next tick is past 8 o'clock anyway)
    const c = String((e as Error)?.message ?? 'error').replace(/[^\w-]/g, '').slice(0, 40) || 'error'
    console.error(`[briefs] morning user=${uid} date=${forDate} build failed: ${c}`)
    await deps.db.from('hub_brief_runs').update({ slack_status: `build_${c}`.slice(0, 40), sms_status: null })
      .eq('owner_user_id', uid).eq('kind', 'morning').eq('for_date', forDate)
    return { for_date: forDate, error: c }
  }
  const { error: uErr } = await deps.db.from('hub_brief_runs').update({ slack_status: r.slack, sms_status: r.sms })
    .eq('owner_user_id', uid).eq('kind', 'morning').eq('for_date', forDate)
  if (uErr) console.error(`[briefs] status write failed: ${uErr.code ?? 'unknown'}`)
  return { for_date: forDate, ...r }
}

/** The superadmin test: build and send now to the configured recipient, any hour, gate ignored, no hub_brief_runs row. */
export async function sendBriefNow(deps: BriefDeps, opts: { tomorrow: boolean }): Promise<SendResult | { error: 'no_recipient' }> {
  const cfg = await readSchedAgentConfig(deps.db)
  if (!cfg.recipientUserId) return { error: 'no_recipient' }
  const today = etDate(deps.now())
  return buildAndSend(deps, cfg.recipientUserId, opts.tomorrow ? addDays(today, 1) : today, opts.tomorrow ? 'tomorrow' : 'today')
}
