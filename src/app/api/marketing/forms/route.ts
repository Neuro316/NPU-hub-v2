// POST /api/marketing/forms   (staff)
// Forms are data (ruling 12). { org_id, id?, slug, name, status, fields, consents,
// source_key, success_message }. Publishing runs definitionProblems first, so a
// published form can always produce a contact and always holds the exact consent
// text it will display. Editing a form bumps its version; submissions record which
// version they answered.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { checkForm } from '@/lib/marketing/validate/form'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  // the same checks the Campaign Builder agent runs (src/lib/marketing/validate/form.ts)
  const check = checkForm(b)
  if (!check.ok) return bad(check.message, check.extra)
  const row = { org_id: org, ...check.row, updated_at: new Date().toISOString() }
  if (b.id) {
    const { data: cur } = await ctx.db.from('form_definitions').select('version').eq('id', b.id).eq('org_id', org).maybeSingle()
    if (!cur) return NextResponse.json({ error: 'That form was not found.' }, { status: 404 })
    const { data, error } = await ctx.db.from('form_definitions').update({ ...row, version: cur.version + 1 }).eq('id', b.id).eq('org_id', org).select('*')
    if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: error?.code === '23505' ? 'Another form already uses that address.' : 'The form could not be saved.' }, { status: 500 })
    return NextResponse.json({ form: data![0] })
  }
  const { data, error } = await ctx.db.from('form_definitions').insert({ ...row, created_by: ctx.userId }).select('*')
  if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: error?.code === '23505' ? 'Another form already uses that address.' : 'The form could not be saved.' }, { status: error?.code === '23505' ? 409 : 500 })
  return NextResponse.json({ form: data![0] })
})
