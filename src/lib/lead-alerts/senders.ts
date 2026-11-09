// src/lib/lead-alerts/senders.ts
// The two real channels for a speed-to-lead alert. Both reach ONE person: the staff member whose user id is the
// configured recipient. Neither accepts an address from the caller.
//
//   slack  a DM from the org's Slack bot (org_settings slack_config.bot_token, in Vault) to the recipient's slack_user_id
//          (team_profiles). Slack pushes it to the phone.
//   sms    sendNotifySms: the recipient's own profile phone, the consent gate, the Primary line.
//
// The bot token is never logged; results carry codes only.
import { createAdminSupabase } from '@/lib/supabase'
import { readOrgSetting } from '../org-vault'
import { sendNotifySms } from '@/lib/notify-sms'
import type { Senders } from './run'

export const realSenders: Senders = {
  async slack(orgId, userId, text) {
    const db = createAdminSupabase()
    // bot_token lives in Vault (src/lib/org-vault.ts)
    const [cfg, { data: tp, error: tErr }] = await Promise.all([
      readOrgSetting<any>(db, orgId, 'slack_config').then((v) => ({ v, code: null as string | null }), (e: Error) => ({ v: null, code: e.message.split(': ').pop() ?? 'unknown' })),
      db.from('team_profiles').select('slack_user_id').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
    ])
    if (cfg.code || tErr) return { ok: false, code: `read_${cfg.code ?? tErr?.code ?? 'unknown'}` }
    const v = cfg.v
    const token = typeof v?.bot_token === 'string' ? v.bot_token : ''
    const slackUser = (tp as any)?.slack_user_id as string | null
    if (!v || (v.enabled !== true && v.enabled !== 'true') || !token) return { ok: false, code: 'slack_not_configured' }
    if (!slackUser) return { ok: false, code: 'no_slack_user' }
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: slackUser, text, unfurl_links: false }),
      })
      const j: any = await res.json().catch(() => ({}))
      return j?.ok ? { ok: true, code: null } : { ok: false, code: `slack_${String(j?.error ?? res.status).replace(/[^\w-]/g, '').slice(0, 40)}` }
    } catch {
      return { ok: false, code: 'slack_network' }
    }
  },
  async sms(orgId, userId, text) {
    const r = await sendNotifySms({ user_id: userId, body: text, org_id: orgId })
    if (r.sent) return { ok: true, retry: false, code: null }
    // a partial send is final; a transient failure with nothing sent may be retried
    const retry = r.statusClass === 'transient' && r.sent_parts === 0
    return { ok: false, retry, code: (r.error_code ?? r.reason ?? r.statusClass).slice(0, 60) }
  },
}
