'use client'

// Lead Devices (Hub Marketing). Upload a self-contained HTML file or set up a form, review what was created around
// it, approve versions, work through the readiness checklist, and switch it live. Every action is checked again on
// the server: hiding a button here is not the guard.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Copy, Loader2, Sparkles, Upload } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { BRANDS, TYPES } from '@/lib/lead-devices/manifest'
import { readManifestBlock } from '@/lib/lead-devices/inspect'

const SLUG_HINT = 'lower-case-with-hyphens'
const input = 'w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30'
const button = 'px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50'
const primary = 'px-3 py-1.5 text-[11px] font-medium rounded-lg bg-np-blue text-white hover:opacity-90 disabled:opacity-50'

interface FormState {
  name: string; slug: string; brand: string; type: string; description: string
  outcomes: string; questions: string; result_consent_text: string; email_consent_text: string; sms_consent_text: string
  asset_url: string; hot_outcomes: string; script_allowlist: string; embed_origins: string; pipeline_id: string
}
const EMPTY: FormState = { name: '', slug: '', brand: 'neuro_progeny', type: 'quiz', description: '', outcomes: '', questions: '', result_consent_text: '', email_consent_text: '', sms_consent_text: '', asset_url: '', hot_outcomes: '', script_allowlist: '', embed_origins: '', pipeline_id: '' }

// "key | label" per line
const toPairs = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [k, ...r] = l.split('|'); return { key: k.trim(), label: r.join('|').trim() || k.trim() } })
const fromPairs = (a: unknown) => (Array.isArray(a) ? a.map((p: any) => `${p?.key ?? ''} | ${p?.label ?? ''}`).join('\n') : '')
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
const fromLines = (a: unknown) => (Array.isArray(a) ? a.join('\n') : '')

function toManifest(f: FormState) {
  return {
    description: f.description, outcomes: toPairs(f.outcomes), questions: toPairs(f.questions),
    result_consent_text: f.result_consent_text, email_consent_text: f.email_consent_text, sms_consent_text: f.sms_consent_text,
    asset_url: f.asset_url, hot_lead_rule: { outcomes: lines(f.hot_outcomes) }, script_allowlist: lines(f.script_allowlist), embed_origins: lines(f.embed_origins),
  }
}

function prefill(prev: FormState, m: Record<string, any>): FormState {
  return {
    ...prev,
    name: m.name ?? prev.name, slug: m.slug ?? prev.slug, brand: m.brand ?? prev.brand, type: m.type ?? prev.type,
    description: m.description ?? prev.description, outcomes: fromPairs(m.outcomes) || prev.outcomes, questions: fromPairs(m.questions) || prev.questions,
    result_consent_text: m.result_consent_text ?? prev.result_consent_text, email_consent_text: m.email_consent_text ?? prev.email_consent_text, sms_consent_text: m.sms_consent_text ?? prev.sms_consent_text,
    asset_url: m.asset_url ?? prev.asset_url, hot_outcomes: fromLines(m.hot_lead_rule?.outcomes) || prev.hot_outcomes,
    script_allowlist: fromLines(m.script_allowlist) || prev.script_allowlist, embed_origins: fromLines(m.embed_origins) || prev.embed_origins,
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-gray-600">{label}{hint && <span className="ml-1 font-normal text-gray-400">{hint}</span>}<div className="mt-1">{children}</div></label>
}
function Check({ done, label }: { done: boolean; label: string }) {
  return <p className="flex items-center gap-1.5 text-xs">{done ? <CheckCircle2 size={13} className="text-teal-600" /> : <Circle size={13} className="text-gray-300" />}{label}</p>
}
function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <code className="flex-1 text-[10px] bg-gray-50 rounded px-1.5 py-1 break-all">{value}</code>
      <button type="button" className="p-1 text-gray-400 hover:text-np-blue" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(value)}><Copy size={12} /></button>
    </div>
  )
}

