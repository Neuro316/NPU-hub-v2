// src/app/api/crm/pipeline-card-activity/route.ts
// Recent notes and open tasks for the cards on one pipeline board, in ONE request
// for the whole board (or one contact, to refresh a single card).
//
// GET ?org_id=&pipeline_key=            every contact placed in that pipeline
// GET ?org_id=&pipeline_key=&contact_id= one card, after a note or task changed
//
// Returns { activity: { [contact_id]: { notes, notes_total, tasks, tasks_total } } }
//   notes  the 3 most recent contact_notes, newest first
//   tasks  up to 3 open tasks (todo / in_progress), soonest due first, undated last
// Contacts with neither are left out, so the board renders nothing for them.
//
// Reads existing data only (contact_notes, tasks). Service role, so withStaff is
// the boundary; every query is pinned to the caller's org, and a contact_id from
// another org returns nothing.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'

const SHOWN = 3
const CHUNK = 150
const MAX_CONTACTS = 3000
// The hover shows the full note; cap it so one very long note can't bloat the board.
const NOTE_MAX_CHARS = 1000

type Note = { id: string; body: string; created_at: string }
type Task = { id: string; title: string; due_date: string | null }
type Activity = { notes: Note[]; notes_total: number; tasks: Task[]; tasks_total: number }

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const sp = req.nextUrl.searchParams
  const orgId = requireOrg(ctx, sp.get('org_id'))
  if (orgId instanceof Response) return orgId
  const pipelineKey = sp.get('pipeline_key')
  if (!pipelineKey) return bad('pipeline_key is required')
  const one = sp.get('contact_id')

  let q = ctx.db.from('contacts').select('id').eq('org_id', orgId).eq('pipeline_id', pipelineKey).is('merged_into_id', null)
  if (one) q = q.eq('id', one)
  const { data: contacts, error: cErr } = await q.limit(MAX_CONTACTS)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  const ids = (contacts ?? []).map(c => c.id as string)
  if (!ids.length) return NextResponse.json({ activity: {} })

  const groups = chunks(ids, CHUNK)
  const [noteRes, taskRes] = await Promise.all([
    Promise.all(groups.map(g => ctx.db.from('contact_notes')
      .select('id, contact_id, body, created_at')
      .eq('org_id', orgId).in('contact_id', g)
      .order('created_at', { ascending: false }))),
    Promise.all(groups.map(g => ctx.db.from('tasks')
      .select('id, contact_id, title, due_date, created_at')
      .eq('org_id', orgId).in('contact_id', g).in('status', ['todo', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }))),
  ])
  const failed = [...noteRes, ...taskRes].find(r => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  const activity: Record<string, Activity> = {}
  const slot = (id: string) => (activity[id] ??= { notes: [], notes_total: 0, tasks: [], tasks_total: 0 })
  // Each chunk is already ordered, and a contact's rows all sit in one chunk.
  for (const r of noteRes) for (const n of r.data ?? []) {
    const a = slot(n.contact_id as string)
    a.notes_total++
    if (a.notes.length < SHOWN) a.notes.push({ id: n.id, body: String(n.body ?? '').slice(0, NOTE_MAX_CHARS), created_at: n.created_at })
  }
  for (const r of taskRes) for (const t of r.data ?? []) {
    const a = slot(t.contact_id as string)
    a.tasks_total++
    if (a.tasks.length < SHOWN) a.tasks.push({ id: t.id, title: String(t.title ?? ''), due_date: t.due_date })
  }
  return NextResponse.json({ activity })
})
