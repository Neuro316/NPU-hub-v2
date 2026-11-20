// src/lib/drafts/live.ts
// Server only. One connection's Gmail access, with ITS OWN token (the draft lands in the mailbox the email came to).
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, refreshTokenFor } from '@/lib/mail/google'
import { getMessageForTriage } from '@/lib/mail/gmail'
import { gmailCaller } from './gmail-drafts'
import type { Mailbox } from './support'

export function liveMailboxes(db: SupabaseClient): (connectionId: string) => Promise<Mailbox> {
  const cache = new Map<string, Promise<Mailbox>>()
  return (connectionId) => {
    if (!cache.has(connectionId)) {
      cache.set(connectionId, (async () => {
        const token = await accessTokenFor(await refreshTokenFor(db, connectionId))
        return { gmail: gmailCaller(token), read: (id: string) => getMessageForTriage(token, id) }
      })())
    }
    return cache.get(connectionId)!
  }
}