export default function LeadDevicesPage() {
  const { currentOrg } = useWorkspace()
  const org = currentOrg?.id
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [formOnly, setFormOnly] = useState(false)
  const [note, setNote] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [subs, setSubs] = useState<Record<string, any[] | 'loading' | 'error'>>({})

  const load = useCallback(async () => {
    if (!org) return
    const r = await fetch(`/api/marketing/lead-devices?org_id=${org}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || 'The devices could not be loaded.'); return }
    setError(''); setData(j)
  }, [org])
  useEffect(() => { load() }, [load])

  const loadSubs = async (id: string) => {
    setSubs((p) => ({ ...p, [id]: 'loading' }))
    const r = await fetch(`/api/marketing/lead-devices?org_id=${org}&device_id=${id}`)
    const j = await r.json().catch(() => ({}))
    setSubs((p) => ({ ...p, [id]: r.ok ? (j.submissions ?? []) : 'error' }))
  }

  const retry = async (deviceId: string, submissionId: string) => {
    const j = await act(deviceId, 'retry_submission', { submission_id: submissionId })
    if (j) await loadSubs(deviceId)
  }

  const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${id}:${action}`); setError('')
    const r = await fetch('/api/marketing/lead-devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: org, id, action, ...extra }) })
    const j = await r.json().catch(() => ({}))
    setBusy('')
    if (!r.ok) { setError(j.error || 'That did not work. Try again.'); return null }
    await load()
    return j
  }

  const chooseFile = async (f: File | null) => {
    setFile(f); setNote('')
    if (!f) return
    if (f.size > 2 * 1024 * 1024) { setNote('That file is over the 2 MB limit.'); return }
    const m = readManifestBlock(await f.text())
    if (m) { setForm((p) => prefill(p, m as Record<string, any>)); setNote('Filled in from the np-device block in this file. Check it before saving.') }
  }

  const create = async () => {
    setBusy('create'); setError('')
    let r: Response
    if (formOnly) {
      r = await fetch('/api/marketing/lead-devices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org, action: 'create', name: form.name, slug: form.slug, brand: form.brand, type: form.type, pipeline_id: form.pipeline_id, manifest: toManifest(form) }) })
    } else {
      if (!file) { setBusy(''); setError('Choose an HTML file.'); return }
      const fd = new FormData()
      fd.set('org_id', org as string); fd.set('file', file); fd.set('name', form.name); fd.set('slug', form.slug); fd.set('brand', form.brand)
      fd.set('type', form.type); fd.set('pipeline_id', form.pipeline_id); fd.set('manifest', JSON.stringify(toManifest(form)))
      r = await fetch('/api/marketing/lead-devices/upload', { method: 'POST', body: fd })
    }
    const j = await r.json().catch(() => ({}))
    setBusy('')
    if (!r.ok) { setError(j.error || 'The device could not be saved.'); return }
    setForm(EMPTY); setFile(null); setNote(''); setOpenId(j.id)
    await load()
  }

  const uploadVersion = async (id: string) => {
    if (!replaceFile) return
    setBusy(`${id}:upload`); setError('')
    const fd = new FormData()
    fd.set('org_id', org as string); fd.set('file', replaceFile); fd.set('device_id', id)
    const r = await fetch('/api/marketing/lead-devices/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    setBusy('')
    if (!r.ok) { setError(j.error || 'The file could not be uploaded.'); return }
    setReplaceFile(null)
    await load()
  }

  const redraft = async (d: any, outcome: string) => {
    setBusy(`${d.id}:redraft:${outcome}`); setError('')
    try {
      const p = await act(d.id, 'builder_prompt', { outcome })
      if (!p) return
      const plan = await fetch('/api/marketing/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: org, action: 'plan', prompt: p.prompt }) }).then((r) => r.json().catch(() => ({})))
      if (plan.outcome !== 'planned' || !plan.run_id) { setError(plan.message || plan.error || 'The Campaign Builder did not draft anything.'); return }
      const built = await fetch('/api/marketing/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: org, action: 'build', run_id: plan.run_id }) }).then((r) => r.json().catch(() => ({})))
      if (!built.built) { setError(built.error || 'The draft could not be built.'); return }
      await act(d.id, 'link_builder_run', { outcome, run_id: plan.run_id })
    } finally { setBusy('') }
  }

  if (!org) return null
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }))

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-np-dark flex items-center gap-2"><Sparkles size={18} /> Lead Devices</h1>
        <p className="text-xs text-gray-500 mt-1">A quiz, tool, lead magnet or form, hosted at start.neuroprogeny.com or on another site. Each one gets a pipeline, lists and draft campaigns. Nothing reaches a real person until the device is live.</p>
      </header>
      {error && <p className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg p-2"><AlertTriangle size={13} /> {error}</p>}

      {data?.can_edit && (
        <section className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-np-dark">New device</h2>
            <div className="flex gap-1">
              <button type="button" className={formOnly ? button : primary} onClick={() => setFormOnly(false)}>Upload HTML</button>
              <button type="button" className={formOnly ? primary : button} onClick={() => setFormOnly(true)}>Form only</button>
            </div>
          </div>
          {!formOnly && (
            <Field label="HTML file" hint="one self-contained .html with inline CSS and JavaScript, up to 2 MB">
              <input type="file" accept=".html,.htm,text/html" className="text-xs" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
            </Field>
          )}
          {note && <p className="text-[11px] text-gray-500">{note}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><input className={input} value={form.name} onChange={set('name')} /></Field>
            <Field label="Address" hint={SLUG_HINT}><input className={input} value={form.slug} onChange={set('slug')} /></Field>
            <Field label="Brand"><select className={input} value={form.brand} onChange={set('brand')}>{BRANDS.map((b) => <option key={b} value={b}>{b === 'wnw' ? 'WNW' : 'Neuro Progeny'}</option>)}</select></Field>
            <Field label="Type"><select className={input} value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Pipeline"><select className={input} value={form.pipeline_id} onChange={set('pipeline_id')}><option value="">Create a Lead funnel pipeline</option>{(data?.pipelines ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Asset link" hint="optional, https"><input className={input} value={form.asset_url} onChange={set('asset_url')} /></Field>
          </div>
          <Field label="Description" hint="the Campaign Builder drafts from this"><textarea rows={2} className={input} value={form.description} onChange={set('description')} /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Outcomes" hint="one per line: key | label"><textarea rows={3} className={input} value={form.outcomes} onChange={set('outcomes')} /></Field>
            <Field label="Question labels" hint="optional, one per line: key | label"><textarea rows={3} className={input} value={form.questions} onChange={set('questions')} /></Field>
            <Field label="Text Cameron for these outcomes" hint="optional, one key per line"><textarea rows={2} className={input} value={form.hot_outcomes} onChange={set('hot_outcomes')} /></Field>
            <Field label="Podcast or partner pages that may embed it" hint="optional, one https origin per line"><textarea rows={2} className={input} value={form.embed_origins} onChange={set('embed_origins')} /></Field>
            <Field label="Script sources the file may load" hint="optional, one https origin per line"><textarea rows={2} className={input} value={form.script_allowlist} onChange={set('script_allowlist')} /></Field>
          </div>
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer text-[11px] font-medium">Consent wording (blank uses the default)</summary>
            <div className="mt-2 space-y-2">
              <Field label="Email me my result (required, service)"><input className={input} value={form.result_consent_text} onChange={set('result_consent_text')} /></Field>
              <Field label="Marketing email (optional)"><input className={input} value={form.email_consent_text} onChange={set('email_consent_text')} /></Field>
              <Field label="Text messages (optional)"><input className={input} value={form.sms_consent_text} onChange={set('sms_consent_text')} /></Field>
            </div>
          </details>
          <button type="button" className={primary} disabled={busy === 'create'} onClick={create}>
            {busy === 'create' ? <Loader2 size={12} className="animate-spin inline" /> : !formOnly && <Upload size={12} className="inline mr-1" />} Create device
          </button>
        </section>
      )}

      {!data && !error && <p className="text-xs text-gray-400"><Loader2 size={12} className="animate-spin inline mr-1" />Loading</p>}
      {data?.devices?.length === 0 && <p className="text-xs text-gray-400">No lead devices yet.</p>}

      {(data?.devices ?? []).map((d: any) => {
        const open = openId === d.id
        const ready = d.readiness.test_submission && d.readiness.emails_approved && d.readiness.test_drive
        const liveVersion = d.versions.find((v: any) => v.id === d.live_version_id)
        return (
          <section key={d.id} className="bg-white border border-gray-100 rounded-xl p-4">
            <button type="button" className="w-full text-left" onClick={() => setOpenId(open ? null : d.id)}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-np-dark">{d.name}</h2>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.status === 'live' ? 'bg-teal-50 text-teal-700' : d.status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{d.status}</span>
                <span className="text-[10px] text-gray-400">{d.type.replace('_', ' ')} · {d.hosting === 'hub' ? (d.content === 'form' ? 'Hub form' : 'Hub hosted') : 'external'}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {d.stats.views} views · {d.stats.starts} starts · {d.stats.submissions} submissions{d.stats.conversion !== null ? ` · ${Math.round(d.stats.conversion * 100)}% conversion` : ''} · {d.stats.tests} tests
              </p>
            </button>
            {open && (
              <div className="mt-3 pt-3 border-t border-gray-50 grid md:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Readiness</h3>
                    <Check done={d.readiness.test_submission} label="Test submission received" />
                    <Check done={d.readiness.emails_approved} label="Emails approved" />
                    <Check done={d.readiness.test_drive} label="Test drive passed" />
                    {d.provision_error && <p className="text-[11px] text-red-600">Setup did not finish. <button type="button" className="underline" onClick={() => act(d.id, 'provision')}>Run it again</button></p>}
                    {data.can_edit && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button type="button" className={button} onClick={() => act(d.id, 'approve_emails', { approved: !d.readiness.emails_approved })}>{d.readiness.emails_approved ? 'Undo emails approved' : 'Approve emails'}</button>
                        <button type="button" className={button} onClick={() => act(d.id, 'test_drive', { passed: !d.readiness.test_drive })}>{d.readiness.test_drive ? 'Undo test drive' : 'Mark test drive passed'}</button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2">
                      {d.status !== 'live' && data.can_go_live && <button type="button" className={primary} disabled={!ready || busy === `${d.id}:go_live`} onClick={() => act(d.id, 'go_live')}>Go live</button>}
                      {d.status !== 'live' && !data.can_go_live && <p className="text-[11px] text-gray-400">Only Cameron can switch a device live.</p>}
                      {d.status === 'live' && data.can_edit && <button type="button" className={button} onClick={() => act(d.id, 'pause')}>Pause</button>}
                    </div>
                  </div>
                  {d.links && (
                    <div className="space-y-1">
                      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Links</h3>
                      <CopyLine value={d.links.url} />
                      {d.status !== 'live' && <p className="text-[11px] text-gray-400">This link shows not available until the device is live.</p>}
                      <p className="text-[11px] text-gray-500 pt-1">Embed</p>
                      <CopyLine value={d.links.embed} />
                      <details><summary className="text-[11px] text-gray-500 cursor-pointer">Tagged links per channel</summary>
                        <div className="mt-1 space-y-1">{d.links.utm.map((u: any) => <CopyLine key={u.channel} value={u.url} />)}</div>
                      </details>
                      {d.preview_url && <p className="text-[11px] pt-1"><a className="text-np-blue underline" href={d.preview_url} target="_blank" rel="noreferrer">Open the test link</a> <span className="text-gray-400">for the newest version. Submissions there are stored as tests and create no contact.</span></p>}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created around it</h3>
                    <p className="text-xs">Pipeline: {d.pipeline_name ?? 'none yet'}</p>
                    <p className="text-xs">Lists: {d.lists.map((l: any) => l.name).join(', ') || 'none yet'}</p>
                    <div className="space-y-1">
                      {d.campaigns.map((c: any) => (
                        <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span>{c.name}</span>
                          <span className="text-[10px] text-gray-400">{c.status}{c.live_enabled ? ', live sending on' : ', dry run'}</span>
                          {data.builder && <button type="button" className={button} disabled={!!busy} onClick={() => redraft(d, c.outcome)}>{busy === `${d.id}:redraft:${c.outcome}` ? 'Drafting...' : 'Redraft with Campaign Builder'}</button>}
                        </div>
                      ))}
                    </div>
                    {!data.builder && <p className="text-[11px] text-gray-400">These are starter emails. The Campaign Builder can redraft them when it is switched on for this organization.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Submissions</h3>
                      <button type="button" className={button} onClick={() => loadSubs(d.id)}>{subs[d.id] && subs[d.id] !== 'error' ? 'Refresh' : 'Show submissions'}</button>
                    </div>
                    {subs[d.id] === 'loading' && <p className="text-[11px] text-gray-400">Loading...</p>}
                    {subs[d.id] === 'error' && <p className="text-[11px] text-red-600">The submissions could not be loaded.</p>}
                    {Array.isArray(subs[d.id]) && !(subs[d.id] as any[]).length && <p className="text-[11px] text-gray-400">No submissions yet.</p>}
                    {Array.isArray(subs[d.id]) && (subs[d.id] as any[]).map((s: any) => {
                      const name = [s.first_name, s.last_name].filter(Boolean).join(' ')
                      return (
                        <div key={s.id} className="text-xs border border-gray-100 rounded-lg p-2 space-y-0.5 break-words">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-gray-400">{new Date(s.submitted_at).toLocaleString()}</span>
                            {s.is_test && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Test</span>}
                            {s.status === 'contact_failed' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">Contact not created</span>}
                            {s.status === 'received' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">In progress</span>}
                            {s.outcome_label && <span className="text-[10px] text-gray-500">{s.outcome_label}</span>}
                          </div>
                          {s.identity_purged_at ? (
                            <p className="text-[11px] text-gray-400">Details removed 30 days after this test.</p>
                          ) : (
                            <p>{name || 'No name'}{s.email ? ` · ${s.email}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            {s.contact_id && <a className="text-[11px] text-np-blue underline" href={`/crm/contacts?id=${s.contact_id}`}>Open contact</a>}
                            {s.status === 'contact_failed' && data.can_edit && (
                              <button type="button" className={button} disabled={busy === `${d.id}:retry_submission`} onClick={() => retry(d.id, s.id)}>Retry</button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {Array.isArray(subs[d.id]) && <p className="text-[11px] text-gray-400">Test submissions create no contact. Their details are removed after 30 days.</p>}
                  </div>
                  {d.hosting === 'hub' && d.content === 'html' && (
                    <div className="space-y-1.5">
                      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Versions</h3>
                      {d.versions.map((v: any) => (
                        <div key={v.id} className="text-xs border border-gray-100 rounded-lg p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">v{v.version}</span>
                            <span className="text-[10px] text-gray-400">{v.file_name}</span>
                            {liveVersion?.id === v.id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">served</span>}
                            {data.can_edit && liveVersion?.id !== v.id && (
                              <button type="button" className={button} onClick={() => act(d.id, v.approved_at ? 'rollback' : 'approve_version', { version_id: v.id })}>{v.approved_at ? 'Serve this version' : 'Approve and serve'}</button>
                            )}
                          </div>
                          {(v.inspection?.findings ?? []).map((f: any) => <p key={f.id} className={`text-[11px] mt-1 ${f.severity === 'blocking' ? 'text-red-600' : 'text-amber-700'}`}>{f.title}</p>)}
                        </div>
                      ))}
                      {data.can_edit && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input type="file" accept=".html,.htm,text/html" className="text-[11px]" onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)} />
                          <button type="button" className={button} disabled={!replaceFile || busy === `${d.id}:upload`} onClick={() => uploadVersion(d.id)}>Upload new version</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
