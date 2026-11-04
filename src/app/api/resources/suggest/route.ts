// GET /api/resources/suggest?contact_id=   "Suggested from your call" for the Send resources
//                                          panel: resource ids to pre-check and a drafted
//                                          note, from the contact's latest transcribed call
//                                          in the last 7 days. {suggestion: null} when there
//                                          is no transcript, no library or the model fails.
//
// Same access as /api/resources/send: platform superadmin and a member of the CONTACT's
// org. The panel loads this in the background and opens without it.
//
// HARD RULE: the transcript, the prompt and the reply are never stored or logged. Claude
// receives the transcript text (first name only), the contact's first name and each
// resource's id, title and description (src/lib/resources/suggest.ts).
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden } from '@/lib/api-guard'
import { ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'
import { suggestFromCall, TRANSCRIPT_DAYS } from '@/lib/resources/suggest'
import { callSuggestModel, SuggestError } from '@/lib/resources/suggest-model'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? ''

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const contactId = req.nextUrl.searchParams.get('contact_id')
  if (!isUuid(contactId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data: contact } = await ctx.db.from('contacts').select('id, org_id, first_name').eq('id', contactId).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId

  const [{ data: resources }, { data: me }] = await Promise.all([
    ctx.db.from('hub_resources').select('id, name, description').eq('org_id', orgId).is('archived_at', null).order('sort_order'),
    ctx.db.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle(),
  ])
  // An "Unknown" placeholder contact has no real first name to use.
  const contactFirst = firstWord(contact.first_name) === 'Unknown' ? '' : firstWord(contact.first_name)

  const since = new Date(Date.now() - TRANSCRIPT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let code: string | null = null
  const suggestion = await suggestFromCall(
    { contactFirstName: contactFirst, senderFirstName: firstWord(me?.full_name) || 'Cameron', resources: resources ?? [] },
    {
      async findTranscript() {
        const { data } = await ctx.db.from('call_logs').select('transcript, created_at')
          .eq('contact_id', contact.id).eq('org_id', orgId).eq('transcription_status', 'completed')
          .not('transcript', 'is', null).gte('created_at', since)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        return data?.transcript ? { text: data.transcript, at: data.created_at } : null
      },
      async callModel(input) {
        try { return await callSuggestModel(input) } catch (e) {
          code = e instanceof SuggestError ? e.code : 'ai_error'
          throw e
        }
      },
    },
  )
  // A code only, never content: the panel falls back to the normal sheet either way.
  if (code) console.error(`[resources-suggest] model failed: ${code}`)
  return NextResponse.json({ suggestion })
})
