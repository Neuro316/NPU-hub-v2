'use client'

// Resource Library (superadmin only, Build 2): files sent to contacts from the contact
// card's "Send resources" panel. Upload, replace, rename, describe, reorder, archive. Files
// sit in a private bucket; the browser uploads with a one-time signed URL from the server,
// and the server records the size and type from storage.
//
// Thumbnails (docs/plans/hub-resource-thumbnails.md): each row shows its file's thumbnail
// (PDF first page or image) or a file-type tile; clicking it opens the file. After an
// upload or Replace file the row shows "Generating preview" while the server renders it; a
// failure leaves the tile and never blocks the upload. Files without a thumbnail yet are
// rendered once in the background when the page loads (the backfill).
//
// Links (Running List q33, hub_240): the same library also holds links (booking, checkout, quiz, program page,
// video, artifact), each with an owner and "where used". Search by title and filter by type across files and
// links. Retire (archive) never deletes. A resource is shared to a contact from the contact card's "Share a
// resource" as a tracked link.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Upload, ArrowUp, ArrowDown, Archive, RotateCcw, Save, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { ResourceThumb } from '@/components/crm/resource-thumb'
import { thumbKind } from '@/lib/resources/thumbs'
import { RESOURCE_KINDS, KIND_LABEL, type ResourceKind } from '@/lib/resources/common'
import { LinkResources, OwnerSelect, StepsUsing, type LinkResource, type StaffOption } from '@/components/resources/link-resources'

interface Resource {
  id: string
  name: string
  description: string | null
  kind: ResourceKind
  url: string | null
  owner_id: string | null
  where_used: string | null
  used_in_steps: LinkResource['used_in_steps']
  file_name: string
  mime_type: string
  size_bytes: number
  is_default_followup: boolean
  sort_order: number
  archived_at: string | null
  thumb_url: string | null
}

const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.gif,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/gif,image/webp'
const MAX_BYTES = 50 * 1024 * 1024
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const kind = (mime: string) => (mime === 'application/pdf' ? 'PDF' : mime.startsWith('image/') ? mime.slice(6).toUpperCase() : 'DOCX')

/** Uploads one file straight to storage with a signed URL; the new object's path, or an error. */
async function uploadFile(orgId: string, file: File): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_BYTES) return { error: 'Files can be at most 50 MB.' }
  const start = await fetch('/api/resources/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id: orgId, file_name: file.name, mime_type: file.type, size_bytes: file.size }),
  })
  const s = await start.json().catch(() => ({}))
  if (!start.ok) return { error: s.error || 'The upload could not be started.' }
  const { error } = await createClient().storage.from('hub-resources').uploadToSignedUrl(s.path, s.token, file, { contentType: file.type })
  return error ? { error: 'The upload failed. Try again.' } : { path: s.path }
}

