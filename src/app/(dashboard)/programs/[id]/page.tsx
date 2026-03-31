'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { CheckCircle2, BookOpen, UserPlus, Copy, Settings, ArrowLeft } from 'lucide-react'
import type { Program } from '@/lib/types/programs'

export default function ProgramOverviewPage() {
  const { id } = useParams()
  const [program, setProgram] = useState<Program | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    createClient().from('programs').select('*').eq('id', id).single()
      .then(({ data }) => { setProgram(data as Program | null); setLoading(false) })
  }, [id])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
  if (!program) return <div className="flex items-center justify-center h-64 text-gray-400">Program not found</div>

  const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#F3F4F6', color: '#6B7280' },
    live: { bg: '#D1FAE5', color: '#10B981' },
    archived: { bg: '#FEF3C7', color: '#F59E0B' },
  }
  const st = STATUS_COLORS[program.status] || STATUS_COLORS.draft

  const actions = [
    { label: 'Build your course content', desc: 'Add modules, lessons, and resources', icon: BookOpen, href: `/content` },
    { label: 'Add participants manually', desc: 'Invite people by email or from the CRM', icon: UserPlus, href: `/crm/contacts` },
    {
      label: 'Copy enrollment link', desc: program.paywall_url || 'No paywall configured', icon: Copy,
      onClick: () => {
        if (program.paywall_url) { navigator.clipboard.writeText(program.paywall_url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
      }
    },
    { label: 'Program settings', desc: 'Edit details, pricing, and delivery', icon: Settings, href: `/programs/${program.id}` },
  ]

  return (
    <div>
      <Link href="/programs" className="flex items-center gap-1 text-xs text-gray-500 hover:text-np-dark mb-4">
        <ArrowLeft className="w-3 h-3" /> All Programs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-np-dark">{program.name}</h1>
            <span className="text-[9px] font-bold px-2.5 py-1 rounded-full uppercase" style={{ backgroundColor: st.bg, color: st.color }}>
              {program.status}
            </span>
          </div>
          {program.description && <p className="text-sm text-gray-500 max-w-lg">{program.description}</p>}
        </div>
      </div>

      {/* Success banner for new programs */}
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 mb-8">
        <div className="flex items-center gap-3 mb-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600" />
          <p className="text-sm font-semibold text-teal-800">Program created. Now let&apos;s build your content.</p>
        </div>
        <p className="text-xs text-teal-700 ml-8">Complete these steps to get your program ready for participants.</p>
      </div>

      {/* Next steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {actions.map((a, i) => {
          const content = (
            <div className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md hover:border-teal-200 transition-all cursor-pointer group">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-teal-50 flex items-center justify-center flex-shrink-0 transition-colors">
                  <a.icon className="w-5 h-5 text-gray-500 group-hover:text-teal-600 transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-np-dark group-hover:text-teal-700 transition-colors">{a.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{a.label === 'Copy enrollment link' && copied ? 'Copied!' : a.desc}</p>
                </div>
              </div>
            </div>
          )
          if (a.onClick) return <div key={i} onClick={a.onClick}>{content}</div>
          if (a.href) return <Link key={i} href={a.href}>{content}</Link>
          return <div key={i}>{content}</div>
        })}
      </div>

      {/* Program details summary */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h2 className="text-sm font-bold text-np-dark mb-3">Program Details</h2>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-gray-500">Type:</span> <span className="text-np-dark font-medium ml-1">{program.program_type === 'cohort' ? 'Cohort' : 'Rolling admission'}</span></div>
          <div><span className="text-gray-500">Delivery:</span> <span className="text-np-dark font-medium ml-1">{program.delivery_method?.replace(/_/g, ' ')}</span></div>
          {program.start_date && <div><span className="text-gray-500">Start:</span> <span className="text-np-dark font-medium ml-1">{new Date(program.start_date).toLocaleDateString()}</span></div>}
          {program.duration && <div><span className="text-gray-500">Duration:</span> <span className="text-np-dark font-medium ml-1">{program.duration}</span></div>}
          <div><span className="text-gray-500">Facilitator:</span> <span className="text-np-dark font-medium ml-1">{program.facilitator_name || 'Not assigned'}</span></div>
          <div><span className="text-gray-500">Enrollment:</span> <span className="text-np-dark font-medium ml-1">{program.enrollment_type}{program.price_cents ? ` — $${(program.price_cents / 100).toFixed(0)}` : ''}</span></div>
        </div>
      </div>
    </div>
  )
}
