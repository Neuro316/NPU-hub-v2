// src/lib/agent/help/show-me.ts
// "Show me" (ruling 18): highlight one control so the person can find it. It only ever scrolls
// to and outlines an element; it never clicks, types or submits. It acts only on an id that is
// in the registry AND present on the page right now. Takes the document as a parameter so it
// can be tested without a browser.

export interface DocLike { querySelector(sel: string): ElementLike | null }
export interface ElementLike {
  scrollIntoView?(opts?: unknown): void
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

export type ShowMeResult = { ok: true } | { ok: false; reason: 'unknown_target' | 'not_on_this_page' }

export const HIGHLIGHT_ATTR = 'data-help-highlight'

export function showMe(doc: DocLike, id: string, registryIds: string[], ms = 3000): ShowMeResult {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id) || !registryIds.includes(id)) return { ok: false, reason: 'unknown_target' }
  const el = doc.querySelector(`[data-help-id="${id}"]`)
  if (!el) return { ok: false, reason: 'not_on_this_page' }
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  el.setAttribute(HIGHLIGHT_ATTR, 'on')
  setTimeout(() => el.removeAttribute(HIGHLIGHT_ATTR), ms)
  return { ok: true }
}
