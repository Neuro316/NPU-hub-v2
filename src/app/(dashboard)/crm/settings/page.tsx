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

interface TwilioNumber { phone: string; nickname: string; purpose: 'sms' | 'voice' | 'both' }

export default function SettingsPage() {
  const { currentOrg } = useWorkspace()
  const [active, setActive] = useState<Section>('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Settings state
  const [email, setEmail] = useState({ sending_email: '', sending_name: '', daily_limit: 500, provider: 'gmail_workspace', warmup: true })
  const [twilio, setTwilio] = useState({ account_sid: '', auth_token: '', messaging_service_sid: '', api_key: '', api_secret: '', twiml_app_sid: '' })
  const [twilioNumbers, setTwilioNumbers] = useState<TwilioNumber[]>([{ phone: '', nickname: 'Primary', purpose: 'both' }])
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
    // Load other settings from a generic org_settings table or similar
  }, [currentOrg])

  const handleSave = async () => {
    if (!currentOrg) return
    setSaving(true)
    try {
      const supabase = createClient()
      // Save based on active section
      if (active === 'email') {
        await supabase.from('org_email_configs').upsert({
          org_id: currentOrg.id, provider: email.provider,
          sending_email: email.sending_email, sending_name: email.sending_name,
          daily_send_limit: email.daily_limit, warmup_enabled: email.warmup,
          batch_size: 50, batch_delay_seconds: 10, is_verified: false,
        }, { onConflict: 'org_id' })
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e); alert('Failed to save settings') }
    finally { setSaving(false) }
  }

  const addTwilioNumber = () => setTwilioNumbers(prev => [...prev, { phone: '', nickname: '', purpose: 'sms' }])
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

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone Numbers</label>
                  <button onClick={addTwilioNumber} className="flex items-center gap-1 text-[10px] text-np-blue font-medium hover:underline"><Plus size={10} /> Add Number</button>
                </div>
                <div className="space-y-2">
                  {twilioNumbers.map((num, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                      <input value={num.phone} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,phone:e.target.value} : n))}
                        placeholder="+1 828 555 1234" className="flex-1 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white" />
                      <input value={num.nickname} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,nickname:e.target.value} : n))}
                        placeholder="Nickname" className="w-28 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white" />
                      <select value={num.purpose} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,purpose:e.target.value as any} : n))}
                        className="w-24 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white">
                        <option value="sms">SMS</option><option value="voice">Voice</option><option value="both">Both</option>
                      </select>
                      {i > 0 && <button onClick={() => removeTwilioNumber(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                    </div>
                  ))}
                </div>
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
