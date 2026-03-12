// src/app/api/finance/products/route.ts
// Per-org product catalog â€” NP and Sensorium have completely separate catalogs.
// On first GET for an org with empty catalog, seeds from fin_default_products
// based on the org's slug ('neuro-progeny' â†’ np, 'sensorium' â†’ sensorium).

import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function seedProductsIfEmpty(sb: any, orgId: string) {
  const { count } = await sb
    .from('fin_product_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  if ((count ?? 0) > 0) return

  // Determine entity type from org slug
  const { data: org } = await sb.from('organizations').select('slug').eq('id', orgId).single()
  const slug = (org?.slug || '').toLowerCase()
  const entityType = slug.includes('sensorium') ? 'sensorium' : 'np'

  const { data: defaults } = await sb
    .from('fin_default_products')
    .select('*')
    .eq('entity_type', entityType)
    .order('sort_order')

  if (!defaults?.length) return

  await sb.from('fin_product_catalog').insert(
    defaults.map((d: any) => ({
      org_id: orgId, name: d.name, category: d.category,
      price: d.price, sort_order: d.sort_order, active: true,
    }))
  )
}

async function seedCategoriesIfEmpty(sb: any, orgId: string) {
  const { count } = await sb
    .from('fin_expense_categories')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  if ((count ?? 0) > 0) return

  const { data: defaults } = await sb
    .from('fin_default_expense_categories')
    .select('*')
    .order('sort_order')

  if (!defaults?.length) return

  await sb.from('fin_expense_categories').insert(
    defaults.map((d: any) => ({
      org_id: orgId, group_name: d.group_name, name: d.name,
      is_cogs: d.is_cogs, sort_order: d.sort_order, active: true,
    }))
  )
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  const type  = searchParams.get('type') || 'products' // 'products' | 'categories'
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()

  if (type === 'categories') {
    await seedCategoriesIfEmpty(sb, orgId)
    const { data, error } = await sb
      .from('fin_expense_categories')
      .select('*')
      .eq('org_id', orgId)
      .eq('active', true)
      .order('sort_order')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ categories: data ?? [] })
  }

  await seedProductsIfEmpty(sb, orgId)
  const { data, error } = await sb
    .from('fin_product_catalog')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { org_id, name, description, category, price = 0, type = 'products' } = body
  if (!org_id || !name) return NextResponse.json({ error: 'org_id and name required' }, { status: 400 })

  const sb = createAdminSupabase()

  if (type === 'category') {
    const { data, error } = await sb.from('fin_expense_categories').insert({
      org_id, group_name: body.group_name || 'Other', name,
      is_cogs: body.is_cogs || false, sort_order: body.sort_order || 999,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ category: data }, { status: 201 })
  }

  const { data, error } = await sb.from('fin_product_catalog').insert({
    org_id, name, description: description || null,
    category: category || null, price: parseFloat(price) || 0,
    sort_order: body.sort_order || 999,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { id, org_id, type = 'products', ...updates } = body
  if (!id || !org_id) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const table = type === 'category' ? 'fin_expense_categories' : 'fin_product_catalog'
  const { data, error } = await sb.from(table).update(updates).eq('id', id).eq('org_id', org_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const orgId = searchParams.get('org_id')
  const type = searchParams.get('type') || 'products'
  if (!id || !orgId) return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const table = type === 'category' ? 'fin_expense_categories' : 'fin_product_catalog'
  const { error } = await sb.from(table).update({ active: false }).eq('id', id).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
