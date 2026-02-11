'use client'

import { useState } from 'react'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { useWorkspace } from '@/lib/workspace-context'
import { MessageSquare, Calendar, Mail, CheckSquare, ChevronDown, ChevronUp, ExternalLink, Zap } from 'lucide-react'

interface IntegrationCardProps {
  icon: any
  name: string
  description: string
  color: string
  connected: boolean
  children: React.ReactNode
}

function IntegrationCard({ icon: Icon, name, description, color, connected, children }: IntegrationCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + '15' }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-np-dark">{name}</span>
            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${connected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
              {connected ? 'Connected' : 'Not Connected'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-gray-50">
          {children}
        </div>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { getSetting, saveSetting, isSuperAdmin, loading } = useTeamData()

  const slackConfig = getSetting('slack_config') as any || {}
  const calendarConfig = getSetting('google_calendar') as any || {}
  const gmailConfig = getSetting('gmail') as any || {}

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading integrations...</div>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-16">
        <Zap className="w-12 h-12 text-gray-200 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-np-dark mb-2">Integrations</h2>
        <p className="text-sm text-gray-500">Only Super Admins can configure integrations.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-np-dark">Integrations</h1>
        <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Connect external services</p>
      </div>

      <div className="space-y-3 max-w-2xl">

        {/* Slack */}
        <IntegrationCard
          icon={MessageSquare}
          name="Slack"
          description="Task notifications, @mentions, and DMs to your team"
          color="#4A154B"
          connected={!!slackConfig.enabled}
        >
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Webhook URL</label>
              <input
                value={slackConfig.webhook_url || ''}
                onChange={e => saveSetting('slack_config', { ...slackConfig, webhook_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Bot Token</label>
              <input
                value={slackConfig.bot_token || ''}
                onChange={e => saveSetting('slack_config', { ...slackConfig, bot_token: e.target.value })}
                placeholder="xoxb-..."
                type="password"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Notifications</label>
              <div className="space-y-1 text-xs text-gray-600">
                <p>✅ Task assigned → channel + DM to assignee</p>
                <p>✅ Task moved → channel + DM to assignee & RACI roles</p>
                <p>✅ RACI role assigned → channel + DM with role type</p>
                <p>✅ @mention in comments → DM to mentioned person</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => saveSetting('slack_config', { ...slackConfig, enabled: !slackConfig.enabled })}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${slackConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                {slackConfig.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => {
                  fetch(slackConfig.webhook_url, {
                    method: 'POST',
                    body: JSON.stringify({ text: '✅ NPU Hub Slack integration test successful!' }),
                  }).then(() => alert('Test message sent!')).catch(() => alert('Failed to send test'))
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#4A154B] text-white hover:opacity-90">
                Send Test
              </button>
            </div>
          </div>
        </IntegrationCard>

        {/* Google Calendar */}
        <IntegrationCard
          icon={Calendar}
          name="Google Calendar"
          description="Sync task due dates to team members' calendars"
          color="#4285F4"
          connected={!!calendarConfig.enabled}
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              When enabled, tasks with due dates will automatically create calendar events
              for the assigned team member.
            </p>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Google OAuth Client ID</label>
              <input
                value={calendarConfig.client_id || ''}
                onChange={e => saveSetting('google_calendar', { ...calendarConfig, client_id: e.target.value })}
                placeholder="Your Google OAuth client ID"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <button
              onClick={() => saveSetting('google_calendar', { ...calendarConfig, enabled: !calendarConfig.enabled })}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg ${calendarConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
              {calendarConfig.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </IntegrationCard>

        {/* Gmail */}
        <IntegrationCard
          icon={Mail}
          name="Gmail"
          description="Send resources and notifications via email"
          color="#EA4335"
          connected={!!gmailConfig.enabled}
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Send journey card assets and task notifications via Gmail.
              Uses the configured sender email for outbound messages.
            </p>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Default Sender Email</label>
              <input
                value={gmailConfig.sender_email || ''}
                onChange={e => saveSetting('gmail', { ...gmailConfig, sender_email: e.target.value })}
                placeholder="cameron.allen@gmail.com"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Apps Script Webhook URL</label>
              <input
                value={gmailConfig.apps_script_url || ''}
                onChange={e => saveSetting('gmail', { ...gmailConfig, apps_script_url: e.target.value })}
                placeholder="https://script.google.com/macros/s/..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <button
              onClick={() => saveSetting('gmail', { ...gmailConfig, enabled: !gmailConfig.enabled })}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg ${gmailConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
              {gmailConfig.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </IntegrationCard>

        {/* Google Tasks */}
        <IntegrationCard
          icon={CheckSquare}
          name="Google Tasks"
          description="Sync kanban tasks with Google Tasks"
          color="#1AA260"
          connected={false}
        >
          <div className="py-4 text-center">
            <p className="text-xs text-gray-400">Coming soon. Two-way sync between NPU Hub tasks and Google Tasks.</p>
          </div>
        </IntegrationCard>

      </div>
    </div>
  )
}
