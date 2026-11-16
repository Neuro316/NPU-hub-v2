// src/lib/metrics/collect.ts
// Reads the shared tables (plain service-role SELECTs; nothing is written to them) and turns
// them into Items: one per counted thing, carrying the New York day, the value, its
// breakdowns and the record behind it. The rollup sums Items into hub_metrics_daily, and the
// records endpoint lists the same Items, so a tile and its click-through cannot disagree.
// Definitions: docs/metrics/definitions.md. Every loader runs through the shared test filter.
//
// "Snapshot" metrics (a level today: open tickets, active clients, stuck clients) are only
// produced when the range includes today.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TestFilter } from './test-filter'
import { nyDay, addDays, daysBetween, queryFrom, queryTo } from './dates'
import { loadPositions, type Position } from '@/lib/pipelines/positions'

export interface Rec { id: string; label: string; sub?: string; href?: string; amount?: number }
export interface Item { metric: string; day: string; value: number; dims?: Record<string, string>; rec?: Rec }

export interface Ctx {
  db: SupabaseClient
  from: string
  to: string
  today: string
  now: Date
  filter: TestFilter
}

type Loader = (ctx: Ctx) => Promise<Item[]>

const contactHref = (id: string) => `/crm/contacts?id=${id}`
const fullName = (f?: string | null, l?: string | null) => [f, l].filter(Boolean).join(' ').trim()
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const inRange = (ctx: Ctx, day: string) => day >= ctx.from && day <= ctx.to
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export { median }

