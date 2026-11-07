// /api/marketing/lead-devices   (staff to read, org admin to change, Cameron alone to go live)
// GET  ?org_id=      every device with its numbers, versions, lists, campaigns, readiness and links
// GET  ?org_id=&contact_id=  the Device answers section of a contact card
// POST { org_id, action, id, ... }
//   create             a form-only device, or an external one awaiting its first submission
//   update_manifest    edit name, manifest and pipeline
//   provision          run again what a new device gets, after a failure
//   approve_version    approve a version and make it the one the live link serves
//   rollback           serve an earlier approved version
//   approve_emails     the readiness item for the campaign copy
//   test_drive         the readiness item for the test drive
//   go_live            Cameron only
//   pause              any org admin, so a device can always be stopped
//   link_builder_run   after a Campaign Builder redraft, route the campaign to the new draft
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { getFlags } from '@/lib/marketing/flags'
import { unreviewedAiStepCount } from '@/lib/marketing/ai-review'
import { BRANDS, DEVICE_COLUMNS, TYPES, UTM_CHANNELS, cleanManifest, readiness, slugProblem, sourceKey, type DeviceRow } from '@/lib/lead-devices/manifest'
import { CAMERON_USER_ID } from '@/lib/lead-devices/intake'
import { builderPrompt, provisionDevice } from '@/lib/lead-devices/provision'
import { mintPreview } from '@/lib/lead-devices/public-device'
import { LEAD_DEVICE_ORIGIN } from '@/lib/lead-devices/public-origin'

export const dynamic = 'force-dynamic'

const links = (slug: string) => {
  const url = `${LEAD_DEVICE_ORIGIN}/${slug}`
  return {
    url,
    embed: `<iframe src="${url}" title="${slug}" style="width:100%;height:900px;border:0" loading="lazy"></iframe>`,
    utm: UTM_CHANNELS.map((c) => ({ channel: c, url: `${url}?utm_source=${c}&utm_medium=${c === 'email' ? 'email' : c === 'website' ? 'referral' : 'social'}&utm_campaign=${slug}` })),
  }
}

