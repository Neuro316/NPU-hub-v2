'use client'

// Growth Dashboard (superadmin only), replacing the old Analytics page at the same URL.
// Tiles read hub_metrics_daily through /api/metrics/summary; a tile's records come from
// /api/metrics/records, which runs the same collector, so the two agree. Definitions live
// in docs/metrics/definitions.md. Client outcomes are aggregates: no individual values.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BarChart3, ArrowUpRight, ArrowDownRight, X, BookOpen, Target, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Save, ShieldCheck, ShieldOff, Undo2, Calculator,
} from 'lucide-react'
import { METRICS, METRIC, TABS, type MetricDef, type Tab } from '@/lib/metrics/registry'
import { DEFAULT_THRESHOLDS, targetFor, workBack, type Direction, type Target as TargetT } from '@/lib/metrics/targets'

interface TileValue {
  value: number | null; prev: number | null; n?: number | null; hidden?: boolean
  dims?: Record<string, { value: string; v: number }[]>; target?: number; pace?: number; status?: 'green' | 'amber' | 'red'
  direction?: Direction; through?: string
}
interface Summary { from: string; to: string; prev: { from: string; to: string }; metrics: Record<string, TileValue>; series?: Record<string, { day: string; v: number }[]>; computed_at: string | null }
interface RecordRow { day: string; label: string; sub?: string; href?: string; value?: number; dims?: Record<string, string> }

const DEF_URL = 'https://github.com/Neuro316/NPU-hub-v2/blob/main/docs/metrics/definitions.md'
const STATUS_COLOR = { green: '#16a34a', amber: '#f59e0b', red: '#dc2626' } as const