/** Every row of a query, 1000 at a time. */
async function all<T = any>(q: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, label: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(`${label} read failed: ${error.code ?? 'unknown'}`)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

async function inChunks<T = any>(ids: string[], q: (chunk: string[]) => PromiseLike<{ data: any; error: any }>, label: string): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await q(ids.slice(i, i + 200))
    if (error) throw new Error(`${label} read failed: ${error.code ?? 'unknown'}`)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

// ─── lead channels (definitions §1) ──────────────────────────────────────────
const INBOUND_WEB = ['stripe', 'xregulation', 'neuroreport', 'profile', 'website', 'university_booking', 'quiz', 'booking', 'form', 'landing']
export function leadChannel(source: string | null | undefined): string {
  const s = lower(source)
  // the 2026-11 hygiene values for leads whose origin was never recorded stay in `unknown`, as a blank source did
  if (!s || s === 'other' || s === 'unknown' || s.startsWith('unknown_') || s === 'wnw_local' || s === 'referral') return 'unknown'
  if (s.includes('http') || s.includes('www.') || s.includes('research') || s.includes('thinkers50')) return 'prospecting'
  if (['import', 'admin', 'manual-chat', 'manual_ecr'].includes(s)) return 'import'
  if (s === 'media_appearance' || s.includes('podcast')) return 'podcast_pr'
  if (s === 'inbound_call') return 'inbound_call'
  if (s.includes('workshop') || s.includes('event')) return 'event'
  if (INBOUND_WEB.some(w => s.includes(w))) return 'inbound_web'
  return 'prospecting' // city and state names from prospect research
}
export const SCORECARD_CHANNELS = (ch: string) => ch !== 'prospecting' && ch !== 'import'

function sourceLabel(source: string | null | undefined): string {
  const s = String(source ?? '').trim()
  if (!s) return '(none)'
  const url = s.match(/https?:\/\/([^/\s|]+)/i)
  return (url ? url[1].replace(/^www\./, '') : s).slice(0, 80)
}

// ─── contacts: leads, speed to lead, booked within 30 days, unsubscribes ─────
const contactsLoader: Loader = async ctx => {
  const { db, filter } = ctx
  const rows = await all(
    (a, b) => db.from('contacts').select('id, first_name, last_name, email, phone, tags, source, created_at')
      .is('merged_into_id', null).gte('created_at', queryFrom(ctx.from)).lt('created_at', queryTo(ctx.to)).order('created_at').range(a, b),
    'contacts')
  const items: Item[] = []
  const leads = rows.filter(c => inRange(ctx, nyDay(c.created_at)) && !filter.isTestContact(c))
  const inbound = leads.filter(c => SCORECARD_CHANNELS(leadChannel(c.source)))
  for (const c of leads) {
    const day = nyDay(c.created_at), channel = leadChannel(c.source)
    const rec = { id: c.id, label: fullName(c.first_name, c.last_name) || c.email || 'Unnamed contact', sub: `${channel} · ${sourceLabel(c.source)}`, href: contactHref(c.id) }
    items.push({ metric: 'leads_all', day, value: 1, dims: { channel }, rec })
    items.push({ metric: 'leads_by_source', day, value: 1, dims: { source: sourceLabel(c.source) }, rec })
    if (SCORECARD_CHANNELS(channel)) items.push({ metric: 'leads', day, value: 1, dims: { channel }, rec })
    if (channel === 'podcast_pr') items.push({ metric: 'podcast_leads', day, value: 1, rec })
  }

  // speed to lead: the first outbound touch after the contact was created (inbound leads only)
  const ids = inbound.map(c => c.id)
  if (ids.length) {
    const firstTouch = new Map<string, number>()
    const touch = (id: string | null, at: string | null) => {
      if (!id || !at) return
      const t = new Date(at).getTime()
      if (!firstTouch.has(id) || t < firstTouch.get(id)!) firstTouch.set(id, t)
    }
    const convs = await inChunks(ids, ch => db.from('conversations').select('id, contact_id').in('contact_id', ch), 'conversations')
    const convContact = new Map(convs.map(c => [c.id, c.contact_id]))
    const msgs = await inChunks(Array.from(convContact.keys()), ch => db.from('crm_messages').select('conversation_id, sent_at, created_at').eq('direction', 'outbound').in('conversation_id', ch), 'crm_messages')
    for (const m of msgs) touch(convContact.get(m.conversation_id) ?? null, m.sent_at ?? m.created_at)
    const calls = await inChunks(ids, ch => db.from('call_logs').select('contact_id, started_at, created_at').eq('direction', 'outbound').in('contact_id', ch), 'call_logs')
    for (const c of calls) touch(c.contact_id, c.started_at ?? c.created_at)
    const sends = await inChunks(ids, ch => db.from('message_sends').select('contact_id, sent_at').eq('dry_run', false).not('sent_at', 'is', null).in('contact_id', ch), 'message_sends')
    for (const s of sends) touch(s.contact_id, s.sent_at)
    const emails = await inChunks(ids, ch => db.from('email_sends').select('contact_id, sent_at').not('sent_at', 'is', null).in('contact_id', ch), 'email_sends')
    for (const e of emails) touch(e.contact_id, e.sent_at)

    // Gmail sent from connected mailboxes (metadata only: recipient address and sent time), SHARED mailboxes only:
    // the mail privacy rule (2026-11-09) keeps private mailboxes out of every metric. Absent until hub_236.
    const byEmail = new Map<string, string[]>()
    for (const c of inbound) { const e = lower(c.email); if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), c.id]) }
    const leadEmails = Array.from(byEmail.keys())
    if (leadEmails.length) {
      const { data: shared } = await db.from('hub_mail_connections').select('id').eq('visibility', 'shared')
      const sharedIds = (shared ?? []).map((c: any) => c.id as string)
      if (sharedIds.length) {
        const sent = await inChunks(leadEmails, ch => db.from('hub_mail_sent').select('to_address, sent_at').in('connection_id', sharedIds).in('to_address', ch), 'hub_mail_sent')
          .catch(() => [] as any[])  // table absent before hub_236
        for (const m of sent) for (const id of byEmail.get(lower(m.to_address)) ?? []) touch(id, m.sent_at)
      }
    }

    // the lead's own booking (nr_bookings matched by email to the guest or participant), any time
    const bookedAll = new Map<string, number[]>()
    if (leadEmails.length) {
      const bl = await inChunks(leadEmails, ch => db.from('nr_booking_leads').select('id, email').in('email', ch), 'nr_booking_leads')
      const pr = await inChunks(leadEmails, ch => db.from('profiles').select('id, email').in('email', ch), 'profiles')
      const blEmail = new Map(bl.map(l => [l.id, lower(l.email)])), prEmail = new Map(pr.map(p => [p.id, lower(p.email)]))
      const bks = [
        ...await inChunks(Array.from(blEmail.keys()), ch => db.from('nr_bookings').select('created_at, lead_id, participant_id').in('lead_id', ch), 'nr_bookings'),
        ...await inChunks(Array.from(prEmail.keys()), ch => db.from('nr_bookings').select('created_at, lead_id, participant_id').in('participant_id', ch), 'nr_bookings'),
      ]
      for (const k of bks) {
        const e = (k.lead_id && blEmail.get(k.lead_id)) || (k.participant_id && prEmail.get(k.participant_id)) || ''
        if (e) bookedAll.set(e, [...(bookedAll.get(e) ?? []), new Date(k.created_at).getTime()])
      }
    }

    for (const c of inbound) {
      const created = new Date(c.created_at).getTime()
      const t = firstTouch.get(c.id)
      const touched = t !== undefined && t >= created
      const label = fullName(c.first_name, c.last_name) || c.email || 'Unnamed contact'
      const bk = bookedAll.get(lower(c.email)) ?? []
      // handled by their own booking: one made at or before the lead (0 minutes), or after it and before any touch
      const before = bk.some(b => b <= created)
      const after = bk.filter(b => b > created).sort((x, y) => x - y)[0]
      if (before || (after !== undefined && (!touched || after < t!))) {
        const minutes = before ? 0 : Math.round((after! - created) / 60_000)
        items.push({ metric: 'self_booked_leads', day: nyDay(c.created_at), value: 1, rec: {
          id: c.id, label, sub: before ? 'booked before or as the lead came in' : `booked a call ${minutes} min after coming in`, href: contactHref(c.id),
        } })
        continue
      }
      // an untouched lead counts the minutes it has waited so far
      const minutes = Math.max(0, Math.round(((touched ? t! : ctx.now.getTime()) - created) / 60_000))
      items.push({ metric: 'speed_to_lead', day: nyDay(c.created_at), value: minutes, rec: {
        id: c.id, label,
        sub: touched ? `${minutes} min to first touch` : `no outbound touch yet (${minutes} min)`, href: contactHref(c.id),
      } })
    }

    // booked within 30 days, matched by email to the booking's guest or participant
    const emailsWanted = new Set(inbound.map(c => lower(c.email)).filter(Boolean))
    if (emailsWanted.size) {
      const bookings = await all(
        (a, b) => db.from('nr_bookings').select('created_at, lead_id, participant_id')
          .gte('created_at', queryFrom(ctx.from)).lt('created_at', queryTo(addDays(ctx.to, 31))).range(a, b), 'nr_bookings')
      const leadIds = Array.from(new Set(bookings.map(b => b.lead_id).filter(Boolean)))
      const partIds = Array.from(new Set(bookings.map(b => b.participant_id).filter(Boolean)))
      const leadEmail = new Map((await inChunks(leadIds, ch => db.from('nr_booking_leads').select('id, email').in('id', ch), 'nr_booking_leads')).map(l => [l.id, lower(l.email)]))
      const partEmail = new Map((await inChunks(partIds, ch => db.from('profiles').select('id, email').in('id', ch), 'profiles')).map(p => [p.id, lower(p.email)]))
      const bookedAt = new Map<string, number[]>()
      for (const b of bookings) {
        const e = (b.lead_id && leadEmail.get(b.lead_id)) || (b.participant_id && partEmail.get(b.participant_id)) || ''
        if (e && emailsWanted.has(e)) bookedAt.set(e, [...(bookedAt.get(e) ?? []), new Date(b.created_at).getTime()])
      }
      for (const c of inbound) {
        const created = new Date(c.created_at).getTime()
        const hit = (bookedAt.get(lower(c.email)) ?? []).some(t => t >= created - 3_600_000 && t <= created + 30 * 86_400_000)
        if (hit) items.push({ metric: 'leads_booked_30d', day: nyDay(c.created_at), value: 1, dims: { channel: leadChannel(c.source) },
          rec: { id: c.id, label: fullName(c.first_name, c.last_name) || c.email, href: contactHref(c.id) } })
      }
    }
  }

  const unsub = await all(
    (a, b) => db.from('contacts').select('id, first_name, last_name, email, phone, tags, email_unsubscribed_at')
      .is('merged_into_id', null).gte('email_unsubscribed_at', queryFrom(ctx.from)).lt('email_unsubscribed_at', queryTo(ctx.to)).range(a, b), 'contacts unsubscribed')
  for (const c of unsub) {
    const day = nyDay(c.email_unsubscribed_at)
    if (inRange(ctx, day) && !filter.isTestContact(c)) items.push({ metric: 'unsubscribed', day, value: 1, rec: { id: c.id, label: fullName(c.first_name, c.last_name) || c.email, href: contactHref(c.id) } })
  }
  return items
}

