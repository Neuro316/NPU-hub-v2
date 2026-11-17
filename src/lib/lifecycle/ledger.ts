// src/lib/lifecycle/ledger.ts
// Every lifecycle event is one row in hub_lifecycle_events (hub_237), unique on (org_id, event_key): that unique key
// is what makes each event happen once, however often a scan sees it.
//
//   dry_run  the row records the event and the actions it WOULD take (planned). Nothing else is written: no
//            timeline row, no stage move, no tag, no campaign entry or exit, no task.
//   live     the row is written pending (applied_at null) and then applied. Every action is idempotent on its own
//            (timeline keyed on the row id, placement forward-only, entry events keyed on the event key, one open
//            task per contact and reason by unique index), so a run cut short is finished by the next one.
//
// Rows carry ids, codes and product classes only: never a name, an address, an answer or an amount. A University
// table is never written.
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPipelines, placeContact, setStage, loadPositions, findPipeline } from '@/lib/pipelines/positions'
import { endAsExited } from '@/lib/marketing/exits'
import { notifyUrgent } from '@/lib/notify/urgent'
import {
  EVENT_TITLE, TASK_TITLE, actionsFor, brandTagToAdd, campaignSourceKey, enrolledTarget, tasksClosedBy,
  type Brand, type CampaignKey, type EventType, type LifecycleConfig, type TaskReason,
} from './rules'

export interface LifecycleEvent {
  orgId: string
  contactId: string
  type: EventType
  key: string
  occurredAt: string
  source: string
  sourceId: string | null
  detail?: { brand?: Brand; product?: string; [k: string]: unknown }
}

/** Pure: what a row will do, as stored in `planned`. */
export function planOf(e: Pick<LifecycleEvent, 'type' | 'detail'>, cfg: Pick<LifecycleConfig, 'assignee'>) {
  const a = actionsFor(e.type, e.detail?.product ?? null)
  return {
    timeline: EVENT_TITLE[e.type],
    tag: a.tag && e.detail?.brand ? e.detail.brand : null,
    enrolled: a.enrolled ?? null,
    enroll: a.enroll ?? null,
    exit: a.exit ?? [],
    open_task: a.openTask ? (cfg.assignee ? a.openTask : `${a.openTask} (no assignee set)`) : null,
    close_tasks: tasksClosedBy(e.type),
  }
}

