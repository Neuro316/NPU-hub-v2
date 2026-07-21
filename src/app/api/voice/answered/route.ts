import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrCreateConversation, bumpConversation, logActivity } from '@/lib/crm-server';

// "Who answered" — posted by the browser that accepts an inbound call.
//
// The shared org identity (org-{orgId}) is what makes multi-staff ringing work
// without presence tracking, but it means the TOKEN can't tell us who picked up.
// So the accepting browser reports itself here.
//
// NOTE ON STORAGE: call_logs has no `called_by` column — its only user column is
// `team_member_id`, which FKs to team_members(id), NOT to auth.users. (The
// outbound voice/token route inserts `called_by` and that field is silently
// discarded — a separate pre-existing bug.) So we set team_member_id when this
// user has a team_members row, and ALWAYS record the answer in crm_activity_log
// with actor_id, which needs no schema change.

export async function POST(request: NextRequest) {
  try {
    const supabaseUser = createServerSupabase();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await request.json(); } catch { /* fall through to validation */ }
    const callSid = String(body?.call_sid || '').trim();
    if (!callSid) return NextResponse.json({ error: 'call_sid required' }, { status: 400 });

    const admin = createAdminSupabase();

    const { data: callLog } = await admin
      .from('call_logs')
      .select('id, org_id, contact_id, status')
      .eq('external_call_sid', callSid)
      .maybeSingle();
    if (!callLog) {
      // The call is real (the browser is on it) but the row may not exist if the
      // inbound insert failed. Don't 500 the answering browser over bookkeeping.
      console.warn('[voice/answered] no call_log for CallSid', callSid);
      return NextResponse.json({ ok: true, matched: false });
    }

    // Membership check against the OWNING org — a staff user of another org must
    // not be able to stamp themselves onto this call.
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role ?? '';
    if (role !== 'superadmin') {
      const { data: membership } = await admin
        .from('org_members').select('id')
        .eq('organization_id', callLog.org_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: teamMember } = await admin
      .from('team_members').select('id')
      .eq('user_id', user.id)
      .eq('org_id', callLog.org_id)
      .maybeSingle();

    await admin
      .from('call_logs')
      .update({
        status: 'answered',
        ...(teamMember?.id ? { team_member_id: teamMember.id } : {}),
      })
      .eq('id', callLog.id);

    if (callLog.contact_id) {
      try {
        const conversation = await getOrCreateConversation(
          admin, callLog.contact_id, 'voice', callLog.org_id
        );
        await bumpConversation(admin, conversation.id, {
          preview: '\u{1F4DE} Call answered',
          direction: 'inbound',
          incrementUnread: false,   // answered in person — nothing left unread
        });
        await logActivity(admin, {
          contact_id: callLog.contact_id,
          org_id: callLog.org_id,
          event_type: 'call_answered',
          event_data: { call_sid: callSid, answered_by: user.id },
          ref_table: 'call_logs',
          ref_id: callLog.id,
          actor_id: user.id,
        });
      } catch (e) {
        console.warn('[voice/answered] conversation/activity update skipped:', e);
      }
    }

    return NextResponse.json({ ok: true, matched: true });
  } catch (e: any) {
    console.error('[voice/answered] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
