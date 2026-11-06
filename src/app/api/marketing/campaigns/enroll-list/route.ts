// POST /api/marketing/campaigns/enroll-list   (org admin)
// { org_id, campaign_id }: enters the current members of the campaign's smart list through the
// existing enroll(). The source and event are fixed per list, so a contact enters a campaign once
// per list and pressing this again only adds people who have joined the list since.
// Enrolling sends nothing by itself: each step still goes through gate_check, which applies consent,
// Texting allowed, DNC, suppression, quiet hours, the frequency cap, and dry run or live.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { members, type Definition } from '@/lib/marketing/smart-lists/match'
import { loadFacts } from '@/lib/marketing/smart-lists/load'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can enroll a list.')
  if (typeof b.campaign_id !== 'string') return bad('Say which campaign.')
  const db = ctx.db
  const { data: camp } = await db.from('funnel_campaigns').select('id, status, brand, smart_list_id').eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
  if (!camp) return NextResponse.json({ error: 'That campaign was not found. Reload the page.' }, { status: 404 })
  if (camp.status !== 'active') return bad('Set the campaign to Active on the Campaigns page first.')
  if (!camp.smart_list_id) return bad('Choose a smart list for this campaign first.')
  const { data: list } = await db.from('smart_lists').select('id, brand, definition, archived_at').eq('id', camp.smart_list_id).eq('org_id', org).maybeSingle()
  if (!list || list.archived_at) return bad('The list this campaign targets is archived. Choose another.')
  if (list.brand !== camp.brand) return bad('This list and campaign are for different brands. Choose the list again.')

  let facts
  try { facts = await loadFacts(db, org) } catch (e) {
    console.error(`[enroll-list] ${(e as Error).message}`)
    return NextResponse.json({ error: 'The list could not be read, so nobody was enrolled. Try again in a moment.' }, { status: 500 })
  }
  const key = `smart_list:${list.id}`
  const tally = { enrolled: 0, already: 0, failed: 0 }
  for (const f of members(list.definition as Definition, facts, Date.now())) {
    const { data, error } = await db.rpc('enroll', { p_contact: f.contact_id, p_campaign: camp.id, p_source_key: key, p_event_id: key })
    if (error) { tally.failed++; console.error(`[enroll-list] campaign=${camp.id} contact=${f.contact_id}: ${error.code ?? 'unknown'}`) }
    else if ((data as any)?.enrolled) tally.enrolled++
    else tally.already++
  }
  return NextResponse.json(tally)
})
