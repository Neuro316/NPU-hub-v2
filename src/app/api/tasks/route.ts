import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { org_id, contact_id, title, description, priority, assigned_to, source, source_ref_id, due_date } = body;

  if (!org_id || !title || !assigned_to) {
    return NextResponse.json({ error: 'org_id, title, and assigned_to required' }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      org_id,
      contact_id: contact_id || null,
      title,
      description: description || null,
      priority: priority || 'medium',
      assigned_to,
      created_by: user.id,
      source: source || 'manual',
      source_ref_id: source_ref_id || null,
      due_date: due_date || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity if contact linked
  if (contact_id) {
    await logActivity(supabase, {
      contact_id,
      org_id,
      event_type: 'task_created',
      event_data: { title, priority, assigned_to, source },
      ref_table: 'tasks',
      ref_id: task?.id,
      actor_id: user.id,
    });
  }

  // Emit webhook
  await emitWebhookEvent(supabase, org_id, 'task.created', {
    task_id: task?.id, title, assigned_to, contact_id,
  });

  return NextResponse.json({ success: true, task });
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Task id required' }, { status: 400 });

  // If marking done, set completed_at
  if (updates.status === 'done') {
    updates.completed_at = new Date().toISOString();
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select('*, contacts(org_id)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log completion
  if (updates.status === 'done' && task?.contact_id) {
    const orgId = (task as any).contacts?.org_id;
    if (orgId) {
      await logActivity(supabase, {
        contact_id: task.contact_id,
        org_id: orgId,
        event_type: 'task_completed',
        event_data: { title: task.title },
        ref_table: 'tasks',
        ref_id: task.id,
        actor_id: user.id,
      });
    }
  }

  return NextResponse.json({ success: true, task });
}