// ─── bookings: booked calls, shows, no-shows ─────────────────────────────────
const bookingsLoader: Loader = async ctx => {
  const { db, filter } = ctx
  const types = await all((a, b) => db.from('nr_appointment_types').select('id, name, is_public, requires_card, paywall_id, payment_flow').range(a, b), 'nr_appointment_types')
  const callTypes = new Map(types.filter(t => t.is_public && !t.requires_card && !t.paywall_id && t.payment_flow !== 'balance').map(t => [t.id, t.name]))
  const typeName = new Map(types.map(t => [t.id, t.name]))
  const cols = 'id, appointment_type_id, lead_id, participant_id, status, starts_at, created_at'
  const created = await all((a, b) => db.from('nr_bookings').select(cols).gte('created_at', queryFrom(ctx.from)).lt('created_at', queryTo(ctx.to)).range(a, b), 'nr_bookings')
  const started = await all((a, b) => db.from('nr_bookings').select(cols).in('status', ['arrived', 'no_show']).gte('starts_at', queryFrom(ctx.from)).lt('starts_at', queryTo(ctx.to)).range(a, b), 'nr_bookings')
  const leadIds = Array.from(new Set([...created, ...started].map(b => b.lead_id).filter(Boolean)))
  const partIds = Array.from(new Set([...created, ...started].map(b => b.participant_id).filter(Boolean)))
  const leads = new Map((await inChunks(leadIds, ch => db.from('nr_booking_leads').select('id, name, email').in('id', ch), 'nr_booking_leads')).map(l => [l.id, l]))
  const parts = new Map((await inChunks(partIds, ch => db.from('profiles').select('id, full_name, email').in('id', ch), 'profiles')).map(p => [p.id, p]))
  const guest = (b: any) => {
    const l = b.lead_id ? leads.get(b.lead_id) : null, p = b.participant_id ? parts.get(b.participant_id) : null
    return { name: l?.name || p?.full_name || l?.email || p?.email || 'Guest', email: l?.email || p?.email || null }
  }
  const isTest = (b: any) => filter.isTestProfile(b.participant_id, guest(b).email) || filter.isTestEmail(guest(b).email)
  const items: Item[] = []
  for (const b of created) {
    const day = nyDay(b.created_at)
    if (!inRange(ctx, day) || b.status === 'released' || !callTypes.has(b.appointment_type_id) || isTest(b)) continue
    items.push({ metric: 'booked_calls', day, value: 1, dims: { type: callTypes.get(b.appointment_type_id)! }, rec: { id: b.id, label: guest(b).name, sub: `${callTypes.get(b.appointment_type_id)} · ${b.status}` } })
  }
  for (const b of started) {
    const day = nyDay(b.starts_at)
    if (!inRange(ctx, day) || isTest(b)) continue
    items.push({ metric: b.status === 'arrived' ? 'shows' : 'no_shows', day, value: 1, rec: { id: b.id, label: guest(b).name, sub: typeName.get(b.appointment_type_id) ?? '' } })
  }
  return items
}

// ─── payments: sales, comps, revenue, refunds, onboarding cohort, lifetime ───
interface Purchase { id: string; at: string; day: string; participant: string | null; email: string | null; name: string; product: string; cents: number; refunded: number; status: string }

/** Every non-test University payment, all time (the table is small; the cohort needs history). */
async function loadPurchases(ctx: Ctx): Promise<Purchase[]> {
  const { db, filter } = ctx
  const pays = await all((a, b) => db.from('payments')
    .select('id, participant_id, amount_cents, amount_refunded_cents, status, description, enrollment_id, paid_at, created_at')
    .in('status', ['succeeded', 'refunded', 'partially_refunded']).order('created_at').range(a, b), 'payments')
  const profs = new Map((await inChunks(Array.from(new Set(pays.map(p => p.participant_id).filter(Boolean))),
    ch => db.from('profiles').select('id, email, full_name').in('id', ch), 'profiles')).map(p => [p.id, p]))
  const promos = await inChunks(pays.map(p => p.id), ch => db.from('promo_redemptions').select('payment_id, promo_code').in('payment_id', ch), 'promo_redemptions')
  const testPromoPay = new Set(promos.filter(r => filter.isTestPromo(r.promo_code)).map(r => r.payment_id))
  const enrollIds = Array.from(new Set(pays.map(p => p.enrollment_id).filter(Boolean)))
  const enrolls = await inChunks(enrollIds, ch => db.from('enrollments').select('id, program_id').in('id', ch), 'enrollments')
  const progIds = Array.from(new Set(enrolls.map(e => e.program_id).filter(Boolean)))
  const progName = new Map((await inChunks(progIds, ch => db.from('programs').select('id, name').in('id', ch), 'programs')).map(p => [p.id, p.name]))
  const testEnroll = new Set(enrolls.filter(e => filter.isTestProgramName(progName.get(e.program_id))).map(e => e.id))
  const out: Purchase[] = []
  for (const p of pays) {
    const prof = p.participant_id ? profs.get(p.participant_id) : null
    if (filter.isTestProfile(p.participant_id, prof?.email) || testPromoPay.has(p.id) || (p.enrollment_id && testEnroll.has(p.enrollment_id))) continue
    const at = p.paid_at ?? p.created_at
    out.push({
      id: p.id, at, day: nyDay(at), participant: p.participant_id, email: prof?.email ?? null, name: prof?.full_name || prof?.email || 'Buyer',
      product: String(p.description ?? '').replace(/^Paywall:\s*/i, '').trim() || 'other',
      cents: Number(p.amount_cents ?? 0), refunded: Number(p.amount_refunded_cents ?? 0), status: p.status,
    })
  }
  return out
}

