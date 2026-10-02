// src/app/api/comms/click-to-call/route.ts
// Click-to-call bridge (docs/plans/hub-click-to-call-rulings.md).
//
//   GET  ?conversation_id=  preflight: runs every gate, dials nothing, writes nothing.
//   POST { conversation_id } places the call: rings the caller's own phone from the
//        conversation's line; the bridge webhook dials the contact after they press 1.
//
// The body carries the conversation id and nothing else. Org, contact, line and staff
// phone are all derived on the server, the org from team_profiles membership
// (withStaff), so a client cannot aim the call anywhere the open conversation does not.
// No recording parameters. The call_logs row is direction 'outbound', and no entry
// event is raised from here or from the webhooks.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { createOrgTwilioClient } from '@/lib/twilio-org'
import { voiceSignatureUrl } from '@/lib/twilio-voice-signature'
import { decide, callbackUrls, resolveLineOverride, type Decision, type EligibleLine } from '@/lib/click-to-call/logic'
import { gatherFacts, logAttempt, mergeAttempt, loadEligibleLines, loadLineRow, accountNumbers } from '@/lib/click-to-call/server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function view(d: Decision, conversationId: string, lines: EligibleLine[] = []) {
  return {
    conversation_id: conversationId,
    ok: d.ok,
    code: d.ok ? null : d.code,
    message: d.ok ? null : d.message,
    contact_name: d.contactName,
    contact_phone: d.contactPhone || null,
    staff_phone: d.staffPhone || null,
    line: d.line ? { e164: d.line.e164, label: d.line.label, is_default: d.line.isDefault } : null,
    quiet_hours: d.quiet,
    live: d.live,
    // The line picker: the org's eligible lines, and which of them is today's default.
    lines: lines.map((l) => ({ id: l.id, e164: l.e164, label: l.label })),
    default_line_id: lines.find((l) => l.e164 === d.line?.e164)?.id ?? null,
  }
}

