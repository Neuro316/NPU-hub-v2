// src/app/api/slack/send/route.ts
// ============================================================
// SERVER-SIDE SLACK PROXY
// Solves the CORS issue - browser calls this route,
// this route calls Slack APIs server-side.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, org_id, text, blocks, slack_user_id } = body

    if (!org_id) {
      return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })
    }

    // Get Slack config from org_settings
    const { data: configRow } = await supabaseAdmin
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', org_id)
      .eq('setting_key', 'slack_config')
      .single()

    const config = configRow?.setting_value
    if (!config?.enabled) {
      return NextResponse.json({ message: 'Slack not enabled' }, { status: 200 })
    }

    // --- WEBHOOK: Post to channel ---
    if (action === 'webhook' || action === 'channel') {
      if (!config.webhook_url) {
        return NextResponse.json({ error: 'No webhook URL configured' }, { status: 400 })
      }

      const res = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blocks ? { text, blocks } : { text }),
      })

      return NextResponse.json({ success: res.ok })
    }

    // --- DM: Send direct message via bot token ---
    if (action === 'dm') {
      if (!config.bot_token) {
        return NextResponse.json({ error: 'No bot token configured' }, { status: 400 })
      }
      if (!slack_user_id) {
        return NextResponse.json({ error: 'No slack_user_id provided' }, { status: 400 })
      }

      // Send message (using user ID as channel works for DMs)
      const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.bot_token}`,
        },
        body: JSON.stringify({
          channel: slack_user_id,
          text,
        }),
      })
      const msgData = await msgRes.json()

      return NextResponse.json({
        success: msgData.ok,
        error: msgData.error || null,
      })
    }

    // --- TEST: Verify webhook or bot token ---
    if (action === 'test_webhook') {
      const testUrl = body.webhook_url || config.webhook_url
      if (!testUrl) {
        return NextResponse.json({ success: false, message: 'No webhook URL' })
      }

      const res = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'NPU Hub Slack integration connected successfully',
        }),
      })

      return NextResponse.json({
        success: res.ok,
        message: res.ok ? 'Webhook test sent! Check your Slack channel.' : 'Webhook failed. Verify the URL.',
      })
    }

    if (action === 'test_bot') {
      const testToken = body.bot_token || config.bot_token
      if (!testToken) {
        return NextResponse.json({ success: false, message: 'No bot token' })
      }

      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
        },
      })
      const data = await res.json()

      return NextResponse.json({
        success: data.ok,
        message: data.ok
          ? `Bot connected as "${data.user}" in workspace "${data.team}"`
          : `Bot token invalid: ${data.error}`,
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error('Slack proxy error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
