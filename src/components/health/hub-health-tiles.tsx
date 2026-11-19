'use client'

// Hub Health tiles (Running List q23), shared by the Hub Health page and the one-card summary on the Hub home. Reads
// GET /api/health/hub only (superadmins). Green, amber or red with a one-line reason, needs attention first.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity } from 'lucide-react'

export interface TileView { kind: string; label: string; status: string; reason: string; captured_at: string }

export const DOT: Record<string, string> = { ok: 'bg-green-500', warn: 'bg-amber-400', down: 'bg-red-500', unknown: 'bg-gray-300' }
export const WORD: Record<string, string> = { ok: 'Green', warn: 'Amber', down: 'Red', unknown: 'Unknown' }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** null while loading; 'forbidden' for anyone who is not a superadmin. */
export function useHubHealth(): { tiles: TileView[] | null; state: 'loading' | 'ok' | 'forbidden' | 'error' } {
  const [tiles, setTiles] = useState<TileView[] | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading')
  useEffect(() => {
    let live = true
    fetch('/api/health/hub', { cache: 'no-store' })
      .then(async r => {
        if (!live) return
        if (r.status === 403) return setState('forbidden')
        const d = await r.json().catch(() => ({}))
        if (!r.ok) return setState('error')
        setTiles(d.tiles ?? []); setState('ok')
      })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])
  return { tiles, state }
}

export function TileRow({ t }: { t: TileView }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[t.status] ?? DOT.unknown}`} title={WORD[t.status] ?? t.status} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-np-dark">{t.label} <span className="sr-only">({WORD[t.status] ?? t.status})</span></p>
        <p className="text-[11px] text-gray-500 truncate" title={t.reason}>{t.reason}</p>
      </div>
      <span className="text-[9px] text-gray-400 flex-shrink-0 mt-0.5">{when(t.captured_at)}</span>
    </li>
  )
}

/** The one-card summary on the Hub home. Renders nothing for anyone who is not a superadmin. */
export function HubHealthCard() {
  const { tiles, state } = useHubHealth()
  if (state !== 'ok' || !tiles) return null
  const attention = tiles.filter(t => t.status === 'down' || t.status === 'warn')
  const worst = tiles.some(t => t.status === 'down') ? 'down' : attention.length ? 'warn' : tiles.length ? 'ok' : 'unknown'
  return (
    <div className="bg-white border border-gray-100 rounded-2xl mb-8 overflow-hidden" data-help-section="hub-health-card">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <h2 className="text-sm font-bold text-np-dark flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${DOT[worst]}`} /> Hub Health
        </h2>
        <Link href="/health" className="text-xs font-medium text-np-blue hover:underline">Open Hub Health</Link>
      </div>
      <div className="px-6 py-3">
        {!tiles.length && <p className="text-xs text-gray-400">No capture yet. The first one runs within 30 minutes of the deploy.</p>}
        {tiles.length > 0 && !attention.length && <p className="text-xs text-gray-500">All {tiles.length} tiles are green or waiting for a reading.</p>}
        {attention.length > 0 && (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Needs attention</p>
            <ul className="divide-y divide-gray-50">{attention.slice(0, 4).map(t => <TileRow key={t.kind} t={t} />)}</ul>
            {attention.length > 4 && <p className="text-[11px] text-gray-400">{attention.length - 4} more on the Hub Health page.</p>}
          </>
        )}
      </div>
    </div>
  )
}

export function HubHealthIcon() { return <Activity className="w-5 h-5 text-np-blue" /> }
