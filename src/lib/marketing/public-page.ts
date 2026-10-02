// src/lib/marketing/public-page.ts
// What /p/<slug> may show (agent ruling 12, Stage 0 answer 1). A page is shown only when it is
// published AND its org has the `pages` flag on; its form only when that form is published too.
// Anything else returns null, which the page turns into a plain not-found, so a draft, an
// archived page or a switched-off org reveals nothing. Stored blocks are checked again here, so
// a row written before a validator change is never rendered unchecked.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getFlags } from './flags'
import { checkPage, type PageBlock } from './validate/page'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface PublicPage { title: string; blocks: PageBlock[]; form: { slug: string; fields: any[]; consents: any[] } | null }

export async function loadPublicPage(db: SupabaseClient, slug: string): Promise<PublicPage | null> {
  if (!SLUG.test(slug) || slug.length > 60) return null
  // slug is globally unique (hub_213), so this finds at most one; the length check is a belt
  const { data, error } = await db.from('page_definitions').select('org_id, slug, title, blocks, form_definition_id')
    .eq('slug', slug).eq('status', 'published').limit(2)
  if (error) { console.error(`[p/slug] read failed: ${error.code ?? 'unknown'}`); return null }
  if (!data || data.length !== 1) return null
  const page = data[0] as any
  if (!(await getFlags(db, page.org_id)).pages) return null
  let form: PublicPage['form'] = null
  if (page.form_definition_id) {
    const { data: f } = await db.from('form_definitions').select('slug, fields, consents, status')
      .eq('id', page.form_definition_id).eq('org_id', page.org_id).maybeSingle()
    if (f && (f as any).status === 'published') form = { slug: (f as any).slug, fields: (f as any).fields ?? [], consents: (f as any).consents ?? [] }
  }
  const check = checkPage({ slug: page.slug, title: page.title, status: 'published', blocks: page.blocks, form_slug: form?.slug ?? null })
  if (!check.ok) { console.error(`[p/slug] stored page ${slug} fails its checks: ${check.message}`); return null }
  return { title: check.row.title, blocks: check.row.blocks, form }
}
