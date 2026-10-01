'use client'
// The steps of a campaign, stored on its sequence (ruling 6). Email, text message or
// wait; marketing or service; a plain message or a University asset delivery.
import { useState } from 'react'
import { Mail, MessageSquare, Clock, Plus, Trash2, Eye, GraduationCap } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import type { Asset, Step } from './types'

const blank = (): Step => ({ channel: 'email', delay_minutes: 0, subject: '', body: '', kind: 'marketing', step_type: 'message', asset_id: null })
const label = 'block text-[11px] font-medium text-gray-500 mb-1'
const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'

export function SequenceEditor({ orgId, campaignId, sequenceId, name, initial, assets, onSaved }: {
  orgId: string; campaignId: string; sequenceId: string | null; name: string
  initial: Step[]; assets: Asset[]; onSaved: () => void
}) {
  const toast = useToast()
  const [steps, setSteps] = useState<Step[]>(initial.length ? initial : [blank()])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ i: number; subject: string; text: string; html: string } | null>(null)
  const set = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save() {
    setSaving(true)
    try {
      await api('/api/marketing/sequences', { org_id: orgId, id: sequenceId, name: `${name} steps`, campaign_id: campaignId, steps })
      toast.show('The steps are saved.')
      onSaved()
    } catch (e: any) { toast.show(e.message, 'error') } finally { setSaving(false) }
  }
  async function show(i: number) {
    const s = steps[i]
    if (s.channel === 'wait') return
    try {
      const r = await api('/api/marketing/preview', { org_id: orgId, channel: s.channel, kind: s.kind, subject: s.subject, body: s.body, with_asset: s.step_type === 'deliver_asset' })
      setPreview({ i, ...r })
    } catch (e: any) { toast.show(e.message, 'error') }
  }

  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const Icon = s.channel === 'email' ? Mail : s.channel === 'sms' ? MessageSquare : Clock
        return (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-np-blue-light text-np-blue"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
              <b className="text-sm text-np-dark">Step {i + 1}</b>
              {s.step_type === 'deliver_asset' && <span className="inline-flex items-center gap-1 rounded-full bg-fire-light px-2 py-0.5 text-[10px] font-medium text-fire"><GraduationCap className="h-3 w-3" aria-hidden />Deliver</span>}
              <span className="flex-1" />
              {s.channel !== 'wait' && <button type="button" onClick={() => show(i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-np-blue hover:bg-np-blue-light"><Eye className="h-3.5 w-3.5" aria-hidden />Preview</button>}
              <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} className="rounded-lg p-1 text-gray-400 hover:bg-gray-50 hover:text-fire"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div><label className={label}>Channel</label>
                <select className={input} value={s.channel} onChange={(e) => set(i, { channel: e.target.value as Step['channel'] })}>
                  <option value="email">Email</option><option value="sms">Text message</option><option value="wait">Wait</option>
                </select></div>
              <div><label className={label}>Send after (hours)</label>
                <input className={input} type="number" min={0} value={Math.round(s.delay_minutes / 60)} onChange={(e) => set(i, { delay_minutes: Math.max(0, Number(e.target.value) || 0) * 60 })} /></div>
              {s.channel !== 'wait' && <>
                <div><label className={label}>Kind of message</label>
                  <select className={input} value={s.kind ?? 'marketing'} onChange={(e) => set(i, { kind: e.target.value as 'marketing' | 'service' })}>
                    <option value="marketing">Marketing</option><option value="service">Service (confirmation, reminder)</option>
                  </select></div>
                <div><label className={label}>What it does</label>
                  <select className={input} value={s.step_type} onChange={(e) => set(i, { step_type: e.target.value as Step['step_type'] })}>
                    <option value="message">Send a message</option><option value="deliver_asset">Deliver a free University asset</option>
                  </select></div>
              </>}
            </div>
            {s.channel !== 'wait' && <div className="mt-2 space-y-2">
              {s.step_type === 'deliver_asset' && <div><label className={label}>University asset</label>
                <select className={input} value={s.asset_id ?? ''} onChange={(e) => set(i, { asset_id: e.target.value || null })}>
                  <option value="">Choose an asset</option>{assets.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select><p className="mt-1 text-[11px] text-gray-400">The private link is added where you write {'{{asset_link}}'}, or at the end.</p></div>}
              {s.channel === 'email' && <div><label className={label}>Subject</label><input className={input} value={s.subject ?? ''} onChange={(e) => set(i, { subject: e.target.value })} /></div>}
              <div><label className={label}>Message</label>
                <textarea className={`${input} min-h-[90px]`} value={s.body ?? ''} onChange={(e) => set(i, { body: e.target.value })} />
                <p className="mt-1 text-[11px] text-gray-400">Merge tags: {'{{first_name}}'}, {'{{last_name}}'}, {'{{org_name}}'}. Marketing texts end with a line on how to opt out; marketing emails end with an unsubscribe link.</p></div>
            </div>}
            {preview?.i === i && <div className="mt-3 rounded-lg border border-dashed border-np-blue/30 bg-np-light p-3 text-sm" aria-label={`Preview of step ${i + 1}`}>
              {preview.subject && <p className="mb-1 font-semibold text-np-dark">{preview.subject}</p>}
              <p className="whitespace-pre-wrap text-gray-700">{preview.text}</p>
              <p className="mt-2 text-[11px] text-gray-400">Shown for a sample person. Nothing was sent.</p>
            </div>}
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSteps((s) => [...s, blank()])} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-np-dark hover:bg-gray-50"><Plus className="h-3.5 w-3.5" aria-hidden />Add a step</button>
        <span className="flex-1" />
        <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">{saving ? 'Saving' : 'Save steps'}</button>
      </div>
    </div>
  )
}
