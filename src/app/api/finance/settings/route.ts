// src/app/api/finance/settings/route.ts
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const DEFAULTS = {
  target_gross_margin: 60,
  target_net_margin: 30,
  fiscal_year_start_month: 1,
  currency: 'usd',
  target_monthly_revenue: 0,
  avg_cac: 0,
  avg_ltv: 0,
  avg_churn_pct: 0,
  monthly_burn_rate: 0,
  cash_on_hand: 0,
  // Balance sheet inputs
  accounts_receivable: 0,
  accounts_payable: 0,
  deferred_revenue: 0,
  short_term_debt: 0,
  long_term_debt: 0,
  equipment_value: 0,
  monthly_depreciation: 0,
  monthly_interest: 0,
  monthly_amortization: 0,
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()
  const { data } = await sb.from('fin_settings').select('*').eq('org_id', orgId).maybeSingle()
  return NextResponse.json({ settings: data ?? { org_id: orgId, ...DEFAULTS } })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { org_id, ...fields } = body
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const sb = createAdminSupabase()

  // Numeric fields â€” parse all
  const numericFields = Object.keys(DEFAULTS).filter(k => k !== 'currency')
  const upsertPayload: Record<string, any> = { org_id }
  numericFields.forEach(k => {
    if (fields[k] !== undefined) upsertPayload[k] = parseFloat(fields[k]) || 0
  })
  if (fields.currency) upsertPayload.currency = fields.currency
  if (fields.fiscal_year_start_month !== undefined) upsertPayload.fiscal_year_start_month = parseInt(fields.fiscal_year_start_month) || 1

  const { data, error } = await sb
    .from('fin_settings')
    .upsert(upsertPayload, { onConflict: 'org_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