export default function ResourcesPage() {
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [items, setItems] = useState<Resource[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'' | ResourceKind>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; description: string }>>({})
  // upload form
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  // rows whose thumbnail is being rendered right now
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const backfilled = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    const res = await fetch(`/api/resources?org_id=${encodeURIComponent(orgId)}${showArchived ? '&archived=1' : ''}`, { cache: 'no-store' })
    if (res.status === 403) { setAllowed(false); return }
    const data = await res.json().catch(() => ({}))
    setAllowed(true)
    if (res.ok) { setItems(data.resources); setStaff(data.staff ?? []); setEdits({}) } else setNotice({ ok: false, text: data.error || 'Resources could not be loaded.' })
  }, [orgId, showArchived])

  useEffect(() => { load() }, [load])

  /** Renders one resource's thumbnail, showing "Generating preview" meanwhile. A failure
   *  only leaves the file-type tile. */
  const makeThumb = useCallback(async (id: string) => {
    if (!orgId) return
    setGenerating(prev => new Set(prev).add(id))
    try {
      const res = await fetch('/api/resources/thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, id }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) setItems(prev => prev.map(r => (r.id === id ? { ...r, thumb_url: d.thumb_url ?? null } : r)))
    } catch { /* the tile stays */ } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [orgId])

  // Backfill: once per org per visit, render the thumbnails files are still missing.
  useEffect(() => {
    if (!orgId || allowed !== true || backfilled.current === orgId) return
    const missing = items.filter(r => !r.url && !r.thumb_url && thumbKind(r.mime_type) !== 'tile')
    if (!missing.length) return
    backfilled.current = orgId
    setGenerating(new Set(missing.map(r => r.id)))
    fetch('/api/resources/thumbnail', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, missing: true }),
    }).catch(() => null).finally(() => { setGenerating(new Set()); load() })
  }, [orgId, allowed, items, load])

  const preview = async (r: Resource) => {
    // open the tab inside the click, so a pop-up blocker allows it; point it at the file after
    const tab = window.open('', '_blank')
    const res = await fetch(`/api/resources/preview?org_id=${encodeURIComponent(orgId ?? '')}&id=${r.id}`, { cache: 'no-store' })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.url) { if (tab) tab.location.href = d.url; else window.open(d.url, '_blank') }
    else { tab?.close(); setNotice({ ok: false, text: d.error || 'The file could not be opened.' }) }
  }

  const replace = async (r: Resource, f: File | undefined) => {
    if (!f || !orgId) return
    setBusy(r.id); setNotice(null)
    try {
      const up = await uploadFile(orgId, f)
      if ('error' in up) { setNotice({ ok: false, text: up.error }); return }
      const ok = await call('PATCH', { id: r.id, replace_path: up.path }, `${r.name} now uses ${f.name}. Links already sent keep the old file until they expire.`)
      if (ok) { await load(); makeThumb(r.id) }
    } finally { setBusy(null) }
  }

  const call = async (method: string, body: Record<string, unknown>, ok: string) => {
    setNotice(null)
    const res = await fetch('/api/resources', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, ...body }) })
    const data = await res.json().catch(() => ({}))
    setNotice(res.ok ? { ok: true, text: ok } : { ok: false, text: data.error || 'That did not save.' })
    return res.ok
  }

  const upload = async () => {
    if (!file || !orgId) return
    setBusy('upload'); setNotice(null)
    let newId: string | null = null
    try {
      const up = await uploadFile(orgId, file)
      if ('error' in up) { setNotice({ ok: false, text: up.error }); return }
      const res = await fetch('/api/resources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, storage_path: up.path, name: name.trim() || file.name.replace(/\.[^.]+$/, ''), description, is_default_followup: isDefault }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ ok: false, text: d.error || 'That did not save.' }); return }
      setNotice({ ok: true, text: `${file.name} added.` })
      newId = d.resource?.id ?? null
      setFile(null); setName(''); setDescription(''); setIsDefault(false)
    } finally {
      setBusy(null)
      await load()
      // the thumbnail renders after the upload is saved; it never holds the upload up
      if (newId && thumbKind(file.type) !== 'tile') makeThumb(newId)
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const active = items.filter(r => !r.archived_at && !r.url)
    const j = index + dir
    if (j < 0 || j >= active.length) return
    const order = active.map(r => r.id)
    ;[order[index], order[j]] = [order[j], order[index]]
    setBusy('order')
    try { await call('PUT', { order }, 'Order saved.') } finally { setBusy(null); load() }
  }

  const patch = async (r: Resource, body: Record<string, unknown>, ok: string) => {
    setBusy(r.id)
    try { await call('PATCH', { id: r.id, ...body }, ok) } finally { setBusy(null); load() }
  }

  if (allowed === false) {
    return <div className="p-6 text-sm text-gray-500">The Resource Library is for superadmins.</div>
  }

  const q = query.trim().toLowerCase()
  const filtering = !!q || !!kindFilter
  const matches = (r: Resource) => (!q || r.name.toLowerCase().includes(q) || KIND_LABEL[r.kind]?.toLowerCase().includes(q)) && (!kindFilter || r.kind === kindFilter)
  const activeFiles = items.filter(r => !r.archived_at && !r.url)
  const active = activeFiles.filter(matches)
  const activeLinks = items.filter(r => !r.archived_at && r.url).filter(matches) as unknown as LinkResource[]
  const archived = items.filter(r => r.archived_at).filter(matches)

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-np-dark flex items-center gap-2"><FolderOpen size={18} /> Resources</h1>
        <p className="text-xs text-gray-400 mt-1">
          Every file and link we send people. Files can be emailed from a contact&apos;s card with Send resources (discovery follow-up defaults are pre-checked there). Any resource can be shared from the card as a tracked link with Share a resource.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 flex-1 min-w-[180px] px-2 py-1.5 border border-gray-100 rounded-lg bg-white">
          <Search size={12} className="text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title or type" className="flex-1 min-w-0 text-xs outline-none" />
        </label>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value as '' | ResourceKind)} className="px-2 py-1.5 text-xs border border-gray-100 rounded-lg bg-white">
          <option value="">All types</option>
          {RESOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}

      <div className="p-4 rounded-xl border border-gray-100 bg-white space-y-3">
        <h3 className="text-xs font-bold text-np-dark">Add a file</h3>
        <input type="file" accept={ACCEPT} disabled={busy === 'upload'}
          onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '')) }}
          className="block text-xs" />
        <p className="text-[10px] text-gray-400">PDF, DOCX, JPEG, PNG, GIF or WebP, up to 50 MB.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" maxLength={200}
            className="px-3 py-2 text-xs border border-gray-100 rounded-lg" />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" maxLength={2000}
            className="px-3 py-2 text-xs border border-gray-100 rounded-lg" />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded border-gray-300" />
            Default for discovery follow-up
          </label>
          <div className="flex-1" />
          <button onClick={upload} disabled={!file || busy === 'upload'}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark disabled:opacity-40">
            {busy === 'upload' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
          </button>
        </div>
      </div>

      <h2 className="text-xs font-bold text-np-dark pt-1">Files</h2>
      {allowed === null ? (
        <p className="text-xs text-gray-400">Loading resources...</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-gray-400">{filtering ? 'No files match.' : 'No files yet. Add the first file above.'}</p>
      ) : (
        <div className="space-y-2">
          {active.map((r, i) => {
            const e = edits[r.id] ?? { name: r.name, description: r.description ?? '' }
            const dirty = e.name !== r.name || e.description !== (r.description ?? '')
            return (
              <div key={r.id} className="p-3 rounded-xl border border-gray-100 bg-white flex gap-3 items-start">
                <div className="flex flex-col gap-1 pt-1">
                  <button onClick={() => move(i, -1)} disabled={filtering || i === 0 || !!busy} title={filtering ? 'Clear the search to reorder' : 'Move up'} className="text-gray-400 hover:text-np-dark disabled:opacity-20"><ArrowUp size={12} /></button>
                  <button onClick={() => move(i, 1)} disabled={filtering || i === active.length - 1 || !!busy} title={filtering ? 'Clear the search to reorder' : 'Move down'} className="text-gray-400 hover:text-np-dark disabled:opacity-20"><ArrowDown size={12} /></button>
                </div>
                <ResourceThumb url={r.thumb_url} mime={r.mime_type} fileName={r.file_name} name={r.name}
                  generating={generating.has(r.id)} onClick={() => preview(r)} />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <input value={e.name} maxLength={200} onChange={ev => setEdits(p => ({ ...p, [r.id]: { ...e, name: ev.target.value } }))}
                    className="w-full px-2 py-1 text-xs font-semibold text-np-dark border border-transparent hover:border-gray-100 focus:border-gray-200 rounded" />
                  <input value={e.description} maxLength={2000} placeholder="Description" onChange={ev => setEdits(p => ({ ...p, [r.id]: { ...e, description: ev.target.value } }))}
                    className="w-full px-2 py-1 text-[11px] text-gray-600 border border-transparent hover:border-gray-100 focus:border-gray-200 rounded" />
                  <div className="flex items-center gap-3 px-2 text-[10px] text-gray-400 flex-wrap">
                    <span className="truncate max-w-[240px]">{r.file_name}</span>
                    <span>{kind(r.mime_type)} · {fmtSize(r.size_bytes)}</span>
                    <label className="flex items-center gap-1 text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={r.is_default_followup} disabled={busy === r.id}
                        onChange={ev => patch(r, { is_default_followup: ev.target.checked }, ev.target.checked ? `${r.name} is now pre-checked.` : `${r.name} is no longer pre-checked.`)}
                        className="rounded border-gray-300" />
                      Default for discovery follow-up
                    </label>
                  </div>
                  <div className="px-2"><StepsUsing steps={r.used_in_steps ?? []} /></div>
                  <div className="flex flex-wrap items-center gap-2 px-2">
                    <select value={r.kind} disabled={busy === r.id} onChange={ev => patch(r, { kind: ev.target.value }, 'Type saved.')} className="px-2 py-1 text-[10px] border border-gray-100 rounded-lg bg-white">
                      {RESOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                    <OwnerSelect value={r.owner_id} staff={staff} disabled={busy === r.id} onChange={v => patch(r, { owner_id: v }, 'Owner saved.')} />
                    <input defaultValue={r.where_used ?? ''} key={`${r.id}:${r.where_used ?? ''}`} maxLength={2000} placeholder="Where used"
                      onBlur={ev => { if (ev.target.value !== (r.where_used ?? '')) patch(r, { where_used: ev.target.value }, 'Saved.') }}
                      className="flex-1 min-w-[140px] px-2 py-1 text-[10px] border border-gray-100 rounded-lg" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {dirty && (
                    <button onClick={() => patch(r, { name: e.name, description: e.description }, 'Saved.')} disabled={busy === r.id || !e.name.trim()}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40">
                      <Save size={10} /> Save
                    </button>
                  )}
                  <label className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer whitespace-nowrap ${busy === r.id ? 'opacity-40 pointer-events-none' : ''}`}>
                    {busy === r.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Replace file
                    <input type="file" accept={ACCEPT} className="hidden" disabled={busy === r.id}
                      onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; replace(r, f) }} />
                  </label>
                  <button onClick={() => patch(r, { archived: true }, `${r.name} retired. Emailed download links keep working until they expire; its tracked links stop.`)} disabled={busy === r.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                    <Archive size={10} /> Retire
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <h2 className="text-xs font-bold text-np-dark pt-1">Links</h2>
      {allowed === true && <LinkResources items={activeLinks} staff={staff} busy={busy} call={call} reload={load} />}

      <div>
        <button onClick={() => setShowArchived(v => !v)} className="text-[11px] text-gray-400 hover:text-np-dark">
          {showArchived ? 'Hide retired' : 'Show retired'}
        </button>
        {showArchived && (
          <div className="mt-2 space-y-1.5">
            {archived.length === 0 ? <p className="text-[11px] text-gray-400">Nothing retired.</p> : archived.map(r => (
              <div key={r.id} className="px-3 py-2 rounded-lg border border-gray-100 flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex-1 truncate">{r.name} <span className="text-gray-300">· {r.url ?? r.file_name}</span></span>
                <button onClick={() => patch(r, { archived: false }, `${r.name} restored.`)} disabled={busy === r.id}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-100 rounded-lg hover:bg-gray-50">
                  <RotateCcw size={10} /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