const paymentsLoader: Loader = async ctx => {
  const { db } = ctx
  const purchases = await loadPurchases(ctx)
  const items: Item[] = []
  const rec = (p: Purchase, sub: string): Rec => ({ id: p.id, label: p.name, sub, amount: (p.cents - p.refunded) / 100 })
  const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  for (const p of purchases.filter(x => inRange(ctx, x.day))) {
    const net = (p.cents - p.refunded) / 100
    const paid = p.cents > 0
    const isAssessment = /assessment/i.test(p.product)
    if (paid && net > 0) {
      items.push({ metric: 'sales', day: p.day, value: 1, dims: { product: p.product }, rec: rec(p, `${p.product} · ${usd(p.cents)}`) })
      if (p.product === 'clarity-protocol') items.push({ metric: 'clarity_sales', day: p.day, value: 1, rec: rec(p, usd(p.cents)) })
    }
    if (!paid && p.status === 'succeeded') items.push({ metric: 'comps', day: p.day, value: 1, dims: { product: p.product }, rec: rec(p, `${p.product} · $0`) })
    if (isAssessment && (net > 0 || !paid)) items.push({ metric: 'assessments_sold', day: p.day, value: 1, dims: { product: p.product, paid: paid ? 'paid' : 'free' }, rec: rec(p, `${p.product} · ${usd(p.cents)}`) })
    if (net !== 0) {
      items.push({ metric: 'revenue', day: p.day, value: net, dims: { stream: 'university' }, rec: rec(p, `${p.product} · University payment`) })
      items.push({ metric: 'revenue_platform', day: p.day, value: net, dims: { product: p.product }, rec: rec(p, p.product) })
    }
    if (p.refunded > 0) {
      items.push({ metric: 'refunds', day: p.day, value: 1, rec: rec(p, `${p.product} · ${usd(p.refunded)} refunded`) })
      items.push({ metric: 'refund_amount', day: p.day, value: p.refunded / 100, rec: rec(p, p.product) })
    }
  }

  // new clients (paid or comp): a participant's first purchase in the range
  const firstBuy = new Map<string, Purchase>()
  for (const p of purchases) if (p.participant && p.status === 'succeeded' && !firstBuy.has(p.participant)) firstBuy.set(p.participant, p)
  for (const p of Array.from(firstBuy.values())) if (inRange(ctx, p.day)) items.push({ metric: 'buyers', day: p.day, value: 1, rec: rec(p, p.product) })

  // days from lead to purchase (paid sales; the contact is matched by email)
  const paidInRange = purchases.filter(p => inRange(ctx, p.day) && p.cents > 0 && p.email)
  const emails = Array.from(new Set(paidInRange.map(p => lower(p.email))))
  if (emails.length) {
    const contacts = await inChunks(emails, ch => db.from('contacts').select('email, created_at').in('email', ch).is('merged_into_id', null), 'contacts')
    const firstSeen = new Map<string, string>()
    for (const c of contacts) { const e = lower(c.email); if (!firstSeen.has(e) || c.created_at < firstSeen.get(e)!) firstSeen.set(e, c.created_at) }
    for (const p of paidInRange) {
      const seen = firstSeen.get(lower(p.email))
      if (seen && seen <= p.at) items.push({ metric: 'days_lead_to_purchase', day: p.day, value: daysBetween(nyDay(seen), p.day), rec: rec(p, p.product) })
    }
  }

  // promo redemptions (test codes and test buyers excluded)
  const promos = await all((a, b) => db.from('promo_redemptions').select('id, promo_code, customer_email, customer_name, discount_amount_cents, created_at')
    .gte('created_at', queryFrom(ctx.from)).lt('created_at', queryTo(ctx.to)).range(a, b), 'promo_redemptions')
  for (const r of promos) {
    const day = nyDay(r.created_at)
    if (!inRange(ctx, day) || ctx.filter.isTestPromo(r.promo_code) || ctx.filter.isTestEmail(r.customer_email)) continue
    const code = String(r.promo_code ?? '').toUpperCase() || '(none)'
    const pr: Rec = { id: r.id, label: r.customer_name || r.customer_email || 'Buyer', sub: code }
    items.push({ metric: 'promo_redemptions', day, value: 1, dims: { code }, rec: pr })
    items.push({ metric: 'promo_discount', day, value: Number(r.discount_amount_cents ?? 0) / 100, dims: { code }, rec: pr })
  }

  // all-time levels, as of today
  if (inRange(ctx, ctx.today)) {
    const byBuyer = new Map<string, { products: Set<string>; cents: number; p: Purchase }>()
    for (const p of purchases) {
      if (!p.participant || p.cents - p.refunded <= 0) continue
      const b = byBuyer.get(p.participant) ?? { products: new Set<string>(), cents: 0, p }
      b.products.add(p.product); b.cents += p.cents - p.refunded
      byBuyer.set(p.participant, b)
    }
    const total = purchases.reduce((n, p) => n + (p.cents - p.refunded), 0) / 100
    items.push({ metric: 'revenue_all_time', day: ctx.today, value: total })
    items.push({ metric: 'paying_buyers', day: ctx.today, value: byBuyer.size })
    for (const b of Array.from(byBuyer.values())) {
      if (b.products.size >= 2) items.push({ metric: 'repeat_buyers', day: ctx.today, value: 1, rec: { id: b.p.participant!, label: b.p.name, sub: Array.from(b.products).join(', ') } })
    }
    if (!items.some(i => i.metric === 'repeat_buyers')) items.push({ metric: 'repeat_buyers', day: ctx.today, value: 0 })
  }
  return items
}

