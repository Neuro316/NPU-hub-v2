// src/app/api/finance/expenses/route.ts
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function resolveCompany(sb: any, orgId: string): Promise<string> {
  const { data } = await sb.from('organizations').select('slug').eq('id', orgId).single()
  const slug = (data?.slug || '').toLowerCase()
  return slug.includes('sensorium') ? 'sensorium' : 'neuroprogeny'
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  const month = searchParams.get('month')
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  let q = sb.from('fin_expenses').select('*').eq('org_id', orgId).order('txn_date', { ascending: false })
  if (month) q = q.eq('period_month', month)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expenses: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { org_id, txn_date, vendor, category_id, category_name, group_name, is_cogs = false, amount, status = 'paid', recurring = false, notes } = body
  if (!org_id || !vendor) return NextResponse.json({ error: 'org_id and vendor required' }, { status: 400 })

  const sb = createAdminSupabase()
  const company = await resolveCompany(sb, org_id)

  const { data, error } = await sb.from('fin_expenses').insert({
    org_id, company,
    txn_date: txn_date || new Date().toISOString().slice(0, 10),
    vendor,
    category: category_name || 'General',
    grp: group_name || 'Operating Expenses',
    category_id: category_id || null,
    category_name: category_name || null,
    group_name: group_name || null,
    is_cogs,
    amount: parseFloat(amount) || 0,
    status, recurring,
    notes: notes || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expense: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { id, org_id, ...updates } = body
  if (!id || !org_id) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data, error } = await sb.from('fin_expenses').update(updates).eq('id', id).eq('org_id', org_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expense: data })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const orgId = searchParams.get('org_id')
  if (!id || !orgId) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { error } = await sb.from('fin_expenses').delete().eq('id', id).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
