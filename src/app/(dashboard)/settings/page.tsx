'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  Settings, Palette, MessageSquare, Target, Megaphone, Brain, Shield,
  Save, ChevronDown, ChevronRight, Plus, X, Trash2, Loader2, Check, Sparkles, Mail, Wand2
} from 'lucide-react'

interface BrandSettings {
  // Identity
  brand_name: string
  tagline: string
  mission_statement: string
  origin_story: string

  // Voice & Tone
  voice_description: string
  tone_spectrum: { formal: number; casual: number; authoritative: number; warm: number; urgent: number; calm: number }
  personality_traits: string[]
  writing_style: string
  sentence_structure: string

  // Vocabulary Rules
  vocabulary_use: string[]
  vocabulary_avoid: string[]
  power_words: string[]
  emotional_triggers: string[]
  cta_phrases: string[]

  // Messaging Framework (Priestley 7-11-4)
  core_messages: string[]
  key_differentiators: string[]
  objection_handlers: Record<string, string>
  social_proof_types: string[]
  positioning_statement: string
  category_of_one: string

  // Value Equation (Hormozi)
  dream_outcome: string
  perceived_likelihood: string
  time_delay: string
  effort_sacrifice: string
  grand_slam_offer: string
  offer_stack: string[]
  guarantee: string
  scarcity_strategy: string
  urgency_triggers: string[]

  // Audience Psychology (Voss)
  emotional_labels: string[]
  mirror_phrases: string[]
  calibrated_questions: string[]
  thats_right_triggers: string[]
  accusation_audit: string[]

  // Visual Identity
  color_primary: string
  color_secondary: string
  color_accent: string
  color_background: string
  color_text: string
  font_heading: string
  font_body: string
  visual_mood: string

  // Platform-Specific Rules
  platform_rules: Record<string, {
    tone_override: string
    max_length: number
    hashtag_count: number
    emoji_usage: string
    cta_style: string
    post_frequency: string
    best_times: string
    content_mix: string
  }>

  // AI Prompt Templates
  ai_system_prompt: string
  ai_campaign_prompt: string
  ai_social_prompt: string
  ai_quiz_prompt: string
  ai_email_prompt: string

  // Email Templates
  email_templates: Array<{ id: string; name: string; subject: string; body: string; cardType: string }>

  // Content Guardrails
  never_topics: string[]
  sensitive_topics: string[]
  competitor_mentions: string
  political_stance: string
  humor_level: string
  controversy_tolerance: string

  // Engagement Rules
  comment_response_tone: string
  dm_approach: string
  collaboration_criteria: string
  ugc_guidelines: string
}

