'use client'
// "AI draft, needs review" (ruling 14): shown on anything the Campaign Builder wrote until a
// person approves it or edits it on its screen. Approving records who looked, by time, through
// POST /api/marketing/agent { action: 'approve' }.
import { useState } from 'react'
import { Sparkles, Check } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'

export type ReviewKind = 'campaign' | 'step' | 'form' | 'page'

export function needsReview(x: { ai_run_id?: string | null; ai_reviewed_at?: string | null } | null | undefined) {
  return !!x?.ai_run_id && !x.ai_reviewed_at
}

/** Marks an AI draft as reviewed. Called by the chip, and after a person saves the item on its screen. */
export async function approveDraft(orgId: string, kind: ReviewKind, id: string) {
  return api('/api/marketing/agent', { action: 'approve', org_id: orgId, kind, id })
}

export function AiChip({ orgId, kind, id, onApproved }: { orgId: string; kind: ReviewKind; id: string; onApproved?: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function approve() {
    setBusy(true)
    try { await approveDraft(orgId, kind, id); toast.show('Marked as reviewed.'); onApproved?.() }
    catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700">
      <Sparkles className="h-3 w-3" aria-hidden />AI draft, needs review
      <button type="button" disabled={busy} onClick={approve} aria-label="Mark this AI draft as reviewed"
        className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-white px-1.5 text-purple-700 hover:bg-purple-100 disabled:opacity-50"><Check className="h-3 w-3" aria-hidden />Approve</button>
    </span>
  )
}
