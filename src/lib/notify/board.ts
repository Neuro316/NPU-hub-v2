// src/lib/notify/board.ts
// One rule for "closed" board columns and the card badges, shared by the task board (task-card.tsx, through
// kanban-column.tsx) and the 8 AM brief (brief.ts, flagged tasks), so the two can never disagree. Pure, no imports.
//
// kanban_columns has no key or status field (id, org_id, title, color, sort_order, created_at), so the column's
// title is the only signal: Done and Trash are closed, matched ignoring case and outer spaces.

export const CLOSED_COLUMN_TITLES = ['done', 'trash']

export function isClosedColumn(title: string | null | undefined): boolean {
  return CLOSED_COLUMN_TITLES.includes(String(title ?? '').trim().toLowerCase())
}

/**
 * A card's Overdue and Stuck badges. Neither shows on a finished card: one with completed_at set, or one sitting in a
 * closed column (cards moved to Done or Trash often have no completed_at).
 */
export function cardBadges(
  task: { due_date?: string | null; completed_at?: string | null; custom_fields?: Record<string, any> | null },
  closed: boolean,
  now: Date = new Date(),
): { overdue: boolean; stuck: boolean } {
  const open = !task.completed_at && !closed
  const overdue = open && !!task.due_date && new Date(task.due_date) < now
  const stuck = open && (task.custom_fields?.reason === 'enrolled_inactive_10d' || task.custom_fields?.stuck === true)
  return { overdue, stuck }
}
