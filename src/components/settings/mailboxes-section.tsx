'use client'

// Settings › Mailboxes (superadmin only). Gmail mailboxes connected through Google
// OAuth for the inbox agent. The server decides what is listed: a private mailbox is
// returned only to the person who connected it, and to the teammates they listed in
// Also visible to (hub_249). Only the owner sees, and can change, that list.
import { useCallback, useEffect, useState } from 'react'
import { Mail, Plus, RefreshCw, Unplug, Lock, Users, CheckCircle2, AlertTriangle, Eye, X } from 'lucide-react'

interface Connection {
  id: string
  email_address: string
  visibility: 'private' | 'shared'
  status: 'active' | 'revoked' | 'error'
  connected_at: string
  last_checked_at: string | null
  last_error: string | null
  is_owner: boolean
  /** owner only: who else sees this mailbox exactly as the owner does, and the staff who could be added */
  also_visible_to?: Array<{ user_id: string; name: string }>
  can_list?: Array<{ user_id: string; name: string }>
}

const OUTCOMES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Mailbox connected.' },
  denied: { ok: false, text: 'Google access was not granted.' },
  wrong_domain: { ok: false, text: 'Only @neuroprogeny.com Google accounts can be connected.' },
  missing_scope: { ok: false, text: 'Gmail read and send access were not both granted. Connect again and allow both.' },
  no_refresh_token: { ok: false, text: 'Google did not return offline access. Connect again.' },
  owned_by_other: { ok: false, text: 'Someone else has already connected that mailbox.' },
  bad_state: { ok: false, text: 'The connection request expired or did not start here. Try again.' },
  not_configured: { ok: false, text: 'Gmail connections are not configured on this deployment.' },
  forbidden: { ok: false, text: 'Only a superadmin can connect a mailbox.' },
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never')

export function MailboxesSection({ orgId }: { orgId: string | undefined }) {
  const [rows, setRows] = useState<Connection[]>([])
  const [alsoReady, setAlsoReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/mail/connections', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) { setRows(data.connections ?? []); setAlsoReady(!!data.also_ready) }
    else setNotice({ ok: false, text: data.error || 'Mailboxes could not be loaded.' })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const outcome = new URLSearchParams(window.location.search).get('mail')
    if (outcome) {
      setNotice(OUTCOMES[outcome] ?? { ok: false, text: 'The mailbox could not be connected. Try again.' })
      window.history.replaceState(null, '', '/settings?section=mailboxes')
    }
  }, [load])

  const call = async (id: string, path: string, init: RequestInit, done: (data: any) => string) => {
    setBusy(id); setNotice(null)
    try {
      const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
      const data = await res.json().catch(() => ({}))
      setNotice(res.ok ? { ok: true, text: done(data) } : { ok: false, text: data.error || 'The request failed.' })
    } finally {
      setBusy(null)
      load()
    }
  }

  const check = (c: Connection) => call(c.id, '/api/mail/check', { method: 'POST', body: JSON.stringify({ id: c.id }) },
    d => `${d.emailAddress} is reachable (${Number(d.messagesTotal).toLocaleString()} messages).`)
  const disconnect = (c: Connection) => confirm(`Disconnect ${c.email_address} and revoke the Hub's access at Google?`) && call(c.id, '/api/mail/disconnect', { method: 'POST', body: JSON.stringify({ id: c.id }) },
    () => `${c.email_address} disconnected and access revoked at Google.`)
  const setVisibility = (c: Connection, visibility: Connection['visibility']) => call(c.id, '/api/mail/connections',
    { method: 'PATCH', body: JSON.stringify({ id: c.id, visibility }) }, () => `${c.email_address} is now ${visibility}.`)
  const addViewer = (c: Connection, p: { user_id: string; name: string }) => call(c.id, '/api/mail/connections',
    { method: 'PATCH', body: JSON.stringify({ id: c.id, add_viewer: p.user_id }) }, () => `${p.name} now sees ${c.email_address} as you do.`)
  const removeViewer = (c: Connection, p: { user_id: string; name: string }) => call(c.id, '/api/mail/connections',
    { method: 'PATCH', body: JSON.stringify({ id: c.id, remove_viewer: p.user_id }) }, () => `${p.name} no longer sees ${c.email_address}.`)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-np-dark">Mailboxes</h3>
          <p className="text-xs text-gray-400 mt-1">
            Gmail accounts connected for the inbox agent. Private mailboxes are visible only to the person who connected them, and to anyone they add under Also visible to.
          </p>
        </div>
        <button
          onClick={() => { if (orgId) window.location.href = `/api/mail/connect?orgId=${encodeURIComponent(orgId)}` }}
          disabled={!orgId}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors flex-shrink-0">
          <Plus size={12} /> Connect Gmail
        </button>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading mailboxes...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">No mailboxes connected yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(c => (
            <div key={c.id} className="px-4 py-3 rounded-lg border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Mail size={16} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-np-dark truncate">{c.email_address}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    <span className={c.status === 'active' ? 'text-green-600' : c.status === 'error' ? 'text-red-500' : 'text-gray-400'}>
                      {c.status}
                    </span>
                    {' · '}last checked {fmt(c.last_checked_at)}
                  </p>
                </div>
                {c.is_owner ? (
                  <select value={c.visibility} disabled={busy === c.id || c.status === 'revoked'}
                    onChange={e => setVisibility(c, e.target.value as Connection['visibility'])}
                    className="px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-white">
                    <option value="private">Private</option>
                    <option value="shared">Shared</option>
                  </select>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    {c.visibility === 'shared' ? <Users size={10} /> : <Lock size={10} />} {c.visibility}
                  </span>
                )}
                {c.status !== 'revoked' && (
                  <>
                    <button onClick={() => check(c)} disabled={busy === c.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                      <RefreshCw size={10} className={busy === c.id ? 'animate-spin' : ''} /> Check
                    </button>
                    <button onClick={() => disconnect(c)} disabled={busy === c.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-red-600 border border-red-100 rounded-lg hover:bg-red-50 disabled:opacity-40">
                      <Unplug size={10} /> Disconnect
                    </button>
                  </>
                )}
              </div>
              {c.is_owner && alsoReady && c.also_visible_to && (
                <div className="mt-2 pl-11 flex items-center gap-1.5 flex-wrap">
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-500"><Eye size={10} /> Also visible to</span>
                  {c.also_visible_to.length === 0 && <span className="text-[10px] text-gray-400">nobody else</span>}
                  {c.also_visible_to.map(p => (
                    <span key={p.user_id} className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-np-light text-np-dark">
                      {p.name}
                      <button onClick={() => removeViewer(c, p)} disabled={busy === c.id} aria-label={`Remove ${p.name}`} className="text-gray-400 hover:text-red-500 disabled:opacity-40"><X size={10} /></button>
                    </span>
                  ))}
                  {(c.can_list?.length ?? 0) > 0 && (
                    <select value="" disabled={busy === c.id}
                      onChange={e => { const p = c.can_list?.find(x => x.user_id === e.target.value); if (p) addViewer(c, p) }}
                      className="px-2 py-0.5 text-[10px] border border-gray-100 rounded-lg bg-white">
                      <option value="">Add a teammate...</option>
                      {c.can_list?.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                    </select>
                  )}
                  <span className="w-full text-[10px] text-gray-400">They see this mailbox exactly as you do, private mail included. Only you can change this list.</span>
                </div>
              )}
              {c.last_error && c.status !== 'revoked' && (
                <p className="text-[10px] text-red-500 mt-2 pl-11">{c.last_error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
