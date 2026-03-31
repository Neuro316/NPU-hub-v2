'use client'

import type { WizardState, EnrollmentType } from '@/lib/types/programs'
import { CreditCard, UserPlus } from 'lucide-react'

interface Props { state: WizardState; update: (p: Partial<WizardState>) => void }

const OPTIONS: { id: EnrollmentType; icon: any; title: string; desc: string }[] = [
  { id: 'paid', icon: CreditCard, title: 'Paid — Stripe paywall', desc: 'Participants pay online. Stripe handles checkout. You get a shareable link.' },
  { id: 'manual', icon: UserPlus, title: 'Manual enrollment only', desc: 'You add participants directly. No paywall needed.' },
]

export function WizardStep5Enrollment({ state, update }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-np-dark mb-2">How will people join?</h1>
      <p className="text-sm text-gray-500 mb-8">You can use a paywall, add people manually, or both.</p>

      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map(o => (
          <button key={o.id} onClick={() => update({ enrollmentType: o.id })}
            className={`text-left p-5 rounded-xl border-2 transition-all ${
              state.enrollmentType === o.id ? 'border-teal-500 bg-teal-50/50 shadow-sm' : 'border-gray-200 hover:border-teal-300 hover:bg-gray-50'
            }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${state.enrollmentType === o.id ? 'bg-teal-100' : 'bg-gray-100'}`}>
              <o.icon className={`w-5 h-5 ${state.enrollmentType === o.id ? 'text-teal-600' : 'text-gray-500'}`} />
            </div>
            <p className="text-sm font-bold text-np-dark">{o.title}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{o.desc}</p>
          </button>
        ))}
      </div>

      {state.enrollmentType === 'paid' && (
        <div className="mt-6 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">Price</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input value={state.priceDollars} onChange={e => update({ priceDollars: e.target.value })}
                type="number" min="0" step="1" placeholder="0"
                className="w-full pl-8 pr-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">A Stripe product is created automatically. You can add payment plans and promo codes after launch.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={state.allowManualAlso} onChange={e => update({ allowManualAlso: e.target.checked })}
              className="w-4 h-4 accent-teal-600" />
            <span className="text-xs text-gray-600">Also allow manual enrollment alongside the paywall</span>
          </label>
        </div>
      )}

      {state.enrollmentType === 'manual' && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-xs text-blue-800 leading-relaxed">
            After setup you&apos;ll add participants by email or from the CRM. They&apos;ll receive a magic link to their account.
          </p>
        </div>
      )}
    </div>
  )
}
