import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    let userId: string | null = null
    try {
      const supabase = createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    } catch {}

    const body = await req.json()
    const { orgId, name, description, programType, deliveryMethod, startDate, duration,
      facilitatorId, facilitatorName, enrollmentType, priceCents, publish } = body

    if (!orgId || !name) return NextResponse.json({ error: 'orgId and name required' }, { status: 400 })

    const admin = createAdminSupabase()
    const status = publish ? 'live' : 'draft'

    // 1. Create course record
    const { data: course, error: courseErr } = await admin.from('courses').insert({
      org_id: orgId, title: name, description, status,
    }).select().single()
    if (courseErr) return NextResponse.json({ error: 'Failed to create course: ' + courseErr.message }, { status: 500 })

    // 2. Create cohort record
    const { data: cohort, error: cohortErr } = await admin.from('cohorts').insert({
      org_id: orgId, name, status: status === 'live' ? 'active' : 'draft',
      start_date: startDate || null, facilitator_id: facilitatorId || null,
    }).select().single()
    if (cohortErr) return NextResponse.json({ error: 'Failed to create cohort: ' + cohortErr.message }, { status: 500 })

    // 3. Create program record (links everything)
    const { data: program, error: progErr } = await admin.from('programs').insert({
      org_id: orgId, name, description, program_type: programType, delivery_method: deliveryMethod,
      status, start_date: startDate || null, duration: duration || null,
      price_cents: priceCents || null, enrollment_type: enrollmentType,
      facilitator_id: facilitatorId || null, facilitator_name: facilitatorName || null,
      course_id: course.id, cohort_id: cohort.id, created_by: userId,
    }).select().single()
    if (progErr) return NextResponse.json({ error: 'Failed to create program: ' + progErr.message }, { status: 500 })

    // 4. Link cohort back to program
    await admin.from('cohorts').update({ program_id: program.id }).eq('id', cohort.id)

    // 5. Add facilitator as cohort member if assigned
    if (facilitatorId) {
      await admin.from('cohort_members').insert({
        cohort_id: cohort.id, user_id: facilitatorId, role: 'facilitator',
      })
    }

    return NextResponse.json({
      programId: program.id,
      cohortId: cohort.id,
      courseId: course.id,
    })
  } catch (e: any) {
    console.error('[programs/create] error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
