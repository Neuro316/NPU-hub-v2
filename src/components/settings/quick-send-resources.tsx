'use client'

// CRM Settings, "Quick Send Resources": the documents staff can email to a contact
// during or after a call. Each row is a Media Library item (media_assets) with its
// Quick Send fields (hub_quick_send_items). Uploading here puts the file in the
// Media Library already in Quick Send; the Media Library's own "Available in Quick
// Send" toggle edits the same row, so a file is never listed twice.
//
// Also holds the org's Quick Send sender (From address), which admins set.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, MoreVertical, Plus, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  fileTypeLabel, QUICK_SEND_UPLOAD_ACCEPT, QUICK_SEND_UPLOAD_TYPES, isValidEmail, formatBytes,
  type QuickSendCategory, type QuickSendResource,
} from '@/lib/quick-send'

type Resource = QuickSendResource & { has_file?: boolean }
interface ManageData {
  categories: QuickSendCategory[]
  resources: Resource[]
  settings: { from_email: string; from_name: string } | null
  can_admin: boolean
}

const MEDIA_BUCKET = 'media-library'

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json
}

/** Upload straight to the media-library bucket with a signed URL, then record it. */
export async function uploadQuickSendFile(orgId: string, file: File, extra: Record<string, unknown>): Promise<string> {
  if (!QUICK_SEND_UPLOAD_TYPES[file.type]) throw new Error('Upload a PDF, Word (.docx), PowerPoint (.pptx), PNG or JPG file.')
  const { path, token } = await postJson('/api/quick-send/upload-url', {
    org_id: orgId, filename: file.name, content_type: file.type, size: file.size,
  })
  const { error } = await createClient().storage.from(MEDIA_BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type })
  if (error) throw new Error(`The upload failed: ${error.message}`)
  const done = await postJson('/api/quick-send/upload-complete', { org_id: orgId, path, ...extra })
  return done.media_asset_id
}

const titleFromFile = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim()

/** 44px tap target around a small track. Saves on tap. */
export function AvailableSwitch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex h-11 w-14 items-center justify-center disabled:opacity-40">
      <span className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${on ? 'bg-np-blue' : 'bg-gray-300'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
      </span>
    </button>
  )
}

