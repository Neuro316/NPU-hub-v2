import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NP_ORG_ID = '00000000-0000-0000-0000-000000000001'
const PIPELINE_ID = 'pipeline-1771530511407'

const INTERNAL_EMAILS = [
  'cameron@neuroprogeny.com',
  'shane@neuroprogeny.com',
  'laura@neuroprogeny.com',
  'paul@neuroprogeny.com',
  'admin@sensoriumneuro.com',
]

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all xReg participants
  const { data: xregParticipants, error: fetchErr } = await supabase
    .from('np_hrv_participant_map')
    .select('id, xreg_user_id, xreg_user_email, xreg_user_name')
    .not('xreg_user_email', 'is', null)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!xregParticipants?.length) return NextResponse.json({ message: 'No participants found', synced: 0 })

  // Filter out internal team
  const external = xregParticipants.filter(
    p => p.xreg_user_email && !INTERNAL_EMAILS.includes(p.xreg_user_email.toLowerCase())
  )

  // Get existing contact emails to avoid duplicates
  const emails = external.map(p => p.xreg_user_email!.toLowerCase())
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('email')
    .in('email', emails)

  const existingEmails = new Set((existingContacts || []).map(c => c.email?.toLowerCase()))

  const results: any[] = []

  for (const p of external) {
    const email = p.xreg_user_email!.toLowerCase()

    if (existingEmails.has(email)) {
      // Update existing contact with neuroreport link
      const { error: updateErr } = await supabase
        .from('contacts')
        .update({
          neuroreport_linked: true,
          neuroreport_linked_at: new Date().toISOString(),
          neuroreport_program: 'xRegulation',
          source: 'xregulation',
        })
        .eq('email', email)
        .eq('org_id', NP_ORG_ID)

      results.push({ email, status: updateErr ? 'error' : 'updated', error: updateErr?.message })
      continue
    }

    // Split name
    const nameParts = (p.xreg_user_name || '').trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''

    // Create new contact
    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        org_id: NP_ORG_ID,
        first_name: firstName,
        last_name: lastName,
        email: email,
        pipeline_id: PIPELINE_ID,
        pipeline_stage: 'Signed up',
        tags: ['xRegulation'],
        auto_tags: ['xRegulation'],
        neuroreport_linked: true,
        neuroreport_linked_at: new Date().toISOString(),
        neuroreport_program: 'xRegulation',
        source: 'xregulation',
        notes: `Auto-synced from xRegulation participant map (xreg_id: ${p.xreg_user_id})`,
      })
      .select('id')
      .single()

    if (insertErr) {
      results.push({ email, status: 'error', error: insertErr.message })
    } else {
      existingEmails.add(email) // prevent dupe if same email appears twice
      results.push({ email, name: p.xreg_user_name, status: 'created', contact_id: newContact?.id })
    }
  }

  const created = results.filter(r => r.status === 'created').length
  const updated = results.filter(r => r.status === 'updated').length
  const errors = results.filter(r => r.status === 'error').length

  return NextResponse.json({ synced: created, updated, errors, total: external.length, results })
}