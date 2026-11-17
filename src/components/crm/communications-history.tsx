'use client'

// Contact card › Communications (Running List q02): every touch with this contact, newest first, filterable by
// type. The touches come from the parent (useCommunications), the same data the Communication Activity counts use
// (q30). The route applies mail privacy on the server; this component never reads a mail, message, call or campaign
// table and never sees a message body. Open state and filter can be driven by the parent (a count tile opens the
// section filtered to its type).
import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, ChevronDown, ChevronRight, Lock, Mail, MessageSquare, Megaphone, Phone, Sparkles } from 'lucide-react'
import type { CommunicationsState } from './use-communications'

type TouchType = 'email' | 'text' | 'call' | 'meeting' | 'campaign' | 'lifecycle'
export type CommsFilter = 'all' | TouchType

const FILTERS: Array<{ key: CommsFilter; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'email', label: 'Email' }, { key: 'text', label: 'Text' },
  { key: 'call', label: 'Call' }, { key: 'meeting', label: 'Meeting' }, { key: 'campaign', label: 'Campaign' },
]
const ICON: Record<TouchType, typeof Mail> = { email: Mail, text: MessageSquare, call: Phone, meeting: CalendarCheck, campaign: Megaphone, lifecycle: Sparkles }
const PAGE = 25

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function CommunicationsHistory({ state, open: openProp, onOpenChange, filter: filterProp, onFilterChange }: {
  state: CommunicationsState
  open?: boolean
  onOpenChange?: (open: boolean) => void
  filter?: CommsFilter
  onFilterChange?: (f: CommsFilter) => void
}) {
  const [openLocal, setOpenLocal] = useState(false)
  const [filterLocal, setFilterLocal] = useState<CommsFilter>('all')
  const [shown, setShown] = useState(PAGE)
  const open = openProp ?? openLocal
  const filter = filterProp ?? filterLocal
  const setOpen = (o: boolean) => { setOpenLocal(o); onOpenChange?.(o) }
  const setFilter = (f: CommsFilter) => { setFilterLocal(f); onFilterChange?.(f); setShown(PAGE) }
  const { touches, error } = state

  const list = useMemo(() => (touches ?? []).filter(t => filter === 'all' || t.type === filter), [touches, filter])

  return (
    <div className="space-y-2" data-help-section="contact-communications">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider">
        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Communications{touches ? ` (${touches.filter(t => !t.muted).length})` : ''}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
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
              const Icon = t.redacted ? Lock : ICON[t.type as TouchType]
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
