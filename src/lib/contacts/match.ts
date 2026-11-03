// src/lib/contacts/match.ts
// Contact matching rules shared by the duplicate sweep (/api/contacts/duplicates) and the
// booking sync (src/lib/bookings/sync.ts).

const lowerEmail = (v: string | null) => String(v || '').trim().toLowerCase();

// ── Junk-email guard ────────────────────────────────────────────────────────
// A value that isn't a real address is not an identifier and must not cluster
// anyone. Ella Brown's record has the literal string "test" in the email field;
// two such records would otherwise "share an email" and merge two strangers.
const PLACEHOLDER_LOCALS = new Set([
  'test', 'tests', 'testing', 'none', 'na', 'n/a', 'nil', 'null', 'unknown',
  'noemail', 'no-email', 'no_email', 'email', 'example', 'sample', 'x', 'xx', 'xxx',
]);
const PLACEHOLDER_ADDRESSES = new Set([
  'test@test.com', 'test@example.com', 'example@example.com', 'noreply@example.com',
  'none@none.com', 'na@na.com', 'no@email.com', 'nobody@nowhere.com',
]);

export function isUsableEmail(raw: string | null): boolean {
  const e = lowerEmail(raw);
  if (!e) return false;
  // Must actually look like an address: one @, a dot in the domain, no spaces.
  if (/\s/.test(e)) return false;
  const parts = e.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (PLACEHOLDER_ADDRESSES.has(e)) return false;
  if (PLACEHOLDER_LOCALS.has(local)) return false;
  return true;
}
