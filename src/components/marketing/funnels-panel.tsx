'use client'
// Campaigns > Funnels: every funnel campaign of the current organization, and the one
// selected. Data comes from GET /api/marketing/overview (staff only, org from membership).
import { useCallback, useEffect, useState } from 'react'
import { Plus, Loader2, Filter } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { FunnelDetail } from './funnel-detail'
import type { Overview } from './types'

const STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', active: 'bg-teal-light text-teal-dark', paused: 'bg-gold-light text-gold', archived: 'bg-gray-50 text-gray-400',
}

export function FunnelsPanel() {
  const { currentOrg } = useWorkspace()
  const toast = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!currentOrg) return
    try { setData(await api(`/api/marketing/overview?org=${currentOrg.id}`)); setError(null) }
    catch (e: any) { setError(e.message) }
  }, [currentOrg])
  useEffect(() => { load() }, [load])

  async function create() {
    if (!currentOrg) return
    try {
      const r = await api('/api/marketing/campaigns', { org_id: currentOrg.id, name: 'New funnel campaign', status: 'draft' })
      await load(); setSel(r.campaign.id); toast.show('A draft campaign is ready to set up.')
    } catch (e: any) { toast.show(e.message, 'error') }
  }

  if (error) return <div className="rounded-card border border-fire/20 bg-fire-light p-4 text-sm text-fire-warm" role="alert">{error}</div>
  if (!data || !currentOrg) return <div className="flex items-center gap-2 p-6 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading campaigns</div>
  const current = data.campaigns.find((c) => c.id === sel) ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-2">
        <button type="button" onClick={create} className="flex w-full items-center justify-center gap-1 rounded-lg bg-np-blue px-3 py-2 text-xs font-medium text-white hover:bg-np-blue-hover"><Plus className="h-3.5 w-3.5" aria-hidden />New funnel campaign</button>
        {!data.flags.engine && <p className="rounded-lg bg-np-light p-2 text-[11px] text-gray-500">The campaign engine is off for this organization. You can set campaigns up now; nothing runs until it is switched on.</p>}
        {data.campaigns.length === 0 && <p className="p-3 text-center text-xs text-gray-400">No funnel campaigns yet.</p>}
        {data.campaigns.map((c) => {
          const n = data.enrollment_counts[c.id] ?? {}
          const steps = data.steps.filter((s) => s.sequence_id === c.sequence_id).length
          return (
            <button key={c.id} type="button" onClick={() => setSel(c.id)} aria-pressed={sel === c.id}
              className={`w-full rounded-card border bg-white p-3 text-left shadow-card transition hover:shadow-card-hover ${sel === c.id ? 'border-np-blue' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-np-blue" aria-hidden /><b className="flex-1 truncate text-sm text-np-dark">{c.name}</b>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[c.status]}`}>{c.status}</span></div>
              <p className="mt-1 text-[11px] text-gray-500">{steps} {steps === 1 ? 'step' : 'steps'}, {n.active ?? 0} in it now, {n.goal_met ?? 0} reached the goal{c.live_enabled ? ', live' : ''}</p>
            </button>
          )
        })}
      </div>
      <div>{current
        ? <FunnelDetail key={current.id} orgId={currentOrg.id} data={data} campaign={current} reload={load} />
        : <div className="rounded-card border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">Choose a campaign to see its pipeline, sources, steps and sending.</div>}
      </div>
    </div>
  )
}