const DEFAULT_SETTINGS: BrandSettings = {
  brand_name: 'Neuro Progeny',
  tagline: 'Train Your Nervous System',
  mission_statement: 'Making neurotherapy accessible to 50 million lives at under $1,000 compared to traditional $60,000+ clinic treatments.',
  origin_story: '',

  voice_description: 'Scientific authority meets accessible language. Empowering, capacity-focused, forward-looking. We speak to the nervous system as trainable, not broken.',
  tone_spectrum: { formal: 60, casual: 40, authoritative: 80, warm: 70, urgent: 30, calm: 50 },
  personality_traits: ['Scientific', 'Empowering', 'Direct', 'Compassionate', 'Innovative'],
  writing_style: 'Short paragraphs. Punchy sentences mixed with flowing explanations. Lead with insight, not hype. Use analogy to bridge complex neuroscience to lived experience.',
  sentence_structure: 'Mix short declarative statements with longer explanatory sentences. Open with a reframe or contrarian take. End with forward-oriented questions.',

  vocabulary_use: ['capacity', 'regulation', 'training', 'nervous system', 'resilience', 'window of tolerance', 'HRV', 'biofeedback', 'VR', 'state fluidity', 'co-regulation', 'adaptive', 'bandwidth', 'expand', 'mirror'],
  vocabulary_avoid: ['treatment', 'therapy', 'fix', 'broken', 'disorder', 'diagnosis', 'cure', 'patient', 'calm-chasing', 'sympathovagal balance', 'healing journey', 'triggered', 'toxic'],
  power_words: ['capacity', 'expand', 'train', 'build', 'unlock', 'amplify', 'recalibrate', 'bandwidth'],
  emotional_triggers: ['What if nothing is broken?', 'Your nervous system adapted perfectly', 'Capacity, not calm', 'The system that got you here was smart'],
  cta_phrases: ['Ready to expand your capacity?', 'See what your nervous system can do', 'Train with us', 'Join the next cohort', 'Take the NSCI Quick-Score'],

  core_messages: [
    'All behavior is adaptive. Nothing is broken.',
    'We train capacity, not calm.',
    'HRV is a mirror, not a score to optimize.',
    'VR is a feedback amplifier, not an escape.',
    'The nervous system that got you here was brilliant. The one that takes you forward needs more bandwidth.',
  ],
  key_differentiators: [
    'VR biofeedback (not just talk therapy or meditation)',
    'Under $1,000 vs $60,000+ traditional clinics',
    'Capacity framework vs pathology model',
    'Measurable outcomes via HRV data',
    '5-week structured program with cohort support',
  ],
  objection_handlers: {
    'Is this therapy?': 'This is training, not therapy. Think of it like a gym for your nervous system. We build capacity, not diagnose conditions.',
    'Does VR actually work?': 'VR amplifies the feedback loop. Your nervous system gets real-time data about its own state, which accelerates the training process measurably.',
    'I already meditate': 'Meditation is great, but it trains one direction: calm. Capacity training builds the ability to move fluidly between all states, including high performance under pressure.',
    'Sounds expensive': 'Traditional neurotherapy costs $60,000+. Our program delivers measurable results for under $1,000.',
    'I don\'t have time': 'The program is 5 weeks, with sessions designed to fit into a professional schedule. Most participants see measurable HRV shifts within the first 2 weeks.',
  },
  social_proof_types: ['HRV data improvements', 'Participant testimonials', 'Before/after nervous system metrics', 'Cohort completion rates', 'Published research references'],
  positioning_statement: 'For high-performers who have tried meditation, therapy, and coaching but still hit the same ceiling under pressure, Neuro Progeny offers VR biofeedback capacity training that measurably expands your nervous system bandwidth.',
  category_of_one: 'VR Nervous System Capacity Training',

  dream_outcome: 'Perform under pressure without shutting down. Hold complexity without collapsing. Show up fully in relationships and high-stakes moments.',
  perceived_likelihood: 'Measurable HRV improvements tracked weekly. Structured 5-week program with proven methodology. 18+ years of neuroimaging expertise behind the approach.',
  time_delay: '2 weeks for first measurable shifts. 5 weeks for program completion. Ongoing capacity building after.',
  effort_sacrifice: 'VR sessions fit into professional schedules. No homework or journaling required. The nervous system does the work with the right feedback environment.',
  grand_slam_offer: 'Immersive Mastermind: 5 weeks of VR biofeedback training + cohort support + HRV tracking + nervous system capacity index scoring. Everything you need to measurably expand your bandwidth.',
  offer_stack: [
    'VR biofeedback sessions (10 sessions)',
    'HRV monitoring and weekly progress reports',
    'Nervous System Capacity Index scoring',
    'Cohort community access',
    'Integration support calls',
    'Lifetime access to training resources',
  ],
  guarantee: 'If you complete all sessions and don\'t see measurable HRV improvement, we\'ll work with you until you do.',
  scarcity_strategy: 'Cohort-based enrollment with limited seats per cohort to maintain quality of facilitation.',
  urgency_triggers: ['Next cohort starts [date]', 'Only [X] seats remaining', 'Early enrollment pricing ends [date]'],

  emotional_labels: [
    'It sounds like you\'ve tried everything and nothing quite stuck',
    'You\'re probably skeptical, and that makes sense',
    'It seems like the pressure never really goes away, even when things are going well',
  ],
  mirror_phrases: [
    'Your nervous system adapted perfectly to what it was given',
    'Nothing is broken here',
    'The patterns that feel like problems were once solutions',
  ],
  calibrated_questions: [
    'What would it look like if pressure didn\'t cost you?',
    'What becomes possible when your nervous system has more bandwidth?',
    'What is this costing you right now?',
  ],
  thats_right_triggers: [
    'Acknowledge their experience before offering anything',
    'Name the frustration with previous approaches',
    'Validate that their system\'s response was intelligent',
  ],
  accusation_audit: [
    'You might think this sounds too good to be true',
    'You might be wondering if VR is just a gimmick',
    'Part of you probably doesn\'t want to try another thing',
  ],

  color_primary: '#386797',
  color_secondary: '#1A1A2E',
  color_accent: '#3B82F6',
  color_background: '#F8FAFC',
  color_text: '#1A1A2E',
  font_heading: 'Inter',
  font_body: 'Inter',
  visual_mood: 'Clean, professional, scientific yet warm. Neural network imagery. Deep blues and whites. No cheesy stock photos.',

  platform_rules: {
    instagram: {
      tone_override: 'More visual, slightly more casual. Lead with insight hooks. Use line breaks generously.',
      max_length: 2200,
      hashtag_count: 15,
      emoji_usage: 'Minimal. 1-2 per post max. Brain emoji, lightning, arrow.',
      cta_style: 'Soft: "Save this" / "Share with someone who needs it" / "Link in bio"',
      post_frequency: '4-5x per week',
      best_times: '7-9am, 12-1pm, 7-9pm EST',
      content_mix: '40% educational, 25% testimonial, 20% behind-the-scenes, 15% CTA',
    },
    linkedin: {
      tone_override: 'More professional, longer form. Lead with contrarian takes or data. Use authority positioning.',
      max_length: 3000,
      hashtag_count: 5,
      emoji_usage: 'Very minimal. Professional context only.',
      cta_style: 'Direct: "Comment CAPACITY" / "DM me" / "Link in comments"',
      post_frequency: '3-4x per week',
      best_times: '7-8am, 12pm, 5-6pm EST',
      content_mix: '50% thought leadership, 25% data/results, 15% personal story, 10% CTA',
    },
    facebook: {
      tone_override: 'Warmer, more conversational. Community-focused. Encourage discussion.',
      max_length: 5000,
      hashtag_count: 3,
      emoji_usage: 'Moderate. Match community tone.',
      cta_style: 'Community: "Drop a ðŸ§  if this resonates" / "Share your experience"',
      post_frequency: '3x per week',
      best_times: '9am, 1pm, 7pm EST',
      content_mix: '35% educational, 30% community, 20% testimonial, 15% CTA',
    },
    tiktok: {
      tone_override: 'Hook in first 2 seconds. More energetic. Educational entertainment. Pattern interrupts.',
      max_length: 300,
      hashtag_count: 5,
      emoji_usage: 'More liberal. Match platform energy.',
      cta_style: 'Hook: "Follow for more" / "Link in bio" / "Part 2?"',
      post_frequency: '5-7x per week',
      best_times: '10am, 2pm, 8pm EST',
      content_mix: '50% educational hooks, 25% myth-busting, 15% results, 10% CTA',
    },
    x: {
      tone_override: 'Punchy. Provocative. Thread-friendly. Data-driven takes.',
      max_length: 280,
      hashtag_count: 2,
      emoji_usage: 'Minimal. Strategic only.',
      cta_style: 'Thread: "Thread ðŸ§µ" / DM-based',
      post_frequency: '5-7x per week',
      best_times: '8am, 12pm, 5pm EST',
      content_mix: '40% hot takes, 30% threads, 20% engagement, 10% CTA',
    },
  },

  ai_system_prompt: `You are a content strategist for Neuro Progeny, a company that trains nervous system capacity through VR biofeedback. 

CRITICAL RULES:
- NEVER use: treatment, therapy, fix, broken, disorder, diagnosis, cure, patient, calm-chasing, sympathovagal balance
- ALWAYS use: capacity, training, regulation, adaptive, bandwidth, state fluidity, mirror (for HRV)
- Frame everything through capacity, not pathology
- All behavior is adaptive. Nothing is broken.
- HRV is a mirror, not a score to optimize
- VR is a feedback amplifier
- We train state fluidity, not calm-chasing
- No em dashes
- Questions orient forward (what's emerging/possible), NEVER backward into past failure
- Time-anchor questions to the future
- "Name 3 things" structure when appropriate

VOICE: Scientific authority + accessible language. Direct but compassionate. Lead with reframes.`,

  ai_campaign_prompt: `Design campaigns using the Priestley 7-11-4 framework:
- Create 7+ hours of content touchpoints
- Plan 11+ interactions across the funnel
- Show up in 4+ locations/platforms

Use Hormozi's value equation: maximize dream outcome and perceived likelihood, minimize time delay and effort.

Structure the funnel: Awareness (educational) â†’ Engagement (interactive) â†’ Conversion (social proof + CTA) â†’ Enrollment (offer stack + guarantee).

Use Voss-style emotional labeling in objection-handling content.`,

  ai_social_prompt: `Generate platform-specific content following these rules:
- Hook in the first line (pattern interrupt, contrarian take, or bold statement)
- Bridge complex neuroscience to lived experience using analogy
- End with forward-oriented engagement (question, save prompt, or CTA)
- Match platform tone and length requirements
- Include relevant hashtags per platform limits
- Maintain brand vocabulary rules strictly
- No em dashes`,

  ai_quiz_prompt: `Design quizzes that:
- Assess nervous system capacity (not diagnose disorders)
- Use forward-oriented language
- Frame results as current capacity levels, not deficiencies
- Include specific, actionable insights per result tier
- Drive toward "What's possible from here?" not "What's wrong with you?"`,

  ai_email_prompt: `Write emails that:
- Open with a pattern interrupt or emotional label
- Build value before asking for anything
- Use Priestley's ascending transaction model
- Include one clear CTA per email
- Maintain warm authority tone
- Reference specific HRV/capacity data when possible`,

  email_templates: [
    { id: 'discovery', name: 'Discovery Call Follow-Up', subject: 'Resources from our call, {{recipientName}}', cardType: 'Discovery Call', body: 'Hi {{recipientName}},\n\nGreat connecting with you today. Here are the resources we discussed.\n\nTake your time with them. When something sparks a question, just reply to this email.\n\nLooking forward to hearing what resonates.' },
    { id: 'onboarding', name: 'Onboarding Welcome', subject: 'Welcome aboard. Your resources are ready.', cardType: 'Onboarding', body: 'Hi {{recipientName}},\n\nWelcome to the program. Below you will find everything you need to get started.\n\nThe most important first step is the nervous system assessment. It takes about 10 minutes and gives us a baseline for your training.\n\nReach out anytime.' },
    { id: 'general', name: 'General Follow-Up', subject: 'Following up, {{recipientName}}', cardType: '', body: 'Hi {{recipientName}},\n\nWanted to share some resources that might be useful based on our conversation.\n\nNo pressure at all. Take a look when you have a moment and let me know what questions come up.' },
  ],

  never_topics: ['Specific medical diagnoses', 'Medication recommendations', 'Anti-therapy messaging', 'Political content', 'Religious content'],
  sensitive_topics: ['Mental health crises', 'Trauma specifics', 'Eating disorders', 'Substance use', 'Suicidal ideation'],
  competitor_mentions: 'Never disparage competitors. Position as "different approach" not "better than".',
  political_stance: 'Completely neutral. Focus on neuroscience, not politics.',
  humor_level: 'Light, intelligent humor. Never sarcastic or dismissive. Occasional self-aware moments.',
  controversy_tolerance: 'Welcome contrarian takes on wellness industry norms. Avoid personal controversy.',

  comment_response_tone: 'Warm, direct, knowledgeable. Answer questions with curiosity. Never defensive.',
  dm_approach: 'Respond within 24 hours. Lead with a question, not a pitch. Qualify before offering.',
  collaboration_criteria: 'Aligned values (capacity over pathology). Complementary audience. No pseudoscience.',
  ugc_guidelines: 'Encourage capacity-focused language. Provide templates. Always get permission before reposting.',
}

