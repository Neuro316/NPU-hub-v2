'use client'
// CRM Settings > Campaign sending: the sender, the send window, the frequency cap, the
// capability switches, and the live-send allowlist. The sender is read from the org
// setting, never from code; until it is set, live email is refused.
import { useCallback, useEffect, useState } from 'react'
import { Send, Loader2, ShieldAlert } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import type { Flags, Overview } from './types'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const FLAG_TEXT: Record<keyof Flags, string> = {
  engine: 'Campaign engine: campaigns enroll people and run their steps',
  gate_live_sends: 'Live sending: allowlisted test contacts, and campaigns switched live, get real messages',
  provider_email: 'Email through Resend',
  provider_sms: 'Text messages through Twilio',
  intake: 'Public forms accept submissions',
  deliver_asset: 'Deliver steps hand out University links',
  mirror_legacy_stage: 'Campaign stage moves also update the existing pipeline board',
  agent_enabled: 'Campaign Builder: a superadmin can describe a campaign and get drafts to review',
  help_bot_enabled: 'Hub Guide: answers how to use the Hub and walks people through it',
  pages: 'Landing pages: published pages are shown at their public address',
}

export function MarketingSettings() {
  const { currentOrg } = useWorkspace()
  const toast = useToast()
  const [d, setD] = useState<Overview | null>(null)
  const [p, setP] = useState<Record<string, any>>({})
  const load = useCallback(async () => {
    if (!currentOrg) return
    try { const r: Overview = await api(`/api/marketing/overview?org=${currentOrg.id}`); setD(r); setP(r.policy ?? {}) }
    catch (e: any) { toast.show(e.message, 'error') }
  }, [currentOrg, toast])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!currentOrg) return
    try {
      await api('/api/marketing/settings', { org_id: currentOrg.id, from_address: p.from_address, from_domain: p.from_domain, reply_to: p.reply_to ?? '',
        quiet_start: p.quiet_start, quiet_end: p.quiet_end, default_timezone: p.default_timezone, cap_count: Number(p.cap_count), cap_days: Number(p.cap_days) })
      toast.show('Sending settings are saved.'); load()
    } catch (e: any) { toast.show(e.message, 'error') }
  }
  async function flip(key: keyof Flags, on: boolean) {
    if (!currentOrg) return
    try { await api('/api/marketing/flags', { org_id: currentOrg.id, key, on }); toast.show(`${FLAG_TEXT[key]}: ${on ? 'on' : 'off'}.`); load() }
    catch (e: any) { toast.show(e.message, 'error') }
  }

  if (!d) return <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading sending settings</p>
  const field = (k: string, label: string, ph = '') => (
    <div><label className="mb-1 block text-[11px] font-medium text-gray-500" htmlFor={`ms-${k}`}>{label}</label>
      <input id={`ms-${k}`} className={input} placeholder={ph} value={p[k] ?? ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>)

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-gray-100 bg-white p-4 shadow-card">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><Send className="h-4 w-4 text-np-blue" aria-hidden />Campaign sending</h3>
        {d.sender_problem && <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-gold-light p-2 text-xs text-np-dark"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-gold" aria-hidden />
          {d.sender_problem === 'sender_is_placeholder' ? 'The sender is still the placeholder, so no campaign email can go out live. Set a sending subdomain you have verified in Resend.' : `The sender cannot be used yet: ${d.sender_problem.replace(/_/g, ' ')}.`}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {field('from_address', 'From', 'Neuro Progeny <hello@mail.neuroprogeny.com>')}
          {field('from_domain', 'Sending domain, verified in Resend', 'mail.neuroprogeny.com')}
          {field('reply_to', 'Replies go to', 'cameron@neuroprogeny.com')}
          {field('default_timezone', 'Time zone for people with none on file', 'America/New_York')}
          {field('quiet_start', 'Send window opens', '08:00')}
          {field('quiet_end', 'Send window closes', '20:00')}
          {field('cap_count', 'Marketing messages per person at most')}
          {field('cap_days', 'In any number of days')}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Messages wait for the window in each person's own time zone. The cap counts marketing emails and texts together; service messages such as confirmations and reminders do not count.</p>
        <div className="mt-3 flex justify-end"><button type="button" onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover">Save sending settings</button></div>
      </div>
      <div className="rounded-card border border-gray-100 bg-white p-4 shadow-card">
        <h3 className="mb-2 text-sm font-semibold text-np-dark">Switches</h3>
        <ul className="space-y-1.5">
          {(Object.keys(FLAG_TEXT) as Array<keyof Flags>).map((k) => (
            <li key={k} className="flex items-center gap-2 text-xs">
              <input id={`flag-${k}`} type="checkbox" checked={d.flags[k]} disabled={!d.can_go_live} onChange={(e) => flip(k, e.target.checked)} />
              <label htmlFor={`flag-${k}`} className="text-gray-600">{FLAG_TEXT[k]}</label>
            </li>))}
        </ul>
        {!d.can_go_live && <p className="mt-2 text-[11px] text-gray-400">Only a platform superadmin can change these switches.</p>}
        <p className="mt-3 text-[11px] font-medium text-gray-500">Test contacts who may receive real messages before a campaign goes live</p>
        {d.test_contacts.map((t) => <p key={t.id} className="text-[11px] text-gray-500">{t.label}: {t.email ?? 'no email'}{t.phone ? ', a phone number' : ''}</p>)}
      </div>
    </div>
  )
}
