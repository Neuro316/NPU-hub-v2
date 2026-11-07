// src/lib/lead-devices/public-device.ts
// The one gate for the public routes: which device, and which of its versions, a request may see. A live device
// serves its approved live version. Any other state needs a signed preview link minted in the Hub.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEVICE_COLUMNS, type DeviceRow } from './manifest'
import { isLeadDeviceHost } from './public-origin'

const PREVIEW_DAYS = 7

function sign(deviceId: string, versionId: string, exp: string, secret: string) {
  return createHmac('sha256', secret).update(`lead-device-preview:${deviceId}:${versionId}:${exp}`).digest('base64url')
}

/** A preview link for one version ('form' for a form-only device). Null when the signing secret is unset. */
export function mintPreview(deviceId: string, versionId: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.LEAD_INTAKE_SECRET
  if (!secret || secret.trim().length < 32) return null
  const exp = String(Math.floor(now / 1000) + PREVIEW_DAYS * 86400)
  return `${versionId}.${exp}.${sign(deviceId, versionId, exp, secret)}`
}

/** The version a preview token names, or null when it is forged, expired or the secret is unset. */
export function readPreview(token: unknown, deviceId: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.LEAD_INTAKE_SECRET
  if (typeof token !== 'string' || !secret || secret.trim().length < 32) return null
  const [versionId, exp, sig] = token.split('.')
  if (!versionId || !exp || !sig || Number(exp) * 1000 < now) return null
  const want = Buffer.from(sign(deviceId, versionId, exp, secret))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got) ? versionId : null
}

export type Resolved = { device: DeviceRow; versionId: string | null; preview: string | null }

export async function resolvePublicDevice(db: SupabaseClient, slug: string, previewToken: unknown): Promise<Resolved | null> {
  const { data, error } = await db.from('lead_devices').select(DEVICE_COLUMNS).eq('slug', slug).eq('hosting', 'hub').maybeSingle()
  if (error || !data) return null
  const device = data as unknown as DeviceRow
  const previewVersion = readPreview(previewToken, device.id)
  if (previewVersion) return { device, versionId: previewVersion === 'form' ? null : previewVersion, preview: previewToken as string }
  if (device.status !== 'live') return null
  if (device.content === 'html' && !device.live_version_id) return null
  return { device, versionId: device.live_version_id, preview: null }
}

/** These routes answer only on the public origin. On any other host they do not exist. */
export function onPublicOrigin(req: Request): boolean {
  return isLeadDeviceHost(req.headers.get('host'))
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}
