import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

// GET /api/tasks/dependencies?task_id=XXX — get all dependencies for a task
export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get('task_id')
    if (!taskId) return NextResponse.json({ error: 'task_id required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('task_dependencies')
      .select('*, blocker_task:kanban_tasks!blocker_task_id(id, title, assignee, column_id, priority), blocked_task:kanban_tasks!blocked_task_id(id, title, assignee, column_id, priority)')
      .or(`blocker_task_id.eq.${taskId},blocked_task_id.eq.${taskId}`)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      blocks: (data || []).filter(d => d.blocker_task_id === taskId),
      blocked_by: (data || []).filter(d => d.blocked_task_id === taskId),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/tasks/dependencies — create a dependency
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    const { blocker_task_id, blocked_task_id, dependency_type } = await req.json()
    if (!blocker_task_id || !blocked_task_id) {
      return NextResponse.json({ error: 'blocker_task_id and blocked_task_id required' }, { status: 400 })
    }

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('task_dependencies')
      .insert({
        blocker_task_id,
        blocked_task_id,
        dependency_type: dependency_type || 'blocks',
        created_by: user?.id || null,
      })
      .select().single()

    if (error) {
      if (error.message.includes('Circular dependency')) {
        return NextResponse.json({ error: 'Cannot create circular dependency' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Update cached counts on both tasks
    await admin.from('kanban_tasks').update({
      blocks_count: (await admin.from('task_dependencies').select('id', { count: 'exact', head: true }).eq('blocker_task_id', blocker_task_id).eq('dependency_type', 'blocks')).count || 0,
    }).eq('id', blocker_task_id)

    await admin.from('kanban_tasks').update({
      blocked_by_count: (await admin.from('task_dependencies').select('id', { count: 'exact', head: true }).eq('blocked_task_id', blocked_task_id).eq('dependency_type', 'blocks')).count || 0,
    }).eq('id', blocked_task_id)

    return NextResponse.json({ dependency: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/tasks/dependencies?id=XXX — remove a dependency
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Get the dependency first to update counts
    const { data: dep } = await admin.from('task_dependencies').select('*').eq('id', id).single()
    if (!dep) return NextResponse.json({ error: 'Dependency not found' }, { status: 404 })

    await admin.from('task_dependencies').delete().eq('id', id)

    // Update cached counts
    const { count: blocksCount } = await admin.from('task_dependencies').select('id', { count: 'exact', head: true }).eq('blocker_task_id', dep.blocker_task_id).eq('dependency_type', 'blocks')
    await admin.from('kanban_tasks').update({ blocks_count: blocksCount || 0 }).eq('id', dep.blocker_task_id)

    const { count: blockedCount } = await admin.from('task_dependencies').select('id', { count: 'exact', head: true }).eq('blocked_task_id', dep.blocked_task_id).eq('dependency_type', 'blocks')
    await admin.from('kanban_tasks').update({ blocked_by_count: blockedCount || 0 }).eq('id', dep.blocked_task_id)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
