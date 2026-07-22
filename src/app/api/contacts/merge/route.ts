import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { logActivity } from '@/lib/crm-server';
import { ADMIN_ROLES } from '@/lib/org-settings-keys';

// ─── POST /api/contacts/merge ───
// Soft-merge one contact into another. The loser keeps its row and becomes
// invisible via merged_into_id (~15 read paths already filter
// `.is('merged_into_id', null)`), so a merge is reversible.
//
// ── WHAT WAS BROKEN BEFORE (all three fixed here) ───────────────────────────
// 1. NO SNAPSHOT. It inserted `surviving_contact_id` / `merged_contact_id` /
//    `merged_contact_snapshot` into contact_merge_log. Those columns DO NOT
//    EXIST — the real ones are (org_id, winner_id, loser_id, merged_by,
//    merge_details). The error was never checked, so the insert failed silently
//    on every merge and the "reversible" guarantee was fiction. Any merge done
//    through the UI before 2026-07-22 has no recoverable snapshot.
// 2. PARTIAL REPOINT. A hand-written list of 9 tables against ~60
//    contact-referencing columns, so merges stranded records on a hidden
//    contact. Now delegated to merge_contact_repoint() (migration 073), which
//    enumerates information_schema — the only way to catch call_logs.contact_id,
//    which has no FK at all.
// 3. NO ROLE GATE. Only `getUser()`, so any authenticated user could merge
//    contacts. Now admin-gated against the OWNING org.
//
// Field-level "merge toward the fuller record" is deliberately NOT decided here.
// The caller passes `winner_updates` with the fields it chose; this route only
// applies them. Policy lives in the review UI, mechanism lives here.

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await request.json(); } catch { /* validated below */ }
    const winnerId = String(body?.surviving_contact_id || '').trim();
    const loserId  = String(body?.merging_contact_id || '').trim();
    const winnerUpdates = (body?.winner_updates && typeof body.winner_updates === 'object' && !Array.isArray(body.winner_updates))
      ? body.winner_updates as Record<string, unknown>
      : null;

    if (!winnerId || !loserId) {
      return NextResponse.json({ error: 'surviving_contact_id and merging_contact_id are required' }, { status: 400 });
    }
    if (winnerId === loserId) {
      return NextResponse.json({ error: 'Cannot merge a contact into itself' }, { status: 400 });
    }

    const admin = createAdminSupabase();

    const { data: winner } = await admin
      .from('contacts').select('*').eq('id', winnerId).maybeSingle();
    const { data: loser } = await admin
      .from('contacts').select('*').eq('id', loserId).maybeSingle();
    if (!winner || !loser) {
      return NextResponse.json({ error: 'Contact(s) not found' }, { status: 404 });
    }
    if (winner.org_id !== loser.org_id) {
      return NextResponse.json({ error: 'Contacts belong to different organizations' }, { status: 400 });
    }
    if (loser.merged_into_id) {
      return NextResponse.json({ error: 'That contact has already been merged' }, { status: 409 });
    }
    if (winner.merged_into_id) {
      return NextResponse.json({ error: 'The surviving contact has itself been merged away' }, { status: 409 });
    }

    // ── Staff gate against the OWNING org (067 shape) ──────────────────────
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role ?? '';
    if (role !== 'superadmin') {
      if (!ADMIN_ROLES.has(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const { data: membership } = await admin
        .from('org_members').select('id')
        .eq('organization_id', winner.org_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
      }
    }

    // ── 1. Snapshot FIRST, with the real columns, and CHECK the error ───────
    // Written before anything is repointed so the record exists even if a later
    // step fails. This is the reversibility guarantee — if it can't be written,
    // the merge does not proceed.
    const { error: logError } = await admin.from('contact_merge_log').insert({
      org_id: winner.org_id,
      winner_id: winnerId,
      loser_id: loserId,
      merged_by: user.id,
      merge_details: {
        reason: typeof body?.reason === 'string' ? body.reason : 'manual merge',
        loser_snapshot: loser,
        winner_snapshot_before: winner,
      },
    });
    if (logError) {
      console.error('[contacts/merge] snapshot failed, aborting:', logError);
      return NextResponse.json(
        { error: `Could not write the merge snapshot, so the merge was not performed: ${logError.message}` },
        { status: 500 }
      );
    }

    // ── 2. Repoint EVERY contact-referencing column (migration 073) ─────────
    const { data: repoint, error: repointError } = await admin.rpc('merge_contact_repoint', {
      p_loser: loserId,
      p_winner: winnerId,
    });
    if (repointError) {
      console.error('[contacts/merge] repoint failed:', repointError);
      return NextResponse.json(
        { error: `Repoint failed, contact not merged: ${repointError.message}` },
        { status: 500 }
      );
    }

    // ── 3. Union tags, then apply the caller's chosen field values ──────────
    const mergedTags = Array.from(new Set([...(winner.tags || []), ...(loser.tags || [])]));
    const updates: Record<string, unknown> = { tags: mergedTags };

    if (winnerUpdates) {
      // Only fields that exist on the winner row may be set, and never these.
      const BLOCKED = new Set(['id', 'org_id', 'created_at', 'merged_into_id', 'identity_id']);
      for (const [k, v] of Object.entries(winnerUpdates)) {
        if (!BLOCKED.has(k) && k in winner) updates[k] = v;
      }
    }

    const { error: winnerError } = await admin
      .from('contacts').update(updates).eq('id', winnerId);
    if (winnerError) {
      console.error('[contacts/merge] winner update failed:', winnerError);
      return NextResponse.json({ error: winnerError.message }, { status: 500 });
    }

    // ── 4. Soft-delete the loser ───────────────────────────────────────────
    const { error: loserError } = await admin.from('contacts').update({
      merged_into_id: winnerId,
      do_not_contact: true,
    }).eq('id', loserId);
    if (loserError) {
      console.error('[contacts/merge] soft-delete failed:', loserError);
      return NextResponse.json({ error: loserError.message }, { status: 500 });
    }

    await logActivity(admin, {
      contact_id: winnerId,
      org_id: winner.org_id,
      event_type: 'contact_merged',
      event_data: {
        merged_contact_id: loserId,
        merged_name: `${loser.first_name || ''} ${loser.last_name || ''}`.trim(),
        repointed: (repoint as any)?.repointed ?? null,
        rows_repointed: (repoint as any)?.total ?? 0,
      },
      ref_table: 'contacts',
      ref_id: loserId,
      actor_id: user.id,
    });

    return NextResponse.json({
      success: true,
      winner_id: winnerId,
      loser_id: loserId,
      repointed: (repoint as any)?.repointed ?? {},
      rows_repointed: (repoint as any)?.total ?? 0,
    });
  } catch (e: any) {
    console.error('[contacts/merge] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
