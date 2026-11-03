// POST   /api/scheduling/<resource>        create a row owned by the caller
// PATCH  /api/scheduling/<resource> {id}   change the caller's row
// DELETE /api/scheduling/<resource>?id=    delete the caller's row
// <resource> is one of RESOURCES in src/lib/scheduling/rules.ts. The owner is always the
// signed-in user: it is set on insert and required on every update and delete, so a row
// belonging to anyone else answers 404, superadmins included.
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { RESOURCES, Invalid, isUuid, ownerTimezone, validateDayTimes, checkSpanOverride } from '@/lib/scheduling/rules'
import type { StaffContext } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

/** Database refusals as plain sentences; constraint names and values are not echoed. */
function dbError(resource: string, e: { code?: string; message?: string }) {
  if (e.code === '23505') return bad('That already exists.')
  if (e.code === '23503' || /reply_rule_mailbox_not_owned/.test(e.message ?? '')) return notFound()
  if (e.code === '23514') {
    return bad(resource === 'recurring-blocks'
      ? 'An active block needs a starting date on its From weekday, and times, all day, or per-day times.'
      : 'Those values are not accepted together.')
  }
  return NextResponse.json({ error: 'The change could not be saved.' }, { status: 500 })
}

/** Replaces a recurring block's per-day times (rows exist only while per_day_times is on). */
async function saveDayTimes(ctx: StaffContext, blockId: string, rows: Record<string, unknown>[]) {
  const del = await ctx.db.from('hub_sched_recurring_block_days').delete().eq('block_id', blockId).eq('owner_user_id', ctx.userId)
  if (del.error) return del.error
  if (!rows.length) return null
  const ins = await ctx.db.from('hub_sched_recurring_block_days').insert(rows.map(r => ({ ...r, block_id: blockId, owner_user_id: ctx.userId })))
  return ins.error
}

/** Extra checks that need the owner's block row: per-day times and span overrides. */
async function prepare(resource: string, body: Record<string, unknown>, row: Record<string, unknown>, ctx: StaffContext) {
  if (resource === 'recurring-blocks') return validateDayTimes(body.day_times, row)
  if (resource === 'recurring-overrides' && (row.kind === 'skip_span' || row.kind === 'add_span')) {
    const { data } = await ctx.db.from('hub_sched_recurring_blocks')
      .select('from_weekday, anchor_date, interval_weeks').eq('id', row.block_id as string).eq('owner_user_id', ctx.userId).maybeSingle()
    checkSpanOverride(row.kind, row.date, data)
  }
  return []
}

function specFor(resource: string, method: 'POST' | 'PATCH' | 'DELETE') {
  const spec = RESOURCES[resource]
  return spec && spec.methods.includes(method) ? spec : null
}

export const POST = withStaff<{ resource: string }>(async (req, ctx, { resource }) => {
  const spec = specFor(resource, 'POST')
  if (!spec) return notFound()
  const body = await req.json().catch(() => ({}))
  let row, dayRows
  try {
    row = spec.validate(body, false, await ownerTimezone(ctx.db, ctx.userId))
    dayRows = await prepare(resource, body, row, ctx)
  } catch (e) { if (e instanceof Invalid) return bad(e.message); throw e }
  if (resource === 'one-off-blocks') Object.assign(row, { source: 'page', created_by: `hub_user:${ctx.userId}` })
  const { data, error } = await ctx.db.from(spec.table).insert({ ...row, owner_user_id: ctx.userId }).select('*').single()
  if (error) return dbError(resource, error)
  if (resource === 'recurring-blocks' && await saveDayTimes(ctx, data.id, dayRows)) {
    return NextResponse.json({ error: 'The block was saved, but its per-day times were not. Save again.' }, { status: 500 })
  }
  return NextResponse.json({ row: data })
})

export const PATCH = withStaff<{ resource: string }>(async (req, ctx, { resource }) => {
  const spec = specFor(resource, 'PATCH')
  if (!spec) return notFound()
  const body = await req.json().catch(() => ({}))
  if (!isUuid(body.id)) return notFound()
  let row, dayRows
  try {
    // recurring blocks are always sent whole: their span fields are validated together
    row = spec.validate(body, resource !== 'recurring-blocks', await ownerTimezone(ctx.db, ctx.userId))
    dayRows = await prepare(resource, body, row, ctx)
  } catch (e) { if (e instanceof Invalid) return bad(e.message); throw e }
  if (resource === 'reply-rules') Object.assign(row, { updated_at: new Date().toISOString() })
  let q = ctx.db.from(spec.table).update(row).eq('id', body.id).eq('owner_user_id', ctx.userId)
  // a decision is made once; cancelling is allowed from any open state
  if (resource === 'exception-requests') q = q.in('status', row.status === 'cancelled' ? ['pending', 'approved'] : ['pending'])
  const { data, error } = await q.select('*').maybeSingle()
  if (error) return dbError(resource, error)
  if (!data) return notFound()
  if (resource === 'recurring-blocks' && await saveDayTimes(ctx, data.id, dayRows)) {
    return NextResponse.json({ error: 'The block was saved, but its per-day times were not. Save again.' }, { status: 500 })
  }
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
