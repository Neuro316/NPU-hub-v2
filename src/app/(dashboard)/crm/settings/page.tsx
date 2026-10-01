'use client'

import { useEffect, useState } from 'react'
import {
  Mail, Phone, Brain, Shield, Bell, Users, Sliders, Mic,
  Save, Plus, X, Trash2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Send
} from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import PipelineResourcesManager from '@/components/crm/pipeline-resources'
import GuestProfileSettings from '@/components/settings/GuestProfileSettings'
import VoicemailGreeting from '@/components/crm/voicemail-greeting'
import BrowserCallingToggle from '@/components/crm/browser-calling-toggle'
import { MarketingSettings } from '@/components/marketing/marketing-settings'
import {
  clampRingTimeout, DEFAULT_RING_TIMEOUT_SECONDS,
  MIN_RING_TIMEOUT_SECONDS, MAX_RING_TIMEOUT_SECONDS,
} from '@/lib/inbound-voice'
import { toE164 } from '@/lib/phone'

type Section = 'email' | 'twilio' | 'ai' | 'pipeline' | 'team' | 'notifications' | 'compliance' | 'general' | 'guest_profile' | 'campaign_sending'

const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'guest_profile', label: 'Guest Profile', icon: Mic },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'twilio', label: 'Twilio / SMS', icon: Phone },
  { id: 'ai', label: 'AI Integration', icon: Brain },
  { id: 'pipeline', label: 'Pipeline', icon: Sliders },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'campaign_sending', label: 'Campaign Sending', icon: Send },
]

type NumberPurpose = 'outreach' | 'client_relations' | 'appointments' | 'inbound_main' | 'general'
const NUMBER_PURPOSES: { value: NumberPurpose; label: string; desc: string }[] = [
  { value: 'outreach', label: 'Outreach', desc: 'Cold outreach, campaigns, sequences' },
  { value: 'client_relations', label: 'Client Relations', desc: 'Enrolled clients, support' },
  { value: 'appointments', label: 'Appointments', desc: 'Reminders, scheduling' },
  { value: 'inbound_main', label: 'Inbound Main Line', desc: 'Primary reception number' },
  { value: 'general', label: 'General', desc: 'Fallback for everything' },
]
// Per-line keys are optional; absent = "use org default" (inbound-voice.ts
// resolveInboundOrgContext). The greeting_* keys are written by the
// /api/comms/greeting route, never by this form — see the merge in handleSave.
interface TwilioNumber {
  phone: string
  nickname: string
  purpose: NumberPurpose
  greeting_url?: string
  greeting_path?: string
  greeting_filename?: string
  greeting_updated_at?: string
  greeting_text?: string
  ring_timeout_seconds?: number
  record_calls?: boolean
  recording_notice_enabled?: boolean
  recording_notice_text?: string
  forward_number?: string
}
const GREETING_KEYS = ['greeting_url', 'greeting_path', 'greeting_filename', 'greeting_updated_at'] as const

