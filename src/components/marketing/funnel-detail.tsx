'use client'
// One funnel campaign: where people enter the pipeline, what starts it, its steps, its
// goal, and how it sends. Every message is a dry run until live sending is switched on.
import { useMemo, useState } from 'react'
import { Play, ShieldCheck, Link2, X, Target, Wand2 } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { describeSource, sourceGapText } from '@/lib/marketing/ui-logic'
import { SequenceEditor } from './sequence-editor'
import { SourcePicker } from './source-picker'
import { TestDriveResult } from './test-drive-result'
import { Help, HowItWorks } from './help'
import type { FunnelCampaign, Overview } from './types'

const lbl = 'mb-1 flex items-center text-[11px] font-medium text-gray-500'
const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const card = 'rounded-card border border-gray-100 bg-white p-4 shadow-card'
const h3 = 'mb-2 flex items-center gap-1.5 text-sm font-semibold text-np-dark'

export function FunnelDetail({ orgId, data, campaign, reload, onGuided }: { orgId: string; data: Overview; campaign: FunnelCampaign; reload: () => void; onGuided: () => void }) {
  const toast = useToast()
  const [c, setC] = useState(campaign)
  const [busy, setBusy] = useState(false)
  const [drive, setDrive] = useState<{ at: number; result: any } | null>(null)
  const stages = useMemo(() => data.stages.filter((s) => s.pipeline_id === c.entry_pipeline_id && !s.archived_at).sort((a, b) => a.position - b.position), [data.stages, c.entry_pipeline_id])
  const routes = data.routes.filter((r) => r.campaign_id === c.id)
  const steps = data.steps.filter((s) => s.sequence_id === c.sequence_id).sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
  const counts = data.enrollment_counts[c.id] ?? {}

  async function save(patch: Partial<FunnelCampaign> = {}) {
    setBusy(true)
    try {
      const r = await api('/api/marketing/campaigns', { ...c, ...patch, org_id: orgId })
      setC(r.campaign); toast.show('The campaign is saved.'); reload()
    } catch (e: any) { toast.show(`${e.message} Your changes are still on screen; adjust and save again.`, 'error') } finally { setBusy(false) }
  }
  async function route(key: string, remove = false) {
    try { await api('/api/marketing/routes', { org_id: orgId, campaign_id: c.id, source_key: key, remove }); reload() }
    catch (e: any) { toast.show(`${e.message} Try again, or use Advanced to check the key.`, 'error') }
  }
  async function live(on: boolean) {
    try { const r = await api('/api/marketing/campaigns/live', { org_id: orgId, id: c.id, live: on }); setC({ ...c, live_enabled: r.campaign.live_enabled }); toast.show(on ? 'Live sending is on for this campaign.' : 'This campaign is back to dry runs.'); reload() }
    catch (e: any) { toast.show(e.message, 'error') }
  }
  async function testDrive() {
    try {
      const r = await api('/api/marketing/test-enroll', { org_id: orgId, campaign_id: c.id })
      setDrive({ at: Date.now(), result: r.result ?? {} })
      reload()
    } catch (e: any) { toast.show(`${e.message} If it says to add a test contact, one is needed on the allowlist before a test drive can run.`, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="mb-2 flex items-center gap-1"><span className="text-xs text-gray-500">How this works</span><HowItWorks />
          <span className="flex-1" />
          {c.status === 'draft' && <button type="button" onClick={onGuided} className="inline-flex items-center gap-1 text-xs text-np-blue underline"><Wand2 className="h-3.5 w-3.5" aria-hidden />Run the guided setup again</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <div><label className={lbl} htmlFor="fc-name">Campaign name</label><input id="fc-name" className={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div><span className={lbl}><label htmlFor="fc-status">Status</label><Help topic="Status" k="status" /></span>
            <select id="fc-status" className={input} value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as FunnelCampaign['status'] })}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
            </select></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {([['active', 'in it now'], ['goal_met', 'reached the goal'], ['completed', 'finished every step'], ['duplicate', 'entered again while already in it']] as const).map(([k, t]) => (
            <span key={k} className="rounded-full bg-np-light px-2 py-0.5 text-gray-600"><b className="text-np-dark">{counts[k] ?? 0}</b> {t}</span>))}
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}><Target className="h-4 w-4 text-np-blue" aria-hidden />Pipeline<Help topic="the Pipeline section" k="section" /></h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div><span className={lbl}><label htmlFor="fc-pipe">Pipeline</label><Help topic="Pipeline" k="pipeline" /></span>
            <select id="fc-pipe" className={input} value={c.entry_pipeline_id ?? ''} onChange={(e) => setC({ ...c, entry_pipeline_id: e.target.value || null, entry_stage_id: null, goal_stage_id: null })}>
              <option value="">No pipeline</option>{data.pipelines.filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><span className={lbl}><label htmlFor="fc-entry">People enter at</label><Help topic="People enter at" k="entry" /></span>
            <select id="fc-entry" className={input} value={c.entry_stage_id ?? ''} disabled={!c.entry_pipeline_id} onChange={(e) => setC({ ...c, entry_stage_id: e.target.value || null })}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><span className={lbl}><label htmlFor="fc-goal">The goal is reached at</label><Help topic="The goal is reached at" k="goal" /></span>
            <select id="fc-goal" className={input} value={c.goal_stage_id ?? ''} disabled={!c.entry_pipeline_id} onChange={(e) => setC({ ...c, goal_stage_id: e.target.value || null })}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        </div>
        {!c.entry_pipeline_id && <p className="mt-2 text-[11px] text-gray-500">No pipeline is chosen. People still receive the messages, but nothing shows on your board and there is no goal to stop at. Choose a pipeline above if you want both.</p>}
        {c.entry_pipeline_id && !stages.length && <p className="mt-2 text-[11px] text-gray-500">This pipeline has no stages. Add them in CRM, Pipelines, then choose them here.</p>}
        {stages.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{stages.map((s) => (
          <span key={s.id} className={`rounded-lg border px-2 py-1 text-[11px] ${s.id === c.entry_stage_id ? 'border-np-blue bg-np-blue-light text-np-blue-dark' : s.id === c.goal_stage_id ? 'border-teal bg-teal-light text-teal-dark' : 'border-gray-100 text-gray-500'}`}>
            {s.name} <b>{data.stage_counts[s.id] ?? 0}</b></span>))}</div>}
        <div className="mt-3 flex justify-end"><button type="button" disabled={busy} onClick={() => save()} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">Save campaign</button></div>
      </div>

      <div className={card}>
        <h3 className={h3}><Link2 className="h-4 w-4 text-np-blue" aria-hidden />Starts from<Help topic="Starts from" k="startsFrom" /></h3>
        {routes.length === 0 && <p className="mb-2 text-xs text-gray-500">Nothing starts this campaign yet, so only a test drive can enter someone. Choose an event below and press Add this.</p>}
        <ul className="mb-2 space-y-1">{routes.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-sm">
            <span className="flex-1">{describeSource(r.source_key, data.forms, data.stages)}
              {data.sources && (sourceGapText(r.source_key, data.sources)
                ? <span className="ml-2 text-[10px] text-gold" title={sourceGapText(r.source_key, data.sources) ?? ''}>Not connected yet</span>
                : <span className="ml-2 text-[10px] text-teal">Connected</span>)}</span>
            <span className="font-mono text-[10px] text-gray-400">{r.source_key}</span>
            <button type="button" aria-label={`Remove ${describeSource(r.source_key, data.forms, data.stages)}`} onClick={() => route(r.source_key, true)} className="text-gray-400 hover:text-fire"><X className="h-3.5 w-3.5" aria-hidden /></button>
          </li>))}</ul>
        <SourcePicker forms={data.forms} pipelines={data.pipelines} stages={data.stages} taken={routes.map((r) => r.source_key)} onAdd={(k) => route(k)} sources={data.sources} />
      </div>

      <div className={card}>
        <h3 className={h3}>Steps<Help topic="Steps" k="steps" /></h3>
        <SequenceEditor key={c.sequence_id ?? 'new'} orgId={orgId} campaignId={c.id} sequenceId={c.sequence_id} name={c.name} initial={steps} assets={data.assets} onSaved={reload} />
      </div>

      <div className={card}>
        <h3 className={h3}><ShieldCheck className="h-4 w-4 text-teal" aria-hidden />Sending<Help topic="Sending" k="sending" /></h3>
        <p className="text-sm text-gray-600">
          {!data.flags.engine ? 'The campaign engine is switched off for this organization, so nothing runs yet. A superadmin can switch it on in CRM Settings, Campaign Sending.'
            : !data.flags.gate_live_sends ? 'Every message is a dry run: the Hub records what it would have sent and sends nothing.'
            : c.live_enabled ? 'This campaign sends for real to people who have agreed to hear from you.'
            : 'Only the test contacts on the allowlist receive real messages. Everyone else gets a dry run.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center"><button type="button" onClick={testDrive} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"><Play className="h-3.5 w-3.5" aria-hidden />Test drive with my test contact</button><Help topic="Test drive" k="testDrive" /></span>
          <span className="flex-1" />
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={c.live_enabled} disabled={!data.can_go_live} onChange={(e) => live(e.target.checked)} />
            Live sending for this campaign
          </label><Help topic="Live sending" k="live" />
        </div>
        {c.status !== 'active' && <p className="mt-1 text-[11px] text-gray-500">A test drive only runs on an active campaign. Set the status to Active and save first.</p>}
        {!data.can_go_live && <p className="mt-1 text-right text-[11px] text-gray-400">Only a platform superadmin can switch live sending on.</p>}
        <TestDriveResult campaignId={c.id} startedAt={drive?.at ?? null} enrollResult={drive?.result ?? null} />
      </div>
    </div>
  )
}
