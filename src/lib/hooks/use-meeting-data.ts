'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { Meeting, MeetingAttendee, MeetingWithAttendees, MeetingRockReview } from '@/lib/types/meetings'

export function useMeetingData() {
  const { currentOrg } = useWorkspace()
  const [meetings, setMeetings] = useState<MeetingWithAttendees[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const { data: meetingData } = await supabase
      .from('meetings')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('scheduled_at', { ascending: false })

    if (meetingData) {
      // Fetch attendees for all meetings
      const meetingIds = meetingData.map(m => m.id)
      const { data: attendeeData } = meetingIds.length > 0
        ? await supabase
            .from('meeting_attendees')
            .select('*, team_profiles:user_id(display_name)')
            .in('meeting_id', meetingIds)
        : { data: [] }

      const attendeesByMeeting: Record<string, MeetingAttendee[]> = {}
      ;(attendeeData || []).forEach((a: any) => {
        if (!attendeesByMeeting[a.meeting_id]) attendeesByMeeting[a.meeting_id] = []
        attendeesByMeeting[a.meeting_id].push({
          ...a,
          display_name: a.team_profiles?.display_name || 'Unknown',
        })
      })

      setMeetings(meetingData.map(m => ({
        ...m,
        agenda: m.agenda || [],
        attendees: attendeesByMeeting[m.id] || [],
      })))
    }

    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const addMeeting = async (meeting: Partial<Meeting>, attendeeIds: string[] = []) => {
    if (!currentOrg) return null
    const { data, error } = await supabase
      .from('meetings')
      .insert({ ...meeting, org_id: currentOrg.id })
      .select()
      .single()

    if (error) { console.error('Create meeting error:', error); return null }

    // Add attendees
    if (attendeeIds.length > 0 && data) {
      await supabase.from('meeting_attendees').insert(
        attendeeIds.map(uid => ({ meeting_id: data.id, user_id: uid }))
      )
    }

    await fetchData()
    return data
  }

  const updateMeeting = async (id: string, updates: Partial<Meeting>) => {
    const { error } = await supabase
      .from('meetings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) { console.error('Update meeting error:', error); return }

    setMeetings(prev => prev.map(m =>
      m.id === id ? { ...m, ...updates } as MeetingWithAttendees : m
    ))
  }

  const deleteMeeting = async (id: string) => {
    const { error } = await supabase.from('meetings').delete().eq('id', id)
    if (error) { console.error('Delete meeting error:', error); return }
    setMeetings(prev => prev.filter(m => m.id !== id))
  }

  const addRockReview = async (review: Partial<MeetingRockReview>) => {
    const { error } = await supabase.from('meeting_rock_reviews').insert(review)
    if (error) console.error('Add rock review error:', error)
  }

  return { meetings, loading, fetchData, addMeeting, updateMeeting, deleteMeeting, addRockReview }
}
