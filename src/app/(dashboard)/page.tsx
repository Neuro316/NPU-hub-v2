'use client'

import { useWorkspace } from '@/lib/workspace-context'
import {
  Users,
  DollarSign,
  Activity,
  CheckSquare,
  ArrowUpRight,
  Clock,
} from 'lucide-react'

function StatCard({ 
  label, value, change, icon: Icon, color 
}: { 
  label: string
  value: string
  change?: string
  icon: any
  color: string 
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-np-dark mt-1">{value}</p>
          {change && (
            <p className="text-xs text-np-success flex items-center gap-1 mt-2">
              <ArrowUpRight className="w-3 h-3" />
              {change}
            </p>
          )}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { currentOrg, loading } = useWorkspace()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-np-dark">
          {currentOrg?.name || 'Dashboard'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Welcome back. Here&apos;s what&apos;s happening.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Participants"
          value="—"
          icon={Users}
          color="bg-np-blue/10 text-np-blue"
        />
        <StatCard
          label="Revenue (MTD)"
          value="—"
          icon={DollarSign}
          color="bg-np-success/10 text-np-success"
        />
        <StatCard
          label="Open Tasks"
          value="—"
          icon={CheckSquare}
          color="bg-np-warning/10 text-np-warning"
        />
        <StatCard
          label="Active Campaigns"
          value="—"
          icon={Activity}
          color="bg-purple-100 text-purple-600"
        />
      </div>

      {/* Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-np-dark mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { label: 'Create New Journey', href: '/journeys/new' },
              { label: 'Add Task', href: '/tasks/new' },
              { label: 'Generate Quiz', href: '/campaigns/quiz' },
              { label: 'Create Social Post', href: '/social/new' },
            ].map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm text-np-dark">{action.label}</span>
                <ArrowUpRight className="w-4 h-4 text-gray-400" />
              </a>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-np-dark mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <Clock className="w-4 h-4" />
              <span>No recent activity yet. Start building your workspace.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
