// /p/<slug>   (PUBLIC, approved as /p/* behind the `pages` switch; agent ruling 12, Stage 0 answer 1)
// A landing page is data: a list of checked blocks (src/lib/marketing/validate/page.ts). It is
// shown only when the page is published AND its org has the `pages` flag on; anything else is a
// plain not-found, so a draft or a switched-off org reveals nothing. Only the page's own fields
// and its published form are read, through the service role, by named columns.
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminSupabase } from '@/lib/supabase'
import { getFlags } from '@/lib/marketing/flags'
import { checkPage, type PageBlock } from '@/lib/marketing/validate/page'
import { PageForm } from './page-form'

export const dynamic = 'force-dynamic'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 60) return null
  const db = createAdminSupabase()
  // slugs are unique per org, so two orgs could each publish one; refuse rather than guess
  const { data, error } = await db.from('page_definitions').select('org_id, slug, title, blocks, form_definition_id')
    .eq('slug', slug).eq('status', 'published').limit(2)
  if (error) { console.error(`[p/slug] read failed: ${error.code ?? 'unknown'}`); return null }
  if (!data || data.length !== 1) return null
  const page = data[0] as any
  if (!(await getFlags(db, page.org_id)).pages) return null
  let form: any = null
  if (page.form_definition_id) {
    const { data: f } = await db.from('form_definitions').select('slug, fields, consents, status')
      .eq('id', page.form_definition_id).eq('org_id', page.org_id).maybeSingle()
    if (f && (f as any).status === 'published') form = f
  }
  // re-check what is stored: a row written before a validator change is never rendered unchecked
  const check = checkPage({ slug: page.slug, title: page.title, status: 'published', blocks: page.blocks, form_slug: form?.slug ?? null })
  if (!check.ok) { console.error(`[p/slug] stored page ${slug} fails its checks: ${check.message}`); return null }
  return { title: check.row.title, blocks: check.row.blocks, form }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await load(params.slug)
  return { title: p?.title ?? 'Page not found', robots: { index: false } }
}

function Block({ b, form }: { b: PageBlock; form: any }) {
  switch (b.type) {
    case 'heading': return b.level === 1
      ? <h1 className="text-3xl font-bold text-np-dark">{b.text}</h1>
      : <h2 className="text-xl font-semibold text-np-dark">{b.text}</h2>
    case 'text': return <p className="whitespace-pre-wrap text-base leading-relaxed text-gray-700">{b.text}</p>
    case 'list': return <ul className="list-disc space-y-1 pl-6 text-gray-700">{b.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    // eslint-disable-next-line @next/next/no-img-element
    case 'image': return <img src={b.url} alt={b.alt} className="w-full rounded-xl" />
    case 'button': return <a href={b.href} rel="noopener noreferrer" className="inline-block rounded-lg bg-np-blue px-5 py-2.5 font-medium text-white hover:bg-np-blue-hover">{b.label}</a>
    case 'form': return form ? <PageForm slug={form.slug} fields={form.fields ?? []} consents={form.consents ?? []} /> : null
  }
}

export default async function PublicPage({ params }: { params: { slug: string } }) {
  const p = await load(params.slug)
  if (!p) notFound()
  return (
    <main className="min-h-screen bg-np-light px-4 py-12">
      <article className="mx-auto max-w-2xl space-y-6 rounded-2xl bg-white p-8 shadow-card">
        {p.blocks.map((b, i) => <Block key={i} b={b} form={p.form} />)}
      </article>
    </main>
  )
}
