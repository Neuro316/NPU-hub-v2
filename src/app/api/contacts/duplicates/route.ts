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

  // Bucket by each signal.
  const buckets: { signal: Signal; key: string; ids: string[] }[] = [];
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

  group('email', c => lowerEmail(c.email));
  group('phone', c => digits10(c.phone));
  // identity_id only adds signal beyond `email` when contacts DON'T share an
  // email — i.e. the fuzzy-name pass linked them. Those need human review.
  group('identity', c => (lowerEmail(c.email) ? '' : (c.identity_id || '')));
  group('name', c => {
    const n = `${(c.first_name || '').trim().toLowerCase()}|${(c.last_name || '').trim().toLowerCase()}`;
    return n === '|' ? '' : n;
  });

  const byId = new Map(list.map(c => [c.id, c]));
  const CONFIDENCE: Record<Signal, 'high' | 'review'> = {
    email: 'high', phone: 'high', identity: 'review', name: 'review',
  };

  // Collapse buckets into one group per contact set, keeping the strongest
  // signal. A pair matching on both email and name is one group, not two.
  const groups = new Map<string, { signals: Signal[]; ids: string[] }>();
  for (const b of buckets) {
    // A group is suppressed only when EVERY pair inside it has been dismissed —
    // dismissing A/B must not hide a genuine A/C duplicate.
    const ids = [...b.ids].sort();
    const pairs: string[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) pairs.push(pairKey(ids[i], ids[j]));
    if (pairs.length && pairs.every(p => dismissed.has(p))) continue;

    const gk = ids.join('|');
    const existing = groups.get(gk);
    if (existing) {
      if (!existing.signals.includes(b.signal)) existing.signals.push(b.signal);
    } else {
      groups.set(gk, { signals: [b.signal], ids });
    }
  }

  const result = Array.from(groups.values()).map(g => {
    const members = g.ids
      .map((id: string) => byId.get(id))
      .filter((c): c is ContactLite => !!c)
      .map((c: ContactLite) => ({ ...c, completeness: completeness(c) }));
    members.sort((a, b) => b.completeness - a.completeness);
    const confidence: 'high' | 'review' =
      g.signals.some((s: Signal) => CONFIDENCE[s] === 'high') ? 'high' : 'review';
    return {
      key: g.ids.join('|'),
      signals: g.signals,
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
