// node --experimental-strip-types scripts/briefs/brief-check.mjs
// Checks the morning brief's pure rules (src/lib/briefs/time.ts, compose.ts, match.ts, config.ts):
// the 8 AM ET hour across DST, no em dash ever, the empty day, Slack escaping, truncation, the size budget,
// attendee and title matching, and the gate.
import { etHour, etDate, isMorningSendHour, etDayBounds, addDays, etTime, etDayLabel } from '../../src/lib/briefs/time.ts'
import { composeMorning, composeMorningSlack, composeMorningSms, clean, slackEscape, SLACK_MAX_CHARS } from '../../src/lib/briefs/compose.ts'
import { externalAttendees, titleMentionsName, nameCandidates, isResourceAddress } from '../../src/lib/briefs/match.ts'
import { parseSchedAgentConfig } from '../../src/lib/briefs/config.ts'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `want ${JSON.stringify(want)} got ${JSON.stringify(got)}`)

// ── ET hour across DST ─────────────────────────────────────────────────────
// EST (UTC-5): 2026-01-15 13:00Z is 8:00 AM; 12:59Z is 7:59 AM
eq('EST 13:00Z is hour 8', etHour(new Date('2026-01-15T13:00:00Z')), 8)
check('EST 12:59Z is not send hour', !isMorningSendHour(new Date('2026-01-15T12:59:59Z')))
check('EST 13:00Z is send hour', isMorningSendHour(new Date('2026-01-15T13:00:00Z')))
check('EST 13:59Z still send hour', isMorningSendHour(new Date('2026-01-15T13:59:00Z')))
check('EST 14:00Z (9 AM) not send hour', !isMorningSendHour(new Date('2026-01-15T14:00:00Z')))
// EDT (UTC-4): 2026-07-15 12:00Z is 8:00 AM; 13:00Z is 9 AM
check('EDT 12:00Z is send hour', isMorningSendHour(new Date('2026-07-15T12:00:00Z')))
check('EDT 11:59Z is not send hour (never earlier)', !isMorningSendHour(new Date('2026-07-15T11:59:00Z')))
check('EDT 13:00Z is not send hour', !isMorningSendHour(new Date('2026-07-15T13:00:00Z')))
// DST change days: spring forward 2026-03-08, fall back 2026-11-01
check('spring-forward day 8 AM EDT = 12:00Z', isMorningSendHour(new Date('2026-03-08T12:00:00Z')))
check('spring-forward day 12:00Z-1h is 7 AM', !isMorningSendHour(new Date('2026-03-08T11:00:00Z')))
check('fall-back day 8 AM EST = 13:00Z', isMorningSendHour(new Date('2026-11-01T13:00:00Z')))
check('fall-back day 12:00Z is 7 AM EST', !isMorningSendHour(new Date('2026-11-01T12:00:00Z')))
eq('ET date before midnight ET', etDate(new Date('2026-11-09T04:30:00Z')), '2026-11-08')
eq('ET date after midnight ET', etDate(new Date('2026-11-09T05:30:00Z')), '2026-11-09')
eq('addDays across month', addDays('2026-11-30', 1), '2026-12-01')
eq('addDays across DST', addDays('2026-03-07', 1), '2026-03-08')
{
  const b = etDayBounds('2026-03-08')
  eq('spring-forward day is 23h', (b.end - b.start) / 3600_000, 23)
  eq('spring-forward day starts 05:00Z', b.start.toISOString(), '2026-03-08T05:00:00.000Z')
  const f = etDayBounds('2026-11-01')
  eq('fall-back day is 25h', (f.end - f.start) / 3600_000, 25)
  const n = etDayBounds('2026-07-15')
  eq('summer day starts 04:00Z', n.start.toISOString(), '2026-07-15T04:00:00.000Z')
}
eq('ET time format, plain space', etTime('2026-11-09T14:30:00Z'), '9:30 AM')
eq('day label', etDayLabel('2026-11-09'), 'Mon, Nov 9')

// ── compose ────────────────────────────────────────────────────────────────
const empty = { dayLabel: 'Mon, Nov 9', day: 'today', meetings: [], awaiting: { count: 0, items: [] }, leads: { count: 0, names: [] }, urgent: { count: 0, subjects: [] } }
const emptyText = composeMorning(empty)
check('empty day says Nothing scheduled today.', emptyText.includes('Nothing scheduled today.'), emptyText)
check('empty day has no section headings', !/meetings|awaiting|leads|Urgent/.test(emptyText), emptyText)
check('empty tomorrow preview', composeMorning({ ...empty, day: 'tomorrow' }).includes('Nothing scheduled tomorrow.'))

