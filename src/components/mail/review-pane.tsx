'use client'

// The Inbox review pane (feat/drafts-inbox-review): beside the list on desktop, full screen on a phone.
// Top to bottom: the email, what the drafter looked at (metadata only), the draft read live from Gmail, why it was
// written that way, then Approve, Edit, Redraft and Reject. The Hub never sends: an approved draft waits in Gmail.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Lightbulb, Loader2, Pencil, PenLine, RefreshCw, X } from 'lucide-react'
import { PriorityPill, type Priority } from './priority-pill'

interface Pane {
  email: { id: string; subject: string | null; from_name: string | null; from_address: string | null; mailbox: string; received_at: string; category: string | null
    priority: Priority | null; summary: string | null; suggested_action: string | null; why_priority: string; priority_set_by: 'you' | 'teammate' | null; gmail_url: string }
  looked_at: { contact: { id: string; name: string } | null; pipelines: Array<{ pipeline: string; stage: string }>; university: string | null; calendar: string | null; recent_threads: number }
  draft: null | { id: string; status: string; badge: string | null; reason: string | null; url: string | null; live: { from: string; to: string; text: string } | null
    live_error: string | null; why: string | null; lesson: string | null; lesson_pending: boolean }
  /** drafting mode is on for this mailbox's org (the Draft a reply button shows only then) */
  drafting: boolean
  /** decided by the server: drafting on, no draft row for this message, and a category that may be drafted */
  can_draft: boolean
}

const CHIPS = [
  { key: 'wrong_tone', label: 'Wrong tone' }, { key: 'wrong_facts', label: 'Wrong facts' },
  { key: 'should_not_reply', label: 'Should not reply' }, { key: 'will_handle', label: 'I will handle it' },
]
const LINE_MAX = 199
const lineProblem = (s: string) => (s.length > LINE_MAX ? 'Keep it under 200 characters.' : s.includes('@') ? 'No @ (no addresses).' : /[\r\n]/.test(s) ? 'One line only.' : null)
const label = (s: string) => s.replace(/_/g, ' ')

