import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get user's org
  const { data: membership } = await supabase
    .from('team_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const orgId = membership.org_id;

  try {
    // Fetch all CRM tables in parallel
    const [
      contacts, tasks, callLogs, conversations, messages,
      campaigns, notes, activityLog, orgSettings,
      emailConfigs, sequences, tags
    ] = await Promise.all([
      supabase.from('contacts').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('crm_tasks').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('call_logs').select('*').then(r => r.data || []),
      supabase.from('conversations').select('*').then(r => r.data || []),
      supabase.from('crm_messages').select('*').then(r => r.data || []),
      supabase.from('campaigns').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('contact_notes').select('*').then(r => r.data || []),
      supabase.from('crm_activity_log').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('org_settings').select('*').eq('org_id', orgId).then(r => {
        // Redact sensitive keys
        return (r.data || []).map(s => {
          if (s.setting_key === 'crm_twilio') {
            const v = { ...s.setting_value };
            if (v.auth_token) v.auth_token = '***REDACTED***';
            if (v.api_secret) v.api_secret = '***REDACTED***';
            return { ...s, setting_value: v };
          }
          return s;
        });
      }),
      supabase.from('org_email_configs').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('sequences').select('*').eq('org_id', orgId).then(r => r.data || []),
      supabase.from('tags').select('*').eq('org_id', orgId).then(r => r.data || []),
    ]);

    const backup = {
      meta: {
        org_id: orgId,
        exported_at: new Date().toISOString(),
        exported_by: user.id,
        version: '1.0',
      },
      counts: {
        contacts: contacts.length,
        tasks: tasks.length,
        call_logs: callLogs.length,
        conversations: conversations.length,
        messages: messages.length,
        campaigns: campaigns.length,
        notes: notes.length,
        activity_log: activityLog.length,
        settings: orgSettings.length,
        sequences: sequences.length,
        tags: tags.length,
      },
      data: {
        contacts,
        tasks,
        call_logs: callLogs,
        conversations,
        messages,
        campaigns,
        notes,
        activity_log: activityLog,
        org_settings: orgSettings,
        email_configs: emailConfigs,
        sequences,
        tags,
      },
    };

    const json = JSON.stringify(backup, null, 2);
    const filename = `npu-crm-backup-${new Date().toISOString().split('T')[0]}.json`;

    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error('Backup error:', e);
    return NextResponse.json({ error: e.message || 'Backup failed' }, { status: 500 });
  }
}
