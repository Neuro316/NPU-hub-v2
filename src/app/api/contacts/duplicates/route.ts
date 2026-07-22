import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';

// Duplicate detection — Phase 1 backlog sweep.
//
// GET  ?org_id=   -> candidate duplicate groups, highest confidence first
// POST            -> dismiss a pair ("these are different people")
//
// Signals, in confidence order:
//   email    HIGH   — same lowercased email
//   phone    HIGH   — same normalized last-10 digits
//   identity REVIEW — same identity_id where the identity was matched by
//                     resolve_identity's FUZZY NAME pass (similarity > 0.7).
//                     Its exact_email pass is already covered by `email`, so
//                     only the fuzzy case adds anything — and it can fuse
//                     distinct people, hence review-required.
//   name     REVIEW — identical first+last with no shared identifier
//
// Phase 2 (per-insert flagging, incl. the Mastermind Platform's direct DB
// writes) is deliberately NOT here — it needs to run at the DB level and is
// its own step. This route only sweeps what already exists.
//
// NOTE the detection deliberately does NOT use identity_id alone as a cluster
// key: resolve_identity only runs when email IS NOT NULL, so phone-only
// contacts (inbound callers, equipment imports) have no identity at all. The
// phone pass is what covers them.

const STAFF_ROLES = new Set(['admin', 'superadmin', 'facilitator']);

type Signal = 'email' | 'phone' | 'identity' | 'name';

interface ContactLite {
  id: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; identity_id: string | null;
  pipeline_stage: string | null; source: string | null; tags: string[] | null;
  created_at: string; last_contacted_at: string | null;
  total_calls: number | null; notes: string | null;
}

const digits10 = (v: string | null) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
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

