'use client'

import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'

// Permission levels for modules (matches member-detail.tsx)
type ModuleLevel = 'none' | 'view' | 'edit'

interface PermissionsContextType {
  loading: boolean
  role: string | null
  permissions: Record<string, any>
  /** Can the user see this module's sidebar link / page? */
  canView: (moduleKey: string) => boolean
  /** Can the user edit content in this module? */
  canEdit: (moduleKey: string) => boolean
  /** Is the user admin or super_admin? */
  isAdmin: boolean
  /** Check a specific AI sub-permission */
  hasAiPerm: (key: string) => boolean
  /** Raw team member record */
  member: any | null
}

const PermissionsContext = createContext<PermissionsContextType>({
  loading: true,
  role: null,
  permissions: {},
  canView: () => true,
  canEdit: () => true,
  isAdmin: true,
  hasAiPerm: () => false,
  member: null,
})

export function usePermissions() {
  return useContext(PermissionsContext)
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user, currentOrg } = useWorkspace()
  const [member, setMember] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!user || !currentOrg) { setLoading(false); return }

    supabase
      .from('team_profiles')
      .select('*')
      .eq('org_id', currentOrg.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMember(data)
        setLoading(false)
      })
  }, [user?.id, currentOrg?.id])

  const role = member?.role || null
  const permissions = member?.permissions || {}
  const isAdmin = role === 'super_admin' || role === 'admin'

  const getModuleLevel = useCallback((moduleKey: string): ModuleLevel => {
    // Admins always have full access
    if (isAdmin) return 'edit'
    // If no permissions set at all, default to view (backwards compat)
    if (!permissions.modules) return 'view'
    return permissions.modules[moduleKey] || 'none'
  }, [isAdmin, permissions])

  const canView = useCallback((moduleKey: string): boolean => {
    // No member record found = org owner or first user, grant full access
    if (!member) return true
    const level = getModuleLevel(moduleKey)
    return level === 'view' || level === 'edit'
  }, [member, getModuleLevel])

  const canEdit = useCallback((moduleKey: string): boolean => {
    if (!member) return true
    return getModuleLevel(moduleKey) === 'edit'
  }, [member, getModuleLevel])

  const hasAiPerm = useCallback((key: string): boolean => {
    if (isAdmin) return true
    return permissions.ai_advisory?.[key] ?? false
  }, [isAdmin, permissions])

  return (
    <PermissionsContext.Provider value={{ loading, role, permissions, canView, canEdit, isAdmin, hasAiPerm, member }}>
      {children}
    </PermissionsContext.Provider>
  )
}

/** Wrapper component that hides children if user lacks permission */
export function PermissionGate({ module, level = 'view', fallback, children }: {
  module: string
  level?: 'view' | 'edit'
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const { loading, canView, canEdit } = usePermissions()
  if (loading) return null
  const allowed = level === 'edit' ? canEdit(module) : canView(module)
  if (!allowed) return fallback ?? (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-600">Access Restricted</p>
      <p className="text-xs text-gray-400 mt-1">You don't have permission to {level === 'edit' ? 'edit' : 'view'} this module.</p>
      <p className="text-xs text-gray-400">Contact your admin to request access.</p>
    </div>
  )
  return <>{children}</>
}
