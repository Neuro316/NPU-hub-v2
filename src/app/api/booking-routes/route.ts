// GET    /api/booking-routes?org_id=        appointment types, board pipelines and routes
// PUT    /api/booking-routes {org_id, appointment_type_id, pipeline_id, stage_name,
//                             create_contact_if_missing, move_earlier_stages_only}
// DELETE /api/booking-routes?org_id=&appointment_type_id=
//
// Settings › Booking routes (Build 1). Superadmin only, and only inside an org the caller
// is a member of. nr_booking_pipeline_routes is the platform's shared "booking link to Hub
// pipeline" config; the Hub writes its rows (ruled 2026-11-02), never its schema, and
// leaves tag_on_submit and custom_field_map as they are. pipeline_id is the board's id
// from org_settings.crm_pipelines, the value contacts.pipeline_id holds.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad, type StaffContext } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

const ROUTE_COLS = 'id, appointment_type_id, pipeline_id, pipeline_name, stage_name, move_earlier_stages_only, create_contact_if_missing, updated_at'
const ONLY_SUPERADMIN = 'Booking routes are managed by superadmins.'
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

async function pipelinesFor(ctx: StaffContext, orgId: string) {
  const { data, error } = await ctx.db.from('org_settings').select('setting_value')
    .eq('org_id', orgId).eq('setting_key', 'crm_pipelines').maybeSingle()
  if (error) return null
  const list = (data?.setting_value as any)?.pipelines
  return (Array.isArray(list) ? list : [])
    .filter((p: any) => p && typeof p.id === 'string')
    .map((p: any) => ({
      id: p.id as string,
      name: String(p.name ?? p.id),
      stages: (Array.isArray(p.stages) ? p.stages : []).map((s: any) => String(s?.name ?? '')).filter(Boolean) as string[],
    }))
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  const [types, routes, pipelines] = await Promise.all([
    ctx.db.from('nr_appointment_types').select('id, name, retired_at').eq('org_id', orgId).order('name'),
    ctx.db.from('nr_booking_pipeline_routes').select(ROUTE_COLS).eq('org_id', orgId),
    pipelinesFor(ctx, orgId),
  ])
  if (types.error || routes.error || !pipelines) return NextResponse.json({ error: 'Booking routes could not be loaded.' }, { status: 500 })
  return NextResponse.json({
    types: (types.data ?? []).map(t => ({ id: t.id, name: t.name, retired: !!t.retired_at })),
    pipelines,
    routes: routes.data ?? [],
  })
})

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  if (!isUuid(body.appointment_type_id)) return bad('Choose an appointment type.')
  if (typeof body.pipeline_id !== 'string' || !body.pipeline_id) return bad('Choose a pipeline.')
  if (typeof body.stage_name !== 'string' || !body.stage_name.trim()) return bad('Choose a stage.')
  if (typeof body.create_contact_if_missing !== 'boolean' || typeof body.move_earlier_stages_only !== 'boolean') {
    return bad('Both switches must be on or off.')
  }

  const { data: type } = await ctx.db.from('nr_appointment_types').select('id')
    .eq('id', body.appointment_type_id).eq('org_id', orgId).maybeSingle()
  if (!type) return NextResponse.json({ error: 'Appointment type not found.' }, { status: 404 })
  const pipelines = await pipelinesFor(ctx, orgId)
  const pipeline = pipelines?.find(p => p.id === body.pipeline_id)
  if (!pipeline) return bad('That pipeline does not exist in this organization.')
  const stage = pipeline.stages.find(s => s.trim().toLowerCase() === body.stage_name.trim().toLowerCase())
  if (!stage) return bad('That stage is not in the pipeline.')

  const { data, error } = await ctx.db.from('nr_booking_pipeline_routes').upsert({
    appointment_type_id: type.id, org_id: orgId,
    pipeline_id: pipeline.id, pipeline_name: pipeline.name, stage_name: stage,
    create_contact_if_missing: body.create_contact_if_missing,
    move_earlier_stages_only: body.move_earlier_stages_only,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'appointment_type_id' }).select(ROUTE_COLS).single()
  if (error) return NextResponse.json({ error: 'The route could not be saved.' }, { status: 500 })
  return NextResponse.json({ route: data })
})

export const DELETE = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const sp = req.nextUrl.searchParams
  const orgId = requireOrg(ctx, sp.get('org_id'))
  if (orgId instanceof Response) return orgId
  const typeId = sp.get('appointment_type_id')
  if (!isUuid(typeId)) return bad('Choose an appointment type.')
  const { data, error } = await ctx.db.from('nr_booking_pipeline_routes').delete()
    .eq('org_id', orgId).eq('appointment_type_id', typeId).select('id')
  if (error) return NextResponse.json({ error: 'The route could not be removed.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
