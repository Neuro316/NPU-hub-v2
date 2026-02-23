import { WorkspaceProvider } from '@/lib/workspace-context'
import { PermissionsProvider } from '@/lib/hooks/use-permissions'
import { Sidebar } from '@/components/sidebar'
import { TrackerInit } from '@/components/tracker-init'
import { HelpBot } from '@/components/help-bot'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkspaceProvider>
      <PermissionsProvider>
        <TrackerInit />
        <div className="min-h-screen bg-np-light">
          <Sidebar />
          <main className="ml-64 p-6">
            {children}
          </main>
        </div>
        <HelpBot />
      </PermissionsProvider>
    </WorkspaceProvider>
  )
}
