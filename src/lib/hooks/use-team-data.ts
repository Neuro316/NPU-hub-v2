'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { readOrgSettings, saveTeamSetting } from '@/lib/org-settings-client'
import { credentialFields, withoutCredentials } from '@/lib/org-vault-fields'

// The org_settings keys this hook's consumers read through getSetting (integrations, tasks, my-tasks). Read through
// GET /api/settings/read (2026-11-08): admin-only keys are left out for other users, credential fields come back blank.
export const TEAM_SETTING_KEYS = ['avatar_colors', 'slack_config', 'google_calendar', 'gmail', 'apps_script']

export interface TeamMember {
  id: string
  org_id: string
  user_id: string | null
  display_name: string
  email: string | null
  role: 'super_admin' | 'admin' | 'team_member' | 'facilitator' | 'participant'
  job_title: string | null
  avatar_url: string | null
  slack_user_id: string | null
  slack_display_name: string | null
  phone: string | null
  status: 'active' | 'invited' | 'inactive'
  permissions: Record<string, any>
  created_at: string
  updated_at: string
}

export interface OrgSetting {
  id: string
  org_id: string
  setting_key: string
  setting_value: Record<string, any>
}

export const ROLE_CONFIG = {
  super_admin: { label: 'Super Admin', color: '#EF4444', bg: '#FEE2E2', description: 'Full access to everything' },
  admin: { label: 'Admin', color: '#8B5CF6', bg: '#EDE9FE', description: 'Manage team and most features' },
  team_member: { label: 'Team Member', color: '#3B82F6', bg: '#DBEAFE', description: 'Standard access' },
  facilitator: { label: 'Facilitator', color: '#F59E0B', bg: '#FEF3C7', description: 'Program facilitation access' },
  participant: { label: 'Participant', color: '#6B7280', bg: '#F3F4F6', description: 'Read-only or minimal access' },
} as const

export function useTeamData() {
  const { currentOrg } = useWorkspace()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [settings, setSettings] = useState<OrgSetting[]>([])
  const [credentialsSet, setCredentialsSet] = useState<Record<string, Record<string, boolean>>>({})
  const [currentMemberRole, setCurrentMemberRole] = useState<string>('team_member')
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [memberRes, settingsRes, userRes] = await Promise.all([
      supabase.from('team_profiles').select('*').eq('org_id', currentOrg.id).order('display_name'),
      readOrgSettings(currentOrg.id, TEAM_SETTING_KEYS),
      supabase.auth.getUser(),
    ])

    if (memberRes.data) {
      setMembers(memberRes.data)
      const me = memberRes.data.find(m => m.user_id === userRes.data.user?.id)
      if (me) setCurrentMemberRole(me.role)
    }
    const orgId = currentOrg.id
    setSettings(Object.entries(settingsRes.settings).map(([setting_key, setting_value]) => ({
      id: `${orgId}:${setting_key}`, org_id: orgId, setting_key, setting_value,
    })))
    setCredentialsSet(settingsRes.credentialsSet)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  // team_profiles writes go through /api/team/members (hub_232: the browser may not write team_profiles, because the
  // table grants Hub access). Same { data, error } shape as before.
  const teamWrite = async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<{ data: any; error: { message: string } | null }> => {
    try {
      const r = await fetch('/api/team/members', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      return r.ok ? { data: j.data ?? null, error: null } : { data: null, error: { message: j.error || r.statusText } }
    } catch (e: any) {
      return { data: null, error: { message: e?.message || 'Save failed' } }
    }
  }

  const addMember = async (member: Partial<TeamMember>) => {
    if (!currentOrg) return
    const { data, error } = await teamWrite('POST', { org_id: currentOrg.id, member })
    if (data && !error) setMembers(prev => [...prev, data])
    return { data, error }
  }

  const updateMember = async (id: string, updates: Partial<TeamMember>) => {
    const { data, error } = await teamWrite('PATCH', { id, updates })
    if (data && !error) setMembers(prev => prev.map(m => m.id === id ? data : m))
    return { data, error }
  }

  const deleteMember = async (id: string) => {
    const { error } = await teamWrite('DELETE', { id })
    if (!error) setMembers(prev => prev.filter(m => m.id !== id))
    return { error }
  }

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || null
  }

  // Never writes a credential field: they are stripped here and saved through saveOrgCredential. A credential-bearing
  // key goes through PUT /api/settings, which keeps the stored credential fields (a browser upsert would replace the
  // whole value and drop them, e.g. slack_config.webhook_url, which the University reads).
  const saveSetting = async (key: string, value: Record<string, any>) => {
    if (!currentOrg) return
    const orgId = currentOrg.id
    const clean = withoutCredentials(key, value)
    let data: OrgSetting | null = null
    let error: { message: string } | null = null
    if (credentialFields(key).length) {
      try {
        const r = await fetch('/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: orgId, setting_key: key, setting_value: clean }),
        })
        if (r.ok) data = { id: `${orgId}:${key}`, org_id: orgId, setting_key: key, setting_value: clean }
        else error = { message: (await r.json().catch(() => ({})))?.error || r.statusText }
      } catch (e: any) {
        error = { message: e?.message || 'Save failed' }
      }
    } else {
      // everyday keys (avatar_colors) go through PUT /api/settings/team, open to any active Hub user (hub_232)
      try {
        await saveTeamSetting(orgId, key, clean)
        data = { id: `${orgId}:${key}`, org_id: orgId, setting_key: key, setting_value: clean }
      } catch (e: any) {
        error = { message: e?.message || 'Save failed' }
      }
    }
    if (data && !error) {
      const saved = data
      setSettings(prev => {
        const exists = prev.find(s => s.setting_key === key)
        if (exists) return prev.map(s => s.setting_key === key ? saved : s)
        return [...prev, saved]
      })
    }
    return { data, error }
  }

  const isSuperAdmin = currentMemberRole === 'super_admin'
  const isAdmin = currentMemberRole === 'super_admin' || currentMemberRole === 'admin'

  return {
    members, settings, credentialsSet, loading,
    currentMemberRole, isSuperAdmin, isAdmin,
    refresh: fetchData,
    addMember, updateMember, deleteMember,
    getSetting, saveSetting,
  }
}
