'use client'

// Settings › Booking routes (superadmin only). One row per University appointment type:
// when someone books that type, the booking sync (every 5 minutes) puts the guest on the
// chosen pipeline stage. Rows live in nr_booking_pipeline_routes, the platform's shared
// "booking link to Hub pipeline" config; the server checks every value.
import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, CheckCircle2, AlertTriangle, Save, Trash2 } from 'lucide-react'

interface ApptType { id: string; name: string; retired: boolean }
interface Pipeline { id: string; name: string; stages: string[] }
interface Route {
  id: string
  appointment_type_id: string
  pipeline_id: string
  pipeline_name: string | null
  stage_name: string
  move_earlier_stages_only: boolean
  create_contact_if_missing: boolean
}
interface Draft { pipeline_id: string; stage_name: string; create_contact_if_missing: boolean; move_earlier_stages_only: boolean }

const EMPTY: Draft = { pipeline_id: '', stage_name: '', create_contact_if_missing: true, move_earlier_stages_only: true }
const fromRoute = (r: Route): Draft => ({
  pipeline_id: r.pipeline_id, stage_name: r.stage_name,
  create_contact_if_missing: r.create_contact_if_missing, move_earlier_stages_only: r.move_earlier_stages_only,
})
const same = (a: Draft, b: Draft) => a.pipeline_id === b.pipeline_id && a.stage_name === b.stage_name
  && a.create_contact_if_missing === b.create_contact_if_missing && a.move_earlier_stages_only === b.move_earlier_stages_only

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-1.5 text-[10px] text-gray-600 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} className="rounded border-gray-300" />
      {label}
    </label>
  )
}

export function BookingRoutesSection({ orgId }: { orgId: string | undefined }) {
  const [types, setTypes] = useState<ApptType[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [routes, setRoutes] = useState<Record<string, Route>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    const res = await fetch(`/api/booking-routes?org_id=${encodeURIComponent(orgId)}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      const byType: Record<string, Route> = {}
      for (const r of data.routes as Route[]) byType[r.appointment_type_id] = r
      setTypes(data.types); setPipelines(data.pipelines); setRoutes(byType)
      const d: Record<string, Draft> = {}
      for (const t of data.types as ApptType[]) d[t.id] = byType[t.id] ? fromRoute(byType[t.id]) : EMPTY
      setDrafts(d)
    } else {
      setNotice({ ok: false, text: data.error || 'Booking routes could not be loaded.' })
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const edit = (typeId: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [typeId]: { ...prev[typeId], ...patch } }))

  const save = async (t: ApptType) => {
    const d = drafts[t.id]
    setBusy(t.id); setNotice(null)
    try {
      const res = await fetch('/api/booking-routes', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, appointment_type_id: t.id, ...d }),
      })
      const data = await res.json().catch(() => ({}))
      setNotice(res.ok ? { ok: true, text: `${t.name} now goes to ${data.route.pipeline_name} › ${data.route.stage_name}.` }
        : { ok: false, text: data.error || 'The route could not be saved.' })
    } finally { setBusy(null); load() }
  }

  const remove = async (t: ApptType) => {
    if (!confirm(`Stop sending ${t.name} bookings to a pipeline? Bookings already synced stay on their contacts.`)) return
    setBusy(t.id); setNotice(null)
    try {
      const res = await fetch(`/api/booking-routes?org_id=${encodeURIComponent(orgId!)}&appointment_type_id=${t.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      setNotice(res.ok ? { ok: true, text: `${t.name} bookings are no longer routed.` } : { ok: false, text: data.error || 'The route could not be removed.' })
    } finally { setBusy(null); load() }
  }

  // retired types are listed only while they still have a route, so it can be removed
  const shown = types.filter(t => !t.retired || routes[t.id])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-np-dark">Booking routes</h3>
        <p className="text-xs text-gray-400 mt-1">
          When someone books one of these University appointment types, they are added to the pipeline stage you pick here,
          with their answers on the contact card. Checked every 5 minutes.
        </p>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading booking routes...</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-gray-400">This organization has no appointment types.</p>
      ) : (
        <div className="space-y-2">
          {shown.map(t => {
            const d = drafts[t.id] ?? EMPTY
            const route = routes[t.id]
            const pipeline = pipelines.find(p => p.id === d.pipeline_id)
            const missing = route && !pipelines.some(p => p.id === route.pipeline_id && p.stages.includes(route.stage_name))
            const dirty = route ? !same(d, fromRoute(route)) : !!(d.pipeline_id && d.stage_name)
            return (
              <div key={t.id} className="px-4 py-3 rounded-lg border border-gray-100 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-[180px] flex-1">
                    <CalendarCheck size={14} className={route ? 'text-np-blue' : 'text-gray-300'} />
                    <span className="text-xs font-semibold text-np-dark">{t.name}</span>
                    {t.retired && <span className="text-[9px] text-gray-400">retired</span>}
                  </div>
                  <select value={d.pipeline_id} disabled={busy === t.id}
                    onChange={e => {
                      const p = pipelines.find(x => x.id === e.target.value)
                      edit(t.id, { pipeline_id: e.target.value, stage_name: p?.stages[0] ?? '' })
                    }}
                    className="px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg bg-white max-w-[220px]">
                    <option value="">No pipeline</option>
                    {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={d.stage_name} disabled={busy === t.id || !pipeline}
                    onChange={e => edit(t.id, { stage_name: e.target.value })}
                    className="px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg bg-white max-w-[220px]">
                    {!pipeline && <option value="">Stage</option>}
                    {pipeline?.stages.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-4 flex-wrap pl-6">
                  <Toggle on={d.create_contact_if_missing} disabled={busy === t.id}
                    onChange={v => edit(t.id, { create_contact_if_missing: v })} label="Create contact if missing" />
                  <Toggle on={d.move_earlier_stages_only} disabled={busy === t.id}
                    onChange={v => edit(t.id, { move_earlier_stages_only: v })} label="Never move a contact backward" />
                  <div className="flex-1" />
                  {route && (
                    <button onClick={() => remove(t)} disabled={busy === t.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-red-600 border border-red-100 rounded-lg hover:bg-red-50 disabled:opacity-40">
                      <Trash2 size={10} /> Remove
                    </button>
                  )}
                  <button onClick={() => save(t)} disabled={busy === t.id || !dirty || !d.pipeline_id || !d.stage_name}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark disabled:opacity-40">
                    <Save size={10} /> Save
                  </button>
                </div>
                {missing && (
                  <p className="text-[10px] text-red-500 pl-6">
                    The saved stage ({route.pipeline_name ?? route.pipeline_id} › {route.stage_name}) no longer exists, so bookings are recorded without moving anyone. Pick a stage and save.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
