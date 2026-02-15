'use client'

import { useEffect, useState } from 'react'
import {
  Plus, Workflow, Mail, MessageCircle, Clock, Play, Pause,
  ChevronRight, Users, X, ArrowDown
} from 'lucide-react'
import { fetchSequences, fetchEnrollments, createSequence, createSequenceStep } from '@/lib/crm-client'
import type { Sequence, SequenceStep, SequenceEnrollment } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual enrollment' },
  { value: 'tag_added', label: 'Tag added' },
  { value: 'pipeline_change', label: 'Pipeline stage change' },
  { value: 'form_submit', label: 'Form submission' },
  { value: 'lifecycle_event', label: 'Lifecycle event' },
]
const DELAY_UNITS = [
  { value: 1, label: 'Minutes' },
  { value: 60, label: 'Hours' },
  { value: 1440, label: 'Days' },
]

function StepCard({ step, index }: { step: SequenceStep; index: number }) {
  const isEmail = step.channel === 'email'
  const delayText = step.delay_minutes < 60 ? `${step.delay_minutes}min`
    : step.delay_minutes < 1440 ? `${Math.round(step.delay_minutes/60)}hr`
    : `${Math.round(step.delay_minutes/1440)}d`

  return (
    <div className="relative">
      {index > 0 && (
        <div className="flex flex-col items-center mb-2">
          <ArrowDown size={14} className="text-gray-400" />
          <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Clock size={8} /> {delayText}</span>
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
          <p className="text-[10px] text-gray-400 truncate">{step.body.substring(0,60)}...</p>
        </div>
      </div>
    </div>
  )
}

function SequenceCard({ seq, enrollCount, onClick }: { seq: Sequence; enrollCount: number; onClick: () => void }) {
  const stepCount = seq.steps?.length || 0
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-np-blue/20 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1"><h4 className="text-sm font-semibold text-np-dark">{seq.name}</h4>
          {seq.description && <p className="text-[10px] text-gray-400 mt-0.5">{seq.description}</p>}</div>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${seq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
          {seq.is_active ? '● Active' : '○ Inactive'}
        </span>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><Workflow size={10} /> {stepCount} steps</span>
        <span className="flex items-center gap-1"><Users size={10} /> {enrollCount} enrolled</span>
        <span className="capitalize">{seq.trigger_type.replace('_',' ')}</span>
      </div>
      {seq.steps && seq.steps.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 overflow-hidden">
          {seq.steps.slice(0,5).map((s,i) => (
            <div key={s.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={8} className="text-gray-400" />}
              <div className={`w-5 h-5 rounded flex items-center justify-center ${s.channel==='email' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                {s.channel==='email' ? <Mail size={9} /> : <MessageCircle size={9} />}
              </div>
            </div>
          ))}
          {seq.steps.length > 5 && <span className="text-[9px] text-gray-400">+{seq.steps.length-5}</span>}
        </div>
      )}
    </button>
  )
}

const EMPTY_SEQ = { name: '', description: '', trigger_type: 'manual' as const }
const EMPTY_STEP = { channel: 'email' as 'email' | 'sms', delay_minutes: 1440, subject: '', body: '' }

export default function SequencesPage() {
  const { currentOrg, user } = useWorkspace()
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSeq, setActiveSeq] = useState<Sequence | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [creating, setCreating] = useState(false)

  const [seqForm, setSeqForm] = useState({ name: '', description: '', trigger_type: 'manual' })
  const [stepForm, setStepForm] = useState({
    channel: 'email' as 'email' | 'sms', delayAmount: 1, delayUnit: 1440,
    subject: '', body: '',
  })

  const reload = async () => {
    try {
      const [seqs, enrolls] = await Promise.all([fetchSequences(), fetchEnrollments()])
      setSequences(seqs); setEnrollments(enrolls)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  const enrollCount = (id: string) => enrollments.filter(e => e.sequence_id === id && e.status === 'active').length

  const handleCreateSequence = async () => {
    if (!seqForm.name || !currentOrg) return
    setCreating(true)
    try {
      const created = await createSequence({
        org_id: currentOrg.id, name: seqForm.name,
        description: seqForm.description || undefined,
        trigger_type: seqForm.trigger_type as any,
        is_active: false, created_by: user?.id,
      })
      const full = { ...created, steps: [] } as Sequence
      setSequences(prev => [full, ...prev])
      setShowCreate(false)
      setActiveSeq(full)
      setSeqForm({ name:'', description:'', trigger_type:'manual' })
    } catch (e) { console.error(e); alert('Failed to create sequence') }
    finally { setCreating(false) }
  }

  const handleAddStep = async () => {
    if (!activeSeq || !stepForm.body) return
    setCreating(true)
    try {
      const currentSteps = activeSeq.steps?.length || 0
      const step = await createSequenceStep({
        sequence_id: activeSeq.id,
        step_order: currentSteps + 1,
        channel: stepForm.channel,
        delay_minutes: stepForm.delayAmount * stepForm.delayUnit,
        subject: stepForm.channel === 'email' ? stepForm.subject : undefined,
        body: stepForm.body,
      })
      const updated = { ...activeSeq, steps: [...(activeSeq.steps || []), step] }
      setActiveSeq(updated)
      setSequences(prev => prev.map(s => s.id === updated.id ? updated : s))
      setShowAddStep(false)
      setStepForm({ channel:'email', delayAmount:1, delayUnit:1440, subject:'', body:'' })
    } catch (e) { console.error(e); alert('Failed to add step') }
    finally { setCreating(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="animate-in fade-in duration-300">
      {activeSeq ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setActiveSeq(null)} className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-np-dark transition-colors">
                <ChevronRight size={16} className="rotate-180" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-np-dark">{activeSeq.name}</h2>
                {activeSeq.description && <p className="text-xs text-gray-400 mt-0.5">{activeSeq.description}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${activeSeq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                {activeSeq.is_active ? '● Active' : '○ Inactive'}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-0">
              <h3 className="text-sm font-semibold text-np-dark mb-3">Steps</h3>
              {activeSeq.steps?.sort((a,b) => a.step_order - b.step_order).map((step,i) => <StepCard key={step.id} step={step} index={i} />)}
              {(!activeSeq.steps || activeSeq.steps.length === 0) && <p className="text-xs text-gray-400 text-center py-8">No steps configured</p>}
              <button onClick={() => setShowAddStep(true)}
                className="mt-3 w-full py-3 border-2 border-dashed border-gray-100 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">
                <Plus size={14} className="inline mr-1" /> Add Step
              </button>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-np-dark mb-3">Enrollments</h3>
              <div className="space-y-2">
                {enrollments.filter(e => e.sequence_id === activeSeq.id).slice(0,10).map(e => (
                  <div key={e.id} className="p-2.5 rounded-lg border border-gray-100 bg-white">
                    <p className="text-[11px] font-medium text-np-dark">
                      {(e as any).contacts ? `${(e as any).contacts.first_name} ${(e as any).contacts.last_name}` : e.contact_id.slice(0,8) + '...'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        e.status==='active' ? 'bg-green-50 text-green-600' : e.status==='completed' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-500'
                      }`}>{e.status}</span>
                      <span className="text-[9px] text-gray-400">Step {e.current_step}</span>
                    </div>
                  </div>
                ))}
                {enrollments.filter(e => e.sequence_id === activeSeq.id).length === 0 && (
                  <p className="text-[10px] text-gray-400 text-center py-4">No enrollments yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Sequence List */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-np-dark">Sequences</h2>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={13} /> New Sequence
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sequences.map(s => <SequenceCard key={s.id} seq={s} enrollCount={enrollCount(s.id)} onClick={() => setActiveSeq(s)} />)}
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

      {/* ── Create Sequence Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Sequence</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Name *</label>
                <input value={seqForm.name} onChange={e => setSeqForm(p=>({...p,name:e.target.value}))} placeholder="New Client Onboarding"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</label>
                <textarea value={seqForm.description} onChange={e => setSeqForm(p=>({...p,description:e.target.value}))} rows={2} placeholder="Automated onboarding flow..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Trigger</label>
                <select value={seqForm.trigger_type} onChange={e => setSeqForm(p=>({...p,trigger_type:e.target.value}))}
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreateSequence} disabled={!seqForm.name || creating}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-np-dark transition-colors">
                {creating ? 'Creating...' : 'Create Sequence'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Step Modal ── */}
      {showAddStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">Add Step</h3>
              <button onClick={() => setShowAddStep(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              {/* Channel toggle */}
              <div className="flex gap-1 p-1 bg-gray-50 rounded-lg">
                {(['email','sms'] as const).map(ch => (
                  <button key={ch} onClick={() => setStepForm(p => ({ ...p, channel: ch }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                      stepForm.channel === ch ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400'
                    }`}>
                    {ch==='email' ? <Mail size={12} /> : <MessageCircle size={12} />}
                    {ch==='email' ? 'Email' : 'SMS'}
                  </button>
                ))}
              </div>
              {/* Delay */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Delay Before This Step</label>
                <div className="flex gap-2 mt-1">
                  <input type="number" min={0} value={stepForm.delayAmount} onChange={e => setStepForm(p=>({...p,delayAmount:parseInt(e.target.value)||0}))}
                    className="w-20 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                  <div className="flex gap-0.5 p-0.5 bg-gray-50 rounded-lg">
                    {DELAY_UNITS.map(u => (
                      <button key={u.value} onClick={() => setStepForm(p=>({...p,delayUnit:u.value}))}
                        className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                          stepForm.delayUnit===u.value ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400'
                        }`}>{u.label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Subject (email only) */}
              {stepForm.channel === 'email' && (
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject</label>
                  <input value={stepForm.subject} onChange={e => setStepForm(p=>({...p,subject:e.target.value}))} placeholder="Follow-up: {{first_name}}"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              )}
              {/* Body */}
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Message Body *</label>
                <textarea value={stepForm.body} onChange={e => setStepForm(p=>({...p,body:e.target.value}))} rows={4}
                  placeholder={stepForm.channel === 'email' ? '<p>Hi {{first_name}},</p>' : 'Hi {{first_name}}, ...'}
                  className={`w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 ${stepForm.channel==='email' ? 'font-mono' : ''}`} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddStep(false)} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleAddStep} disabled={!stepForm.body || creating}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-np-dark transition-colors">
                {creating ? 'Adding...' : 'Add Step'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
