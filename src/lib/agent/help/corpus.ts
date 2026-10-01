// src/lib/agent/help/corpus.ts
// The Hub Guide's help articles (ruling 16), parsed from the copies of docs/help/*.md that
// scripts/agent/gen-content.cjs bundles. Each article: an id, the route it applies to, the
// controls it refers to, tags, a short summary, numbered steps, common mistakes and related
// ids. Pure.
import { HELP_SOURCES } from '../generated/help-corpus'

export interface Article {
  id: string; title: string; route: string; help_ids: string[]; tags: string[]; summary: string; related: string[]
  steps: string[]; mistakes: string[]; file: string; text: string
}

const list = (v: string) => v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean)

export function parseArticle(file: string, text: string): Article | null {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const body = m[2]
  const section = (name: string) => (new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body)?.[1] ?? '')
  const steps = section('Steps').split('\n').map((l) => /^\d+\.\s+(.*)$/.exec(l.trim())?.[1]).filter((x): x is string => !!x)
  const mistakes = section('Common mistakes').split('\n').map((l) => /^-\s+(.*)$/.exec(l.trim())?.[1]).filter((x): x is string => !!x)
  if (!meta.id || !meta.title || !meta.route) return null
  return { id: meta.id, title: meta.title, route: meta.route, help_ids: list(meta.help_ids ?? ''), tags: list(meta.tags ?? ''),
    summary: meta.summary ?? '', related: list(meta.related ?? ''), steps, mistakes, file, text: body.trim() }
}

let cache: Article[] | null = null
export function articles(): Article[] {
  if (!cache) cache = HELP_SOURCES.map((s) => parseArticle(s.file, s.text)).filter((a): a is Article => !!a)
  return cache
}

/** The short index sent with every Guide question: what exists, not the full text. */
export function articleIndex(list: Article[] = articles()) {
  return list.map((a) => `- ${a.id}: ${a.title} (${a.route}). ${a.summary}`).join('\n')
}
