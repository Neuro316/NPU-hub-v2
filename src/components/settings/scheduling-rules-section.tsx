'use client'

// Settings › Scheduling Rules: the signed-in user's own availability rules, the source of
// truth for the inbox scheduling agent and the platform booking links. Everything here
// is read and written through /api/scheduling/*, which always acts on the caller's own
// rows; nobody can see or edit another user's rules from this page.
import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Save, CheckCircle2, AlertTriangle, Pencil } from 'lucide-react'

const CATEGORIES = ['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'] as const
const DAY_KINDS = ['school', 'kids_home', 'weekend', 'summer'] as const
const MAIL_CATEGORIES = [
  'scheduling', 'lead', 'participant_support', 'partner_outreach', 'personal', 'legal_financial',
  'clinical', 'vendor_billing', 'security_alert', 'newsletter', 'spam',
]
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_KIND_LABEL: Record<string, string> = { school: 'School days', kids_home: 'Kids-home days', weekend: 'Weekends', summer: 'Summer' }
const label = (s: string) => s.replace(/_/g, ' ')
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

type Any = Record<string, any>
interface Data {
  settings: Any | null
  category_windows: Any[]
  blocked_windows: Any[]
  kids_home_dates: Any[]
  recurring_blocks: Any[]
  recurring_overrides: Any[]
  one_off_blocks: Any[]
  trusted_senders: Any[]
  reply_rules: Any[]
  exception_requests: Any[]
  mailboxes: { id: string; email_address: string; status: string }[]
}

