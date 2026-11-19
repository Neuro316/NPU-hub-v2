'use client'

// The Hub bell's health alerts (Running List q23): unacknowledged platform_alerts from both sources, the Hub's and
// the platform's. Reads GET /api/health/alerts and acknowledges with POST /api/health/alerts/[id]/ack, which records
// who acknowledged it and when. Admins and superadmins only; anyone else gets nothing.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

export interface AlertView { id: string; source: string; kind: string; label: string; severity: string; message: string; opened_at: string; resolved_at: string | null }

export function useHealthAlerts() {
  const [alerts, setAlerts] = useState<AlertView[]>([])
  const load = useCallback(() => {
    fetch('/api/health/alerts', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { alerts: [] }))
      .then(d => setAlerts(Array.isArray(d.alerts) ? d.alerts : []))
      .catch(() => setAlerts([]))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => clearInterval(t)
  }, [load])
  const ack = useCallback(async (id: string) => {
    const r = await fetch(`/api/health/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' }).catch(() => null)
    if (r?.ok) setAlerts(a => a.filter(x => x.id !== id))
  }, [])
  return { alerts, ack }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function HealthAlertsSection({ alerts, ack, onNavigate }: { alerts: AlertView[]; ack: (id: string) => void; onNavigate: () => void }) {
  if (!alerts.length) return null
  return (
    <div className="border-b border-gray-100" data-help-section="health-alerts">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Health alerts</p>
        <Link href="/health" onClick={onNavigate} className="text-[10px] text-np-blue hover:underline">Hub Health</Link>
      </div>
      {alerts.map(a => (
        <div key={a.id} className="flex items-start gap-2.5 px-4 py-2">
          <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${a.resolved_at ? 'text-gray-300' : a.severity === 'down' ? 'text-red-500' : 'text-amber-500'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-np-dark">{a.source === 'hub' ? 'Hub' : 'Platform'}: {a.label}{a.resolved_at ? ' (cleared)' : a.severity === 'down' ? ' (red)' : ' (amber)'}</p>
            <p className="text-[10px] text-gray-500 truncate" title={a.message}>{a.message}</p>
            <p className="text-[9px] text-gray-400">{when(a.opened_at)}</p>
          </div>
          <button onClick={() => ack(a.id)} title="Acknowledge" className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-np-blue flex-shrink-0">
            <CheckCircle2 size={12} /> Acknowledge
          </button>
        </div>
      ))}
    </div>
  )
}
