// src/lib/comms/conversation-link.ts
// One definition of the link into a Conversations thread (Running List q30), shared by the contact card (which builds
// the link) and the Conversations page (which opens the thread it names), so the two cannot drift apart. Pure.

/** The query parameter that names a thread on /crm/conversations. */
export const CONVERSATION_PARAM = 'id'

export function conversationHref(conversationId: string): string {
  return `/crm/conversations?${CONVERSATION_PARAM}=${encodeURIComponent(conversationId)}`
}

/**
 * The thread a link names, chosen ONLY from the threads the viewer's list already loaded (never fetched on its own),
 * or null when it is not there (the page then shows its empty state with a short note).
 */
export function pickLinkedThread<T extends { id: string }>(threads: T[], linkedId: string | null | undefined): T | null {
  if (!linkedId) return null
  return threads.find((t) => t.id === linkedId) ?? null
}