// ─── other revenue: clinic payments and manual income ────────────────────────
const otherRevenueLoader: Loader = async ctx => {
  const { db } = ctx
  const items: Item[] = []
  const clinic = await all((a, b) => db.from('acct_payments').select('id, amount, payment_date, notes').gte('payment_date', ctx.from).lte('payment_date', ctx.to).range(a, b), 'acct_payments')
  for (const p of clinic) {
    const v = Number(p.amount ?? 0)
    if (v) items.push({ metric: 'revenue', day: p.payment_date, value: v, dims: { stream: 'clinic' }, rec: { id: p.id, label: 'Clinic payment', amount: v } })
  }
  const manual = await all((a, b) => db.from('fin_income').select('id, amount, txn_date, client_name, product, status, stripe_payment_id, np_payment_id')
    .eq('source', 'manual').gte('txn_date', ctx.from).lte('txn_date', ctx.to).range(a, b), 'fin_income')
  for (const m of manual) {
    if (m.stripe_payment_id || m.np_payment_id || ['void', 'refunded', 'cancelled', 'pending'].includes(lower(m.status))) continue
    const v = Number(m.amount ?? 0)
    if (v) items.push({ metric: 'revenue', day: m.txn_date, value: v, dims: { stream: 'manual' }, rec: { id: m.id, label: m.client_name || 'Manual income', sub: m.product ?? undefined, amount: v } })
  }
  // marketing spend: monthly charges, counted on the first day of their month
  const charges = await all((a, b) => db.from('acct_marketing_charges').select('id, month, amount, description, waived').range(a, b), 'acct_marketing_charges')
  for (const c of charges) {
    const day = /^\d{4}-\d{2}/.test(String(c.month)) ? `${String(c.month).slice(0, 7)}-01` : ''
    if (!day || c.waived || !inRange(ctx, day)) continue
    items.push({ metric: 'ad_spend', day, value: Number(c.amount ?? 0), rec: { id: c.id, label: c.description || 'Marketing charge', amount: Number(c.amount ?? 0) } })
  }
  return items
}

// ─── onboarding and outcomes ─────────────────────────────────────────────────
const STEP_TARGET_DAYS = { consent: 2, pairing: 7, first_session: 10 }

