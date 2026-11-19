'use client'

// Contact card › Recent email (Running List q31): the last 7 email conversations, newest first, one line per thread.
// Subject, date, mailbox and who replied last; never a body or a summary. The route applies mail privacy on the
// server: a thread this viewer may not read arrives as "1 private conversation" with its date only. No lines (or an
// error) shows nothing at all. There is no thread filter in Communications to link to, so the lines are not links.
import { useEffect, useState } from 'react'
import { Lock, Mail } from 'lucide-react'
import type { RecentEmailLine } from '@/lib/comms/recent-email'

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function RecentEmail({ contactId }: { contactId: string | null | undefined }) {
  const [lines, setLines] = useState<RecentEmailLine[]>([])
  useEffect(() => {
    if (!contactId) return
    let live = true
    setLines([])
    fetch(`/api/crm/contacts/${encodeURIComponent(contactId)}/recent-email`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { lines: [] }))
      .then(d => { if (live) setLines(Array.isArray(d.lines) ? d.lines : []) })
      .catch(() => { if (live) setLines([]) })
    return () => { live = false }
  }, [contactId])

  if (!lines.length) return null
  return (
    <div className="space-y-1" data-help-section="contact-recent-email">
      <p className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider"><Mail className="w-3 h-3" /> Recent email</p>
      <ul className="divide-y divide-gray-50">
        {lines.map(l => (
          <li key={l.key} className="py-1.5 flex items-start gap-2">
            {l.hidden ? <Lock className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" /> : <Mail className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] truncate ${l.hidden ? 'text-gray-500 italic' : 'text-np-dark'}`} title={l.label}>{l.label}</p>
              <p className="text-[9px] text-gray-400 flex items-center gap-1 min-w-0">
                <span className="flex-shrink-0">{when(l.at)}</span>
                {l.mailbox && <span className="truncate">· {l.mailbox}</span>}
                {l.lastReply && <span className="flex-shrink-0">· {l.lastReply === 'No reply yet' ? l.lastReply : `Last reply: ${l.lastReply}`}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