export function ReviewPane({ messageId, onClose, onChanged }: {
  messageId: string
  onClose: () => void
  /** after an action: the message's new draft status (null when unchanged), and its priority when that changed */
  onChanged: (u: { draft_status?: string | null; priority?: Priority; priority_set_by?: 'you' }) => void
}) {
  const [pane, setPane] = useState<Pane | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'redraft' | 'reject'>('view')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [chip, setChip] = useState<string | null>(null)
  const [line, setLine] = useState('')
  const [learned, setLearned] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/mail/messages/${messageId}`, { cache: 'no-store' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(data.error || 'This email could not be loaded.'); return }
    setPane(data)
  }, [messageId])
  useEffect(() => { setPane(null); setMode('view'); setLearned(false); setNote(''); setChip(null); setLine(''); load() }, [load])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!pane?.draft) return
    // Approve opens Gmail inside the click, so the browser does not block the new tab
    if (action === 'approve' && pane.draft.url) window.open(pane.draft.url, '_blank', 'noopener,noreferrer')
    setBusy(action); setError(null)
    try {
      const res = await fetch(`/api/mail/drafts/${pane.draft.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'The draft could not be updated.'); return }
      onChanged({ draft_status: data.status })
      if (action === 'edit') setLearned(true)
      setMode('view')
      await load()
    } finally {
      setBusy(null)
    }
  }

  // Draft a reply: the same pipeline as the cron, for this one message (hard stops included)
  const draftNow = async () => {
    if (!pane) return
    setBusy('draft'); setError(null)
    try {
      const res = await fetch('/api/mail/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: pane.email.id }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'A draft could not be written.'); return }
      if (data.status) onChanged({ draft_status: data.status })
      if (data.message) setError(data.message)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const btn = 'flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40'
  const primary = 'flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-np-blue text-white hover:bg-np-blue-hover disabled:opacity-50'
  const section = 'rounded-xl border border-gray-100 bg-white p-4'
  const heading = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2'
  const d = pane?.draft
  const open = !!d && ['drafted', 'approved', 'edited'].includes(d.status)
  const problem = lineProblem(mode === 'reject' ? line : note)

  return (
    <div className="fixed inset-0 z-40 bg-np-light overflow-y-auto lg:static lg:z-auto lg:bg-transparent lg:overflow-visible" data-help-section="mail-drafts">
      <div className="p-4 lg:p-0 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1 text-xs text-gray-500 hover:text-np-dark"><ArrowLeft size={12} /> Back to the list</button>
          {pane && <a href={pane.email.gmail_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-np-blue hover:underline"><ExternalLink size={11} /> Open thread in Gmail</a>}
        </div>
        {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600"><AlertTriangle size={12} /> {error}</div>}
        {!pane && !error && <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 p-6"><Loader2 size={12} className="animate-spin" /> Loading...</p>}

        {pane && <>
          {/* the email */}
          <div className={section}>
            <p className="text-sm font-semibold text-np-dark">{pane.email.subject || '(no subject)'}</p>
            <p className="text-xs text-gray-500 mt-1">
              {pane.email.from_name || pane.email.from_address || 'Unknown sender'}
              {pane.email.from_name && pane.email.from_address && <span className="text-gray-400"> · {pane.email.from_address}</span>}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">To {pane.email.mailbox} · {new Date(pane.email.received_at).toLocaleString()}</p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {pane.email.category && <span className="px-1.5 py-0.5 rounded border border-gray-100 bg-gray-50 text-[10px] text-gray-600">{label(pane.email.category)}</span>}
              <PriorityPill messageId={pane.email.id} priority={pane.email.priority} setBy={pane.email.priority_set_by}
                onSaved={(p, by) => { onChanged({ priority: p, priority_set_by: by }); load() }} />
            </div>
            {pane.email.summary && <p className="text-xs text-np-dark mt-2">{pane.email.summary}</p>}
            {pane.email.suggested_action && <p className="text-[11px] text-gray-400 mt-1">Suggested: {pane.email.suggested_action}</p>}
            <p className="text-[11px] text-gray-500 mt-2"><span className="font-medium text-gray-600">Why this priority:</span> {pane.email.why_priority}</p>
          </div>

          {/* what I looked at: metadata only */}
          <div className={section}>
            <p className={heading}>What I looked at</p>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
              <dt className="text-gray-400">Hub contact</dt>
              <dd>{pane.looked_at.contact
                ? <Link href={`/crm/contacts?id=${pane.looked_at.contact.id}`} className="text-np-blue hover:underline">{pane.looked_at.contact.name}</Link>
                : <span className="text-gray-500">Not a contact yet</span>}</dd>
              <dt className="text-gray-400">Pipeline and stage</dt>
              <dd className="text-np-dark">{pane.looked_at.pipelines.length ? pane.looked_at.pipelines.map(p => `${p.pipeline}: ${p.stage}`).join(' · ') : <span className="text-gray-500">None</span>}</dd>
              <dt className="text-gray-400">University</dt>
              <dd className="text-np-dark">{pane.looked_at.university ?? <span className="text-gray-500">Not known</span>}</dd>
              <dt className="text-gray-400">Calendar</dt>
              <dd className="text-np-dark">{pane.looked_at.calendar ?? <span className="text-gray-500">Not known</span>}</dd>
              <dt className="text-gray-400">Recent threads</dt>
              <dd className="text-np-dark">{pane.looked_at.recent_threads} in the last 90 days in this mailbox</dd>
            </dl>
          </div>

          {/* the draft */}
          <div className={section}>
            <div className="flex items-center justify-between mb-2">
              <p className={heading + ' mb-0'}>The draft</p>
              {d?.badge && <span className={`px-1.5 py-0.5 rounded border text-[10px] ${BADGE_STYLE[d.badge] ?? ''}`}>{d.badge}</span>}
            </div>
            {!d && <p className="text-xs text-gray-500">{pane.drafting ? 'No draft for this email yet.' : 'No draft for this email. Drafting is off for this organization.'}</p>}
            {!d && pane.can_draft && (
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <button onClick={draftNow} disabled={!!busy} className={primary}>{busy === 'draft' ? <Loader2 size={11} className="animate-spin" /> : <PenLine size={11} />} Draft a reply</button>
                <p className="w-full text-[10px] text-gray-400">Saved as a Gmail draft in this thread. Clinical, legal, money and crisis questions are never drafted.</p>
              </div>
            )}
            {d?.status === 'needs_person' && (
              <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs">
                <p className="font-semibold">Needs a person: {d.reason}</p>
                <p className="mt-0.5 text-red-600">The Hub does not draft these. Answer it yourself in Gmail, then dismiss it here.</p>
              </div>
            )}
            {d && !open && d.status !== 'needs_person' && <p className="text-xs text-gray-500">{d.status === 'sent' ? 'Sent from Gmail.' : d.status === 'rejected' ? 'Rejected. The Gmail draft was deleted.' : ''}</p>}
            {open && d.live_error && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{d.live_error}</p>}
            {open && d.live && mode !== 'edit' && (
              <div className="rounded-lg border border-gray-100 bg-np-light">
                <div className="px-3 py-2 border-b border-gray-100 text-[10px] text-gray-500 space-y-0.5">
                  <p><span className="text-gray-400">From</span> {d.live.from}</p>
                  <p><span className="text-gray-400">To</span> {d.live.to}</p>
                </div>
                <p className="px-3 py-3 text-xs text-np-dark whitespace-pre-wrap">{d.live.text}</p>
              </div>
            )}
            {open && d.live && mode === 'edit' && (
              <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
                className="w-full rounded-lg border border-np-blue/30 bg-white px-3 py-2 text-xs text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            )}
            {d?.why && open && <p className="text-[11px] text-gray-500 mt-2"><span className="font-medium text-gray-600">Why I wrote it this way:</span> {d.why}</p>}

            {(learned || d?.status === 'edited' || (d?.status === 'sent' && d.lesson)) && (
              <div className="mt-3 rounded-lg border border-gold/40 bg-gold-light px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gold"><Lightbulb size={11} /> What I learned from this one</p>
                <p className="text-xs text-np-dark mt-1">{d?.lesson ?? 'Lesson pending: it is written after you send the draft from Gmail (the :20 and :50 runs).'}</p>
              </div>
            )}

            {/* actions */}
            {open && mode === 'view' && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                <button onClick={() => act('approve')} disabled={!!busy || !d.live} className={primary} title="Mark approved and open it in Gmail, where you send it"><Check size={11} /> Approve</button>
                <button onClick={() => { setText(d.live?.text ?? ''); setMode('edit') }} disabled={!!busy || !d.live} className={btn}><Pencil size={11} /> Edit</button>
                <button onClick={() => setMode('redraft')} disabled={!!busy} className={btn}><RefreshCw size={11} /> Redraft</button>
                <button onClick={() => setMode('reject')} disabled={!!busy} className={btn}><X size={11} /> Reject</button>
              </div>
            )}
            {open && mode === 'edit' && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button onClick={() => act('edit', { text })} disabled={!!busy || !text.trim()} className={primary}>{busy === 'edit' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve my version</button>
                <button onClick={() => setMode('view')} disabled={!!busy} className={btn}>Cancel</button>
                <p className="w-full text-[10px] text-gray-400">Your version replaces the draft in Gmail. Nothing is sent: send it from Gmail.</p>
              </div>
            )}
            {open && mode === 'redraft' && (
              <div className="mt-3 space-y-2">
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={LINE_MAX} placeholder="Optional note, for example: shorter, and mention the welcome email"
                  className="w-full rounded-lg border border-gray-100 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                {note && problem && <p className="text-[10px] text-red-600">{problem}</p>}
                <div className="flex gap-1.5">
                  <button onClick={() => act('redraft', { note: note.trim() || null })} disabled={!!busy || (!!note && !!problem)} className={primary}>{busy === 'redraft' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Redraft</button>
                  <button onClick={() => setMode('view')} disabled={!!busy} className={btn}>Cancel</button>
                </div>
                <p className="text-[10px] text-gray-400">The current Gmail draft is replaced by a new one. Clinical, legal, money and crisis questions are still never drafted.</p>
              </div>
            )}
            {d && (open || d.status === 'needs_person') && mode === 'reject' && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1">{CHIPS.map(c => (
                  <button key={c.key} onClick={() => setChip(x => (x === c.key ? null : c.key))}
                    className={`px-2 py-1 rounded-lg border text-[10px] font-medium ${chip === c.key ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}>{c.label}</button>
                ))}</div>
                <input value={line} onChange={e => setLine(e.target.value)} maxLength={LINE_MAX} placeholder="Optional: what should it have done? (one line, no @)"
                  className="w-full rounded-lg border border-gray-100 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                {line && problem && <p className="text-[10px] text-red-600">{problem}</p>}
                <div className="flex gap-1.5">
                  <button onClick={() => act('reject', { chip, line: line.trim() || null })} disabled={!!busy || !chip || (!!line && !!problem)} className={primary}>{busy === 'reject' ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Reject</button>
                  <button onClick={() => setMode('view')} disabled={!!busy} className={btn}>Cancel</button>
                </div>
                <p className="text-[10px] text-gray-400">The Gmail draft is deleted. Your reason becomes a lesson the next drafts read.</p>
              </div>
            )}
            {d?.status === 'needs_person' && mode === 'view' && (
              <div className="flex gap-1.5 mt-3">
                <button onClick={() => act('reject')} disabled={!!busy} className={btn}><Check size={11} /> I answered it, dismiss</button>
              </div>
            )}
          </div>
        </>}
      </div>
    </div>
  )
}

export const BADGE_STYLE: Record<string, string> = {
  'Draft ready': 'bg-np-blue/5 text-np-blue border-np-blue/10',
  'In Gmail as a draft': 'bg-green-50 text-green-700 border-green-100',
  Rejected: 'bg-gray-50 text-gray-400 border-gray-100',
  'Needs a person': 'bg-red-50 text-red-600 border-red-100',
}
