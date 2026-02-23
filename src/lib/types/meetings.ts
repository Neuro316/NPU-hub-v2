export type MeetingTemplate = 'level_10' | 'one_on_one' | 'standup' | 'quarterly' | 'custom'
export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type AttendeeRole = 'facilitator' | 'attendee' | 'optional'
export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'
export type IdsStatus = 'identified' | 'discussing' | 'solved' | 'deferred'

export interface AgendaSection {
  section: string
  duration_min: number
  notes: string
  completed: boolean
}

export interface IdsItem {
  id: string
  issue: string
  owner: string
  owner_name: string
  status: IdsStatus
  resolution: string
  created_at: string
}

export interface Meeting {
  id: string
  org_id: string
  title: string
  template: MeetingTemplate
  scheduled_at: string | null
  duration_minutes: number
  status: MeetingStatus
  gcal_event_id: string | null
  notes: string | null
  read_ai_data: Record<string, any> | null
  agenda: AgendaSection[]
  ids_items: IdsItem[]
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MeetingAttendee {
  id: string
  meeting_id: string
  user_id: string
  role: AttendeeRole
  rsvp: RsvpStatus
  created_at: string
  display_name?: string
  avatar_url?: string
}

export interface MeetingRockReview {
  id: string
  meeting_id: string
  rock_id: string
  status_at_review: string | null
  notes: string | null
  created_at: string
}

export interface MeetingWithAttendees extends Meeting {
  attendees: MeetingAttendee[]
}

export const MEETING_TEMPLATES: Record<MeetingTemplate, {
  label: string
  color: string
  defaultDuration: number
  defaultAgenda: AgendaSection[]
}> = {
  level_10: {
    label: 'L10',
    color: '#386797',
    defaultDuration: 90,
    defaultAgenda: [
      { section: 'Segue', duration_min: 5, notes: '', completed: false },
      { section: 'Scorecard Review', duration_min: 5, notes: '', completed: false },
      { section: 'Rock Review', duration_min: 5, notes: '', completed: false },
      { section: 'To-Do Review', duration_min: 5, notes: '', completed: false },
      { section: 'IDS (Identify, Discuss, Solve)', duration_min: 60, notes: '', completed: false },
      { section: 'Conclude', duration_min: 5, notes: '', completed: false },
    ],
  },
  one_on_one: {
    label: '1:1',
    color: '#C4704B',
    defaultDuration: 30,
    defaultAgenda: [
      { section: 'Check-in', duration_min: 5, notes: '', completed: false },
      { section: 'Updates & Wins', duration_min: 10, notes: '', completed: false },
      { section: 'Challenges & Support', duration_min: 10, notes: '', completed: false },
      { section: 'Action Items', duration_min: 5, notes: '', completed: false },
    ],
  },
  standup: {
    label: 'Standup',
    color: '#EA580C',
    defaultDuration: 15,
    defaultAgenda: [
      { section: 'Yesterday', duration_min: 5, notes: '', completed: false },
      { section: 'Today', duration_min: 5, notes: '', completed: false },
      { section: 'Blockers', duration_min: 5, notes: '', completed: false },
    ],
  },
  quarterly: {
    label: 'Quarterly',
    color: '#2A9D8F',
    defaultDuration: 480,
    defaultAgenda: [
      { section: 'Review Previous Quarter', duration_min: 60, notes: '', completed: false },
      { section: 'SWOT Analysis', duration_min: 60, notes: '', completed: false },
      { section: 'Set New Rocks', duration_min: 120, notes: '', completed: false },
      { section: 'Team Health Check', duration_min: 30, notes: '', completed: false },
    ],
  },
  custom: {
    label: 'Custom',
    color: '#9CA3AF',
    defaultDuration: 60,
    defaultAgenda: [],
  },
}
