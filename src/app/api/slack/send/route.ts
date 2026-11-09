// src/app/api/slack/send/route.ts
// Server-side Slack proxy: the browser asks, this route posts with the org's STORED webhook or bot token.
//
// Guarded (2026-11-08): the caller must be Hub staff in the org they name (withStaff + requireOrg). It posts only to
// the org's own stored webhook and bot token, never to a URL or token named in the request, and never returns either.
// The bot token is read from Vault (src/lib/org-vault.ts). A DM goes only to a Slack user id held by a team profile
// of that org.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { readOrgSetting } from '@/lib/org-vault'

export const dynamic = 'force-dynamic'

const on = (v: unknown) => v === true || v === 'true'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as any))
  const { action, text, blocks, slack_user_id } = body ?? {}
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (typeof action !== 'string') return bad('Missing action.')

  let config: any
  try {
    config = await readOrgSetting<any>(ctx.db, orgId, 'slack_config')
  } catch {
    return NextResponse.json({ error: 'Slack settings could not be read.' }, { status: 503 })
  }
  if (!config || !on(config.enabled)) return NextResponse.json({ message: 'Slack not enabled' }, { status: 200 })
  const webhook = typeof config.webhook_url === 'string' ? config.webhook_url : ''
  const token = typeof config.bot_token === 'string' ? config.bot_token : ''

  try {
    if (action === 'webhook' || action === 'channel') {
      if (!webhook) return bad('No webhook URL configured.')
      if (typeof text !== 'string' || !text) return bad('Missing text.')
      const res = await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.isArray(blocks) ? { text, blocks } : { text }),
      })
      return NextResponse.json({ success: res.ok })
    }

    if (action === 'dm') {
      if (!token) return bad('No bot token configured.')
      if (typeof slack_user_id !== 'string' || !/^[A-Z0-9]{6,20}$/.test(slack_user_id)) return bad('No slack_user_id provided.')
      if (typeof text !== 'string' || !text) return bad('Missing text.')
      const { data: tp } = await ctx.db.from('team_profiles').select('id').eq('org_id', orgId).eq('slack_user_id', slack_user_id).limit(1)
      if (!tp?.length) return NextResponse.json({ error: 'That Slack user is not on this team.' }, { status: 403 })
      const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: slack_user_id, text }),
      })
      const msgData = await msgRes.json().catch(() => ({}))
      return NextResponse.json({ success: !!msgData.ok, error: msgData.error || null })
    }

    // tests use the stored values only; a URL or token in the request is ignored
    if (action === 'test_webhook') {
      if (!webhook) return NextResponse.json({ success: false, message: 'No webhook URL saved.' })
      const res = await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'NPU Hub Slack integration connected successfully' }),
      })
      return NextResponse.json({ success: res.ok, message: res.ok ? 'Webhook test sent! Check your Slack channel.' : 'Webhook failed. Check the saved URL.' })
    }

    if (action === 'test_bot') {
      if (!token) return NextResponse.json({ success: false, message: 'No bot token saved.' })
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      return NextResponse.json({
        success: !!data.ok,
        message: data.ok ? `Bot connected as "${data.user}" in workspace "${data.team}"` : `Bot token invalid: ${data.error}`,
      })
    }

    return bad(`Unknown action: ${action}`)
  } catch (e: any) {
    console.error(`[slack/send] ${action} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Slack could not be reached.' }, { status: 502 })
  }
})
