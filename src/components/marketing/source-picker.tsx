'use client'
// Starts from: friendly choices that produce the existing source keys, plus an
// "advanced: type a key" fallback. The key is shown small, for anyone who needs it.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { SOURCE_KINDS, sourceKeyFor, kindGroup, sourceGapText, type SourceKind, type SourceStatus } from '@/lib/marketing/ui-logic'
import type { FormDef, Pipeline, Stage } from './types'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'

export function SourcePicker({ forms, pipelines, stages, taken, onAdd, sources }: {
  forms: FormDef[]; pipelines: Pipeline[]; stages: Stage[]; taken: string[]; onAdd: (key: string) => void; sources?: SourceStatus
}) {
  const [kind, setKind] = useState<SourceKind>('form')
  const [detail, setDetail] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [raw, setRaw] = useState('')
  const spec = SOURCE_KINDS.find((s) => s.kind === kind)!
  const key = sourceKeyFor(kind, detail)
  const rawOk = /^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(raw.trim())
  const add = (k: string) => { onAdd(k); setDetail(''); setRaw('') }

  return (
    <div className="space-y-2 rounded-lg border border-gray-100 bg-np-light/60 p-3">
      <div className="grid gap-2 md:grid-cols-2">
        <div><label className="mb-1 block text-[11px] font-medium text-gray-500" htmlFor="sp-kind">A person enters when</label>
          <select id="sp-kind" className={input} value={kind} onChange={(e) => { setKind(e.target.value as SourceKind); setDetail('') }}>
            {SOURCE_KINDS.map((s) => <option key={s.kind} value={s.kind}>{s.label}{sources ? (sources[kindGroup(s.kind)]?.connected ? ' (connected)' : ' (not connected yet)') : ''}</option>)}
          </select></div>
        {spec.needs === 'form' && <div><label className="mb-1 block text-[11px] font-medium text-gray-500" htmlFor="sp-form">Which form</label>
          {forms.length ? <select id="sp-form" className={input} value={detail} onChange={(e) => setDetail(e.target.value)}>
            <option value="">Choose a form</option>{forms.map((f) => <option key={f.id} value={f.source_key}>{f.name}{f.status !== 'published' ? ' (not published yet)' : ''}</option>)}
          </select> : <p className="text-xs text-gray-500">You have no forms yet. Build one in <a className="text-np-blue underline" href="/forms">Forms and Pages</a>, then come back and choose it here.</p>}</div>}
        {spec.needs === 'text' && <div><label className="mb-1 block text-[11px] font-medium text-gray-500" htmlFor="sp-text">{spec.ask}</label>
          <input id="sp-text" className={input} value={detail} onChange={(e) => setDetail(e.target.value)} /></div>}
        {spec.needs === 'stage' && <div><label className="mb-1 block text-[11px] font-medium text-gray-500" htmlFor="sp-stage">Which stage</label>
          <select id="sp-stage" className={input} value={detail} onChange={(e) => setDetail(e.target.value)}>
            <option value="">Choose a stage</option>
            {pipelines.filter((p) => !p.archived_at).map((p) => <optgroup key={p.id} label={p.name}>
              {stages.filter((s) => s.pipeline_id === p.id && !s.archived_at).sort((a, b) => a.position - b.position).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>)}
          </select></div>}
      </div>
      {key && sources && sourceGapText(key, sources) && <p className="text-[11px] text-gold">Not connected yet: {sourceGapText(key, sources)} It will not start the campaign until that changes.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!key || taken.includes(key)} onClick={() => key && add(key)}
          className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-40"><Plus className="h-3.5 w-3.5" aria-hidden />Add this</button>
        {key && <span className="font-mono text-[10px] text-gray-400">{taken.includes(key) ? 'Already added' : key}</span>}
        <span className="flex-1" />
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)} className="text-[11px] text-gray-500 underline">Advanced: type a key</button>
      </div>
      {advanced && <div className="flex gap-2">
        <input className={`${input} font-mono`} aria-label="Source key" placeholder="form:webinar-signup" value={raw} onChange={(e) => setRaw(e.target.value.toLowerCase())} />
        <button type="button" disabled={!rawOk || taken.includes(raw.trim())} onClick={() => add(raw.trim())} className="rounded-lg border border-gray-200 px-3 text-xs font-medium hover:bg-white disabled:opacity-40">Add</button>
      </div>}
    </div>
  )
}
