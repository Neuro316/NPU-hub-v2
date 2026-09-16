import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, getVoiceCallerId } from '@/lib/twilio-org';
import { toE164 } from '@/lib/phone';

// The org's phone LINES, for the Conversations line dropdown, the timeline
// badges and the incoming-call modal.
//
// Why a route: the numbers live in org_settings.crm_twilio next to the
// account credentials, which org-settings-keys.ts classifies as
// credential-bearing (admin-only). Facilitators use Conversations, so the
// browser must never read crm_twilio directly. This returns ONLY the
// non-secret shape of each number, gated like caller-lookup (staff role +
// membership).
//
// default_line is resolved server-side with getVoiceCallerId so the client
// never re-implements the caller-ID chain; NULL line_e164 on a thread means
// "this line".

const STAFF_ROLES = new Set(['admin', 'superadmin', 'facilitator']);

export interface OrgLine {
  phone: string;      // E.164
  nickname: string;
  purpose: string;
  forwards: boolean;  // has a forward_number
}

export async function GET(request: NextRequest) {
  const orgId = (request.nextUrl.searchParams.get('org_id') || '').trim();
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });

  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role ?? '';
  if (!STAFF_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (role !== 'superadmin') {
    const { data: membership } = await admin
      .from('org_members').select('id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await getOrgTwilioConfig(admin, orgId);
  const lines: OrgLine[] = (config.numbers || [])
    .filter(n => toE164(String(n?.phone || '')))
    .map(n => ({
      phone: toE164(n.phone),
      nickname: String(n.nickname || '').trim(),
      purpose: String(n.purpose || ''),
      forwards: !!String(n.forward_number || '').trim(),
    }));
  const defaultLine = toE164(getVoiceCallerId(config)) || null;

  return NextResponse.json({ default_line: defaultLine, lines });
}
