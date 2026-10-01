// POST /api/marketing/pages   (staff)
// Landing pages are data (agent ruling 12). { org_id, id?, slug, title, status, blocks, form_slug? }.
// Publishing is a human action: only this staff route can set a page to published, and it
// requires the page's form to be published too, so a live page never shows a form that cannot
// accept the submission. The Campaign Builder only ever creates drafts (public.agent_build).
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { checkPage } from '@/lib/marketing/validate/page'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const check = checkPage(b)
  if (!check.ok) return bad(check.message)
  const p = check.row
  let formId: string | null = null
  if (p.form_slug) {
    const { data: f } = await ctx.db.from('form_definitions').select('id, status').eq('org_id', org).eq('slug', p.form_slug).maybeSingle()
    if (!f) return bad('The page\'s form was not found in this organization.')
    if (p.status === 'published' && (f as any).status !== 'published') return bad('Publish the page\'s form first, so the page can accept sign-ups.')
    formId = (f as any).id
  }
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { org_id: org, slug: p.slug, title: p.title, status: p.status, blocks: p.blocks, form_definition_id: formId, updated_at: now }
  if (b.id) {
    const { data: cur } = await ctx.db.from('page_definitions').select('version, status, published_at').eq('id', b.id).eq('org_id', org).maybeSingle()
    if (!cur) return NextResponse.json({ error: 'That page was not found.' }, { status: 404 })
    if (p.status === 'published' && (cur as any).status !== 'published') { row.published_at = now; row.published_by = ctx.userId }
    if (p.status === 'published' && (cur as any).status === 'published') row.published_at = (cur as any).published_at
    const { data, error } = await ctx.db.from('page_definitions').update({ ...row, version: (cur as any).version + 1 }).eq('id', b.id).eq('org_id', org).select('*')
    if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: error?.code === '23505' ? 'Another page already uses that address.' : 'The page could not be saved.' }, { status: error?.code === '23505' ? 409 : 500 })
    console.info(`[marketing/pages] org=${org} page=${b.id} status=${p.status} by=${ctx.userId}`)
    return NextResponse.json({ page: data![0] })
  }
  if (p.status === 'published') { row.published_at = now; row.published_by = ctx.userId }
  const { data, error } = await ctx.db.from('page_definitions').insert({ ...row, created_by: ctx.userId }).select('*')
  if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: error?.code === '23505' ? 'Another page already uses that address.' : 'The page could not be saved.' }, { status: error?.code === '23505' ? 409 : 500 })
  return NextResponse.json({ page: data![0] })
})