const dash = '—', endash = '–'
const full = {
  dayLabel: 'Mon, Nov 9', day: 'today',
  meetings: [
    { time: '9:00 AM', title: `Discovery call ${dash} Jane Doe & <Team>`, prep: [{
      name: `Jane ${dash} Doe`, stages: ['Sales: Discovery Call Booked'],
      answers: [{ label: 'How did you hear about us?', answer: `Podcast ${endash} episode 12` }, { label: 'Goal', answer: 'Sleep' }, { label: 'Q3', answer: 'x' }, { label: 'Q4', answer: 'not shown' }],
      lastEmail: { subject: `Re: times ${dash} next week`, date: 'Nov 3' },
    }] },
    { time: '2:00 PM', title: 'x'.repeat(200), prep: [] },
  ],
  awaiting: { count: 7, items: [{ from: 'Jane Doe', subject: `Can we meet ${dash} Tuesday?` }, { from: null, subject: null }, { from: 'A', subject: 'b' }, { from: 'C', subject: 'd' }, { from: 'E', subject: 'f' }, { from: 'G', subject: 'h' }] },
  leads: { count: 6, names: ['One A', 'Two B', 'Three C', 'Four D', 'Five E', 'Six F'] },
  urgent: { count: 1, subjects: [`Server ${dash} down`] },
}
const plain = composeMorning(full)
const slack = composeMorningSlack(full)
const sms = composeMorningSms(full)
for (const [n, t] of [['plain', plain], ['slack', slack], ['sms', sms], ['empty', emptyText]]) {
  check(`no em dash in ${n}`, !t.includes(dash), t)
  check(`no en dash in ${n}`, !t.includes(endash), t)
}
check('awaiting uses colon separator', plain.includes('- Jane Doe: Can we meet - Tuesday?'), plain)
check('awaiting capped at 5 lines', (plain.split('Scheduling emails awaiting reply (7)')[1].split('\n\n')[0].match(/^- /gm) ?? []).length === 5)
check('meeting title truncated to 60', plain.split('\n').some((l) => l.startsWith('- 2:00 PM ') && l.length === '- 2:00 PM '.length + 60 && l.endsWith('...')))
check('intake max 3 answers', plain.includes('Intake: How did you hear about us: Podcast - episode 12; Goal: Sleep; Q3: x') && !plain.includes('not shown'), plain)
check('stage on prep line', plain.includes('Jane - Doe | Sales: Discovery Call Booked'))
check('last email line', plain.includes('Last email: Re: times - next week (Nov 3)'))
check('leads capped at 5 names with ellipsis', plain.includes('- One A, Two B, Three C, Four D, Five E, ...') && !plain.includes('Six F'))
check('slack escapes &, <, >', slack.includes('&amp; &lt;Team&gt;') && !/[<>]/.test(slack), slack)
eq('slackEscape order', slackEscape('a & <b> &amp;'), 'a &amp; &lt;b&gt; &amp;amp;')
check('plain text is not escaped', plain.includes('& <Team>'))
check('sms has counts, no names or subjects', sms.includes('2 meetings today (9:00 AM, 2:00 PM)') && sms.includes('7 awaiting reply') && sms.includes('6 new leads') && sms.includes('1 urgent') && !sms.includes('Jane'), sms)
eq('clean truncates with ...', clean('abcdefghij', 8), 'abcde...')
eq('clean keeps short', clean('  a\n b  ', 10), 'a b')
eq('clean non-string', clean(42, 10), null)

// size budget: many meetings with prep must fit, prep dropped first
const many = { ...full, meetings: Array.from({ length: 20 }, (_, i) => ({ ...full.meetings[0], time: `${i}:00 AM` })) }
const big = composeMorningSlack(many)
check(`slack fits ${SLACK_MAX_CHARS}`, big.length <= SLACK_MAX_CHARS, String(big.length))
check('slack keeps every section when trimming prep', big.includes('Urgent (1)') || big.endsWith('...'))
check('slack under budget unchanged', composeMorningSlack(full) === slackEscape(plain))

// ── matching ───────────────────────────────────────────────────────────────
eq('attendees: own, resources, dupes removed', externalAttendees(['Me@NeuroProgeny.com', 'room-1@resource.calendar.google.com', 'Jane@x.com', 'jane@x.com', ''], ['me@neuroprogeny.com']), ['jane@x.com'])
check('resource address', isResourceAddress('c_123abc@resource.calendar.google.com'))
check('title names full name', titleMentionsName('Call with Jane Doe (intro)', 'Jane Doe'))
check('title name case-insensitive', titleMentionsName('jane doe / cameron', 'Jane Doe'))
check('word boundary: Janet Doerr is not Jane Doe', !titleMentionsName('Call with Janet Doerr', 'Jane Doe'))
check('word boundary: suffix', !titleMentionsName('Jane Does stuff', 'Jane Doe'))
check('single-part name never matches', !titleMentionsName('Call with Al', 'Al'))
check('regex chars in name are literal', !titleMentionsName('a.b c', 'a+ c'))
eq('name candidates skip stop words', nameCandidates('Discovery Call with Jane Doe'), [['Jane', 'Doe']])

// ── gate ───────────────────────────────────────────────────────────────────
const rid = '11111111-2222-3333-4444-555555555555'
eq('gate on', parseSchedAgentConfig({ enabled: 'on', recipient_user_id: rid, since: '2026-11-09T00:00:00Z' }), { enabled: true, since: '2026-11-09T00:00:00.000Z', recipientUserId: rid })
eq('gate true boolean is off', parseSchedAgentConfig({ enabled: true, recipient_user_id: rid }).enabled, false)
eq('gate missing is off', parseSchedAgentConfig(null), { enabled: false, since: null, recipientUserId: null })
eq('gate on without recipient is off', parseSchedAgentConfig({ enabled: 'on' }).enabled, false)

const pass = results.filter((r) => r.ok).length
for (const r of results) if (!r.ok) console.log(`FAIL ${r.name}${r.detail ? `: ${r.detail}` : ''}`)
console.log(`BRIEF_CHECK ${pass === results.length ? 'PASS' : 'FAIL'} ${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
