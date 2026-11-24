'use client'

// Contact card › "Waiting on us" (Running List q35, Part 1): one small line per open touchpoint situation, at the top
// of the card, with the why and a link to its board card in Follow-ups to review. Reads GET
// /api/crm/contacts/[id]/waiting only; the route applies the mailbox privacy rule. No open situation shows nothing.
// No reply needed (scope all) sits on the line; once resolved, the line reads "Resolved by <name>, <reason>, <time>".
import { useEffect, useState } from 'react'
import { ResolveButton } from '@/components/resolve/resolve-button'
import Link from 'next/link'
import { Hourglass } from 'lucide-react'

interface Waiting { id: string; kind: string; severity: string; why: string; card: string | null }

export function WaitingOnUs({ contactId }: { contactId: string | null | undefined }) {
  const [rows, setRows] = useState<Waiting[]>([])
  const [resolved, setResolved] = useState(false)
  useEffect(() => {
    if (!contactId) return
    let live = true
    setRows([])
    fetch(`/api/crm/contacts/${encodeURIComponent(contactId)}/waiting`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { waiting: [] }))
      .then(d => { if (live) setRows(Array.isArray(d.waiting) ? d.waiting : []) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [contactId])
  if (!rows.length && !resolved) return null
  return (
    <div className="px-5 py-2 border-b border-amber-100 bg-amber-50/70 space-y-0.5" data-help-section="contact-waiting-on-us">
      <div className="flex justify-end"><ResolveButton contactId={contactId} scope="all" onChange={r => { setResolved(r); if (r) setRows([]) }} /></div>
      {!resolved && rows.map(w => (
        <p key={w.id} className="flex items-center gap-1.5 text-[11px] text-amber-800">
          <Hourglass className="w-3 h-3 flex-shrink-0" />
          <span className="font-semibold">Waiting on us:</span>
          <span className="truncate" title={w.why}>{w.why}</span>
          {w.card && <Link href={w.card} className="ml-auto flex-shrink-0 text-np-blue hover:underline">Open card</Link>}
        </p>
      ))}
    </div>
  )
}
