// src/lib/briefs/compose.ts
// Pure: the morning brief's words. No I/O and no imports, so scripts/briefs/brief-check.mjs runs it directly.
//
// Plain text, short and scannable. No em dash or en dash anywhere, including inside subjects and titles that
// carried one (they become a hyphen). Slack's three control characters are escaped the way
// src/lib/lead-alerts/compose.ts composeSlack does. Times arrive already formatted in ET (./time.ts).

export const SLACK_MAX_CHARS = 1500
export const LIST_MAX = 5
export const PREP_PER_MEETING = 2

export interface PrepNote {
  name: string
  /** "Pipeline: Stage" */
  stages: string[]
  answers: Array<{ label: string; answer: string }>
  lastEmail: { subject: string | null; date: string } | null
}

export interface BriefMeeting {
  /** "9:30 AM", or "All day" */
  time: string
  title: string | null
  prep: PrepNote[]
}

export interface BriefData {
  /** "Mon, Nov 9" */
  dayLabel: string
  /** 'today' for the 8 AM brief; 'tomorrow' for the owner's preview */
  day: 'today' | 'tomorrow'
  meetings: BriefMeeting[]
  awaiting: { count: number; items: Array<{ from: string | null; subject: string | null }> }
  leads: { count: number; names: string[] }
  urgent: { count: number; subjects: Array<string | null> }
}

/** One line of untrusted text: controls and runs of space collapsed, dashes made plain, length capped with "...". */
export function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[‒–—―−]/g, '-').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, Math.max(1, max - 3)).trimEnd()}...` : s
}

export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function prepLines(p: PrepNote): string[] {
  const name = clean(p.name, 60) ?? 'Contact'
  const stages = p.stages.map((s) => clean(s, 60)).filter(Boolean).slice(0, 3)
  const lines = [`   ${name}${stages.length ? ` | ${stages.join(', ')}` : ''}`]
  const answers = p.answers
    .map((a) => ({ q: clean(a.label, 50), a: clean(a.answer, 80) }))
    .filter((a) => a.q && a.a)
    .slice(0, 3)
    .map((a) => `${a.q!.replace(/[?:]+$/, '')}: ${a.a}`)
  if (answers.length) lines.push(`   Intake: ${answers.join('; ')}`)
  if (p.lastEmail) {
    const subj = clean(p.lastEmail.subject, 70) ?? '(no subject)'
    lines.push(`   Last email: ${subj}${p.lastEmail.date ? ` (${p.lastEmail.date})` : ''}`)
  }
  return lines
}

function isEmpty(d: BriefData): boolean {
  return !d.meetings.length && !d.awaiting.count && !d.leads.count && !d.urgent.count
}

/** The plain-text brief. `prepLimit` caps how many meetings carry prep notes (used to fit Slack's budget). */
export function composeMorning(d: BriefData, prepLimit = Infinity): string {
  const out: string[] = [`Morning brief for ${clean(d.dayLabel, 40) ?? ''}${d.day === 'tomorrow' ? ' (preview of tomorrow)' : ''}`]
  if (isEmpty(d)) {
    out.push('', d.day === 'tomorrow' ? 'Nothing scheduled tomorrow.' : 'Nothing scheduled today.')
    return out.join('\n')
  }
  if (d.meetings.length) {
    out.push('', `${d.day === 'tomorrow' ? "Tomorrow's" : "Today's"} meetings (${d.meetings.length})`)
    d.meetings.forEach((m, i) => {
      out.push(`- ${clean(m.time, 12) ?? ''} ${clean(m.title, 60) ?? '(no title)'}`)
      if (i < prepLimit) for (const p of m.prep.slice(0, PREP_PER_MEETING)) out.push(...prepLines(p))
    })
  }
  if (d.awaiting.count) {
    out.push('', `Scheduling emails awaiting reply (${d.awaiting.count})`)
    for (const it of d.awaiting.items.slice(0, LIST_MAX)) {
      out.push(`- ${clean(it.from, 50) ?? 'Unknown sender'}: ${clean(it.subject, 70) ?? '(no subject)'}`)
    }
  }
  if (d.leads.count) {
    const names = d.leads.names.map((n) => clean(n, 40)).filter(Boolean).slice(0, LIST_MAX)
    out.push('', `New leads since yesterday (${d.leads.count})`)
    if (names.length) out.push(`- ${names.join(', ')}${d.leads.count > names.length ? ', ...' : ''}`)
  }
  if (d.urgent.count) {
    out.push('', `Urgent (${d.urgent.count})`)
    for (const s of d.urgent.subjects.slice(0, LIST_MAX)) out.push(`- ${clean(s, 70) ?? '(no subject)'}`)
  }
  return out.join('\n')
}

/** The Slack text: the brief escaped, trimmed to fit: prep notes drop from the last meeting up, then lines are cut. */
export function composeMorningSlack(d: BriefData, max = SLACK_MAX_CHARS): string {
  for (let limit = d.meetings.length; limit >= 0; limit--) {
    const s = slackEscape(composeMorning(d, limit))
    if (s.length <= max) return s
  }
  const lines = slackEscape(composeMorning(d, 0)).split('\n')
  const kept: string[] = []
  let n = 0
  for (const l of lines) {
    if (n + l.length + 1 > max - 4) break
    kept.push(l)
    n += l.length + 1
  }
  return `${kept.join('\n')}\n...`
}

/** The SMS backup (sent only when Slack failed): counts and meeting times, no names, no subjects. */
export function composeMorningSms(d: BriefData): string {
  const times = d.meetings.map((m) => clean(m.time, 12)).filter(Boolean)
  const shown = times.slice(0, 8).join(', ')
  const word = d.day === 'tomorrow' ? 'tomorrow' : 'today'
  const parts = [
    d.meetings.length
      ? `${d.meetings.length} meeting${d.meetings.length === 1 ? '' : 's'} ${word} (${shown}${times.length > 8 ? ', ...' : ''})`
      : `No meetings ${word}`,
    `${d.awaiting.count} awaiting reply`,
    `${d.leads.count} new lead${d.leads.count === 1 ? '' : 's'}`,
    `${d.urgent.count} urgent`,
  ]
  return `Morning brief ${clean(d.dayLabel, 40) ?? ''}: ${parts.join('. ')}. Slack was unavailable.`
}
