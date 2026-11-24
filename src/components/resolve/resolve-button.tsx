'use client'

// "No reply needed" (Resolve): ONE button for every place the Hub says a person is waiting on us. It opens a small
// popover with the five reason chips, an optional one-line note and Resolve, and posts to POST /api/resolve with the
// scope of the place it is mounted in. Everything is keyed on the contact, never the login, so Cameron and Shane see
// the same state: once resolved it shows "Resolved by <name>, <reason>, <time>" and a Reopen link instead.
//   text_waiting   the Conversations thread header        touchpoint     a Follow-ups to review board card
//   all            the contact card's Waiting on us line   speed_to_lead  the speed to lead records, a lead_no_touch_24h task
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { REASONS, REASON_TEXT, type Reason, type Scope } from '@/lib/resolve/check'

interface Live { id: string; scope: Scope; reason: Reason; reason_text: string; note: string | null; by: string; resolved_at: string }
const NOTE_MAX = 200
const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ResolveButton({ contactId, scope, autoOpen = false, onChange, className = '' }: {
  contactId: string | null | undefined
  scope: Scope
  /** open the popover on arrival (the #np-follow-ups link carries resolve=1) */
  autoOpen?: boolean
  /** after a resolve or a reopen, so the parent can hide or refresh its waiting line */
  onChange?: (resolved: boolean) => void
  className?: string
}) {
  const [live, setLive] = useState<Live | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auto = useRef(false)
  // the callback is read through a ref, so a parent's inline function does not reload the state on every render
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const load = useCallback(async () => {
    if (!contactId) return
    const res = await fetch(`/api/resolve?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store' }).catch(() => null)
    const d = res?.ok ? await res.json().catch(() => ({})) : {}
    const rows: Live[] = Array.isArray(d.resolutions) ? d.resolutions : []
    // a row of this scope, or one for everything, keeps this place quiet
    const hit = rows.find(r => r.scope === scope) ?? rows.find(r => r.scope === 'all') ?? null
    setLive(hit)
    setLoaded(true)
    changeRef.current?.(!!hit)
  }, [contactId, scope])
  useEffect(() => { setLive(null); setLoaded(false); load() }, [load])
  useEffect(() => { if (autoOpen && loaded && !live && !auto.current) { auto.current = true; setOpen(true) } }, [autoOpen, loaded, live])

  if (!contactId) return null
  const problem = note.length > NOTE_MAX ? `Keep it under ${NOTE_MAX + 1} characters.` : /[\r\n]/.test(note) ? 'One line only.' : null

  const resolve = async () => {
    if (!reason) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, scope, reason, note: note.trim() || null }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'It could not be saved.'); return }
      setOpen(false); setReason(null); setNote('')
      await load()
    } finally {
      setBusy(false)
    }
  }
  const reopen = async () => {
    if (!live) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/resolve', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: live.id, action: 'reopen' }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'It could not be reopened.'); return }
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null
  if (live) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[10px] text-green-700 ${className}`} data-help-section="resolve">
        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
        <span>Resolved by {live.by}, {live.reason_text.toLowerCase()}, {when(live.resolved_at)}{live.note ? ` (${live.note})` : ''}</span>
        <button onClick={reopen} disabled={busy} className="text-np-blue hover:underline disabled:opacity-40">Reopen</button>
        {error && <span className="text-red-600">{error}</span>}
      </span>
    )
  }
  return (
    <span className={`relative inline-block ${className}`} data-help-section="resolve">
      <button onClick={() => setOpen(o => !o)} className="px-2 py-1 text-[10px] font-medium border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50">
        No reply needed
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg space-y-2" role="dialog" aria-label="No reply needed">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Why no reply is needed</p>
          <div className="flex flex-wrap gap-1">
            {REASONS.map(r => (
              <button key={r} onClick={() => setReason(x => (x === r ? null : r))}
                className={`px-2 py-1 rounded-lg border text-[10px] font-medium ${reason === r ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}>
                {REASON_TEXT[r]}
              </button>
            ))}
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={NOTE_MAX + 20} placeholder="Optional note, one line"
            className="w-full rounded-lg border border-gray-100 px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
          {problem && <p className="text-[10px] text-red-600">{problem}</p>}
          {error && <p className="text-[10px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button onClick={resolve} disabled={busy || !reason || !!problem}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-np-blue text-white disabled:opacity-50">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Resolve
            </button>
            <button onClick={() => setOpen(false)} className="px-2.5 py-1.5 text-[11px] border border-gray-100 rounded-lg">Cancel</button>
          </div>
          <p className="text-[9px] text-gray-400">Shared by the whole team. It holds until they send something new.</p>
        </div>
      )}
    </span>
  )
}
