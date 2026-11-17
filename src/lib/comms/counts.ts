// src/lib/comms/counts.ts
// The contact card's Communication Activity counts (Running List q30), counted from EXACTLY the touches the
// Communications section shows that viewer (GET /api/crm/contacts/[id]/communications, src/lib/comms/history.ts), so
// the numbers and the list can never disagree. Pure, no imports beyond a type.
//
// A private-mail row the viewer may not read arrives redacted ("Email (private inbox)", "Private email"): it is not
// counted as one of the viewer's emails, it is reported apart as `privateEmails`, so emails + privateEmails is every
// email row in the list.
import type { Touch } from './privacy'

export interface CommCounts { calls: number; texts: number; emails: number; privateEmails: number }

export function countTouches(touches: Pick<Touch, 'type' | 'redacted' | 'muted'>[]): CommCounts {
  const out: CommCounts = { calls: 0, texts: 0, emails: 0, privateEmails: 0 }
  for (const t of touches) {
    if (t.muted) continue
    if (t.type === 'call') out.calls++
    else if (t.type === 'text') out.texts++
    else if (t.type === 'email') { if (t.redacted) out.privateEmails++; else out.emails++ }
  }
  return out
}
