'use client'

// Resources page › Links (Running List q33, hub_240): booking links, checkout links, quizzes, program pages,
// videos and artifacts, each with a type, an https address, an owner and "where used" (typed, plus the campaign
// steps that contain the address, found by the server). Add, edit, retire. Retire never deletes: a retired link
// stops redirecting from tracked links and can be restored.
import { useState } from 'react'
import { Plus, Save, Archive, ExternalLink, Loader2 } from 'lucide-react'
import { RESOURCE_KINDS, KIND_LABEL, type ResourceKind } from '@/lib/resources/common'

export interface StaffOption { user_id: string; label: string }
export interface LinkResource {
  id: string; name: string; description: string | null; kind: ResourceKind; url: string; owner_id: string | null
  where_used: string | null; archived_at: string | null; used_in_steps: Array<{ sequence_id: string; sequence_name: string; step_order: number }>
}
type Call = (method: string, body: Record<string, unknown>, ok: string) => Promise<boolean>

const LINK_KINDS = RESOURCE_KINDS.filter(k => k !== 'pdf')
const field = 'px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg bg-white'

export function OwnerSelect({ value, staff, onChange, disabled }: { value: string | null; staff: StaffOption[]; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} className={`${field} min-w-0`}>
      <option value="">No owner</option>
      {staff.map(s => <option key={s.user_id} value={s.user_id}>{s.label}</option>)}
      {value && !staff.some(s => s.user_id === value) && <option value={value}>A former staff member</option>}
    </select>
  )
}

export function StepsUsing({ steps }: { steps: LinkResource['used_in_steps'] }) {
  if (!steps.length) return null
  return <p className="text-[10px] text-gray-400">In campaign steps: {steps.map(s => `${s.sequence_name} step ${s.step_order}`).join(', ')}</p>
}

export function LinkResources({ items, staff, busy, call, reload }: { items: LinkResource[]; staff: StaffOption[]; busy: string | null; call: Call; reload: () => void }) {
  const [form, setForm] = useState({ name: '', url: '', kind: 'booking_link' as ResourceKind, owner_id: null as string | null, where_used: '' })
  const [edits, setEdits] = useState<Record<string, Partial<LinkResource>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const add = async () => {
    setSaving('add')
    try {
      const ok = await call('POST', { name: form.name, url: form.url, kind: form.kind, owner_id: form.owner_id, where_used: form.where_used }, `${form.name.trim()} added.`)
      if (ok) { setForm({ name: '', url: '', kind: 'booking_link', owner_id: null, where_used: '' }); reload() }
    } finally { setSaving(null) }
  }
  const save = async (r: LinkResource, body: Record<string, unknown>, ok: string) => {
    setSaving(r.id)
    try { if (await call('PATCH', { id: r.id, ...body }, ok)) { setEdits(p => { const n = { ...p }; delete n[r.id]; return n }); reload() } } finally { setSaving(null) }
  }

  return (
    <div className="space-y-2" data-help-section="resource-links">
      <div className="p-4 rounded-xl border border-gray-100 bg-white space-y-2">
        <h3 className="text-xs font-bold text-np-dark">Add a link</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Title" maxLength={200} className={field} />
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." maxLength={2000} className={field} />
          <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as ResourceKind }))} className={field}>
            {LINK_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <OwnerSelect value={form.owner_id} staff={staff} onChange={v => setForm(f => ({ ...f, owner_id: v }))} />
          <input value={form.where_used} onChange={e => setForm(f => ({ ...f, where_used: e.target.value }))} placeholder="Where used (optional)" maxLength={2000} className={`${field} sm:col-span-2`} />
        </div>
        <div className="flex justify-end">
          <button onClick={add} disabled={!form.name.trim() || !form.url.trim() || saving === 'add'}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark disabled:opacity-40">
            {saving === 'add' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add link
          </button>
        </div>
      </div>

      {items.length === 0 ? <p className="text-xs text-gray-400">No links match.</p> : items.map(r => {
        const e = { ...r, ...edits[r.id] }
        const dirty = e.name !== r.name || e.url !== r.url || e.kind !== r.kind || (e.where_used ?? '') !== (r.where_used ?? '')
        const set = (patch: Partial<LinkResource>) => setEdits(p => ({ ...p, [r.id]: { ...p[r.id], ...patch } }))
        const off = saving === r.id || busy === r.id
        return (
          <div key={r.id} className="p-3 rounded-xl border border-gray-100 bg-white space-y-1.5">
            <div className="grid sm:grid-cols-2 gap-2">
              <input value={e.name} maxLength={200} onChange={ev => set({ name: ev.target.value })} className={`${field} font-semibold text-np-dark`} />
              <div className="flex items-center gap-1 min-w-0">
                <input value={e.url} maxLength={2000} onChange={ev => set({ url: ev.target.value })} className={`${field} flex-1 min-w-0`} />
                <a href={r.url} target="_blank" rel="noopener noreferrer" title="Open" className="text-gray-400 hover:text-np-dark flex-shrink-0"><ExternalLink size={12} /></a>
              </div>
              <select value={e.kind} onChange={ev => set({ kind: ev.target.value as ResourceKind })} className={field}>
                {LINK_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <OwnerSelect value={r.owner_id} staff={staff} disabled={off} onChange={v => save(r, { owner_id: v }, 'Owner saved.')} />
              <input value={e.where_used ?? ''} maxLength={2000} placeholder="Where used" onChange={ev => set({ where_used: ev.target.value })} className={`${field} sm:col-span-2`} />
            </div>
            <StepsUsing steps={r.used_in_steps} />
            <div className="flex justify-end gap-1.5">
              {dirty && (
                <button onClick={() => save(r, { name: e.name, url: e.url, kind: e.kind, where_used: e.where_used ?? '' }, 'Saved.')} disabled={off || !e.name.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40"><Save size={10} /> Save</button>
              )}
              <button onClick={() => save(r, { archived: true }, `${r.name} retired. Its tracked links stop working until it is restored.`)} disabled={off}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40"><Archive size={10} /> Retire</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
