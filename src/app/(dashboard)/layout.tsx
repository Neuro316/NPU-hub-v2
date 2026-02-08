import { WorkspaceProvider } from '@/lib/workspace-context'
import { Sidebar } from '@/components/sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-np-light">
        <Sidebar />
        <main className="ml-64 p-6">
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  )
}
