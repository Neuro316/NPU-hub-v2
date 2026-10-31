// src/lib/quick-send.ts
// Quick Send: email documents from the Media Library to a contact, during or after
// a call. Pure logic plus the send orchestration, with every side effect injected
// (database, storage, Resend), so scripts/tests/quick-send.test.mjs loads this file
// directly. No imports on purpose: node's type stripping cannot resolve '@/'.
//
// The documents ARE media_assets rows with files in the 'media-library' bucket.
// hub_quick_send_items (hub_215) marks which ones Quick Send may offer and under
// which category. A resource is offered only while it is marked Available to send,
// is not archived and has a stored file to attach (a link-only asset has none).
//
// Sending: Resend's REST API from the org's Quick Send From address
// (org_settings 'crm_quick_send'), Reply-To the staff member who sends, files
// attached server-side. Resend caps one email at 40 MB AFTER base64 encoding, so
// the check below is on the encoded size, before anything is downloaded or sent.

export const QUICK_SEND_SETTING_KEY = 'crm_quick_send'
export const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails'

/** Resend's limit for one email, attachments included, after base64 encoding. */
export const RESEND_MAX_EMAIL_BYTES = 40 * 1024 * 1024
/** Room kept for the message body and headers. */
export const EMAIL_BODY_RESERVE_BYTES = 256 * 1024
export const MAX_ENCODED_ATTACHMENT_BYTES = RESEND_MAX_EMAIL_BYTES - EMAIL_BODY_RESERVE_BYTES
/** The same limit in raw file bytes, for messages (about 29 MB). */
export const MAX_RAW_ATTACHMENT_BYTES = Math.floor(MAX_ENCODED_ATTACHMENT_BYTES / 4) * 3
export const MAX_RESOURCES_PER_SEND = 10
export const MAX_NOTE_LENGTH = 5000

/** File types Quick Send uploads accept: the media-library bucket's document and image types. */
export const QUICK_SEND_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
}
export const QUICK_SEND_UPLOAD_ACCEPT = '.pdf,.docx,.pptx,.png,.jpg,.jpeg'
/** The media-library bucket's own per-file limit (storage.buckets.file_size_limit). */
export const BUCKET_FILE_LIMIT_BYTES = 100 * 1024 * 1024

export interface QuickSendCategory {
  id: string
  name: string
  sort_order: number
}

export interface QuickSendResource {
  media_asset_id: string
  category_id: string
  name: string
  description: string | null
  mime_type: string | null
  file_size: number | null
  storage_path: string | null
  url: string | null
  available: boolean
  archived_at: string | null
  sends?: number
}

export const base64Size = (bytes: number): number => Math.ceil(Math.max(0, bytes) / 3) * 4

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type SizeCheck = { ok: true; encoded: number } | { ok: false; encoded: number; message: string }

/** Whether these files fit in one email. Sizes are raw file bytes. */
export function checkAttachmentSize(sizes: number[]): SizeCheck {
  const raw = sizes.reduce((s, n) => s + Math.max(0, n || 0), 0)
  const encoded = sizes.reduce((s, n) => s + base64Size(n || 0), 0)
  if (encoded <= MAX_ENCODED_ATTACHMENT_BYTES) return { ok: true, encoded }
  return {
    ok: false,
    encoded,
    message: `These files total ${formatBytes(raw)}. One email can carry about ${formatBytes(MAX_RAW_ATTACHMENT_BYTES)} of attachments. Send fewer files at once.`,
  }
}

/** Offered in Quick Send: marked available, not archived, and has a stored file. */
export function isSelectable(r: Pick<QuickSendResource, 'available' | 'archived_at' | 'storage_path'>): boolean {
  return r.available === true && !r.archived_at && !!r.storage_path
}

