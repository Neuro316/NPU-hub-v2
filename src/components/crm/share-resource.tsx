'use client'

// Share a resource (Running List q33): pick a library resource, press Make link, and copy the tracked link
// <hub>/r/<code> into your own email or text. The Hub sends nothing. Earlier links for this contact are listed
// with their first and latest click. Shown only to those the Resource Library allows (the API answers 403 to
// everyone else, and the panel then hides).
import { useCallback, useEffect, useState } from 'react'
import { Link2, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { KIND_LABEL, type ResourceKind } from '@/lib/resources/common'

interface Option { id: string; name: string; kind: ResourceKind; is_link: boolean }
interface MadeLink { id: string; url: string; resource_name: string; created_at: string; first_clicked_at: string | null; last_clicked_at: string | null; click_count: number; revoked_at: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* select it by hand */ } }}
      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5 flex-shrink-0">
      {done ? <Check size={10} /> : <Copy size={10} />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export function ShareResource({ contactId }: { contactId: string }) {
  const [data, setData] = useState<{ resources: Option[]; links: MadeLink[] } | null>(null)
  const [pick, setPick] = useState('')
  const [made, setMade] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/resources/links?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store' })
    if (!res.ok) { setData(null); return }
    setData(await res.json().catch(() => null))
  }, [contactId])

  useEffect(() => { setMade(null); setError(''); setPick(''); load() }, [load])

  if (!data) return null

  const make = async () => {
    if (!pick) return
    setBusy(true); setError(''); setMade(null)
    try {
      const res = await fetch('/api/resources/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId, resource_id: pick }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'The link could not be made.'); return }
      setMade(d.url); load()
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2" data-help-section="share-resource">
      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
        <Link2 className="w-3 h-3" /> Share a resource
      </h4>
      {data.resources.length === 0 ? (
        <p className="text-[11px] text-gray-400">The library has no active resources yet.</p>
      ) : (
        <div className="flex items-center gap-2">
          <select value={pick} onChange={e => { setPick(e.target.value); setMade(null) }}
            className="flex-1 min-w-0 px-2 py-1.5 text-[11px] text-np-dark border border-gray-100 rounded-lg bg-white">
            <option value="">Choose a resource</option>
            {data.resources.map(r => <option key={r.id} value={r.id}>{r.name} ({KIND_LABEL[r.kind] ?? 'Other'})</option>)}
          </select>
          <button onClick={make} disabled={!pick || busy}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40 flex-shrink-0">
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Link2 size={10} />} Make link
          </button>
        </div>
      )}
      {error && <p className="flex items-center gap-1 text-[10px] text-red-600"><AlertTriangle size={11} /> {error}</p>}
      {made && (
        <div className="p-2 rounded-lg bg-green-50 space-y-1">
          <div className="flex items-center gap-2">
            <input readOnly value={made} onFocus={e => e.target.select()} className="flex-1 min-w-0 px-2 py-1 text-[11px] text-np-dark bg-white border border-green-100 rounded" />
            <CopyButton text={made} />
          </div>
          <p className="text-[10px] text-green-700">Paste it into your own email or text. The Hub has sent nothing.</p>
        </div>
      )}
      {data.links.length > 0 && (
        <div className="space-y-1">
          {data.links.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-[10px] text-gray-500">
              <span className="flex-1 min-w-0 truncate">
                <span className="text-np-dark">{l.resource_name}</span>, made {when(l.created_at)}
                {l.first_clicked_at
                  ? <> · opened {l.click_count === 1 ? 'once' : `${l.click_count} times`}: first {when(l.first_clicked_at)}{l.click_count > 1 ? `, latest ${when(l.last_clicked_at)}` : ''}</>
                  : ' · not opened yet'}
              </span>
              <CopyButton text={l.url} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
