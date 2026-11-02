// POST   /api/scheduling/<resource>        create a row owned by the caller
// PATCH  /api/scheduling/<resource> {id}   change the caller's row
// DELETE /api/scheduling/<resource>?id=    delete the caller's row
// <resource> is one of RESOURCES in src/lib/scheduling/rules.ts. The owner is always the
// signed-in user: it is set on insert and required on every update and delete, so a row
// belonging to anyone else answers 404, superadmins included.
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { RESOURCES, Invalid, isUuid, ownerTimezone } from '@/lib/scheduling/rules'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

/** Database refusals as plain sentences; constraint names and values are not echoed. */
function dbError(resource: string, e: { code?: string; message?: string }) {
  if (e.code === '23505') return bad('That already exists.')
  if (e.code === '23503' || /reply_rule_mailbox_not_owned/.test(e.message ?? '')) return notFound()
  if (e.code === '23514') {
    return bad(resource === 'recurring-blocks'
      ? 'An active block needs an anchor date, a start and an end, and the anchor date must fall on the chosen weekday.'
      : 'Those values are not accepted together.')
  }
  return NextResponse.json({ error: 'The change could not be saved.' }, { status: 500 })
}

function specFor(resource: string, method: 'POST' | 'PATCH' | 'DELETE') {
  const spec = RESOURCES[resource]
  return spec && spec.methods.includes(method) ? spec : null
}

export const POST = withStaff<{ resource: string }>(async (req, ctx, { resource }) => {
  const spec = specFor(resource, 'POST')
  if (!spec) return notFound()
  const body = await req.json().catch(() => ({}))
  let row
  try { row = spec.validate(body, false, await ownerTimezone(ctx.db, ctx.userId)) } catch (e) { if (e instanceof Invalid) return bad(e.message); throw e }
  if (resource === 'one-off-blocks') Object.assign(row, { source: 'page', created_by: `hub_user:${ctx.userId}` })
  const { data, error } = await ctx.db.from(spec.table).insert({ ...row, owner_user_id: ctx.userId }).select('*').single()
  if (error) return dbError(resource, error)
  return NextResponse.json({ row: data })
})

export const PATCH = withStaff<{ resource: string }>(async (req, ctx, { resource }) => {
  const spec = specFor(resource, 'PATCH')
  if (!spec) return notFound()
  const body = await req.json().catch(() => ({}))
  if (!isUuid(body.id)) return notFound()
  let row
  try { row = spec.validate(body, true, await ownerTimezone(ctx.db, ctx.userId)) } catch (e) { if (e instanceof Invalid) return bad(e.message); throw e }
  if (resource === 'reply-rules') Object.assign(row, { updated_at: new Date().toISOString() })
  let q = ctx.db.from(spec.table).update(row).eq('id', body.id).eq('owner_user_id', ctx.userId)
  // a decision is made once; cancelling is allowed from any open state
  if (resource === 'exception-requests') q = q.in('status', row.status === 'cancelled' ? ['pending', 'approved'] : ['pending'])
  const { data, error } = await q.select('*').maybeSingle()
  if (error) return dbError(resource, error)
  if (!data) return notFound()
  return NextResponse.json({ row: data })
})

export const DELETE = withStaff<{ resource: string }>(async (req, ctx, { resource }) => {
  const spec = specFor(resource, 'DELETE')
  if (!spec) return notFound()
  const id = req.nextUrl.searchParams.get('id')
  if (!isUuid(id)) return notFound()
  const { data, error } = await ctx.db.from(spec.table).delete().eq('id', id).eq('owner_user_id', ctx.userId).select('id')
  if (error) return dbError(resource, error)
  if (!data?.length) return notFound()
  return NextResponse.json({ ok: true })
})