const onboardingLoader: Loader = async ctx => {
  const { db, filter } = ctx
  const items: Item[] = []
  const purchases = await loadPurchases(ctx)
  const firstBuy = new Map<string, Purchase>()
  for (const p of purchases) if (p.participant && p.status === 'succeeded' && !firstBuy.has(p.participant)) firstBuy.set(p.participant, p)

  // first valid HRV session per participant (all time), and valid sessions in range
  const sessions = await all((a, b) => db.from('np_hrv_sessions').select('participant_id, start_time, rmssd')
    .eq('valid', true).not('participant_id', 'is', null).order('start_time').range(a, b), 'np_hrv_sessions')
  const live = sessions.filter(s => !filter.testProfileIds.has(s.participant_id))
  const firstSession = new Map<string, string>()
  for (const s of live) if (!firstSession.has(s.participant_id)) firstSession.set(s.participant_id, s.start_time)
  const names = new Map((await inChunks(Array.from(new Set([...Array.from(firstSession.keys()), ...Array.from(firstBuy.keys())])),
    ch => db.from('profiles').select('id, full_name, email').in('id', ch), 'profiles')).map(p => [p.id, p.full_name || p.email || 'Client']))
  for (const [pid, at] of Array.from(firstSession.entries())) {
    const day = nyDay(at)
    if (inRange(ctx, day)) items.push({ metric: 'onboarded', day, value: 1, rec: { id: pid, label: names.get(pid) ?? 'Client' } })
  }
  for (const s of live) { const day = nyDay(s.start_time); if (inRange(ctx, day)) items.push({ metric: 'hrv_sessions', day, value: 1 }) }

  // steps per buyer: consent, pairing, first session (days from first purchase)
  const buyerIds = Array.from(firstBuy.keys())
  const consents = await inChunks(buyerIds, ch => db.from('consent_signatures').select('user_id, affirmed_at').in('user_id', ch), 'consent_signatures')
  const pairs = await inChunks(buyerIds, ch => db.from('np_onboarding_log').select('profile_id, created_at').eq('event_type', 'xreg_pairing_paired').in('profile_id', ch), 'np_onboarding_log')
  const maps = await inChunks(buyerIds, ch => db.from('np_hrv_participant_map').select('participant_id, mapped_at').in('participant_id', ch), 'np_hrv_participant_map')
  const firstAfter = (rows: { id: string; at: string }[], pid: string, since: string) =>
    rows.filter(r => r.id === pid && r.at >= since).map(r => r.at).sort()[0] ?? null
  const consentRows = consents.map(c => ({ id: c.user_id, at: c.affirmed_at }))
  const pairRows = [...pairs.map(p => ({ id: p.profile_id, at: p.created_at })), ...maps.map(m => ({ id: m.participant_id, at: m.mapped_at }))].filter(r => r.at)
  const stuckSince = addDays(ctx.today, -90)
  for (const [pid, buy] of Array.from(firstBuy.entries())) {
    const since = new Date(new Date(buy.at).getTime() - 86_400_000).toISOString() // a day's grace for same-day signups
    const steps: [keyof typeof STEP_TARGET_DAYS, string, string | null][] = [
      ['consent', 'days_to_consent', firstAfter(consentRows, pid, since)],
      ['pairing', 'days_to_pairing', firstAfter(pairRows, pid, since)],
      ['first_session', 'days_to_first_session', firstSession.get(pid) ?? null],
    ]
    const label = names.get(pid) ?? buy.name
    for (const [step, metric, doneAt] of steps) {
      if (doneAt) {
        const day = nyDay(doneAt)
        if (inRange(ctx, day)) items.push({ metric, day, value: Math.max(0, daysBetween(buy.day, day)), rec: { id: pid, label, sub: buy.product } })
      } else if (inRange(ctx, ctx.today) && buy.day >= stuckSince) {
        const waiting = daysBetween(buy.day, ctx.today)
        if (waiting > STEP_TARGET_DAYS[step]) items.push({ metric: 'onboarding_stuck', day: ctx.today, value: 1, dims: { step },
          rec: { id: pid, label, sub: `${step.replace('_', ' ')} not done · bought ${buy.day} (${buy.product}) · ${waiting} days waiting` } })
      }
    }
  }
  if (inRange(ctx, ctx.today) && !items.some(i => i.metric === 'onboarding_stuck')) items.push({ metric: 'onboarding_stuck', day: ctx.today, value: 0 })

  // as of today: active clients, and the HRV trend share (counts only, never values)
  if (inRange(ctx, ctx.today)) {
    const since14 = new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString()
    const active = new Set<string>(live.filter(s => s.start_time >= since14).map(s => s.participant_id))
    const practice = await all((a, b) => db.from('practice_sessions').select('profile_id').gte('started_at', since14).range(a, b), 'practice_sessions')
    const lessons = await all((a, b) => db.from('lesson_progress').select('user_id').gte('completed_at', since14).range(a, b), 'lesson_progress')
    for (const r of practice) if (r.profile_id && !filter.testProfileIds.has(r.profile_id)) active.add(r.profile_id)
    for (const r of lessons) if (r.user_id && !filter.testProfileIds.has(r.user_id)) active.add(r.user_id)
    const activeNames = new Map((await inChunks(Array.from(active), ch => db.from('profiles').select('id, full_name, email').in('id', ch), 'profiles')).map(p => [p.id, p.full_name || p.email || 'Client']))
    for (const id of Array.from(active)) items.push({ metric: 'active_clients', day: ctx.today, value: 1, rec: { id, label: activeNames.get(id) ?? 'Client' } })
    if (!active.size) items.push({ metric: 'active_clients', day: ctx.today, value: 0 })

    const since90 = new Date(ctx.now.getTime() - 90 * 86_400_000).toISOString()
    const byPart = new Map<string, { t: number; v: number }[]>()
    for (const s of live) {
      if (s.start_time < since90 || s.rmssd == null) continue
      byPart.set(s.participant_id, [...(byPart.get(s.participant_id) ?? []), { t: new Date(s.start_time).getTime() / 86_400_000, v: Number(s.rmssd) }])
    }
    let n = 0, improving = 0
    for (const [pid, pts] of Array.from(byPart.entries())) {
      if (pts.length < 6) continue
      n++
      const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length, mv = pts.reduce((a, p) => a + p.v, 0) / pts.length
      const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) / (pts.reduce((a, p) => a + (p.t - mt) ** 2, 0) || 1)
      if (slope > 0) improving++
      items.push({ metric: 'hrv_trend_n', day: ctx.today, value: 1, rec: { id: pid, label: names.get(pid) ?? activeNames.get(pid) ?? 'Client' } })
    }
    if (!n) items.push({ metric: 'hrv_trend_n', day: ctx.today, value: 0 })
    items.push({ metric: 'hrv_improving', day: ctx.today, value: improving })
  }
  return items
}

const outcomesLoader: Loader = async ctx => {
  const { db, filter } = ctx
  const items: Item[] = []
  const ok = (id: string | null) => !!id && !filter.testProfileIds.has(id)
  const practice = await all((a, b) => db.from('practice_sessions').select('profile_id, started_at').gte('started_at', queryFrom(ctx.from)).lt('started_at', queryTo(ctx.to)).range(a, b), 'practice_sessions')
  for (const r of practice) { const day = nyDay(r.started_at); if (inRange(ctx, day) && ok(r.profile_id)) items.push({ metric: 'practice_sessions', day, value: 1 }) }
  const lessons = await all((a, b) => db.from('lesson_progress').select('user_id, completed_at').gte('completed_at', queryFrom(ctx.from)).lt('completed_at', queryTo(ctx.to)).range(a, b), 'lesson_progress')
  for (const r of lessons) { const day = nyDay(r.completed_at); if (inRange(ctx, day) && ok(r.user_id)) items.push({ metric: 'lessons_completed', day, value: 1 }) }
  const reviews = await all((a, b) => db.from('program_reviews').select('id, user_id, overall_rating, reviewer_name, display_name, created_at').gte('created_at', queryFrom(ctx.from)).lt('created_at', queryTo(ctx.to)).range(a, b), 'program_reviews')
  for (const r of reviews) {
    const day = nyDay(r.created_at)
    if (!inRange(ctx, day) || (r.user_id && !ok(r.user_id)) || r.overall_rating == null) continue
    const rec = { id: r.id, label: r.display_name || r.reviewer_name || 'Reviewer' }
    items.push({ metric: 'reviews', day, value: 1, rec })
    items.push({ metric: 'review_rating_sum', day, value: Number(r.overall_rating) })
  }
  // Clarity → Capacity upgrades, counted on the Capacity grant
  const ents = await all((a, b) => db.from('entitlements').select('user_id, keyword, granted_at').or('keyword.eq.clarity-protocol,keyword.like.capacity-protocol%').range(a, b), 'entitlements')
  const clarityAt = new Map<string, string>()
  for (const e of ents) if (e.keyword === 'clarity-protocol' && ok(e.user_id) && (!clarityAt.has(e.user_id) || e.granted_at < clarityAt.get(e.user_id)!)) clarityAt.set(e.user_id, e.granted_at)
  const upgraded = new Set<string>()
  for (const e of ents.filter(x => x.keyword !== 'clarity-protocol').sort((a, b) => a.granted_at.localeCompare(b.granted_at))) {
    const c = clarityAt.get(e.user_id)
    if (!c || e.granted_at <= c || upgraded.has(e.user_id)) continue
    upgraded.add(e.user_id)
    const day = nyDay(e.granted_at)
    if (inRange(ctx, day)) items.push({ metric: 'upgrades', day, value: 1, rec: { id: e.user_id, label: 'Client', sub: e.keyword } })
  }
  // self-report change, as of today: first vs latest composite per person with 2+ results
  if (inRange(ctx, ctx.today)) {
    const quiz = await all((a, b) => db.from('nr_quiz_results').select('profile_id, composite_score, submitted_at')
      .in('quiz_type', ['nsci', 'biometric']).not('profile_id', 'is', null).not('composite_score', 'is', null).order('submitted_at').range(a, b), 'nr_quiz_results')
    const per = new Map<string, number[]>()
    for (const q of quiz) if (ok(q.profile_id)) per.set(q.profile_id, [...(per.get(q.profile_id) ?? []), Number(q.composite_score)])
    let n = 0, sum = 0
    for (const [pid, xs] of Array.from(per.entries())) {
      if (xs.length < 2) continue
      n++; sum += xs[xs.length - 1] - xs[0]
      items.push({ metric: 'self_report_n', day: ctx.today, value: 1, rec: { id: pid, label: 'Client' } })
    }
    if (!n) items.push({ metric: 'self_report_n', day: ctx.today, value: 0 })
    items.push({ metric: 'self_report_delta_sum', day: ctx.today, value: sum })
  }
  return items
}

