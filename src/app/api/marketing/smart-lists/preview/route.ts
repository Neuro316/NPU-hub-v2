// POST /api/marketing/smart-lists/preview   (staff)
// { org_id, definition }: the live count and the first members, for a list being edited. Saves nothing.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { checkDefinition, members, missingSources } from '@/lib/marketing/smart-lists/match'
import { loadFacts } from '@/lib/marketing/smart-lists/load'

export const dynamic = 'force-dynamic'

const PREVIEW = 25

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const check = checkDefinition(b.definition)
  if (!check.ok) return bad(check.message)
  let facts
  try { facts = await loadFacts(ctx.db, org) } catch (e) {
    console.error(`[smart-lists/preview] ${(e as Error).message}`)
    return NextResponse.json({ error: 'The count could not be worked out. Try again in a moment.' }, { status: 500 })
  }
  const m = members(check.definition, facts, Date.now())
  return NextResponse.json({
    count: m.length,
    email_allowed: m.filter((f) => f.email_allowed).length,
    texting_allowed: m.filter((f) => f.texting_allowed).length,
    no_data_source: missingSources(check.definition),
    preview: m.slice(0, PREVIEW).map((f) => ({
      id: f.contact_id, name: [f.first_name, f.last_name].filter(Boolean).join(' ') || '(no name)', email: f.email,
      pipeline: f.pipeline_name, stage: f.pipeline_stage, current_client: (f.client_reasons ?? []).length > 0,
      email_allowed: f.email_allowed, texting_allowed: f.texting_allowed,
    })),
  })
})
