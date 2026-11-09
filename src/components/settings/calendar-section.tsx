'use client'

// Settings › Mailboxes › Calendars. The calendars each of YOUR connected mailboxes can see (read-only access,
// scheduling agent phase 3), with an Include/Exclude switch. "Connect calendar" reconnects that mailbox at
// Google with the two read-only calendar scopes added. Excluded calendars are not cached and never appear in
// the morning brief.
import { useCallback, useEffect, useState } from 'react'
import { Calendar, CalendarCheck, CheckCircle2, AlertTriangle, Link2 } from 'lucide-react'

interface Conn { id: string; email_address: string; status: string; has_calendar: boolean }
interface Cal {
  id: string
  connection_id: string
  summary: string | null
  access_role: string | null
  is_primary: boolean
  excluded: boolean
  last_synced_at: string | null
  sync_error: string | null
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Not yet')

export function CalendarSection() {
  const [conns, setConns] = useState<Conn[]>([])
  const [cals, setCals] = useState<Cal[]>([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/calendar/calendars', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setConns(data.connections ?? [])
      setCals(data.calendars ?? [])
      setMissing(!!data.tables_missing)
    } else setNotice({ ok: false, text: data.error || 'Calendars could not be loaded.' })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (c: Cal) => {
    setBusy(c.id); setNotice(null)
    try {
      const res = await fetch('/api/calendar/calendars', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, excluded: !c.excluded }),
      })
      const data = await res.json().catch(() => ({}))
      setNotice(res.ok
        ? { ok: true, text: `${c.summary || 'Calendar'} ${data.excluded ? 'excluded' : 'included'}.` }
        : { ok: false, text: data.error || 'The calendar could not be updated.' })
    } finally {
      setBusy(null)
      load()
    }
  }

  const live = conns.filter(c => c.status === 'active' || c.status === 'error')

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-np-dark">Calendars</h3>
        <p className="text-xs text-gray-400 mt-1">
          Read-only calendar access for the morning brief. Only start, end, title and attendee emails are kept, for 14 days ahead.
          Exclude any calendar you do not want read.
        </p>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}

      {missing && (
        <p className="text-xs text-amber-600">Calendar sync is not switched on yet. Connecting now is fine; calendars appear once it is.</p>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading calendars...</p>
      ) : live.length === 0 ? (
        <p className="text-xs text-gray-400">Connect a mailbox first. Only mailboxes you connected are listed here.</p>
      ) : (
        <div className="space-y-3">
          {live.map(m => {
            const mine = cals.filter(c => c.connection_id === m.id)
            return (
              <div key={m.id} className="px-4 py-3 rounded-lg border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    {m.has_calendar ? <CalendarCheck size={16} className="text-gray-500" /> : <Calendar size={16} className="text-gray-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-np-dark truncate">{m.email_address}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {m.has_calendar ? <span className="text-green-600">calendar connected</span> : 'calendar not connected'}
                    </p>
                  </div>
                  <button
                    onClick={() => { window.location.href = `/api/mail/connect-calendar?connection_id=${encodeURIComponent(m.id)}` }}
                    className={m.has_calendar
                      ? 'flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50'
                      : 'flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors flex-shrink-0'}>
                    <Link2 size={m.has_calendar ? 10 : 12} /> {m.has_calendar ? 'Reconnect calendar' : 'Connect calendar'}
                  </button>
                </div>
                {m.has_calendar && mine.length === 0 && !missing && (
                  <p className="text-[10px] text-gray-400 mt-2 pl-11">Calendars appear after the next sync (every 15 minutes).</p>
                )}
                {mine.length > 0 && (
                  <div className="mt-2 pl-11 space-y-1">
                    {mine.map(c => (
                      <div key={c.id} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] truncate ${c.excluded ? 'text-gray-400 line-through' : 'text-np-dark'}`}>
                            {c.summary || 'Untitled calendar'}{c.is_primary ? ' (primary)' : ''}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {c.access_role ?? 'reader'} · synced {fmt(c.last_synced_at)}
                            {c.sync_error && <span className="text-red-500"> · {c.sync_error}</span>}
                          </p>
                        </div>
                        <button onClick={() => toggle(c)} disabled={busy === c.id}
                          className={`px-2.5 py-1 text-[10px] font-medium border rounded-lg disabled:opacity-40 ${c.excluded
                            ? 'border-gray-100 hover:bg-gray-50 text-gray-600'
                            : 'border-red-100 text-red-600 hover:bg-red-50'}`}>
                          {c.excluded ? 'Include' : 'Exclude'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
