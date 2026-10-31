// src/lib/quick-send-server.ts
// Database reads shared by the Quick Send routes (service role, behind withStaff).
// Every read is scoped to one org the caller already passed requireOrg for.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  QUICK_SEND_SETTING_KEY, readQuickSendSettings,
  type QuickSendCategory, type QuickSendResource, type QuickSendSettings,
} from '@/lib/quick-send'

export const MEDIA_BUCKET = 'media-library'

// The media upload route's brand mapping (media_assets.brand CHECK: np, sensorium, both).
const SENSORIUM_ORG_ID = 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629'
export const brandForOrg = (orgId: string) => (orgId === SENSORIUM_ORG_ID ? 'sensorium' : 'np')

export async function loadCategories(db: SupabaseClient, orgId: string): Promise<QuickSendCategory[]> {
  const { data, error } = await db.from('hub_quick_send_categories')
    .select('id, name, sort_order').eq('org_id', orgId).is('archived_at', null)
    .order('sort_order').order('name')
  if (error) throw new Error(error.message)
  return (data || []) as QuickSendCategory[]
}

/** Quick Send rows joined to their media assets, archived ones left out, with send counts. */
export async function loadResources(db: SupabaseClient, orgId: string): Promise<QuickSendResource[]> {
  const [{ data, error }, { data: sends, error: sErr }] = await Promise.all([
    db.from('hub_quick_send_items')
      .select('media_asset_id, category_id, available, description, archived_at, media_assets!inner(name, mime_type, file_size, storage_path, url, org_id)')
      .eq('org_id', orgId).is('archived_at', null),
    db.from('hub_quick_send_sends').select('media_asset_id').eq('org_id', orgId).eq('status', 'sent'),
  ])
  if (error) throw new Error(error.message)
  if (sErr) throw new Error(sErr.message)
  const counts = new Map<string, number>()
  for (const s of sends || []) if (s.media_asset_id) counts.set(s.media_asset_id, (counts.get(s.media_asset_id) || 0) + 1)
  return (data || [])
    // The asset must be this org's too, not only the Quick Send row.
    .filter((r: any) => r.media_assets?.org_id === orgId)
    .map((r: any) => ({
      media_asset_id: r.media_asset_id,
      category_id: r.category_id,
      available: r.available === true,
      description: r.description,
      archived_at: r.archived_at,
      name: r.media_assets.name,
      mime_type: r.media_assets.mime_type,
      file_size: r.media_assets.file_size,
      storage_path: r.media_assets.storage_path,
      url: r.media_assets.url,
      sends: counts.get(r.media_asset_id) || 0,
    }))
}

export async function loadSettings(db: SupabaseClient, orgId: string): Promise<{ settings: QuickSendSettings | null; raw: Record<string, unknown> }> {
  const [{ data: row }, { data: org }] = await Promise.all([
    db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', QUICK_SEND_SETTING_KEY).maybeSingle(),
    db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  const raw = (row?.setting_value && typeof row.setting_value === 'object' && !Array.isArray(row.setting_value)) ? row.setting_value : {}
  return { settings: readQuickSendSettings(raw, org?.name || 'Our team'), raw }
}

/** The sending staff member: name and email from their team profile in this org. */
export async function loadSender(db: SupabaseClient, orgId: string, userId: string): Promise<{ name: string; email: string | null }> {
  const { data: tp } = await db.from('team_profiles').select('display_name, email')
    .eq('org_id', orgId).eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle()
  let email: string | null = tp?.email || null
  let name: string = tp?.display_name || ''
  if (!email || !name) {
    const { data: prof } = await db.from('profiles').select('email, full_name').eq('id', userId).maybeSingle()
    email = email || prof?.email || null
    name = name || prof?.full_name || ''
  }
  return { name, email }
}

/** A category of this org, live. */
export async function categoryInOrg(db: SupabaseClient, orgId: string, categoryId: unknown): Promise<boolean> {
  if (typeof categoryId !== 'string') return false
  const { data } = await db.from('hub_quick_send_categories').select('id')
    .eq('id', categoryId).eq('org_id', orgId).is('archived_at', null).maybeSingle()
  return !!data
}
