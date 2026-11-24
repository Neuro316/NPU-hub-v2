// src/lib/pipelines/board-list.ts
// The Pipelines board's selector and its columns, as pure functions.
//
// The selector lists every live pipeline of the org (the pipelines table, archived_at null), in position order.
// The board's editor still saves its definitions to org_settings crm_pipelines, but a pipeline can exist in the
// tables only (the CSV import's 'Cold Outreach: Sensorium Reactivation' is one). Such a pipeline is shown from its
// table row, and because the page saves the whole list, the next save writes it into the setting too. That matters:
// sync_pipelines_from_settings (hub_211) archives every table pipeline the setting does not name, so a save that
// left it out would take it off every board.
import type { PipelineRef } from './positions'

export interface BoardStage { id: string; name: string; color: string; is_closed_won?: boolean; is_closed_lost?: boolean; position: number }
export interface BoardPipeline { id: string; name: string; stages: BoardStage[] }

const FALLBACK_COLOR = '#94a3b8'

/** A pipeline known only from the tables, as a board definition: ids are the legacy keys the tables are matched by. */
export function pipelineFromRef(ref: PipelineRef): BoardPipeline {
  return {
    id: ref.key,
    name: ref.name,
    stages: ref.stages.map((s, i) => ({
      id: s.key, name: s.name, color: s.color || FALLBACK_COLOR,
      is_closed_won: s.is_closed_won, is_closed_lost: s.is_closed_lost, position: i,
    })),
  }
}

/**
 * Every live pipeline: the setting's definitions, plus each live table pipeline the setting does not name, ordered
 * by the table's position (a definition not yet synced keeps its place in the setting). Nothing is dropped.
 */
export function boardPipelines<T extends BoardPipeline>(config: T[], refs: PipelineRef[], fromRef: (r: PipelineRef) => T): T[] {
  const named = new Set(config.map((p) => p.id))
  const posOf = (id: string, fallback: number) => refs.find((r) => r.key === id || r.id === id)?.position ?? fallback
  const all = [
    ...config.map((p, i) => ({ p, pos: posOf(p.id, i), i })),
    ...refs.filter((r) => !named.has(r.key) && !named.has(r.id)).map((r, j) => ({ p: fromRef(r), pos: r.position, i: config.length + j })),
  ]
  return all.sort((a, b) => (a.pos - b.pos) || (a.i - b.i)).map((x) => x.p)
}

/** Cards shown per column before "Show more"; each click shows this many more. */
export const COLUMN_PAGE = 200

/** The cards a column renders and how many are held back. */
export function columnPage<T>(cards: T[], shown: number | undefined): { visible: T[]; hidden: number } {
  const n = Math.max(COLUMN_PAGE, shown ?? COLUMN_PAGE)
  const visible = cards.length > n ? cards.slice(0, n) : cards
  return { visible, hidden: cards.length - visible.length }
}
