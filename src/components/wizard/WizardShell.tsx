'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { WizardState } from '@/lib/types/programs'
import { INITIAL_WIZARD_STATE } from '@/lib/types/programs'
import { WizardStep1Type } from './WizardStep1Type'
import { WizardStep2Delivery } from './WizardStep2Delivery'
import { WizardStep3Details } from './WizardStep3Details'
import { WizardStep4Facilitator } from './WizardStep4Facilitator'
import { WizardStep5Enrollment } from './WizardStep5Enrollment'
import { WizardStep6Review } from './WizardStep6Review'

const STEPS = ['Type', 'Delivery', 'Details', 'Facilitator', 'Enrollment', 'Review']

interface Props {
  orgId: string
  onComplete: (state: WizardState, publish: boolean) => Promise<void>
}

export function WizardShell({ orgId, onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE)
  const [submitting, setSubmitting] = useState(false)

  const update = (partial: Partial<WizardState>) => setState(prev => ({ ...prev, ...partial }))
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))

  const canContinue = (): boolean => {
    if (step === 0) return !!state.programType
    if (step === 1) return !!state.deliveryMethod
    if (step === 2) return state.name.trim().length >= 3
    if (step === 3) return true // facilitator optional
    if (step === 4) return !!state.enrollmentType
    return true
  }

  const handleSubmit = async (publish: boolean) => {
    setSubmitting(true)
    await onComplete(state, publish)
    setSubmitting(false)
  }

  const pct = ((step + 1) / STEPS.length) * 100

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="h-[3px] bg-gray-100 rounded-full mb-8 overflow-hidden">
        <div className="h-full bg-teal-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>

      {/* Step labels */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <span className={`text-[10px] font-medium ${i <= step ? 'text-teal-600' : 'text-gray-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-gray-300 text-[10px]">&middot;</span>}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {step === 0 && <WizardStep1Type state={state} update={update} />}
        {step === 1 && <WizardStep2Delivery state={state} update={update} />}
        {step === 2 && <WizardStep3Details state={state} update={update} />}
        {step === 3 && <WizardStep4Facilitator state={state} update={update} orgId={orgId} />}
        {step === 4 && <WizardStep5Enrollment state={state} update={update} />}
        {step === 5 && <WizardStep6Review state={state} onSubmit={handleSubmit} submitting={submitting} />}
      </div>

      {/* Navigation */}
      {step < 5 && (
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
          <button onClick={back} disabled={step === 0}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-np-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={next} disabled={!canContinue()}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
