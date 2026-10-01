'use client'
// One funnel campaign: where people enter the pipeline, what starts it, its steps, its
// goal, and how it sends. Every message is a dry run until live sending is switched on.
import { useMemo, useState } from 'react'
import { Play, ShieldCheck, Link2, X, Target } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { SequenceEditor } from './sequence-editor'
import type { FunnelCampaign, Overview } from './types'

const label = 'block text-[11px] font-medium text-gray-500 mb-1'
const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const card = 'rounded-card border border-gray-100 bg-white p-4 shadow-card'

export function FunnelDetail({ orgId, data, campaign, reload }: { orgId: string; data: Overview; campaign: FunnelCampaign; reload: () => void }) {
  const toast = useToast()
  const [c, setC] = useState(campaign)
  const [newKey, setNewKey] = useState('')
  const [busy, setBusy] = useState(false)
  const stages = useMemo(() => data.stages.filter((s) => s.pipeline_id === c.entry_pipeline_id && !s.archived_at).sort((a, b) => a.position - b.position), [data.stages, c.entry_pipeline_id])
  const routes = data.routes.filter((r) => r.campaign_id === c.id)
  const steps = data.steps.filter((s) => s.sequence_id === c.sequence_id).sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
  const counts = data.enrollment_counts[c.id] ?? {}
  const suggestions = ['call:inbound', 'call:missed', 'booking:intro', ...data.forms.map((f) => f.source_key)].filter((k) => !routes.some((r) => r.source_key === k))

  async function save(patch: Partial<FunnelCampaign> = {}) {
    setBusy(true)
    try {
      const r = await api('/api/marketing/campaigns', { ...c, ...patch, org_id: orgId })
      setC(r.campaign); toast.show('The campaign is saved.'); reload()
    } catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }
  async function route(key: string, remove = false) {
    try { await api('/api/marketing/routes', { org_id: orgId, campaign_id: c.id, source_key: key, remove }); setNewKey(''); reload() }
    catch (e: any) { toast.show(e.message, 'error') }
  }
  async function live(on: boolean) {
    try { const r = await api('/api/marketing/campaigns/live', { org_id: orgId, id: c.id, live: on }); setC({ ...c, live_enabled: r.campaign.live_enabled }); toast.show(on ? 'Live sending is on for this campaign.' : 'This campaign is back to dry runs.'); reload() }
    catch (e: any) { toast.show(e.message, 'error') }
  }
  async function testDrive() {
    try {
      const r = await api('/api/marketing/test-enroll', { org_id: orgId, campaign_id: c.id })
      const res = r.result ?? {}
      toast.show(res.enrolled ? 'Your test contact is in the campaign. The first step runs within five minutes.' : `The test contact was not enrolled: ${String(res.reason ?? 'unknown').replace(/_/g, ' ')}.`, res.enrolled ? 'success' : 'info')
      reload()
    } catch (e: any) { toast.show(e.message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="grid gap-3 md:grid-cols-[1fr_160px]">
          <div><label className={label} htmlFor="fc-name">Campaign name</label><input id="fc-name" className={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div><label className={label} htmlFor="fc-status">Status</label>
            <select id="fc-status" className={input} value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as FunnelCampaign['status'] })}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
            </select></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {(['active', 'goal_met', 'completed', 'duplicate'] as const).map((k) => (
            <span key={k} className="rounded-full bg-np-light px-2 py-0.5 text-gray-600">{k.replace('_', ' ')}: <b className="text-np-dark">{counts[k] ?? 0}</b></span>
          ))}
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><Target className="h-4 w-4 text-np-blue" aria-hidden />Pipeline</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className={label} htmlFor="fc-pipe">Pipeline</label>
            <select id="fc-pipe" className={input} value={c.entry_pipeline_id ?? ''} onChange={(e) => setC({ ...c, entry_pipeline_id: e.target.value || null, entry_stage_id: null, goal_stage_id: null })}>
              <option value="">No pipeline</option>{data.pipelines.filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className={label} htmlFor="fc-entry">People enter at</label>
            <select id="fc-entry" className={input} value={c.entry_stage_id ?? ''} disabled={!c.entry_pipeline_id} onChange={(e) => setC({ ...c, entry_stage_id: e.target.value || null })}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className={label} htmlFor="fc-goal">The goal is reached at</label>
            <select id="fc-goal" className={input} value={c.goal_stage_id ?? ''} disabled={!c.entry_pipeline_id} onChange={(e) => setC({ ...c, goal_stage_id: e.target.value || null })}>
              <option value="">Choose a stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        </div>
        {stages.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{stages.map((s) => (
          <span key={s.id} className={`rounded-lg border px-2 py-1 text-[11px] ${s.id === c.entry_stage_id ? 'border-np-blue bg-np-blue-light text-np-blue-dark' : s.id === c.goal_stage_id ? 'border-teal bg-teal-light text-teal-dark' : 'border-gray-100 text-gray-500'}`}>
            {s.name} <b>{data.stage_counts[s.id] ?? 0}</b></span>))}</div>}
        <p className="mt-2 text-[11px] text-gray-400">Reaching the goal stage ends the campaign for that person, so they stop receiving its messages.</p>
        <div className="mt-3 flex justify-end"><button type="button" disabled={busy} onClick={() => save()} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">Save campaign</button></div>
      </div>

      <div className={card}>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><Link2 className="h-4 w-4 text-np-blue" aria-hidden />Starts from</h3>
        <div className="flex flex-wrap gap-1.5">
          {routes.length === 0 && <p className="text-xs text-gray-400">Nothing starts this campaign yet. Add a source below.</p>}
          {routes.map((r) => <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-np-light px-2 py-0.5 font-mono text-[11px] text-np-dark">{r.source_key}
            <button type="button" aria-label={`Remove source ${r.source_key}`} onClick={() => route(r.source_key, true)} className="text-gray-400 hover:text-fire"><X className="h-3 w-3" aria-hidden /></button></span>)}
        </div>
        <div className="mt-2 flex gap-2">
          <input className={input} list="fc-keys" placeholder="form:webinar, call:missed, booking:intro" value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="New source" />
          <datalist id="fc-keys">{suggestions.map((k) => <option key={k} value={k} />)}</datalist>
          <button type="button" disabled={!newKey.trim()} onClick={() => route(newKey.trim())} className="rounded-lg border border-gray-200 px-3 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">Add</button>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-np-dark">Steps</h3>
        <SequenceEditor key={c.sequence_id ?? 'new'} orgId={orgId} campaignId={c.id} sequenceId={c.sequence_id} name={c.name} initial={steps} assets={data.assets} onSaved={reload} />
      </div>

      <div className={card}>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><ShieldCheck className="h-4 w-4 text-teal" aria-hidden />Sending</h3>
        <p className="text-sm text-gray-600">
          {!data.flags.engine ? 'The campaign engine is switched off for this organization, so nothing runs yet.'
            : !data.flags.gate_live_sends ? 'Every message is a dry run: the Hub writes what it would have sent and sends nothing.'
            : c.live_enabled ? 'This campaign sends for real to people who have agreed to hear from you.'
            : 'Only the test contacts on the allowlist receive real messages. Everyone else gets a dry run.'}
        </p>
        <p className="mt-1 text-[11px] text-gray-400">Every message passes consent, do not contact, quiet hours and the frequency cap first, and each decision is logged.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={testDrive} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"><Play className="h-3.5 w-3.5" aria-hidden />Test drive with my test contact</button>
          <span className="flex-1" />
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={c.live_enabled} disabled={!data.can_go_live} onChange={(e) => live(e.target.checked)} />
            Live sending for this campaign
          </label>
        </div>
        {!data.can_go_live && <p className="mt-1 text-right text-[11px] text-gray-400">Only a platform superadmin can switch live sending on.</p>}
      </div>
    </div>
  )
}
