'use client'

import type { WizardState, DeliveryMethod } from '@/lib/types/programs'
import { Layers, ArrowRight, CalendarClock } from 'lucide-react'

interface Props { state: WizardState; update: (p: Partial<WizardState>) => void }

const METHODS: { id: DeliveryMethod; icon: any; title: string; desc: string; context: string }[] = [
  {
    id: 'all_at_once', icon: Layers,
    title: 'Everything on day one',
    desc: 'All content available immediately. Participants move at their own pace.',
    context: 'Best when the content works well in any order and participants are self-directed.',
  },
  {
    id: 'sequential', icon: ArrowRight,
    title: 'One module unlocks the next',
    desc: 'Completing each module unlocks the next. Creates a clear learning path.',
    context: 'Best when order and integration matter — like nervous system progression. Your facilitator can manually unlock a module for any participant if needed.',
  },
  {
    id: 'daily_drip', icon: CalendarClock,
    title: 'One lesson per day — daily drip',
    desc: 'Content releases day by day from when they begin. Builds daily practice rhythm.',
    context: 'You\'ll set a day offset for each lesson in the course editor after setup. Participants see "Unlocks in X days" for upcoming content and a Begin Course button that sets their personal Day 1.',
  },
]

export function WizardStep2Delivery({ state, update }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-np-dark mb-2">How will content be released to participants?</h1>
      <p className="text-sm text-gray-500 mb-8">You&apos;re choosing the rhythm of their learning — this shapes how they pace themselves and how your facilitator supports them.</p>

      <div className="space-y-3">
        {METHODS.map(m => (
          <button key={m.id} onClick={() => update({ deliveryMethod: m.id })}
            className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
              state.deliveryMethod === m.id ? 'border-teal-500 bg-teal-50/50 shadow-sm' : 'border-gray-200 hover:border-teal-300 hover:bg-gray-50'
            }`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${state.deliveryMethod === m.id ? 'bg-teal-100' : 'bg-gray-100'}`}>
                <m.icon className={`w-5 h-5 ${state.deliveryMethod === m.id ? 'text-teal-600' : 'text-gray-500'}`} />
              </div>
              <div>
                <p className="text-sm font-bold text-np-dark">{m.title}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{m.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {state.deliveryMethod && (
        <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-xl">
          <p className="text-xs text-teal-800 leading-relaxed">{METHODS.find(m => m.id === state.deliveryMethod)?.context}</p>
        </div>
      )}
    </div>
  )
}
