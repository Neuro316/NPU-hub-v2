'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { Plus, LayoutGrid, Users, UserPlus } from 'lucide-react'
import type { Program } from '@/lib/types/programs'

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft: { bg: '#F3F4F6', color: '#6B7280' },
  live: { bg: '#D1FAE5', color: '#10B981' },
  archived: { bg: '#FEF3C7', color: '#F59E0B' },
}

export default function ProgramsPage() {
  const { currentOrg } = useWorkspace()
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentOrg) return
    createClient().from('programs').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
      .then(({ data }) => { setPrograms((data || []) as Program[]); setLoading(false) })
  }, [currentOrg?.id])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2"><LayoutGrid className="w-5 h-5" /> Programs</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">Create and manage learning programs, cohorts, and enrollment</p>
        </div>
        <Link href="/programs/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 transition-colors">
          <Plus className="w-4 h-4" /> New Program
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading programs...</div>
      ) : programs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <LayoutGrid className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">No programs yet</h2>
          <p className="text-sm text-gray-500 mb-6">Create your first program to start enrolling participants.</p>
          <Link href="/programs/new" className="bg-teal-600 text-white text-sm py-2.5 px-5 rounded-xl font-medium hover:bg-teal-700">
            Create Your First Program
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map(p => {
            const st = STATUS_COLORS[p.status] || STATUS_COLORS.draft
            return (
              <Link key={p.id} href={`/programs/${p.id}`}
                className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md transition-all group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ backgroundColor: st.bg, color: st.color }}>
                    {p.status}
                  </span>
                  <div className="flex items-center gap-1 text-gray-400">
                    {p.program_type === 'cohort' ? <Users className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  </div>
                </div>
                <h3 className="text-sm font-bold text-np-dark mb-1 group-hover:text-teal-600 transition-colors">{p.name}</h3>
                {p.description && <p className="text-[11px] text-gray-500 line-clamp-2 mb-3">{p.description}</p>}
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  {p.duration && <span>{p.duration}</span>}
                  {p.facilitator_name && <span>{p.facilitator_name}</span>}
                  {p.price_cents && <span>${(p.price_cents / 100).toFixed(0)}</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
