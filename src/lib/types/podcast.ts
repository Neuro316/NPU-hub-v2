// ─── Media Appearances / Podcast Module Types ───

export interface Podcast {
  id: string
  org_id: string
  name: string
  episode_topic: string | null
  recording_date: string | null
  release_date: string | null
  status: 'upcoming' | 'prep_needed' | 'ready' | 'completed'
  format: 'interview' | 'hosting' | 'cohost' | 'panel' | 'solo'
  platform: string
  host_name: string | null
  host_email: string | null
  host_excited_about: string | null
  host_cares_about: string | null
  interview_style: string | null
  show_website: string | null
  audience_info: string | null
  show_notes: string | null
  key_talking_points: string | null
  stories_anecdotes: string | null
  cta_offer: string | null
  strategic_positioning: string | null
  tech_notes: string | null
  recording_link: string | null
  post_social_notes: string | null
  crossover_topics: string[]
  target_icps: string[]
  retro_went_well: string | null
  retro_improve: string | null
  retro_rating: number | null
  retro_topics_captured: string[]
  prep_sheet_text: string | null
  prep_sheet_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PodcastQuestion {
  id: string
  podcast_id: string
  org_id: string
  question: string
  draft_answer: string | null
  source: string
  sort_order: number
  created_at: string
}

export interface PodcastFutureIdea {
  id: string
  org_id: string
  title: string
  description: string | null
  source_podcast_id: string | null
  status: 'new' | 'developing' | 'ready' | 'used'
  created_at: string
}

export interface AdvisoryVoice {
  id: string
  org_id: string
  name: string
  role: string | null
  perspective: string
  color: string
  is_default: boolean
  active: boolean
  sort_order: number
  created_at: string
}

export interface PodcastChecklist {
  id: string
  podcast_id: string
  label: string
  completed: boolean
  sort_order: number
}

export const PODCAST_STATUS = {
  upcoming: { label: 'Upcoming', color: '#10B981', icon: '🟢' },
  prep_needed: { label: 'Prep Needed', color: '#F59E0B', icon: '🟡' },
  ready: { label: 'Ready', color: '#3B82F6', icon: '✅' },
  completed: { label: 'Completed', color: '#6B7280', icon: '⬛' },
} as const

export const PODCAST_FORMAT = {
  interview: { label: 'Interview (I\'m the guest)', icon: '🎤' },
  hosting: { label: 'Hosting', icon: '🎧' },
  cohost: { label: 'Co-host', icon: '👥' },
  panel: { label: 'Panel', icon: '🏛️' },
  solo: { label: 'Solo Episode', icon: '📻' },
} as const

export const PODCAST_PLATFORMS = [
  'Zoom', 'Riverside.fm', 'Zencastr', 'StreamYard', 'SquadCast', 'In Person', 'Other'
]

export const DEFAULT_ICPS = [
  'High-Performers Running on Empty',
  'Anxiety & Rumination Seekers',
  'Young Professionals',
  'Reactive Parents',
  'Connection Seekers',
  'Depleted Caretakers',
  'Midlife Recalibrators (45-65)',
]

export const DEFAULT_ADVISORY_VOICES: Omit<AdvisoryVoice, 'id' | 'org_id' | 'created_at'>[] = [
  {
    name: 'Alex Hormozi',
    role: 'Offer & Monetization',
    perspective: 'Evaluate through the lens of irresistible offers, value equations, and monetization. Push for specificity in outcomes, guarantee language, and lead magnet conversion. Challenge vague positioning. Ask: does this make the audience feel stupid saying no?',
    color: '#EF4444',
    is_default: true, active: true, sort_order: 0,
  },
  {
    name: 'Seth Godin',
    role: 'Positioning & Tribes',
    perspective: 'Analyze through smallest viable audience, remarkable positioning, and permission marketing. Challenge mass-market thinking. Push for specificity over reach. Ask: who is this for and who is it not for? Is this remarkable enough to spread?',
    color: '#F59E0B',
    is_default: true, active: true, sort_order: 1,
  },
  {
    name: 'Daniel Priestley',
    role: 'Authority & Ecosystem',
    perspective: 'Evaluate through the Key Person of Influence framework. Push for scorecard-driven lead gen, waiting lists, and authority positioning. Challenge commodity thinking. Ask: does this position Cameron as the category authority?',
    color: '#8B5CF6',
    is_default: true, active: true, sort_order: 2,
  },
  {
    name: 'Kallaway',
    role: 'Content & Language',
    perspective: 'Analyze the language and content strategy. Push for proprietary vocabulary, pattern interrupts, and language that creates a new category. Challenge borrowed words from wellness/self-help. Ask: is this language uniquely Cameron\'s or could anyone say it?',
    color: '#3B82F6',
    is_default: true, active: true, sort_order: 3,
  },
  {
    name: 'Motivational Interviewing',
    role: 'Engagement & Change Talk',
    perspective: 'Evaluate through MI principles: evoke change talk, roll with resistance, support autonomy. Questions should orient forward toward what\'s emerging and possible. Never probe backward into past failure. Use reflective listening, affirmations, and open questions. Ask: does this invite the listener to discover their own motivation?',
    color: '#10B981',
    is_default: true, active: true, sort_order: 4,
  },
  {
    name: 'Polyvagal Theory',
    role: 'Nervous System Framing',
    perspective: 'Analyze through the polyvagal lens: ventral vagal (safe connection), sympathetic (mobilization), dorsal vagal (shutdown). Ensure language honors all nervous system states as adaptive. Challenge pathologizing language. Push for co-regulation framing. Ask: does this honor the listener\'s nervous system intelligence?',
    color: '#14B8A6',
    is_default: true, active: true, sort_order: 5,
  },
]

export const DEFAULT_CHECKLIST = [
  'Research host background',
  'Review show format and recent episodes',
  'Prepare 3 key talking points',
  'Draft answers to likely questions',
  'Prepare CTA / offer to mention',
  'Test recording setup (audio/video)',
  'Prepare bio and headshot',
  'Set calendar reminder for prep day',
]
