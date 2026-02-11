'use client'

import { useWorkspace } from '@/lib/workspace-context'
import { Mic, Plus } from 'lucide-react'

export default function MediaAppearancesPage() {
  const { currentOrg, loading } = useWorkspace()
  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Media Appearances</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Podcasts, Interviews & Press</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
          <Plus className="w-3.5 h-3.5" /> Add Appearance
        </button>
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
        <Mic className="w-14 h-14 text-gray-200 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-np-dark mb-2">Media Appearances</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
          Track podcast appearances, interviews, press mentions, and speaking engagements. Repurpose content from appearances into social posts.
        </p>
        <button className="btn-primary">Add First Appearance</button>
      </div>
    </div>
  )
}
