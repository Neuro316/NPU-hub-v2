'use client'

// Inbox (superadmin only): new mail from connected Gmail mailboxes, triaged by AI, and its reply drafts reviewed in
// place (feat/drafts-inbox-review). Tabs: Needs review (default: a draft ready or a question that needs a person),
// All, Learning. Selecting a row opens the review pane beside the list (full screen on a phone).
// The Hub never sends: an approved draft waits in Gmail. What is listed is decided by /api/mail/messages under the
// mailbox visibility rules.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Inbox, ExternalLink, Check, Eye, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react'
import { ReviewPane, BADGE_STYLE } from '@/components/mail/review-pane'
import { LearningTab } from '@/components/mail/learning-tab'
import { PriorityPill } from '@/components/mail/priority-pill'

interface Mailbox { id: string; email_address: string; visibility: 'private' | 'shared'; status: string }
interface Message {
  id: string
  mailbox: string
  from_name: string | null
  from_address: string | null
  subject: string | null
  received_at: string
  category: string | null
  priority: 'urgent' | 'normal' | 'low' | null
  summary: string | null
  suggested_action: string | null
  status: 'new' | 'seen' | 'done'
  triage: 'done' | 'waiting' | 'failed'
  triage_error: string | null
  gmail_url: string
  draft_status: string | null
  draft_badge: string | null
  priority_set_by: 'you' | 'teammate' | null
}
const REVIEW = ['drafted', 'needs_person']

const CATEGORIES = [
  'scheduling', 'lead', 'participant_support', 'partner_outreach', 'personal', 'legal_financial',
  'clinical', 'vendor_billing', 'security_alert', 'newsletter', 'spam',
]
const label = (s: string) => s.replace(/_/g, ' ')

