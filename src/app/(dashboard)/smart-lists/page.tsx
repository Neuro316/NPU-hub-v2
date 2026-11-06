'use client'

// Smart Lists: saved filters that are always current. Build one with the filter editor and see the
// live count and members; see which campaigns use it; duplicate, archive; point a campaign at it,
// enroll its members, or start a draft broadcast. Nothing here sends: every message still goes
// through the send gate, which limits any text to Texting allowed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListFilter, Plus, Copy, Archive, RotateCcw, Trash2, Save, AlertTriangle, CheckCircle2, Loader2, Send, X } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { FIELDS, type Definition, type FieldDef, type Rule } from '@/lib/marketing/smart-lists/match'

interface Campaign { id: string; name: string; status: string; brand: string; live_enabled: boolean; smart_list_id: string | null }
interface SmartList {
  id: string; name: string; description: string | null; brand: string; definition: Definition; seed_key: string | null
  archived_at: string | null; count: number; email_allowed: number; texting_allowed: number; no_data_source: string[]; campaigns: Campaign[]
}
type Option = string | { value: string; label: string }
type Options = Record<string, Option[]>
interface Preview {
  count: number; email_allowed: number; texting_allowed: number; no_data_source: string[]
  preview: { id: string; name: string; email: string | null; pipeline: string | null; stage: string | null; current_client: boolean; email_allowed: boolean; texting_allowed: boolean }[]
}
interface Draft { id?: string; name: string; description: string; brand: string; definition: Definition }

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, data: await res.json().catch(() => ({})) }
}
const fieldOf = (key: string) => FIELDS.find((f) => f.key === key) as FieldDef
const GROUPS = Array.from(new Set(FIELDS.map((f) => f.group)))
const OP_LABEL: Record<string, string> = { any: 'includes any of', none: 'includes none of', in: 'is one of', is: 'is', lte: 'at most', gte: 'at least', contains: 'contains' }
const optValue = (o: Option) => (typeof o === 'string' ? o : o.value)
const optLabel = (o: Option) => (typeof o === 'string' ? o : o.label)
const inputCls = 'px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white min-w-0'

function newRule(key: string): Rule {
  const f = fieldOf(key)
  const value = f.type === 'bool' ? true : f.type === 'days' ? 30 : f.type === 'text' ? '' : []
  return { field: key, op: f.ops[0], value }
}

function ChoiceValues({ rule, options, onChange }: { rule: Rule; options: Option[]; onChange: (v: string[]) => void }) {
  const chosen = Array.isArray(rule.value) ? (rule.value as string[]) : []
  const rest = options.filter((o) => !chosen.includes(optValue(o)))
  const label = (v: string) => { const o = options.find((x) => optValue(x) === v); return o ? optLabel(o) : v }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {chosen.map((v) => (
        <span key={v} className="flex items-center gap-1 max-w-[220px] px-2 py-0.5 text-[10px] bg-np-blue/10 text-np-dark rounded-full">
          <span className="truncate">{label(v)}</span>
          <button onClick={() => onChange(chosen.filter((x) => x !== v))} aria-label={`Remove ${label(v)}`}><X size={10} /></button>
        </span>
      ))}
      <select value="" onChange={(e) => e.target.value && onChange([...chosen, e.target.value])} className={`${inputCls} max-w-[200px]`}>
        <option value="">Add...</option>
        {rest.map((o) => <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>)}
      </select>
    </div>
  )
}

