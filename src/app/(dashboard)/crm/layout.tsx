'use client'

// ═══════════════════════════════════════════════════════════════
// NPU CRM Layout — Sub-navigation within the hub dashboard
// This wraps all /crm/* routes
// UPDATED: Added Conversations tab
// ═══════════════════════════════════════════════════════════════

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Users, BarChart3, Phone, Mail, Workflow,
  CheckSquare, Settings, LayoutDashboard, Target, MessagesSquare, GitBranch, Upload
} from 'lucide-react'

const CRM_NAV = [
  { href: '/crm', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/crm/contacts', label: 'Contacts', icon: Users },
  { href: '/crm/pipelines', label: 'Pipelines', icon: Target },
  { href: '/crm/network', label: 'Network', icon: GitBranch },
  { href: '/crm/conversations', label: 'Conversations', icon: MessagesSquare },
  { href: '/crm/dialer', label: 'Dialer', icon: Phone },
  { href: '/crm/campaigns', label: 'Campaigns', icon: Mail },
  { href: '/crm/sequences', label: 'Sequences', icon: Workflow },
  { href: '/crm/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/crm/import', label: 'Import', icon: Upload },
  { href: '/crm/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/crm/settings', label: 'Settings', icon: Settings },
]

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full -m-6">
      {/* CRM Sub-Nav Bar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-100 bg-white/60 backdrop-blur-sm overflow-x-auto flex-shrink-0">
        {CRM_NAV.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/crm' && pathname?.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                transition-all whitespace-nowrap
                ${isActive
                  ? 'bg-np-blue text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-np-dark'
                }
              `}
            >
              <Icon size={13} />
              {item.label}
            </Link>
          )
        })}
      </div>

      {/* CRM Page Content */}
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  )
}
