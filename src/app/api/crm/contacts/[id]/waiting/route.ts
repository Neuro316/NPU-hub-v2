// GET /api/crm/contacts/[id]/waiting
// Contact card › "Waiting on us" (Running List q35, Part 1): this contact's open touchpoint situations (and those of
// contacts merged into it), each with its one-line why and a link to its board card. Staff of the CONTACT's org only.
// An email situation names the mailbox only when the viewer may see it (mailView, the Communications rule): its owner,
// or a superadmin for a shared mailbox. Nothing but ids and times is stored, so nothing else can leak.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { subjectFor } from '@/lib/comms/history'
import { mailView, type Mailbox } from '@/lib/comms/privacy'
import { whyLine, type SituationKind } from '@/lib/touchpoints/rules'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withStaff<{ id: string }>(async (_req: NextRequest, ctx, params) => {
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  try {
    const subject = await subjectFor(ctx.db, id)
    if (!subject) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const orgId = requireOrg(ctx, subject.orgId)
    if (orgId instanceof Response) return orgId
    const { data, error } = await ctx.db.from('hub_touchpoint_situations').select('id, kind, waiting_since, severity, detail, task_id')
      .eq('org_id', orgId).in('contact_id', subject.ids).is('cleared_at', null).order('waiting_since', { ascending: true }).limit(10)
    if (error) return NextResponse.json({ waiting: [] }) // absent before hub_245
    const rows = (data ?? []) as any[]
    const boxIds = Array.from(new Set(rows.map((r) => r.detail?.mailbox_id).filter(Boolean)))
    const boxes = new Map<string, Mailbox>()
    if (boxIds.length) {
      const { data: b } = await ctx.db.from('hub_mail_connections').select('id, owner_user_id, email_address, visibility').in('id', boxIds)
      for (const x of (b ?? []) as Mailbox[]) boxes.set(x.id, x)
    }
    const viewer = { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }
    const now = Date.now()
    const waiting = rows.map((r) => {
      const box = boxes.get(r.detail?.mailbox_id)
      const mailbox = box && mailView(viewer, box, null) === 'full' ? box.email_address : null
      return { id: r.id, kind: r.kind, severity: r.severity, why: whyLine(r.kind as SituationKind, now - Date.parse(r.waiting_since), mailbox), card: r.task_id ? `/tasks?task=${r.task_id}` : null }
    })
    return NextResponse.json({ waiting })
  } catch (e: any) {
    console.error(`[waiting] contact=${id} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Could not be loaded.' }, { status: 500 })
  }
})
