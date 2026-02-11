'use client'

import { useWorkspace } from '@/lib/workspace-context'
import { Calendar, Plus } from 'lucide-react'

export default function CalendarPage() {
  const { currentOrg, loading } = useWorkspace()
  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Content & Campaign Calendar</p>
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
        <Calendar className="w-14 h-14 text-gray-200 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-np-dark mb-2">Content Calendar</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
          Visualize your social posts, campaign milestones, and task deadlines in one calendar view. Drag to reschedule.
        </p>
      </div>
    </div>
  )
}
