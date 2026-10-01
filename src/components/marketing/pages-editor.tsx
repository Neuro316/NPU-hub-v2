'use client'
// Landing pages (agent ruling 12, Phase 4): a page is a list of blocks, saved through
// POST /api/marketing/pages, which checks every block and refuses to publish a page whose form is
// not published. It shows at /p/<address> only once published AND the org's pages switch is on.
// Saving an AI-drafted page here counts as reviewing it (ruling 14).
import { useState } from 'react'
import { LayoutTemplate, Plus, Trash2, ArrowUp, ExternalLink, Sparkles } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { AiChip, approveDraft, needsReview } from './agent/ai-chip'
import type { Overview, PageDef } from './types'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'
const small = 'rounded border border-gray-200 px-1.5 py-1 text-xs'
const BLANK: Record<string, any> = { heading: { type: 'heading', text: '', level: 1 }, text: { type: 'text', text: '' }, list: { type: 'list', items: [''] },
  image: { type: 'image', url: '', alt: '' }, button: { type: 'button', label: '', href: '' }, form: { type: 'form' } }
type Draft = Partial<PageDef> & { form_slug?: string | null }

export function PagesEditor({ orgId, data, reload }: { orgId: string; data: Overview; reload: () => void }) {
  const toast = useToast()
  const pages = data.pages ?? []
  const [p, setP] = useState<Draft | null>(null)
  const open = (x: PageDef) => setP({ ...x, form_slug: data.forms.find((f) => f.id === x.form_definition_id)?.slug ?? null })
  const setBlock = (i: number, patch: any) => setP({ ...p!, blocks: p!.blocks!.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  const move = (i: number) => { const b = [...p!.blocks!]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; setP({ ...p!, blocks: b }) }

  async function save() {
    if (!p) return
    try {
      const r = await api('/api/marketing/pages', { org_id: orgId, id: p.id, slug: p.slug, title: p.title, status: p.status, blocks: p.blocks, form_slug: p.form_slug || null })
      if (p.id && needsReview(p)) { await approveDraft(orgId, 'page', p.id).catch(() => null); r.page.ai_reviewed_at = new Date().toISOString() }
      setP({ ...r.page, form_slug: p.form_slug }); toast.show('The page is saved.'); reload()
    } catch (e: any) { toast.show(e.message, 'error') }
  }

  return (
    <div className="space-y-3 rounded-card border border-gray-100 bg-white p-4 shadow-card" data-help-id="pages.editor">
      <div className="flex items-center gap-2"><LayoutTemplate className="h-4 w-4 text-np-blue" aria-hidden /><h2 className="flex-1 text-sm font-semibold text-np-dark">Landing pages</h2>
        <button type="button" data-help-id="pages.new" onClick={() => setP({ title: 'New page', slug: '', status: 'draft', blocks: [{ ...BLANK.heading }], form_slug: null })} className="inline-flex items-center gap-1 rounded-lg border border-np-blue px-2.5 py-1 text-xs text-np-blue"><Plus className="h-3.5 w-3.5" aria-hidden />New page</button></div>
      {!data.flags.pages && <p className="rounded-lg bg-np-light p-2 text-[11px] text-gray-500">Landing pages are switched off for this organization. You can build and publish pages now; they appear at their address once a superadmin switches pages on.</p>}
      <div className="flex flex-wrap gap-2">{pages.map((x) => (
        <button key={x.id} type="button" onClick={() => open(x)} className={`rounded-lg border px-2.5 py-1 text-xs ${p?.id === x.id ? 'border-np-blue text-np-dark' : 'border-gray-200 text-gray-600'}`}>
          {x.title} <span className="text-gray-400">({x.status})</span>{needsReview(x) && <Sparkles className="ml-1 inline h-3 w-3 text-purple-600" aria-label="AI draft, needs review" />}</button>))}
        {pages.length === 0 && <p className="text-xs text-gray-500">No landing pages yet.</p>}</div>
      {p && <div className="space-y-2 border-t border-gray-100 pt-3">
        <div className="grid gap-2 md:grid-cols-4">
          <div className="md:col-span-2"><label className="text-[11px] text-gray-500" htmlFor="pg-title">Title</label><input id="pg-title" className={input} value={p.title ?? ''} onChange={(e) => setP({ ...p, title: e.target.value })} /></div>
          <div><label className="text-[11px] text-gray-500" htmlFor="pg-slug">Page address</label><input id="pg-slug" className={`${input} font-mono`} placeholder="hrv-guide" value={p.slug ?? ''} onChange={(e) => setP({ ...p, slug: e.target.value })} /></div>
          <div><label className="text-[11px] text-gray-500" htmlFor="pg-status">Status</label><select id="pg-status" data-help-id="pages.status" className={input} value={p.status} onChange={(e) => setP({ ...p, status: e.target.value as PageDef['status'] })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></div>
        </div>
        <div><label className="text-[11px] text-gray-500" htmlFor="pg-form">Sign-up form shown by a form block</label>
          <select id="pg-form" className={input} value={p.form_slug ?? ''} onChange={(e) => setP({ ...p, form_slug: e.target.value || null })}><option value="">No form</option>{data.forms.map((f) => <option key={f.id} value={f.slug}>{f.name} ({f.status})</option>)}</select></div>
        {p.blocks!.map((b: any, i: number) => (
          <div key={i} className="flex items-start gap-1 rounded-lg border border-gray-100 p-2">
            <select aria-label="Block type" className={small} value={b.type} onChange={(e) => setP({ ...p, blocks: p.blocks!.map((x, j) => (j === i ? { ...BLANK[e.target.value] } : x)) })}>{Object.keys(BLANK).map((t) => <option key={t}>{t}</option>)}</select>
            <div className="flex-1 space-y-1">
              {(b.type === 'heading' || b.type === 'text') && <textarea aria-label="Block text" rows={b.type === 'text' ? 3 : 1} className={`${small} w-full`} value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} />}
              {b.type === 'list' && <textarea aria-label="List items, one per line" rows={3} className={`${small} w-full`} value={b.items.join('\n')} onChange={(e) => setBlock(i, { items: e.target.value.split('\n') })} />}
              {b.type === 'image' && <><input aria-label="Image https address" className={`${small} w-full`} placeholder="https://" value={b.url} onChange={(e) => setBlock(i, { url: e.target.value })} /><input aria-label="Image description" className={`${small} w-full`} placeholder="Describe the image" value={b.alt} onChange={(e) => setBlock(i, { alt: e.target.value })} /></>}
              {b.type === 'button' && <><input aria-label="Button label" className={`${small} w-full`} value={b.label} onChange={(e) => setBlock(i, { label: e.target.value })} /><input aria-label="Button link" className={`${small} w-full`} placeholder="/p/next-page or https://" value={b.href} onChange={(e) => setBlock(i, { href: e.target.value })} /></>}
              {b.type === 'form' && <p className="text-[11px] text-gray-500">Shows the sign-up form chosen above.</p>}
            </div>
            {i > 0 && <button type="button" aria-label="Move block up" onClick={() => move(i)} className="p-1 text-gray-400 hover:text-np-dark"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>}
            <button type="button" aria-label="Remove block" onClick={() => setP({ ...p, blocks: p.blocks!.filter((_, j) => j !== i) })} className="p-1 text-gray-400 hover:text-fire"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          </div>))}
        <button type="button" onClick={() => setP({ ...p, blocks: [...p.blocks!, { ...BLANK.text }] })} className="text-xs text-np-blue">Add a block</button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {p.id && p.status === 'published' && data.flags.pages && p.slug && <a href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-np-blue"><ExternalLink className="h-3 w-3" aria-hidden />Open the live page</a>}
          {p.id && needsReview(p) && <AiChip orgId={orgId} kind="page" id={p.id} onApproved={() => { setP({ ...p, ai_reviewed_at: new Date().toISOString() }); reload() }} />}
          <button type="button" data-help-id="pages.save" onClick={save} className="rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover">Save page</button>
        </div>
      </div>}
    </div>)
}
