// GET /api/brief?org_id=  The caller's own 8 AM brief, built now from counts (Running List q22). Staff of that org.
// In off it says the brief is off; in preview and live it shows what the brief says (preview sends nothing).
// Counts only: never a mail subject, a message body or a contact name.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { gatherBrief, lastBriefAt, loadSettings, briefRecipients } from '@/lib/notify/brief'
import { composeBrief } from '@/lib/notify/rules'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  try {
    const s = await loadSettings(ctx.db, orgId)
    if (s.mode === 'off') return NextResponse.json({ mode: 'off' })
    const now = new Date()
    const since = await lastBriefAt(ctx.db, orgId, ctx.userId, now).catch(() => new Date(now.getTime() - 86_400_000).toISOString())
    const brief = composeBrief(await gatherBrief(ctx.db, orgId, ctx.userId, s, now, since))
    return NextResponse.json({ mode: s.mode, recipient: briefRecipients(s).includes(ctx.userId), since, text: brief.text, lines: brief.lines, empty: brief.empty })
  } catch (e: any) {
    console.error(`[brief] org=${orgId} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'The brief could not be built.' }, { status: 500 })
  }
})
