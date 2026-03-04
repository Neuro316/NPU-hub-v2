import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const BRAND_RULES = `BRAND RULES (CRITICAL):
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance, healing journey, triggered, toxic
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV), expand, recalibrate
- All behavior is adaptive. Nothing is broken.
- HRV is a mirror, not a score to optimize
- VR is a feedback amplifier
- We train state fluidity, not calm-chasing
- No em dashes in any content
- Questions orient forward (what's emerging/possible), NEVER backward into past failure
- Frame everything through capacity building, not pathology`

const CAMERON_CONTEXT = `ABOUT CAMERON ALLEN:
Cameron Allen is the founder of Neuro Progeny and co-founder of Sensorium Neuro Wellness, with 18 years of neuroimaging experience having reviewed over 8,000 brain scans. He operates at the intersection of neurotechnology innovation and human potential development, developing VR biofeedback systems and nervous system capacity training programs. His mission is to impact 50 million lives by making neurotherapy accessible at under $1,000 compared to traditional $60,000+ clinic treatments. He has published research with Dr. Ken Blum on QEEG neurological dysregulation and maintains a "capacity over pathology" philosophy that views nervous system patterns as adaptive rather than broken.`

export async function POST(request: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  const body = await request.json()
  const { action, data } = body

  let systemPrompt = ''
  let userMessage = ''

  switch (action) {
    case 'ai_fill': {
      // Web search + AI fill for podcast fields
      systemPrompt = `You are a podcast research assistant for Cameron Allen. ${CAMERON_CONTEXT}

Given a podcast name and optionally a host name, research and fill in as many fields as possible.

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "episode_topic": "suggested topic based on show theme and Cameron's expertise",
  "host_name": "host full name",
  "host_excited_about": "what the host typically gets excited about based on their show",
  "host_cares_about": "the host's core mission/values",
  "interview_style": "conversational/inquisitive/story-driven/etc",
  "show_website": "URL if known",
  "audience_info": "estimated audience size and demographics",
  "show_notes": "background on the show, recent episodes, typical guests",
  "suggested_talking_points": "3-5 talking points tailored for this show's audience",
  "suggested_questions": ["likely question 1", "likely question 2", "likely question 3", "likely question 4", "likely question 5"],
  "strategic_positioning": "how Cameron should position himself for this specific audience"
}`
      userMessage = `Research this podcast and fill fields:\nPodcast: ${data.name}\nHost: ${data.host_name || 'unknown'}\nTopic: ${data.episode_topic || 'not set yet'}\nFormat: ${data.format || 'interview'}\n\nFill in as many fields as you can. For anything you can't determine, use null.`
      break
    }

    case 'parse_prep_sheet': {
      systemPrompt = `You are an assistant that parses podcast prep sheets / pitch documents. Extract structured data from the text.

Respond ONLY with JSON (no markdown, no backticks):
{
  "name": "podcast name",
  "episode_topic": "topic/title",
  "host_name": "host name",
  "host_email": "email if found",
  "show_website": "URL if found",
  "audience_info": "audience info if found",
  "interview_style": "style notes if found",
  "host_excited_about": "what excites the host",
  "host_cares_about": "what the host cares about",
  "show_notes": "background info",
  "suggested_questions": ["extracted questions"],
  "key_talking_points": "extracted talking points",
  "recording_date": "date if found (ISO format)",
  "platform": "platform if mentioned"
}`
      userMessage = `Parse this podcast prep sheet and extract all relevant fields:\n\n${data.text}`
      break
    }

    case 'feedback_coach': {
      const voiceInstructions = (data.voices || [])
        .map((v: any) => `### ${v.name} (${v.role})\n${v.perspective}`)
        .join('\n\n')

      systemPrompt = `You are a panel of expert advisors reviewing Cameron Allen's podcast preparation.

${CAMERON_CONTEXT}
${BRAND_RULES}

ACTIVE ADVISORY VOICES:
${voiceInstructions}

For each active voice, provide specific, actionable feedback on the podcast prep materials. Each voice should stay in character and provide 2-3 concrete suggestions. Be direct, constructive, and specific. Reference the actual content provided.

Respond ONLY with JSON (no markdown, no backticks):
{
  "feedback": [
    {
      "voice_name": "Name",
      "voice_color": "#hex",
      "rating": 1-10,
      "strengths": ["specific strength"],
      "suggestions": ["specific actionable suggestion"],
      "key_quote": "one powerful line of feedback in their voice"
    }
  ],
  "overall_score": 1-10,
  "top_priority": "the single most important thing to improve"
}`
      userMessage = `Review this podcast preparation:\n\nPodcast: ${data.name}\nHost: ${data.host_name}\nTopic: ${data.episode_topic}\nAudience: ${data.audience_info || 'unknown'}\n\nTalking Points:\n${data.key_talking_points || 'none yet'}\n\nStories/Anecdotes:\n${data.stories_anecdotes || 'none yet'}\n\nCTA:\n${data.cta_offer || 'none yet'}\n\nStrategic Positioning:\n${data.strategic_positioning || 'none yet'}`
      break
    }

    case 'draft_answers': {
      systemPrompt = `You are Cameron Allen preparing for a podcast appearance. ${CAMERON_CONTEXT}\n${BRAND_RULES}

Draft natural, conversational answers to interview questions. Sound like a real person talking, not a press release. Use Cameron's actual experience (8,000 brain scans, VR biofeedback, capacity training) as anchors. Keep answers to 2-3 paragraphs each.

Respond ONLY with JSON (no markdown, no backticks):
{
  "answers": [
    { "question": "the question", "answer": "drafted answer" }
  ]
}`
      userMessage = `Draft answers for these podcast questions:\n\nPodcast: ${data.name}\nTopic: ${data.episode_topic}\nAudience: ${data.audience_info || 'general'}\n\nQuestions:\n${(data.questions || []).map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}`
      break
    }

    case 'generate_social': {
      systemPrompt = `You are a social media content creator for Cameron Allen. ${CAMERON_CONTEXT}\n${BRAND_RULES}

Generate 6 social media posts from a podcast appearance. Mix platforms and formats.

Respond ONLY with JSON (no markdown, no backticks):
{
  "posts": [
    { "platform": "LinkedIn/Instagram/Twitter/TikTok", "type": "quote/insight/story/carousel/thread", "content": "the post content", "hashtags": ["tag1"] }
  ]
}`
      userMessage = `Generate 6 social posts from this podcast:\n\nPodcast: ${data.name}\nTopic: ${data.episode_topic}\nKey Points: ${data.key_talking_points || ''}\nStories: ${data.stories_anecdotes || ''}\nCTA: ${data.cta_offer || ''}`
      break
    }

    case 'suggest_topics': {
      systemPrompt = `You are a podcast strategy advisor for Cameron Allen. ${CAMERON_CONTEXT}\n${BRAND_RULES}

Based on retrospect insights and past episodes, suggest future podcast topics that would strengthen Cameron's positioning and message.

Respond ONLY with JSON (no markdown, no backticks):
{
  "topics": [
    { "title": "topic title", "description": "why this topic and angle to take", "target_icps": ["ICP names"] }
  ]
}`
      userMessage = `Suggest 5 future podcast topics based on:\n\nPast episodes:\n${(data.past_episodes || []).map((p: any) => `- ${p.name}: ${p.episode_topic}`).join('\n')}\n\nRetro insights:\n${data.retro_insights || 'none yet'}\n\nExisting future ideas:\n${(data.existing_ideas || []).map((i: any) => `- ${i.title}`).join('\n')}`
      break
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2024-01-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    const result = await response.json()
    const text = result.content?.[0]?.text || ''

    // Parse JSON from response
    try {
      const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ raw: text, error: 'Failed to parse JSON' })
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
