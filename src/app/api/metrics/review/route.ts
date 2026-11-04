// GET    /api/metrics/review                     suspected test contacts and profiles, with any decision
// POST   /api/metrics/review {kind, id, decision} kind contact|profile, decision exclude|keep
// DELETE /api/metrics/review?kind=&id=            forget a decision (back to undecided)
//
// Growth Dashboard › Targets › Review test accounts (test-filter rule T3). Nothing is
// excluded until a superadmin presses Exclude: a suspect is only a name or email that looks
// like a test. The seeded rows (Cameron's addresses) are listed as already excluded and
// can't be changed here. Platform superadmins only.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { loadTestFilter } from '@/lib/metrics/test-filter'

export const dynamic = 'force-dynamic'

const ONLY = 'Test data is reviewed by superadmins.'
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const LOOKS_TEST = /\btest|test\b|\+test|demo|fake|example\.(com|org)|sample|dummy|asdf|qwerty/i

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const pat = 'email.ilike.%test%,email.ilike.%demo%,email.ilike.%fake%,email.ilike.%example.%,email.ilike.%dummy%,email.ilike.%sample%'
  const [contacts, profiles, decisions] = await Promise.all([
    ctx.db.from('contacts').select('id, first_name, last_name, email, phone, tags, source, created_at').is('merged_into_id', null)
      .or(`${pat},first_name.ilike.%test%,last_name.ilike.%test%,first_name.ilike.%demo%`).limit(300),
    ctx.db.from('profiles').select('id, full_name, email, role, created_at').or(`${pat},full_name.ilike.%test%,full_name.ilike.%demo%`).limit(300),
    ctx.db.from('hub_metric_exclusions').select('id, kind, decision, contact_id, profile_id, email, email_pattern, reason, created_at'),
  ])
  if (contacts.error || profiles.error || decisions.error) return NextResponse.json({ error: 'Test accounts could not be loaded.' }, { status: 500 })
  const filter = await loadTestFilter(ctx.db)
  const decided = decisions.data ?? []
  const decisionOf = (kind: string, id: string) => decided.find(d => d.kind === kind && (kind === 'contact' ? d.contact_id : d.profile_id) === id)?.decision ?? null
  const suspects = [
    ...(contacts.data ?? []).filter(c => LOOKS_TEST.test(`${c.first_name ?? ''} ${c.last_name ?? ''} ${c.email ?? ''}`)).map(c => ({
      kind: 'contact' as const, id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)', email: c.email,
      detail: c.source ? `source ${c.source}`.slice(0, 80) : null, decision: decisionOf('contact', c.id),
      already: decisionOf('contact', c.id) !== 'exclude' && filter.isTestContact(c),
    })),
    ...(profiles.data ?? []).filter(p => LOOKS_TEST.test(`${p.full_name ?? ''} ${p.email ?? ''}`)).map(p => ({
      kind: 'profile' as const, id: p.id, name: p.full_name || '(no name)', email: p.email, detail: p.role ? `role ${p.role}` : null,
      decision: decisionOf('profile', p.id), already: decisionOf('profile', p.id) !== 'exclude' && filter.isTestProfile(p.id, p.email),
    })),
  ]
  const seeded = decided.filter(d => d.kind === 'email' || d.kind === 'email_pattern').map(d => ({ id: d.id, rule: d.email_pattern ?? d.email, reason: d.reason }))
  return NextResponse.json({ suspects, seeded })
})

async function decide(ctx: any, kind: 'contact' | 'profile', id: string, decision: 'exclude' | 'keep') {
  const col = kind === 'contact' ? 'contact_id' : 'profile_id'
  const { data: existing } = await ctx.db.from('hub_metric_exclusions').select('id').eq('kind', kind).eq(col, id).maybeSingle()
  if (existing) return ctx.db.from('hub_metric_exclusions').update({ decision, created_by: ctx.userId, updated_at: new Date().toISOString() }).eq('id', existing.id)
  return ctx.db.from('hub_metric_exclusions').insert({ kind, [col]: id, decision, created_by: ctx.userId, reason: 'Reviewed in Test accounts' })
}

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const b = await req.json().catch(() => ({}))
  if (!['contact', 'profile'].includes(b.kind) || !isUuid(b.id) || !['exclude', 'keep'].includes(b.decision)) return bad('Choose a person and Exclude or Keep.')
  const table = b.kind === 'contact' ? 'contacts' : 'profiles'
  const { data: exists } = await ctx.db.from(table).select('id').eq('id', b.id).maybeSingle()
  if (!exists) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { error } = await decide(ctx, b.kind, b.id, b.decision)
  if (error) return NextResponse.json({ error: 'The decision could not be saved.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})

export const DELETE = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const kind = req.nextUrl.searchParams.get('kind'), id = req.nextUrl.searchParams.get('id')
  if (!['contact', 'profile'].includes(kind ?? '') || !isUuid(id)) return bad('Choose a person.')
  const { error } = await ctx.db.from('hub_metric_exclusions').delete().eq('kind', kind!).eq(kind === 'contact' ? 'contact_id' : 'profile_id', id)
  if (error) return NextResponse.json({ error: 'The decision could not be removed.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})
