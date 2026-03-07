import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    // 1. Check if contact exists
    let contact_id: string | null = null
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', org_id)
      .eq('email', email)
      .single()

    if (existingContact) {
      contact_id = existingContact.id
    }

    // 2. Create podcast_conversion record
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

    // 3. Find linked appearance for show name
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
    }

    // 4. Auto-create outreach task
    const { error: taskError } = await supabase
      .from('tasks')
      .insert({
        org_id,
        title: `Personally reach out to ${name || email} from ${showName}`,
        description: `New podcast-attributed enrollment via ${promo_code || utm_campaign || 'UTM link'}. They heard you on ${showName} and just enrolled. Reach out within 24 hours.\n\nEmail: ${email}\nSource: ${promo_code ? `Promo code ${promo_code}` : `UTM campaign ${utm_campaign}`}`,
        priority: 'high',
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        source: 'media_appearance',
        contact_id,
      })

    if (taskError) {
      console.error('Failed to create outreach task:', taskError)
    }

    // 5. Send SMS notification via Twilio if configured
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
            Body: `New podcast lead: ${name || email} from ${showName}. Source: ${promo_code || utm_campaign || 'UTM'}`,
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
      task_error: taskError ? { message: taskError.message, code: taskError.code, details: taskError.details } : null,
      _version: '0e7105d',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('Podcast conversion webhook error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'podcast-conversion',
    description: 'POST with: org_id, email, name, utm_source, utm_campaign, utm_content, promo_code',
  })
}
