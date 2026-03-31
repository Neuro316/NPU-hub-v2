'use client'

import type { WizardState } from '@/lib/types/programs'

interface Props { state: WizardState; update: (p: Partial<WizardState>) => void }

export function WizardStep3Details({ state, update }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-np-dark mb-2">Tell us about your program</h1>
      <p className="text-sm text-gray-500 mb-8">This is what participants will see when they enroll and access their dashboard.</p>

      <div className="space-y-5">
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5">Program name</label>
          <input value={state.name} onChange={e => update({ name: e.target.value })}
            spellCheck autoCapitalize="words" autoCorrect="on"
            placeholder="Keep it evocative — this is the first thing participants see"
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
        </div>

        {state.programType === 'cohort' && (
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">Start date</label>
            <input type="date" value={state.startDate} onChange={e => update({ startDate: e.target.value })}
              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            <p className="text-[10px] text-gray-400 mt-1">Everyone begins on this date.</p>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5">Duration</label>
          <input value={state.duration} onChange={e => update({ duration: e.target.value })}
            placeholder="e.g. 5 weeks"
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5">Short description</label>
          <textarea value={state.description} onChange={e => update({ description: e.target.value })}
            spellCheck autoCapitalize="sentences" autoCorrect="on"
            rows={2} placeholder="What will participants walk away with?"
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-none" />
          <p className="text-[10px] text-gray-400 mt-1">Shown on the enrollment page.</p>
        </div>
      </div>
    </div>
  )
}
