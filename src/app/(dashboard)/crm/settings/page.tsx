'use client'

import { useEffect, useState } from 'react'
import {
  Mail, Phone, Brain, Shield, Bell, Users, Sliders,
  Save, Plus, X, Trash2, CheckCircle2, AlertTriangle
} from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

type Section = 'email' | 'twilio' | 'ai' | 'pipeline' | 'team' | 'notifications' | 'compliance' | 'general'

const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'twilio', label: 'Twilio / SMS', icon: Phone },
  { id: 'ai', label: 'AI Integration', icon: Brain },
  { id: 'pipeline', label: 'Pipeline', icon: Sliders },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'compliance', label: 'Compliance', icon: Shield },
]

type NumberPurpose = 'outreach' | 'client_relations' | 'appointments' | 'inbound_main' | 'general'
const NUMBER_PURPOSES: { value: NumberPurpose; label: string; desc: string }[] = [
  { value: 'outreach', label: 'Outreach', desc: 'Cold outreach, campaigns, sequences' },
  { value: 'client_relations', label: 'Client Relations', desc: 'Enrolled clients, support' },
  { value: 'appointments', label: 'Appointments', desc: 'Reminders, scheduling' },
  { value: 'inbound_main', label: 'Inbound Main Line', desc: 'Primary reception number' },
  { value: 'general', label: 'General', desc: 'Fallback for everything' },
]
interface TwilioNumber { phone: string; nickname: string; purpose: NumberPurpose }

