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

  // ═══ Chain-aware delete ═══
  // Repairs prev/next links so carry-forward isn't broken:
  //   [A] → [B (deleting)] → [C]  becomes  [A] → [C]
  // Migrates deferred action items from deleted meeting into the next meeting.
  const deleteMeeting = async (id: string) => {
    // 1. Load chain pointers + action items
    const { data: target } = await supabase
      .from('meetings')
      .select('id, prev_meeting_id, next_meeting_id, action_items')
      .eq('id', id)
      .single()

    if (!target) {
      await supabase.from('meetings').delete().eq('id', id)
      setMeetings(prev => prev.filter(m => m.id !== id))
      return
    }

    const prevId = target.prev_meeting_id as string | null
    const nextId = target.next_meeting_id as string | null
    const targetActions = (target.action_items || []) as any[]
    const deferredItems = targetActions.filter((a: any) => a.status === 'deferred')

    // 2. Repair the chain
    if (prevId && nextId) {
      // Middle of chain: stitch prev → next
      await supabase.from('meetings').update({
        next_meeting_id: nextId, updated_at: new Date().toISOString(),
      }).eq('id', prevId)
      await supabase.from('meetings').update({
        prev_meeting_id: prevId, updated_at: new Date().toISOString(),
      }).eq('id', nextId)
    } else if (prevId && !nextId) {
      // End of chain: clear prev's forward pointer
      await supabase.from('meetings').update({
        next_meeting_id: null, updated_at: new Date().toISOString(),
      }).eq('id', prevId)
    } else if (!prevId && nextId) {
      // Start of chain: clear next's back pointer
      await supabase.from('meetings').update({
        prev_meeting_id: null, updated_at: new Date().toISOString(),
      }).eq('id', nextId)
    }

    // 3. Migrate deferred items to next meeting
    if (nextId && deferredItems.length > 0) {
      const { data: nextMeeting } = await supabase
        .from('meetings')
        .select('action_items')
        .eq('id', nextId)
        .single()

      if (nextMeeting) {
        const existingActions = (nextMeeting.action_items || []) as any[]
        const existingIds = new Set(existingActions.map((a: any) => a.id))
        const newItems = deferredItems.filter((d: any) => !existingIds.has(d.id))
        if (newItems.length > 0) {
          await supabase.from('meetings').update({
            action_items: [...existingActions, ...newItems.map((d: any) => ({ ...d, status: 'pending' }))],
            updated_at: new Date().toISOString(),
          }).eq('id', nextId)
        }
      }
    }

    // 4. Clean up related records, then delete meeting
    await supabase.from('meeting_attendees').delete().eq('meeting_id', id)
    await supabase.from('meeting_rock_reviews').delete().eq('meeting_id', id)
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
