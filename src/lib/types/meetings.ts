export type MeetingTemplate = 'level_10' | 'one_on_one' | 'standup' | 'quarterly' | 'custom'
export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type AttendeeRole = 'facilitator' | 'attendee' | 'optional'
export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'

export interface AgendaSection {
  section: string
  duration_min: number
  notes: string
  completed: boolean
  talking_points?: string[]
  prompts?: string[]         // AI-generated facilitator questions per section
}

export interface MeetingActionItem {
  id: string
  title: string
  owner: string
  owner_name: string
  due_date: string
  status: 'pending' | 'approved' | 'deferred' | 'deleted'
  task_id: string | null
}

export interface IdsItem {
  id: string
  issue_category: string        // Column 1: Issue Category
  description: string            // Column 2: Description
  dependencies_context: string   // Column 3: Dependencies / Context
  decisions_needed: string       // Column 4: Decisions Needed
  action_items_text: string      // Column 5: Action Items
  due_date: string               // Column 6: Due Date
  owner: string                  // Column 7: Owner (user_id)
  owner_name: string             // Column 7: Owner (display name)
  status: 'identified' | 'discussed' | 'solved'
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
  action_items?: MeetingActionItem[]
  ids_items?: IdsItem[]
  next_meeting_id?: string | null
  prev_meeting_id?: string | null
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
  label: string; color: string; defaultDuration: number; defaultAgenda: AgendaSection[]
}> = {
  level_10: {
    label: 'L10', color: '#386797', defaultDuration: 90,
    defaultAgenda: [
      { section: 'Segue', duration_min: 5, notes: '', completed: false, prompts: ['Share one personal and one professional good news from the week.'] },
      { section: 'Scorecard Review', duration_min: 5, notes: '', completed: false, prompts: ['Which metrics are off track?', 'Who owns the fix?'] },
      { section: 'Rock Review', duration_min: 5, notes: '', completed: false, prompts: ['Is each rock on track or off track?', 'What needs to change?'] },
      { section: 'To-Do Review', duration_min: 5, notes: '', completed: false, prompts: ['What was completed?', 'What carried over and why?'] },
      { section: 'IDS (Identify, Discuss, Solve)', duration_min: 60, notes: '', completed: false, prompts: ['What is the real issue?', 'What are the possible solutions?', 'Who owns the to-do?'] },
      { section: 'Conclude', duration_min: 5, notes: '', completed: false, prompts: ['What are the key takeaways?', 'Rate this meeting 1-10.'] },
    ],
  },
  one_on_one: {
    label: '1:1', color: '#C4704B', defaultDuration: 30,
    defaultAgenda: [
      { section: 'Check-in', duration_min: 5, notes: '', completed: false, prompts: ['How are you doing personally?', 'Anything on your mind?'] },
      { section: 'Updates & Wins', duration_min: 10, notes: '', completed: false, prompts: ['What wins happened this week?', 'What progress was made?'] },
      { section: 'Challenges & Support', duration_min: 10, notes: '', completed: false, prompts: ['Where are you stuck?', 'What support do you need from me?'] },
      { section: 'Action Items', duration_min: 5, notes: '', completed: false, prompts: ['What are the 3 most important things for next week?'] },
    ],
  },
  standup: {
    label: 'Standup', color: '#EA580C', defaultDuration: 15,
    defaultAgenda: [
      { section: 'Yesterday', duration_min: 5, notes: '', completed: false, prompts: ['What did you accomplish?'] },
      { section: 'Today', duration_min: 5, notes: '', completed: false, prompts: ['What will you work on today?'] },
      { section: 'Blockers', duration_min: 5, notes: '', completed: false, prompts: ['Is anything blocking your progress?'] },
    ],
  },
  quarterly: {
    label: 'Quarterly', color: '#2A9D8F', defaultDuration: 480,
    defaultAgenda: [
      { section: 'Review Previous Quarter', duration_min: 60, notes: '', completed: false, prompts: ['What worked?', 'What didn\'t?', 'What did we learn?'] },
      { section: 'SWOT Analysis', duration_min: 60, notes: '', completed: false, prompts: ['What are our strengths?', 'Weaknesses?', 'Opportunities?', 'Threats?'] },
      { section: 'Set New Rocks', duration_min: 120, notes: '', completed: false, prompts: ['What are the 3-7 most important things for next quarter?'] },
      { section: 'Team Health Check', duration_min: 30, notes: '', completed: false, prompts: ['Rate team health 1-10.', 'What would make it a 10?'] },
    ],
  },
  custom: {
    label: 'Custom', color: '#9CA3AF', defaultDuration: 60, defaultAgenda: [],
  },
}
