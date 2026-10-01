'use client'
// Campaigns > Funnels: every funnel campaign of the current organization, the one
// selected, and the guided setup. Data comes from GET /api/marketing/overview (staff
// only, org from membership).
import { useCallback, useEffect, useState } from 'react'
import { Plus, Loader2, Filter, RefreshCw, Compass, Sparkles } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { api } from '@/lib/marketing/client'
import { FunnelDetail } from './funnel-detail'
import { FunnelWizard } from './funnel-wizard'
import { HowItWorks } from './help'
import { AgentPanel, type PanelMode } from './agent/agent-panel'
import { BuilderFlow } from './agent/builder-flow'
import { needsReview } from './agent/ai-chip'
import type { Overview } from './types'

const STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', active: 'bg-teal-light text-teal-dark', paused: 'bg-gold-light text-gold', archived: 'bg-gray-50 text-gray-400',
}

export function FunnelsPanel() {
  const { currentOrg } = useWorkspace()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [wizard, setWizard] = useState<{ id: string | null; key: string } | null>(null)
  const [panel, setPanel] = useState<{ open: boolean; mode: PanelMode; campaignId: string | null }>({ open: false, mode: 'guide', campaignId: null })

  const load = useCallback(async () => {
    if (!currentOrg) return
    try { setData(await api(`/api/marketing/overview?org=${currentOrg.id}`)); setError(null) }
    catch (e: any) { setError(e.message) }
  }, [currentOrg])
  useEffect(() => { load() }, [load])
  // ?funnel=<id> opens that campaign: Campaign Builder tasks in Client Tasks link here
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('funnel')
    if (want && data?.campaigns.some((c) => c.id === want)) setSel((cur) => cur ?? want)
  }, [data])

  if (error) return (
    <div className="rounded-card border border-fire/20 bg-fire-light p-4 text-sm text-fire-warm" role="alert">
      <p className="font-semibold">The campaigns could not be loaded.</p>
      <p className="mt-1">{error} If you were signed out, sign in again. Otherwise try again in a moment; if it keeps happening, the Hub may be updating.</p>
      <button type="button" onClick={load} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-np-dark"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Try again</button>
    </div>)
  if (!data || !currentOrg) return <div className="flex items-center gap-2 p-6 text-sm text-gray-400" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading campaigns</div>
  const current = data.campaigns.find((c) => c.id === sel) ?? null
  const wizardFor = wizard?.id ? data.campaigns.find((c) => c.id === wizard.id) ?? null : null
  // the server checks both again on every call; these only decide what to show
  const builderOn = data.can_go_live && data.flags.agent_enabled
  const guideOn = data.flags.help_bot_enabled
  const built = (ids: any) => { load(); if (ids?.campaign) { setWizard(null); setSel(ids.campaign) } }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-sm text-gray-600">
        <span>Funnel campaigns bring people in from an event, place them on your pipeline, and send them a series of messages until they reach a goal.</span><HowItWorks />
        <span className="flex-1" />
        {guideOn && <button type="button" data-help-id="guide.open" onClick={() => setPanel({ open: true, mode: 'guide', campaignId: null })} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-np-dark hover:bg-gray-50"><Compass className="h-3.5 w-3.5 text-np-blue" aria-hidden />Hub Guide</button>}
        {builderOn && <button type="button" data-help-id="builder.open" onClick={() => setPanel({ open: true, mode: 'builder', campaignId: null })} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-2.5 py-1.5 text-xs text-purple-700 hover:bg-purple-50"><Sparkles className="h-3.5 w-3.5" aria-hidden />Campaign Builder</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2" data-help-id="funnels.list">
          <button type="button" data-help-id="funnels.new" onClick={() => { setSel(null); setWizard({ id: null, key: `new-${Date.now()}` }) }} className="flex w-full items-center justify-center gap-1 rounded-lg bg-np-blue px-3 py-2 text-xs font-medium text-white hover:bg-np-blue-hover"><Plus className="h-3.5 w-3.5" aria-hidden />New funnel campaign</button>
          {!data.flags.engine && <p className="rounded-lg bg-np-light p-2 text-[11px] text-gray-500">The campaign engine is switched off for this organization. You can build campaigns now; nothing runs until a superadmin switches it on in CRM Settings, Campaign Sending.</p>}
          {data.campaigns.length === 0 && <p className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-500">You have no funnel campaigns yet. Press New funnel campaign above; the guided setup walks you through it in five short steps.</p>}
          {data.campaigns.map((c) => {
            const n = data.enrollment_counts[c.id] ?? {}
            const steps = data.steps.filter((s) => s.sequence_id === c.sequence_id).length
            return (
              <button key={c.id} type="button" onClick={() => { setWizard(null); setSel(c.id) }} aria-pressed={sel === c.id}
                className={`w-full rounded-card border bg-white p-3 text-left shadow-card transition hover:shadow-card-hover ${sel === c.id ? 'border-np-blue' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-np-blue" aria-hidden /><b className="flex-1 truncate text-sm text-np-dark">{c.name}</b>{needsReview(c) && <Sparkles className="h-3 w-3 text-purple-600" aria-label="AI draft, needs review" />}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[c.status]}`}>{c.status}</span></div>
                <p className="mt-1 text-[11px] text-gray-500">{steps} {steps === 1 ? 'step' : 'steps'}, {n.active ?? 0} in it now, {n.goal_met ?? 0} reached the goal{c.live_enabled ? ', live' : ''}</p>
              </button>
            )
          })}
        </div>
        <div>
          {wizard && !wizard.id && builderOn && <div className="mb-4 rounded-card border border-purple-100 bg-white p-4 shadow-card">
            <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-np-dark"><Sparkles className="h-4 w-4 text-purple-600" aria-hidden />Start by describing it, or set it up step by step below</p>
            <BuilderFlow orgId={currentOrg.id} onBuilt={built} /></div>}
          {wizard
            ? <FunnelWizard key={wizard.key} orgId={currentOrg.id} data={data} existing={wizardFor}
                onClose={() => { const id = wizard.id; setWizard(null); load(); if (id) setSel(id) }}
                onSaved={(id) => { setWizard((w) => (w && !w.id ? { ...w, id } : w)); load() }} />
            : current
              ? <FunnelDetail key={current.id} orgId={currentOrg.id} data={data} campaign={current} reload={load} onGuided={() => setWizard({ id: current.id, key: current.id })}
                  tasks={(data.campaign_tasks ?? []).filter((t) => t.campaign_id === current.id)}
                  onRevise={builderOn ? () => setPanel({ open: true, mode: 'builder', campaignId: current.id }) : undefined} />
              : <div className="rounded-card border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">Choose a campaign on the left to see and edit it, or press New funnel campaign to set one up step by step.</div>}
        </div>
      </div>
      <AgentPanel orgId={currentOrg.id} open={panel.open} mode={panel.mode} onMode={(m) => setPanel({ ...panel, mode: m })} onClose={() => setPanel({ ...panel, open: false })}
        guideOn={guideOn} builderOn={builderOn} campaignId={panel.campaignId} onBuilt={built} />
    </div>
  )
}
