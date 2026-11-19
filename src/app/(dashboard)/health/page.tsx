'use client'

// Hub › Hub Health (Running List q23, the Hub half of Platform Health). Superadmins only: the route refuses everyone
// else. Each tile is green, amber or red with a one-line reason, needs attention first. A capture runs every 30 minutes
// (/api/cron/hub-health); unknown means the tile's source could not be read (for example, a token that is not set).
import { HubHealthIcon, TileRow, useHubHealth } from '@/components/health/hub-health-tiles'

export default function HubHealthPage() {
  const { tiles, state } = useHubHealth()
  const attention = (tiles ?? []).filter(t => t.status === 'down' || t.status === 'warn')
  const rest = (tiles ?? []).filter(t => t.status !== 'down' && t.status !== 'warn')
  return (
    <div className="max-w-3xl space-y-4" data-help-section="hub-health">
      <h1 className="text-lg font-semibold text-np-dark flex items-center gap-2"><HubHealthIcon /> Hub Health</h1>
      {state === 'loading' && <p className="text-sm text-gray-400">Loading...</p>}
      {state === 'forbidden' && <p className="text-sm text-gray-500">Hub Health is for superadmins.</p>}
      {state === 'error' && <p className="text-sm text-red-500">Hub Health could not be loaded. Try again in a minute.</p>}
      {state === 'ok' && tiles && !tiles.length && <p className="text-sm text-gray-500">No capture yet. The first one runs within 30 minutes of the deploy.</p>}
      {attention.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-2xl px-5 py-3">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Needs attention</h2>
          <ul className="divide-y divide-gray-50">{attention.map(t => <TileRow key={t.kind} t={t} />)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-2xl px-5 py-3">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{attention.length ? 'Everything else' : 'All tiles'}</h2>
          <ul className="divide-y divide-gray-50">{rest.map(t => <TileRow key={t.kind} t={t} />)}</ul>
        </section>
      )}
      <p className="text-[11px] text-gray-400">Captured every 30 minutes. A change of colour opens or clears an alert in the bell; a change to red also texts the owner when notifications are live.</p>
    </div>
  )
}