async function api(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(path, {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return { ok: res.ok, data: await res.json().catch(() => ({})) }
}

/** A timestamptz shown as wall-clock time in the owner's zone: "2026-11-05 15:00". */
function wallClock(iso: string, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

const input = 'px-2.5 py-1.5 text-xs border border-gray-100 rounded-lg bg-white'
const btn = 'flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium border border-gray-100 rounded-lg hover:bg-gray-50 disabled:opacity-40'
const primary = 'flex items-center gap-1 px-3 py-1.5 bg-np-blue text-white text-[10px] font-medium rounded-lg hover:bg-np-dark disabled:opacity-40'

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 p-4 space-y-3">
      <div>
        <h4 className="text-xs font-bold text-np-dark">{title}</h4>
        {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Remove({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="Remove" className="text-gray-300 hover:text-red-500"><X size={12} /></button>
}

function CategoryPicker({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-[10px] text-gray-600">
        <input type="checkbox" className="accent-teal w-3 h-3" checked={value === null} onChange={e => onChange(e.target.checked ? null : [])} />
        All categories
      </label>
      {value !== null && CATEGORIES.map(c => (
        <label key={c} className="flex items-center gap-1 text-[10px] text-gray-600">
          <input type="checkbox" className="accent-teal w-3 h-3" checked={value.includes(c)}
            onChange={e => onChange(e.target.checked ? [...value, c] : value.filter(x => x !== c))} />
          {label(c)}
        </label>
      ))}
    </div>
  )
}

export function SchedulingRulesSection() {
  const [data, setData] = useState<Data | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api('/api/scheduling', 'GET')
    if (r.ok) setData(r.data)
    else setNotice({ ok: false, text: r.data.error || 'Your scheduling rules could not be loaded.' })
  }, [])
  useEffect(() => { load() }, [load])

  /** Runs one change, shows the outcome, reloads. Returns whether it worked. */
  const run = async (path: string, method: string, body?: unknown, okText = 'Saved.') => {
    setBusy(true); setNotice(null)
    try {
      const r = await api(path, method, body)
      setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: r.data.error || 'The change could not be saved.' })
      if (r.ok) await load()
      return r.ok
    } finally {
      setBusy(false)
    }
  }
  const create = (resource: string, body: unknown, ok = 'Added.') => run(`/api/scheduling/${resource}`, 'POST', body, ok)
  const patch = (resource: string, body: unknown, ok = 'Saved.') => run(`/api/scheduling/${resource}`, 'PATCH', body, ok)
  const remove = (resource: string, id: string) => run(`/api/scheduling/${resource}?id=${id}`, 'DELETE', undefined, 'Removed.')

  if (!data) {
    return notice ? <p className="text-xs text-red-600">{notice.text}</p> : <p className="text-xs text-gray-400">Loading your rules...</p>
  }
  const tz = data.settings?.timezone || 'America/New_York'

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-np-dark">Scheduling Rules</h3>
        <p className="text-xs text-gray-400 mt-1">
          When people can book you, by meeting type. Booking links and the inbox agent both follow these rules, and only you can see or change them.
          Anything outside the rules is never booked automatically; it waits below as an exception request.
        </p>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {notice.text}
        </div>
      )}

      <TestTime tz={tz} />
      <SettingsCard settings={data.settings} busy={busy} onSave={b => run('/api/scheduling/settings', 'PUT', b)} />
      <WindowsGrid rows={data.category_windows} busy={busy} onAdd={b => create('category-windows', b)} onRemove={id => remove('category-windows', id)} />
      <BlockedWindows rows={data.blocked_windows} busy={busy}
        onAdd={b => create('blocked-windows', b)} onSave={b => patch('blocked-windows', b)} onRemove={id => remove('blocked-windows', id)} />
      <KidsHome rows={data.kids_home_dates} busy={busy} onAdd={b => create('kids-home-dates', b)} onRemove={id => remove('kids-home-dates', id)} />
      <RecurringBlocks blocks={data.recurring_blocks} overrides={data.recurring_overrides} busy={busy}
        onCreate={b => create('recurring-blocks', b)} onSave={b => patch('recurring-blocks', b)} onRemove={id => remove('recurring-blocks', id)}
        onAddOverride={b => create('recurring-overrides', b)} onRemoveOverride={id => remove('recurring-overrides', id)} />
      <OneOffBlocks rows={data.one_off_blocks} tz={tz} busy={busy}
        onAdd={b => create('one-off-blocks', b)} onSave={b => patch('one-off-blocks', b)} onRemove={id => remove('one-off-blocks', id)} />
      <TrustedSenders rows={data.trusted_senders} busy={busy}
        onAdd={b => create('trusted-senders', b)} onSave={b => patch('trusted-senders', b)} onRemove={id => remove('trusted-senders', id)} />
      <ReplyRules rules={data.reply_rules} mailboxes={data.mailboxes} busy={busy}
        onCreate={b => create('reply-rules', b, 'Reply rules added.')} onSave={b => patch('reply-rules', b)} />
      <ExceptionRequests rows={data.exception_requests} tz={tz} busy={busy}
        onDecide={(id, status) => patch('exception-requests', { id, status }, `Request ${status}.`)} />
    </div>
  )
}

// ─── Test a time ─────────────────────────────────────────────────────────────
function TestTime({ tz }: { tz: string }) {
  const [f, setF] = useState({ category: 'one_on_one', date: '', start: '09:00', end: '09:30' })
  const [result, setResult] = useState<{ allowed: boolean; reason: string; explanation: string } | { error: string } | null>(null)
  const test = async () => {
    const r = await api('/api/scheduling/check', 'POST', { category: f.category, starts_at: `${f.date} ${f.start}`, ends_at: `${f.date} ${f.end}` })
    setResult(r.ok ? r.data : { error: r.data.error || 'The check could not run.' })
  }
  return (
    <Card title="Test a time" hint={`Runs the same check the booking links use. Times are in ${tz}.`}>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
          {CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}
        </select>
        <input type="date" className={input} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
        <input type="time" className={input} value={f.start} onChange={e => setF({ ...f, start: e.target.value })} />
        <span className="text-[10px] text-gray-400">to</span>
        <input type="time" className={input} value={f.end} onChange={e => setF({ ...f, end: e.target.value })} />
        <button className={primary} disabled={!f.date} onClick={test}>Test</button>
      </div>
      {result && ('error' in result ? (
        <p className="text-xs text-red-600">{result.error}</p>
      ) : (
        <p className={`text-xs ${result.allowed ? 'text-green-700' : 'text-red-600'}`}>
          {result.allowed ? 'Allowed' : 'Not allowed'} <span className="text-gray-400">({result.reason})</span> {result.allowed ? '' : result.explanation}
        </p>
      ))}
    </Card>
  )
}

