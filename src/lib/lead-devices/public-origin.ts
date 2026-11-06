// src/lib/lead-devices/public-origin.ts
// The public origin for lead devices, and what may be reached or may frame a device there. Pure, and
// safe to import from middleware. The host is a constant on purpose: an environment variable set to the
// wrong value would take the Hub login off another host.
export const LEAD_DEVICE_HOST = 'start.neuroprogeny.com'
export const LEAD_DEVICE_ORIGIN = `https://${LEAD_DEVICE_HOST}`

/** The internal route folder that requests to the public origin are rewritten into. */
export const LEAD_DEVICE_ROUTE = '/lead-device'

/** Cameron's ruling of 2026-11-06. The University is deliberately absent. */
export const FRAME_ANCESTORS = [
  'https://hub.neuroprogeny.com',
  'https://neuroprogeny.com',
  'https://www.neuroprogeny.com',
  'https://transitions.neuroprogeny.com',
  'https://waynesvilleneuro.com',
  'https://www.waynesvilleneuro.com',
] as const

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SUBPATHS = new Set(['file', 'submit', 'track'])
export const PUBLIC_HTTPS_ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/** Exact match on the host, ignoring case and a port. Nothing else leaves the Hub login. */
export function isLeadDeviceHost(host: string | null | undefined): boolean {
  return (host ?? '').trim().toLowerCase().split(':')[0] === LEAD_DEVICE_HOST
}

/** Pure: the internal path for a public path, or null when the public origin does not serve it. */
export function leadDeviceRoute(pathname: string): string | null {
  const parts = pathname.replace(/^\//, '').split('/')
  if (parts.length > 2 || !SLUG.test(parts[0])) return null
  if (parts.length === 2 && !SUBPATHS.has(parts[1])) return null
  return `${LEAD_DEVICE_ROUTE}/${parts.join('/')}`
}

/** Pure: the frame-ancestors value for a device's page. A manifest entry counts only as a plain https origin. */
export function frameAncestors(embedOrigins: unknown): string {
  const extra = Array.isArray(embedOrigins)
    ? embedOrigins.filter((o): o is string => typeof o === 'string' && PUBLIC_HTTPS_ORIGIN.test(o))
    : []
  return ['frame-ancestors', ...Array.from(new Set([...FRAME_ANCESTORS, ...extra]))].join(' ')
}
