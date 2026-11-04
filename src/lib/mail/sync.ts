// src/lib/mail/sync.ts
// One sync pass over every active mailbox (inbox agent phase 2,
// docs/plans/hub-mail-triage-rulings.md). Per mailbox:
//   1. cursor NULL  → store the current history id, import nothing (first run)
//   2. history.list → one row per new INBOX message, then advance the cursor
//      (history expired → reset to now, record last_error, never back-fill)
//   3. triage up to TRIAGE_PER_MAILBOX waiting rows, oldest first, before the deadline
// Mailboxes run independently: one failing never stops the others.
// The result carries connection ids, counts and short codes only.
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, refreshTokenFor, MailError } from '@/lib/mail/google'
import { currentHistoryId, getMessageForTriage, inboxAddedSince } from '@/lib/mail/gmail'
import { classifyEmail } from '@/lib/mail/triage'

export const TRIAGE_PER_MAILBOX = 10
const TRIAGE_CONCURRENCY = 3
const MAX_ATTEMPTS = 3
/** Codes that will not heal on retry; the mailbox is set to 'error' until a Check succeeds. */
const DEAD = ['invalid_grant', 'no_secret']

export interface MailboxResult {
  connection_id: string
  first_run: boolean
  imported: number
  triaged: number
  triage_failed: number
  waiting: number
  error: string | null
}

interface Conn { id: string; gmail_history_id: string | null }

const code = (e: unknown) => (e instanceof MailError ? e.code : 'unknown')

async function recordError(db: SupabaseClient, id: string, e: unknown) {
  const c = code(e)
  const message = e instanceof MailError ? e.message : 'The mailbox sync failed.'
  await db.from('hub_mail_connections')
    .update({ last_error: message.slice(0, 300), ...(DEAD.includes(c) ? { status: 'error' } : {}) })
    .eq('id', id)
}

async function triageOne(db: SupabaseClient, accessToken: string, row: { id: string; gmail_message_id: string; triage_attempts: number }): Promise<boolean> {
  let meta: Record<string, unknown> = {}
  try {
    const msg = await getMessageForTriage(accessToken, row.gmail_message_id)
    meta = { from_address: msg.fromAddress, from_name: msg.fromName, subject: msg.subject, received_at: msg.receivedAt }
    const t = await classifyEmail(msg)
    const { error } = await db.from('hub_mail_messages').update({
      ...meta, ...t, triaged_at: new Date().toISOString(), triage_attempts: row.triage_attempts + 1, triage_error: null,
    }).eq('id', row.id)
    return !error
  } catch (e) {
    const c = code(e)
    console.error('[mail/sync] triage failed:', c)
    await db.from('hub_mail_messages').update({
      ...meta,
      triage_attempts: c === 'message_gone' ? MAX_ATTEMPTS : row.triage_attempts + 1,
      triage_error: (e instanceof MailError ? e.message : 'Triage failed.').slice(0, 300),
    }).eq('id', row.id)
    return false
  }
}

async function syncMailbox(db: SupabaseClient, conn: Conn, deadline: number): Promise<MailboxResult> {
  const out: MailboxResult = { connection_id: conn.id, first_run: false, imported: 0, triaged: 0, triage_failed: 0, waiting: 0, error: null }
  let accessToken: string
  try {
    accessToken = await accessTokenFor(await refreshTokenFor(db, conn.id))
  } catch (e) {
    out.error = code(e)
    await recordError(db, conn.id, e)
    return out
  }

  // 1 + 2: advance the cursor
  try {
    const now = new Date().toISOString()
    if (!conn.gmail_history_id) {
      out.first_run = true
      const hid = await currentHistoryId(accessToken)
      await db.from('hub_mail_connections').update({ gmail_history_id: hid, last_synced_at: now }).eq('id', conn.id)
    } else {
      const { added, historyId } = await inboxAddedSince(accessToken, conn.gmail_history_id)
      if (added.length) {
        const { data, error } = await db.from('hub_mail_messages')
          .upsert(added.map(m => ({ connection_id: conn.id, gmail_message_id: m.id, gmail_thread_id: m.threadId })),
            { onConflict: 'connection_id,gmail_message_id', ignoreDuplicates: true })
          .select('id')
        // Not storing the rows means not moving the cursor, so the next run retries them.
        if (error) throw new MailError('New messages could not be saved.', 'store_failed')
        out.imported = data?.length ?? 0
      }
      await db.from('hub_mail_connections').update({ gmail_history_id: historyId, last_synced_at: now }).eq('id', conn.id)
    }
  } catch (e) {
    out.error = code(e)
    if (out.error === 'history_expired') {
      // Never back-fill: restart from now and say so on the connection.
      const hid = await currentHistoryId(accessToken).catch(() => null)
      if (hid) await db.from('hub_mail_connections').update({ gmail_history_id: hid, last_synced_at: new Date().toISOString() }).eq('id', conn.id)
    }
    console.error('[mail/sync] sync failed:', out.error)
    await recordError(db, conn.id, e)
    if (out.error !== 'history_expired') return out
  }

  // 3: triage what is waiting (including rows left over from earlier runs)
  const { data: queue } = await db.from('hub_mail_messages')
    .select('id, gmail_message_id, triage_attempts')
    .eq('connection_id', conn.id).is('triaged_at', null).lt('triage_attempts', MAX_ATTEMPTS)
    .order('created_at').limit(TRIAGE_PER_MAILBOX)
  const rows = queue ?? []
  for (let i = 0; i < rows.length && Date.now() < deadline; i += TRIAGE_CONCURRENCY) {
    const done = await Promise.all(rows.slice(i, i + TRIAGE_CONCURRENCY).map(r => triageOne(db, accessToken, r)))
    for (const ok of done) ok ? out.triaged++ : out.triage_failed++
  }
  const { count } = await db.from('hub_mail_messages').select('id', { count: 'exact', head: true })
    .eq('connection_id', conn.id).is('triaged_at', null).lt('triage_attempts', MAX_ATTEMPTS)
  out.waiting = count ?? 0
  return out
}

export async function runMailSync(db: SupabaseClient, deadline: number): Promise<MailboxResult[]> {
  const { data, error } = await db.from('hub_mail_connections').select('id, gmail_history_id').eq('status', 'active')
  if (error) throw new Error(`hub_mail_connections read failed: ${error.code ?? 'unknown'}`)
  const settled = await Promise.allSettled(((data ?? []) as Conn[]).map(c => syncMailbox(db, c, deadline)))
  return settled.map((s, i) => s.status === 'fulfilled' ? s.value : {
    connection_id: (data as Conn[])[i].id, first_run: false, imported: 0, triaged: 0, triage_failed: 0, waiting: 0, error: 'unknown',
  })
}
