// POST /api/marketing/forms   (staff)
// Forms are data (ruling 12). { org_id, id?, slug, name, status, fields, consents,
// source_key, success_message }. Publishing runs definitionProblems first, so a
// published form can always produce a contact and always holds the exact consent
// text it will display. Editing a form bumps its version; submissions record which
// version they answered.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { definitionProblems, type FormDefinition } from '@/lib/marketing/intake'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return bad('The form address uses lower case letters, numbers, and single dashes.')
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return bad('Give the form a name.')
  const status = ['draft', 'published', 'archived'].includes(b.status) ? b.status : 'draft'
  const def: FormDefinition = { fields: Array.isArray(b.fields) ? b.fields : [], consents: Array.isArray(b.consents) ? b.consents : [] }
  if (status === 'published') {
    const problems = definitionProblems(def)
    if (problems.length) return bad('This form cannot be published yet.', { problems })
  }
  const source = typeof b.source_key === 'string' && b.source_key.trim() ? b.source_key.trim().toLowerCase() : `form:${slug}`
  if (!/^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(source)) return bad('The source key uses lower case letters, numbers, and the characters . _ : -')
  const row = { org_id: org, slug, name, status, fields: def.fields, consents: def.consents, source_key: source,
    success_message: typeof b.success_message === 'string' && b.success_message.trim() ? b.success_message.trim() : 'Thank you. Your details have been received.',
    updated_at: new Date().toISOString() }
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