export default function SmartListsPage() {
  const { currentOrg } = useWorkspace()
  const orgId = currentOrg?.id
  const [lists, setLists] = useState<SmartList[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [options, setOptions] = useState<Options>({})
  const [canEdit, setCanEdit] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [attach, setAttach] = useState('')
  const [broadcast, setBroadcast] = useState<{ name: string; channel: 'email' | 'sms'; subject: string; body: string } | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    const res = await fetch(`/api/marketing/smart-lists?org_id=${encodeURIComponent(orgId)}${showArchived ? '&archived=1' : ''}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setNotice({ ok: false, text: data.error || 'The lists could not be loaded.' }); return }
    setLists(data.lists); setCampaigns(data.campaigns); setOptions(data.options); setCanEdit(data.can_edit)
  }, [orgId, showArchived])
  useEffect(() => { load() }, [load])

  // live count: re-worked out shortly after each change to the filters
  const defKey = draft ? JSON.stringify(draft.definition) : ''
  useEffect(() => {
    if (!draft || !orgId) { setPreview(null); return }
    let stale = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      const { ok, data } = await post('/api/marketing/smart-lists/preview', { org_id: orgId, definition: draft.definition })
      if (stale) return
      setPreviewing(false)
      if (ok) setPreview(data); else setNotice({ ok: false, text: data.error || 'The count could not be worked out.' })
    }, 400)
    return () => { stale = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defKey, orgId, !!draft])

  const open = (l: SmartList) => { setNotice(null); setBroadcast(null); setAttach(''); setDraft({ id: l.id, name: l.name, description: l.description ?? '', brand: l.brand, definition: l.definition }) }
  const current = useMemo(() => lists.find((l) => l.id === draft?.id) ?? null, [lists, draft?.id])

  const setRules = (rules: Rule[]) => draft && setDraft({ ...draft, definition: { ...draft.definition, rules } })
  const setRule = (i: number, patch: Partial<Rule>) => draft && setRules(draft.definition.rules.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  const act = async (url: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setNotice(null)
    const { ok, data } = await post(url, { org_id: orgId, ...body })
    setBusy(false)
    setNotice({ ok, text: ok ? done : data.error || 'That could not be done.' })
    if (ok) await load()
    return { ok, data }
  }
  const save = async () => {
    if (!draft) return
    const { ok, data } = await act('/api/marketing/smart-lists', { action: 'save', ...draft }, 'List saved.')
    if (ok && !draft.id) setDraft({ ...draft, id: data.id })
  }
  const enroll = async (c: Campaign) => {
    setBusy(true); setNotice(null)
    const { ok, data } = await post('/api/marketing/campaigns/enroll-list', { org_id: orgId, campaign_id: c.id })
    setBusy(false)
    setNotice(ok
      ? { ok: data.failed === 0, text: `${data.enrolled} enrolled, ${data.already} already in, ${data.failed} failed. Each message still goes through the send gate.` }
      : { ok: false, text: data.error || 'The list could not be enrolled.' })
  }
  const createBroadcast = async () => {
    if (!broadcast || !draft?.id) return
    const { ok } = await act('/api/marketing/smart-lists/broadcast', { list_id: draft.id, ...broadcast }, 'Draft broadcast created. Review it on the Campaigns page, then set it to Active.')
    if (ok) setBroadcast(null)
  }

  const active = lists.filter((l) => !l.archived_at)
  const archived = lists.filter((l) => l.archived_at)
  const unattached = campaigns.filter((c) => c.smart_list_id !== draft?.id)

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4" data-help-screen="smart-lists">
      <div className="flex items-center gap-2 flex-wrap">
        <ListFilter size={18} className="text-np-blue" />
        <h1 className="text-lg font-semibold text-np-dark">Smart Lists</h1>
        <p className="text-xs text-gray-500 w-full sm:w-auto sm:ml-2">Saved filters that stay current. Any text message is limited to Texting allowed, whichever list is used.</p>
        {canEdit && (
          <button onClick={() => { setNotice(null); setBroadcast(null); setDraft({ name: '', description: '', brand: 'np', definition: { match: 'all', rules: [] } }) }}
            className="sm:ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-np-blue text-white rounded-lg">
            <Plus size={12} /> New list
          </button>
        )}
      </div>

      {notice && (
        <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${notice.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {notice.ok ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}<span>{notice.text}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-1.5 min-w-0">
          {loading && <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading lists</p>}
          {!loading && active.length === 0 && <p className="text-xs text-gray-400">No lists yet.</p>}
          {active.map((l) => (
            <button key={l.id} onClick={() => open(l)}
              className={`w-full text-left p-2.5 rounded-xl border bg-white ${draft?.id === l.id ? 'border-np-blue' : 'border-gray-100 hover:border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs font-semibold text-np-dark truncate">{l.name}</span>
                <span className="text-sm font-semibold text-np-dark">{l.count}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-gray-400">
                <span>{l.email_allowed} email</span><span>{l.texting_allowed} text</span>
                {l.brand === 'wnw' && <span className="text-amber-700">WNW</span>}
                {l.campaigns.length > 0 && <span>{l.campaigns.length} campaign{l.campaigns.length === 1 ? '' : 's'}</span>}
              </div>
              {l.no_data_source.length > 0 && <span className="mt-1 inline-block px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-800 rounded">No data source yet</span>}
            </button>
          ))}
          <button onClick={() => setShowArchived((v) => !v)} className="text-[11px] text-gray-400 hover:text-np-dark">{showArchived ? 'Hide archived' : 'Show archived'}</button>
          {showArchived && archived.map((l) => (
            <div key={l.id} className="px-2.5 py-2 rounded-lg border border-gray-100 flex items-center gap-2 text-[11px] text-gray-500">
              <span className="flex-1 truncate">{l.name}</span>
              {canEdit && <button onClick={() => act('/api/marketing/smart-lists', { action: 'restore', id: l.id }, `${l.name} restored.`)} disabled={busy} className="flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-100 rounded-lg hover:bg-gray-50"><RotateCcw size={10} /> Restore</button>}
            </div>
          ))}
        </div>

        {!draft ? (
          <p className="text-xs text-gray-400 p-6 text-center border border-dashed border-gray-200 rounded-xl">Choose a list to see its filters and members.</p>
        ) : (
          <div className="space-y-4 min-w-0">
            <section className="p-3 rounded-xl border border-gray-100 bg-white space-y-3">
              <div className="flex gap-2 flex-wrap">
                <input value={draft.name} disabled={!canEdit} placeholder="List name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} flex-1 font-semibold min-w-[180px]`} />
                <select value={draft.brand} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className={inputCls} aria-label="Brand">
                  <option value="np">Neuro Progeny</option><option value="wnw">WNW</option>
                </select>
              </div>
              <input value={draft.description} disabled={!canEdit} placeholder="Description (optional)" onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputCls} w-full`} />
              {draft.brand === 'wnw' && <p className="text-[11px] text-amber-800 bg-amber-50 rounded p-2">WNW sends are blocked until a WNW sender is configured.</p>}

              <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
                Match
                <select value={draft.definition.match} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, definition: { ...draft.definition, match: e.target.value as 'all' | 'any' } })} className={inputCls}>
                  <option value="all">all of these</option><option value="any">any of these</option>
                </select>
              </div>

              <div className="space-y-2">
                {draft.definition.rules.map((r, i) => {
                  const f = fieldOf(r.field)
                  if (!f) return <p key={i} className="text-[11px] text-red-700">A filter here uses an unknown field and matches nobody.</p>
                  return (
                    <div key={i} className="p-2 rounded-lg bg-gray-50 flex flex-wrap items-center gap-1.5">
                      <select value={r.field} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, definition: { ...draft.definition, rules: draft.definition.rules.map((x, n) => (n === i ? newRule(e.target.value) : x)) } })} className={`${inputCls} max-w-[210px]`} aria-label="Field">
                        {GROUPS.map((g) => <optgroup key={g} label={g}>{FIELDS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}{x.noDataSource ? ' (no data source yet)' : ''}</option>)}</optgroup>)}
                      </select>
                      {f.ops.length > 1 ? (
                        <select value={r.op} disabled={!canEdit} onChange={(e) => setRule(i, { op: e.target.value as Rule['op'] })} className={inputCls} aria-label="Condition">
                          {f.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                        </select>
                      ) : <span className="text-[11px] text-gray-500">{OP_LABEL[f.ops[0]]}</span>}
                      {f.type === 'bool' && (
                        <select value={r.value ? 'yes' : 'no'} disabled={!canEdit} onChange={(e) => setRule(i, { value: e.target.value === 'yes' })} className={inputCls} aria-label="Value">
                          <option value="yes">Yes</option><option value="no">No</option>
                        </select>
                      )}
                      {f.type === 'days' && <input type="number" min={0} value={Number(r.value)} disabled={!canEdit} onChange={(e) => setRule(i, { value: Number(e.target.value) })} className={`${inputCls} w-20`} aria-label="Days" />}
                      {f.type === 'text' && <input value={String(r.value ?? '')} disabled={!canEdit} onChange={(e) => setRule(i, { value: e.target.value })} className={inputCls} aria-label="Text" />}
                      {(f.type === 'choices' || f.type === 'purchase') && <ChoiceValues rule={r} options={options[r.field] ?? []} onChange={(v) => setRule(i, { value: v })} />}
                      {f.type === 'purchase' && (
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                          from <input type="date" value={r.since ?? ''} disabled={!canEdit} onChange={(e) => setRule(i, { since: e.target.value })} className={inputCls} />
                          to <input type="date" value={r.until ?? ''} disabled={!canEdit} onChange={(e) => setRule(i, { until: e.target.value })} className={inputCls} />
                        </span>
                      )}
                      {canEdit && <button onClick={() => setRules(draft.definition.rules.filter((_, n) => n !== i))} aria-label="Remove filter" className="ml-auto text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>}
                      {f.noDataSource && <p className="w-full text-[10px] text-amber-800">No data source yet. {f.noDataSource} This filter matches nobody until there is one.</p>}
                    </div>
                  )
                })}
                {draft.definition.rules.length === 0 && <p className="text-[11px] text-gray-400">No filters yet. A list with no filters has no members.</p>}
              </div>

              <div className="flex flex-wrap gap-2">
                {canEdit && <button onClick={() => setRules([...draft.definition.rules, newRule('tags')])} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50"><Plus size={11} /> Add filter</button>}
                {canEdit && <button onClick={save} disabled={busy || !draft.name.trim()} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40"><Save size={11} /> Save</button>}
                {canEdit && draft.id && <button onClick={() => act('/api/marketing/smart-lists', { action: 'duplicate', id: draft.id }, 'List duplicated.')} disabled={busy} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50"><Copy size={11} /> Duplicate</button>}
                {canEdit && draft.id && <button onClick={async () => { const { ok } = await act('/api/marketing/smart-lists', { action: 'archive', id: draft.id }, 'List archived.'); if (ok) setDraft(null) }} disabled={busy} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50"><Archive size={11} /> Archive</button>}
              </div>
            </section>

            <section className="p-3 rounded-xl border border-gray-100 bg-white space-y-2">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-2xl font-semibold text-np-dark">{preview ? preview.count : '...'}</span>
                <span className="text-xs text-gray-500">members{previewing ? ', updating' : ''}</span>
                {preview && <span className="text-[11px] text-gray-500">{preview.email_allowed} marketing email allowed, {preview.texting_allowed} texting allowed</span>}
              </div>
              {preview && preview.no_data_source.length > 0 && <p className="text-[11px] text-amber-800 bg-amber-50 rounded p-2">No data source yet. {preview.no_data_source.join(' ')}</p>}
              {preview && preview.preview.length > 0 && (
                <ul className="divide-y divide-gray-50">
                  {preview.preview.map((m) => (
                    <li key={m.id} className="py-1.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                      <span className="font-medium text-np-dark">{m.name}</span>
                      <span className="text-gray-400 truncate max-w-[200px]">{m.email}</span>
                      <span className="text-gray-400 truncate max-w-[200px]">{[m.pipeline, m.stage].filter(Boolean).join(': ')}</span>
                      <span className="sm:ml-auto flex gap-1 text-[10px]">
                        {m.current_client && <span className="px-1.5 bg-green-50 text-green-800 rounded">Client</span>}
                        {m.email_allowed && <span className="px-1.5 bg-gray-100 text-gray-600 rounded">Email</span>}
                        {m.texting_allowed && <span className="px-1.5 bg-gray-100 text-gray-600 rounded">Text</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview && preview.count > preview.preview.length && <p className="text-[10px] text-gray-400">Showing the first {preview.preview.length}.</p>}
            </section>

            {draft.id && current && (
              <section className="p-3 rounded-xl border border-gray-100 bg-white space-y-2">
                <h2 className="text-xs font-semibold text-np-dark">Campaigns using this list</h2>
                {current.campaigns.length === 0 && <p className="text-[11px] text-gray-400">None yet.</p>}
                {current.campaigns.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="flex-1 font-medium text-np-dark truncate min-w-[140px]">{c.name}</span>
                    <span className="text-gray-400">{c.status}{c.live_enabled ? ', live' : ''}</span>
                    {canEdit && <button onClick={() => enroll(c)} disabled={busy || c.status !== 'active'} title={c.status === 'active' ? '' : 'Set the campaign to Active first'} className="px-2 py-1 text-[10px] border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Enroll members</button>}
                    {canEdit && <button onClick={() => act('/api/marketing/campaigns/target', { campaign_id: c.id, smart_list_id: null }, `${c.name} no longer targets this list.`)} disabled={busy} className="px-2 py-1 text-[10px] border border-gray-200 rounded-lg hover:bg-gray-50">Remove</button>}
                  </div>
                ))}
                {canEdit && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <select value={attach} onChange={(e) => setAttach(e.target.value)} className={`${inputCls} flex-1 min-w-[160px]`} aria-label="Campaign">
                      <option value="">Choose a campaign...</option>
                      {unattached.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button onClick={async () => { await act('/api/marketing/campaigns/target', { campaign_id: attach, smart_list_id: draft.id }, 'Campaign now targets this list.'); setAttach('') }} disabled={busy || !attach} className="px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Target this list</button>
                    <button onClick={() => setBroadcast(broadcast ? null : { name: '', channel: 'email', subject: '', body: '' })} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50"><Send size={11} /> New broadcast</button>
                  </div>
                )}
                {broadcast && (
                  <div className="p-2 rounded-lg bg-gray-50 space-y-2">
                    <p className="text-[11px] text-gray-500">Creates a draft one-message campaign on this list. It sends nothing until it is reviewed, set to Active and enrolled.</p>
                    <div className="flex flex-wrap gap-2">
                      <input value={broadcast.name} placeholder="Broadcast name" onChange={(e) => setBroadcast({ ...broadcast, name: e.target.value })} className={`${inputCls} flex-1 min-w-[160px]`} />
                      <select value={broadcast.channel} onChange={(e) => setBroadcast({ ...broadcast, channel: e.target.value as 'email' | 'sms' })} className={inputCls} aria-label="Channel">
                        <option value="email">Email</option><option value="sms">Text message</option>
                      </select>
                    </div>
                    {broadcast.channel === 'email' && <input value={broadcast.subject} placeholder="Subject" onChange={(e) => setBroadcast({ ...broadcast, subject: e.target.value })} className={`${inputCls} w-full`} />}
                    {broadcast.channel === 'sms' && preview && <p className="text-[11px] text-gray-500">Only the {preview.texting_allowed} people here with Texting allowed can receive this.</p>}
                    <textarea value={broadcast.body} rows={4} placeholder="Message" onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} className={`${inputCls} w-full`} />
                    <button onClick={createBroadcast} disabled={busy || !broadcast.name.trim() || !broadcast.body.trim()} className="px-2.5 py-1.5 text-[11px] font-medium bg-np-blue text-white rounded-lg disabled:opacity-40">Create draft</button>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
