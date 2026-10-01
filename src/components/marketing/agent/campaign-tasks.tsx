'use client'
// The follow-up tasks the Campaign Builder left on a campaign (ruling 14, Phase 2). Each is also
// a Client Task; marking it done here does not change the Client Task, and the other way round.
import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import type { CampaignTask } from '../types'

export function CampaignTasks({ orgId, tasks, reload }: { orgId: string; tasks: CampaignTask[]; reload: () => void }) {
  const toast = useToast()
  if (!tasks.length) return null
  async function set(id: string, status: CampaignTask['status']) {
    try { await api('/api/marketing/agent', { action: 'task', org_id: orgId, id, status }); reload() } catch (e: any) { toast.show(e.message, 'error') }
  }
  const open = tasks.filter((t) => t.status === 'open').length
  return (
    <div className="rounded-card border border-gray-100 bg-white p-4 shadow-card" data-help-id="funnel.tasks">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><ListChecks className="h-4 w-4 text-np-blue" aria-hidden />Still to do<span className="text-xs font-normal text-gray-500">({open} open)</span></h3>
      <ul className="space-y-1.5">{tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
          <button type="button" onClick={() => set(t.id, t.status === 'open' ? 'done' : 'open')} aria-label={t.status === 'open' ? `Mark ${t.title} done` : `Reopen ${t.title}`} className="mt-0.5 text-gray-400 hover:text-teal">
            {t.status === 'open' ? <Circle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-teal" aria-hidden />}</button>
          <div className="flex-1"><p className={t.status === 'open' ? 'text-np-dark' : 'text-gray-400 line-through'}>{t.title}</p>{t.detail && <p className="text-[11px] text-gray-500">{t.detail}</p>}</div>
        </li>))}</ul>
      <p className="mt-2 text-[11px] text-gray-400">Left by the Campaign Builder. Each one is also in Client Tasks.</p>
    </div>)
}
