'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

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
  const [currentMemberRole, setCurrentMemberRole] = useState<string>('team_member')
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    const [memberRes, settingsRes, userRes] = await Promise.all([
      supabase.from('team_profiles').select('*').eq('org_id', currentOrg.id).order('display_name'),
      supabase.from('org_settings').select('*').eq('org_id', currentOrg.id),
      supabase.auth.getUser(),
    ])

    if (memberRes.data) {
      setMembers(memberRes.data)
      const me = memberRes.data.find(m => m.user_id === userRes.data.user?.id)
      if (me) setCurrentMemberRole(me.role)
    }
    if (settingsRes.data) setSettings(settingsRes.data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const addMember = async (member: Partial<TeamMember>) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('team_profiles')
      .insert({ org_id: currentOrg.id, ...member })
      .select().single()
    if (data && !error) setMembers(prev => [...prev, data])
    return { data, error }
  }

  const updateMember = async (id: string, updates: Partial<TeamMember>) => {
    const { data, error } = await supabase
      .from('team_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data && !error) setMembers(prev => prev.map(m => m.id === id ? data : m))
    return { data, error }
  }

  const deleteMember = async (id: string) => {
    const { error } = await supabase.from('team_profiles').delete().eq('id', id)
    if (!error) setMembers(prev => prev.filter(m => m.id !== id))
    return { error }
  }

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || null
  }

  const saveSetting = async (key: string, value: Record<string, any>) => {
    if (!currentOrg) return
    const { data, error } = await supabase
      .from('org_settings')
      .upsert({ org_id: currentOrg.id, setting_key: key, setting_value: value, updated_at: new Date().toISOString() }, { onConflict: 'org_id,setting_key' })
      .select().single()
    if (data && !error) {
      setSettings(prev => {
        const exists = prev.find(s => s.setting_key === key)
        if (exists) return prev.map(s => s.setting_key === key ? data : s)
        return [...prev, data]
      })
    }
    return { data, error }
  }

  const isSuperAdmin = currentMemberRole === 'super_admin'
  const isAdmin = currentMemberRole === 'super_admin' || currentMemberRole === 'admin'

  return {
    members, settings, loading,
    currentMemberRole, isSuperAdmin, isAdmin,
    refresh: fetchData,
    addMember, updateMember, deleteMember,
    getSetting, saveSetting,
  }
}
