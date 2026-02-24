import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { org_id } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  // Verify requesting user is authenticated
  const userSb = createServerSupabase()
  const { data: { user } } = await userSb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminSupabase()

  // Verify user belongs to requesting org
  const { data: membership } = await admin.from('org_members').select('id').eq('user_id', user.id).eq('org_id', org_id).single()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })

  // Load cross-org sharing rules for this org
  const { data: setting } = await admin.from('org_settings').select('setting_value')
    .eq('org_id', org_id).eq('setting_key', 'cross_org_contact_sharing').single()

  if (!setting?.setting_value?.receive_from?.length) {
    return NextResponse.json({ contacts: [], rules: [] })
  }

  const rules = setting.setting_value.receive_from as Array<{
    org_id: string; org_name: string; tags: string[]; enabled: boolean
  }>

  const activeRules = rules.filter(r => r.enabled && r.tags.length > 0)
  if (activeRules.length === 0) return NextResponse.json({ contacts: [], rules })

  // For each rule, verify user has access to source org too
  const allContacts: any[] = []

  for (const rule of activeRules) {
    const { data: srcMembership } = await admin.from('org_members').select('id')
      .eq('user_id', user.id).eq('org_id', rule.org_id).single()
    if (!srcMembership) continue // user doesn't have access to source org

    // Normalize tags to lowercase for matching
    const normalizedTags = rule.tags.map(t => t.toLowerCase().trim())

    // Fetch contacts from source org — using admin to bypass RLS
    const { data: contacts } = await admin.from('contacts')
      .select('*')
      .eq('org_id', rule.org_id)
      .is('merged_into_id', null)
      .is('archived_at', null)
      .limit(200)

    if (contacts) {
      // Filter client-side for case-insensitive tag matching
      const matched = contacts.filter(c => {
        if (!c.tags || !Array.isArray(c.tags)) return false
        return c.tags.some((t: string) => normalizedTags.includes(t.toLowerCase().trim()))
      })

      // Add source metadata
      matched.forEach(c => {
        allContacts.push({
          ...c,
          _cross_org: true,
          _source_org_id: rule.org_id,
          _source_org_name: rule.org_name,
          _matched_tags: c.tags.filter((t: string) =>
            normalizedTags.includes(t.toLowerCase().trim())
          ),
        })
      })
    }
  }

  return NextResponse.json({ contacts: allContacts, rules })
}