type SectionKey = 'identity' | 'voice' | 'vocabulary' | 'messaging' | 'value' | 'psychology' | 'visual' | 'platforms' | 'ai_prompts' | 'email_templates' | 'guardrails' | 'engagement'

interface EmailTemplate { id: string; name: string; subject: string; body: string; cardType: string }

function EmailTemplateEditor({ template, onUpdate, onDelete, brandSettings }: {
  template: EmailTemplate
  onUpdate: (t: EmailTemplate) => void
  onDelete: () => void
  brandSettings: BrandSettings
}) {
  const [open, setOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState<string | null>(null)

  const aiAction = async (action: 'revise' | 'expand' | 'polish') => {
    if (!template.body.trim()) return
    setAiLoading(action)

    const prompts: Record<string, string> = {
      revise: `Rewrite this email to be clearer, more concise, and more engaging. Keep the same intent and tone. Brand voice: ${brandSettings.voice_description || 'warm, direct, empowering'}. Writing rules: no em dashes, capacity over pathology, forward-facing language. Return ONLY the revised email body text, no commentary.`,
      expand: `Expand this email with more detail, warmth, and value. Add a second paragraph that builds rapport or offers a helpful insight. Brand voice: ${brandSettings.voice_description || 'warm, direct, empowering'}. Writing rules: no em dashes, capacity over pathology, forward-facing language. Keep it under 4 short paragraphs. Return ONLY the expanded email body text, no commentary.`,
      polish: `Polish this email for grammar, flow, and professionalism. Keep the same structure and length. Make sure it sounds human, not corporate. Brand voice: ${brandSettings.voice_description || 'warm, direct, empowering'}. Writing rules: no em dashes, capacity over pathology, forward-facing language. Return ONLY the polished email body text, no commentary.`,
    }

    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `${prompts[action]}\n\nEmail to ${action}:\n\n${template.body}` }],
          campaignContext: { type: 'email_template', systemOverride: `You are an email copywriter for ${brandSettings.brand_name || 'Neuro Progeny'}. ${brandSettings.ai_email_prompt || ''}` },
        }),
      })
      const data = await res.json()
      const result = (data.content || '').replace(/\*\*/g, '').replace(/\u2014/g, ', ').replace(/\u2013/g, ', ').trim()
      if (result) onUpdate({ ...template, body: result })
    } catch {}
    setAiLoading(null)
  }

  return (
    <div className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left">
        <div className="flex items-center gap-2.5">
          <Mail className="w-4 h-4 text-red-400" />
          <div>
            <span className="text-sm font-semibold text-np-dark">{template.name || 'Untitled Template'}</span>
            {template.cardType && <span className="ml-2 text-[9px] font-bold bg-np-blue/10 text-np-blue px-1.5 py-0.5 rounded">{template.cardType}</span>}
          </div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Template Name</label>
              <input value={template.name} onChange={e => onUpdate({ ...template, name: e.target.value })}
                placeholder="e.g. Discovery Follow-Up"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Journey Card Type</label>
              <input value={template.cardType} onChange={e => onUpdate({ ...template, cardType: e.target.value })}
                placeholder="e.g. Discovery Call, Onboarding (or leave blank for any)"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Subject Line</label>
            <input value={template.subject} onChange={e => onUpdate({ ...template, subject: e.target.value })}
              placeholder="e.g. Resources from our call, {{recipientName}}"
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase">Email Body</label>
              <div className="flex gap-1">
                {(['revise', 'expand', 'polish'] as const).map(action => (
                  <button key={action} onClick={() => aiAction(action)} disabled={!!aiLoading || !template.body.trim()}
                    className="flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-md bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 disabled:opacity-40">
                    {aiLoading === action ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={template.body} onChange={e => onUpdate({ ...template, body: e.target.value })}
              placeholder="Hi {{recipientName}},&#10;&#10;Write your email body here...&#10;&#10;Use {{recipientName}}, {{senderName}}, {{cardName}} as placeholders."
              rows={6}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-vertical font-mono leading-relaxed" />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-[9px] text-gray-400">
              Placeholders: {'{{recipientName}}'} {'{{senderName}}'} {'{{cardName}}'}
            </div>
            <button onClick={onDelete} className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [settings, setSettings] = useState<BrandSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(['identity'] as SectionKey[]))
  const [activeBrand, setActiveBrand] = useState('np')
  const supabase = createClient()

  useEffect(() => {
    if (!currentOrg) return
    supabase.from('brand_profiles').select('*').eq('org_id', currentOrg.id).eq('brand_key', activeBrand).single()
      .then(({ data }) => {
        if (data?.guidelines && typeof data.guidelines === 'object') {
          setSettings(prev => ({ ...prev, ...data.guidelines as any, brand_name: data.display_name, tagline: data.tagline || '', voice_description: data.voice_description || '', vocabulary_use: data.vocabulary_use || [], vocabulary_avoid: data.vocabulary_avoid || [], color_primary: data.color_primary || '#386797', color_secondary: data.color_secondary || '#1A1A2E', color_accent: data.color_accent || '#3B82F6' }))
        }
      })
  }, [currentOrg?.id, activeBrand])

  const handleSave = async () => {
    if (!currentOrg) return
    setSaving(true)
    const { vocabulary_use, vocabulary_avoid, voice_description, brand_name, tagline, color_primary, color_secondary, color_accent, ...guidelines } = settings
    await supabase.from('brand_profiles').upsert({
      org_id: currentOrg.id,
      brand_key: activeBrand,
      display_name: brand_name,
      tagline,
      voice_description,
      vocabulary_use,
      vocabulary_avoid,
      color_primary,
      color_secondary,
      color_accent,
      guidelines,
    }, { onConflict: 'org_id,brand_key' })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleSection = (key: SectionKey) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const updateField = (field: keyof BrandSettings, value: any) => {
    setSettings(prev => ({ ...prev, [field]: value }))
  }

  const updateArrayField = (field: keyof BrandSettings, index: number, value: string) => {
    setSettings(prev => {
      const arr = [...(prev[field] as string[])]
      arr[index] = value
      return { ...prev, [field]: arr }
    })
  }

  const addArrayItem = (field: keyof BrandSettings, value: string = '') => {
    setSettings(prev => ({ ...prev, [field]: [...(prev[field] as string[]), value] }))
  }

  const removeArrayItem = (field: keyof BrandSettings, index: number) => {
    setSettings(prev => ({ ...prev, [field]: (prev[field] as string[]).filter((_, i) => i !== index) }))
  }

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  const Section = ({ id, icon: Icon, title, color, children }: { id: SectionKey; icon: any; title: string; color: string; children: React.ReactNode }) => {
    const isOpen = expandedSections.has(id)
    return (
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <button onClick={() => toggleSection(id)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-all">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + '15' }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span className="text-sm font-bold text-np-dark flex-1 text-left">{title}</span>
          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
        {isOpen && <div className="px-4 pb-5 pt-1 border-t border-gray-50">{children}</div>}
      </div>
    )
  }

  const TextInput = ({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) => (
    <div className="mb-3">
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          rows={4} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
      )}
    </div>
  )

  const ArrayEditor = ({ label, field, placeholder }: { label: string; field: keyof BrandSettings; placeholder?: string }) => (
    <div className="mb-4">
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">{label}</label>
      <div className="space-y-1.5">
        {(settings[field] as string[]).map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <input value={item} onChange={e => updateArrayField(field, i, e.target.value)} placeholder={placeholder}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            <button onClick={() => removeArrayItem(field, i)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => addArrayItem(field)} className="mt-1.5 text-[10px] text-np-blue font-medium flex items-center gap-1 hover:underline">
        <Plus className="w-3 h-3" /> Add item
      </button>
    </div>
  )

  const SliderInput = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-mono text-gray-400">{value}%</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-np-blue" />
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">AI & Brand Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} Â· Configure AI voice, messaging, and brand rules</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {[{ k: 'np', l: 'Neuro Progeny' }, { k: 'sensorium', l: 'Sensorium' }].map(b => (
              <button key={b.k} onClick={() => setActiveBrand(b.k)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${activeBrand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                {b.l}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save All'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Brand Identity */}
        <Section id="identity" icon={Palette} title="Brand Identity" color="#386797">
          <TextInput label="Brand Name" value={settings.brand_name} onChange={v => updateField('brand_name', v)} />
          <TextInput label="Tagline" value={settings.tagline} onChange={v => updateField('tagline', v)} />
          <TextInput label="Mission Statement" value={settings.mission_statement} onChange={v => updateField('mission_statement', v)} multiline />
          <TextInput label="Origin Story" value={settings.origin_story} onChange={v => updateField('origin_story', v)} placeholder="The story behind the brand..." multiline />
          <TextInput label="Positioning Statement (Priestley)" value={settings.positioning_statement} onChange={v => updateField('positioning_statement', v)} multiline />
          <TextInput label="Category of One" value={settings.category_of_one} onChange={v => updateField('category_of_one', v)} placeholder="What category do you own?" />
        </Section>

        {/* Voice & Tone */}
        <Section id="voice" icon={MessageSquare} title="Voice & Tone" color="#8B5CF6">
          <TextInput label="Voice Description" value={settings.voice_description} onChange={v => updateField('voice_description', v)} multiline />
          <TextInput label="Writing Style" value={settings.writing_style} onChange={v => updateField('writing_style', v)} multiline />
          <TextInput label="Sentence Structure" value={settings.sentence_structure} onChange={v => updateField('sentence_structure', v)} multiline />
          <div className="mt-4 mb-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-3">Tone Spectrum</label>
            <SliderInput label="Formal â†” Casual" value={settings.tone_spectrum.casual} onChange={v => updateField('tone_spectrum', { ...settings.tone_spectrum, casual: v, formal: 100 - v })} />
            <SliderInput label="Authoritative" value={settings.tone_spectrum.authoritative} onChange={v => updateField('tone_spectrum', { ...settings.tone_spectrum, authoritative: v })} />
            <SliderInput label="Warm" value={settings.tone_spectrum.warm} onChange={v => updateField('tone_spectrum', { ...settings.tone_spectrum, warm: v })} />
            <SliderInput label="Urgent" value={settings.tone_spectrum.urgent} onChange={v => updateField('tone_spectrum', { ...settings.tone_spectrum, urgent: v })} />
          </div>
          <ArrayEditor label="Personality Traits" field="personality_traits" placeholder="e.g., Scientific, Empowering" />
        </Section>

        {/* Vocabulary */}
        <Section id="vocabulary" icon={Shield} title="Vocabulary Rules" color="#EF4444">
          <div className="grid grid-cols-2 gap-4">
            <ArrayEditor label="âœ… Always Use" field="vocabulary_use" placeholder="Add word or phrase" />
            <ArrayEditor label="ðŸš« Never Use" field="vocabulary_avoid" placeholder="Add word or phrase" />
          </div>
          <ArrayEditor label="âš¡ Power Words" field="power_words" placeholder="Words that drive action" />
          <ArrayEditor label="ðŸ”¥ Emotional Triggers" field="emotional_triggers" placeholder="Phrases that create resonance" />
          <ArrayEditor label="ðŸ‘‰ CTA Phrases" field="cta_phrases" placeholder="Call-to-action phrases" />
        </Section>

        {/* Messaging Framework */}
        <Section id="messaging" icon={Megaphone} title="Messaging Framework (Priestley)" color="#F59E0B">
          <ArrayEditor label="Core Messages" field="core_messages" placeholder="Key message" />
          <ArrayEditor label="Key Differentiators" field="key_differentiators" placeholder="What makes you different" />
          <ArrayEditor label="Social Proof Types" field="social_proof_types" placeholder="Types of proof to use" />
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Objection Handlers</label>
            {Object.entries(settings.objection_handlers).map(([objection, response], i) => (
              <div key={i} className="mb-2 bg-gray-50 rounded-lg p-3">
                <input value={objection} onChange={e => {
                  const newHandlers = { ...settings.objection_handlers }
                  delete newHandlers[objection]
                  newHandlers[e.target.value] = response
                  updateField('objection_handlers', newHandlers)
                }} placeholder="Objection..."
                  className="w-full text-xs font-bold border-none bg-transparent focus:outline-none placeholder-gray-300 mb-1" />
                <textarea value={response} onChange={e => {
                  updateField('objection_handlers', { ...settings.objection_handlers, [objection]: e.target.value })
                }} rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" />
              </div>
            ))}
            <button onClick={() => updateField('objection_handlers', { ...settings.objection_handlers, '': '' })}
              className="text-[10px] text-np-blue font-medium flex items-center gap-1 hover:underline">
              <Plus className="w-3 h-3" /> Add objection
            </button>
          </div>
        </Section>

        {/* Value Equation */}
        <Section id="value" icon={Target} title="Value Equation (Hormozi)" color="#10B981">
          <TextInput label="Dream Outcome" value={settings.dream_outcome} onChange={v => updateField('dream_outcome', v)} multiline />
          <TextInput label="Perceived Likelihood of Success" value={settings.perceived_likelihood} onChange={v => updateField('perceived_likelihood', v)} multiline />
          <TextInput label="Time Delay (how fast?)" value={settings.time_delay} onChange={v => updateField('time_delay', v)} multiline />
          <TextInput label="Effort & Sacrifice (how easy?)" value={settings.effort_sacrifice} onChange={v => updateField('effort_sacrifice', v)} multiline />
          <TextInput label="Grand Slam Offer" value={settings.grand_slam_offer} onChange={v => updateField('grand_slam_offer', v)} multiline />
          <ArrayEditor label="Offer Stack" field="offer_stack" placeholder="What's included" />
          <TextInput label="Guarantee" value={settings.guarantee} onChange={v => updateField('guarantee', v)} multiline />
          <TextInput label="Scarcity Strategy" value={settings.scarcity_strategy} onChange={v => updateField('scarcity_strategy', v)} />
          <ArrayEditor label="Urgency Triggers" field="urgency_triggers" placeholder="Time-based urgency" />
        </Section>

        {/* Audience Psychology */}
        <Section id="psychology" icon={Brain} title="Audience Psychology (Voss)" color="#EC4899">
          <ArrayEditor label="Emotional Labels" field="emotional_labels" placeholder="It sounds like..." />
          <ArrayEditor label="Mirror Phrases" field="mirror_phrases" placeholder="Phrases that reflect their experience" />
          <ArrayEditor label="Calibrated Questions" field="calibrated_questions" placeholder="What/How questions" />
          <ArrayEditor label={'"That\'s Right" Triggers'} field="thats_right_triggers" placeholder="What makes them say that" />
          <ArrayEditor label="Accusation Audit" field="accusation_audit" placeholder="Pre-empt their concerns" />
        </Section>

        {/* Visual Identity */}
        <Section id="visual" icon={Palette} title="Visual Identity" color="#6366F1">
          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              { label: 'Primary', field: 'color_primary' as const },
              { label: 'Secondary', field: 'color_secondary' as const },
              { label: 'Accent', field: 'color_accent' as const },
              { label: 'Background', field: 'color_background' as const },
              { label: 'Text', field: 'color_text' as const },
            ].map(c => (
              <div key={c.field}>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">{c.label}</label>
                <div className="flex items-center gap-1.5">
                  <input type="color" value={settings[c.field]} onChange={e => updateField(c.field, e.target.value)}
                    className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer" />
                  <input value={settings[c.field]} onChange={e => updateField(c.field, e.target.value)}
                    className="flex-1 text-[10px] font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                </div>
              </div>
            ))}
          </div>
          <TextInput label="Font (Heading)" value={settings.font_heading} onChange={v => updateField('font_heading', v)} />
          <TextInput label="Font (Body)" value={settings.font_body} onChange={v => updateField('font_body', v)} />
          <TextInput label="Visual Mood" value={settings.visual_mood} onChange={v => updateField('visual_mood', v)} multiline />
        </Section>

        {/* Platform Rules */}
        <Section id="platforms" icon={Target} title="Platform-Specific Rules" color="#E4405F">
          {Object.entries(settings.platform_rules).map(([platform, rules]) => {
            const plat = platform === 'x' ? 'X (Twitter)' : platform.charAt(0).toUpperCase() + platform.slice(1)
            return (
              <div key={platform} className="mb-4 bg-gray-50 rounded-xl p-4">
                <h4 className="text-xs font-bold text-np-dark mb-3">{plat}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Tone Override</label>
                    <textarea value={rules.tone_override} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, tone_override: e.target.value } })}
                      rows={2} className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Max Length</label>
                      <input type="number" value={rules.max_length} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, max_length: parseInt(e.target.value) } })}
                        className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Hashtags</label>
                      <input type="number" value={rules.hashtag_count} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, hashtag_count: parseInt(e.target.value) } })}
                        className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">CTA Style</label>
                    <input value={rules.cta_style} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, cta_style: e.target.value } })}
                      className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Content Mix</label>
                    <input value={rules.content_mix} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, content_mix: e.target.value } })}
                      className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Post Frequency</label>
                    <input value={rules.post_frequency} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, post_frequency: e.target.value } })}
                      className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Best Times</label>
                    <input value={rules.best_times} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, best_times: e.target.value } })}
                      className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Emoji Usage</label>
                    <input value={rules.emoji_usage} onChange={e => updateField('platform_rules', { ...settings.platform_rules, [platform]: { ...rules, emoji_usage: e.target.value } })}
                      className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none" />
                  </div>
                </div>
              </div>
            )
          })}
        </Section>

        {/* AI Prompt Templates */}
        <Section id="ai_prompts" icon={Sparkles} title="AI Prompt Templates" color="#7C3AED">
          <p className="text-xs text-gray-500 mb-4">These prompts are injected into every AI tool in the hub. Edit them to control how AI generates content for your brand.</p>
          <TextInput label="System Prompt (all AI tools)" value={settings.ai_system_prompt} onChange={v => updateField('ai_system_prompt', v)} multiline />
          <TextInput label="Campaign Builder Prompt" value={settings.ai_campaign_prompt} onChange={v => updateField('ai_campaign_prompt', v)} multiline />
          <TextInput label="Social Content Prompt" value={settings.ai_social_prompt} onChange={v => updateField('ai_social_prompt', v)} multiline />
          <TextInput label="Quiz Builder Prompt" value={settings.ai_quiz_prompt} onChange={v => updateField('ai_quiz_prompt', v)} multiline />
          <TextInput label="Email Sequence Prompt" value={settings.ai_email_prompt} onChange={v => updateField('ai_email_prompt', v)} multiline />
        </Section>

        {/* Email Templates */}
        <Section id="email_templates" icon={Mail} title="Email Templates" color="#EA4335">
          <p className="text-xs text-gray-500 mb-3">
            Create email templates for different journey card types. Use {'{{recipientName}}'}, {'{{senderName}}'}, and {'{{cardName}}'} as placeholders. Select a template when sending resources from Journey Cards.
          </p>

          {(settings.email_templates || []).map((tmpl, idx) => (
            <EmailTemplateEditor
              key={tmpl.id}
              template={tmpl}
              onUpdate={(updated) => {
                const templates = [...(settings.email_templates || [])]
                templates[idx] = updated
                updateField('email_templates', templates)
              }}
              onDelete={() => {
                const templates = (settings.email_templates || []).filter((_, i) => i !== idx)
                updateField('email_templates', templates)
              }}
              brandSettings={settings}
            />
          ))}

          <button onClick={() => {
            const id = 'tmpl_' + Date.now()
            const templates = [...(settings.email_templates || []), { id, name: 'New Template', subject: '', body: '', cardType: '' }]
            updateField('email_templates', templates)
          }}
            className="flex items-center gap-1.5 text-xs font-medium text-np-blue bg-np-blue/10 px-3 py-2 rounded-lg hover:bg-np-blue/20 mt-2">
            <Plus className="w-3.5 h-3.5" /> Add Email Template
          </button>
        </Section>

        {/* Content Guardrails */}
        <Section id="guardrails" icon={Shield} title="Content Guardrails" color="#EF4444">
          <ArrayEditor label="Never Topics" field="never_topics" placeholder="Topics to avoid completely" />
          <ArrayEditor label="Sensitive Topics (handle with care)" field="sensitive_topics" placeholder="Topics requiring extra care" />
          <TextInput label="Competitor Mentions Policy" value={settings.competitor_mentions} onChange={v => updateField('competitor_mentions', v)} multiline />
          <TextInput label="Political Stance" value={settings.political_stance} onChange={v => updateField('political_stance', v)} />
          <TextInput label="Humor Level" value={settings.humor_level} onChange={v => updateField('humor_level', v)} />
          <TextInput label="Controversy Tolerance" value={settings.controversy_tolerance} onChange={v => updateField('controversy_tolerance', v)} />
        </Section>

        {/* Engagement Rules */}
        <Section id="engagement" icon={MessageSquare} title="Engagement Rules" color="#0EA5E9">
          <TextInput label="Comment Response Tone" value={settings.comment_response_tone} onChange={v => updateField('comment_response_tone', v)} multiline />
          <TextInput label="DM Approach" value={settings.dm_approach} onChange={v => updateField('dm_approach', v)} multiline />
          <TextInput label="Collaboration Criteria" value={settings.collaboration_criteria} onChange={v => updateField('collaboration_criteria', v)} multiline />
          <TextInput label="UGC Guidelines" value={settings.ugc_guidelines} onChange={v => updateField('ugc_guidelines', v)} multiline />
        </Section>
      </div>

      {/* Sticky Save Bar */}
      <div className="sticky bottom-4 mt-6 flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-np-blue text-white rounded-xl text-sm font-medium hover:bg-np-blue/90 shadow-lg disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save All Settings'}
        </button>
      </div>
    </div>
  )
}
