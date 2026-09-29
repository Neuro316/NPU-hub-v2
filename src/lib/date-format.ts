// ═══════════════════════════════════════════════════════════════
// Shared date and time formatting.
//
// Every formatter here renders in the VIEWER's local timezone. That is what
// Intl does when no timeZone option is passed, and it is deliberate: staff read
// these screens from wherever they are, and a call at 4:58pm should read 4:58pm
// to the person who took it.
//
// Before this module the same four shapes were reimplemented in ~52 files. The
// duplicates drifted: the conversations list never printed a year, so a message
// from a previous year was indistinguishable from this year's, and the contact
// panel stopped at days, so two years read as "731d ago".
//
// All inputs accept null/undefined and a malformed string, and return a safe
// placeholder rather than "Invalid Date".
// ═══════════════════════════════════════════════════════════════

const LOCALE = 'en-US'

/** Parse defensively. Returns null for null, undefined, '' or an unparseable value. */
function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameYear(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
}

/**
 * Clock time only: "4:58 PM". For an item that already sits under a date
 * separator, so the day is established by context.
 */
export function fmtClock(d: string | Date | null | undefined): string {
  const date = toDate(d)
  if (!date) return ''
  return date.toLocaleTimeString(LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Full, unambiguous date and time: "Monday, September 29, 2026 at 4:58 PM".
 * Used for the title attribute, so hovering any item gives the exact moment
 * with no relative arithmetic and no missing year.
 */
export function fmtFull(d: string | Date | null | undefined): string {
  const date = toDate(d)
  if (!date) return ''
  return date.toLocaleString(LOCALE, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Date separator heading: "Today", "Yesterday", "Monday, September 29", or
 * "September 29, 2025" once the date falls outside the current year.
 */
export function fmtDateSeparator(d: string | Date | null | undefined): string {
  const date = toDate(d)
  if (!date) return ''

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86400000)

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'

  if (isSameYear(date, now)) {
    return date.toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })
  }
  return date.toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Compact list stamp: "now", "5m", "3h", "2d", then "Mar 3" inside the current
 * year and "Mar 3, 2025" outside it.
 *
 * The year matters. Without it a thread last touched in a previous year sorts
 * to the bottom of the list showing "Mar 3", which reads as recent.
 */
export function fmtListStamp(d: string | Date | null | undefined): string {
  const date = toDate(d)
  if (!date) return ''

  const now = new Date()
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000)

  // A clock skew or a server timestamp a few seconds ahead should read as
  // "now", not as a negative age.
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`

  if (isSameYear(date, now)) {
    return date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Relative age in words: "Just now", "5m ago", "3h ago", "2d ago", then an
 * absolute date past a week. Used for "last contacted" style stat lines.
 */
export function fmtAgo(d: string | Date | null | undefined, emptyLabel = 'Never'): string {
  const date = toDate(d)
  if (!date) return emptyLabel

  const now = new Date()
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`

  if (isSameYear(date, now)) {
    return date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Call/voicemail length as "m:ss". */
export function fmtDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Bucket an item carrying no usable timestamp lands in. It gets its own group
 * with a visible heading rather than an empty one, so such an item is never
 * silently undated on screen.
 */
export const UNDATED_KEY = '__undated__'
export const UNDATED_LABEL = 'Date unknown'

/**
 * Stable per-day bucket key. Uses the LOCAL calendar day, so an event at
 * 11pm local does not land in the next day's group the way an ISO-date slice
 * of a UTC string would.
 */
export function dayKey(d: string | Date | null | undefined): string {
  const date = toDate(d)
  if (!date) return UNDATED_KEY
  return date.toDateString()
}

/**
 * Group timestamp-bearing items into consecutive per-day buckets, preserving
 * the order they arrive in. Follows the groupByDate pattern already used by
 * activity-log/page.tsx, generalized over the timestamp accessor.
 */
export function groupByDay<T>(
  items: T[],
  getTimestamp: (item: T) => string | Date | null | undefined
): { key: string; dayKey: string; label: string; items: T[] }[] {
  const groups: { key: string; dayKey: string; label: string; items: T[] }[] = []
  items.forEach(item => {
    const ts = getTimestamp(item)
    const bucket = dayKey(ts)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === bucket) {
      last.items.push(item)
      return
    }
    // `key` is unique per group and is what a renderer should hand React.
    // `dayKey` is the semantic bucket and repeats when undated items appear in
    // more than one run. Handing React the semantic value directly meant two
    // groups could share a key, and React drops or merges siblings whose keys
    // collide, which silently loses a heading.
    groups.push({
      key: `${bucket}#${groups.length}`,
      dayKey: bucket,
      label: bucket === UNDATED_KEY ? UNDATED_LABEL : fmtDateSeparator(ts),
      items: [item],
    })
  })
  return groups
}
