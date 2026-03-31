'use client'

import type { WizardState, ProgramType } from '@/lib/types/programs'
import { Users, UserPlus } from 'lucide-react'

interface Props { state: WizardState; update: (p: Partial<WizardState>) => void }

const TYPES: { id: ProgramType; icon: any; title: string; desc: string; context: string }[] = [
  {
    id: 'cohort', icon: Users,
    title: 'Cohort — we start together',
    desc: 'Everyone begins on the same date with shared momentum. Week 1 is Week 1 for all. Best for immersives and masterminds.',
    context: 'Cohort programs build strong shared identity. Participants often form lasting peer connections because they\'re experiencing the same content at the same moment.',
  },
  {
    id: 'rolling', icon: UserPlus,
    title: 'Rolling admission — they start when they\'re ready',
    desc: 'Each participant begins from their enrollment date. The community is always open. Best for ongoing access programs.',
    context: 'Rolling admission programs are always welcoming. Participants are supported by a community at different stages — everyone is further ahead than someone.',
  },
]

export function WizardStep1Type({ state, update }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-np-dark mb-2">What kind of program are you creating?</h1>
      <p className="text-sm text-gray-500 mb-8">This shapes how participants experience their journey together — or on their own timeline.</p>

      <div className="space-y-3">
        {TYPES.map(t => (
          <button key={t.id} onClick={() => update({ programType: t.id })}
            className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
              state.programType === t.id ? 'border-teal-500 bg-teal-50/50 shadow-sm' : 'border-gray-200 hover:border-teal-300 hover:bg-gray-50'
            }`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${state.programType === t.id ? 'bg-teal-100' : 'bg-gray-100'}`}>
                <t.icon className={`w-5 h-5 ${state.programType === t.id ? 'text-teal-600' : 'text-gray-500'}`} />
              </div>
              <div>
                <p className="text-sm font-bold text-np-dark">{t.title}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {state.programType && (
        <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-xl">
          <p className="text-xs text-teal-800 leading-relaxed">{TYPES.find(t => t.id === state.programType)?.context}</p>
        </div>
      )}
    </div>
  )
}
