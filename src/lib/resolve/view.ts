// src/lib/resolve/view.ts
// "No reply needed": the shape every reader gets (GET /api/resolve and the POST that makes one) and the pure display
// rules the button and the contact card's Waiting on us line share. No imports beyond types, so the browser can use it.
import { REASON_TEXT, type Reason, type Scope } from './check'

/** One live resolution, as GET /api/resolve lists it and POST /api/resolve returns it. */
export interface LiveResolution { id: string; scope: Scope; reason: Reason; reason_text: string; note: string | null; by: string; by_id: string; resolved_at: string }

/** The row in the reader's shape: who by name, the reason as the chip reads ("Not a lead"). */
export function viewOf(row: { id: string; scope: string; reason: string; note?: string | null; resolved_by: string; resolved_at: string }, byName: string): LiveResolution {
  return { id: row.id, scope: row.scope as Scope, reason: row.reason as Reason, reason_text: REASON_TEXT[row.reason as Reason] ?? row.reason, note: row.note ?? null,
    by: byName, by_id: row.resolved_by, resolved_at: row.resolved_at }
}

/** The live resolution that keeps a place quiet: one of its own scope, else one for everything. */
export function pickLive(rows: LiveResolution[], scope: Scope): LiveResolution | null {
  return rows.find((r) => r.scope === scope) ?? rows.find((r) => r.scope === 'all') ?? null
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
/** "Resolved by <name>, <reason>, <time>", the reason exactly as its chip reads. */
export function resolvedLine(live: Pick<LiveResolution, 'by' | 'reason_text' | 'resolved_at' | 'note'>): string {
  return `Resolved by ${live.by}, ${live.reason_text}, ${when(live.resolved_at)}${live.note ? ` (${live.note})` : ''}`
}

/** The contact card's Waiting on us block: resolved (the resolved line and Reopen), waiting (the open lines), or nothing. */
export function waitingMode(openRows: unknown[], live: LiveResolution | null): 'resolved' | 'waiting' | null {
  if (live) return 'resolved'
  return openRows.length ? 'waiting' : null
}
