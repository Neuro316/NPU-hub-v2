// GET   /api/mail/messages?view=review|all&mailbox=&category=&status=&before=   triaged mail, newest first
//         view=review (the Inbox default): only messages whose draft row is drafted or needs_person
//         each message carries its draft badge and who set its priority by hand; needs_review is the count
// PATCH /api/mail/messages {id, status}                            mark new / seen / done
// PATCH /api/mail/messages {id, priority, reason?}                 the priority pill: set it and record the correction
//         in hub_priority_feedback (ids, priorities, a reason code; no email text)
// Superadmin only. Messages follow their mailbox's visibility (phase 1 rules): private
// mailboxes to the owner, shared ones to superadmins in that org, anything else 404.
// Returns metadata and the AI summary only; bodies are never stored.
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad, type StaffContext } from '@/lib/api-guard'
import { listVisible, loadVisible } from '@/lib/mail/google'
import { CATEGORIES } from '@/lib/mail/triage'
import { PRIORITY_REASONS, PRIORITY_VALUES } from '@/lib/mail/priority'
import { draftBadges, prioritySetters, reviewQueue } from '@/lib/drafts/inbox'

export const dynamic = 'force-dynamic'

const STATUSES = ['new', 'seen', 'done']
const PAGE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS =
  'id, connection_id, gmail_thread_id, from_address, from_name, subject, received_at, category, priority, ' +
  'summary, suggested_action, status, triaged_at, triage_attempts, triage_error, created_at'

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

export const GET = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The inbox is for superadmins.')
  const q = req.nextUrl.searchParams
  const mailbox = q.get('mailbox'), category = q.get('category'), status = q.get('status'), before = q.get('before')
  const view = q.get('view') === 'review' ? 'review' : 'all'
  if (category && !(CATEGORIES as readonly string[]).includes(category)) return bad('Unknown category.')
  if (status && !STATUSES.includes(status)) return bad('Unknown status.')
  if (before && Number.isNaN(Date.parse(before))) return bad('Bad cursor.')

  const visible = await listVisible(ctx)
  if (!visible) return NextResponse.json({ error: 'The inbox could not be loaded.' }, { status: 500 })
  const byId = new Map(visible.map(c => [c.id, c]))
  if (mailbox && !byId.has(mailbox)) return notFound()
  const ids = mailbox ? [mailbox] : Array.from(byId.keys())
  const mailboxes = visible.map(c => ({ id: c.id, email_address: c.email_address, visibility: c.visibility, status: c.status }))
  if (!ids.length) return NextResponse.json({ mailboxes, messages: [], next: null, needs_review: 0 })

  let queue: { count: number; messageIds: string[] }
  try { queue = await reviewQueue(ctx) } catch { queue = { count: 0, messageIds: [] } }
  if (view === 'review' && !queue.messageIds.length) return NextResponse.json({ mailboxes, messages: [], next: null, needs_review: queue.count })

  let query = ctx.db.from('hub_mail_messages').select(COLUMNS).in('connection_id', ids)
  if (view === 'review') query = query.in('id', queue.messageIds)
  if (category) query = query.eq('category', category)
  if (status) query = query.eq('status', status)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(PAGE)
  if (error) return NextResponse.json({ error: 'The inbox could not be loaded.' }, { status: 500 })

  const listed = ((data ?? []) as any[]).map((m) => m.id as string)
  const [badges, setters] = await Promise.all([draftBadges(ctx.db, listed), prioritySetters(ctx.db, ctx.userId, listed)])
  const messages = (data ?? []).map((m: any) => {
    const email = byId.get(m.connection_id)!.email_address
    return {
      draft_status: badges.get(m.id)?.status ?? null,
      draft_badge: badges.get(m.id)?.badge ?? null,
      priority_set_by: setters.get(m.id)?.by ?? null,
      id: m.id,
      connection_id: m.connection_id,
      mailbox: email,
      from_name: m.from_name,
      from_address: m.from_address,
      subject: m.subject,
      received_at: m.received_at ?? m.created_at,
      category: m.category,
      priority: m.priority,
      summary: m.summary,
      suggested_action: m.suggested_action,
      status: m.status,
      triage: m.triaged_at ? 'done' : m.triage_attempts >= 3 ? 'failed' : 'waiting',
      triage_error: m.triaged_at ? null : m.triage_error,
      gmail_url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${m.gmail_thread_id}`,
    }
  })
  const next = (data?.length ?? 0) === PAGE ? (data as any[])[PAGE - 1].created_at : null
  return NextResponse.json({ mailboxes, messages, next, needs_review: queue.count })
})

export const PATCH = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The inbox is for superadmins.')
  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return notFound()
  if (body.priority !== undefined) return setPriority(ctx, body)
  if (!STATUSES.includes(body.status)) return bad('Status must be new, seen or done.')
  const { data: msg } = await ctx.db.from('hub_mail_messages').select('id, connection_id').eq('id', body.id).maybeSingle()
  if (!msg || !(await loadVisible(ctx, msg.connection_id))) return notFound()
  const { error } = await ctx.db.from('hub_mail_messages').update({ status: body.status }).eq('id', msg.id)
  if (error) return NextResponse.json({ error: 'The status could not be saved.' }, { status: 500 })
  return NextResponse.json({ id: msg.id, status: body.status })
})

/** The priority pill. The correction is recorded first: if it cannot be (hub_247 not applied), nothing changes. */
async function setPriority(ctx: StaffContext, body: any) {
  const to = PRIORITY_VALUES.find((p) => p === body.priority)
  if (!to) return bad('Priority must be urgent, normal or low.')
  const reason = body.reason == null ? null : PRIORITY_REASONS.find((r) => r === body.reason)
  if (reason === undefined) return bad('Unknown reason.')
  const { data: msg } = await ctx.db.from('hub_mail_messages').select('id, connection_id, priority').eq('id', body.id).maybeSingle()
  const conn = msg ? await loadVisible(ctx, msg.connection_id) : null
  if (!msg || !conn) return notFound()
  if (msg.priority === to && !reason) return NextResponse.json({ id: msg.id, priority: to, priority_set_by: null })
  const { error: fErr } = await ctx.db.from('hub_priority_feedback').insert({
    org_id: conn.org_id, message_id: msg.id, connection_id: msg.connection_id, from_priority: msg.priority ?? null, to_priority: to, reason, set_by: ctx.userId,
  })
  if (fErr) {
    const notReady = ['42P01', 'PGRST205'].includes(String(fErr.code))
    return NextResponse.json({ error: notReady ? 'Priority corrections need hub_247, which is not applied yet.' : 'The priority could not be saved.' }, { status: notReady ? 503 : 500 })
  }
  const { error } = await ctx.db.from('hub_mail_messages').update({ priority: to }).eq('id', msg.id)
  if (error) return NextResponse.json({ error: 'The priority could not be saved.' }, { status: 500 })
  return NextResponse.json({ id: msg.id, priority: to, priority_set_by: 'you' })
}