export const GET = withStaff(async (req, ctx) => {
  const url = new URL(req.url)
  const contactId = url.searchParams.get('contact_id')
  if (contactId) {
    const { data: contact } = await ctx.db.from('contacts').select('org_id').eq('id', contactId).maybeSingle()
    if (!contact) return NextResponse.json({ error: 'That contact was not found.' }, { status: 404 })
    const scoped = requireOrg(ctx, (contact as any).org_id)
    if (typeof scoped !== 'string') return scoped
    const { data, error } = await ctx.db.from('lead_device_submissions')
      .select('id, outcome, outcome_label, answers, question_labels, submitted_at, lead_devices(name, slug)')
      .eq('contact_id', contactId).eq('status', 'accepted').eq('is_test', false).order('submitted_at', { ascending: false }).limit(25)
    if (error) return NextResponse.json({ error: 'The answers could not be loaded.' }, { status: 500 })
    return NextResponse.json({ submissions: data ?? [] })
  }

  const org = requireOrg(ctx, url.searchParams.get('org_id'))
  if (typeof org !== 'string') return org
  const db = ctx.db
  const admin = isOrgAdmin(ctx, org)
  const { data: rows, error } = await db.from('lead_devices').select(`${DEVICE_COLUMNS}, created_at`).eq('org_id', org).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'The devices could not be loaded.' }, { status: 500 })
  const devices = (rows ?? []) as unknown as DeviceRow[]
  const { data: pipelines } = await db.from('pipelines').select('id, name').eq('org_id', org).is('archived_at', null).order('position')
  const flags = await getFlags(db, org)

  const out = await Promise.all(devices.map(async (d) => {
    const countEvents = (event: string) => db.from('lead_device_events').select('id', { count: 'exact', head: true }).eq('device_id', d.id).eq('event', event).eq('is_test', false)
    const countSubs = (test: boolean) => db.from('lead_device_submissions').select('id', { count: 'exact', head: true }).eq('device_id', d.id).eq('status', 'accepted').eq('is_test', test)
    const [views, starts, subs, tests, versions] = await Promise.all([
      countEvents('view'), countEvents('start'), countSubs(false), countSubs(true),
      db.from('lead_device_versions').select('id, version, file_name, size_bytes, inspection, approved_at, created_at').eq('device_id', d.id).order('version', { ascending: false }),
    ])
    const listIds = Object.values(d.assets?.lists ?? {}) as string[]
    const campaignEntries = Object.entries(d.assets?.campaigns ?? {}) as [string, string][]
    const [{ data: lists }, { data: camps }] = await Promise.all([
      listIds.length ? db.from('smart_lists').select('id, name').in('id', listIds) : Promise.resolve({ data: [] as any[] }),
      campaignEntries.length ? db.from('funnel_campaigns').select('id, name, status, live_enabled').in('id', campaignEntries.map(([, id]) => id)) : Promise.resolve({ data: [] as any[] }),
    ])
    const latest = ((versions.data ?? []) as any[])[0]
    const previewVersion = d.content === 'form' ? 'form' : latest?.id
    const preview = admin && d.hosting === 'hub' && previewVersion ? mintPreview(d.id, previewVersion) : null
    const submissions = subs.count ?? 0
    const viewCount = views.count ?? 0
    return {
      ...d,
      links: d.hosting === 'hub' ? links(d.slug) : null,
      preview_url: preview ? `${LEAD_DEVICE_ORIGIN}/${d.slug}?preview=${encodeURIComponent(preview)}` : null,
      stats: { views: viewCount, starts: starts.count ?? 0, submissions, tests: tests.count ?? 0, conversion: viewCount ? submissions / viewCount : null },
      versions: versions.data ?? [],
      pipeline_name: ((pipelines ?? []) as any[]).find((p) => p.id === d.pipeline_id)?.name ?? null,
      lists: lists ?? [],
      campaigns: ((camps ?? []) as any[]).map((c) => ({ ...c, outcome: campaignEntries.find(([, id]) => id === c.id)?.[0] ?? null })),
      readiness: readiness(d, tests.count ?? 0),
    }
  }))
  return NextResponse.json({ devices: out, pipelines: pipelines ?? [], can_edit: admin, can_go_live: ctx.userId === CAMERON_USER_ID, builder: ctx.isSuperadmin && flags.agent_enabled })
})

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can change lead devices.')
  const db = ctx.db
  const failed = (what: string) => NextResponse.json({ error: `The ${what} could not be saved. Try again in a moment.` }, { status: 500 })

  if (b.action === 'create') {
    const problem = slugProblem(b.slug)
    if (problem) return bad(problem)
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return bad('Give the device a name.')
    if (!BRANDS.includes(b.brand) || !TYPES.includes(b.type)) return bad('Choose a brand and a type.')
    const pipelineId = typeof b.pipeline_id === 'string' && b.pipeline_id ? b.pipeline_id : null
    if (pipelineId) {
      const { data: p } = await db.from('pipelines').select('id').eq('id', pipelineId).eq('org_id', org).maybeSingle()
      if (!p) return bad('That pipeline was not found in this organization.')
    }
    const { data, error } = await db.from('lead_devices').insert({
      org_id: org, slug: b.slug, name, brand: b.brand, type: b.type, hosting: b.hosting === 'external' ? 'external' : 'hub', content: 'form',
      manifest: cleanManifest(b.manifest ?? {}, b.brand), pipeline_id: pipelineId, created_by: ctx.userId,
    }).select(DEVICE_COLUMNS).single()
    if (error?.code === '23505') return bad('That device address is already taken.')
    if (error || !data) return failed('device')
    await provisionDevice(db, data as unknown as DeviceRow, ctx.userId)
    return NextResponse.json({ id: (data as any).id })
  }

  if (typeof b.id !== 'string') return bad('Say which device.')
  const { data: row } = await db.from('lead_devices').select(DEVICE_COLUMNS).eq('id', b.id).eq('org_id', org).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That device was not found. Reload the page.' }, { status: 404 })
  const d = row as unknown as DeviceRow
  const stamp = new Date().toISOString()
  const save = async (patch: Record<string, unknown>) => {
    const { data, error } = await db.from('lead_devices').update(patch).eq('id', d.id).eq('org_id', org).select('id')
    return !error && (data?.length ?? 0) === 1
  }

  switch (b.action) {
    case 'update_manifest': {
      const name = typeof b.name === 'string' ? b.name.trim() : d.name
      if (!name) return bad('Give the device a name.')
      return (await save({ name, manifest: cleanManifest(b.manifest ?? {}, d.brand) })) ? NextResponse.json({ ok: true }) : failed('device')
    }
    case 'provision':
      await provisionDevice(db, d, ctx.userId)
      return NextResponse.json({ ok: true })
    case 'approve_version':
    case 'rollback': {
      if (typeof b.version_id !== 'string') return bad('Say which version.')
      const { data: v } = await db.from('lead_device_versions').select('id, approved_at, inspection').eq('id', b.version_id).eq('device_id', d.id).maybeSingle()
      if (!v) return bad('That version was not found.')
      if ((v as any).inspection?.cannotSubmit) return bad('This version has a problem that stops it submitting. Fix the file and upload it again.')
      if (b.action === 'rollback' && !(v as any).approved_at) return bad('Only an approved version can be rolled back to.')
      if (!(v as any).approved_at) {
        const { error } = await db.from('lead_device_versions').update({ approved_at: stamp, approved_by: ctx.userId }).eq('id', (v as any).id)
        if (error) return failed('version')
      }
      return (await save({ live_version_id: (v as any).id })) ? NextResponse.json({ ok: true }) : failed('version')
    }
    case 'approve_emails': {
      const off = b.approved === false
      const assets = { ...d.assets, emails_approved_at: off ? null : stamp, emails_approved_by: off ? null : ctx.userId }
      return (await save({ assets })) ? NextResponse.json({ ok: true }) : failed('approval')
    }
    case 'test_drive': {
      const off = b.passed === false
      return (await save({ test_drive_passed_at: off ? null : stamp, test_drive_passed_by: off ? null : ctx.userId })) ? NextResponse.json({ ok: true }) : failed('test drive')
    }
    case 'go_live': {
      if (ctx.userId !== CAMERON_USER_ID) return forbidden('Only Cameron can switch a lead device live.')
      const { count: tests } = await db.from('lead_device_submissions').select('id', { count: 'exact', head: true }).eq('device_id', d.id).eq('is_test', true).eq('status', 'accepted')
      const r = readiness(d, tests ?? 0)
      if (!r.test_submission || !r.emails_approved || !r.test_drive) return bad('Finish the readiness checklist first.', { readiness: r })
      if (!d.provisioned_at) return bad('This device has not finished its setup. Run it again from its page.')
      if (d.hosting === 'hub' && d.content === 'html' && !d.live_version_id) return bad('Approve a version first.')
      const campaignIds = Object.values(d.assets?.campaigns ?? {}) as string[]
      const { data: seqs } = campaignIds.length ? await db.from('funnel_campaigns').select('sequence_id').in('id', campaignIds) : { data: [] as any[] }
      const pending = await unreviewedAiStepCount(db, (seqs ?? []).map((s: any) => s.sequence_id).filter(Boolean))
      if (pending === null) return NextResponse.json({ error: 'The campaign steps could not be checked. Try again in a moment.' }, { status: 503 })
      if (pending > 0) return bad(`${pending} ${pending === 1 ? 'step was' : 'steps were'} drafted by the Campaign Builder and not reviewed. Approve them on the campaign first.`)
      if (campaignIds.length) {
        // live_enabled stays as it is: real sends still need each campaign's own switch and gate_live_sends.
        const { error } = await db.from('funnel_campaigns').update({ status: 'active', updated_at: stamp }).in('id', campaignIds).in('status', ['draft', 'paused'])
        if (error) return failed('campaigns')
        const { error: rErr } = await db.from('campaign_routes').update({ active: true }).eq('org_id', org).in('campaign_id', campaignIds)
        if (rErr) return failed('campaign routes')
      }
      console.info(`[lead-device] device=${d.id} live by=${ctx.userId}`)
      return (await save({ status: 'live', went_live_at: stamp, went_live_by: ctx.userId })) ? NextResponse.json({ ok: true }) : failed('device')
    }
    case 'pause': {
      const campaignIds = Object.values(d.assets?.campaigns ?? {}) as string[]
      if (campaignIds.length) {
        const { error } = await db.from('campaign_routes').update({ active: false }).eq('org_id', org).in('campaign_id', campaignIds)
        if (error) return failed('campaign routes')
      }
      console.info(`[lead-device] device=${d.id} paused by=${ctx.userId}`)
      return (await save({ status: 'paused' })) ? NextResponse.json({ ok: true }) : failed('device')
    }
    case 'builder_prompt': {
      const outcome = d.manifest.outcomes.find((o) => o.key === b.outcome) ?? null
      return NextResponse.json({ prompt: builderPrompt(d, outcome) })
    }
    case 'link_builder_run': {
      const key = typeof b.outcome === 'string' ? b.outcome : ''
      const oldId = d.assets?.campaigns?.[key]
      if (!oldId) return bad('That campaign was not found on this device.')
      const { data: run } = await db.from('agent_runs').select('created_ids').eq('id', b.run_id).eq('org_id', org).eq('outcome', 'built').maybeSingle()
      const newId = (run as any)?.created_ids?.campaign
      if (!newId) return bad('That draft has not been built.')
      const source = sourceKey(d.slug, key === '_none' ? null : key)
      const { error: dErr } = await db.from('campaign_routes').delete().eq('org_id', org).eq('source_key', source)
      if (dErr) return failed('campaign route')
      const { error: iErr } = await db.from('campaign_routes').insert({ org_id: org, source_key: source, campaign_id: newId, active: false, activate_with_campaign: false })
      if (iErr) return failed('campaign route')
      await db.from('funnel_campaigns').update({ status: 'archived', updated_at: stamp }).eq('id', oldId).eq('org_id', org).eq('status', 'draft')
      const assets = { ...d.assets, campaigns: { ...d.assets.campaigns, [key]: newId }, emails_approved_at: null, emails_approved_by: null }
      return (await save({ assets })) ? NextResponse.json({ ok: true }) : failed('device')
    }
    default:
      return bad('Unknown action.')
  }
})
