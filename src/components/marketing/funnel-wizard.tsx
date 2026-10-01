'use client'
// Guided setup for a funnel campaign: purpose, who enters, pipeline, messages, then a
// readiness check and a test drive. It writes exactly what the campaign screen reads
// (/api/marketing/campaigns, /sequences, /routes), so the screen stays the place to edit.
import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X, Plus, Play, Save } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { describeSource, readiness, TEMPLATES, type Template } from '@/lib/marketing/ui-logic'
import { SourcePicker } from './source-picker'
import { StepsEditor, blankStep } from './sequence-editor'
import { TestDriveResult } from './test-drive-result'
import { Help, HowItWorks } from './help'
import type { FunnelCampaign, Overview, Step } from './types'

const STEPS = ['What it is for', 'Who enters', 'Pipeline', 'Messages', 'Review and test']
const PURPOSES: Array<{ id: string; label: string; name: string; suggest: Template[] }> = [
  { id: 'welcome', label: 'Welcome new sign-ups and introduce your work', name: 'Welcome new sign-ups', suggest: ['welcome', 'nurture'] },
  { id: 'resource', label: 'Deliver a free resource someone asked for', name: 'Free resource delivery', suggest: ['asset', 'nurture'] },
  { id: 'nurture', label: 'Stay in touch with leads until they book', name: 'Nurture toward a booking', suggest: ['nurture'] },
  { id: 'reminder', label: 'Remind people about a session they booked', name: 'Session reminders', suggest: ['reminder'] },
  { id: 'other', label: 'Something else', name: '', suggest: [] },
]
const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const lbl = 'mb-1 flex items-center text-[11px] font-medium text-gray-500'

