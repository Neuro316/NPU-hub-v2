// /api/marketing/smart-lists   (staff to read, org admin to change)
// GET  ?org_id=[&archived=1]: the lists with live counts, the campaigns using each, and filter options.
// POST { org_id, action: 'save' | 'duplicate' | 'archive' | 'restore', ... }
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { checkDefinition, filterOptions, members, missingSources, type Definition } from '@/lib/marketing/smart-lists/match'
import { loadFacts } from '@/lib/marketing/smart-lists/load'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req, ctx) => {
  const url = new URL(req.url)
  const org = requireOrg(ctx, url.searchParams.get('org_id'))
  if (typeof org !== 'string') return org
  const q = ctx.db.from('smart_lists').select('id, name, description, brand, definition, seed_key, archived_at, updated_at').eq('org_id', org).order('name')
  const { data: lists, error } = url.searchParams.get('archived') ? await q : await q.is('archived_at', null)
  const { data: camps, error: cErr } = await ctx.db.from('funnel_campaigns')
    .select('id, name, status, brand, live_enabled, smart_list_id').eq('org_id', org).neq('status', 'archived').order('name')
  if (error || cErr) return NextResponse.json({ error: 'The lists could not be loaded. Try again in a moment.' }, { status: 500 })
  let facts
  try { facts = await loadFacts(ctx.db, org) } catch (e) {
    console.error(`[smart-lists] ${(e as Error).message}`)
    return NextResponse.json({ error: 'The list counts could not be worked out. Try again in a moment.' }, { status: 500 })
  }
  const now = Date.now()
  const out = (lists ?? []).map((l: any) => {
    const m = members(l.definition as Definition, facts, now)
    return {
      ...l, count: m.length,
      email_allowed: m.filter((f) => f.email_allowed).length,
      texting_allowed: m.filter((f) => f.texting_allowed).length,
      no_data_source: missingSources(l.definition as Definition),
      campaigns: (camps ?? []).filter((c: any) => c.smart_list_id === l.id),
    }
  })
  return NextResponse.json({
    lists: out, campaigns: camps ?? [], options: filterOptions(facts),
    can_edit: isOrgAdmin(ctx, org),
  })
})

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can change smart lists.')
  const db = ctx.db
  const stamp = new Date().toISOString()
  const failed = () => NextResponse.json({ error: 'The list could not be saved. Try again in a moment.' }, { status: 500 })

  if (b.action === 'save') {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return bad('Give the list a name.')
    const check = checkDefinition(b.definition)
    if (!check.ok) return bad(check.message)
    const row = {
      name, description: typeof b.description === 'string' ? b.description : null,
      brand: b.brand === 'wnw' ? 'wnw' : 'np', definition: check.definition, updated_at: stamp,
    }
    const { data, error } = b.id
      ? await db.from('smart_lists').update(row).eq('id', b.id).eq('org_id', org).select('id')
      : await db.from('smart_lists').insert({ ...row, org_id: org, created_by: ctx.userId }).select('id')
    if (error) return failed()
    if ((data?.length ?? 0) !== 1) return NextResponse.json({ error: 'That list was not found. Reload the page.' }, { status: 404 })
    return NextResponse.json({ id: data![0].id })
  }

  if (typeof b.id !== 'string') return bad('Say which list.')
  if (b.action === 'duplicate') {
    const { data: src } = await db.from('smart_lists').select('name, description, brand, definition').eq('id', b.id).eq('org_id', org).maybeSingle()
    if (!src) return NextResponse.json({ error: 'That list was not found. Reload the page.' }, { status: 404 })
    const { data, error } = await db.from('smart_lists')
      .insert({ ...src, name: `${src.name} (copy)`, org_id: org, created_by: ctx.userId }).select('id')
    if (error || (data?.length ?? 0) !== 1) return failed()
    return NextResponse.json({ id: data![0].id })
  }
  if (b.action === 'archive' || b.action === 'restore') {
    if (b.action === 'archive') {
      // a campaign on the list would lose its audience without anyone saying so
      const { data: using } = await db.from('funnel_campaigns').select('name').eq('org_id', org).eq('smart_list_id', b.id).neq('status', 'archived')
      if (using?.length) return NextResponse.json({ error: `This list is used by ${using.map((c: any) => c.name).join(', ')}. Choose another list for them first.` }, { status: 409 })
    }
    const { data, error } = await db.from('smart_lists').update({ archived_at: b.action === 'archive' ? stamp : null, updated_at: stamp })
      .eq('id', b.id).eq('org_id', org).select('id')
    if (error) return failed()
    if ((data?.length ?? 0) !== 1) return NextResponse.json({ error: 'That list was not found. Reload the page.' }, { status: 404 })
    return NextResponse.json({ id: b.id })
  }
  return bad('That action is not recognised.')
})
