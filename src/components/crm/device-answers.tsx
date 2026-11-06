'use client'

// The contact card's Device answers section: what this person answered on a lead device. Each answer shows the
// label stored with the submission, so renaming a question later does not rewrite what they were asked. Renders
// nothing for a contact with no submissions.
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

interface Submission {
  id: string
  outcome: string | null
  outcome_label: string | null
  answers: Record<string, unknown>
  question_labels: Record<string, string>
  submitted_at: string
  lead_devices: { name: string; slug: string } | null
}

const show = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v))

export function DeviceAnswers({ contactId }: { contactId: string }) {
  const [rows, setRows] = useState<Submission[]>([])
  useEffect(() => {
    let off = false
    fetch(`/api/marketing/lead-devices?contact_id=${encodeURIComponent(contactId)}`)
      .then((r) => (r.ok ? r.json() : { submissions: [] }))
      .then((j) => { if (!off) setRows(j.submissions ?? []) })
      .catch(() => {})
    return () => { off = true }
  }, [contactId])
  if (!rows.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2"><Sparkles size={11} /> Device answers</p>
      <div className="space-y-3">
        {rows.map((s) => (
          <div key={s.id}>
            <p className="text-xs font-medium text-np-dark">
              {s.lead_devices?.name ?? 'Lead device'}
              {(s.outcome_label || s.outcome) && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">{s.outcome_label || s.outcome}</span>}
              <span className="ml-1.5 text-[10px] font-normal text-gray-400">{new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </p>
            <dl className="mt-1 space-y-1">
              {Object.entries(s.answers ?? {}).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] text-gray-400">{s.question_labels?.[k] ?? k}</dt>
                  <dd className="text-xs text-np-dark whitespace-pre-wrap break-words">{show(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
