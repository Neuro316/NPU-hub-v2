'use client'

// Contact card › "Waiting on us" (Running List q35, Part 1): one small line per open touchpoint situation, at the top
// of the card, with the why and a link to its board card in Follow-ups to review. Reads GET
// /api/crm/contacts/[id]/waiting (the route applies the mailbox privacy rule) and, in the same go, the live No reply
// needed resolution for everything (GET /api/resolve?scope=all). The block shows when either exists (waitingMode):
// resolved, it reads "Resolved by <name>, <reason>, <time>" with Reopen in place of the waiting lines; after Reopen the
// open lines are read again, so they come back without a reload. Neither shows nothing.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { ResolveButton } from '@/components/resolve/resolve-button'
import { pickLive, waitingMode, type LiveResolution } from '@/lib/resolve/view'

interface Waiting { id: string; kind: string; severity: string; why: string; card: string | null }

export function WaitingOnUs({ contactId }: { contactId: string | null | undefined }) {
  const [rows, setRows] = useState<Waiting[]>([])
  const [live, setLive] = useState<LiveResolution | null>(null)

  const loadRows = useCallback(async (id: string) => {
    const r = await fetch(`/api/crm/contacts/${encodeURIComponent(id)}/waiting`, { cache: 'no-store' }).catch(() => null)
    const d = r?.ok ? await r.json().catch(() => ({})) : {}
    return Array.isArray(d.waiting) ? d.waiting as Waiting[] : []
  }, [])

  useEffect(() => {
    if (!contactId) return
    let on = true
    setRows([]); setLive(null)
    Promise.all([
      loadRows(contactId),
      fetch(`/api/resolve?contact_id=${encodeURIComponent(contactId)}&scope=all`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { resolutions: [] })).catch(() => ({ resolutions: [] })),
    ]).then(([w, res]) => {
      if (!on) return
      setRows(w)
      setLive(pickLive(Array.isArray(res.resolutions) ? res.resolutions : [], 'all'))
    })
    return () => { on = false }
  }, [contactId, loadRows])

  const changed = (resolved: boolean, made: LiveResolution | null) => {
    setLive(resolved ? made : null)
    // after Reopen, the open lines come back at once
    if (!resolved && contactId) loadRows(contactId).then(setRows)
  }

  const mode = waitingMode(rows, live)
  if (!mode || !contactId) return null
  return (
    // the contact panel's top padding (below lg) keeps this clear of the floating "Browser calling off / Call" bar
    <div className="px-5 py-2 border-b border-amber-100 bg-amber-50/70 space-y-0.5" data-help-section="contact-waiting-on-us">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <ResolveButton contactId={contactId} scope="all" initial={live} onChange={changed} />
      </div>
      {mode === 'waiting' && rows.map(w => (
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
