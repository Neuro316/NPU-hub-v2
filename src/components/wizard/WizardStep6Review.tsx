'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import type { WizardState } from '@/lib/types/programs'

interface Props {
  state: WizardState
  onSubmit: (publish: boolean) => Promise<void>
  submitting: boolean
}

const LABELS: Record<string, string> = {
  cohort: 'Cohort — we start together',
  rolling: 'Rolling admission',
  all_at_once: 'Everything on day one',
  sequential: 'One module unlocks the next',
  daily_drip: 'One lesson per day',
  paid: 'Paid via Stripe',
  manual: 'Manual enrollment only',
  both: 'Paid + Manual',
}

export function WizardStep6Review({ state, onSubmit, submitting }: Props) {
  const enrollLabel = state.enrollmentType === 'paid' && state.allowManualAlso ? 'Paid + Manual' : LABELS[state.enrollmentType || ''] || ''
  const priceLabel = state.enrollmentType === 'paid' && state.priceDollars ? `$${state.priceDollars}` : ''

  const rows = [
    { label: 'Program name', value: state.name },
    { label: 'Experience', value: LABELS[state.programType || ''] },
    { label: 'Content release', value: LABELS[state.deliveryMethod || ''] },
    ...(state.programType === 'cohort' && state.startDate ? [{ label: 'Start date', value: new Date(state.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }] : []),
    ...(state.duration ? [{ label: 'Duration', value: state.duration }] : []),
    { label: 'Facilitator', value: state.facilitatorName || 'Assign later' },
    { label: 'Enrollment', value: [enrollLabel, priceLabel].filter(Boolean).join(' — ') },
  ]

  return (
    <div>
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-teal-600" />
        </div>
        <h1 className="text-2xl font-bold text-np-dark mb-2">Your program is ready</h1>
        <p className="text-sm text-gray-500">Review everything below and go live when you&apos;re ready.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between py-1">
              <span className="text-xs text-gray-500">{r.label}</span>
              <span className="text-sm font-medium text-np-dark">{r.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={() => onSubmit(false)} disabled={submitting}
          className="flex-1 py-3 border border-gray-200 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors">
          Save as draft
        </button>
        <button onClick={() => onSubmit(true)} disabled={submitting}
          className="flex-1 py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Creating...' : 'Go live →'}
        </button>
      </div>
    </div>
  )
}
