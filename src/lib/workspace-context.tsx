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
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  user: null,
  organizations: [],
  currentOrg: null,
  switchOrg: () => {},
  loading: true,
})

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)

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

          // Check URL param first (from cross-app navigation), then localStorage
          const urlOrg = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('org')
            : null
          const lastOrgId = urlOrg
            || (typeof window !== 'undefined' ? localStorage.getItem('npu_hub_current_org') : null)
          // Save the URL org to localStorage so it persists
          if (urlOrg && typeof window !== 'undefined') {
            localStorage.setItem('npu_hub_current_org', urlOrg)
          }

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
    }
  }, [organizations])

  return (
    <WorkspaceContext.Provider value={{ user, organizations, currentOrg, switchOrg, loading }}>
      {children}
    </WorkspaceContext.Provider>
  )
}
