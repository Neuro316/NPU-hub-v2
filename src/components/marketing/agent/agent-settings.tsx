'use client'
// AI assistant limits (rulings 8, 20, 21): the monthly spending limits, the per-conversation and
// per-run limits, and which staff may use the Hub Guide. Platform superadmins only; the route
// checks that again. Shows this month's spend so a limit is set against real use.
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'

const ROLES = [['superadmin', 'Platform superadmins'], ['admin', 'Organization admins'], ['team_member', 'Team members']] as const
const input = 'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm'

export function AgentSettings({ orgId }: { orgId: string }) {
  const toast = useToast()
  const [p, setP] = useState<any>(null)
  const [usage, setUsage] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const r = await api('/api/marketing/agent', { action: 'policy', org_id: orgId }); setP(r.policy); setUsage(r.usage) } catch (e: any) { toast.show(e.message, 'error') }
  }, [orgId, toast])
  useEffect(() => { load() }, [load])
  if (!p) return null
  const spent = (mode: string) => Number(usage.find((u) => u.mode === mode)?.spent_usd ?? 0).toFixed(2)
  const num = (k: string, label: string, step = '1') => (
    <label className="flex items-center justify-between gap-2 text-xs text-gray-600">{label}
      <input type="number" step={step} min="0" className={input} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>)
  async function save() {
    setBusy(true)
    try { const r = await api('/api/marketing/agent', { action: 'policy', org_id: orgId, policy: p }); setP(r.policy); setUsage(r.usage); toast.show('The AI assistant limits are saved.') }
    catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }
  const roles: string[] = p.help_roles ?? []
  return (
    <div className="rounded-card border border-gray-100 bg-white p-4 shadow-card" data-help-id="settings.agent-limits">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-np-dark"><Sparkles className="h-4 w-4 text-purple-600" aria-hidden />AI assistants</h3>
      <p className="mb-3 text-[11px] text-gray-500">This month: Campaign Builder ${spent('builder')} of ${Number(p.monthly_cap_usd).toFixed(2)}, Hub Guide ${spent('guide')} of ${Number(p.help_monthly_cap_usd).toFixed(2)}.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {num('monthly_cap_usd', 'Campaign Builder monthly limit (USD)', '0.5')}
        {num('help_monthly_cap_usd', 'Hub Guide monthly limit (USD)', '0.5')}
        {num('session_messages', 'Messages per conversation')}
        {num('run_tool_calls', 'Steps per Campaign Builder run')}
      </div>
      <fieldset className="mt-3"><legend className="mb-1 text-xs font-medium text-np-dark">Who may use the Hub Guide</legend>
        <div className="flex flex-wrap gap-3">{ROLES.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={roles.includes(k)} onChange={(e) => setP({ ...p, help_roles: e.target.checked ? [...roles, k] : roles.filter((r) => r !== k) })} />{label}</label>))}</div>
      </fieldset>
      <div className="mt-3 flex justify-end"><button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}Save limits</button></div>
    </div>)
}
