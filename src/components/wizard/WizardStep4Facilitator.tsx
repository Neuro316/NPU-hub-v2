'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { AlertTriangle } from 'lucide-react'
import type { WizardState } from '@/lib/types/programs'

interface Props { state: WizardState; update: (p: Partial<WizardState>) => void; orgId: string }

interface Facilitator {
  id: string
  user_id: string
  display_name: string
  role: string
  status: string
}

export function WizardStep4Facilitator({ state, update, orgId }: Props) {
  const [facilitators, setFacilitators] = useState<Facilitator[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('team_profiles')
      .select('id, user_id, display_name, role, status')
      .eq('org_id', orgId)
      .in('role', ['facilitator', 'admin', 'super_admin'])
      .eq('status', 'active')
      .order('display_name')
      .then(({ data }) => { setFacilitators(data || []); setLoading(false) })
  }, [orgId])

  const select = (f: Facilitator | null) => {
    update({
      facilitatorId: f?.user_id || null,
      facilitatorName: f?.display_name || (f === null ? 'Auto-assign' : null),
    })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-np-dark mb-2">Who will guide this program?</h1>
      <p className="text-sm text-gray-500 mb-8">Your facilitator is the human presence that makes the program come alive. They&apos;ll see all participant progress and receive nudge alerts.</p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading team...</p>
      ) : facilitators.length === 0 ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">No facilitators available</p>
              <p className="text-xs text-amber-700 mt-1">You can still create this program and assign a facilitator later.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Auto-assign option */}
          <button onClick={() => select(null)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
              state.facilitatorName === 'Auto-assign' ? 'border-teal-500 bg-teal-50/50' : 'border-gray-200 hover:border-teal-300'
            }`}>
            <p className="text-sm font-bold text-np-dark">Auto-assign</p>
            <p className="text-xs text-gray-500 mt-0.5">Load-balance across available facilitators</p>
          </button>

          {facilitators.map(f => (
            <button key={f.id} onClick={() => select(f)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                state.facilitatorId === f.user_id ? 'border-teal-500 bg-teal-50/50' : 'border-gray-200 hover:border-teal-300'
              }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-teal-700">
                    {f.display_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-np-dark">{f.display_name}</p>
                  <p className="text-xs text-gray-500 capitalize">{f.role.replace('_', ' ')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
