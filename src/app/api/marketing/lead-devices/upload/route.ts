// POST /api/marketing/lead-devices/upload   (org admin; multipart)
// One self-contained HTML file, up to 2 MB. Fields: org_id, file, and either device_id (a new version of that
// device) or name, slug, brand, type, manifest (JSON) and pipeline_id (a new device). Stored byte for byte in the
// private bucket. A new version serves nobody until someone approves it, so re-uploading never changes the live link.
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { BRANDS, DEVICE_COLUMNS, TYPES, cleanManifest, slugProblem, type DeviceRow } from '@/lib/lead-devices/manifest'
import { MAX_DEVICE_BYTES, inspectDevice } from '@/lib/lead-devices/inspect'
import { provisionDevice } from '@/lib/lead-devices/provision'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const form = await req.formData().catch(() => null)
  if (!form) return bad('Choose a file to upload.')
  const org = requireOrg(ctx, form.get('org_id'))
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can upload a lead device.')
  const db = ctx.db

  const file = form.get('file')
  if (!(file instanceof File)) return bad('Choose a file to upload.')
  if (!/\.html?$/i.test(file.name)) return bad('Upload one .html file with its CSS and JavaScript inline.')
  if (file.size === 0) return bad('That file is empty.')
  if (file.size > MAX_DEVICE_BYTES) return bad('That file is over the 2 MB limit.')
  const html = await file.text()
  const inspection = inspectDevice(html)

  let device: DeviceRow
  let isNew = false
  const deviceId = form.get('device_id')
  if (typeof deviceId === 'string' && deviceId) {
    const { data } = await db.from('lead_devices').select(DEVICE_COLUMNS).eq('id', deviceId).eq('org_id', org).maybeSingle()
    if (!data) return NextResponse.json({ error: 'That device was not found. Reload the page.' }, { status: 404 })
    device = data as unknown as DeviceRow
    if (device.hosting !== 'hub' || device.content !== 'html') return bad('This device does not use an uploaded file.')
  } else {
    const slug = form.get('slug')
    const problem = slugProblem(slug)
    if (problem) return bad(problem)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return bad('Give the device a name.')
    const brand = form.get('brand') as any, type = form.get('type') as any
    if (!BRANDS.includes(brand) || !TYPES.includes(type)) return bad('Choose a brand and a type.')
    let manifest: unknown = {}
    try { manifest = JSON.parse(String(form.get('manifest') ?? '{}')) } catch { return bad('The manifest could not be read.') }
    const pipelineId = String(form.get('pipeline_id') ?? '') || null
    if (pipelineId) {
      const { data: p } = await db.from('pipelines').select('id').eq('id', pipelineId).eq('org_id', org).maybeSingle()
      if (!p) return bad('That pipeline was not found in this organization.')
    }
    const { data, error } = await db.from('lead_devices').insert({
      org_id: org, slug, name, brand, type, hosting: 'hub', content: 'html',
      manifest: cleanManifest(manifest, brand), pipeline_id: pipelineId, created_by: ctx.userId,
    }).select(DEVICE_COLUMNS).single()
    if (error?.code === '23505') return bad('That device address is already taken.')
    if (error || !data) return NextResponse.json({ error: 'The device could not be saved. Try again in a moment.' }, { status: 500 })
    device = data as unknown as DeviceRow
    isNew = true
  }

  const { data: last } = await db.from('lead_device_versions').select('version').eq('device_id', device.id).order('version', { ascending: false }).limit(1)
  const version = (((last ?? [])[0] as any)?.version ?? 0) + 1
  const bytes = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const storagePath = `${org}/${device.id}/v${version}-${sha256.slice(0, 12)}.html`
  const { error: upErr } = await db.storage.from('lead-devices').upload(storagePath, bytes, { contentType: 'text/html', upsert: false })
  if (upErr) {
    console.error(`[lead-device] upload failed device=${device.id}: ${upErr.message}`)
    return NextResponse.json({ error: 'The file could not be stored. Try again in a moment.' }, { status: 500 })
  }
  const { data: row, error: vErr } = await db.from('lead_device_versions').insert({
    org_id: org, device_id: device.id, version, storage_path: storagePath, file_name: file.name.slice(0, 255),
    size_bytes: file.size, sha256, inspection, uploaded_by: ctx.userId,
  }).select('id, version').single()
  if (vErr || !row) {
    await db.storage.from('lead-devices').remove([storagePath])
    return NextResponse.json({ error: vErr?.code === '23505' ? 'Someone else uploaded at the same moment. Try again.' : 'The version could not be saved. Try again in a moment.' }, { status: vErr?.code === '23505' ? 409 : 500 })
  }
  if (isNew) await provisionDevice(db, device, ctx.userId)
  return NextResponse.json({ id: device.id, version: (row as any).version, version_id: (row as any).id, inspection })
})