export default function MailInboxPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [filters, setFilters] = useState({ mailbox: '', category: '', status: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'review' | 'all' | 'learning'>('review')
  const [needsReview, setNeedsReview] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (before?: string) => {
    if (tab === 'learning') return
    setLoading(true); setError(null)
    const q = new URLSearchParams()
    q.set('view', tab === 'review' ? 'review' : 'all')
    if (filters.mailbox) q.set('mailbox', filters.mailbox)
    if (filters.category) q.set('category', filters.category)
    if (filters.status) q.set('status', filters.status)
    if (before) q.set('before', before)
    try {
      const res = await fetch(`/api/mail/messages?${q}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) { setAllowed(false); return }
      setAllowed(true)
      if (!res.ok) { setError(data.error || 'The inbox could not be loaded.'); return }
      setMailboxes(data.mailboxes ?? [])
      setMessages(prev => (before ? [...prev, ...(data.messages ?? [])] : data.messages ?? []))
      setNext(data.next ?? null)
      if (typeof data.needs_review === 'number') setNeedsReview(data.needs_review)
    } finally {
      setLoading(false)
    }
  }, [filters, tab])

  useEffect(() => { load() }, [load])

  const setStatus = async (m: Message, status: Message['status']) => {
    setBusy(m.id)
    try {
      const res = await fetch('/api/mail/messages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, status }),
      })
      if (res.ok) {
        setMessages(prev => filters.status && filters.status !== status
          ? prev.filter(x => x.id !== m.id)
          : prev.map(x => (x.id === m.id ? { ...x, status } : x)))
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'The status could not be saved.')
      }
    } finally {
      setBusy(null)
    }
  }

  const changed = (id: string, u: { draft_status?: string | null; priority?: Message['priority']; priority_set_by?: 'you' }) => {
    setMessages(prev => prev.map(x => {
      if (x.id !== id) return x
      const next = { ...x }
      if (u.priority) { next.priority = u.priority; next.priority_set_by = u.priority_set_by ?? x.priority_set_by }
      if (u.draft_status !== undefined) {
        const was = REVIEW.includes(x.draft_status ?? ''), now = REVIEW.includes(u.draft_status ?? '')
        if (was !== now) {
          setNeedsReview(n => (n === null ? n : Math.max(0, n + (now ? 1 : -1))))
          window.dispatchEvent(new Event('hub:mail-review-changed'))
        }
        next.draft_status = u.draft_status
        next.draft_badge = BADGE_OF[u.draft_status ?? ''] ?? null
      }
      return next
    }))
  }

  if (allowed === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Inbox size={28} className="text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-np-dark">The inbox is for superadmins.</p>
      </div>
    )
  }

  const select = 'px-2.5 py-1.5 text-xs border border-gray-100 rounded-lg bg-white'
  const small = 'flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40'
  const TABS: Array<{ key: typeof tab; label: string }> = [{ key: 'review', label: 'Needs review' }, { key: 'all', label: 'All' }, { key: 'learning', label: 'Learning' }]

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Inbox</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            New mail from connected mailboxes, sorted by AI. Checked every 5 minutes. Review reply drafts here; the Hub never sends, so an approved draft waits in Gmail for you.
          </p>
        </div>
        <Link href="/settings?section=mailboxes" className="text-xs text-np-blue hover:underline flex-shrink-0">Manage mailboxes</Link>
      </div>

      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); setMessages([]); setNext(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${tab === t.key ? 'border-np-blue text-np-blue' : 'border-transparent text-gray-400 hover:text-np-dark'}`}>
            {t.label}
            {t.key === 'review' && needsReview !== null && (
              <span className={`min-w-[18px] px-1 rounded-full text-[10px] leading-[16px] text-center ${needsReview ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-400'}`}>{needsReview}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'learning' ? <LearningTab /> : <>
      <div className="flex flex-wrap gap-2">
        <select className={select} value={filters.mailbox} onChange={e => setFilters(f => ({ ...f, mailbox: e.target.value }))}>
          <option value="">All mailboxes</option>
          {mailboxes.map(b => <option key={b.id} value={b.id}>{b.email_address}</option>)}
        </select>
        <select className={select} value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}
        </select>
        <select className={select} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Any status</option>
          <option value="new">New</option>
          <option value="seen">Seen</option>
          <option value="done">Done</option>
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <div className={selected ? 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4 lg:items-start' : ''}>
      <div className="space-y-3 min-w-0">
      <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-400 p-6 text-center">
            {!mailboxes.length ? 'No mailboxes connected yet.' : tab === 'review' ? 'Nothing needs review. New drafts and questions that need a person show here.' : 'No messages match these filters.'}
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} onClick={() => setSelected(m.id)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') setSelected(m.id) }}
            className={`px-4 py-3 cursor-pointer transition-colors ${selected === m.id ? 'bg-np-blue/5' : 'hover:bg-gray-50/60'} ${m.status === 'done' ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {m.status === 'new' && <span className="w-1.5 h-1.5 rounded-full bg-np-blue flex-shrink-0" />}
                  <p className="text-xs font-semibold text-np-dark truncate">{m.from_name || m.from_address || 'Unknown sender'}</p>
                  {m.from_name && m.from_address && <p className="text-[10px] text-gray-400 truncate">{m.from_address}</p>}
                  <span className="text-[10px] text-gray-300">·</span>
                  <p className="text-[10px] text-gray-400">{new Date(m.received_at).toLocaleString()}</p>
                </div>
                <p className="text-xs text-np-dark mt-0.5 truncate">{m.subject || (m.triage === 'waiting' ? '' : '(no subject)')}</p>
                {m.triage === 'done' ? (
                  <>
                    <p className="text-[11px] text-gray-500 mt-1">{m.summary}</p>
                    {m.suggested_action && <p className="text-[10px] text-gray-400 mt-0.5">Suggested: {m.suggested_action}</p>}
                  </>
                ) : m.triage === 'waiting' ? (
                  <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-1"><Loader2 size={10} className="animate-spin" /> Waiting for triage</p>
                ) : (
                  <p className="text-[10px] text-red-500 mt-1">Not classified: {m.triage_error || 'triage failed'}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {m.draft_badge && <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${BADGE_STYLE[m.draft_badge] ?? ''}`}>{m.draft_badge}</span>}
                  {m.category && <span className="px-1.5 py-0.5 rounded border border-gray-100 bg-gray-50 text-[10px] text-gray-600">{label(m.category)}</span>}
                  {m.triage === 'done' && <PriorityPill messageId={m.id} priority={m.priority} setBy={m.priority_set_by} onSaved={(p, by) => changed(m.id, { priority: p, priority_set_by: by })} />}
                  <span className="text-[10px] text-gray-400">{m.mailbox}</span>
                </div>
              </div>
              <div className={`flex items-center gap-1 flex-shrink-0 ${selected ? 'lg:hidden' : ''}`} onClick={e => e.stopPropagation()}>
                <a href={m.gmail_url} target="_blank" rel="noopener noreferrer" title="Open in Gmail" className={small}>
                  <ExternalLink size={10} /> Gmail
                </a>
                {m.status === 'new' && (
                  <button onClick={() => setStatus(m, 'seen')} disabled={busy === m.id} title="Mark seen" className={small}>
                    <Eye size={10} /> Seen
                  </button>
                )}
                {m.status !== 'done' ? (
                  <button onClick={() => setStatus(m, 'done')} disabled={busy === m.id} title="Mark done" className={small}>
                    <Check size={10} /> Done
                  </button>
                ) : (
                  <button onClick={() => setStatus(m, 'new')} disabled={busy === m.id} title="Mark new again" className={small}>
                    <RotateCcw size={10} /> Reopen
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 p-4"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
      </div>

      {next && !loading && (
        <div className="flex justify-center">
          <button onClick={() => load(next)} className="px-3 py-1.5 text-xs border border-gray-100 rounded-lg hover:bg-gray-50">Load more</button>
        </div>
      )}
      </div>
      {selected && (
        <div className="lg:sticky lg:top-4 min-w-0">
          <ReviewPane messageId={selected} onClose={() => setSelected(null)} onChanged={u => changed(selected, u)} />
        </div>
      )}
      </div>
      </>}
    </div>
  )
}

const BADGE_OF: Record<string, string> = {
  drafted: 'Draft ready', approved: 'In Gmail as a draft', edited: 'In Gmail as a draft', rejected: 'Rejected', needs_person: 'Needs a person',
}
