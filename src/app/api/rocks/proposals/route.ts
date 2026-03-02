import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - list proposals for a rock or batch
export async function GET(req: NextRequest) {
  const rockId = req.nextUrl.searchParams.get('rock_id')
  const batchId = req.nextUrl.searchParams.get('batch_id')
  const status = req.nextUrl.searchParams.get('status')

  let query = supabase.from('rock_task_proposals').select('*').order('sequence_order')

  if (rockId) query = query.eq('rock_id', rockId)
  if (batchId) query = query.eq('batch_id', batchId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposals: data })
}

// POST - create proposals from AI analysis OR approve batch
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'create_proposals') {
    return handleCreateProposals(body)
  }

  if (action === 'approve_batch') {
    return handleApproveBatch(body)
  }

  if (action === 'approve_one') {
    return handleApproveOne(body)
  }

  if (action === 'reject') {
    return handleReject(body)
  }

  if (action === 'modify') {
    return handleModify(body)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

async function handleCreateProposals(body: any) {
  const { org_id, rock_id, rock_title, tasks, batch_id } = body

  if (!org_id || !rock_id || !tasks?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const proposals = tasks.map((t: any, i: number) => ({
    org_id,
    rock_id,
    title: t.title,
    description: t.description || null,
    priority: t.priority || 'medium',
    estimated_hours: t.estimated_hours || null,
    sequence_order: t.sequence_order ?? i + 1,
    raci_responsible: t.raci?.responsible || null,
    raci_accountable: t.raci?.accountable || null,
    raci_consulted: t.raci?.consulted ? [t.raci.consulted] : [],
    raci_informed: t.raci?.informed ? [t.raci.informed] : [],
    rationale: t.rationale || null,
    status: 'pending',
    batch_id: batch_id || `batch-${Date.now()}`,
  }))

  const { data, error } = await supabase
    .from('rock_task_proposals')
    .insert(proposals)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposals: data, batch_id: proposals[0].batch_id })
}

async function handleApproveBatch(body: any) {
  const { batch_id, org_id, rock_id, default_column_id, approved_by } = body

  if (!batch_id || !org_id || !default_column_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Get all pending proposals in batch
  const { data: proposals, error: fetchErr } = await supabase
    .from('rock_task_proposals')
    .select('*')
    .eq('batch_id', batch_id)
    .eq('status', 'pending')
    .order('sequence_order')

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!proposals?.length) return NextResponse.json({ message: 'No pending proposals', created: 0 })

  // Get rock info for tags
  const { data: rock } = await supabase
    .from('rocks')
    .select('title, color')
    .eq('id', rock_id)
    .single()

  const rockTag = rock?.title || 'Unknown Rock'
  const results: any[] = []

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]

    // Create kanban task with full RACI + metadata
    const { data: task, error: insertErr } = await supabase
      .from('kanban_tasks')
      .insert({
        org_id,
        column_id: default_column_id,
        title: p.title,
        description: p.description,
        priority: p.priority,
        rock_id: rock_id,
        source: 'ai_proposal',
        sort_order: i,
        visibility: 'everyone',
        raci_responsible: p.raci_responsible,
        raci_accountable: p.raci_accountable,
        raci_consulted: p.raci_consulted || [],
        raci_informed: p.raci_informed || [],
        rock_tags: [rockTag],
        estimated_hours: p.estimated_hours,
        sequence_order: p.sequence_order,
        ai_generated: true,
        approved_at: new Date().toISOString(),
        approved_by: approved_by || null,
        custom_fields: {
          raci_responsible: p.raci_responsible,
          raci_accountable: p.raci_accountable,
          raci_consulted: p.raci_consulted?.[0] || null,
          raci_informed: p.raci_informed?.[0] || null,
        },
      })
      .select('id')
      .single()

    if (insertErr) {
      results.push({ proposal_id: p.id, status: 'error', error: insertErr.message })
      continue
    }

    // Update proposal status
    await supabase
      .from('rock_task_proposals')
      .update({ status: 'approved', created_task_id: task?.id, updated_at: new Date().toISOString() })
      .eq('id', p.id)

    results.push({ proposal_id: p.id, task_id: task?.id, status: 'created' })
  }

  const created = results.filter(r => r.status === 'created').length
  return NextResponse.json({ created, total: proposals.length, results })
}

async function handleApproveOne(body: any) {
  const { proposal_id, org_id, rock_id, default_column_id, approved_by } = body

  const { data: p, error: fetchErr } = await supabase
    .from('rock_task_proposals')
    .select('*')
    .eq('id', proposal_id)
    .single()

  if (fetchErr || !p) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const { data: rock } = await supabase
    .from('rocks')
    .select('title')
    .eq('id', p.rock_id)
    .single()

  const { data: task, error: insertErr } = await supabase
    .from('kanban_tasks')
    .insert({
      org_id: p.org_id,
      column_id: default_column_id,
      title: p.title,
      description: p.description,
      priority: p.priority,
      rock_id: p.rock_id,
      source: 'ai_proposal',
      sort_order: p.sequence_order || 0,
      visibility: 'everyone',
      raci_responsible: p.raci_responsible,
      raci_accountable: p.raci_accountable,
      raci_consulted: p.raci_consulted || [],
      raci_informed: p.raci_informed || [],
      rock_tags: [rock?.title || ''],
      estimated_hours: p.estimated_hours,
      sequence_order: p.sequence_order,
      ai_generated: true,
      approved_at: new Date().toISOString(),
      approved_by: approved_by || null,
      custom_fields: {
        raci_responsible: p.raci_responsible,
        raci_accountable: p.raci_accountable,
        raci_consulted: p.raci_consulted?.[0] || null,
        raci_informed: p.raci_informed?.[0] || null,
      },
    })
    .select('id')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  await supabase
    .from('rock_task_proposals')
    .update({ status: 'approved', created_task_id: task?.id, updated_at: new Date().toISOString() })
    .eq('id', proposal_id)

  return NextResponse.json({ task_id: task?.id, status: 'created' })
}

async function handleReject(body: any) {
  const { proposal_id } = body
  const { error } = await supabase
    .from('rock_task_proposals')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', proposal_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ status: 'rejected' })
}

async function handleModify(body: any) {
  const { proposal_id, updates } = body
  const allowed = ['title', 'description', 'priority', 'estimated_hours', 'raci_responsible',
    'raci_accountable', 'raci_consulted', 'raci_informed', 'sequence_order']

  const filtered: Record<string, any> = {}
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key]
  }
  filtered.status = 'modified'
  filtered.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('rock_task_proposals')
    .update(filtered)
    .eq('id', proposal_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposal: data })
}
