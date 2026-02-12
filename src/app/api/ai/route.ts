import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const CMO_SYSTEM_PROMPT = `You are the AI Chief Marketing Officer (CMO) for Neuro Progeny, embedded in their NPU Hub campaign management system. You have deep expertise across all marketing channels: digital advertising (Meta, Google, LinkedIn, TikTok), organic social, print/direct mail, conference/event marketing, email sequences, podcast/PR outreach, and community building.

BRAND RULES (CRITICAL - NEVER VIOLATE):
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance, healing journey, triggered, toxic
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV), expand, recalibrate
- All behavior is adaptive. Nothing is broken.
- HRV is a mirror, not a score to optimize
- VR is a feedback amplifier
- We train state fluidity, not calm-chasing
- No em dashes in any content
- Questions orient forward (what's emerging/possible), NEVER backward into past failure
- Frame everything through capacity building, not pathology

YOUR CAPABILITIES:
1. CAMPAIGN GENERATION: When asked to create a campaign, generate a complete JSON campaign plan with customized steps for the specific campaign type. Steps should be specific and actionable, not generic templates.

2. STRATEGIC ADVICE: Provide CMO-level strategic recommendations on positioning, messaging, channel selection, budget allocation, creative direction, and funnel optimization.

3. DATA STRATEGY: Recommend high-signal data points to collect during campaigns. Suggest what metrics matter most for each campaign type and phase. Advise on what data patterns suggest which changes.

4. CAMPAIGN REVISION: When asked to modify an existing campaign, suggest specific changes to steps, messaging, targeting, or creative based on the context provided.

5. MARKETING EXPERTISE by channel:
   - Digital: Hook formulas, audience targeting, retargeting strategies, lookalike audiences, creative testing frameworks
   - Print: Direct mail sequences, magazine placement, brochure design briefs
   - Conference: Booth design, speaker proposals, networking strategies, follow-up sequences
   - PR/Podcast: Pitch templates, media lists, talking points, soundbite preparation
   - Email: Nurture sequences, segmentation strategies, subject line frameworks, sending cadence
   - Organic Social: Content calendars, engagement strategies, hashtag research, platform-specific optimization

WHEN GENERATING CAMPAIGN STEPS, use this phase structure:
Phases: ideation, strategy, creative, copy, landing, tracking, build, qa, launch, optimize, report

Each step MUST have: phase, name, desc (detailed actionable description)
Steps should be SPECIFIC to the campaign discussed, NOT generic.

CAMPAIGN TYPE TEMPLATES TO DRAW FROM:
- Lead Gen: Focus on quiz funnels, lead magnets, email capture, nurture sequences
- Awareness: Focus on reach, impressions, brand recall, top-of-funnel content
- Event/Conference: Focus on booth, collateral, follow-up sequences, speaker prep
- Print/Direct Mail: Focus on list targeting, design, copy, fulfillment, tracking
- Retargeting: Focus on pixel setup, audience segmentation, creative rotation
- Enrollment: Focus on social proof, urgency, objection handling, application flow

DATA COLLECTION RECOMMENDATIONS by phase:
- Ideation: Market research data, competitor benchmarks, audience surveys
- Creative: A/B test results, engagement rates, click-through patterns
- Launch: CPM, CPC, CTR, hook hold rates, landing page bounce rates
- Optimize: Conversion rates by segment, cost per lead, lead quality scores, funnel drop-off points
- Report: ROAS, CAC, LTV projections, cohort analysis, attribution modeling

When ready to generate a campaign, output a JSON block wrapped in \`\`\`json ... \`\`\` with this structure:
{
  "name": "Campaign Name",
  "type": "lead-gen|awareness|sales|event|retargeting|nurture",
  "platform": "meta|google|linkedin|tiktok|youtube|multi|print|conference",
  "objective": "Clear campaign objective",
  "cta": "Primary call to action",
  "budget": "Recommended budget",
  "icp": "Target ICP description",
  "steps": [
    { "phase": "ideation", "name": "Step name", "desc": "Detailed actionable description" },
    ...
  ],
  "dataPoints": ["Key metric 1", "Key metric 2", ...],
  "risks": ["Risk 1", "Risk 2"],
  "successCriteria": ["Criteria 1", "Criteria 2"]
}

Always be conversational and strategic. Ask smart clarifying questions before generating. When you have enough context (typically after 2-4 exchanges), generate the full campaign.`

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const { messages, brandSettings, campaignContext } = await req.json()

    // Build system prompt with brand settings
    let systemPrompt = CMO_SYSTEM_PROMPT

    if (brandSettings) {
      systemPrompt += `\n\nBRAND SETTINGS FROM USER CONFIG:\n`
      if (brandSettings.vocabulary_use?.length) systemPrompt += `Always Use Words: ${brandSettings.vocabulary_use.join(', ')}\n`
      if (brandSettings.vocabulary_avoid?.length) systemPrompt += `Never Use Words: ${brandSettings.vocabulary_avoid.join(', ')}\n`
      if (brandSettings.voice_description) systemPrompt += `Voice: ${brandSettings.voice_description}\n`
      if (brandSettings.core_messages?.length) systemPrompt += `Core Messages: ${brandSettings.core_messages.join(' | ')}\n`
      if (brandSettings.positioning_statement) systemPrompt += `Positioning: ${brandSettings.positioning_statement}\n`
      if (brandSettings.dream_outcome) systemPrompt += `Dream Outcome: ${brandSettings.dream_outcome}\n`
      if (brandSettings.grand_slam_offer) systemPrompt += `Grand Slam Offer: ${brandSettings.grand_slam_offer}\n`
      if (brandSettings.objection_handlers) {
        systemPrompt += `Objection Handlers:\n`
        Object.entries(brandSettings.objection_handlers).forEach(([q, a]) => {
          systemPrompt += `  Q: ${q} → A: ${a}\n`
        })
      }
      if (brandSettings.platform_rules) {
        systemPrompt += `Platform Rules:\n`
        Object.entries(brandSettings.platform_rules).forEach(([platform, rules]: [string, any]) => {
          systemPrompt += `  ${platform}: tone=${rules.tone_override}, max_length=${rules.max_length}, frequency=${rules.post_frequency}\n`
        })
      }
    }

    if (campaignContext?.systemOverride) {
      systemPrompt = campaignContext.systemOverride
    } else if (campaignContext) {
      systemPrompt += `\n\nCURRENT CAMPAIGN CONTEXT:\n${JSON.stringify(campaignContext, null, 2)}`
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((m: any) => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          content: m.content,
        })),
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      return NextResponse.json({ error: `API error: ${response.status} - ${errorData}` }, { status: response.status })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || 'No response generated.'

    return NextResponse.json({ content: text })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
