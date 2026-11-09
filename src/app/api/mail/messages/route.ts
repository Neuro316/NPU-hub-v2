// GET   /api/mail/messages?mailbox=&category=&status=&before=   triaged mail, newest first
// PATCH /api/mail/messages {id, status}                            mark new / seen / done
// Superadmin only. Messages follow their mailbox's visibility (phase 1 rules): private
// mailboxes to the owner, shared ones to superadmins in that org, anything else 404.
// Returns metadata and the AI summary only; bodies are never stored. Scheduling rows also carry the reply-draft
// state (draft_status, drafted_at, gmail_draft_id) once hub_234 is applied; before that the old columns are read.
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { listVisible, loadVisible } from '@/lib/mail/google'
import { CATEGORIES } from '@/lib/mail/triage'

export const dynamic = 'force-dynamic'

const STATUSES = ['new', 'seen', 'done']
const PAGE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS =
  'id, connection_id, gmail_thread_id, from_address, from_name, subject, received_at, category, priority, ' +
  'summary, suggested_action, status, triaged_at, triage_attempts, triage_error, created_at'

const DRAFT_COLUMNS = ', draft_status, drafted_at, gmail_draft_id'
// hub_234 not applied: PostgREST or Postgres does not know the draft columns
const missingColumn = (e: { code?: string | null } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204')

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

export const GET = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The inbox is for superadmins.')
  const q = req.nextUrl.searchParams
  const mailbox = q.get('mailbox'), category = q.get('category'), status = q.get('status'), before = q.get('before')
  if (category && !(CATEGORIES as readonly string[]).includes(category)) return bad('Unknown category.')
  if (status && !STATUSES.includes(status)) return bad('Unknown status.')
  if (before && Number.isNaN(Date.parse(before))) return bad('Bad cursor.')

  const visible = await listVisible(ctx)
  if (!visible) return NextResponse.json({ error: 'The inbox could not be loaded.' }, { status: 500 })
  const byId = new Map(visible.map(c => [c.id, c]))
  if (mailbox && !byId.has(mailbox)) return notFound()
  const ids = mailbox ? [mailbox] : Array.from(byId.keys())
  const mailboxes = visible.map(c => ({ id: c.id, email_address: c.email_address, visibility: c.visibility, status: c.status }))
  if (!ids.length) return NextResponse.json({ mailboxes, messages: [], next: null })

  const read = (columns: string) => {
    let query = ctx.db.from('hub_mail_messages').select(columns).in('connection_id', ids)
    if (category) query = query.eq('category', category)
    if (status) query = query.eq('status', status)
    if (before) query = query.lt('created_at', before)
    return query.order('created_at', { ascending: false }).limit(PAGE)
  }
  let { data, error } = await read(COLUMNS + DRAFT_COLUMNS)
  const drafts = !missingColumn(error)
  if (!drafts) ({ data, error } = await read(COLUMNS))
  if (error) return NextResponse.json({ error: 'The inbox could not be loaded.' }, { status: 500 })

  const messages = ((data ?? []) as any[]).map((m: any) => {
    const email = byId.get(m.connection_id)!.email_address
    return {
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
      thread_url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#inbox/${m.gmail_thread_id}`,
      ...(drafts ? { draft_status: m.draft_status ?? null, drafted_at: m.drafted_at ?? null, gmail_draft_id: m.gmail_draft_id ?? null } : {}),
    }
  })
  const next = (data?.length ?? 0) === PAGE ? (data as any[])[PAGE - 1].created_at : null
  return NextResponse.json({ mailboxes, messages, next, drafts_available: drafts })
})

export const PATCH = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The inbox is for superadmins.')
  const body = await req.json().catch(() => ({}))
  if (!STATUSES.includes(body.status)) return bad('Status must be new, seen or done.')
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return notFound()
  const { data: msg } = await ctx.db.from('hub_mail_messages').select('id, connection_id').eq('id', body.id).maybeSingle()
  if (!msg || !(await loadVisible(ctx, msg.connection_id))) return notFound()
  const { error } = await ctx.db.from('hub_mail_messages').update({ status: body.status }).eq('id', msg.id)
  if (error) return NextResponse.json({ error: 'The status could not be saved.' }, { status: 500 })
  return NextResponse.json({ id: msg.id, status: body.status })
})