export function FunnelWizard({ orgId, data, existing, onClose, onSaved }: {
  orgId: string; data: Overview; existing: FunnelCampaign | null; onClose: () => void; onSaved: (id: string) => void
}) {
  const toast = useToast()
  const existingKeys = existing ? data.routes.filter((r) => r.campaign_id === existing.id).map((r) => r.source_key) : []
  const existingSteps = existing ? data.steps.filter((s) => s.sequence_id === existing.sequence_id).sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0)) : []
  const [at, setAt] = useState(0)
  const [purpose, setPurpose] = useState(existing ? 'other' : '')
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [keys, setKeys] = useState<string[]>(existingKeys)
  const [pipe, setPipe] = useState(existing?.entry_pipeline_id ?? '')
  const [entry, setEntry] = useState(existing?.entry_stage_id ?? '')
  const [goal, setGoal] = useState(existing?.goal_stage_id ?? '')
  const [steps, setSteps] = useState<Step[]>(existingSteps)
  const [previewed, setPreviewed] = useState<number[]>([])
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null)
  const [seqId, setSeqId] = useState<string | null>(existing?.sequence_id ?? null)
  const [busy, setBusy] = useState(false)
  const [drive, setDrive] = useState<{ at: number; result: any } | null>(null)
  const stages = useMemo(() => data.stages.filter((s) => s.pipeline_id === pipe && !s.archived_at).sort((a, b) => a.position - b.position), [data.stages, pipe])
  const suggest = PURPOSES.find((p) => p.id === purpose)?.suggest ?? []

  const ready = readiness({ senderProblem: data.sender_problem, unsubscribeReady: data.unsubscribe_ready, steps, routeKeys: keys,
    forms: data.forms, previewed, testDriveDone: !!drive?.result?.enrolled })

  async function persist(status: 'draft' | 'active'): Promise<string | null> {
    setBusy(true)
    try {
      const c = await api('/api/marketing/campaigns', { id: savedId ?? undefined, org_id: orgId, name: name.trim(), description: description.trim() || null, status,
        entry_pipeline_id: pipe || null, entry_stage_id: entry || null, goal_stage_id: goal || null, sequence_id: seqId,
        planning_campaign_id: existing?.planning_campaign_id ?? null })
      const id: string = c.campaign.id
      setSavedId(id)
      const sq = await api('/api/marketing/sequences', { org_id: orgId, id: seqId ?? undefined, name: `${name.trim()} steps`, campaign_id: id, steps })
      setSeqId(sq.sequence_id)
      const before = data.routes.filter((r) => r.campaign_id === id).map((r) => r.source_key)
      for (const k of keys.filter((k) => !before.includes(k))) await api('/api/marketing/routes', { org_id: orgId, campaign_id: id, source_key: k })
      for (const k of before.filter((k) => !keys.includes(k))) await api('/api/marketing/routes', { org_id: orgId, campaign_id: id, source_key: k, remove: true })
      onSaved(id)
      return id
    } catch (e: any) {
      toast.show(`${e.message} Nothing you entered is lost; fix it and save again.`, 'error')
      return null
    } finally { setBusy(false) }
  }
  async function saveDraft() { if (await persist('draft')) { toast.show('The campaign is saved as a draft. It does nothing until it is set to Active.'); onClose() } }
  async function activateAndTest() {
    const id = await persist('active')
    if (!id) return
    try {
      const r = await api('/api/marketing/test-enroll', { org_id: orgId, campaign_id: id })
      setDrive({ at: Date.now(), result: r.result ?? {} })
      toast.show(r.result?.enrolled ? 'Saved and active. Your test contact is in the campaign.' : 'Saved and active, but the test drive did not start. The reason is shown below.', r.result?.enrolled ? 'success' : 'info')
    } catch (e: any) { toast.show(`${e.message} The campaign is saved; you can run the test drive from its page.`, 'error') }
  }

  const canNext = at !== 0 || name.trim().length > 0
  return (
    <div className="rounded-card border border-gray-100 bg-white p-4 shadow-card" role="region" aria-label="Guided setup">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-np-dark">{existing ? 'Guided setup' : 'New funnel campaign'}</h2><HowItWorks />
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label="Close the guided setup" className="rounded p-1 text-gray-400 hover:text-np-dark"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <ol className="mb-4 flex flex-wrap gap-1" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === at ? 'step' : undefined}>
            <button type="button" onClick={() => (i === 0 || name.trim()) && setAt(i)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${i === at ? 'bg-np-blue text-white' : i < at ? 'bg-teal-light text-teal-dark' : 'bg-gray-50 text-gray-500'}`}>
              {i < at ? <Check className="h-3 w-3" aria-hidden /> : <span>{i + 1}.</span>}{s}</button>
          </li>))}
      </ol>

      {at === 0 && <div className="space-y-3">
        <fieldset><legend className={lbl}>What is this campaign for?</legend>
          <div className="grid gap-1.5 md:grid-cols-2">{PURPOSES.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${purpose === p.id ? 'border-np-blue bg-np-blue-light' : 'border-gray-100'}`}>
              <input type="radio" name="purpose" checked={purpose === p.id} onChange={() => { setPurpose(p.id); if (!name.trim() || PURPOSES.some((x) => x.name === name)) setName(p.name) }} />{p.label}</label>))}</div>
        </fieldset>
        <div><label className={lbl} htmlFor="wz-name">Campaign name</label><input id="wz-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Spring workshop welcome" /></div>
        <div><label className={lbl} htmlFor="wz-desc">A note for your team (optional)</label><input id="wz-desc" className={input} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {!name.trim() && <p className="text-[11px] text-gray-500">Give the campaign a name to continue.</p>}
      </div>}

      {at === 1 && <div className="space-y-3">
        <p className="flex items-center text-sm text-gray-600">Choose what brings a person into this campaign. You can add more than one.<Help topic="Starts from" k="startsFrom" /></p>
        <SourcePicker forms={data.forms} pipelines={data.pipelines} stages={data.stages} taken={keys} onAdd={(k) => setKeys([...keys, k])} />
        {keys.length ? <ul className="space-y-1">{keys.map((k) => (
          <li key={k} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-sm"><span className="flex-1">{describeSource(k, data.forms, data.stages)}</span>
            <button type="button" aria-label={`Remove ${k}`} onClick={() => setKeys(keys.filter((x) => x !== k))} className="text-gray-400 hover:text-fire"><X className="h-3.5 w-3.5" aria-hidden /></button></li>))}</ul>
          : <p className="text-[11px] text-gray-500">Nothing starts this campaign yet. You can continue and add sources later; until then only a test drive can enter someone.</p>}
      </div>}

      {at === 2 && <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div><span className={lbl}><label htmlFor="wz-pipe">Pipeline</label><Help topic="Pipeline" k="pipeline" /></span>
            <select id="wz-pipe" className={input} value={pipe} onChange={(e) => { setPipe(e.target.value); setEntry(''); setGoal('') }}>
              <option value="">No pipeline</option>{data.pipelines.filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><span className={lbl}><label htmlFor="wz-entry">People enter at</label><Help topic="People enter at" k="entry" /></span>
            <select id="wz-entry" className={input} disabled={!pipe} value={entry} onChange={(e) => setEntry(e.target.value)}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name} ({data.stage_counts[s.id] ?? 0} now)</option>)}</select></div>
          <div><span className={lbl}><label htmlFor="wz-goal">The goal is reached at</label><Help topic="The goal is reached at" k="goal" /></span>
            <select id="wz-goal" className={input} disabled={!pipe} value={goal} onChange={(e) => setGoal(e.target.value)}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name} ({data.stage_counts[s.id] ?? 0} now)</option>)}</select></div>
        </div>
        {pipe && !stages.length && <p className="text-xs text-gray-500">This pipeline has no stages. Add them in CRM, Pipelines, then come back.</p>}
        {stages.length > 0 && <div className="flex flex-wrap gap-1.5">{stages.map((s) => (
          <span key={s.id} className={`rounded-lg border px-2 py-1 text-[11px] ${s.id === entry ? 'border-np-blue bg-np-blue-light text-np-blue-dark' : s.id === goal ? 'border-teal bg-teal-light text-teal-dark' : 'border-gray-100 text-gray-500'}`}>{s.name} <b>{data.stage_counts[s.id] ?? 0}</b></span>))}</div>}
        {!pipe && <p className="text-[11px] text-gray-500">A pipeline is optional. Without one, people still receive the messages, but nothing shows on your board and there is no goal to stop at.</p>}
      </div>}

      {at === 3 && <div className="space-y-3">
        <div><p className="mb-1.5 flex items-center text-xs font-medium text-gray-500">Start from a template<Help topic="Kind of message" k="kind" /></p>
          <div className="flex flex-wrap gap-1.5">{(Object.keys(TEMPLATES) as Template[]).map((t) => (
            <button key={t} type="button" title={TEMPLATES[t].why} onClick={() => setSteps([...steps, { ...blankStep(), ...TEMPLATES[t].step, asset_id: null }])}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${suggest.includes(t) ? 'border-np-blue text-np-blue' : 'border-gray-200 text-np-dark'} hover:bg-np-light`}>
              <Plus className="h-3 w-3" aria-hidden />{TEMPLATES[t].label}{suggest.includes(t) ? ' (suggested)' : ''}</button>))}
            <button type="button" onClick={() => setSteps([...steps, blankStep()])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-500"><Plus className="h-3 w-3" aria-hidden />Blank step</button></div>
          <p className="mt-1 text-[11px] text-gray-400">Each template is a starting point you can edit. Hover a template to see when it is used.</p></div>
        <StepsEditor orgId={orgId} steps={steps} setSteps={setSteps} assets={data.assets} previewed={previewed} setPreviewed={setPreviewed} />
      </div>}

      {at === 4 && <div className="space-y-3">
        <p className="text-sm text-gray-600">Check these before people start entering. Anything not ready links to where it is fixed.</p>
        <ul className="space-y-1.5">{ready.map((r) => (
          <li key={r.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${r.ok ? 'border-teal/30 bg-teal-light/50' : 'border-gold/30 bg-gold-light'}`}>
            {r.ok ? <Check className="mt-0.5 h-4 w-4 text-teal" aria-label="Ready" /> : <X className="mt-0.5 h-4 w-4 text-gold" aria-label="Not ready" />}
            <div className="flex-1"><p className="text-np-dark">{r.label}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div>
            {r.fix === 'settings' && <a className="text-xs text-np-blue underline" href="/crm/settings?section=campaign_sending">Fix in settings</a>}
            {r.fix === 'forms' && <a className="text-xs text-np-blue underline" href={`/forms${r.formId ? `?id=${r.formId}` : ''}`}>Fix the form</a>}
            {r.fix === 'messages' && <button type="button" className="text-xs text-np-blue underline" onClick={() => setAt(3)}>Go to messages</button>}
            {r.fix === 'test' && <button type="button" className="text-xs text-np-blue underline" onClick={activateAndTest} disabled={busy}>Run it</button>}
          </li>))}</ul>
        {!data.flags.engine && <p className="rounded-lg bg-np-light p-2 text-[11px] text-gray-600">The campaign engine is switched off for this organization, so a test drive will report that and nothing will run. A superadmin can switch it on in CRM Settings, Campaign Sending.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={saveDraft} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"><Save className="h-3.5 w-3.5" aria-hidden />Save as draft</button>
          <span className="inline-flex items-center"><button type="button" disabled={busy} onClick={activateAndTest} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50"><Play className="h-3.5 w-3.5" aria-hidden />Save, set Active and test drive</button><Help topic="Test drive" k="testDrive" /></span>
        </div>
        <p className="text-[11px] text-gray-500">Setting the campaign to Active lets people who arrive from its sources enter it. While live sending is off, they only get dry runs: the Hub records what it would have sent and sends nothing.</p>
        {drive && savedId && <TestDriveResult campaignId={savedId} startedAt={drive.at} enrollResult={drive.result} />}
        {savedId && drive && <button type="button" onClick={onClose} className="text-xs text-np-blue underline">Open the campaign page</button>}
      </div>}

      <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
        <button type="button" disabled={at === 0} onClick={() => setAt(at - 1)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Back</button>
        <span className="flex-1 text-center text-[11px] text-gray-400">Step {at + 1} of {STEPS.length}</span>
        {at < STEPS.length - 1 && <button type="button" disabled={!canNext} onClick={() => setAt(at + 1)} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-40">Next<ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>}
      </div>
    </div>
  )
}
