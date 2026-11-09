// node --experimental-strip-types scripts/scheduling/availability-check.mjs
// Checks the pure slot generator (src/lib/scheduling/availability.ts): busy removes, block removes, extra adds,
// outside a window is rejected, weekends skipped, today never offered, the DST boundary, the spread across days.
import {
  businessDays, candidateSlots, findSlots, pickSpread, slotLabel, wallOf, DURATIONS,
} from '../../src/lib/scheduling/availability.ts'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `want ${JSON.stringify(want)} got ${JSON.stringify(got)}`)

const TZ = 'America/New_York'
const WEEK = { weekdays: [1, 2, 3, 4, 5], start_time: '09:00:00', end_time: '17:00:00', timezone: TZ }
const NOW = '2026-11-06T15:00:00Z' // Fri Nov 6, 10:00 AM ET
const base = (over = {}) => ({ now: NOW, tz: TZ, category: 'one_on_one', windows: [WEEK], overrides: [], snapshots: [], hubBusy: [], ...over })
const starts = (slots) => slots.map((s) => s.start)
const local = (iso) => wallOf(Date.parse(iso), TZ)
const has = (slots, iso) => slots.some((s) => s.start === iso)

// ── days ───────────────────────────────────────────────────────────────────
{
  const days = businessDays(NOW, TZ)
  eq('10 business days', days.length, 10)
  eq('starts the next business day (Mon), never today', days[0], '2026-11-09')
  check('today is never in the horizon', !days.includes('2026-11-06'))
  check('no Saturday or Sunday', !days.some((d) => ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15'].includes(d)))
  eq('last day', days[9], '2026-11-20')
  const late = businessDays('2026-11-07T03:30:00Z', TZ) // still Fri Nov 6 in ET (10:30 PM)
  eq('late Friday ET still counts as Friday', late[0], '2026-11-09')
}

// ── windows ────────────────────────────────────────────────────────────────
{
  const { free } = candidateSlots(base())
  check('has candidates', free.length > 0)
  check('no slot today', !free.some((s) => s.date === '2026-11-06'))
  check('no weekend slot', !free.some((s) => [6, 7].includes(new Date(s.date + 'T12:00:00Z').getUTCDay() || 7)))
  check('every slot inside 9 to 5 ET (outside window rejected)', free.every((s) => {
    const a = local(s.start), b = local(s.end)
    return a.h >= 9 && (b.h < 17 || (b.h === 17 && b.mi === 0))
  }))
  check('16:30 one_on_one rejected (would end 17:00 ok) but 17:00 start rejected',
    has(free, '2026-11-09T21:30:00.000Z') && !has(free, '2026-11-09T22:00:00.000Z'))
  check('8:30 ET rejected (outside window)', !has(free, '2026-11-09T13:30:00.000Z'))
  check('on the 30-minute grid', free.every((s) => [0, 30].includes(local(s.start).mi)))
  eq('one_on_one is 30 minutes', (Date.parse(free[0].end) - Date.parse(free[0].start)) / 60000, 30)
  const pod = candidateSlots(base({ category: 'podcast' })).free
  eq('podcast is 60 minutes', (Date.parse(pod[0].end) - Date.parse(pod[0].start)) / 60000, 60)
  check('podcast 16:30 rejected (would end 17:30)', !has(pod, '2026-11-09T21:30:00.000Z') && has(pod, '2026-11-09T21:00:00.000Z'))
  eq('durations table', [DURATIONS.one_on_one.minutes, DURATIONS.one_on_one.bufferAfter, DURATIONS.team_familiar.minutes, DURATIONS.group_coaching.minutes, DURATIONS.in_person.minutes], [30, 10, 30, 60, 60])
  const none = candidateSlots(base({ windows: [] })).free
  eq('no windows, no slots', none.length, 0)
  const chicago = candidateSlots(base({ windows: [{ weekdays: [1], start_time: '09:00', end_time: '10:00', timezone: 'America/Chicago' }] })).free
  eq('a Chicago window is read in its own zone (10 to 11 ET)', starts(chicago).slice(0, 2), ['2026-11-09T15:00:00.000Z', '2026-11-09T15:30:00.000Z'])
  const sunday0 = candidateSlots(base({ windows: [{ ...WEEK, weekdays: [0, 6] }] })).free
  eq('0 and 6 (Sun, Sat) give nothing on weekdays', sunday0.length, 0)
}

// ── busy ───────────────────────────────────────────────────────────────────
{
  const cover = { window_from: '2026-11-01T00:00:00Z', window_to: '2026-12-01T00:00:00Z' }
  const busy = candidateSlots(base({ snapshots: [{ ...cover, busy: [{ start: '2026-11-09T14:00:00Z', end: '2026-11-09T15:00:00Z' }] }] })).free
  check('busy removes 9:00 and 9:30', !has(busy, '2026-11-09T14:00:00.000Z') && !has(busy, '2026-11-09T14:30:00.000Z'))
  check('busy keeps 10:00', has(busy, '2026-11-09T15:00:00.000Z'))
  const buf = candidateSlots(base({ snapshots: [{ ...cover, busy: [{ start: '2026-11-09T15:00:00Z', end: '2026-11-09T15:30:00Z' }] }] })).free
  check('the 10-minute buffer removes 9:30 before a 10:00 busy', !has(buf, '2026-11-09T14:30:00.000Z') && has(buf, '2026-11-09T14:00:00.000Z'))
  const tf = candidateSlots(base({ category: 'team_familiar', snapshots: [{ ...cover, busy: [{ start: '2026-11-09T15:00:00Z', end: '2026-11-09T15:30:00Z' }] }] })).free
  check('team_familiar has no buffer: 9:30 stays', has(tf, '2026-11-09T14:30:00.000Z'))
  const uncovered = candidateSlots(base({ snapshots: [{ window_from: '2026-11-20T00:00:00Z', window_to: '2026-11-21T00:00:00Z', busy: [{ start: '2026-11-09T14:00:00Z', end: '2026-11-09T15:00:00Z' }] }] })).free
  check('a snapshot that does not cover the slot does not remove it', has(uncovered, '2026-11-09T14:00:00.000Z'))
  const hub = candidateSlots(base({ hubBusy: [{ start: '2026-11-10T14:00:00Z', end: '2026-11-10T22:00:00Z' }] }))
  check('Hub busy removes the whole day', !hub.free.some((s) => s.date === '2026-11-10'))
  check('busy is ignored in ignoringBusy', hub.ignoringBusy.some((s) => s.date === '2026-11-10'))
  const junk = candidateSlots(base({ snapshots: [{ ...cover, busy: [null, { start: 'x', end: 'y' }, 7] }] })).free
  check('junk busy entries are ignored, not fatal', junk.length > 0)
}

// ── overrides ──────────────────────────────────────────────────────────────
{
  const blocked = candidateSlots(base({ overrides: [{ kind: 'block', starts_at: '2026-11-09T05:00:00Z', ends_at: '2026-11-10T05:00:00Z' }] }))
  check('block removes the day', !blocked.free.some((s) => s.date === '2026-11-09'))
  check('block removes it from ignoringBusy too', !blocked.ignoringBusy.some((s) => s.date === '2026-11-09'))
  const extra = candidateSlots(base({ overrides: [{ kind: 'extra', starts_at: '2026-11-09T23:00:00Z', ends_at: '2026-11-10T00:00:00Z' }] })).free
  check('extra adds 6:00 PM ET', has(extra, '2026-11-09T23:00:00.000Z'))
  check('without the extra 6:00 PM is not offered', !has(candidateSlots(base()).free, '2026-11-09T23:00:00.000Z'))
  const joined = candidateSlots(base({ overrides: [{ kind: 'extra', starts_at: '2026-11-09T22:00:00Z', ends_at: '2026-11-09T23:00:00Z' }] })).free
  check('an extra right after a window merges with it (4:45 to 5:15 fits)', has(joined, '2026-11-09T21:30:00.000Z') && has(joined, '2026-11-09T22:00:00.000Z'))
  const wkend = candidateSlots(base({ overrides: [{ kind: 'extra', starts_at: '2026-11-07T14:00:00Z', ends_at: '2026-11-07T18:00:00Z' }] })).free
  check('an extra on a weekend still offers nothing on the weekend', !wkend.some((s) => s.date === '2026-11-07'))
}

// ── DST boundary (fall back Sun 2026-11-01) ────────────────────────────────
{
  const dst = candidateSlots(base({ now: '2026-10-29T16:00:00Z' })).free
  eq('Fri Oct 30 9:00 AM EDT is 13:00Z', dst[0].start, '2026-10-30T13:00:00.000Z')
  const mon = dst.find((s) => s.date === '2026-11-02')
  eq('Mon Nov 2 9:00 AM EST is 14:00Z', mon?.start, '2026-11-02T14:00:00.000Z')
  const spring = candidateSlots(base({ now: '2026-03-05T16:00:00Z' })).free
  eq('Mon Mar 9 9:00 AM EDT is 13:00Z', spring.find((s) => s.date === '2026-03-09')?.start, '2026-03-09T13:00:00.000Z')
  eq('Fri Mar 6 9:00 AM EST is 14:00Z', spring[0].start, '2026-03-06T14:00:00.000Z')
}

// ── spread ─────────────────────────────────────────────────────────────────
{
  const three = findSlots(base())
  eq('three slots, one per day, earliest first', starts(three), ['2026-11-09T14:00:00.000Z', '2026-11-10T14:00:00.000Z', '2026-11-11T14:00:00.000Z'])
  const ruled = findSlots(base(), (s) => s.date !== '2026-11-09')
  eq('the rule check removes Monday', ruled[0].date, '2026-11-10')
  const mondays = findSlots(base({ windows: [{ ...WEEK, weekdays: [1] }] }))
  eq('two days only: one per day, then the earliest left', starts(mondays), ['2026-11-09T14:00:00.000Z', '2026-11-09T14:30:00.000Z', '2026-11-16T14:00:00.000Z'])
  const oneDay = pickSpread([
    { start: '2026-11-09T14:00:00.000Z', end: '2026-11-09T14:30:00.000Z', date: '2026-11-09' },
    { start: '2026-11-09T14:30:00.000Z', end: '2026-11-09T15:00:00.000Z', date: '2026-11-09' },
  ])
  eq('fills from the same day when that is all there is', oneDay.length, 2)
  eq('nothing allowed, nothing offered', findSlots(base(), () => false).length, 0)
  eq('max 3', findSlots(base()).length, 3)
}

// ── label ──────────────────────────────────────────────────────────────────
{
  const l = slotLabel('2026-11-10T15:00:00Z', TZ)
  eq('label', l, 'Tue, Nov 10 at 10:00 AM')
  check('label has only plain spaces', !/[   ]/.test(l))
  eq('label in EDT', slotLabel('2026-10-30T13:00:00Z', TZ), 'Fri, Oct 30 at 9:00 AM')
}

const failed = results.filter((r) => !r.ok)
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`)
console.log(failed.length ? `AVAIL_CHECK FAIL ${results.length - failed.length}/${results.length}` : `AVAIL_CHECK PASS ${results.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
