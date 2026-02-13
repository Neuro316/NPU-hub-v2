'use client'

import { useState } from 'react'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { useWorkspace } from '@/lib/workspace-context'
import { MessageSquare, Calendar, Mail, CheckSquare, ChevronDown, ChevronUp, ExternalLink, Zap, Globe, FolderOpen, FileText, Loader2, Check, X } from 'lucide-react'

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
  const appsScriptConfig = getSetting('apps_script') as any || {}

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; caps?: string[] } | null>(null)

  const testConnection = async () => {
    const url = appsScriptConfig.url?.trim()
    if (!url) { setTestResult({ ok: false, msg: 'Enter a URL first' }); return }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(url + '?t=' + Date.now())
      const data = await res.json()
      if (data.success || data.status === 'ok') {
        setTestResult({ ok: true, msg: 'Connected! ' + (data.service || 'Apps Script'), caps: data.capabilities })
      } else {
        setTestResult({ ok: false, msg: data.error || 'Unexpected response' })
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: 'Connection failed: ' + (err.message || 'Network error') })
    }
    setTesting(false)
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading integrations...</div></div>
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

        {/* Google Apps Script - PRIMARY integration */}
        <IntegrationCard
          icon={Globe}
          name="Google Apps Script"
          description="Powers Gmail emails, Drive folders, Google Docs sync, and ShipIt export"
          color="#0F9D58"
          connected={!!appsScriptConfig.enabled}
        >
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-100 rounded-lg p-3">
              <p className="text-[10px] font-bold text-green-700 mb-1">This is the master integration</p>
              <p className="text-[10px] text-green-600 leading-relaxed">
                One Apps Script URL powers everything: Send Resources emails, ShipIt Journal Google Doc sync, Drive folder creation, and more.
                Deploy the Code.gs file from the google-apps-script folder in your repo.
              </p>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Web App URL</label>
              <input
                value={appsScriptConfig.url || ''}
                onChange={e => saveSetting('apps_script', { ...appsScriptConfig, url: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={testConnection} disabled={testing}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 disabled:opacity-50 flex items-center gap-1.5">
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={() => saveSetting('apps_script', { ...appsScriptConfig, enabled: !appsScriptConfig.enabled })}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${appsScriptConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                {appsScriptConfig.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>

            {testResult && (
              <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {testResult.ok ? <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="font-medium">{testResult.msg}</p>
                  {testResult.caps && (
                    <p className="text-[10px] mt-1 opacity-80">Capabilities: {testResult.caps.join(', ')}</p>
                  )}
                </div>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-500 leading-relaxed">
              <p className="font-bold text-gray-600 mb-1">When connected, these features activate:</p>
              <div className="space-y-0.5">
                <p>&#10003; Send Resources emails from Journey Cards via Gmail</p>
                <p>&#10003; ShipIt Journal export to Google Docs</p>
                <p>&#10003; Auto-create Drive folders per ShipIt project</p>
                <p>&#10003; Bi-directional doc sync (push changes / pull edits back)</p>
                <p>&#10003; Branded HTML email templates with NP styling</p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-[10px] font-bold text-blue-700 mb-1">Setup Steps</p>
              <ol className="text-[10px] text-blue-600 space-y-0.5 list-decimal pl-3">
                <li>Go to script.google.com and create a new project</li>
                <li>Paste Code.gs from the google-apps-script folder</li>
                <li>Deploy as Web App (Execute as: Me, Access: Anyone)</li>
                <li>Copy the URL and paste above</li>
                <li>Click "Test Connection" to verify</li>
                <li>Click "Enable" to activate</li>
              </ol>
            </div>
          </div>
        </IntegrationCard>

        {/* Gmail (powered by Apps Script) */}
        <IntegrationCard
          icon={Mail}
          name="Gmail"
          description="Send branded resource emails from Journey Cards"
          color="#EA4335"
          connected={!!appsScriptConfig.enabled}
        >
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-[10px] text-green-700">
              <p className="font-bold mb-0.5">Powered by Google Apps Script</p>
              <p>Gmail sending is handled by the unified Apps Script integration above. When Apps Script is connected, the "Email" button on Journey Cards will send branded HTML emails via your Gmail account.</p>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Default Sender Name</label>
              <input value={gmailConfig.sender_name || 'Cameron Allen'}
                onChange={e => saveSetting('gmail', { ...gmailConfig, sender_name: e.target.value })}
                placeholder="Cameron Allen"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Default Sender Email</label>
              <input value={gmailConfig.sender_email || 'cameron.allen@neuroprogeny.com'}
                onChange={e => saveSetting('gmail', { ...gmailConfig, sender_email: e.target.value })}
                placeholder="cameron.allen@neuroprogeny.com"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div className="text-[10px] text-gray-500 leading-relaxed">
              <p className="font-bold text-gray-600 mb-1">Email is used in:</p>
              <p>&#10003; Journey Cards → Email selected resources to participants</p>
              <p>&#10003; Branded HTML template with NP colors and logo</p>
              <p>&#10003; Personal note field and resource links</p>
            </div>
          </div>
        </IntegrationCard>

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
              <input value={slackConfig.webhook_url || ''}
                onChange={e => saveSetting('slack_config', { ...slackConfig, webhook_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Bot Token</label>
              <input value={slackConfig.bot_token || ''}
                onChange={e => saveSetting('slack_config', { ...slackConfig, bot_token: e.target.value })}
                placeholder="xoxb-..." type="password"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => saveSetting('slack_config', { ...slackConfig, enabled: !slackConfig.enabled })}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${slackConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                {slackConfig.enabled ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => {
                fetch(slackConfig.webhook_url, { method: 'POST', body: JSON.stringify({ text: 'NPU Hub Slack test!' }) })
                  .then(() => alert('Test message sent!')).catch(() => alert('Failed'))
              }} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#4A154B] text-white hover:opacity-90">
                Send Test
              </button>
            </div>
          </div>
        </IntegrationCard>

        {/* Google Calendar */}
        <IntegrationCard
          icon={Calendar}
          name="Google Calendar"
          description="Sync task due dates and ship dates to calendars"
          color="#4285F4"
          connected={!!calendarConfig.enabled}
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Tasks with due dates and ShipIt ship dates will create calendar events.</p>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Google OAuth Client ID</label>
              <input value={calendarConfig.client_id || ''}
                onChange={e => saveSetting('google_calendar', { ...calendarConfig, client_id: e.target.value })}
                placeholder="Your Google OAuth client ID"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <button onClick={() => saveSetting('google_calendar', { ...calendarConfig, enabled: !calendarConfig.enabled })}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg ${calendarConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
              {calendarConfig.enabled ? 'Disable' : 'Enable'}
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
