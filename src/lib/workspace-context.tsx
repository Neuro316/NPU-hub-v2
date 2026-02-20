'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

interface Organization {
  id: string
  name: string
  slug: string
}

interface WorkspaceContextType {
  user: User | null
  organizations: Organization[]
  currentOrg: Organization | null
  switchOrg: (orgId: string) => void
  loading: boolean
  enabledModules: string[]
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  user: null,
  organizations: [],
  currentOrg: null,
  switchOrg: () => {},
  loading: true,
  enabledModules: [],
})

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [enabledModules, setEnabledModules] = useState<string[]>([])

  const supabase = createClient()

  useEffect(() => {
    async function init() {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        // Get user's organizations through org_members
        const { data: memberships } = await supabase
          .from('org_members')
          .select('organization:organizations(id, name, slug)')
          .eq('user_id', user.id)

        if (memberships && memberships.length > 0) {
          const orgs = memberships
            .map((m: any) => m.organization)
            .filter(Boolean) as Organization[]
          
          setOrganizations(orgs)

          // Restore last workspace or use first
          const lastOrgId = typeof window !== 'undefined' 
            ? localStorage.getItem('npu_hub_current_org') 
            : null
          const savedOrg = orgs.find(o => o.id === lastOrgId)
          setCurrentOrg(savedOrg || orgs[0])

          // Auto-create team profile if missing
          const targetOrg = savedOrg || orgs[0]
          if (targetOrg) {
            const { data: existingProfile } = await supabase
              .from('team_profiles')
              .select('id')
              .eq('org_id', targetOrg.id)
              .eq('user_id', user.id)
              .maybeSingle()
            
            if (!existingProfile) {
              await supabase.from('team_profiles').insert({
                org_id: targetOrg.id,
                user_id: user.id,
                display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'New Member',
                email: user.email,
                role: 'team_member',
                status: 'active',
              })
            }
          }
        } else {
          // No memberships: auto-join the default org
          const { data: allOrgs } = await supabase
            .from('organizations')
            .select('id, name, slug')
            .limit(1)
            .single()

          if (allOrgs) {
            // Add user to org_members
            await supabase.from('org_members').insert({
              org_id: allOrgs.id,
              user_id: user.id,
              role: 'member',
            })

            // Create team profile
            await supabase.from('team_profiles').insert({
              org_id: allOrgs.id,
              user_id: user.id,
              display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'New Member',
              email: user.email,
              role: 'team_member',
              status: 'active',
            })

            setOrganizations([allOrgs])
            setCurrentOrg(allOrgs)

            // Auto-send team welcome email
            try {
              const { data: brandData } = await supabase
                .from('brand_profiles')
                .select('guidelines')
                .eq('org_id', allOrgs.id)
                .eq('brand_key', 'np')
                .single()

              const templates = brandData?.guidelines?.email_templates || []
              const welcomeTmpl = templates.find((t: any) => t.trigger === 'team_join' && t.enabled)

              if (welcomeTmpl && user.email) {
                const recipientName = user.user_metadata?.full_name || user.email.split('@')[0] || 'there'
                fetch('/api/send-resources', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    recipientName,
                    recipientEmail: user.email,
                    personalNote: welcomeTmpl.body
                      .replace(/\{\{recipientName\}\}/g, recipientName)
                      .replace(/\{\{senderName\}\}/g, 'Cameron Allen'),
                    resources: [{ name: 'NPU Hub', url: 'https://hub.neuroprogeny.com', type: 'link' }],
                    cardName: 'Team Welcome',
                    orgId: allOrgs.id,
                    useSenderFromSettings: true,
                  }),
                }).catch(() => {}) // fire and forget
              }
            } catch {} // non-blocking
          }
        }
      }

      setLoading(false)
    }

    init()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const switchOrg = useCallback((orgId: string) => {
    const org = organizations.find(o => o.id === orgId)
    if (org) {
      setCurrentOrg(org)
      localStorage.setItem('npu_hub_current_org', orgId)
      // Reset to dashboard to prevent viewing stale data from the previous org
      if (window.location.pathname !== '/') {
        window.location.href = '/'
      }
    }
  }, [organizations])

  // Load enabled modules when org changes
  useEffect(() => {
    if (!currentOrg) { setEnabledModules([]); return }
    supabase
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', currentOrg.id)
      .eq('setting_key', 'enabled_modules')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.setting_value && Array.isArray(data.setting_value)) {
          setEnabledModules(data.setting_value)
        } else {
          setEnabledModules([])
        }
      })
  }, [currentOrg?.id])

  return (
    <WorkspaceContext.Provider value={{ user, organizations, currentOrg, switchOrg, loading, enabledModules }}>
      {children}
    </WorkspaceContext.Provider>
  )
}
