'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useWorkspace } from '@/lib/workspace-context'
import { usePermissions } from '@/lib/hooks/use-permissions'
import { createClient } from '@/lib/supabase-browser'
import {
  LayoutDashboard,
  Route,
  CheckSquare,
  Brain,
  FileText,
  Lightbulb,
  Users,
  Target,
  Megaphone,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Building2,
  BookOpen,
  Mic,
  TicketCheck,
  Activity,
  Image,
  Rocket,
  Contact2,
  HeartPulse,
  DollarSign,
  ClipboardList,
} from 'lucide-react'

/* ─────────────────────────────────────────────────────
   Category-grouped navigation
   moduleKey must match keys in member-detail.tsx MODULES array
   ───────────────────────────────────────────────────── */

interface NavItem {
  label: string
  href: string
  icon: any
  moduleKey: string
}

interface NavCategory {
  id: string
  label: string
  collapsible: boolean
  items: NavItem[]
}

const navCategories: NavCategory[] = [
  {
    id: 'home',
    label: '',
    collapsible: false,
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, moduleKey: 'dashboard' },
    ],
  },
  {
    id: 'grow',
    label: 'GROW',
    collapsible: true,
    items: [
      { label: 'CRM', href: '/crm', icon: Contact2, moduleKey: 'crm' },
      { label: 'Campaigns', href: '/campaigns', icon: Megaphone, moduleKey: 'campaigns' },
      { label: 'ICP Profiles', href: '/icps', icon: Users, moduleKey: 'icps' },
      { label: 'Analytics', href: '/analytics', icon: BarChart3, moduleKey: 'analytics' },
    ],
  },
  {
    id: 'create',
    label: 'CREATE',
    collapsible: true,
    items: [
      { label: 'Social Media', href: '/social', icon: Target, moduleKey: 'social' },
      { label: 'Media Library', href: '/media', icon: Image, moduleKey: 'media' },
      { label: 'Calendar', href: '/calendar', icon: Calendar, moduleKey: 'calendar' },
      { label: 'ShipIt Journal', href: '/shipit', icon: Rocket, moduleKey: 'shipit' },
      { label: 'Ideas', href: '/ideas', icon: Lightbulb, moduleKey: 'ideas' },
      { label: 'Company Library', href: '/library', icon: BookOpen, moduleKey: 'library' },
    ],
  },
  {
    id: 'operate',
    label: 'OPERATE',
    collapsible: true,
    items: [
      { label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },
      { label: 'Journey Builder', href: '/journeys', icon: Route, moduleKey: 'journeys' },
      { label: 'SOPs', href: '/sops', icon: FileText, moduleKey: 'sops' },
      { label: 'Support Tickets', href: '/tickets', icon: TicketCheck, moduleKey: 'tickets' },
      { label: 'Media Appearances', href: '/media-appearances', icon: Mic, moduleKey: 'media_appearances' },
    ],
  },
  {
    id: 'intelligence',
    label: 'INTELLIGENCE',
    collapsible: false,
    items: [
      { label: 'AI Advisory', href: '/advisory', icon: Brain, moduleKey: 'advisory' },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    collapsible: true,
    items: [
      { label: 'Team', href: '/team', icon: Users, moduleKey: 'team' },
      { label: 'Integrations', href: '/integrations', icon: Activity, moduleKey: 'integrations' },
      { label: 'Settings', href: '/settings', icon: Settings, moduleKey: 'settings' },
    ],
  },
]

/* EHR items are conditional on org and feature flags */
interface EhrItem {
  label: string
  href: string
  icon: any
  requireModule?: string   // feature flag from enabled_modules
  forAllOrgs?: boolean     // true = show for any org (NP + Sensorium)
}

const ehrItems: EhrItem[] = [
  { label: 'NeuroReport', href: '/ehr/neuroreport', icon: Brain, forAllOrgs: true },
  { label: 'Session Notes', href: '/ehr/sessions', icon: ClipboardList, forAllOrgs: true },
  { label: 'Accounting', href: '/ehr/accounting', icon: DollarSign, requireModule: 'accounting' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, organizations, currentOrg, switchOrg, enabledModules } = useWorkspace()
  const { canView, loading: permsLoading } = usePermissions()
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleCategory = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // Determine if current org is a clinical org (show EHR section)
  const orgSlug = currentOrg?.slug || ''
  const isClinicalOrg = orgSlug.includes('sensorium') || orgSlug.includes('neuro-progeny') || orgSlug.includes('neuro_progeny') || orgSlug.includes('nprogeny') || enabledModules.includes('ehr')

  // Filter EHR items based on org + feature flags
  const visibleEhrItems = ehrItems.filter(item => {
    if (item.requireModule && !enabledModules.includes(item.requireModule)) return false
    if (item.forAllOrgs && isClinicalOrg) return true
    if (item.requireModule && enabledModules.includes(item.requireModule)) return true
    return false
  })

  // Always show EHR section if there's at least one visible EHR item
  const showEhr = visibleEhrItems.length > 0

  return (
    <aside className="w-64 h-screen bg-white border-r border-gray-100 flex flex-col fixed left-0 top-0">
      {/* Brand */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-np-blue rounded-xl flex items-center justify-center">
            <span className="text-white text-sm font-bold">NP</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-np-dark">NPU Hub</h1>
            <p className="text-xs text-gray-400">Operations</p>
          </div>
        </div>
      </div>

      {/* Workspace Switcher */}
      {organizations.length > 1 && (
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
        {navCategories.map((category) => {
          const visibleItems = category.items.filter(item => canView(item.moduleKey))
          if (visibleItems.length === 0) return null

          const isCollapsed = collapsed[category.id] && category.collapsible

          return (
            <div key={category.id} className="mb-1">
              {category.label && (
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
                        ${!isCollapsed ? 'rotate-90' : ''}`}
                    />
                  )}
                </button>
              )}

              {!isCollapsed && (
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href ||
                      (item.href !== '/' && pathname.startsWith(item.href))

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                          ${isActive
                            ? 'bg-np-blue/10 text-np-blue font-medium'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-np-dark'
                          }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
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

            {!collapsed['ehr'] && (
              <div className="space-y-0.5">
                {visibleEhrItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname.startsWith(item.href)

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                        ${isActive
                          ? 'bg-np-blue/10 text-np-blue font-medium'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-np-dark'
                        }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
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
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-np-blue/10 flex items-center justify-center">
            <span className="text-xs font-medium text-np-blue">
              {user?.email?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-np-dark truncate">
              {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
            </p>
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          </div>
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
  )
}
