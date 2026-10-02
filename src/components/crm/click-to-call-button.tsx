'use client'

// Click-to-call in the open conversation's header (docs/plans/hub-click-to-call-rulings.md).
// The server decides everything from the conversation id: who is called, from which
// line, and which staff phone rings first. This component only shows that decision
// and posts the id of the conversation open at the moment of the click.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Phone, AlertTriangle } from 'lucide-react'
import { formatUsPhone } from '@/lib/phone'
import { useWorkspace } from '@/lib/workspace-context'
import {
  IDLE, startPreflight, acceptPreflight, disabledReason, callRequestBody,
  lineStorageKey, readStoredLine, writeStoredLine, initialLine, lineControl,
  type PreState, type Preflight,
} from '@/lib/click-to-call/ui-logic'

// Reading window.localStorage itself can throw (blocked site data), not only its methods.
function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

async function readJson(r: Response): Promise<any> {
  // An expired session is a 307 to /login, which fetch follows to a 200 HTML page.
  if (!(r.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('Your session has expired. Reload the page and sign in again.')
  }
  return r.json()
}

export function ClickToCallButton({ conversationId, contactName, onPlaced }: {
  conversationId: string
  contactName: string
  onPlaced?: () => void
}) {
  const [pre, setPre] = useState<PreState>(IDLE)
  const [open, setOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [lineId, setLineId] = useState<string | null>(null)
  const { user } = useWorkspace()
  const storageKey = lineStorageKey(user?.id)
  const openIdRef = useRef(conversationId)
  openIdRef.current = conversationId

  useEffect(() => {
    const forId = conversationId
    setPre(startPreflight(forId))
    setOpen(false)
    setResult(null)
    const ctl = new AbortController()
    fetch(`/api/comms/click-to-call?conversation_id=${encodeURIComponent(forId)}`, { signal: ctl.signal, cache: 'no-store' })
      .then(async (r) => {
        const j = await readJson(r)
        setPre((s) => acceptPreflight(s, forId, j?.conversation_id ? { data: j as Preflight } : { error: j?.error }))
      })
      .catch((e) => {
        if (ctl.signal.aborted) return
        setPre((s) => acceptPreflight(s, forId, { error: e?.message || 'Click-to-call could not be checked.' }))
      })
    return () => ctl.abort()
  }, [conversationId])

  const reason = disabledReason(pre)
  const d = pre.data

  // Each preflight starts the picker from the remembered line, else the default.
  useEffect(() => {
    setLineId(pre.status === 'ready' ? initialLine(pre.data, readStoredLine(browserStorage(), storageKey)) : null)
  }, [pre, storageKey])

  function chooseLine(id: string) {
    setLineId(id || null)
    if (id) writeStoredLine(browserStorage(), storageKey, id)
  }
  const chosen = d?.lines?.find((l) => l.id === lineId) ?? null

  async function place() {
    const body = callRequestBody(openIdRef.current, pre, lineId)
    if (!body) { setResult({ ok: false, text: 'The open conversation changed. Check the details and try again.' }); return }
    setPlacing(true)
    setResult(null)
    try {
      const r = await fetch('/api/comms/click-to-call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await readJson(r)
      if (r.ok && j?.placed) {
        setResult({ ok: true, text: `Calling your phone now. Answer it and press 1 to be connected to ${d?.contact_name || contactName}.` })
        onPlaced?.()
      } else {
        setResult({ ok: false, text: j?.error || 'The call was not placed.' })
      }
    } catch (e: any) {
      setResult({ ok: false, text: e?.message || 'The call was not placed.' })
    } finally {
      setPlacing(false)
    }
  }

  const title = reason ? `Call ${contactName}: ${reason}` : `Call ${contactName}`
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setResult(null) }}
        aria-disabled={!!reason}
        aria-label={`Call ${contactName}`}
        title={title}
        data-testid="click-to-call"
        className={`p-1 rounded-lg ${reason ? 'text-gray-300 cursor-not-allowed' : 'text-np-blue hover:bg-np-blue/10'}`}
      >
        <Phone size={13} />
      </button>
      {open && reason && (
        <div role="status" data-testid="c2c-reason"
          className="absolute left-0 top-7 z-20 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg text-[11px] text-gray-600">
          <p>{reason}</p>
          {d?.code === 'no_staff_phone' && (
            <Link href="/team" className="mt-1 inline-block text-np-blue underline">Open your team profile</Link>
          )}
        </div>
      )}
      {open && !reason && d?.ok && (
        <div role="dialog" aria-label={`Call ${d.contact_name}`}
          className="absolute left-0 top-7 z-20 w-72 rounded-xl border border-gray-100 bg-white p-3 shadow-lg text-[11px] text-np-dark">
          <p className="font-bold mb-2">Call {d.contact_name}?</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-2">
            <dt className="text-gray-400">Contact</dt>
            <dd data-testid="c2c-contact-phone">{formatUsPhone(d.contact_phone || '')}</dd>
            <dt className="text-gray-400">Call from</dt>
            <dd data-testid="c2c-line">
              {lineControl(d) === 'select' ? (
                <select
                  aria-label="Call from"
                  data-testid="c2c-line-select"
                  value={lineId ?? ''}
                  onChange={(e) => chooseLine(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px]"
                >
                  {!d.default_line_id && d.line && (
                    <option value="">{d.line.label} {formatUsPhone(d.line.e164)} (default)</option>
                  )}
                  {(d.lines ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.label} {formatUsPhone(l.e164)}</option>
                  ))}
                </select>
              ) : (
                <>
                  {(chosen ?? d.line)?.label} {formatUsPhone((chosen ?? d.line)?.e164 || '')}
                  {!chosen && d.line?.is_default && <span className="text-gray-400"> (default line, the conversation has none set)</span>}
                </>
              )}
            </dd>
            <dt className="text-gray-400">Rings first</dt>
            <dd data-testid="c2c-staff-phone">{formatUsPhone(d.staff_phone || '')} (your phone)</dd>
          </dl>
          {d.quiet_hours?.outside && (
            <p className="flex gap-1.5 items-start rounded-lg bg-amber-50 text-amber-800 p-2 mb-2">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>It is {d.quiet_hours.localTime} for {d.contact_name} ({d.quiet_hours.timezone}), outside 8 AM to 8 PM. You can still call.</span>
            </p>
          )}
          {!d.live && <p className="text-[10px] text-gray-400 mb-2">Test mode: only contacts on the test list can be called.</p>}
          <p className="text-[10px] text-gray-400 mb-2">Your phone rings first. Answer and press 1 to connect. Calls are not recorded.</p>
          {result && <p className={`mb-2 ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.text}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2.5 py-1 rounded-lg text-gray-500 hover:bg-gray-50">
              {result?.ok ? 'Close' : 'Cancel'}
            </button>
            {!result?.ok && (
              <button type="button" onClick={place} disabled={placing}
                className="px-2.5 py-1 rounded-lg bg-np-blue text-white font-semibold disabled:opacity-50">
                {placing ? 'Calling...' : 'Call'}
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  )
}
