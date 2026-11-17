// src/lib/notify/rules.ts
// Notification rules and the 8 AM brief (Running List q22). Pure: no imports, so the harness
// (scripts/notify/notify-tamper.cjs) runs it directly.
//
//   rules   org_settings 'hub_notifications' = { mode, rules: { <type>: { recipient, urgency } } }
//           urgency: 'urgent' (text now), 'brief' (the 8 AM brief), 'off'. A missing or malformed rule is the default.
//   mode    'off' (default) | 'preview' (the brief is built and shown on the Brief page, nothing is sent) | 'live'.
//           Only the exact string 'live' sends. The speed-to-lead alerts, the Monday scorecard text and the
//           watchdog keep their own switches and are unchanged.
//   brief   one text per person on weekdays, 08:05 to 08:59 America/New_York, once per day, to the phone on their
//           Hub profile. Never before 8 AM ET, never on a weekend.

export type Mode = 'off' | 'preview' | 'live'
export type Urgency = 'urgent' | 'brief' | 'off'

export const NOTIFICATION_TYPES = [
  { key: 'new_lead', label: 'New lead', note: 'Texted now by the speed-to-lead alert (unchanged); listed in the brief too' },
  { key: 'discovery_no_show', label: 'Discovery call missed', note: 'From the lifecycle engine' },
  { key: 'follow_up_task', label: 'Follow-up tasks due or overdue', note: 'Lead and client follow-up tasks' },
  { key: 'stuck_onboarding', label: 'Onboarding stuck past target', note: 'Enrolled clients not moving' },
  { key: 'welcome_email_problem', label: 'Welcome email problems', note: 'No source yet: shows once the welcome email reports failures' },
  { key: 'todays_calls', label: "Today's discovery calls and coaching", note: 'University bookings for today' },
  { key: 'flagged_task', label: 'Tasks flagged urgent for you', note: 'Board tasks with urgent priority' },
  { key: 'private_mail', label: 'New mail in your mailbox', note: 'A count of mail received since the last brief, never a subject' },
  { key: 'hot_lead', label: 'Hot lead from a lead device', note: 'Texted now today (unchanged)' },
  { key: 'podcast_conversion', label: 'Podcast-attributed enrollment', note: 'Creates a board task' },
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]['key']

export interface Rule { recipient: string | null; urgency: Urgency }
export interface Settings { mode: Mode; rules: Record<NotificationType, Rule> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Defaults: new lead and a missed discovery call are urgent; everything else goes to the brief. */
export function defaultRules(defaultRecipient: string | null): Record<NotificationType, Rule> {
  const out = {} as Record<NotificationType, Rule>
  for (const t of NOTIFICATION_TYPES) out[t.key] = { recipient: defaultRecipient, urgency: 'brief' }
  out.new_lead.urgency = 'urgent'
  out.discovery_no_show.urgency = 'urgent'
  out.hot_lead.urgency = 'urgent'
  return out
}

export function parseSettings(raw: unknown, defaultRecipient: string | null): Settings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const mode: Mode = r.mode === 'live' ? 'live' : r.mode === 'preview' ? 'preview' : 'off'
  const rules = defaultRules(defaultRecipient)
  const given = r.rules && typeof r.rules === 'object' ? (r.rules as Record<string, any>) : {}
  for (const t of NOTIFICATION_TYPES) {
    const g = given[t.key]
    if (!g || typeof g !== 'object') continue
    if (g.urgency === 'urgent' || g.urgency === 'brief' || g.urgency === 'off') rules[t.key].urgency = g.urgency
    if (typeof g.recipient === 'string' && UUID.test(g.recipient)) rules[t.key].recipient = g.recipient
  }
  return { mode, rules }
}

