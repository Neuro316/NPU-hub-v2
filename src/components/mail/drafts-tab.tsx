'use client'

// Mail › Drafts (Running List q10): reply drafts the Hub saved in Gmail, for the people who own the mailbox (or a
// superadmin, for a shared mailbox). Each row: the contact, the mailbox, when, the status, and Approve, Edit or
// Reject. Approve and Edit open the draft in Gmail, where you read, change and send it yourself; the Hub never sends.
// Reject deletes the draft from Gmail. The draft's text lives only in Gmail, so it is never shown here.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, ExternalLink, Loader2, Pencil, X } from 'lucide-react'

interface Draft {
  id: string; kind: string; contact: string | null; contact_id: string | null; mailbox: string; created_at: string
  status: string; reason: string | null; reviewed_at: string | null; sent_at: string | null; url: string | null; has_lesson: boolean
}

const STATUS: Record<string, { label: string; style: string }> = {
  drafted: { label: 'Ready to review', style: 'bg-np-blue/5 text-np-blue border-np-blue/10' },
  approved: { label: 'Approved, not sent yet', style: 'bg-green-50 text-green-700 border-green-100' },
  edited: { label: 'Editing in Gmail', style: 'bg-amber-50 text-amber-700 border-amber-100' },
  sent: { label: 'Sent', style: 'bg-gray-50 text-gray-500 border-gray-100' },
  rejected: { label: 'Rejected', style: 'bg-gray-50 text-gray-400 border-gray-100' },
  needs_person: { label: 'Needs a person', style: 'bg-red-50 text-red-600 border-red-100' },
}

export function DraftsTab() {
  const [mode, setMode] = useState<'on' | 'off' | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch('/api/mail/drafts', { cache: 'no-store' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(data.error || 'Drafts could not be loaded.'); setMode('off'); return }
    setMode(data.mode === 'on' ? 'on' : 'off')
    setDrafts(data.drafts ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (d: Draft, action: 'approve' | 'edit' | 'reject') => {
    // open Gmail first, inside the click, so the browser does not block the new tab
    if (action !== 'reject' && d.url) window.open(d.url, '_blank', 'noopener,noreferrer')
    setBusy(d.id)
    try {
      const res = await fetch(`/api/mail/drafts/${d.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'The draft could not be updated.'); return }
      setDrafts(prev => prev.map(x => (x.id === d.id ? { ...x, status: data.status, url: data.url ?? null } : x)))
    } finally {
      setBusy(null)
    }
  }

  const btn = 'flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40'
  return (
    <div className="space-y-3" data-help-section="mail-drafts">
      {mode === 'off' && (
        <div className="px-3 py-2 rounded-lg text-xs bg-gray-50 text-gray-500">
          Drafting is off. When it is turned on, replies to participant support emails are saved as Gmail drafts here for you to review. Nothing is ever sent by the Hub.
        </div>
      )}
      {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600"><AlertTriangle size={12} /> {error}</div>}
      <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
        {mode === null && <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 p-4"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
        {mode !== null && drafts.length === 0 && <p className="text-xs text-gray-400 p-6 text-center">No drafts for your mailboxes.</p>}
        {drafts.map(d => {
          const s = STATUS[d.status] ?? { label: d.status, style: 'bg-gray-50 text-gray-500 border-gray-100' }
          const open = ['drafted', 'approved', 'edited'].includes(d.status)
          return (
            <div key={d.id} className={`px-4 py-3 flex items-start gap-3 ${['sent', 'rejected'].includes(d.status) ? 'opacity-60' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {d.contact_id
                    ? <Link href={`/crm/contacts?id=${d.contact_id}`} className="text-xs font-semibold text-np-dark hover:underline truncate">{d.contact || 'Contact'}</Link>
                    : <p className="text-xs font-semibold text-np-dark">Not a contact yet</p>}
                  <span className="text-[10px] text-gray-300">·</span>
                  <p className="text-[10px] text-gray-400">{new Date(d.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${s.style}`}>{s.label}</span>
                  <span className="text-[10px] text-gray-400">{d.mailbox}</span>
                  {d.kind !== 'support' && <span className="text-[10px] text-gray-400">· {d.kind}</span>}
                  {d.has_lesson && <span className="text-[10px] text-gray-400">· lesson learned</span>}
                </div>
                {d.reason && <p className="text-[11px] text-red-600 mt-1">{d.reason}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {open && d.url && <>
                  <button onClick={() => act(d, 'approve')} disabled={busy === d.id} className={btn} title="Open in Gmail and mark approved"><Check size={10} /> Approve</button>
                  <button onClick={() => act(d, 'edit')} disabled={busy === d.id} className={btn} title="Open in Gmail to edit"><Pencil size={10} /> Edit</button>
                </>}
                {(open || d.status === 'needs_person') && (
                  <button onClick={() => act(d, 'reject')} disabled={busy === d.id} className={btn} title={d.status === 'needs_person' ? 'Dismiss' : 'Reject and delete the Gmail draft'}>
                    <X size={10} /> {d.status === 'needs_person' ? 'Dismiss' : 'Reject'}
                  </button>
                )}
                {!open && d.status !== 'needs_person' && d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className={btn}><ExternalLink size={10} /> Gmail</a>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
