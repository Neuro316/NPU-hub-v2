export const dynamic = 'force-dynamic'
import { WorkspaceProvider } from '@/lib/workspace-context'
import { PermissionsProvider } from '@/lib/hooks/use-permissions'
import { CollaborationProvider } from '@/lib/hooks/use-collaboration'
import { Sidebar } from '@/components/sidebar'
import { CollaborationBar } from '@/components/collaboration-bar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkspaceProvider>
      <PermissionsProvider>
        <CollaborationProvider>
          <div className="min-h-screen bg-np-light">
            <Sidebar />
            <CollaborationBar />
            <main className="ml-64 pt-10 p-6">
              {children}
            </main>
          </div>
        </CollaborationProvider>
      </PermissionsProvider>
    </WorkspaceProvider>
  )
}
