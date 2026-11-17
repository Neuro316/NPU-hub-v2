'use client'

// One fetch of GET /api/crm/contacts/[id]/communications per contact, shared by the Communications section and the
// Communication Activity counts on the contact card (q30), so both show the same touches. The route applies the mail
// privacy rules on the server; the browser never reads the mail, message, call or campaign tables.
import { useEffect, useState } from 'react'
import type { Touch } from '@/lib/comms/privacy'

export interface CommunicationsState { touches: Touch[] | null; error: string | null }

export function useCommunications(contactId: string | null | undefined): CommunicationsState {
  const [state, setState] = useState<CommunicationsState>({ touches: null, error: null })
  useEffect(() => {
    if (!contactId) return
    let live = true
    setState({ touches: null, error: null })
    fetch(`/api/crm/contacts/${encodeURIComponent(contactId)}/communications`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Communications could not be loaded.'); return d })
      .then(d => { if (live) setState({ touches: d.touches ?? [], error: null }) })
      .catch(e => { if (live) setState({ touches: [], error: String(e?.message || e) }) })
    return () => { live = false }
  }, [contactId])
  return state
}
