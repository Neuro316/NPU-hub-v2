'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatUsPhone, toE164 } from '@/lib/phone'

// The org's phone lines, from GET /api/comms/lines (never a browser read of
// crm_twilio — that key carries credentials). Shared by the Conversations
// pane, the contact-card comms panel and the incoming-call modal so the three
// label a line the same way.
//
// labelFor() returns null when the org has fewer than two lines, so an org with
// one number (or none, e.g. Sensorium) renders no badges at all and its UI is
// unchanged.

export interface OrgLine {
  phone: string
  nickname: string
  purpose: string
  forwards: boolean
}

export function useOrgLines(orgId: string | null | undefined) {
  const [lines, setLines] = useState<OrgLine[]>([])
  const [defaultLine, setDefaultLine] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLines([]); setDefaultLine(null); setLoaded(false)
    if (!orgId) { setLoaded(true); return }
    fetch(`/api/comms/lines?org_id=${encodeURIComponent(orgId)}`)
      .then(r => (r.ok ? r.json() : { lines: [], default_line: null }))
      .then(d => {
        if (cancelled) return
        setLines(Array.isArray(d?.lines) ? d.lines : [])
        setDefaultLine(d?.default_line || null)
      })
      .catch(() => { /* no lines: no dropdown entries, no badges */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [orgId])

  const labelFor = useCallback((e164: string | null | undefined): string | null => {
    if (!e164 || lines.length < 2) return null
    const want = toE164(e164)
    const line = lines.find(l => l.phone === want)
    if (!line) return null
    return line.nickname || formatUsPhone(line.phone)
  }, [lines])

  return { lines, defaultLine, loaded, labelFor }
}
