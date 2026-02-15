'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Sequences — Drip sequence builder
// Route: /crm/sequences
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  Plus, Workflow, Mail, MessageCircle, Clock, Play, Pause,
  ChevronRight, Users, MoreHorizontal, Trash2, ArrowDown
} from 'lucide-react'
import { fetchSequences, fetchEnrollments } from '@/lib/crm-client'
import type { Sequence, SequenceStep, SequenceEnrollment } from '@/types/crm'

function StepCard({ step, index }: { step: SequenceStep; index: number }) {
  const isEmail = step.channel === 'email'
  const delayText = step.delay_minutes < 60
    ? `${step.delay_minutes}min`
    : step.delay_minutes < 1440
      ? `${Math.round(step.delay_minutes / 60)}hr`
      : `${Math.round(step.delay_minutes / 1440)}d`

  return (
    <div className="relative">
      {index > 0 && (
        <div className="flex flex-col items-center mb-2">
          <ArrowDown size={14} className="text-gray-400" />
          <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Clock size={8} /> {delayText}
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:shadow-sm transition-all">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isEmail ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
          {isEmail ? <Mail size={14} /> : <MessageCircle size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400">Step {step.step_order}</span>
            <span className="text-[10px] font-semibold text-np-dark capitalize">{step.channel}</span>
          </div>
          {step.subject && <p className="text-[10px] text-gray-600 truncate mt-0.5">{step.subject}</p>}
          <p className="text-[10px] text-gray-400 truncate">{step.body.substring(0, 60)}...</p>
        </div>
      </div>
    </div>
  )
}

function SequenceCard({ seq, enrollmentCount, onClick }: { seq: Sequence; enrollmentCount: number; onClick: () => void }) {
  const stepCount = seq.steps?.length || 0
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-np-blue/20 transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-np-dark">{seq.name}</h4>
          {seq.description && <p className="text-[10px] text-gray-400 mt-0.5">{seq.description}</p>}
        </div>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${seq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
          {seq.is_active ? '● Active' : '○ Inactive'}
        </span>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><Workflow size={10} /> {stepCount} steps</span>
        <span className="flex items-center gap-1"><Users size={10} /> {enrollmentCount} enrolled</span>
        <span className="capitalize">{seq.trigger_type.replace('_', ' ')}</span>
      </div>

      {/* Mini step preview */}
      {seq.steps && seq.steps.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 overflow-hidden">
          {seq.steps.slice(0, 5).map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={8} className="text-gray-400" />}
              <div className={`w-5 h-5 rounded flex items-center justify-center ${s.channel === 'email' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                {s.channel === 'email' ? <Mail size={9} /> : <MessageCircle size={9} />}
              </div>
            </div>
          ))}
          {seq.steps.length > 5 && <span className="text-[9px] text-gray-400">+{seq.steps.length - 5}</span>}
        </div>
      )}
    </button>
  )
}

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSeq, setActiveSeq] = useState<Sequence | null>(null)

  useEffect(() => {
    Promise.all([fetchSequences(), fetchEnrollments()])
      .then(([seqs, enrolls]) => { setSequences(seqs); setEnrollments(enrolls) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const enrollmentCount = (seqId: string) => enrollments.filter(e => e.sequence_id === seqId && e.status === 'active').length

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="animate-in fade-in duration-300">
      {activeSeq ? (
        /* Sequence Detail View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <button onClick={() => setActiveSeq(null)} className="text-[10px] text-np-blue hover:underline mb-1">← Back to sequences</button>
              <h2 className="text-lg font-bold text-np-dark">{activeSeq.name}</h2>
              <p className="text-xs text-gray-400">{activeSeq.description}</p>
            </div>
            <div className="flex gap-2">
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${activeSeq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                {activeSeq.is_active ? '● Active' : '○ Inactive'}
              </span>
              <button className="px-3 py-1.5 text-xs font-medium border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                Edit Sequence
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Steps */}
            <div className="lg:col-span-2 space-y-0">
              <h3 className="text-sm font-semibold text-np-dark mb-3">Steps</h3>
              {activeSeq.steps?.sort((a, b) => a.step_order - b.step_order).map((step, i) => (
                <StepCard key={step.id} step={step} index={i} />
              ))}
              {(!activeSeq.steps || activeSeq.steps.length === 0) && (
                <p className="text-xs text-gray-400 text-center py-8">No steps configured</p>
              )}
              <button className="mt-3 w-full py-3 border-2 border-dashed border-gray-100 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">
                <Plus size={14} className="inline mr-1" /> Add Step
              </button>
            </div>

            {/* Enrollment sidebar */}
            <div>
              <h3 className="text-sm font-semibold text-np-dark mb-3">Enrollments</h3>
              <div className="space-y-2">
                {enrollments
                  .filter(e => e.sequence_id === activeSeq.id)
                  .slice(0, 10)
                  .map(e => (
                    <div key={e.id} className="p-2.5 rounded-lg border border-gray-100 bg-white">
                      <p className="text-[11px] font-medium text-np-dark">{e.contact_id.slice(0, 8)}...</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          e.status === 'active' ? 'bg-green-50 text-green-600' :
                          e.status === 'completed' ? 'bg-blue-50 text-blue-600' :
                          'bg-gray-50 text-gray-500'
                        }`}>
                          {e.status}
                        </span>
                        <span className="text-[9px] text-gray-400">Step {e.current_step}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Sequence List View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-np-dark">Sequences</h2>
            <button className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={13} /> New Sequence
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sequences.map(s => (
              <SequenceCard key={s.id} seq={s} enrollmentCount={enrollmentCount(s.id)} onClick={() => setActiveSeq(s)} />
            ))}
            {sequences.length === 0 && (
              <div className="col-span-full text-center py-12">
                <Workflow size={32} className="mx-auto text-gray-400/30 mb-3" />
                <p className="text-sm text-gray-400">No sequences yet</p>
                <p className="text-[10px] text-gray-400 mt-1">Create automated drip flows for onboarding, follow-ups, and engagement</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
