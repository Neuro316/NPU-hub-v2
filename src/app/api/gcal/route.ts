import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const maxDuration = 30

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/tasks',
].join(' ')

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
}

async function getTokens(userId: string) {
  const supabase = await getSupabase()
  const { data } = await supabase
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data
}

async function refreshAccessToken(userId: string, refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.access_token) {
    const supabase = await getSupabase()
    await supabase.from('user_google_tokens').upsert({
      user_id: userId,
      access_token: data.access_token,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scopes: GOOGLE_SCOPES.split(' '),
    }, { onConflict: 'user_id' })
    return data.access_token
  }
  return null
}

async function getValidToken(userId: string): Promise<string | null> {
  const tokens = await getTokens(userId)
  if (!tokens) return null
  if (tokens.expires_at && new Date(tokens.expires_at) > new Date()) return tokens.access_token
  if (tokens.refresh_token) return refreshAccessToken(userId, tokens.refresh_token)
  return null
}

async function googleFetch(token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    const { action } = body

    // ── OAuth: exchange code for tokens ──
    if (action === 'exchange_code') {
      const { code, redirect_uri } = body
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri,
          grant_type: 'authorization_code',
        }),
      })
      const data = await res.json()
      if (data.error) return NextResponse.json({ error: data.error_description || data.error })

      await supabase.from('user_google_tokens').upsert({
        user_id: user.id,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        scopes: GOOGLE_SCOPES.split(' '),
      }, { onConflict: 'user_id' })

      return NextResponse.json({ success: true })
    }

    // ── Check connection status ──
    if (action === 'status') {
      const tokens = await getTokens(user.id)
      return NextResponse.json({ connected: !!tokens?.access_token, hasRefresh: !!tokens?.refresh_token })
    }

    // ── Get auth URL ──
    if (action === 'auth_url') {
      const { redirect_uri } = body
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        redirect_uri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: 'npu_gcal',
      })
      return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    // ── Disconnect ──
    if (action === 'disconnect') {
      await supabase.from('user_google_tokens').delete().eq('user_id', user.id)
      return NextResponse.json({ success: true })
    }

    // All remaining actions need a valid token
    const token = await getValidToken(user.id)
    if (!token) return NextResponse.json({ error: 'not_connected', message: 'Google account not connected' })

    // ── Fetch Calendar Events ──
    if (action === 'calendar_events') {
      const { timeMin, timeMax } = body
      const min = timeMin || new Date().toISOString()
      const max = timeMax || new Date(Date.now() + 30 * 86400000).toISOString()
      
      // Get calendar list first
      const calendars = await googleFetch(token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList')
      
      const allEvents: any[] = []
      for (const cal of (calendars.items || []).slice(0, 10)) {
        try {
          const params = new URLSearchParams({
            timeMin: min, timeMax: max,
            singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
          })
          const events = await googleFetch(token, 
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`)
          for (const e of (events.items || [])) {
            allEvents.push({
              id: e.id,
              calendarId: cal.id,
              calendarName: cal.summary,
              calendarColor: cal.backgroundColor,
              title: e.summary || '(No title)',
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
              allDay: !e.start?.dateTime,
              location: e.location,
              description: e.description,
              htmlLink: e.htmlLink,
              status: e.status,
            })
          }
        } catch { /* skip inaccessible calendars */ }
      }
      
      return NextResponse.json({ events: allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()) })
    }

    // ── Create Calendar Event ──
    if (action === 'create_event') {
      const { calendarId, summary, description, start, end, allDay } = body
      const cid = calendarId || 'primary'
      const event: any = { summary, description }
      if (allDay) {
        event.start = { date: start }
        event.end = { date: end || start }
      } else {
        event.start = { dateTime: start }
        event.end = { dateTime: end }
      }
      
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
      const created = await res.json()
      return NextResponse.json({ event: created })
    }

    // ── Fetch Google Tasks ──
    if (action === 'task_lists') {
      const lists = await googleFetch(token, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists')
      
      const allTasks: any[] = []
      for (const list of (lists.items || [])) {
        try {
          const params = new URLSearchParams({ showCompleted: 'true', maxResults: '100' })
          const tasks = await googleFetch(token, 
            `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?${params}`)
          for (const t of (tasks.items || [])) {
            allTasks.push({
              id: t.id,
              listId: list.id,
              listName: list.title,
              title: t.title,
              notes: t.notes,
              due: t.due,
              status: t.status,
              completed: t.completed,
              updated: t.updated,
            })
          }
        } catch { /* skip */ }
      }
      
      return NextResponse.json({ 
        lists: (lists.items || []).map((l: any) => ({ id: l.id, title: l.title })),
        tasks: allTasks 
      })
    }

    // ── Create Google Task ──
    if (action === 'create_task') {
      const { listId, title, notes, due } = body
      const lid = listId || '@default'
      const task: any = { title, notes }
      if (due) task.due = new Date(due).toISOString()
      
      const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${lid}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      })
      const created = await res.json()
      return NextResponse.json({ task: created })
    }

    // ── Complete Google Task ──
    if (action === 'complete_task') {
      const { listId, taskId } = body
      const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      const updated = await res.json()
      return NextResponse.json({ task: updated })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}