export default function SettingsPage() {
  const { currentOrg } = useWorkspace()
  const [active, setActive] = useState<Section>('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [twilioTest, setTwilioTest] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null })

  // Settings state
  const [email, setEmail] = useState({ sending_email: '', sending_name: '', daily_limit: 500, provider: 'gmail_workspace', warmup: true })
  const [twilio, setTwilio] = useState({ account_sid: '', auth_token: '', messaging_service_sid: '', api_key: '', api_secret: '', twiml_app_sid: '' })
  const [twilioNumbers, setTwilioNumbers] = useState<TwilioNumber[]>([{ phone: '', nickname: 'Primary', purpose: 'general' }])
  const [ai, setAi] = useState({
    anthropic_key: '', openai_key: '', gemini_key: '',
    call_summaries: true, smart_replies: true, sentiment: true, task_gen: true,
  })
  const [pipeline, setPipeline] = useState({ stages: 'New Lead,Contacted,Qualified,Proposal,Negotiation,Won,Lost' })
  const [compliance, setCompliance] = useState({ double_optin: false, auto_dnc_unsubscribe: true, retention_days: 365 })
  const [notifications, setNotifications] = useState({ new_lead: true, missed_call: true, task_overdue: true, campaign_complete: true })

  // Load settings from Supabase
  useEffect(() => {
    if (!currentOrg) return
    const supabase = createClient()
    supabase.from('org_email_configs').select('*').eq('org_id', currentOrg.id).maybeSingle()
      .then(({ data }) => {
        if (data) setEmail({ sending_email: data.sending_email || '', sending_name: data.sending_name || '', daily_limit: data.daily_send_limit || 500, provider: data.provider || 'gmail_workspace', warmup: data.warmup_enabled ?? true })
      })
    // Load Twilio + other settings from org_settings
    supabase.from('org_settings').select('setting_key, setting_value').eq('org_id', currentOrg.id)
      .in('setting_key', ['crm_twilio', 'crm_ai', 'crm_compliance', 'crm_notifications'])
      .then(({ data }) => {
        data?.forEach(row => {
          const v = row.setting_value
          if (row.setting_key === 'crm_twilio' && v) {
            setTwilio({ account_sid: v.account_sid || '', auth_token: v.auth_token || '', messaging_service_sid: v.messaging_service_sid || '', api_key: v.api_key || '', api_secret: v.api_secret || '', twiml_app_sid: v.twiml_app_sid || '' })
            if (v.numbers?.length) setTwilioNumbers(v.numbers)
          }
          if (row.setting_key === 'crm_ai' && v) setAi(prev => ({ ...prev, ...v }))
          if (row.setting_key === 'crm_compliance' && v) setCompliance(prev => ({ ...prev, ...v }))
          if (row.setting_key === 'crm_notifications' && v) setNotifications(prev => ({ ...prev, ...v }))
        })
      })
  }, [currentOrg])

  const handleSave = async () => {
    if (!currentOrg) return
    setSaving(true)
    try {
      const supabase = createClient()
      if (active === 'email') {
        await supabase.from('org_email_configs').upsert({
          org_id: currentOrg.id, provider: email.provider,
          sending_email: email.sending_email, sending_name: email.sending_name,
          daily_send_limit: email.daily_limit, warmup_enabled: email.warmup,
          batch_size: 50, batch_delay_seconds: 10, is_verified: false,
        }, { onConflict: 'org_id' })
      }
      if (active === 'twilio') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_twilio',
          setting_value: { ...twilio, numbers: twilioNumbers },
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'ai') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_ai', setting_value: ai,
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'compliance') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_compliance', setting_value: compliance,
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'notifications') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_notifications', setting_value: notifications,
        }, { onConflict: 'org_id,setting_key' })
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e); alert('Failed to save settings') }
    finally { setSaving(false) }
  }

  const addTwilioNumber = () => setTwilioNumbers(prev => [...prev, { phone: '', nickname: '', purpose: 'general' as NumberPurpose }])
  const removeTwilioNumber = (i: number) => setTwilioNumbers(prev => prev.filter((_, idx) => idx !== i))

  return (
    <div className="flex gap-6 animate-in fade-in duration-300">
      {/* Section Nav */}
      <div className="w-48 flex-shrink-0 space-y-0.5">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              active === s.id ? 'bg-np-blue/8 text-np-blue border border-np-blue/20' : 'text-gray-500 hover:bg-gray-50 border border-transparent'
            }`}>
            <s.icon size={14} />{s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 max-w-2xl">
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          {/* General */}
          {active === 'general' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">General Settings</h3>
              <p className="text-xs text-gray-400">Organization-level CRM configuration.</p>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Organization Name</label>
                <input value={currentOrg?.name || ''} disabled className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg bg-gray-50" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Default Timezone</label>
                <select className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                </select>
              </div>

              {/* Data Backup */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-np-dark mb-1">Data Backup</h4>
                <p className="text-[10px] text-gray-400 mb-3">Download a full backup of all CRM data: contacts, tasks, calls, messages, campaigns, settings, and more. Your data in Supabase is safe across deployments, but regular backups are recommended.</p>
                <a
                  href="/api/backup"
                  download
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors"
                >
                  <Save size={13} /> Download Full Backup
                </a>
                <p className="text-[9px] text-gray-400 mt-2">Exports as JSON. Sensitive keys (Twilio tokens) are automatically redacted.</p>
              </div>
            </div>
          )}

          {/* Email */}
          {active === 'email' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Email Configuration</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sending Email</label>
                  <input value={email.sending_email} onChange={e => setEmail(p=>({...p,sending_email:e.target.value}))} placeholder="hello@neuroprogeny.com"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sending Name</label>
                  <input value={email.sending_name} onChange={e => setEmail(p=>({...p,sending_name:e.target.value}))} placeholder="Cameron Allen"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Provider</label>
                  <select value={email.provider} onChange={e => setEmail(p=>({...p,provider:e.target.value}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="gmail_workspace">Gmail Workspace</option><option value="resend">Resend</option><option value="smtp">SMTP</option>
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Daily Send Limit</label>
                  <input type="number" value={email.daily_limit} onChange={e => setEmail(p=>({...p,daily_limit:parseInt(e.target.value)||0}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" /></div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={email.warmup} onChange={e => setEmail(p=>({...p,warmup:e.target.checked}))} className="accent-teal w-3 h-3" />
                Enable warmup (gradually increase daily sends)
              </label>
            </div>
          )}

          {/* Twilio */}
          {active === 'twilio' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Twilio Configuration</h3>
              <p className="text-xs text-gray-400">Enter your Twilio credentials. Each organization can have its own account for complete separation.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account SID</label>
                  <input value={twilio.account_sid} onChange={e => setTwilio(p=>({...p,account_sid:e.target.value}))} placeholder="AC..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Auth Token</label>
                  <input type="password" value={twilio.auth_token} onChange={e => setTwilio(p=>({...p,auth_token:e.target.value}))} placeholder="••••••"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Messaging Service SID</label>
                <input value={twilio.messaging_service_sid} onChange={e => setTwilio(p=>({...p,messaging_service_sid:e.target.value}))} placeholder="MG..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>

              {/* Voice SDK */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-np-dark mb-2">Voice (Browser Calling)</h4>
                <p className="text-[10px] text-gray-400 mb-3">Required for making calls directly from the CRM. Create an API Key and TwiML App in your Twilio Console.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">API Key SID</label>
                    <input value={twilio.api_key} onChange={e => setTwilio(p=>({...p,api_key:e.target.value}))} placeholder="SK..."
                      className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                  <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">API Secret</label>
                    <input type="password" value={twilio.api_secret} onChange={e => setTwilio(p=>({...p,api_secret:e.target.value}))} placeholder="••••••"
                      className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                </div>
                <div className="mt-3"><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">TwiML App SID</label>
                  <input value={twilio.twiml_app_sid} onChange={e => setTwilio(p=>({...p,twiml_app_sid:e.target.value}))} placeholder="AP..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>

              {/* Phone Numbers */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone Numbers</label>
                  <button onClick={addTwilioNumber} className="flex items-center gap-1 text-[10px] text-np-blue font-medium hover:underline"><Plus size={10} /> Add Number</button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">Assign numbers for campaigns (outreach) or clients (relationship management).</p>
                <div className="space-y-2">
                  {twilioNumbers.map((num, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                      <input value={num.phone} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,phone:e.target.value} : n))}
                        placeholder="+18285551234" className="w-36 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white font-mono" />
                      <input value={num.nickname} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,nickname:e.target.value} : n))}
                        placeholder="Nickname" className="w-28 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white" />
                      <select value={num.purpose} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,purpose:e.target.value as NumberPurpose} : n))}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white">
                        {NUMBER_PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label} - {p.desc}</option>)}
                      </select>
                      {i > 0 && <button onClick={() => removeTwilioNumber(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Test Connection */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      if (!currentOrg) return
                      setTwilioTest({ loading: true, result: null })
                      try {
                        const res = await fetch('/api/twilio/test', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ org_id: currentOrg.id }),
                        })
                        const data = await res.json()
                        setTwilioTest({ loading: false, result: data })
                      } catch (e) {
                        setTwilioTest({ loading: false, result: { success: false, error: 'Network error' } })
                      }
                    }}
                    disabled={twilioTest.loading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-50 transition-colors"
                  >
                    {twilioTest.loading ? 'Testing...' : 'Test Connection'}
                  </button>
                  <p className="text-[10px] text-gray-400">Save first, then test to verify credentials</p>
                </div>

                {twilioTest.result && (
                  <div className={`mt-3 rounded-lg border p-3 ${twilioTest.result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <p className={`text-xs font-semibold mb-2 ${twilioTest.result.success ? 'text-green-700' : 'text-red-700'}`}>
                      {twilioTest.result.success ? '✓ Connected successfully' : '✗ ' + twilioTest.result.error}
                    </p>
                    {twilioTest.result.checks && (
                      <div className="space-y-1">
                        {Object.entries(twilioTest.result.checks).map(([key, val]) => {
                          if (key.startsWith('account_') || key.startsWith('messaging_name') || key.startsWith('number_details')) return null
                          const isOk = val === true
                          const isFail = val === false
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          return (
                            <div key={key} className="flex items-center gap-2 text-[10px]">
                              <span className={isOk ? 'text-green-600' : isFail ? 'text-red-500' : 'text-amber-500'}>
                                {isOk ? '✓' : isFail ? '✗' : '⚠'}
                              </span>
                              <span className="text-gray-600 font-medium">{label}:</span>
                              <span className="text-gray-500">{typeof val === 'string' ? val : isOk ? 'OK' : 'Not configured'}</span>
                            </div>
                          )
                        })}
                        {twilioTest.result.checks.account_name && (
                          <p className="text-[9px] text-gray-400 mt-1">Account: {twilioTest.result.checks.account_name}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Integration */}
          {active === 'ai' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">AI Integration</h3>
              <p className="text-xs text-gray-400">Configure AI providers and feature toggles for the entire platform.</p>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Claude API Key (Anthropic)</label>
                <input type="password" value={ai.anthropic_key} onChange={e => setAi(p=>({...p,anthropic_key:e.target.value}))} placeholder="sk-ant-..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">OpenAI / ChatGPT Key</label>
                  <input type="password" value={ai.openai_key} onChange={e => setAi(p=>({...p,openai_key:e.target.value}))} placeholder="sk-..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Gemini API Key</label>
                  <input type="password" value={ai.gemini_key} onChange={e => setAi(p=>({...p,gemini_key:e.target.value}))} placeholder="AI..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">AI Features</p>
                <div className="space-y-2">
                  {([
                    ['call_summaries', 'Call Summaries', 'Auto-generate summaries after calls end'],
                    ['smart_replies', 'Smart Replies', 'AI-suggested responses in messaging'],
                    ['sentiment', 'Sentiment Analysis', 'Track contact sentiment across interactions'],
                    ['task_gen', 'Auto Task Generation', 'Create follow-up tasks from call summaries'],
                  ] as const).map(([key, label, desc]) => (
                    <label key={key} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50/50 cursor-pointer">
                      <input type="checkbox" checked={(ai as any)[key]} onChange={e => setAi(p => ({ ...p, [key]: e.target.checked }))}
                        className="accent-teal w-3 h-3 mt-0.5" />
                      <div><p className="text-xs font-medium text-np-dark">{label}</p><p className="text-[10px] text-gray-400">{desc}</p></div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pipeline */}
          {active === 'pipeline' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Pipeline Stages</h3>
              <p className="text-xs text-gray-400">Comma-separated list of pipeline stages for your contacts.</p>
              <textarea value={pipeline.stages} onChange={e => setPipeline({ stages: e.target.value })} rows={3}
                className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              <div className="flex flex-wrap gap-1">
                {pipeline.stages.split(',').filter(Boolean).map(s => (
                  <span key={s} className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-np-blue/8 text-np-blue">{s.trim()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Team */}
          {active === 'team' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Team Management</h3>
              <p className="text-xs text-gray-400">Team members are managed from the main hub Team page. CRM team assignment uses the team_members table.</p>
              <a href="/team" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5">
                <Users size={12} /> Go to Team Settings
              </a>
            </div>
          )}

          {/* Notifications */}
          {active === 'notifications' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Notification Preferences</h3>
              <div className="space-y-2">
                {([
                  ['new_lead', 'New lead created'],
                  ['missed_call', 'Missed inbound call'],
                  ['task_overdue', 'Task past due date'],
                  ['campaign_complete', 'Campaign finished sending'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50/50 cursor-pointer">
                    <input type="checkbox" checked={(notifications as any)[key]} onChange={e => setNotifications(p => ({ ...p, [key]: e.target.checked }))}
                      className="accent-teal w-3 h-3" />
                    <span className="text-xs text-np-dark">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Compliance */}
          {active === 'compliance' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Compliance & Data</h3>
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100">
                <input type="checkbox" checked={compliance.double_optin} onChange={e => setCompliance(p=>({...p,double_optin:e.target.checked}))} className="accent-teal w-3 h-3" />
                <div><p className="text-xs font-medium text-np-dark">Double opt-in for email</p><p className="text-[10px] text-gray-400">Require confirmation before adding to email list</p></div>
              </label>
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100">
                <input type="checkbox" checked={compliance.auto_dnc_unsubscribe} onChange={e => setCompliance(p=>({...p,auto_dnc_unsubscribe:e.target.checked}))} className="accent-teal w-3 h-3" />
                <div><p className="text-xs font-medium text-np-dark">Auto-DNC on unsubscribe</p><p className="text-[10px] text-gray-400">Automatically add to Do Not Contact list when someone unsubscribes</p></div>
              </label>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Data Retention (days)</label>
                <input type="number" value={compliance.retention_days} onChange={e => setCompliance(p=>({...p,retention_days:parseInt(e.target.value)||365}))}
                  className="w-32 mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            {saved && <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium"><CheckCircle2 size={12} /> Saved</span>}
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
              <Save size={12} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
