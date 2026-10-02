'use client'
// The Campaign Builder in three screens (ruling 14): describe what you want, review what it will
// draft, then the result with its follow-up tasks. Nothing is saved until Build, and Build saves
// drafts only. Used as the wizard's first step and inside the side panel.
import { useState } from 'react'
import { Sparkles, Loader2, Hammer, ArrowLeft, AlertTriangle, ListChecks } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const hours = (m: number) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} ${m === 1440 ? 'day' : 'days'}` : `${Math.round(m / 60)} hours`)

export function BuilderFlow({ orgId, campaignId, onBuilt, compact }: { orgId: string; campaignId?: string | null; onBuilt: (ids: any) => void; compact?: boolean }) {
  const toast = useToast()
  const [prompt, setPrompt] = useState('')
  const [pasted, setPasted] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<string | null>(null)
  const [res, setRes] = useState<any>(null)
  const [built, setBuilt] = useState<any>(null)

  async function draft() {
    setBusy(true)
    try {
      const r = await api('/api/marketing/agent', { action: 'plan', org_id: orgId, prompt, pasted: pasted || undefined, session_id: session ?? undefined,
        surface: compact ? 'panel' : 'wizard', campaign_id: campaignId ?? undefined })
      setSession(r.session_id); setRes(r)
    } catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }
  async function build() {
    setBusy(true)
    try { const r = await api('/api/marketing/agent', { action: 'build', org_id: orgId, run_id: res.run_id }); setBuilt(r.ids); onBuilt(r.ids) }
    catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }

  if (built) {
    const tasks = res?.plan?.tasks ?? []
    return (
      <div className="space-y-3" data-help-id="builder.result">
        <p className="text-sm text-np-dark">The draft is saved. It sends nothing until a person reviews it and sets it to Active.</p>
        {tasks.length > 0 && <div><p className="mb-1 flex items-center gap-1 text-xs font-semibold text-np-dark"><ListChecks className="h-3.5 w-3.5" aria-hidden />Still to do</p>
          <ul className="space-y-1">{tasks.map((t: any, i: number) => <li key={i} className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs"><b className="text-np-dark">{t.title}</b>{t.detail && <span className="block text-gray-500">{t.detail}</span>}</li>)}</ul>
          <p className="mt-1 text-[11px] text-gray-400">These are on the campaign and in Client Tasks.</p></div>}
      </div>)
  }

  if (res?.plan) {
    const p = res.plan
    return (
      <div className="space-y-3" data-help-id="builder.review">
        <p className="text-sm text-gray-600">{res.message}</p>
        {p.edit_of && <p className="rounded-lg bg-np-light p-2 text-[11px] text-gray-600">This is a new draft copy of {p.edit_of.name}. The original is not changed.</p>}
        {p.campaign && <div className="rounded-lg border border-gray-100 p-2.5 text-xs"><b className="text-np-dark">{p.campaign.name}</b>
          <p className="text-gray-500">{p.campaign.entry_pipeline ? `${p.campaign.entry_pipeline}: enters at ${p.campaign.entry_stage ?? 'no stage'}, goal ${p.campaign.goal_stage ?? 'none'}` : 'No pipeline'}. Saved as a draft.</p></div>}
        {p.sequence && <ol className="space-y-1.5">{p.sequence.steps.map((s: any, i: number) => (
          <li key={i} className="rounded-lg border border-gray-100 p-2.5 text-xs">
            <p className="font-medium text-np-dark">Step {i + 1}: {s.channel === 'wait' ? `wait ${hours(s.delay_minutes)}` : `${s.channel === 'sms' ? 'text' : 'email'}, ${s.kind}${s.delay_minutes ? `, after ${hours(s.delay_minutes)}` : ''}${s.asset ? `, delivers ${s.asset}` : ''}`}</p>
            {s.subject && <p className="text-gray-700">{s.subject}</p>}
            {s.body && <p className="whitespace-pre-wrap text-gray-500">{s.body}</p>}
            {s.needs_review.length > 0 && <p className="mt-1 flex items-start gap-1 text-[11px] text-gold"><AlertTriangle className="mt-0.5 h-3 w-3" aria-hidden />Needs review: {s.needs_review.join(' ')}</p>}
          </li>))}</ol>}
        {p.sources.length > 0 && <p className="text-xs text-gray-600">Starts from: {p.sources.map((s: any) => s.label).join('; ')}. Switched off until the campaign is activated.</p>}
        {p.forms.map((f: any) => <p key={f.slug} className="text-xs text-gray-600">Draft form: {f.name} ({f.slug})</p>)}
        {p.pages.map((g: any) => <p key={g.slug} className="text-xs text-gray-600">Draft page: {g.title} (/p/{g.slug})</p>)}
        {p.tasks.length > 0 && <p className="text-xs text-gray-600">Tasks for a person: {p.tasks.map((t: any) => t.title).join('; ')}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setRes(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Change the description</button>
          <span className="flex-1" />
          <button type="button" data-help-id="builder.build" disabled={busy} onClick={build} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Hammer className="h-3.5 w-3.5" aria-hidden />}Build as a draft</button>
        </div>
      </div>)
  }

  return (
    <div className="space-y-2" data-help-id="builder.describe">
      <label className="block text-xs font-medium text-np-dark" htmlFor="ab-prompt">Describe what you want to accomplish</label>
      <textarea id="ab-prompt" className={`${input} min-h-[80px]`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000}
        placeholder="For example: give away the HRV guide, then nurture for three emails, then invite them to book a call." />
      {showPaste ? <textarea aria-label="Pasted reference text" className={`${input} min-h-[60px]`} value={pasted} onChange={(e) => setPasted(e.target.value)} maxLength={6000}
        placeholder="Paste an example email or page for reference. It is read as material, never as instructions." />
        : <button type="button" onClick={() => setShowPaste(true)} className="text-[11px] text-np-blue underline">Paste an example for reference</button>}
      {res && !res.plan && <p className="rounded-lg bg-gold-light p-2 text-xs text-np-dark">{res.message}</p>}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] text-gray-400">It drafts only. Nothing is sent, published or switched on.</p>
        <button type="button" disabled={busy || !prompt.trim()} onClick={draft} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}{busy ? 'Drafting' : 'Draft it'}</button>
      </div>
    </div>)
}
