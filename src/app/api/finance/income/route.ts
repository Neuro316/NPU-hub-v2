// src/app/api/finance/income/route.ts
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
  let q = sb.from('fin_income').select('*').eq('org_id', orgId).order('txn_date', { ascending: false })
  if (month) q = q.eq('period_month', month)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ income: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { org_id, txn_date, client_id, client_name, product_id, product_name, amount, status = 'paid', source = 'manual', stripe_payment_id, stripe_customer_id, np_payment_id, notes } = body
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const company = await resolveCompany(sb, org_id)

  const { data, error } = await sb.from('fin_income').insert({
    org_id, company,
    txn_date: txn_date || new Date().toISOString().slice(0, 10),
    client_id: client_id || null,
    client_name: client_name || null,
    product_id: product_id || null,
    product_name: product_name || null,
    amount: parseFloat(amount) || 0,
    status, source,
    stripe_payment_id: stripe_payment_id || null,
    stripe_customer_id: stripe_customer_id || null,
    np_payment_id: np_payment_id || null,
    notes: notes || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ income: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { id, org_id, ...updates } = body
  if (!id || !org_id) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data: existing } = await sb.from('fin_income').select('source').eq('id', id).eq('org_id', org_id).single()
  if (existing?.source === 'np_platform') {
    return NextResponse.json({ error: 'Platform-synced records cannot be edited here' }, { status: 403 })
  }

  const { data, error } = await sb.from('fin_income').update(updates).eq('id', id).eq('org_id', org_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ income: data })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const orgId = searchParams.get('org_id')
  if (!id || !orgId) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data: existing } = await sb.from('fin_income').select('source').eq('id', id).eq('org_id', orgId).single()
  if (existing?.source === 'np_platform') {
    return NextResponse.json({ error: 'Platform-synced records cannot be deleted' }, { status: 403 })
  }

  const { error } = await sb.from('fin_income').delete().eq('id', id).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