export const GET = withStaff(async (req, ctx) => {
  const id = req.nextUrl.searchParams.get('conversation_id') || ''
  if (!UUID.test(id)) return bad('A conversation is required.')
  try {
    const g = await gatherFacts(ctx.db, ctx, id, new Date())
    const d = decide(g.facts)
    // The list is a convenience: if it cannot be read the confirm shows today's line alone.
    let lines: EligibleLine[] = []
    if (d.ok && g.orgId && g.config) {
      try { lines = await loadEligibleLines(ctx.db, g.orgId, g.config) } catch (e: any) { console.error('[click-to-call] line list failed:', e?.message) }
    }
    return NextResponse.json(view(d, id, lines))
  } catch (e: any) {
    console.error('[click-to-call] preflight read failed:', e?.message)
    return NextResponse.json({ error: 'Click-to-call could not be checked. Try again.' }, { status: 503 })
  }
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const id = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
  if (!UUID.test(id)) return bad('A conversation is required.')
  const now = new Date()

  let g
  try {
    g = await gatherFacts(ctx.db, ctx, id, now)
  } catch (e: any) {
    console.error('[click-to-call] gate read failed, not dialing:', e?.message)
    return NextResponse.json({ error: 'Click-to-call could not be checked, so no call was placed. Try again.' }, { status: 503 })
  }
  const d = decide(g.facts)
  const contactId = g.facts.contact?.id ?? null
  const detail: Record<string, unknown> = {
    conversation_id: id, line: d.line?.e164 ?? null, line_label: d.line?.label ?? null, from_number: d.line?.e164 ?? null,
    staff_phone: d.staffPhone || null, contact_phone: d.contactPhone || null, live: d.live,
    quiet_hours_outside: d.quiet?.outside ?? null, contact_local_time: d.quiet?.localTime ?? null,
  }

  if (!d.ok) {
    // A wrong-org request is never written into the other org's log.
    if (d.code !== 'wrong_org' && g.orgId && contactId) {
      try { await logAttempt(ctx.db, { orgId: g.orgId, contactId, actorId: ctx.userId, data: { ...detail, result: 'refused', reason: d.code } }) }
      catch (e: any) { console.error('[click-to-call] refusal log failed:', e?.message) }
    } else {
      console.warn('[click-to-call] refused', d.code, 'user', ctx.userId, 'conversation', id)
    }
    return NextResponse.json({ ...view(d, id), error: d.message }, { status: d.status })
  }

  const orgId = g.orgId!
  const base = voiceSignatureUrl('')
  if (!base || !g.config?.account_sid || !g.config?.auth_token) {
    return NextResponse.json({ error: 'Calling is not configured for this organization.' }, { status: 503 })
  }

  // The line picker. No line_id: today's line, untouched. A line_id is resolved on the
  // server and must be this org's, still configured, and voice capable on the account.
  let line = d.line!
  if (body?.line_id !== undefined && body?.line_id !== null) {
    // Present but not a usable id (a number, an empty string): refused, never read as "no choice".
    const pickedId = typeof body.line_id === 'string' && body.line_id ? body.line_id : '(invalid)'
    let r: ReturnType<typeof resolveLineOverride>
    try {
      const row = UUID.test(pickedId) ? await loadLineRow(ctx.db, pickedId) : null
      r = resolveLineOverride(pickedId, orgId, row, g.config.numbers || [], await accountNumbers(orgId, g.config))
    } catch (e: any) {
      console.error('[click-to-call] line read failed, not dialing:', e?.message)
      return NextResponse.json({ error: 'The line could not be checked, so no call was placed. Try again.' }, { status: 503 })
    }
    if (r && 'refused' in r) {
      try { await logAttempt(ctx.db, { orgId, contactId: contactId!, actorId: ctx.userId, data: { ...detail, result: 'refused', reason: r.refused, line_id: pickedId } }) }
      catch (e: any) { console.error('[click-to-call] refusal log failed:', e?.message) }
      return NextResponse.json({ ...view(d, id), code: r.refused, error: r.message }, { status: r.refused === 'line_unverified' ? 503 : 403 })
    }
    if (r) {
      line = r.line
      Object.assign(detail, { line: line.e164, line_label: line.label, from_number: line.e164, line_id: r.id, line_overridden: line.e164 !== d.line!.e164 })
    }
  }

  // 1. The call row first, so the webhooks can find it by id the moment Twilio calls.
  const { data: callRow, error: cErr } = await ctx.db.from('call_logs').insert({
    org_id: orgId, contact_id: contactId, conversation_id: id, direction: 'outbound', status: 'ringing',
    from_number: line.e164, to_number: d.contactPhone, started_at: now.toISOString(),
  }).select('id').single()
  if (cErr || !callRow) {
    console.error('[click-to-call] call_logs insert failed:', cErr?.message)
    return NextResponse.json({ error: 'The call could not be logged, so it was not placed. Try again.' }, { status: 503 })
  }
  const callLogId = (callRow as any).id as string

  // 2. The attempt row. If it cannot be written, nothing is dialed.
  let attemptId: string
  try {
    attemptId = await logAttempt(ctx.db, { orgId, contactId: contactId!, actorId: ctx.userId, callLogId, data: { ...detail, result: 'placing' } })
  } catch (e: any) {
    console.error('[click-to-call] attempt log failed, not dialing:', e?.message)
    await ctx.db.from('call_logs').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', callLogId)
    return NextResponse.json({ error: 'The call could not be logged, so it was not placed. Try again.' }, { status: 503 })
  }

  // 3. Ring the staff member. No record, recordingStatusCallback or machine detection.
  const urls = callbackUrls(base, callLogId)
  try {
    const call = await createOrgTwilioClient(g.config).calls.create({
      to: d.staffPhone, from: line.e164,
      url: urls.bridge, method: 'POST',
      statusCallback: urls.status, statusCallbackMethod: 'POST', statusCallbackEvent: ['completed'],
      timeout: 25,
    })
    await ctx.db.from('call_logs').update({ external_call_sid: call.sid }).eq('id', callLogId).is('external_call_sid', null)
    await mergeAttempt(ctx.db, { id: attemptId }, { result: 'placed', parent_call_sid: call.sid })
    return NextResponse.json({ ...view(d, id), placed: true, call_log_id: callLogId })
  } catch (e: any) {
    console.error('[click-to-call] Twilio calls.create failed:', e?.code, e?.message)
    await ctx.db.from('call_logs').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', callLogId)
    await mergeAttempt(ctx.db, { id: attemptId }, { result: 'twilio_error', twilio_error_code: e?.code ?? null, outcome: 'not_placed' })
    return NextResponse.json({ error: 'Twilio did not accept the call. Nothing was dialed.' }, { status: 502 })
  }
})