/** Where one item goes: texted now, held for the brief, or dropped. Sends happen only in live. */
export type Route = 'text_now' | 'brief' | 'drop'
export function routeItem(rule: Rule): Route {
  if (rule.urgency === 'off' || !rule.recipient) return 'drop'
  if (rule.urgency === 'urgent') return 'text_now'
  return 'brief'
}

/** Only live sends anything. Off and preview never text. */
export const maySend = (mode: Mode) => mode === 'live'

// ── the 8 AM window ────────────────────────────────────────────────────────────────────────────────────────────

/** New York wall-clock parts for an instant. */
export function nyParts(at: Date): { date: string; weekday: number; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, hour: Number(p.hour), minute: Number(p.minute) }
}

export const BRIEF_HOUR = 8
export const BRIEF_MINUTE = 5

/** The brief may go out now: a weekday, from 08:05 to 08:59 New York time. */
export function briefDue(at: Date): boolean {
  const n = nyParts(at)
  if (n.weekday === 0 || n.weekday === 6) return false
  return n.hour === BRIEF_HOUR && n.minute >= BRIEF_MINUTE
}

// ── composing the brief ────────────────────────────────────────────────────────────────────────────────────────

export interface BriefInput {
  hubUrl: string
  newLeads: number
  tasksDueToday: number
  tasksOverdue: number
  stuckOnboarding: number
  discoveryCallsToday: number
  coachingToday: number
  flagged: number
  /** private mail is reported as a count only; subjects passed here are never used */
  privateMail: Array<{ subject?: string | null }>
  welcomeEmailProblems: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const noDash = (s: string) => s.replace(/[\u2013\u2014]/g, ',')

/** The brief's lines, in order; a zero line is left out. Plain text, counts only, links to the Hub pages. */
export function composeBrief(i: BriefInput): { lines: string[]; text: string; empty: boolean } {
  const u = i.hubUrl.replace(/\/$/, '')
  const lines: string[] = []
  if (i.newLeads) lines.push(`${plural(i.newLeads, 'new lead', 'new leads')} since the last brief: ${u}/crm/contacts`)
  if (i.tasksDueToday || i.tasksOverdue) lines.push(`Follow-ups: ${i.tasksDueToday} due today, ${i.tasksOverdue} overdue: ${u}/tasks`)
  if (i.stuckOnboarding) lines.push(`${plural(i.stuckOnboarding, 'client', 'clients')} stuck in onboarding: ${u}/crm/pipelines`)
  if (i.discoveryCallsToday || i.coachingToday) lines.push(`Today: ${plural(i.discoveryCallsToday, 'discovery call', 'discovery calls')}, ${plural(i.coachingToday, 'coaching session', 'coaching sessions')}: ${u}/calendar`)
  if (i.flagged) lines.push(`${plural(i.flagged, 'task', 'tasks')} flagged urgent for you: ${u}/tasks`)
  if (i.privateMail.length) lines.push(`${plural(i.privateMail.length, 'email', 'emails')} since the last brief in your mailbox: ${u}/mail`)
  if (i.welcomeEmailProblems) lines.push(`${plural(i.welcomeEmailProblems, 'welcome email problem', 'welcome email problems')}: ${u}/brief`)
  const empty = lines.length === 0
  const body = empty ? 'Nothing needs you this morning.' : lines.join('\n')
  return { lines, empty, text: noDash(`Good morning. Your Hub brief:\n${body}\nFull brief: ${u}/brief`) }
}

// ── automatic tasks ────────────────────────────────────────────────────────────────────────────────────────────

export const BOARD_COLUMNS = ['Capture', 'Action Steps', 'Delegated', 'Waiting for', 'Someday Maybe', 'Done', 'Trash'] as const

/**
 * Every automatic task has an owner: the rule's recipient, else the org's default owner. Returns null only when
 * neither exists, and callers then create no task (never an ownerless one).
 */
export function taskOwner(rule: Rule | null | undefined, defaultOwner: string | null): string | null {
  return rule?.recipient ?? defaultOwner ?? null
}
