import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// This endpoint is called by NPU University when someone enrolls
// via a podcast UTM link or promo code. It must be EXCLUDED from
// auth middleware (add to matcher exclusion in middleware.ts).

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      org_id,
      email,
      name,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      promo_code,
      conversion_type = 'course_enroll',
      value = 0,
    } = body

    if (!org_id || !email) {
      return NextResponse.json(
        { error: 'org_id and email are required' },
        { status: 400 }
      )
    }

    // Only process podcast-attributed conversions
    if (utm_source !== 'podcast' && !promo_code?.startsWith('PODCAST-')) {
      return NextResponse.json(
        { message: 'Not a podcast conversion, skipping' },
        { status: 200 }
      )
    }

    // 1. Check if contact exists, create if not
    let contact_id: string | null = null
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', org_id)
      .eq('email', email)
      .single()

    if (existingContact) {
      contact_id = existingContact.id

      // Add podcast-lead tag if not present
      try {
        await supabase.rpc('add_contact_tag', {
          p_contact_id: contact_id,
          p_tag: 'podcast-lead'
        })
      } catch {
        // RPC might not exist yet, that's ok
      }
    }

    // 2. Create podcast_conversion record
    // The auto_link_podcast_conversion trigger will match to appearance
    const { data: conversion, error: convError } = await supabase
      .from('podcast_conversions')
      .insert({
        org_id,
        contact_id,
        contact_name: name || null,
        contact_email: email,
        conversion_type,
        source: promo_code ? 'promo_code' : 'utm',
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        promo_code: promo_code || null,
        value: value || 0,
        personal_outreach_status: 'pending',
        notified: false,
      })
      .select()
      .single()

    if (convError) {
      console.error('Failed to create conversion:', convError)
      return NextResponse.json(
        { error: 'Failed to create conversion record' },
        { status: 500 }
      )
    }

    // 3. Find the linked appearance (set by trigger) to get show name
    let showName = utm_campaign || promo_code || 'Unknown show'
    if (conversion?.appearance_id) {
      const { data: appearance } = await supabase
        .from('media_appearances')
        .select('platform, host')
        .eq('id', conversion.appearance_id)
        .single()

      if (appearance) {
        showName = appearance.platform || showName
      }

      // Update appearance metrics
      try {
        await supabase.rpc('increment_field', {
          table_name: 'media_appearances',
          row_id: conversion.appearance_id,
          field_name: conversion_type === 'course_enroll' ? 'tasks_created' : 'social_posts_count',
          increment_by: 0, // Just trigger updated_at
        })
      } catch {
        // RPC might not exist yet
      }
    }

    // 4. Auto-create outreach task in tasks table
    const { error: taskError } = await supabase
      .from('tasks')
      .insert({
        org_id,
        title: `Personally reach out to ${name || email} from ${showName}`,
        description: `New podcast-attributed enrollment via ${promo_code || utm_campaign || 'UTM link'}. They heard you on ${showName} and just enrolled. Reach out within 24 hours — this is a warm lead.\n\nEmail: ${email}\nSource: ${promo_code ? `Promo code ${promo_code}` : `UTM campaign ${utm_campaign}`}`,
        status: 'todo',
        priority: 'high',
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Due in 24h
        source: 'media_appearance',
        source_id: conversion?.appearance_id || null,
        contact_id: contact_id,
        metadata: {
          podcast_conversion_id: conversion?.id,
          auto_generated: true,
          conversion_type,
        },
      })

    if (taskError) {
      console.error('Failed to create outreach task:', taskError)
      // Don't fail the whole request for this
    }

    // 5. Send SMS notification via Twilio (if configured)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_PHONE_NUMBER && process.env.NOTIFICATION_PHONE) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`
        const twilioAuth = Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64')

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: process.env.TWILIO_PHONE_NUMBER,
            To: process.env.NOTIFICATION_PHONE,
            Body: `🎙️ New podcast lead: ${name || email} from ${showName}. Reach out within 24h. Source: ${promo_code || utm_campaign || 'UTM'}`,
          }),
        })
      } catch (smsErr) {
        console.error('SMS notification failed:', smsErr)
      }
    }

    return NextResponse.json({
      success: true,
      conversion_id: conversion?.id,
      appearance_id: conversion?.appearance_id,
      task_created: !taskError,
    })
  } catch (err: any) {
    console.error('Podcast conversion webhook error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'podcast-conversion',
    description: 'POST with: org_id, email, name, utm_source, utm_campaign, utm_content, promo_code',
  })
}
