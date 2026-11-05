// GET  /api/resources/send?contact_id=   the Send resources panel (contact card and in-call):
//                                        active resources, the mailboxes the caller may send
//                                        from with the default one, and earlier sends
// POST /api/resources/send {contact_id, mailbox_id, resource_ids, subject, note, send}
//                                        send=false: the preview (no links minted, nothing
//                                        stored); send=true: sends one email from that
//                                        mailbox and records it
//
// Build 2 (docs/plans/hub-resource-library-rulings.md). Platform superadmin and a member
// of the CONTACT's org (the org comes from the contact row). Sending also needs the mailbox
// rule (canSee): a private mailbox is usable only by its owner, a shared one by any
// superadmin of its org. "Send from" lists only those, and the POST checks the chosen
// mailbox again. A person presses Send; nothing here runs on a schedule.
//
// HARD RULE: the note, file contents, signed URLs and tokens are never stored or logged,
// and never appear in an error message.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad, type StaffContext } from '@/lib/api-guard'
import { listVisible, loadVisible, accessTokenFor, refreshTokenFor, safeMessage, type MailConnectionRow } from '@/lib/mail/google'
import { isUsableEmail } from '@/lib/contacts/match'
import { RESOURCE_BUCKET, ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'
import { splitFiles, emailBodies, linkExpiry, defaultFrom, LINK_DAYS, DEFAULT_SUBJECT, DEFAULT_NOTE } from '@/lib/resources/plan'
import { buildMime, gmailSendRaw } from '@/lib/resources/send'
import { thumbUrls } from '@/lib/resources/thumb-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ResourceRow { id: string; name: string; file_name: string; mime_type: string; size_bytes: number; storage_path: string; is_default_followup: boolean }

async function loadContact(ctx: StaffContext, contactId: unknown) {
  if (!isUuid(contactId)) return null
  const { data } = await ctx.db.from('contacts').select('id, org_id, first_name, last_name, email').eq('id', contactId).maybeSingle()
  return data
}

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const NO_MAILBOX = 'No mailbox you can send from is connected. Connect one in Settings › Mailboxes.'

/** Why a mailbox the caller can see cannot send, or null when it can. */
function sendBlock(row: MailConnectionRow): string | null {
  if (row.status !== 'active') return `${row.email_address} needs reconnecting in Settings › Mailboxes.`
  if (!row.scopes.includes(SEND_SCOPE)) return `${row.email_address} was connected without send access.`
  return null
}

/** "Send from": every mailbox the caller may see (canSee), each with whether it can send. */
async function fromOptions(ctx: StaffContext) {
  const rows = (await listVisible(ctx)) ?? []
  return rows.map(r => ({ id: r.id, email_address: r.email_address, visibility: r.visibility, usable: !sendBlock(r), reason: sendBlock(r) }))
}

/** The mailbox a POST sends from: the chosen one if the caller may see it, else the default. */
async function chosenMailbox(ctx: StaffContext, mailboxId: unknown): Promise<{ row: MailConnectionRow | null; reason: string | null }> {
  if (mailboxId !== undefined && mailboxId !== null) {
    const row = await loadVisible(ctx, mailboxId)
    if (!row) return { row: null, reason: 'That mailbox is not one you can send from. Reload and pick another.' }
    return { row, reason: sendBlock(row) }
  }
  const pick = defaultFrom(await fromOptions(ctx))
  if (!pick) return { row: null, reason: NO_MAILBOX }
  const row = await loadVisible(ctx, pick.id)
  return row ? { row, reason: sendBlock(row) } : { row: null, reason: NO_MAILBOX }
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const contact = await loadContact(ctx, req.nextUrl.searchParams.get('contact_id'))
  if (!contact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId
  const [resources, sends, mailboxes] = await Promise.all([
    ctx.db.from('hub_resources').select('id, name, description, file_name, mime_type, size_bytes, is_default_followup, storage_path')
      .eq('org_id', orgId).is('archived_at', null).order('sort_order').order('created_at'),
    ctx.db.from('hub_resource_sends').select('id, sent_by, from_address, to_address, subject, attached, linked, sent_at')
      .eq('contact_id', contact.id).order('sent_at', { ascending: false }).limit(10),
    fromOptions(ctx),
  ])
  if (resources.error || sends.error) return NextResponse.json({ error: 'Resources could not be loaded.' }, { status: 500 })
  const senderIds = Array.from(new Set((sends.data ?? []).map(s => s.sent_by)))
  const { data: senders } = senderIds.length
    ? await ctx.db.from('profiles').select('id, full_name, email').in('id', senderIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] }
  const senderName = (id: string) => { const p = (senders ?? []).find(s => s.id === id); return p?.full_name || p?.email || 'Someone' }
  const thumbs = await thumbUrls(ctx.db, orgId, resources.data ?? [])
  return NextResponse.json({
    resources: (resources.data ?? []).map(({ storage_path: _path, ...r }) => ({ ...r, thumb_url: thumbs.get(r.id) ?? null })),
    to: contact.email && isUsableEmail(contact.email) ? contact.email.trim() : null,
    mailboxes,
    default_mailbox_id: defaultFrom(mailboxes)?.id ?? null,
    reason: mailboxes.some(m => m.usable) ? null : NO_MAILBOX,
    defaults: { subject: DEFAULT_SUBJECT, note: DEFAULT_NOTE, link_days: LINK_DAYS },
    sends: (sends.data ?? []).map(s => ({ ...s, sent_by_name: senderName(s.sent_by) })),
  })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const contact = await loadContact(ctx, body.contact_id)
  if (!contact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId

  const ids: unknown[] = Array.isArray(body.resource_ids) ? body.resource_ids : []
  if (!ids.length) return bad('Check at least one resource.')
  if (ids.length > 30 || !ids.every(isUuid)) return bad('The resource list is not valid.')
  const subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : ''
  if (!subject || subject.length > 250) return bad('The subject must be 1 to 250 characters.')
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!note || note.length > 5000) return bad('The note must be 1 to 5,000 characters.')
  const to = contact.email && isUsableEmail(contact.email) ? contact.email.trim() : null
  if (!to) return bad('This contact has no usable email address.')

  const { data: rows, error } = await ctx.db.from('hub_resources')
    .select('id, name, file_name, mime_type, size_bytes, storage_path, is_default_followup')
    .eq('org_id', orgId).is('archived_at', null).in('id', ids as string[])
  if (error) return NextResponse.json({ error: 'Resources could not be loaded.' }, { status: 500 })
  const byId = new Map((rows ?? []).map(r => [r.id, r as ResourceRow]))
  if (byId.size !== ids.length) return bad('One of the checked resources is no longer in the library. Reload and try again.')
  const files = (ids as string[]).map(id => byId.get(id)!)
  const { attached, linked } = splitFiles(files)
  const expiresAt = linkExpiry(new Date())
  const summary = (f: ResourceRow) => ({ id: f.id, name: f.name, size_bytes: f.size_bytes })

  const mailbox = await chosenMailbox(ctx, body.mailbox_id)
  const from = mailbox.row?.email_address ?? null
  if (body.send !== true) {
    const preview = emailBodies(note, linked.map(f => ({ name: f.name })), expiresAt)
    return NextResponse.json({
      from, to, subject,
      attached: attached.map(summary), linked: linked.map(summary),
      links_expire_at: linked.length ? expiresAt.toISOString() : null,
      text: preview.text, can_send: !mailbox.reason, reason: mailbox.reason,
    })
  }
  if (mailbox.reason || !mailbox.row) return forbidden(mailbox.reason ?? 'This mailbox cannot send.')

  const bucket = ctx.db.storage.from(RESOURCE_BUCKET)
  const links: { name: string; url: string }[] = []
  for (const f of linked) {
    const { data, error: e } = await bucket.createSignedUrl(f.storage_path, LINK_DAYS * 24 * 60 * 60, { download: f.file_name })
    if (e || !data?.signedUrl) return NextResponse.json({ error: 'A download link could not be made. Nothing was sent.' }, { status: 500 })
    links.push({ name: f.name, url: data.signedUrl })
  }
  const attachments = []
  for (const f of attached) {
    const { data, error: e } = await bucket.download(f.storage_path)
    if (e || !data) return NextResponse.json({ error: 'A file could not be read from the library. Nothing was sent.' }, { status: 500 })
    attachments.push({ file_name: f.file_name, mime_type: f.mime_type, data: Buffer.from(await data.arrayBuffer()) })
  }
  const bodies = emailBodies(note, links, expiresAt)
  const raw = buildMime({ from: mailbox.row.email_address, to, subject, text: bodies.text, html: bodies.html, attachments })

  let gmailId: string
  try {
    const token = await accessTokenFor(await refreshTokenFor(ctx.db, mailbox.row.id))
    gmailId = await gmailSendRaw(token, raw)
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e) }, { status: 502 })
  }

  const sentAt = new Date().toISOString()
  const linkedRecord = linked.map(f => ({ ...summary(f), expires_at: expiresAt.toISOString() }))
  const { data: send, error: insErr } = await ctx.db.from('hub_resource_sends').insert({
    org_id: orgId, contact_id: contact.id, sent_by: ctx.userId, mailbox_id: mailbox.row.id,
    from_address: mailbox.row.email_address, to_address: to, subject,
    attached: attached.map(summary), linked: linkedRecord, gmail_message_id: gmailId || null, sent_at: sentAt,
  }).select('id').single()
  if (insErr) console.error(`[resources-send] record failed: ${insErr.code ?? 'unknown'}`)

  const names = files.map(f => f.name)
  const { error: tlErr } = await ctx.db.from('contact_timeline').insert({
    org_id: orgId, contact_id: contact.id, event_type: 'resources_sent',
    title: `Resources sent: ${names.length} file${names.length === 1 ? '' : 's'}`,
    description: names.join(', ').slice(0, 1000),
    metadata: { send_id: send?.id ?? null, attached: attached.map(f => f.name), linked: linked.map(f => f.name), from: mailbox.row.email_address },
    source_table: 'hub_resource_sends', source_id: send?.id ?? null,
    actor_type: 'user', actor_id: ctx.userId, occurred_at: sentAt,
  })
  if (tlErr) console.error(`[resources-send] timeline failed: ${tlErr.code ?? 'unknown'}`)

  return NextResponse.json({ ok: true, from: mailbox.row.email_address, sent_at: sentAt, attached: attached.length, linked: linked.length })
})
