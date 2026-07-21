import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { findContactByPhoneNormalized } from '@/lib/crm-server';

// Who is calling? Resolves an inbound caller's number to a contact for the
// ringing modal, using the SAME normalized last-10 match (069 rpc) the inbound
// webhook uses — so the name on the modal agrees with the contact the call is
// actually threaded to. Exact-match would miss contacts stored as "18287347558"
// when Twilio sends "+18287347558".
//
// Staff + membership gated: this turns a phone number into a person's name, so
// it is not open to any authenticated user.

const STAFF_ROLES = new Set(['admin', 'superadmin', 'facilitator']);

export async function GET(request: NextRequest) {
  const orgId = (request.nextUrl.searchParams.get('org_id') || '').trim();
  const phone = (request.nextUrl.searchParams.get('phone') || '').trim();
  if (!orgId || !phone) {
    return NextResponse.json({ error: 'org_id and phone are required' }, { status: 400 });
  }

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

  const contact = await findContactByPhoneNormalized(admin, orgId, phone);
  if (!contact) return NextResponse.json({ contact: null });

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return NextResponse.json({
    contact: {
      id: contact.id,
      name: name || null,
      // The inbound webhook creates placeholder "Unknown" contacts for callers
      // with no record; flag it so the modal shows the number, not "Unknown".
      is_placeholder: (contact.first_name || '') === 'Unknown',
    },
  });
}
