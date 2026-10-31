// src/app/api/quick-send/resources/route.ts
// Everything a Quick Send screen needs, in one staff-guarded read.
//
// GET ?org_id=...&scope=send|manage[&contact_id=...]
//   scope=send    only resources that can be sent now (Available to send, not
//                 archived, a stored file), for the dialog and the call sheet
//   scope=manage  every non-archived Quick Send resource, for CRM Settings and
//                 the Media Library toggle
//   contact_id    adds the contact's first name and email (this org only)
//
// Also returns the categories, the caller's name and email (the Reply-To), the
// org's Quick Send From address, and whether the caller is an admin here.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin } from '@/lib/api-guard'
import { isSelectable } from '@/lib/quick-send'
import { loadCategories, loadResources, loadSettings, loadSender } from '@/lib/quick-send-server'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const sp = req.nextUrl.searchParams
  const orgId = requireOrg(ctx, sp.get('org_id'))
  if (orgId instanceof Response) return orgId
  const scope = sp.get('scope') === 'manage' ? 'manage' : 'send'
  const contactId = sp.get('contact_id')

  try {
    const [categories, all, { settings }, sender] = await Promise.all([
      loadCategories(ctx.db, orgId),
      loadResources(ctx.db, orgId),
      loadSettings(ctx.db, orgId),
      loadSender(ctx.db, orgId, ctx.userId),
    ])
    let contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null = null
    if (contactId) {
      const { data } = await ctx.db.from('contacts').select('id, first_name, last_name, email')
        .eq('id', contactId).eq('org_id', orgId).maybeSingle()
      contact = data || null
    }
    const resources = (scope === 'send' ? all.filter(isSelectable) : all)
      // The storage path stays on the server; the page needs the public URL only for Preview.
      .map(({ storage_path, ...r }) => ({ ...r, has_file: !!storage_path }))
    return NextResponse.json({
      categories,
      resources,
      contact,
      sender,
      settings,
      can_admin: isOrgAdmin(ctx, orgId),
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Quick Send could not load: ${e?.message || 'unknown error'}` }, { status: 500 })
  }
})
