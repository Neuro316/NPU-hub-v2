import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, generateOrgVoiceToken } from '@/lib/twilio-org';
import { receiverIdentity } from '@/lib/voice-identity';

// Receiver token for the browser softphone (NPU Hub — Stage 2).
//
// Distinct from /api/voice/token, which is an outbound CALL INITIATOR: it
// requires contact_id, runs a DNC check, resolves caller ID from the contact's
// pipeline stage, inserts an outbound call_logs row and bumps the contact's call
// counters. None of that applies to receiving a call from someone who may not be
// a contact at all — so this is a separate route and voice/token is left alone.
//
// The grant itself needs no new code: generateOrgVoiceToken already sets
// incomingAllow: true. It also references the org's existing twiml_app_sid as
// outgoingApplicationSid — a READ of the config, no change to the TwiML App.
//
// Identity comes from receiverIdentity() — the same helper the inbound TwiML
// imports to build its <Client> target. Never spell the identity here.

// Comms staff (067 policy shape). facilitator can answer calls; participants
// never register a receiver.
const STAFF_ROLES = new Set(['admin', 'superadmin', 'facilitator']);

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await request.json(); } catch { /* org_id may be absent */ }
    const orgId = String(body?.org_id || '').trim();
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

    const admin = createAdminSupabase();

    // Staff gate + org membership (superadmin short-circuits, 067 shape).
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role ?? '';
    if (!STAFF_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (role !== 'superadmin') {
      const { data: membership } = await admin
        .from('org_members').select('id')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
      }
    }

    const config = await getOrgTwilioConfig(admin, orgId);
    if (!config.api_key || !config.api_secret || !config.twiml_app_sid) {
      const missing: string[] = [];
      if (!config.api_key) missing.push('API Key');
      if (!config.api_secret) missing.push('API Secret');
      if (!config.twiml_app_sid) missing.push('TwiML App SID');
      return NextResponse.json(
        { error: `Browser calling not configured. Missing: ${missing.join(', ')}.` },
        { status: 400 }
      );
    }

    const identity = receiverIdentity(orgId);

    let token: string;
    try {
      token = generateOrgVoiceToken(config, identity);
    } catch (e: any) {
      return NextResponse.json({ error: `Token failed: ${e.message}` }, { status: 500 });
    }

    // AccessToken TTL is the Twilio default (3600s). The provider refreshes on
    // the SDK's tokenWillExpire event rather than trusting this number, but it
    // is returned so the client can show how long the session is good for.
    return NextResponse.json({ token, identity, ttl_seconds: 3600 });
  } catch (e: any) {
    console.error('[voice/receiver-token] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}
