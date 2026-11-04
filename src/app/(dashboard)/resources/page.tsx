'use client'

// Resource Library (superadmin only, Build 2): files sent to contacts from the contact
// card's "Send resources" panel. Upload, rename, describe, reorder, archive. Files sit in
// a private bucket; the browser uploads with a one-time signed URL from the server, and
// the server records the size and type from storage.
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Upload, ArrowUp, ArrowDown, Archive, RotateCcw, Save, CheckCircle2, AlertTriangle, Loader2, FileText, Image as ImageIcon } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

interface Resource {
  id: string
  name: string
  description: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  is_default_followup: boolean
  sort_order: number
  archived_at: string | null
}

const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.gif,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/gif,image/webp'
const MAX_BYTES = 50 * 1024 * 1024
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const kind = (mime: string) => (mime === 'application/pdf' ? 'PDF' : mime.startsWith('image/') ? mime.slice(6).toUpperCase() : 'DOCX')

export default function ResourcesPage() {
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [items, setItems] = useState<Resource[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; description: string }>>({})
  // upload form
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    const res = await fetch(`/api/resources?org_id=${encodeURIComponent(orgId)}${showArchived ? '&archived=1' : ''}`, { cache: 'no-store' })
    if (res.status === 403) { setAllowed(false); return }
    const data = await res.json().catch(() => ({}))
    setAllowed(true)
    if (res.ok) { setItems(data.resources); setEdits({}) } else setNotice({ ok: false, text: data.error || 'Resources could not be loaded.' })
  }, [orgId, showArchived])

  useEffect(() => { load() }, [load])

  const call = async (method: string, body: Record<string, unknown>, ok: string) => {
    setNotice(null)
    const res = await fetch('/api/resources', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, ...body }) })
    const data = await res.json().catch(() => ({}))
    setNotice(res.ok ? { ok: true, text: ok } : { ok: false, text: data.error || 'That did not save.' })
    return res.ok
  }

  const upload = async () => {
    if (!file || !orgId) return
    if (file.size > MAX_BYTES) { setNotice({ ok: false, text: 'Files can be at most 50 MB.' }); return }
    setBusy('upload'); setNotice(null)
    try {
      const start = await fetch('/api/resources/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, file_name: file.name, mime_type: file.type, size_bytes: file.size }),
      })
      const s = await start.json().catch(() => ({}))
      if (!start.ok) { setNotice({ ok: false, text: s.error || 'The upload could not be started.' }); return }
      const { error } = await createClient().storage.from('hub-resources').uploadToSignedUrl(s.path, s.token, file, { contentType: file.type })
      if (error) { setNotice({ ok: false, text: 'The upload failed. Try again.' }); return }
      const done = await call('POST', { storage_path: s.path, name: name.trim() || file.name.replace(/\.[^.]+$/, ''), description, is_default_followup: isDefault }, `${file.name} added.`)
      if (done) { setFile(null); setName(''); setDescription(''); setIsDefault(false) }
    } finally { setBusy(null); load() }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const active = items.filter(r => !r.archived_at)
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

  const active = items.filter(r => !r.archived_at)
  const archived = items.filter(r => r.archived_at)

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-np-dark flex items-center gap-2"><FolderOpen size={18} /> Resources</h1>
        <p className="text-xs text-gray-400 mt-1">
          Files you can email to a contact from their card with Send resources. Files marked as a discovery follow-up default are pre-checked there.
        </p>
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

      {allowed === null ? (
        <p className="text-xs text-gray-400">Loading resources...</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-gray-400">No resources yet. Add the first file above.</p>
      ) : (
        <div className="space-y-2">
          {active.map((r, i) => {
            const e = edits[r.id] ?? { name: r.name, description: r.description ?? '' }
            const dirty = e.name !== r.name || e.description !== (r.description ?? '')
            return (
              <div key={r.id} className="p-3 rounded-xl border border-gray-100 bg-white flex gap-3 items-start">
                <div className="flex flex-col gap-1 pt-1">
                  <button onClick={() => move(i, -1)} disabled={i === 0 || !!busy} title="Move up" className="text-gray-400 hover:text-np-dark disabled:opacity-20"><ArrowUp size={12} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === active.length - 1 || !!busy} title="Move down" className="text-gray-400 hover:text-np-dark disabled:opacity-20"><ArrowDown size={12} /></button>
                </div>
                <div className="pt-1 text-np-blue">{r.mime_type.startsWith('image/') ? <ImageIcon size={16} /> : <FileText size={16} />}</div>
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
                </div>
                <div className="flex flex-col gap-1.5">
                  {dirty && (
                    <button onClick={() => patch(r, { name: e.name, description: e.description }, 'Saved.')} disabled={busy === r.id || !e.name.trim()}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40">
                      <Save size={10} /> Save
                    </button>
                  )}
                  <button onClick={() => patch(r, { archived: true }, `${r.name} archived. Links already sent keep working until they expire.`)} disabled={busy === r.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                    <Archive size={10} /> Archive
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div>
        <button onClick={() => setShowArchived(v => !v)} className="text-[11px] text-gray-400 hover:text-np-dark">
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
        {showArchived && (
          <div className="mt-2 space-y-1.5">
            {archived.length === 0 ? <p className="text-[11px] text-gray-400">Nothing archived.</p> : archived.map(r => (
              <div key={r.id} className="px-3 py-2 rounded-lg border border-gray-100 flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex-1 truncate">{r.name} <span className="text-gray-300">· {r.file_name}</span></span>
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