function isUsableEmail(raw: string | null): boolean {
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

// ── Name agreement ──────────────────────────────────────────────────────────
// Safety net ON TOP of the profiles guard: two DIFFERENT real people can share
// a personal email (a couple, a family address). Default is agreement — a
// missing name is not evidence of a different person — and a group is demoted
// to Review only on positive evidence of conflict.
const NICKNAMES: Record<string, string> = {
  bob: 'robert', rob: 'robert', bobby: 'robert', bill: 'william', will: 'william',
  billy: 'william', mike: 'michael', mick: 'michael', dave: 'david', jim: 'james',
  jimmy: 'james', tom: 'thomas', tommy: 'thomas', chris: 'christopher',
  liz: 'elizabeth', beth: 'elizabeth', betsy: 'elizabeth', kate: 'katherine',
  katie: 'katherine', kathy: 'katherine', steve: 'stephen', steven: 'stephen',
  tony: 'anthony', rick: 'richard', dick: 'richard', rich: 'richard',
  nick: 'nicholas', jen: 'jennifer', jenny: 'jennifer', sue: 'susan', susie: 'susan',
  peggy: 'margaret', meg: 'margaret', maggie: 'margaret', dan: 'daniel', danny: 'daniel',
  joe: 'joseph', joey: 'joseph', ed: 'edward', eddie: 'edward', ken: 'kenneth',
};
const canonFirst = (s: string) => NICKNAMES[s] || s;

const normName = (s: string | null) =>
  String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase().replace(/[^a-z\s]/g, ' ')            // punctuation -> space
    .replace(/\s+/g, ' ').trim();

function firstNamesAgree(a: string, b: string): boolean {
  if (!a || !b) return true;                       // nothing to conflict with
  if (a === b) return true;
  if (canonFirst(a) === canonFirst(b)) return true;
  // single initial vs full name
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  // shortening: Cam/Cameron — require >= 3 chars so "J"/"Jane" doesn't pass here
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  return false;
}

/** True when two records' names do NOT contradict each other. */
function namesAgree(
  aFirst: string | null, aLast: string | null,
  bFirst: string | null, bLast: string | null
): boolean {
  const af = normName(aFirst), al = normName(aLast);
  const bf = normName(bFirst), bl = normName(bLast);

  // Same tokens in any order (handles first/last reversal in imports).
  const tokensA = `${af} ${al}`.trim().split(' ').filter(Boolean).sort().join(' ');
  const tokensB = `${bf} ${bl}`.trim().split(' ').filter(Boolean).sort().join(' ');
  if (tokensA && tokensA === tokensB) return true;

  // Rule 1: both last names present and different -> different family.
  if (al && bl && al !== bl) return false;
  // Rule 2: last names agree (or one is missing) -> first names must not conflict.
  return firstNamesAgree(af, bf);
}

/**
 * How complete is this record? Drives the default "merge toward the fuller
 * record" choice. Weighted so identifiers and real activity count for more
 * than cosmetic fields — a record with call history and an email is a better
 * survivor than one with a job title.
 */
function completeness(c: ContactLite): number {
  let score = 0;
  if (lowerEmail(c.email)) score += 25;
  if (digits10(c.phone)) score += 25;
  if (c.first_name) score += 5;
  if (c.last_name) score += 5;
  if (c.pipeline_stage) score += 10;
  if (c.tags?.length) score += 5;
  if (c.notes) score += 5;
  if (c.last_contacted_at) score += 10;
  score += Math.min(15, (c.total_calls || 0) * 3);
  return score;
}

async function requireStaff(admin: any, userId: string, orgId: string) {
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', userId).maybeSingle();
  const role = profile?.role ?? '';
  if (!STAFF_ROLES.has(role)) return false;
  if (role === 'superadmin') return true;
  const { data: membership } = await admin
    .from('org_members').select('id')
    .eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
  return !!membership;
}

/** Symmetric pair key — always ordered, matching the table's CHECK constraint. */
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function GET(request: NextRequest) {
  const orgId = (request.nextUrl.searchParams.get('org_id') || '').trim();
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });

  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!(await requireStaff(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only live contacts — already-merged ones must never be re-flagged.
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, identity_id, pipeline_stage, source, tags, created_at, last_contacted_at, total_calls, notes')
    .eq('org_id', orgId)
    .is('merged_into_id', null);
  const list = (contacts || []) as ContactLite[];

  const { data: dismissals } = await admin
    .from('contact_dedupe_dismissals')
    .select('contact_a, contact_b')
    .eq('org_id', orgId);
  const dismissed = new Set((dismissals || []).map((d: any) => pairKey(d.contact_a, d.contact_b)));

  // ── Foreign-account-email guard ───────────────────────────────────────────
  // An address that belongs to a Hub login but to a DIFFERENT person than the
  // contact holding it is a contaminant, not an identifier. Real case: two
  // "Hazel Thornton" records both carrying sgranau@gmail.com, which is an
  // account whose profile name is "test test" — someone's test login pasted
  // into client records. Without this guard that pair gets a HIGH badge and a
  // one-click merge path that could fuse two genuinely different clients.
  //
  // Crucially this must NOT exclude every account email: `profiles` holds
  // PARTICIPANTS as well as staff, so most account emails are the client's own
  // (Melissa Allen and Gabriel Robinson both have participant profiles under
  // their real addresses). Excluding those would hide genuine duplicates —
  // a worse failure than surfacing them, because it is invisible.
  //
  // So the test is name agreement, reusing the same threshold: the email is
  // disqualified only when the account's name CONFLICTS with the contact's.
  // Role can't be used to separate these — sgranau is role='participant' too.
  const { data: profileRows } = await admin
    .from('profiles').select('email, full_name').not('email', 'is', null);
  const accountNames = new Map<string, string[]>();
  for (const p of (profileRows || []) as any[]) {
    const e = lowerEmail(p.email);
    if (!e) continue;
    accountNames.set(e, [...(accountNames.get(e) || []), String(p.full_name || '')]);
  }

  const emailKeyOf = (c: ContactLite) => {
    const e = lowerEmail(c.email);
    if (!isUsableEmail(e)) return '';                 // junk / not an address
    const owners = accountNames.get(e);
    if (owners?.length) {
      // Keep the email if it plausibly belongs to this contact; drop it only
      // when it belongs to an account that is clearly somebody else.
      const belongs = owners.some(full => {
        const parts = String(full || '').trim().split(/\s+/);
        const oFirst = parts[0] || '';
        const oLast = parts.slice(1).join(' ');
        return namesAgree(c.first_name, c.last_name, oFirst, oLast);
      });
      if (!belongs) return '';
    }
    return e;
  };

  // Bucket by each signal. `demoted` records why a normally-HIGH bucket must be
  // reviewed by a human instead of offered as one-click.
  const buckets: { signal: Signal; key: string; ids: string[]; demoted?: string }[] = [];
  const group = (signal: Signal, keyOf: (c: ContactLite) => string) => {
    const m = new Map<string, string[]>();
    for (const c of list) {
      const k = keyOf(c);
      if (!k) continue;
      m.set(k, [...(m.get(k) || []), c.id]);
    }
    // Array.from rather than iterating the Map directly — the tsconfig target
    // predates downlevel Map iteration.
    Array.from(m.entries()).forEach(([key, ids]) => {
      if (ids.length > 1) buckets.push({ signal, key, ids });
    });
  };

  group('email', emailKeyOf);
  group('phone', c => digits10(c.phone));
  // identity_id only adds signal beyond `email` when contacts DON'T share an
  // email — i.e. the fuzzy-name pass linked them. Those need human review.
  group('identity', c => (emailKeyOf(c) ? '' : (c.identity_id || '')));
  group('name', c => {
    const n = `${(c.first_name || '').trim().toLowerCase()}|${(c.last_name || '').trim().toLowerCase()}`;
    return n === '|' ? '' : n;
  });

  const byId = new Map(list.map(c => [c.id, c]));

  // Belt-and-braces on top of the account-email guard: a genuine shared personal
  // email between two DIFFERENT real people (a couple, a family address) is rare
  // but real, and must not get a one-click merge. Demote to Review when the names
  // positively conflict. Default is agreement — a missing name is not evidence of
  // a different person.
  for (const b of buckets) {
    if (b.signal !== 'email' && b.signal !== 'phone') continue;
    const members = b.ids.map(id => byId.get(id)).filter(Boolean) as ContactLite[];
    let conflict = '';
    for (let i = 0; i < members.length && !conflict; i++) {
      for (let j = i + 1; j < members.length && !conflict; j++) {
        const x = members[i], y = members[j];
        if (!namesAgree(x.first_name, x.last_name, y.first_name, y.last_name)) {
          conflict = `names differ (${[x.first_name, x.last_name].filter(Boolean).join(' ')} vs ${[y.first_name, y.last_name].filter(Boolean).join(' ')})`;
        }
      }
    }
    if (conflict) b.demoted = conflict;
  }
  const CONFIDENCE: Record<Signal, 'high' | 'review'> = {
    email: 'high', phone: 'high', identity: 'review', name: 'review',
  };

  // Collapse buckets into one group per contact set, keeping the strongest
  // signal. A pair matching on both email and name is one group, not two.
  const groups = new Map<string, { signals: Signal[]; ids: string[]; notes: string[] }>();
  for (const b of buckets) {
    // A group is suppressed only when EVERY pair inside it has been dismissed —
    // dismissing A/B must not hide a genuine A/C duplicate.
    const ids = [...b.ids].sort();
    const pairs: string[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) pairs.push(pairKey(ids[i], ids[j]));
    if (pairs.length && pairs.every(p => dismissed.has(p))) continue;

    const gk = ids.join('|');
    // A demoted bucket contributes its signal for display but must NOT confer
    // high confidence, so it is recorded separately.
    const signalLabel = (b.demoted ? `${b.signal} (review)` : b.signal) as Signal;
    const existing = groups.get(gk);
    if (existing) {
      if (!existing.signals.includes(signalLabel)) existing.signals.push(signalLabel);
      if (b.demoted && !existing.notes.includes(b.demoted)) existing.notes.push(b.demoted);
    } else {
      groups.set(gk, { signals: [signalLabel], ids, notes: b.demoted ? [b.demoted] : [] });
    }
  }

  const result = Array.from(groups.values()).map(g => {
    const members = g.ids
      .map((id: string) => byId.get(id))
      .filter((c): c is ContactLite => !!c)
      .map((c: ContactLite) => ({ ...c, completeness: completeness(c) }));
    members.sort((a, b) => b.completeness - a.completeness);
    // Only an UNDEMOTED email/phone bucket confers high confidence.
    const confidence: 'high' | 'review' =
      g.signals.some((s: Signal) => CONFIDENCE[s] === 'high') ? 'high' : 'review';
    return {
      key: g.ids.join('|'),
      signals: g.signals,
      notes: g.notes,
      confidence,
      // Default survivor = fullest record. The UI may override.
      suggested_winner_id: members[0]?.id ?? null,
      members,
    };
  });

  // High confidence first, then larger groups.
  result.sort((a, b) =>
    (a.confidence === b.confidence ? b.members.length - a.members.length
      : a.confidence === 'high' ? -1 : 1));

  return NextResponse.json({
    groups: result,
    counts: {
      total: result.length,
      high: result.filter(g => g.confidence === 'high').length,
      review: result.filter(g => g.confidence === 'review').length,
      dismissed: dismissed.size,
    },
  });
}

// ─── POST: dismiss a pair as "different people" ───
export async function POST(request: NextRequest) {
  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const orgId = String(body?.org_id || '').trim();
  const ids: string[] = Array.isArray(body?.contact_ids) ? body.contact_ids : [];
  if (!orgId || ids.length < 2) {
    return NextResponse.json({ error: 'org_id and at least two contact_ids are required' }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!(await requireStaff(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Dismiss EVERY pair in the group, each stored ordered so the verdict is
  // symmetric and the unique index makes it idempotent.
  const rows: any[] = [];
  const sorted = [...ids].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      rows.push({
        org_id: orgId,
        contact_a: sorted[i],
        contact_b: sorted[j],
        signal: typeof body?.signal === 'string' ? body.signal : null,
        reason: typeof body?.reason === 'string' ? body.reason : null,
        dismissed_by: user.id,
      });
    }
  }

  const { error } = await admin
    .from('contact_dedupe_dismissals')
    .upsert(rows, { onConflict: 'org_id,contact_a,contact_b', ignoreDuplicates: true });
  if (error) {
    console.error('[contacts/duplicates] dismiss failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pairs_dismissed: rows.length });
}
