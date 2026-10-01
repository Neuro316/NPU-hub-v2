'use client'
// Contact drawer: the Consent and Campaigns tabs, plus where the person came from.
// Reads GET /api/marketing/contacts/<id>; records consent through /api/marketing/consent.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck, ShieldOff, Megaphone, MapPin } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'

const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const words = (s: string) => s.replace(/_/g, ' ')

export function ContactMarketingTab({ contactId, mode }: { contactId: string; mode: 'consent' | 'campaigns' }) {
  const toast = useToast()
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ channel: 'email', kind: 'marketing', action: 'granted', text_shown: '' })
  const load = useCallback(async () => {
    try { setD(await api(`/api/marketing/contacts/${contactId}`)); setErr(null) } catch (e: any) { setErr(e.message) }
  }, [contactId])
  useEffect(() => { load() }, [load])

  async function record() {
    try { await api('/api/marketing/consent', { contact_id: contactId, ...form }); toast.show('The consent record is saved.'); setForm({ ...form, text_shown: '' }); load() }
    catch (e: any) { toast.show(e.message, 'error') }
  }

  if (err) return <p className="py-6 text-center text-[11px] text-fire" role="alert">{err}</p>
  if (!d) return <p className="flex items-center justify-center gap-2 py-6 text-[11px] text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Loading</p>

  if (mode === 'consent') return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(d.consent_state as Record<string, any>).map(([k, v]) => {
          const [ch, kind] = k.split(':')
          const ok = v?.allowed === true
          return (
            <div key={k} className={`rounded-lg border p-2 ${ok ? 'border-teal/30 bg-teal-light' : 'border-gray-100 bg-gray-50'}`}>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-np-dark">{ok ? <ShieldCheck className="h-3.5 w-3.5 text-teal" aria-hidden /> : <ShieldOff className="h-3.5 w-3.5 text-gray-400" aria-hidden />}{ch === 'sms' ? 'Text' : 'Email'}, {kind}</div>
              <p className="mt-0.5 text-[10px] text-gray-500">{ok ? 'May receive' : 'Will not receive'}: {words(String(v?.reason ?? 'no record'))}</p>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-gray-400">These come from the consent record below, not from the older yes or no fields on the contact.</p>
      <div className="space-y-2">
        {d.consent_events.length === 0 && <p className="text-[11px] text-gray-400">No consent has been recorded for this person yet.</p>}
        {d.consent_events.map((e: any) => (
          <div key={e.id} className="rounded-lg border border-gray-100 p-2 text-[11px]">
            <div className="flex gap-2"><b className={e.action === 'granted' ? 'text-teal-dark' : 'text-fire'}>{e.action === 'granted' ? 'Agreed' : 'Withdrew'}</b>
              <span className="text-gray-600">{e.channel === 'sms' ? 'text' : 'email'}, {e.kind}</span><span className="flex-1" /><span className="text-gray-400">{when(e.occurred_at)}</span></div>
            <p className="text-gray-500">Source: {e.source}{e.text_shown ? `. Shown: "${e.text_shown}"` : ''}</p>
          </div>
        ))}
      </div>
      <fieldset className="space-y-2 rounded-lg border border-gray-100 p-2" data-help-id="contact.consent-record">
        <legend className="px-1 text-[11px] font-semibold text-np-dark">Record a decision made outside a form</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {([['channel', [['email', 'Email'], ['sms', 'Text']]], ['kind', [['marketing', 'Marketing'], ['service', 'Service']]], ['action', [['granted', 'Agreed'], ['revoked', 'Withdrew']]]] as const).map(([k, opts]) => (
            <select key={k} aria-label={k} className="rounded border border-gray-200 px-1.5 py-1 text-[11px]" value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>))}
        </div>
        <textarea aria-label="What the person agreed to" className="w-full rounded border border-gray-200 px-2 py-1 text-[11px]" rows={2} value={form.text_shown}
          placeholder={form.action === 'granted' ? 'What they agreed to, in their words or the words read to them' : 'Optional note'} onChange={(e) => setForm({ ...form, text_shown: e.target.value })} />
        <button type="button" onClick={record} className="rounded bg-np-blue px-2.5 py-1 text-[11px] font-medium text-white hover:bg-np-blue-hover">Save record</button>
      </fieldset>
    </div>
  )

  const c = d.contact
  const utm = c.acquisition_utm && typeof c.acquisition_utm === 'object' ? Object.entries(c.acquisition_utm) : []
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-100 p-2 text-[11px]">
        <div className="mb-1 flex items-center gap-1 font-semibold text-np-dark"><MapPin className="h-3.5 w-3.5 text-np-blue" aria-hidden />Where they came from</div>
        <p className="text-gray-600">{c.acquisition_source || c.source || 'Not recorded'}{c.acquisition_campaign ? `, campaign ${c.acquisition_campaign}` : ''}</p>
        {utm.length > 0 && <p className="mt-1 font-mono text-[10px] text-gray-400">{utm.map(([k, v]) => `${k}=${v}`).join('  ')}</p>}
      </div>
      <div className="space-y-2">
        {d.enrollments.length === 0 && <p className="text-[11px] text-gray-400">Not in any campaign.</p>}
        {d.enrollments.map((e: any) => (
          <div key={e.id} className="rounded-lg border border-gray-100 p-2 text-[11px]">
            <div className="flex items-center gap-1"><Megaphone className="h-3.5 w-3.5 text-np-blue" aria-hidden /><b className="text-np-dark">{e.funnel_campaigns?.name ?? 'Campaign'}</b><span className="flex-1" /><span className="rounded-full bg-np-light px-1.5 text-gray-600">{words(e.status)}</span></div>
            <p className="text-gray-500">Started by {e.source_key} on {when(e.enrolled_at)}{e.end_reason ? `. Ended: ${words(e.end_reason)}` : ''}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold text-np-dark">Send decisions</p>
        {d.decisions.length === 0 && <p className="text-[11px] text-gray-400">No messages have been considered for this person.</p>}
        {d.decisions.slice(0, 15).map((x: any) => (
          <p key={x.id} className="text-[11px] text-gray-500"><span className="text-gray-400">{when(x.created_at)}</span> {x.channel} {x.kind}: <b className={x.decision === 'allow' ? 'text-teal-dark' : x.decision === 'defer' ? 'text-gold' : 'text-fire'}>{x.decision}</b> ({words(x.reason)}{x.mode === 'dry_run' ? ', dry run' : ''})</p>
        ))}
      </div>
    </div>
  )
}
