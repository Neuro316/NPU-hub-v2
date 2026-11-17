'use client'

// Contact card › Communications (Running List q02): every touch with this contact, newest first, filterable by
// type. Reads only GET /api/crm/contacts/[id]/communications, which applies mail privacy on the server; this
// component never reads a mail, message, call or campaign table and never sees a message body.
import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, ChevronDown, ChevronRight, Lock, Mail, MessageSquare, Megaphone, Phone, Sparkles } from 'lucide-react'

type TouchType = 'email' | 'text' | 'call' | 'meeting' | 'campaign' | 'lifecycle'
interface Touch { id: string; type: TouchType; direction: 'in' | 'out' | null; at: string; who: string | null; summary: string; muted: boolean; redacted: boolean }

const FILTERS: Array<{ key: 'all' | TouchType; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'email', label: 'Email' }, { key: 'text', label: 'Text' },
  { key: 'call', label: 'Call' }, { key: 'meeting', label: 'Meeting' }, { key: 'campaign', label: 'Campaign' },
]
const ICON: Record<TouchType, typeof Mail> = { email: Mail, text: MessageSquare, call: Phone, meeting: CalendarCheck, campaign: Megaphone, lifecycle: Sparkles }
const PAGE = 25

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function CommunicationsHistory({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false)
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | TouchType>('all')
  const [shown, setShown] = useState(PAGE)

  // load on first open, and again when the contact changes
  useEffect(() => { setTouches(null); setError(null); setShown(PAGE) }, [contactId])
  useEffect(() => {
    if (!open || touches !== null) return
    let live = true
    fetch(`/api/crm/contacts/${encodeURIComponent(contactId)}/communications`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Communications could not be loaded.'); return d })
      .then(d => { if (live) setTouches(d.touches ?? []) })
      .catch(e => { if (live) { setError(String(e?.message || e)); setTouches([]) } })
    return () => { live = false }
  }, [open, touches, contactId])

  const list = useMemo(() => (touches ?? []).filter(t => filter === 'all' || t.type === filter), [touches, filter])

  return (
    <div className="space-y-2" data-help-section="contact-communications">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider">
        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Communications{touches ? ` (${touches.filter(t => !t.muted).length})` : ''}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => { setFilter(f.key); setShown(PAGE) }}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${filter === f.key ? 'bg-np-blue text-white border-np-blue' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {f.label}
              </button>
            ))}
          </div>
          {touches === null && <p className="text-[11px] text-gray-400">Loading...</p>}
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          {touches !== null && !error && list.length === 0 && <p className="text-[11px] text-gray-400">Nothing here yet.</p>}
          <ul className="divide-y divide-gray-50">
            {list.slice(0, shown).map(t => {
              const Icon = t.redacted ? Lock : ICON[t.type]
              return (
                <li key={t.id} className={`py-1.5 flex items-start gap-2 ${t.muted ? 'opacity-50 italic' : ''}`}>
                  <Icon className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-np-dark truncate" title={t.summary}>{t.summary}</p>
                    <p className="text-[9px] text-gray-400 flex items-center gap-1">
                      {t.direction === 'in' && <><ArrowDownLeft className="w-2.5 h-2.5" /> In</>}
                      {t.direction === 'out' && <><ArrowUpRight className="w-2.5 h-2.5" /> Out</>}
                      <span>{when(t.at)}</span>
                      {t.who && <span className="truncate">· {t.who}</span>}
                      {t.muted && <span>· superadmin view</span>}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
          {list.length > shown && (
            <button onClick={() => setShown(n => n + PAGE)} className="text-[10px] text-np-blue hover:underline">Show more ({list.length - shown})</button>
          )}
        </div>
      )}
    </div>
  )
}
