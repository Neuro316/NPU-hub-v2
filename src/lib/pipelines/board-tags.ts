// src/lib/pipelines/board-tags.ts
// The pipeline board's tag filter (the Sensorium outreach, 2026-11-23): a chip row above the columns, multi-select,
// remembered in the URL as ?tags=a,b. Choosing tags shows the cards that carry EVERY chosen tag (AND, as the smart
// lists' "includes all of"); choosing none shows every card. Pure.

export const TAGS_PARAM = 'tags'

/** The cards that carry every chosen tag; all of them when none is chosen. */
export function filterByTags<T extends { tags?: string[] | null }>(cards: T[], chosen: string[]): T[] {
  if (!chosen.length) return cards
  return cards.filter((c) => chosen.every((t) => (c.tags ?? []).includes(t)))
}

/** The tags the chip row offers: every tag on the board's cards, sorted. */
export function boardTags(cards: Array<{ tags?: string[] | null }>): string[] {
  return Array.from(new Set(cards.flatMap((c) => c.tags ?? []).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

/** ?tags=a,b to a list, and back. Empty entries are dropped. */
export const parseTags = (raw: string | null | undefined) => String(raw ?? '').split(',').map((t) => t.trim()).filter(Boolean)
export const formatTags = (tags: string[]) => tags.map((t) => t.trim()).filter(Boolean).join(',')
