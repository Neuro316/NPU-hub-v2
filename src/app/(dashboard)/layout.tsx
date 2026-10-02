'use client'

import { useEffect } from 'react'
import { WorkspaceProvider } from '@/lib/workspace-context'
import { PermissionsProvider } from '@/lib/hooks/use-permissions'
import { SidebarProvider, useSidebar } from '@/lib/sidebar-context'
import { VoiceReceiverProvider } from '@/lib/voice-receiver-context'
import { IncomingCallBanner, useCallBannerVisible, CALL_BANNER_HEIGHT_PX } from '@/components/incoming-call-banner'
import { Sidebar } from '@/components/sidebar'
import { TrackerInit } from '@/components/tracker-init'
import { AgentShellProvider } from '@/components/marketing/agent/agent-shell'
import { DynamicFavicon } from '@/components/dynamic-favicon'
import { ToastProvider } from '@/components/ui/toast'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed, openMobile, closeMobile } = useSidebar()
  const pathname = usePathname()
  // While a call banner is pinned to the top, push the mobile bar and the page
  // content down by its height so nothing sits underneath it.
  const bannerVisible = useCallBannerVisible()
  const bannerOffset = bannerVisible ? CALL_BANNER_HEIGHT_PX : 0

  // Close mobile sidebar on route change
  useEffect(() => {
    closeMobile()
  }, [pathname])

  return (
    <div className="min-h-screen bg-np-light">
      <Sidebar />

      {/* Mobile top bar */}
      <div
        className="lg:hidden fixed left-0 right-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3"
        style={{ top: bannerOffset }}
      >
        <button onClick={openMobile} className="p-1.5 rounded-lg hover:bg-gray-100">
          <Menu className="w-5 h-5 text-np-dark" />
        </button>
        <div className="w-7 h-7 bg-np-blue rounded-lg flex items-center justify-center">
          <span className="text-white text-xs font-bold">NP</span>
        </div>
        <span className="text-sm font-semibold text-np-dark">NPU Hub</span>
      </div>

      {/* Main content */}
      <main
        className={`
          p-6 transition-all duration-200
          pt-20 lg:pt-6
          ${isCollapsed ? 'lg:ml-16' : 'lg:ml-64'}
        `}
        style={bannerVisible ? { marginTop: bannerOffset } : undefined}
      >
        {children}
      </main>
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkspaceProvider>
      <PermissionsProvider>
        {/* Inside WorkspaceProvider (needs user + currentOrg), outside the page
            content so the Device registration survives route changes. */}
        <VoiceReceiverProvider>
          <SidebarProvider>
           <ToastProvider>
            <TrackerInit />
            <DynamicFavicon />
            {/* The Hub Guide and Campaign Builder panel, and the old HelpBot behind it (ruling 26):
                one instance above the page tree, so it survives navigation. */}
            <AgentShellProvider>
            <DashboardContent>{children}</DashboardContent>
            {/* Calls can arrive on any page — the banner is pinned above
                everything and lives outside the page tree, so navigating
                between CRM and non-CRM routes never unmounts it. */}
            <IncomingCallBanner />
            </AgentShellProvider>
           </ToastProvider>
          </SidebarProvider>
        </VoiceReceiverProvider>
      </PermissionsProvider>
    </WorkspaceProvider>
  )
}
