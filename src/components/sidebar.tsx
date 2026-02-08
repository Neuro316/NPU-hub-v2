'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useWorkspace } from '@/lib/workspace-context'
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
  Building2,
  BookOpen,
  Mic,
  TicketCheck,
  Activity,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Journey Builder', href: '/journeys', icon: Route },
  { label: 'Task Manager', href: '/tasks', icon: CheckSquare },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { label: 'Social Media', href: '/social', icon: Target },
  { label: 'AI Advisory', href: '/advisory', icon: Brain },
  { label: 'SOPs', href: '/sops', icon: FileText },
  { label: 'Ideas', href: '/ideas', icon: Lightbulb },
  { label: 'ICP Profiles', href: '/icps', icon: Users },
  { label: 'Calendar', href: '/calendar', icon: Calendar },
  { label: 'Company Library', href: '/library', icon: BookOpen },
  { label: 'Media Appearances', href: '/media', icon: Mic },
  { label: 'Support Tickets', href: '/tickets', icon: TicketCheck },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Integrations', href: '/integrations', icon: Activity },
  { label: 'Team', href: '/team', icon: Users },
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, organizations, currentOrg, switchOrg } = useWorkspace()
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false)

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

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
        <div className="space-y-0.5">
          {navItems.map((item) => {
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
