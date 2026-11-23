// src/lib/mail/search.ts
// Mail search across the caller's connected mailboxes (Running List q26, POST /api/agent/mail-search).
//
// WHO SEES WHAT: listVisible and canSee (src/lib/mail/google.ts), checked again here. hub_mail_connections
// records the owner in owner_user_id. A private mailbox is searched only for its owner, never for anyone else,
// superadmin or not. A shared mailbox is searched for superadmins of its org, its existing rule.
//
// WHAT COMES BACK: per message the mailbox, thread id, date, from, to, subject and an excerpt of at most 300
// characters (Gmail's own snippet; a search fetches headers only, format=metadata). A full plain-text body is
// returned only when ONE thread is requested.
//
// NOTHING FROM GMAIL IS STORED, EVER (hub_217 rulings 4 and 7): no subject, address, snippet or body is written to
// the database or a log line. The only write is the search log (hub_mail_search_log, hub_242): who, when, which
// mailbox ids, counts, and an HMAC of the query terms (MAIL_SEARCH_LOG_KEY), never the terms themselves.
//
// BROKEN MAILBOXES: a visible mailbox that is revoked, or whose sign-in or search fails, is listed in not_searched
// with a fixed reason, so the call prep note can say what it could not read. A mailbox marked 'error' is still tried.
import { createHmac } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerEquivalent } from '@/lib/mail/access'
import { listVisible, canSee, accessTokenFor, refreshTokenFor, MailError, isPermanent, type MailConnectionRow } from '@/lib/mail/google'
import { searchMessageIds, getMessageMeta, getThreadFull, type MessageMeta } from '@/lib/mail/gmail'
import type { SearchCaller } from '@/lib/mail/search-auth'

export const EXCERPT_CHARS = 300
export const MAX_PER_MAILBOX = 25
export const DEFAULT_DAYS = 365
export const RATE_WINDOW_MINUTES = 10
export const RATE_MAX = 10
const MAX_TERMS = 10

const EMAIL = /^[^\s@<>"'(),;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/
// letters (Latin, with accents), spaces, apostrophes, hyphens and full stops
const NAME = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]{0,78}[A-Za-zÀ-ɏ.]$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const THREAD = /^[0-9a-f]{1,32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SearchInput { emails: string[]; phones: string[]; names: string[]; dateFrom: string; dateTo: string; threadId: string | null; mailbox: string | null }
export type Parsed = { ok: true; input: SearchInput } | { ok: false; error: string }

const day = (d: Date) => d.toISOString().slice(0, 10)
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string')

/** Pure. Validates the request body; terms are normalised and capped, never echoed in an error. */
export function parseInput(body: any, now: Date): Parsed {
  const emails = Array.from(new Set(list(body?.emails).map((e) => e.trim().toLowerCase()).filter(Boolean)))
  const phones = Array.from(new Set(list(body?.phones).map((p) => p.replace(/\D/g, '')).filter(Boolean)))
  const names = Array.from(new Set(list(body?.names).map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean)))
  if (emails.length + phones.length + names.length > MAX_TERMS) return { ok: false, error: `At most ${MAX_TERMS} search terms.` }
  if (!emails.every((e) => EMAIL.test(e))) return { ok: false, error: 'One of the email addresses is not valid.' }
  if (!phones.every((p) => p.length >= 10 && p.length <= 15)) return { ok: false, error: 'One of the phone numbers is not valid.' }
  if (!names.every((n) => NAME.test(n))) return { ok: false, error: 'Names may use letters, spaces, apostrophes, hyphens and full stops.' }
  const threadId = body?.thread_id == null ? null : String(body.thread_id)
  if (threadId !== null && !THREAD.test(threadId)) return { ok: false, error: 'The thread id is not valid.' }
  const mailbox = body?.mailbox == null ? null : String(body.mailbox).trim().toLowerCase()
  if (threadId && !mailbox) return { ok: false, error: 'A thread is read from one mailbox: give its mailbox too.' }
  if (mailbox !== null && !(UUID.test(mailbox) || EMAIL.test(mailbox))) return { ok: false, error: 'The mailbox is not valid.' }
  if (!threadId && emails.length + phones.length + names.length === 0) return { ok: false, error: 'Give at least one email address, phone number or name.' }
  const dateTo = body?.date_to ?? day(new Date(now.getTime() + 86_400_000))
  const dateFrom = body?.date_from ?? day(new Date(now.getTime() - DEFAULT_DAYS * 86_400_000))
  if (!DAY.test(String(dateFrom)) || !DAY.test(String(dateTo)) || String(dateFrom) > String(dateTo)) return { ok: false, error: 'The date range is not valid.' }
  return { ok: true, input: { emails, phones, names, dateFrom: String(dateFrom), dateTo: String(dateTo), threadId, mailbox } }
}

