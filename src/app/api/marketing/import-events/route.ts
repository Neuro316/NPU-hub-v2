// POST /api/marketing/import-events   (staff of the org running the import)
//
// Three actions, all for the CRM import page:
//   guard   before an import updates existing (duplicate) contacts: entry events raised
//           for them while the import runs are skipped, so a plain import or merge can
//           never enroll anyone.
//   release once the import is done, closes that guard.
//   enroll  ONLY when the person running the import ticked "start campaigns for these
//           contacts": queues one import:<name> entry event per contact. The campaign
//           cron enrolls them through public.route_and_enroll, capped per run, and every
//           message still goes through the send gate. Nothing here touches consent.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { slugPart } from '@/lib/marketing/ui-logic'
import { guardContacts, releaseGuard, IMPORT_ENROLL_MAX, ENTRY_CAP_PER_RUN, ENTRY_RUN_MINUTES } from '@/lib/marketing/entry-events'
import { withJobRun } from '@/lib/marketing/job-runs'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function ids(v: unknown): string[] {
  return Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))) : []
}

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db
  const contactIds = ids(b?.contact_ids)

  if (b?.action === 'guard' || b?.action === 'release') {
    if (contactIds.length > 5000) return bad('Too many contacts in one request.')
    const { data: own } = contactIds.length
      ? await db.from('contacts').select('id').eq('org_id', org).in('id', contactIds)
      : { data: [] as Array<{ id: string }> }
    const mine = (own ?? []).map((c: any) => c.id as string)
    if (b.action === 'release') { await releaseGuard(db, mine, 'import_merge'); return NextResponse.json({ released: mine.length }) }
    const ok = await guardContacts(db, org, mine, 'import_merge', 60)
    if (!ok) return NextResponse.json({ error: 'Could not pause campaign entry for the contacts this import updates, so nothing was imported. Try again.' }, { status: 500 })
    return NextResponse.json({ guarded: mine.length })
  }

  if (b?.action !== 'enroll') return bad('Unknown action.')
  const batchId = typeof b?.batch_id === 'string' && UUID.test(b.batch_id) ? b.batch_id : null
  const name = slugPart(String(b?.name ?? ''))
  if (!batchId) return bad('The import batch is missing.')
  if (!name) return bad('Give the import a name so a campaign can listen for it.')
  const sourceKey = `import:${name}`

  const { data: batch } = await db.from('contact_import_batches').select('id').eq('id', batchId).eq('org_id', org).maybeSingle()
  if (!batch) return bad('That import was not found in this organization.')
  const { data: engine } = await db.rpc('hub_flag', { p_org: org, p_key: 'engine' })
  if (engine !== 'on') return NextResponse.json({ queued: 0, message: 'Nothing was started: the campaign engine is switched off for this organization.' })
  const { data: routes } = await db.from('campaign_routes').select('id').eq('org_id', org).eq('source_key', sourceKey).eq('active', true).limit(1)
  if (!routes?.length) return NextResponse.json({ queued: 0, message: `Nothing was started: no active campaign starts from the import "${name.replace(/-/g, ' ')}". Pick that import name in a funnel's starting point first.` })

  // the batch's new contacts, plus the existing ones this import merged into
  const fromBatch = await db.from('contacts').select('id').eq('org_id', org).eq('import_batch_id', batchId).is('merged_into_id', null).limit(IMPORT_ENROLL_MAX + 1)
  const fromMerge = contactIds.length
    ? await db.from('contacts').select('id').eq('org_id', org).in('id', contactIds.slice(0, IMPORT_ENROLL_MAX + 1)).is('merged_into_id', null)
    : { data: [] as Array<{ id: string }> }
  const all = Array.from(new Set([...(fromBatch.data ?? []), ...(fromMerge.data ?? [])].map((c: any) => c.id as string)))
  if (all.length > IMPORT_ENROLL_MAX) {
    return bad(`This import has ${all.length} contacts. At most ${IMPORT_ENROLL_MAX} can be started into campaigns from one import, so none were. Split the file and import it in parts.`)
  }
  if (!all.length) return NextResponse.json({ queued: 0, message: 'No imported contacts were found to start.' })

  const r = await withJobRun(db, 'import-enroll', async () => {
    const rows = all.map((id) => ({ org_id: org, contact_id: id, source_key: sourceKey, event_id: `import_completed:${batchId}:${id}`, origin: 'import' }))
    const { data, error } = await db.from('entry_events').upsert(rows, { onConflict: 'org_id,source_key,event_id', ignoreDuplicates: true }).select('id')
    if (error) throw new Error(`queue failed: ${error.code ?? 'unknown'}`)
    const queued = data?.length ?? 0
    return { rows: queued, detail: { summary: `import ${batchId} "${name}": ${queued} of ${all.length} contacts queued for campaign entry (${all.length - queued} already queued)`, queued, total: all.length } }
  }).catch(() => null)
  if (!r) return NextResponse.json({ error: 'The contacts were imported, but starting them into campaigns failed. Nothing was sent.' }, { status: 500 })

  const queued = Number(r.detail?.queued ?? 0)
  const minutes = Math.ceil(queued / ENTRY_CAP_PER_RUN) * ENTRY_RUN_MINUTES
  return NextResponse.json({ queued, message: `${queued} contacts will be started into campaigns that listen for "${name.replace(/-/g, ' ')}", ${ENTRY_CAP_PER_RUN} every ${ENTRY_RUN_MINUTES} minutes, within about ${minutes} minutes. Nothing is sent that the send checks would refuse.` })
})
