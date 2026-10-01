'use client'
// The steps of a campaign, stored on its sequence (ruling 6). StepsEditor is controlled,
// so the guided setup can use it before the campaign exists; SequenceEditor wraps it with
// a Save button for the campaign screen.
import { useState } from 'react'
import { Mail, MessageSquare, Clock, Plus, Trash2, Eye, GraduationCap } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { Help } from './help'
import type { Asset, Step } from './types'

export const blankStep = (): Step => ({ channel: 'email', delay_minutes: 0, subject: '', body: '', kind: 'marketing', step_type: 'message', asset_id: null })
const label = 'mb-1 flex items-center text-[11px] font-medium text-gray-500'
const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'

const KIND_NOTE = {
  marketing: 'Goes only to people who agreed to marketing on this channel. Emails end with an unsubscribe link and texts end with how to opt out.',
  service: 'For confirmations, reminders and things they asked for. Goes to people who agreed to service messages on this channel.',
}

export function StepsEditor({ orgId, steps, setSteps, assets, previewed, setPreviewed }: {
  orgId: string; steps: Step[]; setSteps: (s: Step[]) => void; assets: Asset[]
  previewed: number[]; setPreviewed: (p: number[]) => void
}) {
  const toast = useToast()
  const [preview, setPreview] = useState<{ i: number; subject: string; text: string } | null>(null)
  const set = (i: number, patch: Partial<Step>) => {
    setSteps(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)))
    if (previewed.includes(i)) setPreviewed(previewed.filter((p) => p !== i))   // a changed message needs a fresh look
  }
  const remove = (i: number) => { setSteps(steps.filter((_, j) => j !== i)); setPreviewed([]); setPreview(null) }

  async function show(i: number) {
    const s = steps[i]
    if (s.channel === 'wait') return
    try {
      const r = await api('/api/marketing/preview', { org_id: orgId, channel: s.channel, kind: s.kind, subject: s.subject, body: s.body, with_asset: s.step_type === 'deliver_asset' })
      setPreview({ i, subject: r.subject, text: r.text })
      if (!previewed.includes(i)) setPreviewed([...previewed, i])
    } catch (e: any) { toast.show(`${e.message} The preview could not be made; check the message and try again.`, 'error') }
  }

  if (!steps.length) return <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">This campaign has no steps yet, so it would send nothing. Add a step below, or start from a template in the guided setup.</p>

  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const Icon = s.channel === 'email' ? Mail : s.channel === 'sms' ? MessageSquare : Clock
        const kind = (s.kind ?? 'marketing') as 'marketing' | 'service'
        return (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-np-blue-light text-np-blue"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
              <b className="text-sm text-np-dark">Step {i + 1}</b>
              {s.step_type === 'deliver_asset' && <span className="inline-flex items-center gap-1 rounded-full bg-fire-light px-2 py-0.5 text-[10px] font-medium text-fire"><GraduationCap className="h-3 w-3" aria-hidden />Deliver</span>}
              {s.channel !== 'wait' && !previewed.includes(i) && <span className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] text-gold">Not previewed</span>}
              <span className="flex-1" />
              {s.channel !== 'wait' && <span className="inline-flex items-center"><button type="button" onClick={() => show(i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-np-blue hover:bg-np-blue-light"><Eye className="h-3.5 w-3.5" aria-hidden />Preview</button><Help topic="Preview" k="preview" /></span>}
              <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => remove(i)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-50 hover:text-fire"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div><span className={label}><label htmlFor={`st-ch-${i}`}>Channel</label><Help topic="Channel" k="channel" /></span>
                <select id={`st-ch-${i}`} className={input} value={s.channel} onChange={(e) => set(i, { channel: e.target.value as Step['channel'] })}>
                  <option value="email">Email</option><option value="sms">Text message</option><option value="wait">Wait</option>
                </select></div>
              <div><span className={label}><label htmlFor={`st-d-${i}`}>Send after (hours)</label><Help topic="Send after" k="sendAfter" /></span>
                <input id={`st-d-${i}`} className={input} type="number" min={0} value={Math.round(s.delay_minutes / 60)} onChange={(e) => set(i, { delay_minutes: Math.max(0, Number(e.target.value) || 0) * 60 })} /></div>
              {s.channel !== 'wait' && <>
                <div><span className={label}><label htmlFor={`st-k-${i}`}>Kind of message</label><Help topic="Kind of message" k="kind" /></span>
                  <select id={`st-k-${i}`} className={input} value={kind} onChange={(e) => set(i, { kind: e.target.value as 'marketing' | 'service' })}>
                    <option value="marketing">Marketing</option><option value="service">Service (confirmation, reminder)</option>
                  </select></div>
                <div><span className={label}><label htmlFor={`st-t-${i}`}>What it does</label><Help topic="What it does" k="whatItDoes" /></span>
                  <select id={`st-t-${i}`} className={input} value={s.step_type} onChange={(e) => set(i, { step_type: e.target.value as Step['step_type'] })}>
                    <option value="message">Send a message</option><option value="deliver_asset">Deliver a free University asset</option>
                  </select></div>
              </>}
            </div>
            {s.channel !== 'wait' && <p className="mt-1.5 text-[11px] text-gray-500">{KIND_NOTE[kind]}</p>}
            {s.channel !== 'wait' && <div className="mt-2 space-y-2">
              {s.step_type === 'deliver_asset' && <div><label className={label} htmlFor={`st-a-${i}`}>University asset</label>
                {assets.filter((a) => a.active).length
                  ? <select id={`st-a-${i}`} className={input} value={s.asset_id ?? ''} onChange={(e) => set(i, { asset_id: e.target.value || null })}>
                      <option value="">Choose an asset</option>{assets.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                    </select>
                  : <p className="text-xs text-gray-500">There are no University assets yet. Add one in <a className="text-np-blue underline" href="/university-access">University Access</a>, then choose it here.</p>}
                <p className="mt-1 text-[11px] text-gray-400">The private link is added where you write {'{{asset_link}}'}, or at the end.</p></div>}
              {s.channel === 'email' && <div><label className={label} htmlFor={`st-s-${i}`}>Subject</label><input id={`st-s-${i}`} className={input} value={s.subject ?? ''} onChange={(e) => set(i, { subject: e.target.value })} /></div>}
              <div><label className={label} htmlFor={`st-b-${i}`}>Message</label>
                <textarea id={`st-b-${i}`} className={`${input} min-h-[90px]`} value={s.body ?? ''} onChange={(e) => set(i, { body: e.target.value })} />
                <p className="mt-1 text-[11px] text-gray-400">You can use {'{{first_name}}'}, {'{{last_name}}'} and {'{{org_name}}'}; they are filled in for each person.</p></div>
            </div>}
            {preview?.i === i && <div className="mt-3 rounded-lg border border-dashed border-np-blue/30 bg-np-light p-3 text-sm" aria-label={`Preview of step ${i + 1}`}>
              {preview.subject && <p className="mb-1 font-semibold text-np-dark">{preview.subject}</p>}
              <p className="whitespace-pre-wrap text-gray-700">{preview.text}</p>
              <p className="mt-2 text-[11px] text-gray-400">Shown for a sample person. Nothing was sent.</p>
            </div>}
          </div>
        )
      })}
    </div>
  )
}

export function SequenceEditor({ orgId, campaignId, sequenceId, name, initial, assets, onSaved }: {
  orgId: string; campaignId: string; sequenceId: string | null; name: string
  initial: Step[]; assets: Asset[]; onSaved: () => void
}) {
  const toast = useToast()
  const [steps, setSteps] = useState<Step[]>(initial.length ? initial : [blankStep()])
  const [previewed, setPreviewed] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await api('/api/marketing/sequences', { org_id: orgId, id: sequenceId, name: `${name} steps`, campaign_id: campaignId, steps })
      toast.show('The steps are saved.')
      onSaved()
    } catch (e: any) { toast.show(`${e.message} Your edits are still on screen; fix the step it names and save again.`, 'error') } finally { setSaving(false) }
  }
  return (
    <div className="space-y-3">
      <StepsEditor orgId={orgId} steps={steps} setSteps={setSteps} assets={assets} previewed={previewed} setPreviewed={setPreviewed} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSteps([...steps, blankStep()])} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-np-dark hover:bg-gray-50"><Plus className="h-3.5 w-3.5" aria-hidden />Add a step</button>
        <span className="flex-1" />
        <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">{saving ? 'Saving' : 'Save steps'}</button>
      </div>
    </div>
  )
}
