// src/app/api/finance/ai/route.ts
// Streaming CFO analysis via Claude â€” SSE response.
// Caches result in fin_ai_insights per org + month.

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic()

const fmt  = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n || 0)
const fmtP = (n: number) => `${(n || 0).toFixed(1)}%`

export async function POST(req: Request) {
  const payload = await req.json()
  const {
    org_id, org_name, period_month,
    total_income, pending_income, total_expenses, cogs,
    gross_profit, gross_margin_pct, net_income, net_margin_pct,
    income_count, top_products, top_expense_groups,
    target_gross_margin, target_net_margin,
  } = payload

  const productLines = (top_products || []).slice(0, 6)
    .map((p: any) => `  â€¢ ${p.name}: ${fmt(p.total)} (${p.count} txns)`)
    .join('\n')

  const expenseLines = (top_expense_groups || []).slice(0, 6)
    .map((g: any) => `  â€¢ ${g.group}: ${fmt(g.total)}`)
    .join('\n')

  const gmGap = gross_margin_pct - target_gross_margin
  const nmGap = net_margin_pct - target_net_margin

  const systemPrompt = `You are the CFO advisor for ${org_name}, a neuroscience wellness company. 
Be direct, specific, and dollar-precise. No fluff. Think like a seasoned CFO reviewing month-end numbers.
Use bullet points only â€” no prose paragraphs. Max 4 bullets per section.`

  const userPrompt = `MONTHLY FINANCIALS â€” ${period_month}
Organization: ${org_name}

INCOME STATEMENT
  Gross Revenue (paid):     ${fmt(total_income)}  (${income_count} transactions)
  Pending / Uncollected:    ${fmt(pending_income)}
  Cost of Goods Sold:       ${fmt(cogs)}
  Gross Profit:             ${fmt(gross_profit)}  (${fmtP(gross_margin_pct)} gross margin)
  Total Operating Expenses: ${fmt(total_expenses)}
  Net Income:               ${fmt(net_income)}  (${fmtP(net_margin_pct)} net margin)

MARGIN TARGETS
  Gross Margin: ${fmtP(gross_margin_pct)} vs ${fmtP(target_gross_margin)} target â†’ ${gmGap >= 0 ? `âœ“ beat by ${fmtP(gmGap)}` : `âš  miss by ${fmtP(Math.abs(gmGap))}`}
  Net Margin:   ${fmtP(net_margin_pct)} vs ${fmtP(target_net_margin)} target â†’ ${nmGap >= 0 ? `âœ“ beat by ${fmtP(nmGap)}` : `âš  miss by ${fmtP(Math.abs(nmGap))}`}

TOP REVENUE SOURCES
${productLines || '  (no data)'}

TOP EXPENSE CATEGORIES
${expenseLines || '  (no data)'}

Provide a tight CFO analysis with exactly these 5 sections:

## FINANCIAL HEALTH
## MARGIN PERFORMANCE  
## CASH FLOW FLAGS
## REVENUE MIX INSIGHT
## #1 PRIORITY THIS MONTH`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })

        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`))
          }
        }

        // Cache in DB
        if (org_id && period_month && fullText) {
          const sb = createAdminSupabase()
          await sb.from('fin_ai_insights').upsert(
            { org_id, period_month, content: fullText },
            { onConflict: 'org_id,period_month' }
          )
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// GET â€” return cached insight for period
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orgId  = searchParams.get('org_id')
  const period = searchParams.get('period_month')
  if (!orgId || !period) return NextResponse.json({ insight: null })

  const sb = createAdminSupabase()
  const { data } = await sb
    .from('fin_ai_insights')
    .select('content, created_at')
    .eq('org_id', orgId)
    .eq('period_month', period)
    .maybeSingle()

  return NextResponse.json({ insight: data?.content || null, cached_at: data?.created_at || null })
}