/** Resources under their category headings, in category order. Empty categories are left out. */
export function groupByCategory<T extends QuickSendResource>(
  resources: T[], categories: QuickSendCategory[],
): { category: QuickSendCategory; resources: T[] }[] {
  const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  return ordered
    .map(category => ({
      category,
      resources: resources.filter(r => r.category_id === category.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter(g => g.resources.length > 0)
}

export type Selection<T> = { ok: true; selected: T[] } | { ok: false; message: string }

/** The requested resources, each checked against what this org offers. */
export function resolveSelection<T extends QuickSendResource>(requested: unknown, resources: T[]): Selection<T> {
  if (!Array.isArray(requested) || requested.length === 0) return { ok: false, message: 'Select at least one resource to send.' }
  const ids = Array.from(new Set(requested.filter((x): x is string => typeof x === 'string')))
  if (ids.length !== requested.length) return { ok: false, message: 'The selection is not valid. Reopen Quick Send and try again.' }
  if (ids.length > MAX_RESOURCES_PER_SEND) return { ok: false, message: `Send at most ${MAX_RESOURCES_PER_SEND} resources at once.` }
  const selected: T[] = []
  for (const id of ids) {
    const r = resources.find(x => x.media_asset_id === id)
    if (!r || !isSelectable(r)) {
      return { ok: false, message: 'One of the selected resources is no longer available to send. Reopen Quick Send and try again.' }
    }
    selected.push(r)
  }
  return { ok: true, selected }
}

const EXT_LABEL: Record<string, string> = {
  pdf: 'PDF', docx: 'DOCX', doc: 'DOC', pptx: 'PPTX', ppt: 'PPT', xlsx: 'XLSX', xls: 'XLS',
  png: 'PNG', jpg: 'JPG', jpeg: 'JPG', gif: 'GIF', webp: 'WEBP', mp4: 'MP4', mov: 'MOV', txt: 'TXT', csv: 'CSV',
}

/** The short file type shown beside a resource: PDF, DOCX, and so on. */
export function fileTypeLabel(name: string | null | undefined, mime: string | null | undefined): string {
  if (mime && QUICK_SEND_UPLOAD_TYPES[mime]) return QUICK_SEND_UPLOAD_TYPES[mime]
  const ext = String(name || '').split('?')[0].split('.').pop()?.toLowerCase() || ''
  if (ext && EXT_LABEL[ext]) return EXT_LABEL[ext]
  if (mime?.startsWith('image/')) return 'IMAGE'
  if (mime?.startsWith('video/')) return 'VIDEO'
  return 'FILE'
}

/** The attachment's filename: the resource's title, with the file's extension. */
export function attachmentFilename(name: string, storagePath: string | null, mime: string | null): string {
  const clean = String(name || 'Resource').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Resource'
  const fromPath = String(storagePath || '').split('.').pop()?.toLowerCase() || ''
  const ext = EXT_LABEL[fromPath] ? fromPath
    : (Object.entries(QUICK_SEND_UPLOAD_TYPES).find(([m]) => m === mime)?.[1] || '').toLowerCase()
  if (!ext || clean.toLowerCase().endsWith(`.${ext}`) || (ext === 'jpg' && /\.jpe?g$/i.test(clean))) return clean
  return `${clean}.${ext}`
}

export const firstNameOf = (full: string | null | undefined): string => String(full || '').trim().split(/\s+/)[0] || ''

export function defaultQuickSendNote(contactFirstName: string | null | undefined, senderFirstName: string | null | undefined): string {
  const hi = contactFirstName?.trim() ? `Hi ${contactFirstName.trim()},` : 'Hi,'
  const lines = [`${hi} it was great to connect. Here are the resources we spoke about. Let me know if you have any questions.`]
  if (senderFirstName?.trim()) lines.push('', senderFirstName.trim())
  return lines.join('\n')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The send button: "Send 2 resources". On the phone sheet, nothing checked reads as an instruction. */
export function sendButtonLabel(n: number, opts: { sheet?: boolean } = {}): string {
  if (n === 0 && opts.sheet) return 'Select resources to send'
  return `Send ${plural(n, 'resource', 'resources')}`
}

export const attachmentsSelectedLabel = (n: number) => `${plural(n, 'attachment', 'attachments')} selected`

export function isValidEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(v.trim())
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The email itself: the note as written, then the list of what is attached. */
export function buildQuickSendEmail(input: { note: string; fileNames: string[]; fromName: string }): { subject: string; html: string; text: string } {
  const note = input.note.trim()
  const listText = input.fileNames.map(n => `- ${n}`).join('\n')
  const paragraphs = note.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  const listHtml = input.fileNames.map(n => `<li style="margin:0 0 4px">${esc(n)}</li>`).join('')
  const label = input.fileNames.length === 1 ? 'Attached' : `Attached (${input.fileNames.length})`
  return {
    subject: `Resources from ${input.fromName}`,
    text: `${note}\n\n${label}:\n${listText}\n`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2c2c2c">${paragraphs}`
      + `<p style="margin:18px 0 6px;font-size:13px;color:#6b7280">${label}:</p>`
      + `<ul style="margin:0;padding-left:18px;font-size:13px;color:#6b7280">${listHtml}</ul></div>`,
  }
}

export interface QuickSendSettings { from_email: string; from_name: string }

/** The org's Quick Send sender, or null when it has not been set up. */
export function readQuickSendSettings(value: unknown, orgName: string): QuickSendSettings | null {
  const v = (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {}
  const email = typeof v.from_email === 'string' ? v.from_email.trim() : ''
  if (!isValidEmail(email)) return null
  const name = typeof v.from_name === 'string' && v.from_name.trim() ? v.from_name.trim() : orgName
  return { from_email: email, from_name: name.replace(/[<>"\r\n]/g, '').slice(0, 80) || 'Quick Send' }
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface ResendAttachment { filename: string; content: string }
export interface ResendPayload {
  from: string
  to: string[]
  reply_to?: string
  subject: string
  html: string
  text: string
  attachments: ResendAttachment[]
  tags: { name: string; value: string }[]
}
export type ResendResult = { ok: true; id: string } | { ok: false; status: number; name: string; message: string }

/** POST one email to Resend. The key is passed in and never logged. */
export async function postResendEmail(
  fetchImpl: typeof fetch, apiKey: string, payload: ResendPayload, idempotencyKey: string,
): Promise<ResendResult> {
  let res: Response
  try {
    res = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    })
  } catch (e: any) {
    return { ok: false, status: 0, name: 'network_error', message: String(e?.name || 'Error') }
  }
  const json: any = await res.json().catch(() => ({}))
  if (res.ok && typeof json?.id === 'string') return { ok: true, id: json.id }
  return { ok: false, status: res.status, name: String(json?.name || ''), message: String(json?.message || '').slice(0, 300) }
}

/** What staff read when Resend refuses. Nothing was sent in every case. */
export function resendErrorMessage(r: Extract<ResendResult, { ok: false }>, fromEmail: string): string {
  const domain = fromEmail.split('@')[1] || fromEmail
  if (r.status === 403 || /not verified|verify/i.test(r.message)) {
    return `The sending domain ${domain} is not verified in Resend yet, so nothing was sent. An admin needs to finish its DNS setup.`
  }
  if (r.status === 413 || /too large|size/i.test(r.message)) {
    return `The attachments are too large for one email, so nothing was sent. Send fewer files at once.`
  }
  if (r.status === 429) return 'Too many emails were sent in a short time. Wait a minute and try again. Nothing was sent.'
  if (r.status === 0) return 'Could not reach the email service. Check the connection and try again. Nothing was sent.'
  return `The email service refused the message (${r.status || 'error'}), so nothing was sent. Try again, or contact an admin.`
}

export interface QuickSendInput {
  orgId: string
  userId: string
  contactId: string
  mediaAssetIds: unknown
  toEmail: unknown
  note: unknown
}

export interface QuickSendContact { id: string; org_id: string; first_name: string | null; email: string | null }
export interface QuickSendSender { name: string; email: string | null }

export interface QuickSendSendRow {
  org_id: string
  batch_id: string
  contact_id: string
  media_asset_id: string
  category_id: string
  asset_name: string
  file_size: number | null
  to_email: string
  note: string | null
  sent_by: string
  sender_email: string | null
  status: 'sent' | 'failed'
  resend_message_id: string | null
  error: string | null
  sent_at: string
}

export interface QuickSendTimelineRow {
  org_id: string
  contact_id: string
  event_type: 'quick_send'
  title: string
  description: string
  metadata: Record<string, unknown>
  source_table: 'hub_quick_send_sends'
  actor_type: 'user'
  actor_id: string
  occurred_at: string
}

export interface QuickSendDeps {
  loadContact(orgId: string, contactId: string): Promise<QuickSendContact | null>
  loadResources(orgId: string): Promise<QuickSendResource[]>
  loadSettings(orgId: string): Promise<QuickSendSettings | null>
  loadSender(orgId: string, userId: string): Promise<QuickSendSender>
  /** The stored file's bytes, or null when it cannot be read. */
  download(storagePath: string): Promise<Uint8Array | null>
  sendEmail(payload: ResendPayload, idempotencyKey: string): Promise<ResendResult>
  insertSends(rows: QuickSendSendRow[]): Promise<{ error?: string | null }>
  insertTimeline(row: QuickSendTimelineRow): Promise<{ error?: string | null }>
  newId(): string
  now(): string
}

export type QuickSendOutcome =
  | { status: 200; body: { ok: true; batch_id: string; sent: number; to: string; warning?: string } }
  | { status: 400 | 404 | 409 | 413 | 502 | 503; body: { error: string } }

const toBase64 = (bytes: Uint8Array): string => {
  // Buffer on the server; the browser path never runs this.
  const B = (globalThis as any).Buffer
  if (B) return B.from(bytes).toString('base64')
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export interface QuickSendRequest {
  org_id: string
  contact_id: string
  media_asset_ids: string[]
  to_email: string
  note: string
}
export type QuickSendResponse = { ok: true; sent: number; to: string; warning?: string } | { ok: false; error: string }

/** The browser's side of a send: one POST, nothing else. It touches no call state. */
export async function submitQuickSend(fetchImpl: typeof fetch, req: QuickSendRequest): Promise<QuickSendResponse> {
  try {
    const res = await fetchImpl('/api/quick-send/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const json: any = await res.json().catch(() => ({}))
    if (res.ok && json?.ok) return { ok: true, sent: Number(json.sent) || 0, to: String(json.to || req.to_email), ...(json.warning ? { warning: String(json.warning) } : {}) }
    return { ok: false, error: String(json?.error || `Quick Send failed (${res.status}). Check the contact's timeline before sending again.`) }
  } catch {
    // The request may or may not have reached the server, so do not claim either.
    return { ok: false, error: 'The connection dropped. Check the contact\'s timeline before sending again.' }
  }
}

/**
 * One Quick Send. Checks the contact, the sender setup, the selection and the size
 * before reading any file, then sends one email with every file attached. On
 * success it writes one send record per resource and one timeline entry; on a
 * refused send it writes the records as failed and no timeline entry.
 */
export async function runQuickSend(deps: QuickSendDeps, input: QuickSendInput): Promise<QuickSendOutcome> {
  const toEmail = typeof input.toEmail === 'string' ? input.toEmail.trim() : ''
  if (!isValidEmail(toEmail)) return { status: 400, body: { error: 'Enter a valid email address to send to.' } }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > MAX_NOTE_LENGTH) return { status: 400, body: { error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` } }

  const contact = await deps.loadContact(input.orgId, input.contactId)
  if (!contact || contact.org_id !== input.orgId) return { status: 404, body: { error: 'That contact was not found in this organization.' } }

  const settings = await deps.loadSettings(input.orgId)
  if (!settings) {
    return { status: 409, body: { error: 'Quick Send has no From address yet. An admin can set it in CRM Settings, Quick Send Resources.' } }
  }

  const selection = resolveSelection(input.mediaAssetIds, await deps.loadResources(input.orgId))
  if (!selection.ok) return { status: 400, body: { error: selection.message } }
  const selected = selection.selected

  const known = checkAttachmentSize(selected.map(r => r.file_size || 0))
  if (!known.ok) return { status: 413, body: { error: known.message } }

  const files: { r: QuickSendResource; bytes: Uint8Array }[] = []
  for (const r of selected) {
    const bytes = await deps.download(r.storage_path as string)
    if (!bytes) return { status: 502, body: { error: `"${r.name}" could not be read from the Media Library, so nothing was sent. Try again.` } }
    files.push({ r, bytes })
  }
  const actual = checkAttachmentSize(files.map(f => f.bytes.byteLength))
  if (!actual.ok) return { status: 413, body: { error: actual.message } }

  const sender = await deps.loadSender(input.orgId, input.userId)
  const batchId = deps.newId()
  const fileNames = files.map(f => attachmentFilename(f.r.name, f.r.storage_path, f.r.mime_type))
  const email = buildQuickSendEmail({ note: note || defaultQuickSendNote(contact.first_name, firstNameOf(sender.name)), fileNames, fromName: settings.from_name })
  const payload: ResendPayload = {
    from: `${settings.from_name} <${settings.from_email}>`,
    to: [toEmail],
    ...(sender.email && isValidEmail(sender.email) ? { reply_to: sender.email } : {}),
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: files.map((f, i) => ({ filename: fileNames[i], content: toBase64(f.bytes) })),
    tags: [{ name: 'kind', value: 'quick_send' }, { name: 'batch', value: batchId.replace(/[^A-Za-z0-9_-]/g, '') }],
  }

  const result = await deps.sendEmail(payload, `quick-send-${batchId}`)
  const at = deps.now()
  const rows: QuickSendSendRow[] = files.map((f, i) => ({
    org_id: input.orgId,
    batch_id: batchId,
    contact_id: contact.id,
    media_asset_id: f.r.media_asset_id,
    category_id: f.r.category_id,
    asset_name: fileNames[i],
    file_size: f.bytes.byteLength,
    to_email: toEmail,
    note: note || null,
    sent_by: input.userId,
    sender_email: sender.email,
    status: result.ok ? 'sent' : 'failed',
    resend_message_id: result.ok ? result.id : null,
    error: result.ok ? null : `${result.status} ${result.name}`.trim().slice(0, 200),
    sent_at: at,
  }))

  if (!result.ok) {
    await deps.insertSends(rows)
    return { status: 502, body: { error: resendErrorMessage(result, settings.from_email) } }
  }

  const { error: sendsErr } = await deps.insertSends(rows)
  const { error: tlErr } = await deps.insertTimeline({
    org_id: input.orgId,
    contact_id: contact.id,
    event_type: 'quick_send',
    title: `Quick Send: ${plural(files.length, 'resource', 'resources')} emailed`,
    description: `${fileNames.join(', ')}. Sent by ${sender.name || sender.email || 'a team member'} to ${toEmail}.`,
    metadata: {
      batch_id: batchId,
      resources: files.map((f, i) => ({ media_asset_id: f.r.media_asset_id, name: fileNames[i] })),
      to: toEmail,
      sender_name: sender.name,
      sender_email: sender.email,
      resend_message_id: result.id,
    },
    source_table: 'hub_quick_send_sends',
    actor_type: 'user',
    actor_id: input.userId,
    occurred_at: at,
  })
  const warning = sendsErr || tlErr ? 'The email was sent, but its record on the contact could not be saved.' : undefined
  return { status: 200, body: { ok: true, batch_id: batchId, sent: files.length, to: toEmail, ...(warning ? { warning } : {}) } }
}
