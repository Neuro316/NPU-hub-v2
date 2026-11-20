'use client'

// The Inbox priority pill: click to set Urgent, Normal or Low with a reason. Saved corrections are recorded in
// hub_priority_feedback (ids and codes only) and triage follows them for the same sender and category.
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export type Priority = 'urgent' | 'normal' | 'low'
export const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-50 text-red-600 border-red-100',
  normal: 'bg-np-blue/5 text-np-blue border-np-blue/10',
  low: 'bg-gray-50 text-gray-500 border-gray-100',
}
const LEVELS: Array<{ key: Priority; label: string }> = [{ key: 'urgent', label: 'Urgent' }, { key: 'normal', label: 'Normal' }, { key: 'low', label: 'Low' }]
const REASONS: Array<{ key: string; label: string }> = [
  { key: 'deadline', label: 'Deadline' }, { key: 'client', label: 'Client' }, { key: 'lead', label: 'Lead' },
  { key: 'partner', label: 'Partner' }, { key: 'not_important', label: 'Not important' },
]

export function PriorityPill({ messageId, priority, setBy, onSaved }: {
  messageId: string
  priority: Priority | null
  setBy: 'you' | 'teammate' | null
  onSaved: (p: Priority, setBy: 'you') => void
}) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<Priority>(priority ?? 'normal')
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/mail/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: messageId, priority: pick, reason }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'The priority could not be saved.'); return }
      onSaved(pick, 'you')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const chip = (on: boolean) => `px-2 py-1 rounded-lg border text-[10px] font-medium ${on ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`
  return (
    <div ref={ref} className="relative inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => { setPick(priority ?? 'normal'); setReason(null); setError(null); setOpen(o => !o) }}
        className={`px-1.5 py-0.5 rounded border text-[10px] hover:ring-1 hover:ring-np-blue/30 ${priority ? PRIORITY_STYLE[priority] : 'bg-white text-gray-400 border-gray-100'}`}
        title="Change the priority">
        {priority ?? 'set priority'}
      </button>
      {setBy && <span className="text-[10px] text-gray-400">set by {setBy === 'you' ? 'you' : 'a teammate'}</span>}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-gray-100 bg-white shadow-lg p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Priority</p>
          <div className="flex gap-1">{LEVELS.map(l => <button key={l.key} type="button" onClick={() => setPick(l.key)} className={chip(pick === l.key)}>{l.label}</button>)}</div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 pt-1">Why</p>
          <div className="flex flex-wrap gap-1">{REASONS.map(r => <button key={r.key} type="button" onClick={() => setReason(x => (x === r.key ? null : r.key))} className={chip(reason === r.key)}>{r.label}</button>)}</div>
          {error && <p className="text-[10px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-1 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-[10px] text-gray-500 hover:text-np-dark">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-lg bg-np-blue text-white hover:bg-np-blue-hover disabled:opacity-50">
              {busy && <Loader2 size={10} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
