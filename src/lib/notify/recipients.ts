// src/lib/notify/recipients.ts
// Pure. The recipient choices on Settings › Notifications (Running List q34). One person can hold several logins
// (a work address and a personal one), each with its own team profile, so a name alone cannot tell the entries
// apart. Every choice carries its login's email, and only active staff of the org are offered.

export const STAFF_ROLES = ['super_admin', 'admin', 'team_member']

export interface TeamRow { user_id: string | null; display_name: string | null; email: string | null; role: string | null; status: string | null }
export interface Recipient { user_id: string; name: string; email: string; label: string }

/** Active staff rows to choices: one per login, labelled "Name (email)", sorted by name then email. */
export function recipientOptions(rows: TeamRow[], profileEmail: Record<string, string> = {}): Recipient[] {
  const seen = new Set<string>()
  const out: Recipient[] = []
  for (const r of rows) {
    if (!r.user_id || r.status !== 'active' || !STAFF_ROLES.includes(String(r.role ?? ''))) continue
    if (seen.has(r.user_id)) continue
    seen.add(r.user_id)
    const name = (r.display_name ?? '').trim() || 'Team member'
    const email = (r.email ?? '').trim() || profileEmail[r.user_id] || 'no email on file'
    out.push({ user_id: r.user_id, name, email, label: `${name} (${email})` })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
}