/** Records the event once. Returns 'new' when this call wrote the row, 'seen' when it already existed. */
export async function recordEvent(db: SupabaseClient, cfg: LifecycleConfig, e: LifecycleEvent): Promise<'new' | 'seen'> {
  if (cfg.mode === 'off') return 'seen'
  const { data, error } = await db.from('hub_lifecycle_events').upsert({
    org_id: e.orgId, contact_id: e.contactId, event_key: e.key.slice(0, 200), event_type: e.type, occurred_at: e.occurredAt,
    source: e.source, source_id: e.sourceId, detail: e.detail ?? {}, mode: cfg.mode, planned: planOf(e, cfg),
  }, { onConflict: 'org_id,event_key', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`ledger write: ${error.code ?? 'unknown'}`)
  return data?.length ? 'new' : 'seen'
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

/**
 * Queues a campaign entry through the existing raise_entry_event, origin 'lifecycle' (hub_237). It queues nothing
 * unless the engine flag is on AND an ACTIVE route listens on the key; every lifecycle route ships inactive.
 * (Called directly rather than through marketing/entry-events.ts, which the parity harnesses pin byte for byte.)
 */
async function raiseLifecycleEntry(db: SupabaseClient, orgId: string, contactId: string, sourceKey: string, eventId: string): Promise<boolean> {
  const { data, error } = await db.rpc('raise_entry_event', { p_org: orgId, p_contact: contactId, p_source_key: sourceKey, p_event_id: eventId, p_origin: 'lifecycle' })
  if (error) throw new Error(`entry event: ${error.code ?? 'unknown'}`)
  return data === true
}

async function writeTimeline(db: SupabaseClient, row: any): Promise<string> {
  const { data: seen, error } = await db.from('contact_timeline').select('id')
    .eq('source_table', 'hub_lifecycle_events').eq('source_id', row.id).limit(1)
  if (error) throw new Error(`timeline read: ${error.code ?? 'unknown'}`)
  if (seen?.length) return 'kept'
  const { error: iErr } = await db.from('contact_timeline').insert({
    org_id: row.org_id, contact_id: row.contact_id, event_type: `lifecycle_${row.event_type}`,
    title: EVENT_TITLE[row.event_type as EventType] ?? row.event_type, description: null,
    metadata: { event_key: row.event_key, source: row.source, source_id: row.source_id, ...(row.detail?.product ? { product: row.detail.product } : {}) },
    source_table: 'hub_lifecycle_events', source_id: row.id, actor_type: 'system', occurred_at: row.occurred_at,
  })
  if (iErr) throw new Error(`timeline write: ${iErr.code ?? 'unknown'}`)
  return 'written'
}

async function addBrandTag(db: SupabaseClient, contactId: string, brand: Brand): Promise<string> {
  const { data: c, error } = await db.from('contacts').select('tags').eq('id', contactId).maybeSingle()
  if (error) throw new Error(`tags read: ${error.code ?? 'unknown'}`)
  const add = brandTagToAdd((c as any)?.tags, brand)
  if (!add) return 'kept'
  const tags = [...(((c as any)?.tags ?? []) as string[]), add]
  const { error: uErr } = await db.from('contacts').update({ tags, updated_at: new Date().toISOString() }).eq('id', contactId)
  if (uErr) throw new Error(`tags write: ${uErr.code ?? 'unknown'}`)
  return add
}

async function moveEnrolled(db: SupabaseClient, cfg: LifecycleConfig, row: any, want: NonNullable<ReturnType<typeof actionsFor>['enrolled']>): Promise<string> {
  const pipelines = await loadPipelines(db, row.org_id)
  const p = findPipeline(pipelines, cfg.enrolledPipeline)
  if (!p) return 'pipeline_unknown'
  const [here] = await loadPositions(db, row.org_id, { contactIds: [row.contact_id], pipelineId: p.id, pipelines })
  const target = enrolledTarget(here?.stage_name ?? null, want)
  if (!target) return 'kept'
  const stage = p.stages.find((s) => s.name === target)
  if (!stage) return 'stage_unknown'
  const source = `lifecycle:${row.event_type}`
  if (want === 'back_to_active') { await setStage(db, row.contact_id, stage.id, null, source); return target }
  const r = await placeContact(db, row.contact_id, stage.id, true, source)
  return r.placed ? target : (r.reason ?? 'kept')
}

async function exitCampaigns(db: SupabaseClient, row: any, keys: CampaignKey[]): Promise<number> {
  if (!keys.length) return 0
  const { data: routes, error } = await db.from('campaign_routes').select('campaign_id')
    .eq('org_id', row.org_id).in('source_key', keys.map(campaignSourceKey))
  if (error) throw new Error(`exit routes read: ${error.code ?? 'unknown'}`)
  const ids = Array.from(new Set((routes ?? []).map((r: any) => r.campaign_id as string)))
  if (!ids.length) return 0
  const { data: ens, error: eErr } = await db.from('campaign_enrollments').select('id')
    .eq('contact_id', row.contact_id).in('campaign_id', ids).eq('status', 'active')
  if (eErr) throw new Error(`exit enrollments read: ${eErr.code ?? 'unknown'}`)
  for (const en of ens ?? []) await endAsExited(db, (en as any).id, `lifecycle_${row.event_type}`, new Date())
  return ens?.length ?? 0
}

/** Closes this contact's open follow-up tasks of these reasons, on the CRM task and its board card. */
export async function closeTasks(db: SupabaseClient, orgId: string, contactId: string, reasons: TaskReason[]): Promise<number> {
  if (!reasons.length) return 0
  const { data: open, error } = await db.from('tasks').select('id, hub_task_id').eq('org_id', orgId).eq('contact_id', contactId)
    .in('source', reasons.map((r) => `hub_followup:${r}`)).in('status', ['todo', 'in_progress'])
  if (error) throw new Error(`tasks read: ${error.code ?? 'unknown'}`)
  if (!open?.length) return 0
  const at = new Date().toISOString()
  const { error: uErr } = await db.from('tasks').update({ status: 'done', completed_at: at, updated_at: at }).in('id', open.map((t: any) => t.id))
  if (uErr) throw new Error(`tasks close: ${uErr.code ?? 'unknown'}`)
  const cards = open.map((t: any) => t.hub_task_id).filter(Boolean)
  if (cards.length) {
    const { data: done } = await db.from('kanban_columns').select('id').eq('org_id', orgId).eq('title', 'Done').limit(1)
    const patch: Record<string, unknown> = { completed_at: at, updated_at: at }
    if (done?.[0]) patch.column_id = (done[0] as any).id
    const { error: kErr } = await db.from('kanban_tasks').update(patch).in('id', cards)
    if (kErr) console.error(`[lifecycle] board close failed: ${kErr.code ?? 'unknown'}`)
  }
  return open.length
}

/** Opens one follow-up task (CRM task linked to the contact, and a card in Action Steps). A second open one is refused by the unique index. */
async function openTask(db: SupabaseClient, cfg: LifecycleConfig, row: any, reason: TaskReason): Promise<string> {
  if (!cfg.assignee) return 'no_assignee'
  const { data: t, error } = await db.from('tasks').insert({
    org_id: row.org_id, contact_id: row.contact_id, assigned_to: cfg.assignee, title: TASK_TITLE[reason],
    description: `Opened by the Hub when this happened: ${EVENT_TITLE[row.event_type as EventType] ?? row.event_type}. It closes itself when the contact is reached, books, buys or becomes active again, whichever applies.`,
    priority: 'high', status: 'todo', source: `hub_followup:${reason}`, source_id: row.id, due_date: minutes(24 * 60),
  }).select('id').single()
  if (error?.code === '23505') return 'already_open'
  if (error || !t) throw new Error(`task write: ${error?.code ?? 'unknown'}`)
  const [{ data: col }, { data: who }] = await Promise.all([
    db.from('kanban_columns').select('id').eq('org_id', row.org_id).eq('title', 'Action Steps').limit(1),
    db.from('team_profiles').select('display_name').eq('org_id', row.org_id).eq('user_id', cfg.assignee).maybeSingle(),
  ])
  if (!col?.[0]) return 'opened_no_board_column'
  const { data: card, error: kErr } = await db.from('kanban_tasks').insert({
    org_id: row.org_id, column_id: (col[0] as any).id, title: TASK_TITLE[reason], priority: 'high', due_date: minutes(24 * 60),
    assignee: (who as any)?.display_name ?? null, owner_id: cfg.assignee, source: 'hub_followup', visibility: 'everyone', sort_order: 0,
    custom_fields: { crm_task_id: (t as any).id, contact_id: row.contact_id, reason }, ai_generated: false,
  }).select('id').single()
  if (kErr || !card) { console.error(`[lifecycle] board card failed: ${kErr?.code ?? 'unknown'}`); return 'opened_no_card' }
  await db.from('tasks').update({ hub_task_id: (card as any).id, last_synced_at: new Date().toISOString() }).eq('id', (t as any).id)
  return 'opened'
}

/** Applies pending live rows, oldest first. Never runs in dry_run (those rows are never pending). */
export async function applyPending(db: SupabaseClient, cfg: LifecycleConfig, orgId: string, deadline: number, limit = 100): Promise<{ applied: number; failed: number }> {
  const out = { applied: 0, failed: 0 }
  if (cfg.mode !== 'live') return out
  const { data: rows, error } = await db.from('hub_lifecycle_events').select('*')
    .eq('org_id', orgId).eq('mode', 'live').is('applied_at', null).not('contact_id', 'is', null)
    .order('occurred_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`ledger read: ${error.code ?? 'unknown'}`)
  for (const row of rows ?? []) {
    if (Date.now() > deadline) break
    const a = actionsFor(row.event_type, row.detail?.product ?? null)
    const done: Record<string, unknown> = {}
    try {
      done.timeline = await writeTimeline(db, row)
      if (a.tag && row.detail?.brand) done.tag = await addBrandTag(db, row.contact_id, row.detail.brand)
      if (a.enrolled) done.enrolled = await moveEnrolled(db, cfg, row, a.enrolled)
      if (a.enroll) done.enroll = await raiseLifecycleEntry(db, orgId, row.contact_id, campaignSourceKey(a.enroll), row.event_key)
      if (a.exit?.length) done.exited = await exitCampaigns(db, row, a.exit)
      done.closed = await closeTasks(db, orgId, row.contact_id, tasksClosedBy(row.event_type))
      if (a.openTask) done.task = await openTask(db, cfg, row, a.openTask)
      // a missed discovery call is urgent by default (q22 notification rules): a text now, only when notifications are live
      if (row.event_type === 'booking_no_show') done.urgent = await notifyUrgent(db, orgId, 'discovery_no_show', row.contact_id)
      const { error: uErr } = await db.from('hub_lifecycle_events').update({ applied_at: new Date().toISOString(), applied: done, error: null }).eq('id', row.id)
      if (uErr) throw new Error(`ledger update: ${uErr.code ?? 'unknown'}`)
      out.applied++
    } catch (e: any) {
      out.failed++
      const msg = String(e?.message ?? 'error').slice(0, 120)
      console.error(`[lifecycle] row ${row.id} failed: ${msg}`)
      await db.from('hub_lifecycle_events').update({ applied: done, error: msg }).eq('id', row.id)
    }
  }
  return out
}
