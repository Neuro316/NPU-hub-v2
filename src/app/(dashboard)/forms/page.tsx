'use client'
// Forms and Pages: forms are data (ruling 12). Each form lists its fields, the exact
// consent wording a visitor sees, and the source key that routes new people into a
// campaign. Publishing checks the form can create a contact and that every consent box
// has its text. The embed snippet posts to /api/intake.
import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Plus, Trash2, Copy, Sparkles } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import type { FormDef, Overview } from '@/components/marketing/types'
import { AiChip, approveDraft, needsReview } from '@/components/marketing/agent/ai-chip'
import { PagesEditor } from '@/components/marketing/pages-editor'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const small = 'rounded border border-gray-200 px-1.5 py-1 text-xs'
const fresh = (): Partial<FormDef> => ({
  name: 'New form', slug: '', status: 'draft', source_key: '', success_message: 'Thank you. Your details have been received.',
  fields: [{ key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' }, { key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' }],
  consents: [{ id: 'email_updates', channel: 'email', kind: 'marketing', text: 'Yes, send me emails with practices and program news. I can unsubscribe at any time.', required: false }],
})

export default function FormsPage() {
  const { currentOrg } = useWorkspace()
  const toast = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [f, setF] = useState<Partial<FormDef> | null>(null)
  const load = useCallback(async () => {
    if (!currentOrg) return
    try { setData(await api(`/api/marketing/overview?org=${currentOrg.id}`)) } catch (e: any) { toast.show(e.message, 'error') }
  }, [currentOrg, toast])
  useEffect(() => { load() }, [load])
  // ?id=<form id> opens that form (the funnel readiness checklist links here)
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('id')
    const hit = want && data?.forms.find((x) => x.id === want)
    if (hit) setF((cur) => cur ?? hit)
  }, [data])

  async function save() {
    if (!currentOrg || !f) return
    try {
      const r = await api('/api/marketing/forms', { ...f, org_id: currentOrg.id })
      // a person saving an AI-drafted form on its screen has reviewed it (ruling 14)
      if (f.id && needsReview(f)) { await approveDraft(currentOrg.id, 'form', f.id).catch(() => null); r.form.ai_reviewed_at = new Date().toISOString() }
      setF(r.form); toast.show('The form is saved.'); load()
    }
    catch (e: any) { toast.show(e.body?.problems ? `${e.message} ${e.body.problems.join('. ')}.` : e.message, 'error') }
  }
  const setField = (i: number, p: any) => setF({ ...f!, fields: f!.fields!.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const setConsent = (i: number, p: any) => setF({ ...f!, consents: f!.consents!.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://hub.neuroprogeny.com'
  const snippet = f?.slug ? `<script>\nasync function sendForm(values, consents) {\n  const r = await fetch('${appUrl}/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ form: '${f.slug}', values, consents, website: '', utm: Object.fromEntries(new URLSearchParams(location.search)) }) })\n  return r.json()\n}\n</script>` : ''

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-help-screen="forms">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><h1 className="text-xl font-semibold text-np-dark">Forms and Pages</h1>
          <p className="text-sm text-gray-500">Sign-up forms that create the contact, record exactly what they agreed to, and start the right campaign.</p></div>
        <button type="button" data-help-id="forms.new" onClick={() => setF(fresh())} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-2 text-xs font-medium text-white hover:bg-np-blue-hover"><Plus className="h-3.5 w-3.5" aria-hidden />New form</button>
      </div>
      {data && !data.flags.intake && <p className="rounded-lg bg-np-light p-3 text-xs text-gray-500">Form intake is switched off for this organization. You can build and publish forms now; they accept submissions once intake is switched on.</p>}
      {!data ? <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading</p> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {data.forms.length === 0 && <p className="text-xs text-gray-500">You have no forms yet. Press New form; it starts with a name field, an email field and an email consent box you can edit.</p>}
            {data.forms.map((x) => (
              <button key={x.id} type="button" onClick={() => setF(x)} className={`w-full rounded-card border bg-white p-3 text-left shadow-card ${f?.id === x.id ? 'border-np-blue' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-np-blue" aria-hidden /><b className="flex-1 truncate text-sm text-np-dark">{x.name}</b>{needsReview(x) && <Sparkles className="h-3 w-3 text-purple-600" aria-label="AI draft, needs review" />}<span className="text-[10px] text-gray-400">v{x.version}</span></div>
                <p className="mt-1 font-mono text-[11px] text-gray-400">{x.slug} . {x.status}</p>
              </button>))}
          </div>
          {f ? (
            <div className="space-y-3 rounded-card border border-gray-100 bg-white p-4 shadow-card">
              <div className="grid gap-2 md:grid-cols-2">
                <div><label className="text-[11px] text-gray-500" htmlFor="fm-name">Name</label><input id="fm-name" className={input} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
                <div><label className="text-[11px] text-gray-500" htmlFor="fm-slug">Form address</label><input id="fm-slug" className={`${input} font-mono`} placeholder="webinar-signup" value={f.slug ?? ''} onChange={(e) => setF({ ...f, slug: e.target.value })} /></div>
                <div><label className="text-[11px] text-gray-500" htmlFor="fm-src">Starts campaigns routed from</label><input id="fm-src" className={`${input} font-mono`} placeholder={`form:${f.slug || 'webinar-signup'}`} value={f.source_key ?? ''} onChange={(e) => setF({ ...f, source_key: e.target.value })} /></div>
                <div><label className="text-[11px] text-gray-500" htmlFor="fm-status">Status</label><select id="fm-status" data-help-id="forms.status" className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as FormDef['status'] })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></div>
              </div>
              <div><p className="mb-1 text-xs font-semibold text-np-dark">Fields</p>
                {f.fields!.map((x: any, i: number) => (
                  <div key={i} className="mb-1 grid grid-cols-[1fr_1fr_100px_100px_auto_auto] items-center gap-1">
                    <input aria-label="Field key" className={`${small} font-mono`} value={x.key} onChange={(e) => setField(i, { key: e.target.value })} />
                    <input aria-label="Field label" className={small} value={x.label} onChange={(e) => setField(i, { label: e.target.value })} />
                    <select aria-label="Field type" className={small} value={x.type} onChange={(e) => setField(i, { type: e.target.value })}>{['text', 'email', 'tel', 'textarea', 'select'].map((t) => <option key={t}>{t}</option>)}</select>
                    <select aria-label="Saves to" className={small} value={x.maps_to ?? ''} onChange={(e) => setField(i, { maps_to: e.target.value || undefined })}><option value="">Not saved to contact</option><option value="first_name">First name</option><option value="last_name">Last name</option><option value="email">Email</option><option value="phone">Phone</option></select>
                    <label className="text-[11px]"><input type="checkbox" checked={!!x.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>
                    <button type="button" aria-label="Remove field" onClick={() => setF({ ...f, fields: f.fields!.filter((_: any, j: number) => j !== i) })} className="p-1 text-gray-400 hover:text-fire"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                  </div>))}
                <button type="button" onClick={() => setF({ ...f, fields: [...f.fields!, { key: '', label: '', type: 'text' }] })} className="text-xs text-np-blue">Add a field</button></div>
              <div data-help-id="forms.consents"><p className="mb-1 text-xs font-semibold text-np-dark">Consent boxes</p>
                <p className="mb-1 text-[11px] text-gray-400">The wording here is exactly what the visitor sees and what the Hub records when they tick the box.</p>
                {f.consents!.map((x: any, i: number) => (
                  <div key={i} className="mb-2 space-y-1 rounded-lg border border-gray-100 p-2">
                    <div className="grid grid-cols-[1fr_90px_110px_auto_auto] items-center gap-1">
                      <input aria-label="Consent id" className={`${small} font-mono`} value={x.id} onChange={(e) => setConsent(i, { id: e.target.value })} />
                      <select aria-label="Consent channel" className={small} value={x.channel} onChange={(e) => setConsent(i, { channel: e.target.value })}><option value="email">Email</option><option value="sms">Text</option></select>
                      <select aria-label="Consent kind" className={small} value={x.kind} onChange={(e) => setConsent(i, { kind: e.target.value })}><option value="marketing">Marketing</option><option value="service">Service</option></select>
                      <label className="text-[11px]"><input type="checkbox" checked={!!x.required} onChange={(e) => setConsent(i, { required: e.target.checked })} /> Required</label>
                      <button type="button" aria-label="Remove consent box" onClick={() => setF({ ...f, consents: f.consents!.filter((_: any, j: number) => j !== i) })} className="p-1 text-gray-400 hover:text-fire"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </div>
                    <textarea aria-label="Consent wording" rows={2} className={`${small} w-full`} value={x.text} onChange={(e) => setConsent(i, { text: e.target.value })} />
                  </div>))}
                <button type="button" onClick={() => setF({ ...f, consents: [...f.consents!, { id: '', channel: 'sms', kind: 'marketing', text: '' }] })} className="text-xs text-np-blue">Add a consent box</button></div>
              <div><label className="text-[11px] text-gray-500" htmlFor="fm-thanks">Message after submitting</label><input id="fm-thanks" className={input} value={f.success_message ?? ''} onChange={(e) => setF({ ...f, success_message: e.target.value })} /></div>
              {snippet && <div data-help-id="forms.embed"><div className="mb-1 flex items-center gap-2"><p className="text-xs font-semibold text-np-dark">Embed on a website</p><span className="flex-1" />
                <button type="button" onClick={() => { navigator.clipboard?.writeText(snippet); toast.show('The snippet is copied.') }} className="inline-flex items-center gap-1 text-xs text-np-blue"><Copy className="h-3 w-3" aria-hidden />Copy</button></div>
                <pre className="overflow-x-auto rounded-lg bg-np-light p-2 text-[10px] text-gray-600">{snippet}</pre>
                <p className="mt-1 text-[11px] text-gray-400">Keep an empty hidden field named website on the page. Real people never fill it in, and submissions that do are dropped.</p></div>}
              <div className="flex items-center justify-end gap-2">
                {f.id && needsReview(f) && <AiChip orgId={currentOrg!.id} kind="form" id={f.id} onApproved={() => { setF({ ...f, ai_reviewed_at: new Date().toISOString() }); load() }} />}
                <button type="button" data-help-id="forms.save" onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover">Save form</button></div>
            </div>
          ) : <div className="rounded-card border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">Choose a form on the left to edit it, or press New form to build one. A published form can start a funnel campaign from its Starts from section.</div>}
        </div>
      )}
      {data && currentOrg && <PagesEditor orgId={currentOrg.id} data={data} reload={load} />}
    </div>
  )
}
