'use client'

import { useEffect, useState } from 'react'
import { Plus, Workflow, Mail, MessageCircle, Clock, Users, ChevronRight, ArrowDown, X } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { fetchSequences, fetchEnrollments, createSequence, createSequenceStep } from '@/lib/crm-client'
import type { Sequence, SequenceStep, SequenceEnrollment } from '@/types/crm'

function StepCard({ step, index }: { step: SequenceStep; index: number }) {
  const isEmail = step.channel === 'email'
  const delayText = step.delay_minutes < 60 ? `${step.delay_minutes}min` : step.delay_minutes < 1440 ? `${Math.round(step.delay_minutes/60)}hr` : `${Math.round(step.delay_minutes/1440)}d`
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
          <p className="text-[10px] text-gray-400 truncate">{step.body.substring(0, 60)}...</p>
        </div>
      </div>
    </div>
  )
}

function SequenceCard({ seq, enrollmentCount, onClick }: { seq: Sequence; enrollmentCount: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-np-blue/20 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1"><h4 className="text-sm font-semibold text-np-dark">{seq.name}</h4>{seq.description && <p className="text-[10px] text-gray-400 mt-0.5">{seq.description}</p>}</div>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${seq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>{seq.is_active ? '● Active' : '○ Inactive'}</span>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><Workflow size={10} /> {seq.steps?.length || 0} steps</span>
        <span className="flex items-center gap-1"><Users size={10} /> {enrollmentCount} enrolled</span>
        <span className="capitalize">{seq.trigger_type.replace('_', ' ')}</span>
      </div>
      {seq.steps && seq.steps.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 overflow-hidden">
          {seq.steps.slice(0,5).map((s,i) => (
            <div key={s.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={8} className="text-gray-400" />}
              <div className={`w-5 h-5 rounded flex items-center justify-center ${s.channel === 'email' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                {s.channel === 'email' ? <Mail size={9} /> : <MessageCircle size={9} />}
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
  const [form, setForm] = useState(EMPTY_SEQ)
  const [stepForm, setStepForm] = useState(EMPTY_STEP)
  const [saving, setSaving] = useState(false)

  const reload = async () => {
    try {
      const [seqs, enrolls] = await Promise.all([fetchSequences(), fetchEnrollments()])
      setSequences(seqs); setEnrollments(enrolls)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  const enrollmentCount = (seqId: string) => enrollments.filter(e => e.sequence_id === seqId && e.status === 'active').length

  const handleCreateSeq = async () => {
    if (!form.name || !currentOrg) return
    setSaving(true)
    try {
      const created = await createSequence({
        org_id: currentOrg.id, name: form.name, description: form.description || null,
        trigger_type: form.trigger_type, is_active: false, created_by: user?.id || null,
      })
      setSequences(prev => [created, ...prev])
      setShowCreate(false); setForm(EMPTY_SEQ)
      setActiveSeq(created)
    } catch (e) { console.error(e); alert('Failed to create sequence') } finally { setSaving(false) }
  }

  const handleAddStep = async () => {
    if (!activeSeq || !stepForm.body) return
    setSaving(true)
    try {
      const stepOrder = (activeSeq.steps?.length || 0) + 1
      await createSequenceStep({
        sequence_id: activeSeq.id, step_order: stepOrder,
        channel: stepForm.channel, delay_minutes: stepForm.delay_minutes,
        subject: stepForm.channel === 'email' ? stepForm.subject : null,
        body: stepForm.body,
      })
      await reload()
      // Re-select to refresh steps
      const updated = (await fetchSequences()).find(s => s.id === activeSeq.id)
      if (updated) setActiveSeq(updated)
      setShowAddStep(false); setStepForm(EMPTY_STEP)
    } catch (e) { console.error(e); alert('Failed to add step') } finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="animate-in fade-in duration-300">
      {activeSeq ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <button onClick={() => setActiveSeq(null)} className="text-[10px] text-np-blue hover:underline mb-1">← Back to sequences</button>
              <h2 className="text-lg font-bold text-np-dark">{activeSeq.name}</h2>
              <p className="text-xs text-gray-400">{activeSeq.description}</p>
            </div>
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${activeSeq.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>{activeSeq.is_active ? '● Active' : '○ Inactive'}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-0">
              <h3 className="text-sm font-semibold text-np-dark mb-3">Steps</h3>
              {activeSeq.steps?.sort((a,b) => a.step_order - b.step_order).map((step,i) => <StepCard key={step.id} step={step} index={i} />)}
              {(!activeSeq.steps || activeSeq.steps.length === 0) && <p className="text-xs text-gray-400 text-center py-8">No steps configured</p>}
              <button onClick={() => setShowAddStep(true)} className="mt-3 w-full py-3 border-2 border-dashed border-gray-100 rounded-lg text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">
                <Plus size={14} className="inline mr-1" /> Add Step
              </button>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-np-dark mb-3">Enrollments</h3>
              <div className="space-y-2">
                {enrollments.filter(e => e.sequence_id === activeSeq.id).slice(0,10).map(e => (
                  <div key={e.id} className="p-2.5 rounded-lg border border-gray-100 bg-white">
                    <p className="text-[11px] font-medium text-np-dark">{e.contact_id.slice(0,8)}...</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${e.status==='active'?'bg-green-50 text-green-600':e.status==='completed'?'bg-blue-50 text-blue-600':'bg-gray-50 text-gray-500'}`}>{e.status}</span>
                      <span className="text-[9px] text-gray-400">Step {e.current_step}</span>
                    </div>
                  </div>
                ))}
                {enrollments.filter(e => e.sequence_id === activeSeq.id).length === 0 && <p className="text-xs text-gray-400 text-center py-4">No enrollments yet</p>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-np-dark">Sequences</h2>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={13} /> New Sequence
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sequences.map(s => <SequenceCard key={s.id} seq={s} enrollmentCount={enrollmentCount(s.id)} onClick={() => setActiveSeq(s)} />)}
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

      {/* ═══ Create Sequence Modal ═══ */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Sequence</h3>
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_SEQ) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-[10px] font-semibold uppercase text-gray-400">Name *</label><input value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="Post-Discovery Follow-Up" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div><label className="text-[10px] font-semibold uppercase text-gray-400">Description</label><textarea value={form.description} onChange={e => setForm(p=>({...p,description:e.target.value}))} placeholder="5-email drip sequence for prospects post discovery call" rows={2} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              <div><label className="text-[10px] font-semibold uppercase text-gray-400">Trigger</label>
                <select value={form.trigger_type} onChange={e => setForm(p=>({...p,trigger_type:e.target.value as any}))} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                  <option value="manual">Manual Enrollment</option>
                  <option value="tag_added">Tag Added</option>
                  <option value="pipeline_change">Pipeline Stage Change</option>
                  <option value="form_submit">Form Submission</option>
                  <option value="lifecycle_event">Lifecycle Event</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_SEQ) }} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleCreateSeq} disabled={!form.name||saving} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">{saving ? 'Saving...' : 'Create Sequence'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Add Step Modal ═══ */}
      {showAddStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">Add Step</h3>
              <button onClick={() => { setShowAddStep(false); setStepForm(EMPTY_STEP) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button onClick={() => setStepForm(p=>({...p,channel:'email'}))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-xs font-medium ${stepForm.channel==='email' ? 'border-np-blue bg-np-blue/5 text-np-blue' : 'border-gray-100 text-gray-400'}`}><Mail size={14} /> Email</button>
                <button onClick={() => setStepForm(p=>({...p,channel:'sms'}))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-xs font-medium ${stepForm.channel==='sms' ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-100 text-gray-400'}`}><MessageCircle size={14} /> SMS</button>
              </div>
              <div><label className="text-[10px] font-semibold uppercase text-gray-400">Delay</label>
                <div className="flex gap-2 mt-1">
                  <input type="number" value={Math.round(stepForm.delay_minutes / (stepForm.delay_minutes >= 1440 ? 1440 : stepForm.delay_minutes >= 60 ? 60 : 1))} onChange={e => {
                    const unit = stepForm.delay_minutes >= 1440 ? 1440 : stepForm.delay_minutes >= 60 ? 60 : 1
                    setStepForm(p => ({ ...p, delay_minutes: parseInt(e.target.value) * unit || 0 }))
                  }} className="w-20 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                  <select value={stepForm.delay_minutes >= 1440 ? 'days' : stepForm.delay_minutes >= 60 ? 'hours' : 'minutes'} onChange={e => {
                    const current = stepForm.delay_minutes
                    const currentVal = current >= 1440 ? current/1440 : current >= 60 ? current/60 : current
                    const mult = e.target.value === 'days' ? 1440 : e.target.value === 'hours' ? 60 : 1
                    setStepForm(p => ({ ...p, delay_minutes: Math.round(currentVal) * mult }))
                  }} className="px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
              {stepForm.channel === 'email' && (
                <div><label className="text-[10px] font-semibold uppercase text-gray-400">Subject</label><input value={stepForm.subject} onChange={e => setStepForm(p=>({...p,subject:e.target.value}))} placeholder="Quick follow-up..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              )}
              <div><label className="text-[10px] font-semibold uppercase text-gray-400">Body *</label><textarea value={stepForm.body} onChange={e => setStepForm(p=>({...p,body:e.target.value}))} placeholder={stepForm.channel === 'email' ? '<p>Hi {{first_name}},</p>' : 'Hey {{first_name}}...'} rows={5} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 font-mono" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => { setShowAddStep(false); setStepForm(EMPTY_STEP) }} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button onClick={handleAddStep} disabled={!stepForm.body||saving} className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">{saving ? 'Saving...' : 'Add Step'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
