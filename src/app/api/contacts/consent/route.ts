import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { applyAutoAssignment } from '@/lib/crm-server';

// Public endpoint — no auth required
export async function POST(request: NextRequest) {
  const supabase = createAdminSupabase();
  const { org_id, phone, email, sms_consent, email_consent, source, first_name, last_name } = await request.json();

  if (!org_id || (!phone && !email)) {
    return NextResponse.json({ error: 'org_id and phone or email required' }, { status: 400 });
  }

  // Find existing contact
  let query = supabase.from('contacts').select('*').eq('org_id', org_id).is('merged_into_id', null);
  if (phone) query = query.eq('phone', phone);
  else if (email) query = query.eq('email', email);

  const { data: existing } = await query.single();

  if (existing) {
    // Update consent
    const updates: Record<string, unknown> = {};
    if (sms_consent !== undefined) updates.sms_consent = sms_consent;
    if (email_consent !== undefined) {
      updates.email_consent = email_consent;
      if (email_consent) updates.email_consent_at = new Date().toISOString();
    }
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;

    await supabase.from('contacts').update(updates).eq('id', existing.id);
    return NextResponse.json({ success: true, contact_id: existing.id, action: 'updated' });
  }

  // Create new contact
  const assignedTo = await applyAutoAssignment(supabase, org_id, { source, tags: [] });

  const { data: contact } = await supabase
    .from('contacts')
    .insert({
      org_id,
      first_name: first_name || 'Unknown',
      last_name: last_name || (phone || email || 'Contact'),
      phone: phone || null,
      email: email || null,
      sms_consent: sms_consent || false,
      email_consent: email_consent || false,
      email_consent_at: email_consent ? new Date().toISOString() : null,
      source: source || 'consent_form',
      assigned_to: assignedTo,
    })
    .select()
    .single();

  return NextResponse.json({ success: true, contact_id: contact?.id, action: 'created' });
}
