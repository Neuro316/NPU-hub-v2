// POST /api/agent/mail-search   (Running List q26: Morning Call Prep reads every mailbox it may)
//
// Body: { emails?: string[], phones?: string[], names?: string[], date_from?: 'YYYY-MM-DD', date_to?: 'YYYY-MM-DD',
//         thread_id?: string, mailbox?: <connection id or address> }
//   - search mode (no thread_id): every mailbox the caller may see, inbox and sent, default the last 365 days.
//     Per message: mailbox, thread id, date, from, to, subject, excerpt (at most 300 chars). Never a body.
//   - thread mode (thread_id + mailbox): that one thread with each message's plain-text body.
// Answer: { mode, results, mailboxes_searched, not_searched: [{ mailbox, connection_id, reason }] }
//
// Auth: withMailSearchAuth (src/lib/mail/search-auth.ts): a superadmin session, or the Bearer secret
// MAIL_SEARCH_AGENT_SECRET that maps to MAIL_SEARCH_AGENT_USER_ID. Who sees what: src/lib/mail/search.ts.
// Nothing from Gmail is stored or logged; each search writes one hub_mail_search_log row (hub_242) with counts and
// an HMAC of the terms (MAIL_SEARCH_LOG_KEY). No log, no search: if the row cannot be written, nothing is read.
// Rate limited per caller: RATE_MAX searches per RATE_WINDOW_MINUTES.
import { NextRequest, NextResponse } from 'next/server'
import { withMailSearchAuth } from '@/lib/mail/search-auth'
import { parseInput, termsHash, rateCheck, startLog, finishLog, runSearch, RATE_MAX, RATE_WINDOW_MINUTES } from '@/lib/mail/search'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const POST = withMailSearchAuth(async (req: NextRequest, caller) => {
  const now = new Date()
  const parsed = parseInput(await req.json().catch(() => ({})), now)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const key = process.env.MAIL_SEARCH_LOG_KEY
  if (!key || key.trim().length < 32) return json({ error: 'Mail search is not set up yet.' }, 503)

  const rate = await rateCheck(caller.db, caller.userId, now)
  if (rate === 'unavailable') return json({ error: 'Mail search logging is not available, so nothing was searched.' }, 503)
  if (rate === 'limited') return json({ error: `At most ${RATE_MAX} searches every ${RATE_WINDOW_MINUTES} minutes. Try again shortly.` }, 429)

  const logId = await startLog(caller.db, caller, parsed.input, termsHash(key.trim(), parsed.input), now)
  if (!logId) return json({ error: 'Mail search logging is not available, so nothing was searched.' }, 503)

  const r = await runSearch(caller, parsed.input)
  if (r && 'notFound' in r) { await finishLog(caller.db, logId, null); return json({ error: 'Not found.' }, 404) }
  await finishLog(caller.db, logId, r)
  if (!r) return json({ error: 'The mailboxes could not be read. Try again.' }, 500)
  console.log(`[mail-search] caller=${caller.userId} via=${caller.via} mode=${r.mode} mailboxes=${r.searched_ids.length} not_searched=${r.not_searched.length} messages=${r.results.length}`)
  const { searched_ids: _ids, ...out } = r
  return json(out)
})
