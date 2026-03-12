// src/app/api/finance/clients/route.ts
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
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data, error } = await sb.from('fin_clients').select('*').eq('org_id', orgId).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ clients: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { org_id, name, email, phone, notes, contract_value = 0 } = body
  if (!org_id || !name) return NextResponse.json({ error: 'org_id and name required' }, { status: 400 })

  const sb = createAdminSupabase()
  const company = await resolveCompany(sb, org_id)
  const { data, error } = await sb.from('fin_clients').insert({
    org_id, company, name, email: email || null, phone: phone || null,
    notes: notes || null, contract_value: parseFloat(contract_value) || 0,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ client: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { id, org_id, ...updates } = body
  if (!id || !org_id) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data, error } = await sb.from('fin_clients').update(updates).eq('id', id).eq('org_id', org_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ client: data })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const orgId = searchParams.get('org_id')
  if (!id || !orgId) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { error } = await sb.from('fin_clients').delete().eq('id', id).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
