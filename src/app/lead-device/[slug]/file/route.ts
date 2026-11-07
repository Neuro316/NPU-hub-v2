// GET start.neuroprogeny.com/<slug>/file   (PUBLIC)
// The stored file with the window.NPU bridge in front, sandboxed and able to reach nothing.
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { onPublicOrigin, resolvePublicDevice } from '@/lib/lead-devices/public-device'
import { buildNpuBridge, wrapDeviceHtml } from '@/lib/lead-devices/contract'
import { fileCsp, publicHeaders } from '@/lib/lead-devices/player'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!onPublicOrigin(req)) return new NextResponse(null, { status: 404 })
  const db = createAdminSupabase()
  const r = await resolvePublicDevice(db, params.slug, new URL(req.url).searchParams.get('preview'))
  if (!r || !r.versionId) return new NextResponse(null, { status: 404 })
  const { data: version } = await db.from('lead_device_versions').select('storage_path, approved_at').eq('id', r.versionId).eq('device_id', r.device.id).maybeSingle()
  if (!version || (!r.preview && !(version as any).approved_at)) return new NextResponse(null, { status: 404 })
  const { data: file, error } = await db.storage.from('lead-devices').download((version as any).storage_path)
  if (error || !file) {
    console.error(`[lead-device] file read failed device=${r.device.id}`)
    return new NextResponse(null, { status: 500 })
  }
  const html = wrapDeviceHtml(await file.text(), buildNpuBridge(r.device.slug))
  return new NextResponse(html, { status: 200, headers: publicHeaders(fileCsp(r.device.manifest.script_allowlist)) })
}