/** The forms a phone number is written in, for Gmail's text search. */
export function phoneForms(digits: string): string[] {
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return [digits, `+${digits}`]
  const [a, b, c] = [ten.slice(0, 3), ten.slice(3, 6), ten.slice(6)]
  return [ten, `1${ten}`, `+1${ten}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `+1 ${a}-${b}-${c}`]
}

/**
 * Pure. The Gmail query: any term, in received or sent mail, inside the date range. Received mail includes mail
 * archived out of the inbox (Gmail's in:inbox would miss it); drafts, spam and trash are excluded.
 */
export function gmailQuery(i: SearchInput): string {
  const any: string[] = []
  for (const e of i.emails) any.push(`from:${e}`, `to:${e}`, `cc:${e}`, `bcc:${e}`)
  for (const p of i.phones) for (const f of phoneForms(p)) any.push(`"${f}"`)
  for (const n of i.names) any.push(`"${n}"`)
  return `{${any.join(' ')}} -in:drafts -in:spam -in:trash after:${i.dateFrom.replace(/-/g, '/')} before:${i.dateTo.replace(/-/g, '/')}`
}

/** Pure. A one-way, keyed hash of what was searched for: the log can match repeats, never read the terms. */
export function termsHash(key: string, i: SearchInput): string {
  const canonical = JSON.stringify({ e: [...i.emails].sort(), p: [...i.phones].sort(), n: i.names.map((n) => n.toLowerCase()).sort(), t: i.threadId, m: i.mailbox })
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
}

/** Pure. Gmail's snippet as plain text, at most EXCERPT_CHARS. */
export function excerpt(snippet: string): string {
  return snippet.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS)
}

export interface Io {
  refreshTokenFor: (db: SupabaseClient, id: string) => Promise<string>
  accessTokenFor: (refresh: string) => Promise<string>
  searchMessageIds: typeof searchMessageIds
  getMessageMeta: typeof getMessageMeta
  getThreadFull: typeof getThreadFull
}
export const REAL_IO: Io = { refreshTokenFor, accessTokenFor, searchMessageIds, getMessageMeta, getThreadFull }

export interface Hit { mailbox: string; connection_id: string; thread_id: string; message_id: string; date: string | null; from: string | null; to: string | null; subject: string | null; excerpt: string; body?: string }
export interface NotSearched { mailbox: string; connection_id: string; reason: string }
export interface SearchResult { mode: 'search' | 'thread'; results: Hit[]; mailboxes_searched: string[]; not_searched: NotSearched[]; searched_ids: string[] }

// Reasons by what actually happened (fix/mail-token-errors). "Reconnect" only when Google no longer accepts the
// sign-in or no sign-in is stored (PERMANENT_CODES); any other failure may clear by itself.
export const REASON = {
  revoked: 'Access to this mailbox was revoked. Reconnect it in Settings, Mailboxes.',
  reconnect: 'Google no longer accepts this sign-in. Reconnect it in Settings, Mailboxes.',
  later: 'Could not be read just now; it will be tried again.',
}
const reasonFor = (e: unknown) => (e instanceof MailError && isPermanent(e.code) ? REASON.reconnect : REASON.later)

/** The mailboxes the caller may search: listVisible, then canSee again, so a private mailbox is its owner's (and the users
 *  the owner listed in also_visible_to) only. */
export async function visibleConnections(caller: SearchCaller): Promise<MailConnectionRow[] | null> {
  const rows = await listVisible(caller)
  if (!rows) return null
  return rows.filter((r) => canSee(caller, r) && (r.visibility === 'shared' || ownerEquivalent(caller, r)))
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const k = next++
      try { out[k] = { status: 'fulfilled', value: await fn(items[k]) } } catch (e) { out[k] = { status: 'rejected', reason: e } }
    }
  }))
  return out
}

function hitOf(row: MailConnectionRow, m: MessageMeta): Hit {
  return { mailbox: row.email_address, connection_id: row.id, thread_id: m.threadId, message_id: m.id, date: m.date, from: m.from, to: m.to, subject: m.subject, excerpt: excerpt(m.snippet) }
}

/**
 * Runs one search (or one thread read). Reads Gmail only; writes nothing. A connection that cannot be searched
 * is listed in not_searched with its reason and never silently dropped.
 */
export async function runSearch(caller: SearchCaller, input: SearchInput, io: Io = REAL_IO): Promise<SearchResult | { notFound: true } | null> {
  const rows = await visibleConnections(caller)
  if (!rows) return null
  const notSearched: NotSearched[] = []
  const skip = (r: MailConnectionRow, reason: string) => notSearched.push({ mailbox: r.email_address, connection_id: r.id, reason })

  let targets = rows
  if (input.threadId) {
    const one = rows.find((r) => r.id === input.mailbox || r.email_address.toLowerCase() === input.mailbox)
    if (!one) return { notFound: true }
    targets = [one]
  }

  const usable: Array<{ row: MailConnectionRow; token: string }> = []
  for (const r of targets) {
    // Revoked mailboxes have no stored sign-in and stay skipped. A mailbox marked 'error' is still tried: the
    // mark may be stale (a passing failure), so the token refresh decides.
    if (r.status === 'revoked') { skip(r, REASON.revoked); continue }
    try {
      usable.push({ row: r, token: await io.accessTokenFor(await io.refreshTokenFor(caller.db, r.id)) })
    } catch (e) {
      skip(r, reasonFor(e))
    }
  }

  const results: Hit[] = []
  const searched: MailConnectionRow[] = []
  if (input.threadId) {
    for (const u of usable) {
      try {
        const msgs = await io.getThreadFull(u.token, input.threadId)
        searched.push(u.row)
        for (const m of msgs) {
          if (m.labels.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH')) continue
          results.push({ ...hitOf(u.row, m), body: m.body })
        }
      } catch (e) {
        if (e instanceof MailError && e.code === 'message_gone') { searched.push(u.row); continue }
        skip(u.row, REASON.later)
      }
    }
  } else {
    const q = gmailQuery(input)
    const per = await Promise.allSettled(usable.map(async (u) => {
      const ids = await io.searchMessageIds(u.token, q, MAX_PER_MAILBOX)
      const metas = await pool(ids, 5, (m) => io.getMessageMeta(u.token, m.id))
      return { u, metas }
    }))
    per.forEach((p, k) => {
      const row = usable[k].row
      if (p.status === 'rejected') { skip(row, REASON.later); return }
      searched.push(row)
      for (const m of p.value.metas) if (m.status === 'fulfilled') results.push(hitOf(row, m.value))
    })
  }
  results.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
  return {
    mode: input.threadId ? 'thread' : 'search', results,
    mailboxes_searched: searched.map((r) => r.email_address), searched_ids: searched.map((r) => r.id), not_searched: notSearched,
  }
}

// ─── the search log (hub_242) and the rate limit ────────────────────────────────

const memory = new Map<string, number[]>()
/** Per server instance backstop: RATE_MAX searches per caller per window. */
export function memoryAllows(callerId: string, now: number): boolean {
  const since = now - RATE_WINDOW_MINUTES * 60_000
  const hits = (memory.get(callerId) ?? []).filter((t) => t > since)
  if (hits.length >= RATE_MAX) { memory.set(callerId, hits); return false }
  hits.push(now); memory.set(callerId, hits)
  return true
}

/** 'ok' | 'limited' | 'unavailable' (the log cannot be read: fail closed). Counted from the log, across instances. */
export async function rateCheck(db: SupabaseClient, callerId: string, now: Date): Promise<'ok' | 'limited' | 'unavailable'> {
  const since = new Date(now.getTime() - RATE_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await db.from('hub_mail_search_log').select('id', { count: 'exact', head: true })
    .eq('caller_user_id', callerId).gte('searched_at', since)
  if (error) return 'unavailable'
  if ((count ?? 0) >= RATE_MAX) return 'limited'
  return memoryAllows(callerId, now.getTime()) ? 'ok' : 'limited'
}

/** Writes the log row before anything is searched; null means the search must not run. */
export async function startLog(db: SupabaseClient, caller: SearchCaller, input: SearchInput, hash: string, now: Date): Promise<string | null> {
  const { data, error } = await db.from('hub_mail_search_log').insert({
    caller_user_id: caller.userId, via: caller.via, mode: input.threadId ? 'thread' : 'search', terms_hash: hash,
    term_count: input.emails.length + input.phones.length + input.names.length, date_from: input.dateFrom, date_to: input.dateTo,
    status: 'started', searched_at: now.toISOString(),
  }).select('id').single()
  if (error || !data) return null
  return (data as any).id as string
}

/** Counts only: mailbox ids, how many were skipped, how many messages came back. */
export async function finishLog(db: SupabaseClient, id: string, r: SearchResult | null): Promise<void> {
  const { error } = await db.from('hub_mail_search_log').update(r
    ? { status: 'done', mailbox_ids: r.searched_ids, not_searched_count: r.not_searched.length, message_count: r.results.length }
    : { status: 'failed' }).eq('id', id)
  if (error) console.error(`[mail-search] log update failed: ${error.code ?? 'unknown'}`)
}
