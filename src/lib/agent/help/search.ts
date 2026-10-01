// src/lib/agent/help/search.ts
// Ruling 17: retrieval is a plain keyword and tag search over the help articles, run on the
// server as the Guide's read tool. No vector database. Pure.
import type { Article } from './corpus'

const STOP = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'does', 'with', 'this', 'that', 'into', 'from', 'are', 'you', 'your',
  'when', 'where', 'why', 'who', 'its', 'use', 'get', 'set', 'make', 'want', 'need', 'about', 'there', 'their', 'have', 'has', 'was', 'not'])

export const MIN_SCORE = 4

export function terms(q: string): string[] {
  return Array.from(new Set(String(q ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))))
}

/** The articles that match, best first. A tag phrase found in the question counts most. */
export function searchHelp(query: string, list: Article[], opts: { route?: string | null; limit?: number } = {}): Array<{ article: Article; score: number }> {
  const q = String(query ?? '').toLowerCase()
  const words = terms(q)
  if (!words.length) return []
  const scored = list.map((a) => {
    let score = 0
    // a tag phrase counts only when it holds a real term: a tag like "how do i" is all stop
    // words and would otherwise match every question asked
    for (const tag of a.tags) if (terms(tag).length && q.includes(tag.toLowerCase())) score += 4
    const title = a.title.toLowerCase(), summary = a.summary.toLowerCase(), body = a.text.toLowerCase()
    for (const w of words) {
      if (title.includes(w)) score += 3
      if (a.tags.some((t) => t.toLowerCase().split(' ').includes(w))) score += 2
      if (summary.includes(w)) score += 2
      if (body.includes(w)) score += 1
    }
    if (score > 0 && opts.route && a.route === opts.route) score += 1
    return { article: a, score }
  })
  // one stray word in an article body is not a match: off-topic questions scored 1 to 3 and
  // covered ones 9 and up when this was set (2026-10-01), so 4 keeps unrelated articles out of
  // the Guide's context and lets it say plainly that the help set does not cover the question
  return scored.filter((s) => s.score >= MIN_SCORE).sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id)).slice(0, opts.limit ?? 3)
}