// ─── marketing engine, content, operations ───────────────────────────────────
const marketingLoader: Loader = async ctx => {
  const { db, filter } = ctx
  const items: Item[] = []
  const enr = await all((a, b) => db.from('campaign_enrollments').select('id, contact_id, campaign_id, enrolled_at').gte('enrolled_at', queryFrom(ctx.from)).lt('enrolled_at', queryTo(ctx.to)).range(a, b), 'campaign_enrollments')
  const contacts = new Map((await inChunks(Array.from(new Set(enr.map(e => e.contact_id).filter(Boolean))), ch => db.from('contacts').select('id, first_name, last_name, email, phone, tags').in('id', ch), 'contacts')).map(c => [c.id, c]))
  for (const e of enr) {
    const c = contacts.get(e.contact_id), day = nyDay(e.enrolled_at)
    if (!c || !inRange(ctx, day) || filter.isTestContact(c)) continue
    items.push({ metric: 'campaign_entered', day, value: 1, dims: { campaign: String(e.campaign_id ?? 'none').slice(0, 8) }, rec: { id: c.id, label: fullName(c.first_name, c.last_name) || c.email, href: contactHref(c.id) } })
  }
  const sends = await all((a, b) => db.from('message_sends').select('id, contact_id, to_address, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at')
    .eq('dry_run', false).eq('channel', 'email').gte('sent_at', queryFrom(ctx.from)).lt('sent_at', queryTo(ctx.to)).range(a, b), 'message_sends')
  for (const s of sends) {
    if (filter.isTestEmail(s.to_address)) continue
    const rec = { id: s.id, label: s.to_address ?? 'Recipient', href: s.contact_id ? contactHref(s.contact_id) : undefined }
    for (const [metric, at] of [['email_sent', s.sent_at], ['email_delivered', s.delivered_at], ['email_opened', s.opened_at], ['email_clicked', s.clicked_at], ['email_bounced', s.bounced_at], ['email_complained', s.complained_at]] as const) {
      if (at && inRange(ctx, nyDay(at))) items.push({ metric, day: nyDay(at), value: 1, rec })
    }
  }
  return items
}

const contentLoader: Loader = async ctx => {
  const { db } = ctx
  const items: Item[] = []
  const pods = await all((a, b) => db.from('media_appearances').select('id, title, host, type, entry_type, air_date').gte('air_date', queryFrom(ctx.from)).lt('air_date', queryTo(ctx.to)).range(a, b), 'media_appearances')
  for (const p of pods) {
    const day = nyDay(p.air_date)
    if (inRange(ctx, day) && /podcast/i.test(`${p.type} ${p.entry_type}`)) items.push({ metric: 'podcasts', day, value: 1, rec: { id: p.id, label: p.title || 'Podcast', sub: p.host ?? undefined, href: '/media-appearances' } })
  }
  const posts = await all((a, b) => db.from('social_posts').select('id, brand, published_at').gte('published_at', queryFrom(ctx.from)).lt('published_at', queryTo(ctx.to)).range(a, b), 'social_posts')
  for (const p of posts) { const day = nyDay(p.published_at); if (inRange(ctx, day)) items.push({ metric: 'posts_published', day, value: 1, rec: { id: p.id, label: p.brand || 'Post' } }) }
  return items
}

