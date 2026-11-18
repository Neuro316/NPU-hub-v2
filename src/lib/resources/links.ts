// src/lib/resources/links.ts
// Tracked short links for resources (Running List q33, hub_240). Server only (service role).
//
// Share a resource: a staff member picks a resource on a contact's card and gets a link
// <hub>/r/<code> to paste into their own email or text. Making the link sends nothing: it writes one
// hub_resource_links row and one timeline entry, and returns the URL.
//
// The redirect (/r/<code>, public) accepts only a well-formed code that exists, is not revoked and whose
// resource is active. It records the click on the link's own contact: the first click adds a timeline entry,
// later clicks update that entry's latest time and count. Nothing about the visitor is read or stored (no IP,
// no user agent, no referrer): only the click time.
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CODE_RE = /^[A-Za-z0-9]{12}$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** A random 12-character code (about 71 bits), unbiased: bytes of 248 or more are skipped. */
export function newCode(): string {
  let out = ''
  while (out.length < 12) {
    const bytes = randomBytes(24)
    for (let i = 0; i < bytes.length && out.length < 12; i++) {
      if (bytes[i] < 248) out += ALPHABET[bytes[i] % 62]
    }
  }
  return out
}

export const linkUrl = (origin: string, code: string) => `${origin.replace(/\/+$/, '')}/r/${code}`

export interface ShareInput { orgId: string; contactId: string; resourceId: string; userId: string; origin: string; now: Date; code?: string }
export type ShareResult = { ok: true; id: string; code: string; url: string } | { ok: false; status: number; error: string }

/**
 * Makes one tracked link for one contact. The contact must be in the org and not merged away; the resource must
 * be in the org and active. Writes hub_resource_links and contact_timeline only: no message is sent.
 */
export async function createShareLink(db: SupabaseClient, i: ShareInput): Promise<ShareResult> {
  const [{ data: contact }, { data: res }] = await Promise.all([
    db.from('contacts').select('id, org_id, merged_into_id').eq('id', i.contactId).eq('org_id', i.orgId).maybeSingle(),
    db.from('hub_resources').select('id, name, archived_at').eq('id', i.resourceId).eq('org_id', i.orgId).maybeSingle(),
  ])
  if (!contact || (contact as any).merged_into_id) return { ok: false, status: 404, error: 'That contact was not found.' }
  if (!res || (res as any).archived_at) return { ok: false, status: 400, error: 'That resource is retired or was not found.' }
  const code = i.code ?? newCode()
  const at = i.now.toISOString()
  const { data: link, error } = await db.from('hub_resource_links').insert({
    org_id: i.orgId, resource_id: i.resourceId, contact_id: i.contactId, code, created_by: i.userId, created_at: at,
  }).select('id').single()
  if (error || !link) return { ok: false, status: 500, error: 'The link could not be made. Try again.' }
  const linkId = (link as any).id as string
  const { error: tlErr } = await db.from('contact_timeline').insert({
    org_id: i.orgId, contact_id: i.contactId, event_type: 'resource_link_shared',
    title: `Resource link made: ${(res as any).name}`.slice(0, 300), description: 'A tracked link was copied to share. The Hub sent nothing.',
    metadata: { link_id: linkId, resource_id: i.resourceId }, source_table: 'hub_resource_links', source_id: linkId,
    actor_type: 'user', actor_id: i.userId, occurred_at: at,
  })
  if (tlErr) console.error(`[resources/links] timeline failed: ${tlErr.code ?? 'unknown'}`)
  return { ok: true, id: linkId, code, url: linkUrl(i.origin, code) }
}

export type ClickTarget = { kind: 'url'; url: string } | { kind: 'file'; storagePath: string }
export type ClickResult = { ok: true; target: ClickTarget } | { ok: false; reason: 'unknown' | 'retired' }

