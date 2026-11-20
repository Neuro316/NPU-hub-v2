'use client'

// The Inbox's Learning tab (feat/drafts-inbox-review): a 30-day scorecard per mailbox you may see, the lesson lines
// the drafts learned (Pin: always used when drafting; Retire: never used again), and the priority corrections.
// A private mailbox's lessons show only to its owner.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Archive, Loader2, Pin, PinOff, RotateCcw } from 'lucide-react'
import { PRIORITY_STYLE } from './priority-pill'

interface Learning {
  mailboxes: Array<{ id: string; email_address: string; drafted: number; approved: number; edited: number; rejected: number; needs_person: number }>
  lessons: Array<{ id: string; mailbox: string; lesson: string; status: string; at: string | null; is_pinned: boolean; retired: boolean }>
  corrections: Array<{ id: string; mailbox: string; from_address: string | null; subject: string | null; from_priority: string | null; to_priority: string; reason: string | null; by: 'you' | 'teammate'; at: string }>
  pin_ready: boolean
}

const label = (s: string) => s.replace(/_/g, ' ')

export function LearningTab() {
  const [data, setData] = useState<Learning | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch('/api/mail/drafts?view=learning', { cache: 'no-store' }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(body.error || 'Learning could not be loaded.'); return }
    setData(body)
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (id: string, action: 'pin' | 'unpin' | 'retire' | 'restore') => {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/mail/drafts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || 'The lesson could not be updated.'); return }
      setData(d => d && ({ ...d, lessons: d.lessons.map(l => l.id !== id ? l : {
        ...l, is_pinned: action === 'pin' ? true : action === 'unpin' || action === 'retire' ? false : l.is_pinned,
        retired: action === 'retire' ? true : action === 'restore' ? false : l.retired,
      }) }))
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return error
      ? <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600"><AlertTriangle size={12} /> {error}</div>
      : <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 p-6"><Loader2 size={12} className="animate-spin" /> Loading...</p>
  }

  const btn = 'flex items-center gap-1 px-2 py-1 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40'
  const heading = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400'
  const stats: Array<[keyof Learning['mailboxes'][number], string]> = [['drafted', 'Drafted'], ['approved', 'Approved as written'], ['edited', 'Edited'], ['rejected', 'Rejected'], ['needs_person', 'Needs a person']]

  return (
    <div className="space-y-4" data-help-section="mail-drafts">
      {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600"><AlertTriangle size={12} /> {error}</div>}

      <div className="space-y-2">
        <p className={heading}>Last 30 days</p>
        {data.mailboxes.length === 0 && <p className="text-xs text-gray-400">No mailboxes you can see.</p>}
        {data.mailboxes.map(b => (
          <div key={b.id} className="rounded-xl border border-gray-100 bg-white p-4">
            <p className="text-xs font-semibold text-np-dark mb-2">{b.email_address}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {stats.map(([k, l]) => (
                <div key={k} className="rounded-lg bg-np-light px-3 py-2">
                  <p className="text-lg font-bold text-np-dark leading-tight">{b[k] as number}</p>
                  <p className="text-[10px] text-gray-500">{l}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className={heading}>Lessons, newest first</p>
        {!data.pin_ready && <p className="text-[11px] text-gray-400">Pin and Retire switch on once the hub_247 migration is applied.</p>}
        <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
          {data.lessons.length === 0 && <p className="text-xs text-gray-400 p-6 text-center">No lessons yet. One is written after each draft you send, edit or reject.</p>}
          {data.lessons.map(l => (
            <div key={l.id} className={`px-4 py-3 flex items-start gap-3 ${l.retired ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-np-dark">{l.lesson}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {l.mailbox}{l.at ? ` · ${new Date(l.at).toLocaleDateString()}` : ''} · {l.status}
                  {l.is_pinned && <span className="text-np-blue"> · pinned, always used</span>}
                  {l.retired && <span> · retired, never used</span>}
                </p>
              </div>
              {data.pin_ready && (
                <div className="flex gap-1 flex-shrink-0">
                  {!l.retired && (l.is_pinned
                    ? <button onClick={() => act(l.id, 'unpin')} disabled={busy === l.id} className={btn}><PinOff size={10} /> Unpin</button>
                    : <button onClick={() => act(l.id, 'pin')} disabled={busy === l.id} className={btn}><Pin size={10} /> Pin</button>)}
                  {l.retired
                    ? <button onClick={() => act(l.id, 'restore')} disabled={busy === l.id} className={btn}><RotateCcw size={10} /> Restore</button>
                    : <button onClick={() => act(l.id, 'retire')} disabled={busy === l.id} className={btn}><Archive size={10} /> Retire</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className={heading}>Priority corrections</p>
        <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
          {data.corrections.length === 0 && <p className="text-xs text-gray-400 p-6 text-center">No corrections yet. Click a priority pill in the Inbox to change one.</p>}
          {data.corrections.map(c => (
            <div key={c.id} className="px-4 py-3">
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {c.from_priority && <span className={`px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[c.from_priority] ?? ''}`}>{c.from_priority}</span>}
                <span className="text-gray-300">to</span>
                <span className={`px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[c.to_priority] ?? ''}`}>{c.to_priority}</span>
                {c.reason && <span className="text-gray-500">· {label(c.reason)}</span>}
                <span className="text-gray-400">· set by {c.by === 'you' ? 'you' : 'a teammate'} · {new Date(c.at).toLocaleString()}</span>
              </div>
              <p className="text-xs text-np-dark mt-1 truncate">{c.subject || '(no subject)'}</p>
              <p className="text-[10px] text-gray-400">{c.from_address ?? 'Unknown sender'} · {c.mailbox}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