// ─── dates (New York days) ───────────────────────────────────────────────────
const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
type Preset = 'week' | 'month' | 'last30' | 'last90' | 'custom'
function presetRange(p: Preset, today: string): [string, string] {
  if (p === 'week') { const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); return [shift(today, -((dow + 6) % 7)), today] }
  if (p === 'month') return [`${today.slice(0, 8)}01`, today]
  if (p === 'last90') return [shift(today, -89), today]
  return [shift(today, -29), today]
}
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// ─── formatting ──────────────────────────────────────────────────────────────
function fmt(def: MetricDef, v: number | null | undefined): string {
  if (v == null) return '—'
  switch (def.unit) {
    case 'usd': return `$${Math.round(v).toLocaleString('en-US')}`
    case 'pct': return `${v.toFixed(v < 10 ? 1 : 0)}%`
    case 'minutes': return v >= 120 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`
    case 'days': return `${v.toFixed(v < 10 ? 1 : 0)} d`
    case 'hours': return `${(Math.round(v * 10) / 10).toLocaleString('en-US')} h`
    case 'rating': return v.toFixed(2)
    default: return Math.round(v).toLocaleString('en-US')
  }
}
function delta(t: TileValue): number | null {
  if (t.value == null || t.prev == null || t.prev === 0) return null
  return Math.round(((t.value - t.prev) / Math.abs(t.prev)) * 100)
}

// ─── tile ────────────────────────────────────────────────────────────────────
function Tile({ def, t, onOpen }: { def: MetricDef; t?: TileValue; onOpen: (def: MetricDef) => void }) {
  if (def.agg === 'gap') {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-xl p-4">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{def.label}</p>
        <p className="text-xs text-gray-400 mt-2">No data source yet ({def.gap}).</p>
        <a href={`${DEF_URL}#${def.def}`} target="_blank" rel="noreferrer" className="text-[10px] text-np-blue hover:underline inline-flex items-center gap-1 mt-2"><BookOpen size={10} /> What to collect</a>
      </div>
    )
  }
  const d = t ? delta(t) : null
  const good = d == null ? null : def.lowerIsBetter ? d < 0 : d > 0
  const clickable = !def.noRecords
  const dims = t?.dims ? Object.values(t.dims)[0] ?? [] : []
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{def.label}</p>
        {t?.status && (
          <span title={def.agg === 'sum'
              ? `${fmt(def, t.value)} against ${def.forward ? 'a target' : 'a pace'} of ${fmt(def, t.pace)} (target ${fmt(def, t.target)} for the range; ${t.direction === 'lower' ? 'lower' : 'higher'} is better)`
              : `${fmt(def, t.value)} against a target of ${fmt(def, t.target)} (${t.direction === 'lower' ? 'lower' : 'higher'} is better)`}
            className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: STATUS_COLOR[t.status] }} />
        )}
      </div>
      <button onClick={() => clickable && onOpen(def)} disabled={!clickable}
        className={`text-left mt-1 ${clickable ? 'hover:text-np-blue cursor-pointer' : 'cursor-default'}`}>
        <span className="text-xl font-bold text-np-dark">{t?.hidden ? `n < ${def.minN}` : fmt(def, t?.value)}</span>
      </button>
      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
        {d != null ? (
          <span className={`font-bold flex items-center gap-0.5 ${good ? 'text-green-600' : 'text-red-500'}`}>
            {d > 0 ? <ArrowUpRight className="w-3 h-3" /> : d < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}{Math.abs(d)}%
          </span>
        ) : null}
        <span>prev {t?.hidden ? '—' : fmt(def, t?.prev)}</span>
        {t?.target != null && <span>· target {fmt(def, t.target)}</span>}
        {t?.n != null && !t.hidden && <span>· n {t.n}</span>}
      </div>
      {t?.through && <p className="text-[10px] text-gray-400">sessions through {fmtDay(t.through)}</p>}
      {dims.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {dims.slice(0, 5).map(x => (
            <div key={x.value} className="flex justify-between text-[10px] text-gray-500 gap-2">
              <span className="truncate">{x.value.replace(/_/g, ' ')}</span><span className="text-np-dark">{fmt(def, x.v)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex-1" />
      <a href={`${DEF_URL}#${def.def}`} target="_blank" rel="noreferrer" className="text-[10px] text-gray-400 hover:text-np-blue inline-flex items-center gap-1 mt-2">
        <BookOpen size={10} /> Definition
      </a>
    </div>
  )
}

// ─── records drawer ──────────────────────────────────────────────────────────
function Records({ def, from, to, onClose }: { def: MetricDef; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<{ total: number; records: RecordRow[]; names_only: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/metrics/records?metric=${def.key}&from=${from}&to=${to}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!live) return; if (r.ok) setData(d); else setErr(d.error || 'The records could not be loaded.') })
      .catch(() => live && setErr('The records could not be loaded.'))
    return () => { live = false }
  }, [def.key, from, to])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-np-dark">{def.label}</h3>
            <p className="text-[10px] text-gray-400">{fmtDay(from)} – {fmtDay(to)}{data ? ` · ${data.total} record${data.total === 1 ? '' : 's'}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-np-dark"><X size={16} /></button>
        </div>
        {data?.names_only && <p className="text-[10px] text-gray-400">Names only: client outcomes never show individual values.</p>}
        {err && <p className="text-xs text-red-500">{err}</p>}
        {!data && !err && <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
        {data && data.records.length === 0 && <p className="text-xs text-gray-400">No records in this range.</p>}
        <div className="divide-y divide-gray-50">
          {data?.records.map((r, i) => (
            <div key={i} className="py-2 flex items-start gap-3">
              <span className="text-[10px] text-gray-400 w-12 shrink-0 pt-0.5">{fmtDay(r.day)}</span>
              <div className="flex-1 min-w-0">
                {r.href ? <Link href={r.href} className="text-xs font-medium text-np-dark hover:text-np-blue">{r.label}</Link> : <p className="text-xs font-medium text-np-dark">{r.label}</p>}
                {r.sub && <p className="text-[10px] text-gray-500 truncate">{r.sub}</p>}
              </div>
              {r.value != null && def.unit !== 'count' && <span className="text-[11px] text-np-dark">{fmt(def, r.value)}</span>}
            </div>
          ))}
        </div>
        {data && data.total > data.records.length && <p className="text-[10px] text-gray-400">Showing the latest {data.records.length}.</p>}
      </div>
    </div>
  )
}

// ─── scorecard extras: funnel strip and 12-week trend ────────────────────────
const FUNNEL = ['leads', 'booked_calls', 'shows', 'phase1_sales', 'onboarded']
function Funnel({ m }: { m: Record<string, TileValue> }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-3">Funnel</p>
      <div className="flex items-stretch gap-1 overflow-x-auto">
        {FUNNEL.map((k, i) => {
          const v = m[k]?.value ?? 0, prev = i ? m[FUNNEL[i - 1]]?.value ?? 0 : null
          return (
            <div key={k} className="flex items-center gap-1">
              {i > 0 && <div className="text-[10px] text-gray-400 px-1 text-center">→<br />{prev ? `${Math.round((v / prev) * 100)}%` : '—'}</div>}
              <div className="px-3 py-2 rounded-lg bg-np-blue/5 min-w-[88px]">
                <p className="text-[10px] text-gray-500">{METRIC[k].label}</p>
                <p className="text-sm font-bold text-np-dark">{Math.round(v)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Trend({ series, today }: { series: Summary['series']; today: string }) {
  const weeks = useMemo(() => {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
    const thisMon = shift(today, -((dow + 6) % 7))
    return Array.from({ length: 12 }, (_, i) => shift(thisMon, -7 * (11 - i)))
  }, [today])
  const keys = ['phase1_sales', 'leads', 'booked_calls', 'shows', 'core_revenue']
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 overflow-x-auto">
      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-3">12-week trend (weeks start Monday)</p>
      <table className="text-[10px] w-full">
        <thead><tr><th className="text-left text-gray-400 font-medium pr-3" />{weeks.map(w => <th key={w} className="text-gray-400 font-medium px-1 text-right">{fmtDay(w)}</th>)}</tr></thead>
        <tbody>
          {keys.map(k => {
            const vals = weeks.map(w => (series?.[k] ?? []).filter(p => p.day >= w && p.day <= shift(w, 6)).reduce((n, p) => n + p.v, 0))
            const max = Math.max(...vals, 1)
            return (
              <tr key={k}>
                <td className="text-gray-500 pr-3 py-1 whitespace-nowrap">{METRIC[k].label}</td>
                {vals.map((v, i) => (
                  <td key={i} className="px-1 py-1 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="h-6 w-full flex items-end justify-end"><div className="w-3 bg-np-blue/70 rounded-sm" style={{ height: `${Math.max(2, (v / max) * 24)}px` }} /></div>
                      <span className="text-np-dark">{fmt(METRIC[k], v)}</span>
                    </div>
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── targets editor, work-back helper and test-account review ────────────────
interface TargetRow { metric_key: string; month: string; target_value: number; amber_threshold: number; red_threshold: number; direction: Direction }
interface TargetMetric { key: string; label: string; unit: string; kind: 'total' | 'level'; direction: Direction }
interface Suspect { kind: 'contact' | 'profile'; id: string; name: string; email: string | null; detail: string | null; decision: 'exclude' | 'keep' | null; already: boolean }

const pct = (x: number) => String(Math.round(x * 100))
function draftFor(m: TargetMetric | undefined, month: string, direction?: Direction) {
  const d = direction ?? m?.direction ?? 'higher'
  return { metric_key: m?.key ?? 'leads', month, target_value: '', direction: d, amber: pct(DEFAULT_THRESHOLDS[d].amber), red: pct(DEFAULT_THRESHOLDS[d].red) }
}

/** From the Onboarded target and the live close, show and booking rates (last 90 days): what a month and a week need. */
function WorkBackPanel({ targets, month, onSave, busy }: { targets: TargetRow[]; month: string; onSave: (rows: { metric_key: string; target_value: number }[]) => void; busy: boolean }) {
  const [rates, setRates] = useState<{ close: number | null; show: number | null; booking: number | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const today = useMemo(nyToday, [])
  useEffect(() => {
    fetch(`/api/metrics/summary?from=${shift(today, -89)}&to=${today}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setErr(d.error || 'Live rates could not be loaded.'); return }
        const v = (k: string) => (d.metrics?.[k]?.value == null ? null : Number(d.metrics[k].value) / 100)
        setRates({ close: v('close_rate'), show: v('show_rate'), booking: v('lead_to_booked_rate') })
      }).catch(() => setErr('Live rates could not be loaded.'))
  }, [today])
  const goal = targetFor(targets as TargetT[], 'onboarded', month)
  const plan = rates ? workBack(goal ? Number(goal.target_value) : null, rates.close, rates.show, rates.booking) : null
  const rate = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`)
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-bold text-np-dark flex items-center gap-1"><Calculator size={12} /> Work back from the goal ({month.slice(0, 7)})</h3>
      <p className="text-[10px] text-gray-400">
        Booked calls = Onboarded target ÷ close rate; shows = booked calls × show rate; leads = booked calls ÷ lead to booked rate.
        Live rates are the last 90 days. A week is a month × 12 ÷ 52. Rounded up.
      </p>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      {!rates && !err && <p className="text-[11px] text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading live rates...</p>}
      {rates && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded bg-gray-50">Onboarded target <b className="text-np-dark">{goal ? Math.round(Number(goal.target_value)) : '—'}</b></span>
          <span className="px-2 py-1 rounded bg-gray-50">Close rate <b className="text-np-dark">{rate(rates.close)}</b></span>
          <span className="px-2 py-1 rounded bg-gray-50">Show rate <b className="text-np-dark">{rate(rates.show)}</b></span>
          <span className="px-2 py-1 rounded bg-gray-50">Lead to booked <b className="text-np-dark">{rate(rates.booking)}</b></span>
        </div>
      )}
      {plan && plan.missing.length > 0 && <p className="text-[11px] text-amber-600">Needs {plan.missing.join(', ')} before it can work back.</p>}
      {plan?.month && plan.week && (
        <>
          <table className="text-[11px] w-full max-w-sm">
            <thead><tr className="text-left text-gray-400"><th className="font-medium py-1" /><th className="font-medium text-right">Per month</th><th className="font-medium text-right">Per week</th></tr></thead>
            <tbody>
              {([['leads', 'Leads'], ['booked_calls', 'Booked calls'], ['shows', 'Shows']] as const).map(([k, l]) => (
                <tr key={k} className="border-t border-gray-50"><td className="py-1.5">{l}</td><td className="text-right font-semibold text-np-dark">{plan.month![k]}</td><td className="text-right">{plan.week![k]}</td></tr>
              ))}
            </tbody>
          </table>
          <button disabled={busy} onClick={() => onSave((['leads', 'booked_calls', 'shows'] as const).map(k => ({ metric_key: k, target_value: plan.month![k] })))}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40">
            <Save size={10} /> Save as {month.slice(0, 7)} targets
          </button>
        </>
      )}
    </div>
  )
}

function Targets({ today, onChanged }: { today: string; onChanged: () => void }) {
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [metrics, setMetrics] = useState<TargetMetric[]>([])
  const [draft, setDraft] = useState(() => draftFor(undefined, `${today.slice(0, 8)}01`))
  const [suspects, setSuspects] = useState<Suspect[]>([])
  const [seeded, setSeeded] = useState<{ id: string; rule: string; reason: string | null }[]>([])
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([fetch('/api/metrics/targets', { cache: 'no-store' }), fetch('/api/metrics/review', { cache: 'no-store' })])
    const td = await t.json().catch(() => ({})), rd = await r.json().catch(() => ({}))
    if (t.ok) { setTargets(td.targets); setMetrics(td.metrics) }
    if (r.ok) { setSuspects(rd.suspects); setSeeded(rd.seeded) }
    if (!t.ok || !r.ok) setNotice({ ok: false, text: td.error || rd.error || 'Targets could not be loaded.' })
  }, [])
  useEffect(() => { load() }, [load])

  const send = async (url: string, method: string, body?: unknown, ok = 'Saved.') => {
    setNotice(null)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const d = await res.json().catch(() => ({}))
    setNotice(res.ok ? { ok: true, text: ok } : { ok: false, text: d.error || 'That did not save.' })
    if (res.ok) load()
    return res.ok
  }
  const recompute = async () => {
    setBusy('recompute')
    try { if (await send('/api/metrics/recompute', 'POST', { days: 120 }, 'Recomputed the last 120 days.')) onChanged() } finally { setBusy(null) }
  }
  const label = (k: string) => METRIC[k]?.label ?? k
  const metricOf = (k: string) => metrics.find(m => m.key === k)
  const dm = metricOf(draft.metric_key)
  const saveDraft = () => send('/api/metrics/targets', 'PUT', {
    metric_key: draft.metric_key, month: draft.month, target_value: Number(draft.target_value), direction: draft.direction,
    amber_threshold: Number(draft.amber) / 100, red_threshold: Number(draft.red) / 100,
  }, 'Target saved.').then(ok => { if (ok) onChanged() })
  const saveWorkBack = async (rows: { metric_key: string; target_value: number }[]) => {
    setBusy('workback')
    try {
      const body = { targets: rows.map(r => ({ ...r, month: draft.month, direction: 'higher', amber_threshold: 0.9, red_threshold: 0.75 })) }
      if (await send('/api/metrics/targets', 'PUT', body, `Saved leads, booked calls and shows targets for ${draft.month.slice(0, 7)}.`)) onChanged()
    } finally { setBusy(null) }
  }
  const undecided = suspects.filter(s => !s.decision && !s.already)
  const decided = suspects.filter(s => s.decision)

  return (
    <div className="space-y-5">
      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-np-dark flex items-center gap-1"><Target size={12} /> Monthly targets</h3>
          <button onClick={recompute} disabled={!!busy} className="flex items-center gap-1 px-2.5 py-1 text-[10px] border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            {busy === 'recompute' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Recompute now
          </button>
        </div>
        <p className="text-[10px] text-gray-400">
          A count, money or hours target is a monthly total, prorated by day and compared with the pace so far. A rate, median or level target is compared directly.
          Higher is better: amber below the amber share of the target, red below the red share. Lower is better: amber above the amber share, red above the red share
          (coaching capacity: amber 90%, red above 100%). A month without its own row uses the latest earlier month.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <select value={draft.metric_key} onChange={e => setDraft({ ...draftFor(metricOf(e.target.value), draft.month), target_value: draft.target_value })} className="px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg max-w-[260px]">
            {metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input type="month" value={draft.month.slice(0, 7)} onChange={e => setDraft({ ...draft, month: `${e.target.value}-01` })} className="px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg" />
          <input value={draft.target_value} onChange={e => setDraft({ ...draft, target_value: e.target.value })} inputMode="decimal"
            placeholder={dm?.unit === 'pct' ? 'Target %' : dm?.unit === 'hours' ? 'Hours' : dm?.unit === 'usd' ? 'Target $' : dm?.unit === 'days' ? 'Days' : dm?.unit === 'minutes' ? 'Minutes' : 'Target'}
            className="w-24 px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg" />
          <select value={draft.direction} onChange={e => { const d = e.target.value as Direction; setDraft({ ...draft, direction: d, amber: pct(DEFAULT_THRESHOLDS[d].amber), red: pct(DEFAULT_THRESHOLDS[d].red) }) }} className="px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg">
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
          </select>
          <label className="text-[10px] text-gray-500">Amber {draft.direction === 'lower' ? 'above' : 'below'} % <input value={draft.amber} onChange={e => setDraft({ ...draft, amber: e.target.value })} className="w-12 px-1.5 py-1 border border-gray-100 rounded" /></label>
          <label className="text-[10px] text-gray-500">Red {draft.direction === 'lower' ? 'above' : 'below'} % <input value={draft.red} onChange={e => setDraft({ ...draft, red: e.target.value })} className="w-12 px-1.5 py-1 border border-gray-100 rounded" /></label>
          <button onClick={saveDraft} disabled={draft.target_value === ''} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40">
            <Save size={10} /> Save target
          </button>
        </div>
        {dm && <p className="text-[10px] text-gray-400">{dm.kind === 'total' ? 'Monthly total' : 'Level, compared directly'}{dm.unit === 'pct' ? ', in percent' : dm.unit === 'hours' ? ', in hours' : dm.unit === 'days' ? ', in days' : dm.unit === 'minutes' ? ', in minutes' : ''}.</p>}
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-gray-400"><th className="font-medium py-1">Month</th><th className="font-medium">Metric</th><th className="font-medium text-right">Target</th><th className="font-medium text-right">Better</th><th className="font-medium text-right">Amber</th><th className="font-medium text-right">Red</th><th /></tr></thead>
          <tbody>
            {targets.map(t => (
              <tr key={`${t.metric_key}${t.month}`} className="border-t border-gray-50">
                <td className="py-1.5">{t.month.slice(0, 7)}</td>
                <td>{label(t.metric_key)}</td>
                <td className="text-right">{fmt(METRIC[t.metric_key] ?? METRICS[0], Number(t.target_value))}</td>
                <td className="text-right text-gray-500">{t.direction === 'lower' ? 'lower' : 'higher'}</td>
                <td className="text-right">{t.direction === 'lower' ? '>' : '<'} {Math.round(Number(t.amber_threshold) * 100)}%</td>
                <td className="text-right">{t.direction === 'lower' ? '>' : '<'} {Math.round(Number(t.red_threshold) * 100)}%</td>
                <td className="text-right">
                  {metricOf(t.metric_key) && <button onClick={() => setDraft({ metric_key: t.metric_key, month: t.month, target_value: String(t.target_value), direction: t.direction, amber: pct(Number(t.amber_threshold)), red: pct(Number(t.red_threshold)) })} className="text-[10px] text-np-blue mr-2">Edit</button>}
                  <button onClick={() => send(`/api/metrics/targets?metric_key=${t.metric_key}&month=${t.month}`, 'DELETE', undefined, 'Target removed.').then(ok => { if (ok) onChanged() })} className="text-gray-400 hover:text-red-500"><Trash2 size={11} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <WorkBackPanel targets={targets} month={draft.month} onSave={saveWorkBack} busy={!!busy} />

      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-bold text-np-dark flex items-center gap-1"><ShieldCheck size={12} /> Review test accounts</h3>
        <p className="text-[10px] text-gray-400">
          These look like test accounts by name or email. Nothing here is excluded until you press Exclude. Keep records that the person is real, so it stops being suggested.
          Press Recompute now afterwards to update past days (the nightly run does it too).
        </p>
        <div className="text-[10px] text-gray-500">
          Always excluded: {seeded.map(s => s.rule).join(', ') || 'none'}, contacts in Campaign test contacts, contacts tagged “test”, promo codes CTEST and CTEST2, and programs named “Test”.
        </div>
        {undecided.length === 0 ? <p className="text-[11px] text-gray-400">Nothing waiting for review.</p> : (
          <div className="divide-y divide-gray-50">
            {undecided.map(s => (
              <div key={`${s.kind}${s.id}`} className="py-1.5 flex items-center gap-2 text-[11px]">
                <span className="text-[9px] uppercase text-gray-400 w-12">{s.kind}</span>
                <span className="flex-1 min-w-0 truncate"><span className="text-np-dark">{s.name}</span> <span className="text-gray-400">{s.email}{s.detail ? ` · ${s.detail}` : ''}</span></span>
                <button onClick={() => send('/api/metrics/review', 'POST', { kind: s.kind, id: s.id, decision: 'exclude' }, `${s.name} is excluded from the dashboard.`)} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-red-600 border border-red-100 rounded hover:bg-red-50"><ShieldOff size={10} /> Exclude</button>
                <button onClick={() => send('/api/metrics/review', 'POST', { kind: s.kind, id: s.id, decision: 'keep' }, `${s.name} is kept as a real person.`)} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-green-700 border border-green-100 rounded hover:bg-green-50"><ShieldCheck size={10} /> Keep</button>
              </div>
            ))}
          </div>
        )}
        {decided.length > 0 && (
          <details className="text-[11px]">
            <summary className="text-[10px] text-gray-400 cursor-pointer">Decided ({decided.length})</summary>
            <div className="divide-y divide-gray-50 mt-1">
              {decided.map(s => (
                <div key={`${s.kind}${s.id}`} className="py-1.5 flex items-center gap-2">
                  <span className={`text-[9px] font-bold w-12 ${s.decision === 'exclude' ? 'text-red-500' : 'text-green-600'}`}>{s.decision}</span>
                  <span className="flex-1 min-w-0 truncate">{s.name} <span className="text-gray-400">{s.email}</span></span>
                  <button onClick={() => send(`/api/metrics/review?kind=${s.kind}&id=${s.id}`, 'DELETE', undefined, 'Decision undone.')} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-np-dark"><Undo2 size={10} /> Undo</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────
export default function GrowthDashboardPage() {
  const today = useMemo(nyToday, [])
  const [tab, setTab] = useState<Tab | 'targets'>('scorecard')
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState<[string, string]>(() => presetRange('month', nyToday()))
  const [data, setData] = useState<Summary | null>(null)
  const [trend, setTrend] = useState<Summary | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<MetricDef | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => { if (preset !== 'custom') setRange(presetRange(preset, today)) }, [preset, today])

  useEffect(() => {
    let live = true
    setErr(null)
    fetch(`/api/metrics/summary?from=${range[0]}&to=${range[1]}`, { cache: 'no-store' }).then(async r => {
      if (!live) return
      if (r.status === 403) { setAllowed(false); return }
      const d = await r.json().catch(() => ({}))
      setAllowed(true)
      if (r.ok) setData(d); else setErr(d.error || 'The dashboard could not be loaded.')
    }).catch(() => live && setErr('The dashboard could not be loaded.'))
    return () => { live = false }
  }, [range, reload])

  useEffect(() => {
    if (tab !== 'scorecard' || trend) return
    fetch(`/api/metrics/summary?from=${shift(today, -90)}&to=${today}&series=1`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setTrend(d)).catch(() => {})
  }, [tab, today, trend])

  if (allowed === false) return <div className="p-6 text-sm text-gray-500">The Growth Dashboard is for superadmins.</div>

  const shown = tab === 'targets' ? [] : METRICS.filter(m => m.tab === tab && !m.hidden)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-np-dark flex items-center gap-2"><BarChart3 size={18} /> Growth Dashboard</h1>
          <p className="text-[11px] text-gray-400">
            {fmtDay(range[0])} – {fmtDay(range[1])}, compared with {data ? `${fmtDay(data.prev.from)} – ${fmtDay(data.prev.to)}` : 'the previous period'}.
            Test data excluded. {data?.computed_at ? `Updated ${new Date(data.computed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not computed yet: the first run fills it.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {([['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30'], ['last90', 'Last 90'], ['custom', 'Custom']] as [Preset, string][]).map(([p, l]) => (
            <button key={p} onClick={() => setPreset(p)} className={`px-2.5 py-1 text-[11px] rounded-lg border ${preset === p ? 'bg-np-blue text-white border-np-blue' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={range[0]} max={range[1]} onChange={e => e.target.value && setRange([e.target.value, range[1]])} className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg" />
              <input type="date" value={range[1]} min={range[0]} max={today} onChange={e => e.target.value && setRange([range[0], e.target.value])} className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg" />
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-100">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${tab === t.key ? 'border-np-blue text-np-blue font-semibold' : 'border-transparent text-gray-500 hover:text-np-dark'}`}>{t.label}</button>
        ))}
        <button onClick={() => setTab('targets')} className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px flex items-center gap-1 ${tab === 'targets' ? 'border-np-blue text-np-blue font-semibold' : 'border-transparent text-gray-500 hover:text-np-dark'}`}><Target size={11} /> Targets</button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {tab === 'targets' ? <Targets today={today} onChanged={() => { setReload(n => n + 1); setTrend(null) }} /> : (
        <>
          {tab === 'scorecard' && data && <Funnel m={data.metrics} />}
          {allowed === null && !err ? <p className="text-xs text-gray-400">Loading...</p> : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {shown.map(def => <Tile key={def.key} def={def} t={data?.metrics[def.key]} onOpen={setOpen} />)}
            </div>
          )}
          {tab === 'scorecard' && trend && <Trend series={trend.series} today={today} />}
          {tab === 'outcomes' && <p className="text-[10px] text-gray-400">Aggregates only. A share is hidden when fewer than 5 people qualify, and click-through lists names, never values.</p>}
        </>
      )}
      {open && <Records def={open} from={range[0]} to={data?.metrics[open.key]?.through ?? range[1]} onClose={() => setOpen(null)} />}
    </div>
  )
}