/** One click on /r/<code>. Validates the code, records the click on the link's contact, returns where to go. */
export async function recordClick(db: SupabaseClient, code: string, now: Date): Promise<ClickResult> {
  if (!CODE_RE.test(code)) return { ok: false, reason: 'unknown' }
  const { data: link } = await db.from('hub_resource_links')
    .select('id, org_id, contact_id, resource_id, first_clicked_at, click_count, revoked_at').eq('code', code).maybeSingle()
  if (!link) return { ok: false, reason: 'unknown' }
  const l = link as any
  if (l.revoked_at) return { ok: false, reason: 'retired' }
  const { data: res } = await db.from('hub_resources').select('id, name, url, storage_path, archived_at')
    .eq('id', l.resource_id).eq('org_id', l.org_id).maybeSingle()
  const r = res as any
  if (!r || r.archived_at || !(r.url || r.storage_path)) return { ok: false, reason: 'retired' }

  const at = now.toISOString()
  const first = !l.first_clicked_at
  const clicks = Number(l.click_count || 0) + 1
  const { error: upErr } = await db.from('hub_resource_links')
    .update({ first_clicked_at: l.first_clicked_at ?? at, last_clicked_at: at, click_count: clicks }).eq('id', l.id)
  if (upErr) console.error(`[resources/links] click record failed: ${upErr.code ?? 'unknown'}`)

  const metadata = { link_id: l.id, resource_id: r.id, first_clicked_at: l.first_clicked_at ?? at, last_clicked_at: at, clicks }
  const description = clicks === 1 ? 'Opened once.' : `Opened ${clicks} times. Latest: ${at}.`
  if (first) {
    const { error } = await db.from('contact_timeline').insert({
      org_id: l.org_id, contact_id: l.contact_id, event_type: 'resource_link_opened', title: `Opened ${r.name}`.slice(0, 300),
      description, metadata, source_table: 'hub_resource_links', source_id: l.id, actor_type: 'system', occurred_at: at,
    })
    if (error) console.error(`[resources/links] timeline failed: ${error.code ?? 'unknown'}`)
  } else {
    const { error } = await db.from('contact_timeline').update({ description, metadata })
      .eq('source_table', 'hub_resource_links').eq('source_id', l.id).eq('event_type', 'resource_link_opened').eq('contact_id', l.contact_id)
    if (error) console.error(`[resources/links] timeline update failed: ${error.code ?? 'unknown'}`)
  }
  return { ok: true, target: r.url ? { kind: 'url', url: r.url } : { kind: 'file', storagePath: r.storage_path } }
}

/**
 * A small in-memory limiter for the public redirect, per server instance. Keys are the CODE (never the visitor):
 * at most `perCode` clicks per code per minute, and at most `misses` unknown codes per minute in total.
 */
export function clickLimiter(perCode = 30, misses = 120) {
  const hits = new Map<string, { at: number; n: number }>()
  const bump = (key: string, max: number, now: number) => {
    const h = hits.get(key)
    if (!h || now - h.at >= 60_000) { hits.set(key, { at: now, n: 1 }); return true }
    h.n++
    return h.n <= max
  }
  return {
    allowCode: (code: string, now = Date.now()) => {
      if (hits.size > 5000) hits.clear()
      return bump(`c:${code}`, perCode, now)
    },
    allowMiss: (now = Date.now()) => bump('miss', misses, now),
  }
}

/** Campaign steps whose subject or body contains the URL (a trailing slash ignored). */
export function stepsUsing(url: string, steps: Array<{ id: string; sequence_id: string; step_order: number; subject: string | null; body: string | null }>) {
  const base = url.replace(/\/+$/, '')
  // exactly this URL: an optional trailing slash, then the end, a query, a fragment or a character that cannot
  // continue a URL. A longer path (the home page inside a checkout link) is a different resource.
  const re = new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?(?=$|[?#\\s"\'<>)\\],;!]|[.:](?:$|\\s))')
  return steps.filter((s) => re.test(`${s.subject ?? ''} ${s.body ?? ''}`))
}
