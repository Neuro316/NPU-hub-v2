'use client'
// University Access: the free University resources a campaign can hand out with a
// "Deliver a free University asset" step. Each delivery is a private link that expires
// and opens a page on university.neuroprogeny.com; University access rules are unchanged.
import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Loader2, Plus } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import type { Asset, Overview } from '@/components/marketing/types'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const empty = { id: '', title: '', description: '', path: '', active: true }

export default function UniversityAccessPage() {
  const { currentOrg } = useWorkspace()
  const toast = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [edit, setEdit] = useState<typeof empty | null>(null)
  const load = useCallback(async () => {
    if (!currentOrg) return
    try { setData(await api(`/api/marketing/overview?org=${currentOrg.id}`)) } catch (e: any) { toast.show(e.message, 'error') }
  }, [currentOrg, toast])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!currentOrg || !edit) return
    try { await api('/api/marketing/assets', { org_id: currentOrg.id, ...edit, id: edit.id || undefined }); toast.show('The asset is saved.'); setEdit(null); load() }
    catch (e: any) { toast.show(e.message, 'error') }
  }
  const usedBy = (a: Asset) => (data?.steps ?? []).filter((s) => s.asset_id === a.id).length

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><h1 className="text-xl font-semibold text-np-dark">University Access</h1>
          <p className="text-sm text-gray-500">Free University resources your campaigns can deliver right after someone signs up.</p></div>
        <button type="button" onClick={() => setEdit({ ...empty })} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-2 text-xs font-medium text-white hover:bg-np-blue-hover"><Plus className="h-3.5 w-3.5" aria-hidden />Add an asset</button>
      </div>
      {data && !data.flags.deliver_asset && <p className="rounded-lg bg-np-light p-3 text-xs text-gray-500">Delivery is switched off for this organization. You can add assets now; links are sent once delivery is switched on.</p>}
      {edit && (
        <div className="space-y-2 rounded-card border border-np-blue/20 bg-white p-4 shadow-card">
          <label className="block text-[11px] font-medium text-gray-500" htmlFor="ua-title">Title</label>
          <input id="ua-title" className={input} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <label className="block text-[11px] font-medium text-gray-500" htmlFor="ua-path">Page on university.neuroprogeny.com</label>
          <input id="ua-path" className={`${input} font-mono`} placeholder="/signup?asset=breathing-guide" value={edit.path} onChange={(e) => setEdit({ ...edit, path: e.target.value })} />
          <label className="block text-[11px] font-medium text-gray-500" htmlFor="ua-desc">What it is</label>
          <input id="ua-desc" className={input} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <label className="inline-flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Available to campaigns</label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover">Save asset</button></div>
        </div>
      )}
      {!data ? <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.assets.length === 0 && <p className="col-span-full rounded-card border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No assets yet.</p>}
          {data.assets.map((a) => (
            <button key={a.id} type="button" onClick={() => setEdit({ ...a, description: a.description ?? '' })} className="rounded-card border border-gray-100 bg-white p-4 text-left shadow-card hover:shadow-card-hover">
              <div className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-fire" aria-hidden /><b className="flex-1 text-sm text-np-dark">{a.title}</b>
                {!a.active && <span className="rounded-full bg-gray-100 px-2 text-[10px] text-gray-500">Off</span>}</div>
              {a.description && <p className="mt-1 text-xs text-gray-500">{a.description}</p>}
              <p className="mt-2 truncate font-mono text-[11px] text-gray-400">university.neuroprogeny.com{a.path}</p>
              <p className="mt-1 text-[11px] text-gray-400">Used in {usedBy(a)} campaign {usedBy(a) === 1 ? 'step' : 'steps'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
