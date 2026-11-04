// src/lib/resources/plan.ts
// Pure rules for "Send resources" (Build 2, docs/plans/hub-resource-library-rulings.md):
// which checked files are attached and which go as signed links, and the email text.
// No I/O here, so scripts/resources/plan-check.mjs can exercise it directly.

export const ATTACH_LIMIT_BYTES = 20 * 1024 * 1024
export const LINK_DAYS = 7
export const DEFAULT_SUBJECT = 'Resources from Neuro Progeny'
export const DEFAULT_NOTE = 'Great to connect today. Here are the resources we talked about. Reply here anytime with questions.'
/** "Send from" defaults, in order: Cameron's own mailbox (private, so only Cameron ever sees
 *  it), then the shared ops@ mailbox, then the first one the caller can send from. */
export const DEFAULT_FROM_ADDRESSES = ['cameron.allen@neuroprogeny.com', 'ops@neuroprogeny.com']

export interface PlanFile { id: string; name: string; size_bytes: number }

export interface FromOption { id: string; email_address: string; usable: boolean }

/** The mailbox the "Send from" picker starts on, from the caller's visible mailboxes. */
export function defaultFrom<T extends FromOption>(options: T[]): T | null {
  const usable = options.filter(o => o.usable)
  for (const address of DEFAULT_FROM_ADDRESSES) {
    const hit = usable.find(o => o.email_address.toLowerCase() === address)
    if (hit) return hit
  }
  return usable[0] ?? null
}

/** Every file is attached; while the total is above the limit, the largest attached file
 *  moves to a signed link (ties: the later one in the list). Order is kept in both lists. */
export function splitFiles<T extends PlanFile>(files: T[], limit = ATTACH_LIMIT_BYTES): { attached: T[]; linked: T[] } {
  const linkedIds = new Set<string>()
  let total = files.reduce((n, f) => n + f.size_bytes, 0)
  while (total > limit) {
    let pick: T | null = null
    for (const f of files) {
      if (linkedIds.has(f.id)) continue
      if (!pick || f.size_bytes >= pick.size_bytes) pick = f
    }
    if (!pick) break
    linkedIds.add(pick.id)
    total -= pick.size_bytes
  }
  return { attached: files.filter(f => !linkedIds.has(f.id)), linked: files.filter(f => linkedIds.has(f.id)) }
}

export function linkExpiry(now: Date): Date {
  return new Date(now.getTime() + LINK_DAYS * 24 * 60 * 60 * 1000)
}

export function expiryLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(d)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The email in plain text and HTML. `url` is absent in the preview (links are minted only
 *  when the email is sent) and present in the real send. */
export function emailBodies(note: string, linked: { name: string; url?: string }[], expiresAt: Date): { text: string; html: string } {
  const body = note.trim()
  if (!linked.length) {
    return { text: body + '\n', html: `<div style="white-space:pre-wrap">${esc(body)}</div>` }
  }
  const intro = `${linked.length === 1 ? 'One file was' : 'Some files were'} too large to attach. Download ${linked.length === 1 ? 'it' : 'them'} here (the ${linked.length === 1 ? 'link expires' : 'links expire'} on ${expiryLabel(expiresAt)}):`
  const text = `${body}\n\n${intro}\n${linked.map(l => `- ${l.name}: ${l.url ?? '[download link]'}`).join('\n')}\n`
  const html = `<div style="white-space:pre-wrap">${esc(body)}</div><p>${esc(intro)}</p><ul>${
    linked.map(l => `<li>${l.url ? `<a href="${esc(l.url)}">${esc(l.name)}</a>` : `${esc(l.name)} [download link]`}</li>`).join('')
  }</ul>`
  return { text, html }
}
