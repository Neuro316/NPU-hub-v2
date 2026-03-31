'use client'

import { useRouter } from 'next/navigation'
import { useWorkspace } from '@/lib/workspace-context'
import { WizardShell } from '@/components/wizard/WizardShell'
import type { WizardState } from '@/lib/types/programs'

export default function NewProgramPage() {
  const { currentOrg } = useWorkspace()
  const router = useRouter()

  const handleComplete = async (state: WizardState, publish: boolean) => {
    if (!currentOrg) return
    try {
      const res = await fetch('/api/programs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: currentOrg.id,
          name: state.name,
          description: state.description || null,
          programType: state.programType,
          deliveryMethod: state.deliveryMethod,
          startDate: state.startDate || null,
          duration: state.duration || null,
          facilitatorId: state.facilitatorId,
          facilitatorName: state.facilitatorName,
          enrollmentType: state.allowManualAlso ? 'both' : state.enrollmentType,
          priceCents: state.priceDollars ? Math.round(parseFloat(state.priceDollars) * 100) : null,
          publish,
        }),
      })
      const data = await res.json()
      if (data.error) { alert('Failed: ' + data.error); return }
      router.push(`/programs/${data.programId}`)
    } catch (e: any) {
      alert('Failed: ' + e.message)
    }
  }

  if (!currentOrg) return null

  return (
    <div className="py-8 px-4">
      <WizardShell orgId={currentOrg.id} onComplete={handleComplete} />
    </div>
  )
}
