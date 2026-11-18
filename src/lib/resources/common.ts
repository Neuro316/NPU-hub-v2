// src/lib/resources/common.ts
// Constants shared by the Resource Library routes (Build 2).

export const RESOURCE_BUCKET = 'hub-resources'
export const RESOURCE_MAX_BYTES = 50 * 1024 * 1024
export const RESOURCE_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]
export const RESOURCE_COLS = 'id, name, description, kind, url, owner_id, where_used, file_name, mime_type, size_bytes, is_default_followup, sort_order, archived_at, created_at'

/** Resource kinds (hub_240). A row is a file (storage_path set) or a link (url set), never both. */
export const RESOURCE_KINDS = ['booking_link', 'checkout_link', 'quiz', 'program_page', 'video', 'pdf', 'artifact', 'other'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]
export const KIND_LABEL: Record<ResourceKind, string> = {
  booking_link: 'Booking link', checkout_link: 'Checkout link', quiz: 'Quiz', program_page: 'Program page',
  video: 'Video', pdf: 'PDF', artifact: 'Artifact', other: 'Other',
}
export const isKind = (v: unknown): v is ResourceKind => typeof v === 'string' && (RESOURCE_KINDS as readonly string[]).includes(v)
/** The kind a new file gets from its type. */
export const kindForMime = (mime: string): ResourceKind => (mime === 'application/pdf' ? 'pdf' : 'other')
/** A link resource's URL: https only, no spaces, at most 2000 characters (mirrors hub_resources_url_check). */
export function cleanLinkUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const u = v.trim()
  if (u.length > 2000 || !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^\s]*)?$/.test(u)) return null
  try { return new URL(u).protocol === 'https:' ? u : null } catch { return null }
}
export const ONLY_SUPERADMIN = 'The Resource Library is for superadmins.'
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

/** A storage-safe file name: letters, digits, dot, dash and underscore, at most 120 chars. */
export function safeFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '')
  return (base || 'file').slice(-120)
}
