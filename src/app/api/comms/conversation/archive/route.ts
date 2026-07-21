import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';

// Remove a conversation from the Conversations list — WITHOUT deleting anything
// from the CRM.
//
// ── THE GUARANTEE ────────────────────────────────────────────────────────────
// This route touches exactly ONE column: conversations.status. It does not
// reference contacts, call_logs, or crm_messages at all — no delete, no update,
// no cascade. The contact stays in Contacts, its calls/voicemails stay in
// call_logs, its texts stay in crm_messages, and the whole thread is still
// readable from the contact record. Only its position in the Conversations pane
// changes.
//
// status='closed' (not 'archived'): the live CHECK constraint on conversations
// allows only open|snoozed|closed, so 'archived' is REJECTED by Postgres. The
// old browser-side archive button wrote 'archived' and never checked the error,
// which is why archiving silently did nothing.
//
// Un-archiving is automatic: bumpConversation() resets status to 'open' on
// inbound activity, so the thread returns if that number contacts again.

const STAFF_ROLES = new Set(['admin', 'superadmin', 'facilitator']);

export async function POST(request: NextRequest) {
  try {
    const supabaseUser = createServerSupabase();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await request.json(); } catch { /* validated below */ }
    const conversationId = String(body?.conversation_id || '').trim();
    const archived = body?.archived !== false;   // default: archive
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
    }

    const admin = createAdminSupabase();

    // Read the OWNING org off the conversation and gate against it — never trust
    // an org id from the client.
    const { data: conversation } = await admin
      .from('conversations')
      .select('id, org_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role ?? '';
    if (!STAFF_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (role !== 'superadmin') {
      const { data: membership } = await admin
        .from('org_members').select('id')
        .eq('organization_id', conversation.org_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The ONLY write in this route.
    const { error } = await admin
      .from('conversations')
      .update({ status: archived ? 'closed' : 'open' })
      .eq('id', conversationId);

    if (error) {
      // Surfaced, not swallowed — the bug being fixed here was an unchecked error.
      console.error('[comms/conversation/archive] update failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, archived });
  } catch (e: any) {
    console.error('[comms/conversation/archive] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