export default function QuickSendResourcesSettings() {
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id
  const [data, setData] = useState<ManageData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [menuAt, setMenuAt] = useState({ top: 0, right: 0 })
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<Resource | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const replaceInput = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoadError('')
    try {
      const res = await fetch(`/api/quick-send/resources?org_id=${encodeURIComponent(orgId)}&scope=manage`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Quick Send could not load.')
      setData(json)
    } catch (e: any) { setLoadError(e.message) }
  }, [orgId])
  useEffect(() => { load() }, [load])

  const say = (kind: 'ok' | 'error', text: string) => setNotice({ kind, text })

  const patchItem = async (r: Resource, patch: Record<string, unknown>, okText?: string) => {
    if (!orgId) return
    // Optimistic for the switch; reloaded either way.
    setData(d => d ? { ...d, resources: d.resources.map(x => x.media_asset_id === r.media_asset_id ? { ...x, ...patch } as Resource : x) } : d)
    try {
      await postJson('/api/quick-send/items', { org_id: orgId, media_asset_id: r.media_asset_id, ...patch })
      if (okText) say('ok', okText)
    } catch (e: any) { say('error', e.message) }
    load()
  }

  const addCategory = async () => {
    if (!orgId || !newCategory.trim()) return
    try {
      const { category } = await postJson('/api/quick-send/categories', { org_id: orgId, name: newCategory })
      setNewCategory(''); setAddingCategory(false); setFilter(category.id)
      await load()
    } catch (e: any) { say('error', e.message) }
  }

  const onReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const target = replaceTarget.current
    e.target.value = ''
    if (!file || !orgId || !target) return
    say('ok', 'Replacing the file…')
    try {
      await uploadQuickSendFile(orgId, file, { replace_asset_id: target })
      say('ok', 'File replaced.')
      load()
    } catch (err: any) { say('error', err.message) }
  }

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>
  if (!data) return <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>

  const catName = (id: string) => data.categories.find(c => c.id === id)?.name || 'Uncategorized'
  const rows = data.resources
    .filter(r => filter === 'all' || r.category_id === filter)
    .sort((a, b) => a.name.localeCompare(b.name))
  const pill = (active: boolean) => `h-11 sm:h-8 rounded-full px-3.5 text-xs font-medium whitespace-nowrap transition-colors ${
    active ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`

  return (
    <div className="space-y-4" onClick={() => setMenu(null)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-np-dark">Quick Send Resources</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Documents you can email to a contact during or after a call. Only items marked Available to send appear in Quick Send.
          </p>
        </div>
        <button type="button" onClick={() => setUploading(true)}
          className="flex h-11 items-center gap-1.5 rounded-lg bg-np-blue px-4 text-xs font-semibold text-white hover:bg-np-blue-dark">
          <Upload size={14} /> Upload resource
        </button>
      </div>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {notice.kind === 'error' ? <AlertTriangle size={14} className="mt-px flex-shrink-0" /> : <CheckCircle2 size={14} className="mt-px flex-shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setFilter('all')} className={pill(filter === 'all')}>All</button>
        {data.categories.map(c => (
          <button key={c.id} type="button" onClick={() => setFilter(c.id)} className={pill(filter === c.id)}>{c.name}</button>
        ))}
        {data.can_admin && (addingCategory ? (
          <span className="flex items-center gap-1">
            <input autoFocus value={newCategory} onChange={e => setNewCategory(e.target.value)} maxLength={60}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setAddingCategory(false) }}
              placeholder="Category name" aria-label="New category name"
              className="h-11 sm:h-8 w-40 rounded-full border border-gray-200 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
            <button type="button" onClick={addCategory} className="h-11 sm:h-8 rounded-full bg-np-blue px-3 text-xs font-semibold text-white">Add</button>
            <button type="button" onClick={() => setAddingCategory(false)} aria-label="Cancel" className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center text-gray-400"><X size={14} /></button>
          </span>
        ) : (
          <button type="button" onClick={() => setAddingCategory(true)}
            className="flex h-11 sm:h-8 items-center gap-1 rounded-full border border-dashed border-gray-300 px-3.5 text-xs font-medium text-gray-500 hover:border-np-blue hover:text-np-blue">
            <Plus size={12} /> Category
          </button>
        ))}
      </div>

      {/* Sideways scroll inside its own box on a phone. */}
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Sends</th>
              <th className="px-3 py-2 text-center">Available to send</th>
              <th className="px-1 py-2"><span className="sr-only">More actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                {data.resources.length === 0 ? 'No resources yet. Upload one, or turn on Available in Quick Send in the Media Library.' : 'No resources in this category.'}
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.media_asset_id} className="align-middle">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-11 flex-shrink-0 rounded-md bg-fire-light py-1 text-center text-[9px] font-bold text-fire-warm">
                      {fileTypeLabel(r.name, r.mime_type)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-np-dark">{r.name}</p>
                      {r.description && <p className="truncate text-[11px] text-gray-500 max-w-[280px]">{r.description}</p>}
                      {!r.has_file && <p className="text-[11px] text-amber-700">Link only, cannot be attached</p>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{catName(r.category_id)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{r.sends ?? 0}</td>
                <td className="px-3 py-1">
                  <div className="flex justify-center">
                    <AvailableSwitch on={r.available} disabled={!r.has_file} label={`Available to send: ${r.name}`}
                      onChange={v => patchItem(r, { available: v })} />
                  </div>
                </td>
                <td className="relative px-1 py-1">
                  <button type="button" aria-label={`More actions for ${r.name}`} aria-haspopup="menu" aria-expanded={menu === r.media_asset_id}
                    onClick={e => {
                      e.stopPropagation()
                      // Fixed to the screen: the table's scroll box would clip an absolute menu.
                      const b = e.currentTarget.getBoundingClientRect()
                      setMenuAt({ top: Math.min(b.bottom + 4, window.innerHeight - 190), right: Math.max(8, window.innerWidth - b.right) })
                      setMenu(menu === r.media_asset_id ? null : r.media_asset_id)
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
                    <MoreVertical size={16} />
                  </button>
                  {menu === r.media_asset_id && (
                    <div role="menu" onClick={e => e.stopPropagation()} style={{ top: menuAt.top, right: menuAt.right }}
                      className="fixed z-[1500] w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                      {[
                        { label: 'Edit details', run: () => setEditing(r) },
                        { label: 'Replace file', run: () => { replaceTarget.current = r.media_asset_id; replaceInput.current?.click() } },
                        ...(r.url ? [{ label: 'Preview', run: () => window.open(r.url as string, '_blank', 'noopener,noreferrer') }] : []),
                        { label: 'Archive', run: () => { if (confirm(`Archive "${r.name}"? It leaves Quick Send. The file stays in the Media Library.`)) patchItem(r, { archived: true }, 'Archived.') } },
                      ].map(a => (
                        <button key={a.label} type="button" role="menuitem" onClick={() => { setMenu(null); a.run() }}
                          className={`block h-11 w-full px-4 text-left text-xs hover:bg-gray-50 ${a.label === 'Archive' ? 'text-red-600' : 'text-np-dark'}`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input ref={replaceInput} type="file" accept={QUICK_SEND_UPLOAD_ACCEPT} className="hidden" onChange={onReplace} />

      <SenderSettings orgId={orgId!} data={data} onSaved={load} />

      {uploading && (
        <UploadDialog orgId={orgId!} categories={data.categories} defaultCategory={filter !== 'all' ? filter : data.categories[0]?.id}
          onClose={() => setUploading(false)} onDone={() => { setUploading(false); say('ok', 'Uploaded. It is in the Media Library and in Quick Send.'); load() }} />
      )}
      {editing && (
        <EditDialog resource={editing} categories={data.categories} onClose={() => setEditing(null)}
          onSave={async patch => { await patchItem(editing, patch, 'Saved.'); setEditing(null) }} />
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="flex-1 text-sm font-bold text-np-dark">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const field = 'mt-1 h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const fieldLabel = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400'

function UploadDialog({ orgId, categories, defaultCategory, onClose, onDone }: {
  orgId: string; categories: QuickSendCategory[]; defaultCategory?: string; onClose: () => void; onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(defaultCategory || '')
  const [available, setAvailable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!file || !category) return
    setBusy(true); setError('')
    try {
      await uploadQuickSendFile(orgId, file, { name: name.trim() || titleFromFile(file.name), description, category_id: category, available })
      onDone()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Upload resource" onClose={() => { if (!busy) onClose() }}>
      <div className="space-y-3">
        <label className="block">
          <span className={fieldLabel}>File</span>
          <input type="file" accept={QUICK_SEND_UPLOAD_ACCEPT}
            onChange={e => { const f = e.target.files?.[0] || null; setFile(f); if (f && !name) setName(titleFromFile(f.name)) }}
            className="mt-1 block w-full text-sm file:mr-3 file:h-11 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:text-sm file:font-medium" />
          {file && <span className="mt-1 block text-[11px] text-gray-400">{fileTypeLabel(file.name, file.type)} · {formatBytes(file.size)}</span>}
        </label>
        <label className="block"><span className={fieldLabel}>Title</span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={200} className={field} /></label>
        <label className="block"><span className={fieldLabel}>One-line description</span>
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={200} className={field} /></label>
        <label className="block"><span className={fieldLabel}>Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
            {!category && <option value="">Pick a category</option>}
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-np-dark">Available to send</span>
          <AvailableSwitch on={available} onChange={setAvailable} label="Available to send" />
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-lg px-4 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !file || !category}
            className="flex h-11 items-center gap-2 rounded-lg bg-np-blue px-4 text-sm font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function EditDialog({ resource, categories, onClose, onSave }: {
  resource: Resource; categories: QuickSendCategory[]; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState(resource.name)
  const [description, setDescription] = useState(resource.description || '')
  const [category, setCategory] = useState(resource.category_id)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Edit details" onClose={onClose}>
      <div className="space-y-3">
        <label className="block"><span className={fieldLabel}>Title</span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={200} className={field} /></label>
        <label className="block"><span className={fieldLabel}>One-line description</span>
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={200} className={field} /></label>
        <label className="block"><span className={fieldLabel}>Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-11 rounded-lg px-4 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" disabled={busy || !name.trim()}
            onClick={async () => { setBusy(true); await onSave({ name: name.trim(), description, category_id: category }); setBusy(false) }}
            className="h-11 rounded-lg bg-np-blue px-4 text-sm font-semibold text-white disabled:opacity-40">Save</button>
        </div>
      </div>
    </Modal>
  )
}

function SenderSettings({ orgId, data, onSaved }: { orgId: string; data: ManageData; onSaved: () => void }) {
  const [email, setEmail] = useState(data.settings?.from_email || '')
  const [name, setName] = useState(data.settings?.from_name || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await postJson('/api/quick-send/settings', { org_id: orgId, from_email: email, from_name: name }); setMsg({ kind: 'ok', text: 'Saved.' }); onSaved() }
    catch (e: any) { setMsg({ kind: 'error', text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <h4 className="text-xs font-semibold text-np-dark">Sender</h4>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Quick Send emails come from this address, and replies go to the team member who sent them.
        The address&apos;s domain must be verified in Resend.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={fieldLabel}>From address</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!data.can_admin}
            placeholder="name@yourdomain.com" className={`${field} disabled:bg-gray-50`} /></label>
        <label className="block"><span className={fieldLabel}>From name</span>
          <input value={name} onChange={e => setName(e.target.value)} disabled={!data.can_admin} maxLength={80}
            placeholder={data.settings?.from_name || 'Organization name'} className={`${field} disabled:bg-gray-50`} /></label>
      </div>
      {data.can_admin ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          {msg && <span className={`text-[11px] ${msg.kind === 'error' ? 'text-red-600' : 'text-green-600'}`}>{msg.text}</span>}
          <button type="button" onClick={save} disabled={busy || !isValidEmail(email)}
            className="h-11 rounded-lg bg-np-blue px-4 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save sender'}</button>
        </div>
      ) : <p className="mt-2 text-[11px] text-gray-400">Only an admin can change the sender.</p>}
    </div>
  )
}
