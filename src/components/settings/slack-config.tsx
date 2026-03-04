// src/components/settings/slack-config.tsx
// ============================================================
// SLACK CONFIGURATION PANEL
// Drop into the Settings page as a new Section
// Uses org_settings table (same as all other settings)
// ============================================================

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { Hash, Bot, Send, Loader2, Check, AlertCircle } from 'lucide-react'

export function SlackConfig() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [webhookUrl, setWebhookUrl] = useState('')
  const [botToken, setBotToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Load existing config from org_settings
  useEffect(() => {
    if (!currentOrg) return
    supabase
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', currentOrg.id)
      .eq('setting_key', 'slack_config')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.setting_value) {
          setWebhookUrl(data.setting_value.webhook_url || '')
          setBotToken(data.setting_value.bot_token || '')
          setEnabled(data.setting_value.enabled || false)
        }
      })
  }, [currentOrg?.id])

  // Save config to org_settings
  async function handleSave() {
    if (!currentOrg) return
    setSaving(true)
    setSaved(false)

    await supabase.from('org_settings').upsert({
      org_id: currentOrg.id,
      setting_key: 'slack_config',
      setting_value: {
        webhook_url: webhookUrl,
        bot_token: botToken,
        enabled,
      },
    }, { onConflict: 'org_id,setting_key' })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Test webhook or bot token via server-side API route
  async function handleTest(type: 'test_webhook' | 'test_bot') {
    if (!currentOrg) return
    setTesting(type)
    setTestResult(null)

    try {
      const res = await fetch('/api/slack/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: type,
          org_id: currentOrg.id,
          webhook_url: webhookUrl,
          bot_token: botToken,
        }),
      })
      const data = await res.json()
      setTestResult({ ok: data.success, msg: data.message || (data.success ? 'Connected!' : 'Failed') })
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Enable Slack Notifications</p>
          <p className="text-xs text-gray-400">Task assignments, column moves, RACI changes, @mentions</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-[#2A9D8F]' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Webhook URL */}
      <div>
        <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5 mb-1">
          <Hash size={12} /> Webhook URL
          <span className="text-gray-400 font-normal">(channel posts)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#386797]/30 placeholder-gray-300"
          />
          <button
            onClick={() => handleTest('test_webhook')}
            disabled={!webhookUrl || testing === 'test_webhook'}
            className="px-3 py-2 text-xs font-medium text-[#2A9D8F] bg-[#2A9D8F]/10 rounded-lg hover:bg-[#2A9D8F]/20 disabled:opacity-40 transition-colors flex items-center gap-1"
          >
            {testing === 'test_webhook' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Test
          </button>
        </div>
      </div>

      {/* Bot Token */}
      <div>
        <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5 mb-1">
          <Bot size={12} /> Bot Token
          <span className="text-gray-400 font-normal">(DMs to assignees)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={botToken}
            onChange={e => setBotToken(e.target.value)}
            placeholder="xoxb-..."
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#386797]/30 placeholder-gray-300 font-mono"
          />
          <button
            onClick={() => handleTest('test_bot')}
            disabled={!botToken || testing === 'test_bot'}
            className="px-3 py-2 text-xs font-medium text-[#2A9D8F] bg-[#2A9D8F]/10 rounded-lg hover:bg-[#2A9D8F]/20 disabled:opacity-40 transition-colors flex items-center gap-1"
          >
            {testing === 'test_bot' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Test
          </button>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
          testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {testResult.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
          {testResult.msg}
        </div>
      )}

      {/* Member mapping note */}
      <div className="bg-gray-50 rounded-lg px-3 py-2">
        <p className="text-xs text-gray-500">
          Slack user IDs for each team member are configured in <strong>Team → Member Detail → Slack section</strong>.
          Find a member's Slack ID by clicking their profile in Slack → three dots → "Copy member ID".
        </p>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 text-xs font-semibold text-white bg-[#386797] rounded-lg hover:bg-[#2d5479] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Slack Settings'}
      </button>
    </div>
  )
}
