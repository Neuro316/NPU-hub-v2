'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useWorkspace } from '@/lib/workspace-context'
import { usePermissions } from '@/lib/hooks/use-permissions'
import { useSidebar } from '@/lib/sidebar-context'
import { createClient } from '@/lib/supabase-browser'
import {
  LogOut,
  ChevronDown,
  ChevronRight,
  Building2,
  HeartPulse,
  DollarSign,
  ClipboardList,
  FileCheck,
  Brain,
  UserCheck,
  ExternalLink,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { NotificationBell } from '@/components/notification-bell'
import { navCategories, applySidebarOrder } from '@/lib/nav-config'

/* EHR items */
interface EhrItem {
  label: string
  href: string
  icon: any
  requireModule?: string
  forAllOrgs?: boolean
  external?: boolean
}

const ehrItems: EhrItem[] = [
  { label: 'Client Records', href: '/ehr/ecr', icon: UserCheck, forAllOrgs: true },
  { label: 'NeuroReport', href: 'https://reports.neuroprogeny.com', icon: Brain, forAllOrgs: true, external: true },
  { label: 'Session Notes', href: '/ehr/sessions', icon: ClipboardList, forAllOrgs: true },
  { label: 'Forms', href: '/ehr/forms', icon: FileCheck, forAllOrgs: true },
  { label: 'Accounting', href: '/ehr/accounting', icon: DollarSign, requireModule: 'accounting' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, organizations, currentOrg, switchOrg, enabledModules, hiddenModules, sidebarOrder } = useWorkspace()
  const { canView, loading: permsLoading } = usePermissions()
  const { isCollapsed, isMobileOpen, toggleCollapse, closeMobile } = useSidebar()
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const orderedCategories = useMemo(
    () => applySidebarOrder(navCategories, sidebarOrder),
    [sidebarOrder]
  )

  const toggleCategory = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const handleNavClick = () => {
    // Close mobile sidebar on navigation
    if (isMobileOpen) closeMobile()
  }

  const orgSlug = currentOrg?.slug || ''
  const isClinicalOrg = orgSlug.includes('sensorium') || orgSlug.includes('neuro-progeny') || orgSlug.includes('neuro_progeny') || orgSlug.includes('nprogeny') || enabledModules.includes('ehr')

  const visibleEhrItems = ehrItems.filter(item => {
    if (item.requireModule && !enabledModules.includes(item.requireModule)) return false
    if (item.forAllOrgs && isClinicalOrg) return true
    if (item.requireModule && enabledModules.includes(item.requireModule)) return true
    return false
  })

  const showEhr = visibleEhrItems.length > 0
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-64'

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={closeMobile}
        />
      )}

      <aside className={`
        ${sidebarWidth} h-screen bg-white border-r border-gray-100 flex flex-col fixed left-0 top-0 z-50
        transition-all duration-200 ease-in-out
        ${isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Brand + Collapse Toggle */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-np-blue rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">NP</span>
            </div>
            {(!isCollapsed || isMobileOpen) && (
              <div className="flex-1 min-w-0">
                <h1 className="text-sm font-semibold text-np-dark">NPU Hub</h1>
                <p className="text-xs text-gray-400">Operations</p>
              </div>
            )}
            {(!isCollapsed || isMobileOpen) && <NotificationBell />}

            {/* Desktop collapse toggle */}
            <button
              onClick={toggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-np-dark transition-colors"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>

            {/* Mobile close button */}
            <button
              onClick={closeMobile}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Workspace Switcher */}
        {organizations.length > 1 && (!isCollapsed || isMobileOpen) && (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <button
                onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-np-dark truncate">
                    {currentOrg?.name || 'Select workspace'}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${orgDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {orgDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-50">
                  {organizations.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => {
                        switchOrg(org.id)
                        setOrgDropdownOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg
                        ${currentOrg?.id === org.id ? 'bg-np-blue/5 text-np-blue font-medium' : 'text-np-dark'}`}
                    >
                      {org.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3">
          {orderedCategories.map((category) => {
            const visibleItems = category.items.filter(item => canView(item.moduleKey) && !hiddenModules.includes(item.moduleKey))
            if (visibleItems.length === 0) return null

            const isCatCollapsed = collapsed[category.id] && category.collapsible
            const showLabels = !isCollapsed || isMobileOpen

            return (
              <div key={category.id} className="mb-1">
                {category.label && showLabels && (
                  <button
                    onClick={() => category.collapsible && toggleCategory(category.id)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 mt-2 mb-0.5
                      ${category.collapsible ? 'cursor-pointer hover:bg-gray-50 rounded-md' : 'cursor-default'}`}
                  >
                    <span className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">
                      {category.label}
                    </span>
                    {category.collapsible && (
                      <ChevronRight
                        className={`w-3 h-3 text-gray-300 transition-transform duration-200
                          ${!isCatCollapsed ? 'rotate-90' : ''}`}
                      />
                    )}
                  </button>
                )}

                {/* Collapsed divider */}
                {category.label && !showLabels && (
                  <div className="h-px bg-gray-100 my-2 mx-2" />
                )}

                {!isCatCollapsed && (
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const Icon = item.icon
                      const isActive = pathname === item.href ||
                        (item.href !== '/' && pathname.startsWith(item.href))

                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          onClick={handleNavClick}
                          title={!showLabels ? item.label : undefined}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                            ${showLabels ? '' : 'justify-center'}
                            ${isActive
                              ? 'bg-np-blue/10 text-np-blue font-medium'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-np-dark'
                            }`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          {showLabels && <span>{item.label}</span>}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* EHR / Clinical Section */}
          {showEhr && (
            <div className="mb-1">
              {(!isCollapsed || isMobileOpen) ? (
                <button
                  onClick={() => toggleCategory('ehr')}
                  className="w-full flex items-center justify-between px-3 py-1.5 mt-2 mb-0.5 cursor-pointer hover:bg-gray-50 rounded-md"
                >
                  <span className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase flex items-center gap-1.5">
                    <HeartPulse className="w-3 h-3" />
                    EHR
                  </span>
                  <ChevronRight
                    className={`w-3 h-3 text-gray-300 transition-transform duration-200
                      ${!collapsed['ehr'] ? 'rotate-90' : ''}`}
                  />
                </button>
              ) : (
                <div className="h-px bg-gray-100 my-2 mx-2" />
              )}

              {!collapsed['ehr'] && (
                <div className="space-y-0.5">
                  {visibleEhrItems.map((item) => {
                    const Icon = item.icon
                    const isActive = !item.external && pathname.startsWith(item.href)
                    const showLabels = !isCollapsed || isMobileOpen

                    if (item.external) {
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={handleNavClick}
                          title={!showLabels ? item.label : undefined}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-gray-600 hover:bg-gray-50 hover:text-np-dark ${showLabels ? '' : 'justify-center'}`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          {showLabels && <span className="flex-1">{item.label}</span>}
                          {showLabels && <ExternalLink className="w-3 h-3 text-gray-300" />}
                        </a>
                      )
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={handleNavClick}
                        title={!showLabels ? item.label : undefined}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                          ${showLabels ? '' : 'justify-center'}
                          ${isActive
                            ? 'bg-np-blue/10 text-np-blue font-medium'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-np-dark'
                          }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {showLabels && <span>{item.label}</span>}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* User / Sign Out */}
        <div className="p-3 border-t border-gray-100">
          <div className={`flex items-center gap-3 px-3 py-2 ${isCollapsed && !isMobileOpen ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-np-blue/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-np-blue">
                {user?.email?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
            {(!isCollapsed || isMobileOpen) && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-np-dark truncate">
                  {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-np-dark transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
