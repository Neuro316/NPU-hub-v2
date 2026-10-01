// POST /api/marketing/assets   (staff)
// The University assets a deliver step can hand out. { org_id, id?, title, description,
// path, active }. Only a path is stored; the host is always the University's own
// domain (src/lib/marketing/university.ts), so no asset can point anywhere else.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { universityTarget } from '@/lib/marketing/university'
import { constraintMessage } from '@/lib/marketing/db-errors'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title) return bad('Give the asset a title.')
  let path = typeof b.path === 'string' ? b.path.trim() : ''
  if (path.startsWith('https://university.neuroprogeny.com')) path = path.slice('https://university.neuroprogeny.com'.length) || '/'
  if (!universityTarget(path) || !/^\/[A-Za-z0-9/_.~%=&?-]*$/.test(path)) {
    return bad('Use a page on university.neuroprogeny.com, for example /signup?asset=breathing-guide')
  }
  const row = { org_id: org, title, description: typeof b.description === 'string' ? b.description.trim() || null : null, path, active: b.active !== false }
  const q = b.id ? ctx.db.from('university_assets').update(row).eq('id', b.id).eq('org_id', org).select('*')
    : ctx.db.from('university_assets').insert(row).select('*')
  const { data, error } = await q
  if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: constraintMessage(error, 'The asset') ?? 'The asset could not be saved. Try again in a moment.' }, { status: 500 })
  return NextResponse.json({ asset: data![0] })
})
