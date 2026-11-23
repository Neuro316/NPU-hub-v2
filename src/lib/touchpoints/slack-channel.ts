// src/lib/touchpoints/slack-channel.ts
// The unanswered text alert's Slack path: the SAME Slack app connection as the daily Touchpoints DM and the lead alerts
// (org_settings slack_config.bot_token, in Vault; src/lib/lead-alerts/senders.ts), posting to a channel id instead of
// a person. Server only. The token is never logged or returned; results carry Slack's error codes only.
//
//   postToChannel  chat.postMessage to the channel (needs chat:write, and the app must be a member of a private channel)
//   checkChannel   auth.test (no scope) and conversations.info (a private channel needs groups:read), to tell whether
//                  the app can post there before it ever does
import { createAdminSupabase } from '@/lib/supabase'
import { readOrgSetting } from '../org-vault'

const clean = (s: unknown) => String(s ?? '').replace(/[^\w.-]/g, '').slice(0, 60)

async function token(orgId: string): Promise<{ token: string | null; code: string | null }> {
  const db = createAdminSupabase()
  const v = await readOrgSetting<any>(db, orgId, 'slack_config').catch((e: Error) => ({ __err: e.message.split(': ').pop() ?? 'unknown' }))
  if (v && (v as any).__err) return { token: null, code: `read_${clean((v as any).__err)}` }
  const t = typeof (v as any)?.bot_token === 'string' ? (v as any).bot_token : ''
  if (!v || ((v as any).enabled !== true && (v as any).enabled !== 'true') || !t) return { token: null, code: 'slack_not_configured' }
  return { token: t, code: null }
}

async function call(t: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  })
  return res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))
}

export async function postToChannel(orgId: string, channel: string, text: string): Promise<{ ok: boolean; code: string | null }> {
  const t = await token(orgId)
  if (!t.token) return { ok: false, code: t.code }
  try {
    const j = await call(t.token, 'chat.postMessage', { channel, text, unfurl_links: false, unfurl_media: false })
    return j?.ok ? { ok: true, code: null } : { ok: false, code: `slack_${clean(j?.error)}` }
  } catch {
    return { ok: false, code: 'slack_network' }
  }
}

export interface ChannelCheck {
  configured: boolean
  auth: string
  /** the bot's granted scopes, as Slack reports them on auth.test (names only) */
  scopes: string[]
  channel: string
  is_private: boolean | null
  is_member: boolean | null
  can_post: boolean
  needs: string | null
}

/** Whether the Hub's Slack app can post to the channel, and if not, exactly what is missing. Posts nothing. */
export async function checkChannel(orgId: string, channel: string): Promise<ChannelCheck> {
  const out: ChannelCheck = { configured: false, auth: 'not_run', scopes: [], channel: 'not_run', is_private: null, is_member: null, can_post: false, needs: null }
  const t = await token(orgId)
  if (!t.token) return { ...out, auth: t.code ?? 'slack_not_configured', needs: 'a Slack app connection for this org (slack_config)' }
  out.configured = true
  try {
    const res = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } })
    const a: any = await res.json().catch(() => ({}))
    out.auth = a?.ok ? 'ok' : clean(a?.error)
    out.scopes = String(res.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!a?.ok) return { ...out, needs: 'a valid bot token' }
    const c = await call(t.token, 'conversations.info', { channel })
    if (!c?.ok) {
      out.channel = clean(c?.error)
      out.needs = c?.error === 'missing_scope' ? `scope ${clean(c?.needed) || 'groups:read'} (to read the channel; posting itself needs chat:write)`
        : c?.error === 'channel_not_found' ? 'the app invited to the private channel (a private channel is invisible to an app that is not a member)' : null
    } else {
      out.channel = 'ok'
      out.is_private = !!c.channel?.is_private
      out.is_member = !!c.channel?.is_member
    }
    // no scope header means Slack did not say: membership decides, and the first real post confirms chat:write
    const hasWrite = out.scopes.length === 0 || out.scopes.includes('chat:write')
    out.can_post = hasWrite && out.is_member === true
    if (!out.needs && !hasWrite) out.needs = 'scope chat:write'
    if (!out.needs && out.is_member === false) out.needs = 'the app invited to the channel (/invite in #np-follow-ups)'
    return out
  } catch {
    return { ...out, auth: 'slack_network' }
  }
}
