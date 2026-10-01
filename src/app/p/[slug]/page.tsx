// /p/<slug>   (PUBLIC, approved as /p/* behind the `pages` switch; agent ruling 12, Stage 0 answer 1)
// A landing page is data: a list of checked blocks. What may be shown, and when, is decided in
// src/lib/marketing/public-page.ts (published, org `pages` flag on, published form only); this
// file only renders it, and turns anything else into a plain not-found.
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminSupabase } from '@/lib/supabase'
import { loadPublicPage } from '@/lib/marketing/public-page'
import type { PageBlock } from '@/lib/marketing/validate/page'
import { PageForm } from './page-form'

export const dynamic = 'force-dynamic'

const load = (slug: string) => loadPublicPage(createAdminSupabase(), slug)

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
