// src/app/api/finance/settings/route.ts
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data } = await sb.from('fin_settings').select('*').eq('org_id', orgId).maybeSingle()

  // Return defaults if not yet created
  return NextResponse.json({
    settings: data ?? {
      org_id: orgId,
      target_gross_margin: 60,
      target_net_margin: 30,
      fiscal_year_start_month: 1,
      currency: 'usd',
    }
  })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { org_id, target_gross_margin, target_net_margin, fiscal_year_start_month, currency } = body
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data, error } = await sb
    .from('fin_settings')
    .upsert({
      org_id,
      target_gross_margin: parseFloat(target_gross_margin) || 60,
      target_net_margin: parseFloat(target_net_margin) || 30,
      fiscal_year_start_month: parseInt(fiscal_year_start_month) || 1,
      currency: currency || 'usd',
    }, { onConflict: 'org_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
