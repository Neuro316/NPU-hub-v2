import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// ═══════════════════════════════════════════════════════════════
// CRM Task ↔ Hub Kanban Sync
// POST: Push CRM task → kanban_tasks
// PUT:  Pull kanban_tasks changes → CRM task
// ═══════════════════════════════════════════════════════════════

// Map CRM status → hub column title
const STATUS_TO_COLUMN: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Done',
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { task_id } = await request.json()
    if (!task_id) return NextResponse.json({ error: 'task_id required' }, { status: 400 })

    // Fetch CRM task
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*, contacts(first_name, last_name)')
      .eq('id', task_id)
      .single()
    if (taskErr || !task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Find the matching hub column by title
    const targetTitle = STATUS_TO_COLUMN[task.status] || 'To Do'
    const { data: columns } = await supabase
      .from('kanban_columns')
      .select('id, title')
      .eq('org_id', task.org_id)
      .order('sort_order')

    let columnId = columns?.find(c => c.title === targetTitle)?.id
    if (!columnId && columns?.length) columnId = columns[0].id
    if (!columnId) return NextResponse.json({ error: 'No kanban columns found. Create columns in the Tasks board first.' }, { status: 400 })

    // Build hub task data
    const contactName = task.contacts ? `${task.contacts.first_name} ${task.contacts.last_name}` : null
    const hubData: any = {
      org_id: task.org_id,
      column_id: columnId,
      title: task.title,
      description: task.description || null,
      assignee: task.assigned_member?.display_name || null,
      priority: task.priority,
      due_date: task.due_date,
      sort_order: task.kanban_order || 0,
      custom_fields: {
        crm_task_id: task.id,
        contact_name: contactName,
        contact_id: task.contact_id,
        raci: {
          responsible: task.raci_responsible || [],
          accountable: task.raci_accountable || null,
          consulted: task.raci_consulted || [],
          informed: task.raci_informed || [],
        },
        labels: task.labels || [],
        checklist: task.checklist || [],
        estimated_minutes: task.estimated_minutes,
        actual_minutes: task.actual_minutes,
      },
    }

    let hubTaskId = task.hub_task_id

    if (hubTaskId) {
      // Update existing hub task
      const { error: updErr } = await supabase
        .from('kanban_tasks')
        .update({ ...hubData, updated_at: new Date().toISOString() })
        .eq('id', hubTaskId)
      if (updErr) return NextResponse.json({ error: `Hub update failed: ${updErr.message}` }, { status: 500 })
    } else {
      // Create new hub task
      const { data: newTask, error: insErr } = await supabase
        .from('kanban_tasks')
        .insert(hubData)
        .select('id')
        .single()
      if (insErr) return NextResponse.json({ error: `Hub create failed: ${insErr.message}` }, { status: 500 })
      hubTaskId = newTask.id
    }

    // Update CRM task with hub link
    await supabase.from('tasks').update({
      hub_task_id: hubTaskId,
      last_synced_at: new Date().toISOString(),
    }).eq('id', task_id)

    return NextResponse.json({ success: true, hub_task_id: hubTaskId })
  } catch (e: any) {
    console.error('Task sync error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}

// Reverse sync: Hub → CRM
export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { hub_task_id } = await request.json()
    if (!hub_task_id) return NextResponse.json({ error: 'hub_task_id required' }, { status: 400 })

    // Fetch hub task
    const { data: hubTask } = await supabase
      .from('kanban_tasks')
      .select('*, kanban_columns!inner(title)')
      .eq('id', hub_task_id)
      .single()
    if (!hubTask) return NextResponse.json({ error: 'Hub task not found' }, { status: 404 })

    const crmTaskId = hubTask.custom_fields?.crm_task_id
    if (!crmTaskId) return NextResponse.json({ error: 'Hub task not linked to CRM' }, { status: 400 })

    // Map column title → CRM status
    const colTitle = (hubTask.kanban_columns as any)?.title || ''
    const COLUMN_TO_STATUS: Record<string, string> = {
      'To Do': 'todo', 'Backlog': 'todo',
      'In Progress': 'in_progress', 'Review': 'in_progress',
      'Done': 'done', 'Archived': 'done',
    }
    const newStatus = COLUMN_TO_STATUS[colTitle] || 'todo'

    // Pull RACI from custom_fields if present
    const raci = hubTask.custom_fields?.raci || {}
    const updates: any = {
      title: hubTask.title,
      description: hubTask.description,
      priority: hubTask.priority,
      due_date: hubTask.due_date,
      status: newStatus,
      last_synced_at: new Date().toISOString(),
    }
    if (raci.responsible) updates.raci_responsible = raci.responsible
    if (raci.accountable) updates.raci_accountable = raci.accountable
    if (raci.consulted) updates.raci_consulted = raci.consulted
    if (raci.informed) updates.raci_informed = raci.informed
    if (hubTask.custom_fields?.labels) updates.labels = hubTask.custom_fields.labels
    if (hubTask.custom_fields?.checklist) updates.checklist = hubTask.custom_fields.checklist

    const { error } = await supabase.from('tasks').update(updates).eq('id', crmTaskId)
    if (error) return NextResponse.json({ error: `CRM update failed: ${error.message}` }, { status: 500 })

    return NextResponse.json({ success: true, crm_task_id: crmTaskId })
  } catch (e: any) {
    console.error('Reverse sync error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