export default function SettingsPage() {
  const { currentOrg } = useWorkspace()
  const [active, setActive] = useState<Section>('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [twilioTest, setTwilioTest] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null })
  // Which number card has its "Line options" open.
  const [openLine, setOpenLine] = useState<number | null>(null)

  // Settings state
  const [email, setEmail] = useState({ sending_email: '', sending_name: '', daily_limit: 500, provider: 'gmail_workspace', warmup: true })
  const [twilio, setTwilio] = useState({ account_sid: '', auth_token: '', messaging_service_sid: '', api_key: '', api_secret: '', twiml_app_sid: '', voice_caller_id: '', ring_timeout_seconds: DEFAULT_RING_TIMEOUT_SECONDS })
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
            setTwilio({ account_sid: v.account_sid || '', auth_token: v.auth_token || '', messaging_service_sid: v.messaging_service_sid || '', api_key: v.api_key || '', api_secret: v.api_secret || '', twiml_app_sid: v.twiml_app_sid || '', voice_caller_id: v.voice_caller_id || '', ring_timeout_seconds: clampRingTimeout(v.ring_timeout_seconds) })
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
        // READ-MERGE-WRITE. This form only knows the credential fields + numbers;
        // crm_twilio also holds keys this page never loads (greeting_url /
        // greeting_path from the voicemail-greeting panel, forward_number). A bare
        // upsert of the form state would silently DROP them — and the greeting can
        // change after this page loaded, so merge against a fresh read, not the
        // copy captured at mount.
        const { data: current } = await supabase.from('org_settings')
          .select('setting_value').eq('org_id', currentOrg.id)
          .eq('setting_key', 'crm_twilio').maybeSingle()
        const existing = (current?.setting_value && typeof current.setting_value === 'object' && !Array.isArray(current.setting_value))
          ? current.setting_value : {}
        // Per-number merge, same reason. A line's greeting_* keys are written
        // by /api/comms/greeting into numbers[i], possibly after this page
        // loaded; writing the in-memory numbers[] back verbatim would drop
        // them. Carry those four keys from the FRESH read, matched by phone,
        // and normalise the optional per-line fields so "empty" is absent
        // rather than '' (absent is what "use org default" means).
        const freshNumbers: any[] = Array.isArray((existing as any).numbers) ? (existing as any).numbers : []
        const numbers = twilioNumbers.map(n => {
          const out: Record<string, any> = { ...n }
          const fresh = freshNumbers.find(f => toE164(String(f?.phone || '')) === toE164(n.phone))
          for (const key of GREETING_KEYS) {
            if (fresh && fresh[key]) out[key] = fresh[key]
            else delete out[key]
          }
          if (!String(out.greeting_text || '').trim()) delete out.greeting_text
          else out.greeting_text = String(out.greeting_text).trim()
          const fwd = String(out.forward_number || '').trim()
          if (!fwd) delete out.forward_number
          else out.forward_number = toE164(fwd) || fwd
          if (out.ring_timeout_seconds == null || out.ring_timeout_seconds === '') delete out.ring_timeout_seconds
          else out.ring_timeout_seconds = clampRingTimeout(out.ring_timeout_seconds)
          // Recording switches. Absent means off, so an unchecked box is stored
          // as no key at all rather than false. That keeps a line that nobody
          // has touched byte identical to how it was stored before these
          // fields existed, and it is what resolveInboundOrgContext reads.
          if (out.record_calls === true) out.record_calls = true
          else delete out.record_calls
          if (out.recording_notice_enabled === true) out.recording_notice_enabled = true
          else delete out.recording_notice_enabled
          if (!String(out.recording_notice_text || '').trim()) delete out.recording_notice_text
          else out.recording_notice_text = String(out.recording_notice_text).trim()
          return out
        })
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_twilio',
          // clamp on write as well as read — the stored value is never outside
          // the range that keeps browser ringing functional.
          setting_value: {
            ...existing, ...twilio, numbers,
            ring_timeout_seconds: clampRingTimeout(twilio.ring_timeout_seconds),
          },
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
  const patchNumber = (i: number, patch: Partial<TwilioNumber>) =>
    setTwilioNumbers(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n))

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

                {/* Outbound caller ID — what people see when you call them.
                    Explicit, because inferring it from the contact's pipeline
                    stage sent calls out from the campaign number. */}
                <div className="mt-3">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Outbound Caller ID</label>
                  <select value={twilio.voice_caller_id}
                    onChange={e => setTwilio(p=>({...p,voice_caller_id:e.target.value}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="">Automatic (main line, then first number)</option>
                    {twilioNumbers.filter(n => n.phone.trim()).map(n => (
                      <option key={n.phone} value={n.phone}>
                        {n.phone}{n.nickname ? ` — ${n.nickname}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-gray-400 mt-1">
                    The number shown when you call someone from the Hub. Texts are unaffected —
                    campaigns still send from the outreach number.
                  </p>
                </div>
              </div>

              {/* Phone Numbers */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone Numbers</label>
                  <button onClick={addTwilioNumber} className="flex items-center gap-1 text-[10px] text-np-blue font-medium hover:underline"><Plus size={10} /> Add Number</button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">Assign numbers for campaigns (outreach) or clients (relationship management). The nickname is what the Conversations line dropdown shows.</p>
                <div className="space-y-2">
                  {twilioNumbers.map((num, i) => {
                    const lineE164 = toE164(num.phone)
                    const open = openLine === i
                    const usesOrgTimeout = num.ring_timeout_seconds == null || (num.ring_timeout_seconds as any) === ''
                    const orgTimeout = clampRingTimeout(twilio.ring_timeout_seconds)
                    return (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/50">
                      <div className="flex items-center gap-2 p-2.5">
                        <input value={num.phone} onChange={e => patchNumber(i, { phone: e.target.value })}
                          placeholder="+18285551234" className="w-36 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white font-mono" />
                        <input value={num.nickname} onChange={e => patchNumber(i, { nickname: e.target.value })}
                          placeholder="Nickname" className="w-28 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white" />
                        <select value={num.purpose} onChange={e => patchNumber(i, { purpose: e.target.value as NumberPurpose })}
                          className="flex-1 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white">
                          {NUMBER_PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label} - {p.desc}</option>)}
                        </select>
                        <button type="button" onClick={() => setOpenLine(open ? null : i)}
                          className="flex items-center gap-0.5 text-[10px] text-np-blue font-medium hover:underline whitespace-nowrap"
                          title="Greeting, ring duration and cell forwarding for this line">
                          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Line options
                        </button>
                        {i > 0 && <button onClick={() => removeTwilioNumber(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                      </div>

                      {/* Per-line options. Every field is optional; empty means
                          "use org default", which is exactly the pre-multi-line
                          behaviour. Saved by "Save Settings" (the audio greeting
                          saves itself through /api/comms/greeting). */}
                      {open && (
                        <div className="border-t border-gray-100 p-3 space-y-4">
                          <p className="text-[10px] text-gray-400">
                            Everything here is optional. Leave a field empty to use the org default set further down this page.
                          </p>

                          {/* Greeting text */}
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Greeting text</label>
                            <textarea value={num.greeting_text || ''} maxLength={500} rows={3}
                              onChange={e => patchNumber(i, { greeting_text: e.target.value })}
                              placeholder="Using org default greeting"
                              className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg bg-white resize-none focus:outline-none focus:ring-1 focus:ring-teal/30" />
                            <p className="text-[9px] text-gray-400 mt-1">
                              Spoken to callers on this line when it has no audio greeting of its own (Polly Joanna, neural). {(num.greeting_text || '').length}/500
                            </p>
                          </div>

                          {/* Ring duration */}
                          <div>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Ring duration</label>
                              <span className="text-xs font-semibold text-np-blue tabular-nums">
                                {usesOrgTimeout ? `Org default: ${orgTimeout} s` : `${clampRingTimeout(num.ring_timeout_seconds)} seconds`}
                              </span>
                            </div>
                            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-1">
                              <input type="checkbox" checked={usesOrgTimeout}
                                onChange={e => patchNumber(i, { ring_timeout_seconds: e.target.checked ? undefined : orgTimeout })} />
                              Use org default
                            </label>
                            {!usesOrgTimeout && (
                              <>
                                <input type="range" min={MIN_RING_TIMEOUT_SECONDS} max={MAX_RING_TIMEOUT_SECONDS} step={1}
                                  value={clampRingTimeout(num.ring_timeout_seconds)}
                                  onChange={e => patchNumber(i, { ring_timeout_seconds: parseInt(e.target.value, 10) || orgTimeout })}
                                  className="w-full accent-np-blue mt-1" />
                                <div className="flex justify-between text-[9px] text-gray-400">
                                  <span>{MIN_RING_TIMEOUT_SECONDS}s</span>
                                  <span>{MAX_RING_TIMEOUT_SECONDS}s</span>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Forward to cell */}
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Forward to cell</label>
                            <input value={num.forward_number || ''}
                              onChange={e => patchNumber(i, { forward_number: e.target.value })}
                              placeholder="Off — rings the Hub only"
                              className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg bg-white font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" />
                            <p className="text-[9px] text-gray-400 mt-1">
                              Rings this phone at the same time as the Hub; whoever answers first takes the call, and the phone
                              sees this line&rsquo;s number as the caller. Keep Ring duration at 15 seconds or less when forwarding:
                              Twilio adds about 5 seconds, and past roughly 20 seconds the cell&rsquo;s own voicemail answers first,
                              so the message lands there instead of in the Hub. Ring duration is now capped at
                              15 seconds automatically whenever a forward number is set.
                            </p>
                          </div>

                          {/* Call recording for this line. Both switches default
                              OFF: absent in the stored JSON means off, so a line
                              nobody has touched behaves exactly as before. */}
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Call recording</label>
                            <label className="flex items-center gap-1.5 text-[10px] text-gray-600 mt-1">
                              <input type="checkbox" checked={num.record_calls === true}
                                onChange={e => patchNumber(i, { record_calls: e.target.checked ? true : undefined })} />
                              Record answered calls on this line
                            </label>
                            <p className="text-[9px] text-gray-400 mt-1">
                              Records both directions once the call connects: inbound calls the team answers and
                              outbound calls placed from the browser. Missed calls and voicemails are unaffected.
                              Recordings play back in the conversation thread and are readable only by staff of this
                              organization. If this line forwards to a cell, calls answered on that cell are recorded too.
                            </p>

                            <label className="flex items-center gap-1.5 text-[10px] text-gray-600 mt-2">
                              <input type="checkbox" checked={num.recording_notice_enabled === true}
                                onChange={e => patchNumber(i, { recording_notice_enabled: e.target.checked ? true : undefined })} />
                              Play a recording notice before connecting
                            </label>
                            {num.recording_notice_enabled === true && (
                              <>
                                <textarea value={num.recording_notice_text || ''} maxLength={300} rows={2}
                                  onChange={e => patchNumber(i, { recording_notice_text: e.target.value })}
                                  placeholder="This call may be recorded for quality and training purposes."
                                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg bg-white resize-none focus:outline-none focus:ring-1 focus:ring-teal/30" />
                                <p className="text-[9px] text-gray-400 mt-1">
                                  Spoken to the caller before the call connects. Leave empty to use the standard wording.
                                  {' '}{(num.recording_notice_text || '').length}/300
                                </p>
                              </>
                            )}
                          </div>

                          {/* Audio greeting for this line */}
                          {lineE164 ? (
                            <VoicemailGreeting lineE164={lineE164} />
                          ) : (
                            <p className="text-[10px] text-gray-400">Enter a valid phone number to manage this line&rsquo;s audio greeting.</p>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>

              {/* Voicemail Greeting — saves itself through the admin-gated
                  /api/comms/greeting route, independent of "Save Settings". */}
              <VoicemailGreeting />

              {/* Registers this browser to receive inbound calls (Stage 2). */}
              <BrowserCallingToggle />

              {/* Ring duration before the caller falls to voicemail. Slider starts
                  at MIN so it cannot be dragged to a value that would silently
                  disable ringing; the saved value is clamped as well. */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-np-dark">Ring Duration</label>
                  <span className="text-xs font-semibold text-np-blue tabular-nums">
                    {twilio.ring_timeout_seconds} seconds
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 mb-2">
                  How long your browser rings before the caller hears your voicemail greeting.
                </p>
                <input
                  type="range"
                  min={MIN_RING_TIMEOUT_SECONDS}
                  max={MAX_RING_TIMEOUT_SECONDS}
                  step={1}
                  value={twilio.ring_timeout_seconds}
                  onChange={e => setTwilio(p => ({ ...p, ring_timeout_seconds: parseInt(e.target.value, 10) || DEFAULT_RING_TIMEOUT_SECONDS }))}
                  className="w-full accent-np-blue"
                />
                <div className="flex justify-between text-[9px] text-gray-400">
                  <span>{MIN_RING_TIMEOUT_SECONDS}s</span>
                  <span>{MAX_RING_TIMEOUT_SECONDS}s</span>
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

          {/* Guest Profile */}
          {active === 'guest_profile' && <GuestProfileSettings />}
          {active === 'campaign_sending' && <MarketingSettings />}

          {/* Save Button */}
          <div className={`flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100${active === 'guest_profile' || active === 'campaign_sending' ? ' hidden' : ''}`}>
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