// ─── General settings ────────────────────────────────────────────────────────
function SettingsCard({ settings, busy, onSave }: { settings: Any | null; busy: boolean; onSave: (b: Any) => void }) {
  const [f, setF] = useState({
    timezone: settings?.timezone ?? 'America/New_York',
    earliest_start: hhmm(settings?.earliest_start) || '08:00',
    school_year_end: settings?.school_year_end ?? '',
  })
  return (
    <Card title="General" hint="Nothing starts before the earliest start. Weekdays after the school year ends use your Summer windows; with none set, nothing is allowed.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[10px] text-gray-400">Time zone<br />
          <input className={input} value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })} />
        </label>
        <label className="text-[10px] text-gray-400">Earliest start<br />
          <input type="time" className={input} value={f.earliest_start} onChange={e => setF({ ...f, earliest_start: e.target.value })} />
        </label>
        <label className="text-[10px] text-gray-400">School year ends<br />
          <input type="date" className={input} value={f.school_year_end} onChange={e => setF({ ...f, school_year_end: e.target.value })} />
        </label>
        <button className={primary} disabled={busy} onClick={() => onSave({ ...f, school_year_end: f.school_year_end || null })}><Save size={10} /> Save</button>
      </div>
    </Card>
  )
}

// ─── Category windows grid ───────────────────────────────────────────────────
function WindowsGrid({ rows, busy, onAdd, onRemove }: { rows: Any[]; busy: boolean; onAdd: (b: Any) => void; onRemove: (id: string) => void }) {
  const [f, setF] = useState({ category: 'one_on_one', day_kind: 'school', start_time: '08:00', end_time: '11:30' })
  return (
    <Card title="Category windows" hint="A meeting must fit inside one window for its category on that kind of day. Blocks below always win.">
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="py-1 pr-2 font-medium">Category</th>
              {DAY_KINDS.map(k => <th key={k} className="py-1 pr-2 font-medium">{DAY_KIND_LABEL[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(c => (
              <tr key={c} className="border-t border-gray-50 align-top">
                <td className="py-1.5 pr-2 font-semibold text-np-dark">{label(c)}</td>
                {DAY_KINDS.map(k => (
                  <td key={k} className="py-1.5 pr-2">
                    {rows.filter(w => w.category === c && w.day_kind === k).map(w => (
                      <span key={w.id} className="flex items-center gap-1 text-gray-600">
                        {hhmm(w.start_time)}–{hhmm(w.end_time)} <Remove onClick={() => onRemove(w.id)} />
                      </span>
                    ))}
                    {!rows.some(w => w.category === c && w.day_kind === k) && <span className="text-gray-300">none</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
          {CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}
        </select>
        <select className={input} value={f.day_kind} onChange={e => setF({ ...f, day_kind: e.target.value })}>
          {DAY_KINDS.map(k => <option key={k} value={k}>{DAY_KIND_LABEL[k]}</option>)}
        </select>
        <input type="time" className={input} value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
        <input type="time" className={input} value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} />
        <button className={btn} disabled={busy} onClick={() => onAdd(f)}><Plus size={10} /> Add window</button>
      </div>
    </Card>
  )
}

// ─── Daily blocked windows (editor) ──────────────────────────────────────────
// List, add, edit and delete the owner's daily blocks (e.g. Kindergarten pickup). The form
// below the list adds a new block, or saves the one chosen with the pencil.
function BlockedWindows({ rows, busy, onAdd, onSave, onRemove }: {
  rows: Any[]; busy: boolean
  onAdd: (b: Any) => Promise<boolean>; onSave: (b: Any) => Promise<boolean>; onRemove: (id: string) => void
}) {
  const empty: Any = { id: null, day_kind: 'school', start_time: '', end_time: '', label: '', categories: null }
  const [f, setF] = useState<Any>(empty)
  const submit = async () => {
    const body = { day_kind: f.day_kind, start_time: f.start_time, end_time: f.end_time, label: f.label, categories: f.categories }
    if (await (f.id ? onSave({ id: f.id, ...body }) : onAdd(body))) setF(empty)
  }
  return (
    <Card title="Daily blocked windows" hint="Blocked every day of that kind, for all categories or the ones chosen. Blocks win over category windows.">
      {rows.length === 0 && <p className="text-xs text-gray-400">No daily blocks.</p>}
      {rows.map(b => (
        <div key={b.id} className={`flex flex-wrap items-center gap-2 text-xs rounded-lg px-2 py-1 ${f.id === b.id ? 'bg-np-blue/5' : ''}`}>
          <span className="font-semibold text-np-dark">{b.label}</span>
          <span className="text-gray-500">{DAY_KIND_LABEL[b.day_kind]}, {hhmm(b.start_time)}–{hhmm(b.end_time)}</span>
          <span className="text-[10px] text-gray-400">{b.categories ? b.categories.map(label).join(', ') : 'all categories'}</span>
          <button title="Edit" className="text-gray-300 hover:text-np-blue" onClick={() => setF({
            id: b.id, day_kind: b.day_kind, start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), label: b.label, categories: b.categories,
          })}><Pencil size={11} /></button>
          <Remove onClick={() => confirm(`Delete the "${b.label}" block?`) && onRemove(b.id)} />
        </div>
      ))}
      <div className="rounded-lg border border-gray-50 bg-gray-50/40 p-3 space-y-2">
        <p className="text-[10px] font-semibold text-gray-500">{f.id ? `Editing "${rows.find(r => r.id === f.id)?.label ?? ''}"` : 'New daily block'}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-gray-400">Label<br />
            <input className={input} placeholder="Kindergarten pickup" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} />
          </label>
          <label className="text-[10px] text-gray-400">Days<br />
            <select className={input} value={f.day_kind} onChange={e => setF({ ...f, day_kind: e.target.value })}>
              {DAY_KINDS.map(k => <option key={k} value={k}>{DAY_KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-gray-400">From<br />
            <input type="time" className={input} value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          </label>
          <label className="text-[10px] text-gray-400">To<br />
            <input type="time" className={input} value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} />
          </label>
        </div>
        <CategoryPicker value={f.categories} onChange={v => setF({ ...f, categories: v })} />
        <div className="flex items-center gap-2">
          <button className={f.id ? primary : btn} disabled={busy || !f.label.trim() || !f.start_time || !f.end_time} onClick={submit}>
            {f.id ? <><Save size={10} /> Save changes</> : <><Plus size={10} /> Add block</>}
          </button>
          {f.id && <button className={btn} onClick={() => setF(empty)}>Cancel</button>}
        </div>
      </div>
    </Card>
  )
}

// ─── Kids-home dates ─────────────────────────────────────────────────────────
function KidsHome({ rows, busy, onAdd, onRemove }: { rows: Any[]; busy: boolean; onAdd: (b: Any) => void; onRemove: (id: string) => void }) {
  const [source, setSource] = useState('')
  const [f, setF] = useState({ date: '', from_time: '', label: '', source: 'manual' })
  const sources = Array.from(new Set(rows.map(r => r.source as string))).sort()
  const shown = rows.filter(r => !source || r.source === source)
  return (
    <Card title="Kids-home dates" hint="Whole days, or from a time (early release). Category windows for kids-home days apply then.">
      <div className="flex items-center gap-2">
        <select className={input} value={source} onChange={e => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-[10px] text-gray-400">{shown.length} date{shown.length === 1 ? '' : 's'}</span>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {shown.map(r => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <span className="w-24 font-semibold text-np-dark">{r.date}</span>
            <span className="w-24 text-gray-500">{r.from_time ? `from ${hhmm(r.from_time)}` : 'all day'}</span>
            <span className="flex-1 text-gray-500 truncate">{r.label}</span>
            <span className="text-[10px] text-gray-400">{r.source}</span>
            <Remove onClick={() => onRemove(r.id)} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={input} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
        <input type="time" className={input} title="Leave empty for all day" value={f.from_time} onChange={e => setF({ ...f, from_time: e.target.value })} />
        <input className={input} placeholder="Label" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} />
        <input className={input} placeholder="Source" value={f.source} onChange={e => setF({ ...f, source: e.target.value })} />
        <button className={btn} disabled={busy || !f.date} onClick={() => onAdd({ ...f, from_time: f.from_time || null })}><Plus size={10} /> Add date</button>
      </div>
    </Card>
  )
}

// ─── Recurring blocks ────────────────────────────────────────────────────────
function RecurringBlock({ block, overrides, busy, onSave, onRemove, onAddOverride, onRemoveOverride }: {
  block: Any; overrides: Any[]; busy: boolean
  onSave: (b: Any) => void; onRemove: () => void; onAddOverride: (b: Any) => void; onRemoveOverride: (id: string) => void
}) {
  const [f, setF] = useState<Any>({
    name: block.name, active: block.active, anchor_date: block.anchor_date ?? '', interval_weeks: block.interval_weeks,
    weekday: block.weekday, start_time: hhmm(block.start_time), end_time: hhmm(block.end_time), categories: block.categories,
  })
  const [o, setO] = useState({ date: '', kind: 'skip', start_time: '', end_time: '' })
  return (
    <div className="rounded-lg border border-gray-50 bg-gray-50/40 p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-gray-600 pb-2">
          <input type="checkbox" className="accent-teal w-3 h-3" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active
        </label>
        <label className="text-[10px] text-gray-400">Name<br /><input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="text-[10px] text-gray-400">Every<br />
          <select className={input} value={f.interval_weeks} onChange={e => setF({ ...f, interval_weeks: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? 'week' : `${n} weeks`}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-gray-400">On<br />
          <select className={input} value={f.weekday} onChange={e => setF({ ...f, weekday: Number(e.target.value) })}>
            {WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-gray-400">Starting (a {WEEKDAYS[f.weekday]})<br />
          <input type="date" className={input} value={f.anchor_date} onChange={e => setF({ ...f, anchor_date: e.target.value })} />
        </label>
        <label className="text-[10px] text-gray-400">From<br /><input type="time" className={input} value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></label>
        <label className="text-[10px] text-gray-400">To<br /><input type="time" className={input} value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} /></label>
      </div>
      <CategoryPicker value={f.categories} onChange={v => setF({ ...f, categories: v })} />
      <div className="flex items-center gap-2">
        <button className={primary} disabled={busy} onClick={() => onSave({
          id: block.id, ...f, anchor_date: f.anchor_date || null, start_time: f.start_time || null, end_time: f.end_time || null,
        })}><Save size={10} /> Save</button>
        <button className={btn} disabled={busy} onClick={() => confirm(`Delete "${block.name}"?`) && onRemove()}><X size={10} /> Delete</button>
      </div>
      <div className="pt-1 space-y-1">
        <p className="text-[10px] font-semibold text-gray-500">Date changes</p>
        {overrides.map(x => (
          <div key={x.id} className="flex items-center gap-2 text-[11px] text-gray-600">
            <span className="w-24">{x.date}</span>
            <span>{x.kind === 'skip' ? 'skipped' : `${x.kind === 'add' ? 'added' : 'changed'} ${hhmm(x.start_time) || hhmm(block.start_time)}–${hhmm(x.end_time) || hhmm(block.end_time)}`}</span>
            <Remove onClick={() => onRemoveOverride(x.id)} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className={input} value={o.date} onChange={e => setO({ ...o, date: e.target.value })} />
          <select className={input} value={o.kind} onChange={e => setO({ ...o, kind: e.target.value })}>
            <option value="skip">Skip this date</option>
            <option value="add">Add this date</option>
            <option value="change">Change times on this date</option>
          </select>
          {o.kind !== 'skip' && (
            <>
              <input type="time" className={input} value={o.start_time} onChange={e => setO({ ...o, start_time: e.target.value })} />
              <input type="time" className={input} value={o.end_time} onChange={e => setO({ ...o, end_time: e.target.value })} />
            </>
          )}
          <button className={btn} disabled={busy || !o.date} onClick={() => onAddOverride({
            block_id: block.id, date: o.date, kind: o.kind, start_time: o.start_time || null, end_time: o.end_time || null,
          })}><Plus size={10} /> Add</button>
        </div>
      </div>
    </div>
  )
}

function RecurringBlocks({ blocks, overrides, busy, onCreate, onSave, onRemove, onAddOverride, onRemoveOverride }: {
  blocks: Any[]; overrides: Any[]; busy: boolean
  onCreate: (b: Any) => void; onSave: (b: Any) => void; onRemove: (id: string) => void
  onAddOverride: (b: Any) => void; onRemoveOverride: (id: string) => void
}) {
  return (
    <Card title="Recurring blocks" hint="Blocks a time on a weekday every N weeks, counted from the start date. Inactive blocks do nothing.">
      {blocks.map(b => (
        <RecurringBlock key={`${b.id}:${b.active}:${b.anchor_date}:${b.start_time}:${b.end_time}`} block={b} busy={busy}
          overrides={overrides.filter(o => o.block_id === b.id)}
          onSave={onSave} onRemove={() => onRemove(b.id)} onAddOverride={onAddOverride} onRemoveOverride={onRemoveOverride} />
      ))}
      <button className={btn} disabled={busy} onClick={() => onCreate({
        name: 'New block', active: false, anchor_date: null, interval_weeks: 1, weekday: 1, start_time: null, end_time: null, categories: null,
      })}><Plus size={10} /> Add recurring block</button>
    </Card>
  )
}

// ─── One-off blocks ──────────────────────────────────────────────────────────
function OneOffBlocks({ rows, tz, busy, onAdd, onSave, onRemove }: {
  rows: Any[]; tz: string; busy: boolean; onAdd: (b: Any) => Promise<boolean>; onSave: (b: Any) => Promise<boolean>; onRemove: (id: string) => void
}) {
  const empty: Any = { id: null, starts_at: '', ends_at: '', label: '', categories: null }
  const [f, setF] = useState<Any>(empty)
  const submit = async () => {
    const body = { starts_at: f.starts_at, ends_at: f.ends_at, label: f.label, categories: f.categories }
    if (await (f.id ? onSave({ id: f.id, ...body }) : onAdd(body))) setF(empty)
  }
  return (
    <Card title="One-off blocks" hint={`A single blocked stretch of time (${tz}). Later, blocks may also arrive by text or Slack from trusted senders.`}>
      {rows.map(b => (
        <div key={b.id} className="flex items-center gap-2 text-xs">
          <span className="text-np-dark">{wallClock(b.starts_at, tz)} → {wallClock(b.ends_at, tz)}</span>
          <span className="flex-1 text-gray-500 truncate">{b.label}</span>
          <span className="text-[10px] text-gray-400">{b.categories ? b.categories.map(label).join(', ') : 'all'} · {b.source}</span>
          <button title="Edit" className="text-gray-300 hover:text-np-blue" onClick={() => setF({
            id: b.id, starts_at: wallClock(b.starts_at, tz), ends_at: wallClock(b.ends_at, tz), label: b.label, categories: b.categories,
          })}><Pencil size={11} /></button>
          <Remove onClick={() => onRemove(b.id)} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input className={input} placeholder="2026-11-05 15:00" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} />
        <input className={input} placeholder="2026-11-05 16:00" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} />
        <input className={input} placeholder="Label" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} />
        <button className={btn} disabled={busy} onClick={submit}>{f.id ? <><Save size={10} /> Save</> : <><Plus size={10} /> Add block</>}</button>
        {f.id && <button className={btn} onClick={() => setF(empty)}>Cancel</button>}
      </div>
      <CategoryPicker value={f.categories} onChange={v => setF({ ...f, categories: v })} />
    </Card>
  )
}

// ─── Trusted senders ─────────────────────────────────────────────────────────
function TrustedSenders({ rows, busy, onAdd, onSave, onRemove }: {
  rows: Any[]; busy: boolean; onAdd: (b: Any) => Promise<boolean>; onSave: (b: Any) => void; onRemove: (id: string) => void
}) {
  const empty = { display_name: '', channel: 'sms', sender_address: '', permission: 'block_only', active: true }
  const [f, setF] = useState<Any>(empty)
  return (
    <Card title="Trusted senders" hint="People who will be able to add blocks for you by text or Slack in a later phase. Nothing is received yet; moving an existing meeting will always need a confirming reply from your own phone.">
      {rows.map(s => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-np-dark">{s.display_name}</span>
          <span className="text-gray-500">{s.channel === 'sms' ? 'SMS' : 'Slack'} {s.sender_address}</span>
          <select className={input} value={s.permission} disabled={busy} onChange={e => onSave({ id: s.id, permission: e.target.value })}>
            <option value="block_only">Can add blocks</option>
            <option value="block_and_reschedule">Can add blocks and ask to reschedule</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] text-gray-600">
            <input type="checkbox" className="accent-teal w-3 h-3" checked={s.active} disabled={busy} onChange={e => onSave({ id: s.id, active: e.target.checked })} /> Active
          </label>
          <Remove onClick={() => onRemove(s.id)} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input className={input} placeholder="Name" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
        <select className={input} value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>
          <option value="sms">SMS</option>
          <option value="slack">Slack</option>
        </select>
        <input className={input} placeholder={f.channel === 'sms' ? '+1 828 555 0100' : 'Slack member ID (U012AB3CD)'} value={f.sender_address}
          onChange={e => setF({ ...f, sender_address: e.target.value })} />
        <select className={input} value={f.permission} onChange={e => setF({ ...f, permission: e.target.value })}>
          <option value="block_only">Can add blocks</option>
          <option value="block_and_reschedule">Can add blocks and ask to reschedule</option>
        </select>
        <button className={btn} disabled={busy} onClick={async () => { if (await onAdd(f)) setF(empty) }}><Plus size={10} /> Add sender</button>
      </div>
    </Card>
  )
}

// ─── Reply rules ─────────────────────────────────────────────────────────────
function ReplyRule({ rule, email, busy, onSave }: { rule: Any; email: string; busy: boolean; onSave: (b: Any) => void }) {
  const [f, setF] = useState<Any>({ reply_from: rule.reply_from, mode: rule.mode, always_draft_categories: rule.always_draft_categories, voice_note: rule.voice_note })
  return (
    <div className="rounded-lg border border-gray-50 bg-gray-50/40 p-3 space-y-2">
      <p className="text-xs font-semibold text-np-dark">{email}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-gray-400">Reply from<br />
          <input className={input} value={f.reply_from} onChange={e => setF({ ...f, reply_from: e.target.value })} />
        </label>
        <label className="text-[10px] text-gray-400">Mode<br />
          <select className={input} value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}>
            <option value="draft_only">Draft only</option>
          </select>
        </label>
      </div>
      <div>
        <p className="text-[10px] text-gray-400 mb-1">Always draft, never send, for</p>
        <div className="flex flex-wrap gap-2">
          {MAIL_CATEGORIES.map(c => (
            <label key={c} className="flex items-center gap-1 text-[10px] text-gray-600">
              <input type="checkbox" className="accent-teal w-3 h-3" checked={f.always_draft_categories.includes(c)}
                onChange={e => setF({ ...f, always_draft_categories: e.target.checked ? [...f.always_draft_categories, c] : f.always_draft_categories.filter((x: string) => x !== c) })} />
              {label(c)}
            </label>
          ))}
        </div>
      </div>
      <textarea className={`${input} w-full`} rows={3} placeholder="Voice: how replies from this mailbox should sound"
        value={f.voice_note} onChange={e => setF({ ...f, voice_note: e.target.value })} />
      <button className={primary} disabled={busy} onClick={() => onSave({ id: rule.id, ...f })}><Save size={10} /> Save</button>
    </div>
  )
}

function ReplyRules({ rules, mailboxes, busy, onCreate, onSave }: {
  rules: Any[]; mailboxes: Data['mailboxes']; busy: boolean; onCreate: (b: Any) => void; onSave: (b: Any) => void
}) {
  return (
    <Card title="Reply rules" hint="For mailboxes you connected. Sending is not built yet, so every mailbox is draft only.">
      {mailboxes.length === 0 && <p className="text-xs text-gray-400">You have not connected a mailbox.</p>}
      {mailboxes.map(m => {
        const rule = rules.find(r => r.connection_id === m.id)
        return rule
          ? <ReplyRule key={`${rule.id}:${rule.updated_at}`} rule={rule} email={m.email_address} busy={busy} onSave={onSave} />
          : (
            <div key={m.id} className="flex items-center gap-2 text-xs">
              <span className="text-np-dark">{m.email_address}</span>
              <button className={btn} disabled={busy} onClick={() => onCreate({
                connection_id: m.id, reply_from: m.email_address, mode: 'draft_only',
                always_draft_categories: ['personal', 'legal_financial', 'clinical'], voice_note: '',
              })}><Plus size={10} /> Add reply rules</button>
            </div>
          )
      })}
    </Card>
  )
}

// ─── Exception requests ──────────────────────────────────────────────────────
function ExceptionRequests({ rows, tz, busy, onDecide }: { rows: Any[]; tz: string; busy: boolean; onDecide: (id: string, status: string) => void }) {
  return (
    <Card title="Exception requests" hint="Times someone asked for outside your rules. Approving lets the booking go ahead; nothing is booked until you do.">
      {rows.length === 0 && <p className="text-xs text-gray-400">No requests.</p>}
      {rows.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-np-dark">{r.requester_name || r.requester_email || 'Someone'}</span>
          <span className="text-gray-500">{label(r.category)} · {wallClock(r.requested_starts_at, tz)} → {wallClock(r.requested_ends_at, tz).slice(11)}</span>
          {r.check_reason && <span className="text-[10px] text-gray-400">({r.check_reason})</span>}
          {r.note && <span className="text-[10px] text-gray-500 truncate max-w-xs">“{r.note}”</span>}
          {r.status === 'pending' ? (
            <>
              <button className={btn} disabled={busy} onClick={() => onDecide(r.id, 'approved')}>Approve</button>
              <button className={btn} disabled={busy} onClick={() => onDecide(r.id, 'declined')}>Decline</button>
            </>
          ) : <span className="text-[10px] text-gray-400">{r.status}</span>}
        </div>
      ))}
    </Card>
  )
}
