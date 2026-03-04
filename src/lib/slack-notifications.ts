// src/lib/slack-notifications.ts
// ============================================================
// SLACK NOTIFICATIONS - UPDATED TO USE SERVER-SIDE API ROUTE
// Fixes CORS issue by routing through /api/slack/send
// ============================================================

import { createClient } from '@/lib/supabase-browser'

interface SlackConfig {
  webhook_url: string
  bot_token: string
  enabled: boolean
}

interface TeamMemberSlack {
  display_name: string
  slack_user_id: string | null
}

// Get Slack config for the current org
async function getSlackConfig(orgId: string): Promise<SlackConfig | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'slack_config')
    .single()
  if (!data?.setting_value?.enabled) return null
  return data.setting_value as SlackConfig
}

// Get Slack user ID for a team member by display name
async function getSlackUserId(orgId: string, displayName: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('team_profiles')
    .select('slack_user_id')
    .eq('org_id', orgId)
    .eq('display_name', displayName)
    .single()
  return data?.slack_user_id || null
}

// Send channel message via server-side API route (avoids CORS)
async function sendChannelMessage(orgId: string, text: string, blocks?: any[]) {
  try {
    await fetch('/api/slack/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'channel',
        org_id: orgId,
        text,
        blocks,
      }),
    })
  } catch (e) {
    console.error('Slack channel message failed:', e)
  }
}

// Send DM via server-side API route (avoids CORS)
async function sendDM(orgId: string, slackUserId: string, text: string) {
  try {
    await fetch('/api/slack/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dm',
        org_id: orgId,
        slack_user_id: slackUserId,
        text,
      }),
    })
  } catch (e) {
    console.error('Slack DM failed:', e)
  }
}

// ============================================================
// PUBLIC NOTIFICATION FUNCTIONS
// (Same signatures as before - no changes needed in calling code)
// ============================================================

export async function notifyTaskAssigned(
  orgId: string,
  taskTitle: string,
  taskId: string,
  assignee: string,
  actor: string,
) {
  const config = await getSlackConfig(orgId)
  if (!config) return

  const taskUrl = `https://hub.neuroprogeny.com/tasks?task=${taskId}`

  // Channel message
  await sendChannelMessage(
    orgId,
    `📋 *${actor}* assigned *${taskTitle}* to *${assignee}*\n→ <${taskUrl}|Open Task>`
  )

  // DM to assignee
  if (assignee !== actor) {
    const slackId = await getSlackUserId(orgId, assignee)
    if (slackId) {
      await sendDM(
        orgId,
        slackId,
        `📋 *${actor}* assigned you to task *${taskTitle}*\n→ <${taskUrl}|Open Task>`
      )
    }
  }
}

export async function notifyTaskMoved(
  orgId: string,
  taskTitle: string,
  taskId: string,
  fromColumn: string,
  toColumn: string,
  actor: string,
  assignee: string | null,
  raciRoles: Record<string, string>,
) {
  const config = await getSlackConfig(orgId)
  if (!config) return

  const taskUrl = `https://hub.neuroprogeny.com/tasks?task=${taskId}`

  // Channel message
  await sendChannelMessage(
    orgId,
    `🔄 *${actor}* moved *${taskTitle}* from ${fromColumn} → *${toColumn}*\n→ <${taskUrl}|Open Task>`
  )

  // Collect unique people to notify
  const toNotify = new Set<string>()
  if (assignee && assignee !== actor) toNotify.add(assignee)
  Object.values(raciRoles).forEach(name => {
    if (name && name !== actor) toNotify.add(name)
  })

  // Send DMs
  for (const person of Array.from(toNotify)) {
    const slackId = await getSlackUserId(orgId, person)
    if (slackId) {
      await sendDM(
        orgId,
        slackId,
        `🔄 *${actor}* moved *${taskTitle}* from ${fromColumn} → *${toColumn}*\n→ <${taskUrl}|Open Task>`
      )
    }
  }
}

export async function notifyRACIAssigned(
  orgId: string,
  taskTitle: string,
  taskId: string,
  raciRole: string,
  assignedTo: string,
  actor: string,
) {
  const config = await getSlackConfig(orgId)
  if (!config) return

  const taskUrl = `https://hub.neuroprogeny.com/tasks?task=${taskId}`
  const roleLabel = raciRole.charAt(0).toUpperCase() + raciRole.slice(1)
  const roleEmoji = raciRole === 'responsible' ? '🎯' : raciRole === 'accountable' ? '✅' : raciRole === 'consulted' ? '💬' : 'ℹ️'

  // Channel message
  await sendChannelMessage(
    orgId,
    `${roleEmoji} *${actor}* assigned *${assignedTo}* as *${roleLabel}* (RACI) on *${taskTitle}*\n→ <${taskUrl}|Open Task>`
  )

  // DM to the person assigned the RACI role
  if (assignedTo !== actor) {
    const slackId = await getSlackUserId(orgId, assignedTo)
    if (slackId) {
      await sendDM(
        orgId,
        slackId,
        `${roleEmoji} *${actor}* assigned you as *${roleLabel}* (RACI) on task *${taskTitle}*\n→ <${taskUrl}|Open Task>`
      )
    }
  }
}

export async function notifyTaskCreated(
  orgId: string,
  taskTitle: string,
  taskId: string,
  columnName: string,
  assignee: string | null,
  actor: string,
) {
  const config = await getSlackConfig(orgId)
  if (!config) return

  const taskUrl = `https://hub.neuroprogeny.com/tasks?task=${taskId}`
  const assignText = assignee ? ` → assigned to *${assignee}*` : ''

  await sendChannelMessage(
    orgId,
    `🆕 *${actor}* created task *${taskTitle}* in ${columnName}${assignText}\n→ <${taskUrl}|Open Task>`
  )

  if (assignee && assignee !== actor) {
    const slackId = await getSlackUserId(orgId, assignee)
    if (slackId) {
      await sendDM(
        orgId,
        slackId,
        `🆕 *${actor}* created and assigned task *${taskTitle}* to you\n→ <${taskUrl}|Open Task>`
      )
    }
  }
}

export async function notifyCommentMention(
  orgId: string,
  taskTitle: string,
  taskId: string,
  mentionedName: string,
  author: string,
  commentPreview: string,
) {
  const config = await getSlackConfig(orgId)
  if (!config) return

  const taskUrl = `https://hub.neuroprogeny.com/tasks?task=${taskId}`
  const slackId = await getSlackUserId(orgId, mentionedName)
  if (!slackId) return

  await sendDM(
    orgId,
    slackId,
    `💬 *${author}* mentioned you in task *${taskTitle}*:\n> ${commentPreview.slice(0, 200)}\n→ <${taskUrl}|Open Task>`
  )
}
