// src/lib/mail/access.ts
// THE mailbox rule (decision by Cameron, 2026-11-23): who counts as a mailbox's owner for seeing it. A user listed in
// hub_mail_connections.also_visible_to (hub_249) is treated exactly as the owner: full access to that mailbox,
// private ones included. Nobody else gains anything: a private mailbox stays owner-only for every other superadmin.
// This is NOT the 'shared' visibility; it is a per-mailbox list, and only the owner may change it.
//
// Every visibility decision in the Hub goes through ownerEquivalent: canSee, loadVisible and listVisible
// (src/lib/mail/google.ts: the Inbox, the review pane, mail search, Learning, the mailboxes settings list) and
// mailView (src/lib/comms/privacy.ts: Communications, Recent email, the drafts list and actions, Waiting on us).
// Changing who may EDIT the list is not visibility: that is the owner only (isOwner), never a listed user.
// Pure, no imports, so the harnesses run it directly.

export interface AccessBox { owner_user_id: string; also_visible_to?: string[] | null }

/** The one rule: the owner, or a user the owner listed in also_visible_to. */
export function ownerEquivalent(viewer: { userId: string }, box: AccessBox): boolean {
  if (!viewer.userId) return false
  if (box.owner_user_id === viewer.userId) return true
  return Array.isArray(box.also_visible_to) && box.also_visible_to.includes(viewer.userId)
}

/** Only the owner may change who else sees a mailbox (its visibility and its also_visible_to list). */
export function isOwner(viewer: { userId: string }, box: Pick<AccessBox, 'owner_user_id'>): boolean {
  return !!viewer.userId && box.owner_user_id === viewer.userId
}

export const ALSO_COLUMN = 'also_visible_to'
const MISSING_COLUMN = ['42703', 'PGRST204']

/**
 * Runs a hub_mail_connections read with also_visible_to added to `base`. Before hub_249 the column does not exist:
 * the read runs again without it, so nobody is listed and everyone keeps today's rule.
 */
export async function withAlso(base: string, run: (columns: string) => PromiseLike<{ data: unknown; error: any }>): Promise<{ data: any; error: any }> {
  const r = await run(`${base}, ${ALSO_COLUMN}`)
  if (r.error && MISSING_COLUMN.includes(String(r.error.code ?? ''))) return run(base)
  return r
}
