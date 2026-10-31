// src/app/api/quick-send/send/route.ts
// Send a Quick Send: one email to a contact with the selected resources attached.
//
// POST { org_id, contact_id, media_asset_ids: string[], to_email, note }
//
// From: the org's Quick Send From address (org_settings 'crm_quick_send'), never the
// marketing subdomain. Reply-To: the staff member sending. Files are read from the
// media-library bucket here and attached; nothing is emailed as a link. Every check
// (contact in this org, each resource Available to send, the 40 MB encoded limit)
// runs before Resend is called; see runQuickSend in src/lib/quick-send.ts.
//
// Writes one hub_quick_send_sends row per resource and, when the email is accepted,
// one contact_timeline entry. Not a campaign send: the marketing engine, its
// test-contact allowlist and its consent rules do not apply to a one-to-one email
// staff send by hand to a contact they are talking to.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { runQuickSend, postResendEmail } from '@/lib/quick-send'
import { MEDIA_BUCKET, loadResources, loadSettings, loadSender } from '@/lib/quick-send-server'

// Up to ten files are read from storage and posted to Resend in one request.
export const maxDuration = 60

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (typeof body?.contact_id !== 'string') return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return NextResponse.json({ error: 'Email sending is not set up on this deployment, so nothing was sent.' }, { status: 503 })
  }

  const db = ctx.db
  const outcome = await runQuickSend({
    async loadContact(org, id) {
      const { data } = await db.from('contacts').select('id, org_id, first_name, email').eq('id', id).eq('org_id', org).maybeSingle()
      return data || null
    },
    loadResources: org => loadResources(db, org),
    loadSettings: async org => (await loadSettings(db, org)).settings,
    loadSender: (org, user) => loadSender(db, org, user),
    async download(path) {
      const { data, error } = await db.storage.from(MEDIA_BUCKET).download(path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },
    sendEmail: (payload, key) => postResendEmail(fetch, apiKey, payload, key),
    async insertSends(rows) {
      const { error } = await db.from('hub_quick_send_sends').insert(rows)
      if (error) console.error(`[quick-send] send records not saved: ${error.message}`)
      return { error: error?.message }
    },
    async insertTimeline(row) {
      const { error } = await db.from('contact_timeline').insert(row)
      if (error) console.error(`[quick-send] timeline entry not saved: ${error.message}`)
      return { error: error?.message }
    },
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  }, {
    orgId,
    userId: ctx.userId,
    contactId: body.contact_id,
    mediaAssetIds: body.media_asset_ids,
    toEmail: body.to_email,
    note: body.note,
  })

  return NextResponse.json(outcome.body, { status: outcome.status })
})
