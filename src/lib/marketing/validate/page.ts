// src/lib/marketing/validate/page.ts
// The one set of checks for a landing page (agent ruling 12): pages are data, a list of
// blocks rendered by /p/[slug]. The staff route POST /api/marketing/pages and the Campaign
// Builder agent both call this. Only these block types exist; anything else is refused, so
// a page can never carry script, raw HTML or an off-site form.
import { FORM_SLUG } from './form'

export const PAGE_STATUSES = ['draft', 'published', 'archived']
export const MAX_BLOCKS = 30

export type PageBlock =
  | { type: 'heading'; text: string; level: 1 | 2 }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; url: string; alt: string }
  | { type: 'button'; label: string; href: string }
  | { type: 'form' }

export interface PageFields { slug: string; title: string; status: string; blocks: PageBlock[]; form_slug: string | null }
export type PageCheck = { ok: true; row: PageFields } | { ok: false; message: string }

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
const https = (v: unknown) => {
  if (typeof v !== 'string') return null
  try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : null } catch { return null }
}
/** A link may go to a path on the same site or to an https address, nothing else. */
const href = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)[A-Za-z0-9/_.~%=&?#-]*$/.test(v) ? v : https(v))

export function checkPage(b: any): PageCheck {
  const slug = typeof b?.slug === 'string' ? b.slug.trim().toLowerCase() : ''
  if (!FORM_SLUG.test(slug) || slug.length > 60) return { ok: false, message: 'The page address uses lower case letters, numbers, and single dashes.' }
  const title = str(b.title, 200)
  if (!title) return { ok: false, message: 'Give the page a title.' }
  const status = PAGE_STATUSES.includes(b.status) ? b.status : 'draft'
  const raw: any[] = Array.isArray(b.blocks) ? b.blocks : []
  if (!raw.length) return { ok: false, message: 'A page needs at least one block.' }
  if (raw.length > MAX_BLOCKS) return { ok: false, message: `A page can have at most ${MAX_BLOCKS} blocks.` }
  const blocks: PageBlock[] = []
  let forms = 0
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i] ?? {}
    const n = `Block ${i + 1}`
    if (x.type === 'heading') {
      const text = str(x.text, 120)
      if (!text) return { ok: false, message: `${n} is a heading and needs text of at most 120 characters.` }
      blocks.push({ type: 'heading', text, level: x.level === 2 ? 2 : 1 })
    } else if (x.type === 'text') {
      const text = str(x.text, 2000)
      if (!text) return { ok: false, message: `${n} needs text of at most 2000 characters.` }
      blocks.push({ type: 'text', text })
    } else if (x.type === 'list') {
      const items = Array.isArray(x.items) ? x.items.map((t: unknown) => str(t, 200)) : []
      if (!items.length || items.length > 10 || items.some((t: string | null) => !t)) return { ok: false, message: `${n} is a list of one to ten items, each at most 200 characters.` }
      blocks.push({ type: 'list', items: items as string[] })
    } else if (x.type === 'image') {
      const url = https(x.url); const alt = str(x.alt, 200)
      if (!url || !alt) return { ok: false, message: `${n} is an image and needs an https address and a description.` }
      blocks.push({ type: 'image', url, alt })
    } else if (x.type === 'button') {
      const label = str(x.label, 60); const to = href(x.href)
      if (!label || !to) return { ok: false, message: `${n} is a button and needs a label and a link to a page here or an https address.` }
      blocks.push({ type: 'button', label, href: to })
    } else if (x.type === 'form') {
      forms++
      blocks.push({ type: 'form' })
    } else {
      return { ok: false, message: `${n} is not a block type pages support. Use heading, text, list, image, button or form.` }
    }
  }
  const formSlug = typeof b.form_slug === 'string' && b.form_slug.trim() ? b.form_slug.trim().toLowerCase() : null
  if (forms > 1) return { ok: false, message: 'A page can show its form once.' }
  if (forms === 1 && !formSlug) return { ok: false, message: 'This page shows a form, so choose which form.' }
  return { ok: true, row: { slug, title, status, blocks, form_slug: formSlug } }
}