const operationsLoader: Loader = async ctx => {
  const { db } = ctx
  const items: Item[] = []
  const runs = await all((a, b) => db.from('job_runs').select('id, job, started_at').eq('ok', false).gte('started_at', queryFrom(ctx.from)).lt('started_at', queryTo(ctx.to)).range(a, b), 'job_runs')
  for (const r of runs) { const day = nyDay(r.started_at); if (inRange(ctx, day)) items.push({ metric: 'cron_failures', day, value: 1, dims: { job: r.job }, rec: { id: String(r.id), label: r.job, sub: r.started_at } }) }
  if (inRange(ctx, ctx.today)) {
    // Shared mailboxes only (2026-11-09): metrics are visible to every staff member, so a private mailbox's
    // messages are never counted or listed here. Its owner sees them on /mail.
    const shared = await all((a, b) => db.from('hub_mail_connections').select('id').eq('visibility', 'shared').range(a, b), 'hub_mail_connections')
    const sharedIds = shared.map((c: any) => c.id as string)
    const inbox = sharedIds.length
      ? await all((a, b) => db.from('hub_mail_messages').select('id, received_at').eq('status', 'new').in('connection_id', sharedIds).range(a, b), 'hub_mail_messages')
      : []
    for (const m of inbox) items.push({ metric: 'inbox_waiting', day: ctx.today, value: 1, rec: { id: m.id, label: 'Message waiting', sub: `received ${nyDay(m.received_at)}`, href: '/mail' } })
    const tickets = await all((a, b) => db.from('support_tickets').select('id, subject, created_at, status').in('status', ['open', 'in_progress']).range(a, b), 'support_tickets')
    for (const t of tickets) items.push({ metric: 'tickets_open', day: ctx.today, value: 1, rec: { id: t.id, label: t.subject || 'Ticket', sub: `opened ${nyDay(t.created_at)}`, href: '/tickets' } })
    const tasks = await all((a, b) => db.from('kanban_tasks').select('id, title, due_date').lt('due_date', ctx.today).is('completed_at', null).range(a, b), 'kanban_tasks')
    for (const t of tasks) items.push({ metric: 'tasks_overdue', day: ctx.today, value: 1, rec: { id: t.id, label: t.title || 'Task', sub: `due ${t.due_date}`, href: '/tasks' } })
    const deals = await all((a, b) => db.from('hub_pipeline_deals').select('contact_id, pipeline_key, value').is('won_at', null).is('lost_at', null).gt('value', 0).range(a, b), 'hub_pipeline_deals')
    const dc = new Map((await inChunks(Array.from(new Set(deals.map(d => d.contact_id))), ch => db.from('contacts').select('id, org_id, first_name, last_name, email, phone, tags, merged_into_id').in('id', ch), 'contacts')).map(c => [c.id, c]))
    // A deal's stage is the contact's stage in that deal's pipeline (positions, keyed here by pipeline legacy key).
    const byOrg = new Map<string, string[]>()
    for (const c of Array.from(dc.values())) if (c.org_id) byOrg.set(c.org_id, [...(byOrg.get(c.org_id) ?? []), c.id])
    const pos = new Map<string, Position>()
    for (const [org, ids] of Array.from(byOrg)) {
      for (const p of await loadPositions(db, org, { contactIds: ids })) pos.set(`${p.contact_id}|${p.pipeline_key}`, p)
    }
    for (const d of deals) {
      const c = dc.get(d.contact_id)
      if (!c || c.merged_into_id || ctx.filter.isTestContact(c)) continue
      const p = pos.get(`${d.contact_id}|${d.pipeline_key}`)
      items.push({ metric: 'pipeline_value', day: ctx.today, value: Number(d.value), dims: { stage: String(p?.stage_name || 'No stage').slice(0, 80) },
        rec: { id: c.id, label: fullName(c.first_name, c.last_name) || c.email, sub: p ? `${p.pipeline_name} · ${p.stage_name}` : '', href: contactHref(c.id), amount: Number(d.value) } })
    }
    for (const m of ['inbox_waiting', 'tickets_open', 'tasks_overdue', 'pipeline_value']) {
      if (!items.some(i => i.metric === m)) items.push({ metric: m, day: ctx.today, value: 0 })
    }
  }
  return items
}

/** Which loader produces each metric (for the records endpoint, which runs only one). */
export const LOADERS: Record<string, Loader> = {
  contacts: contactsLoader, bookings: bookingsLoader, payments: paymentsLoader, other_revenue: otherRevenueLoader,
  onboarding: onboardingLoader, outcomes: outcomesLoader, marketing: marketingLoader, content: contentLoader, operations: operationsLoader,
}
export const LOADER_OF: Record<string, string[]> = {
  leads: ['contacts'], leads_all: ['contacts'], leads_by_source: ['contacts'], podcast_leads: ['contacts'], speed_to_lead: ['contacts'], self_booked_leads: ['contacts'], leads_booked_30d: ['contacts'], unsubscribed: ['contacts'],
  booked_calls: ['bookings'], shows: ['bookings'], no_shows: ['bookings'],
  sales: ['payments'], comps: ['payments'], clarity_sales: ['payments'], assessments_sold: ['payments'], revenue: ['payments', 'other_revenue'], revenue_platform: ['payments'],
  refunds: ['payments'], refund_amount: ['payments'], buyers: ['payments'], days_lead_to_purchase: ['payments'], promo_redemptions: ['payments'], promo_discount: ['payments'],
  repeat_buyers: ['payments'], paying_buyers: ['payments'], revenue_all_time: ['payments'], ad_spend: ['other_revenue'],
  onboarded: ['onboarding'], hrv_sessions: ['onboarding'], days_to_consent: ['onboarding'], days_to_pairing: ['onboarding'], days_to_first_session: ['onboarding'],
  onboarding_stuck: ['onboarding'], active_clients: ['onboarding'], hrv_trend_n: ['onboarding'], hrv_improving: ['onboarding'],
  practice_sessions: ['outcomes'], lessons_completed: ['outcomes'], reviews: ['outcomes'], review_rating_sum: ['outcomes'], upgrades: ['outcomes'], self_report_n: ['outcomes'], self_report_delta_sum: ['outcomes'],
  campaign_entered: ['marketing'], email_sent: ['marketing'], email_delivered: ['marketing'], email_opened: ['marketing'], email_clicked: ['marketing'], email_bounced: ['marketing'], email_complained: ['marketing'],
  podcasts: ['content'], posts_published: ['content'],
  cron_failures: ['operations'], inbox_waiting: ['operations'], tickets_open: ['operations'], tasks_overdue: ['operations'], pipeline_value: ['operations'],
}

export async function collect(ctx: Ctx, only?: string[]): Promise<Item[]> {
  const names = only ?? Object.keys(LOADERS)
  const out: Item[] = []
  for (const n of names) out.push(...(await LOADERS[n](ctx)))
  return out
}
