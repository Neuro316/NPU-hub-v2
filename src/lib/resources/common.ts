// src/lib/resources/common.ts
// Constants shared by the Resource Library routes (Build 2).

export const RESOURCE_BUCKET = 'hub-resources'
export const RESOURCE_MAX_BYTES = 50 * 1024 * 1024
export const RESOURCE_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]
export const RESOURCE_COLS = 'id, name, description, file_name, mime_type, size_bytes, is_default_followup, sort_order, archived_at, created_at'
export const ONLY_SUPERADMIN = 'The Resource Library is for superadmins.'
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

/** A storage-safe file name: letters, digits, dot, dash and underscore, at most 120 chars. */
export function safeFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '')
  return (base || 'file').slice(-120)
}
