'use client'
// The result of a test drive, shown on the campaign page: the send decision for your
// test contact and its plain-language reason, plus what would have been sent. It waits
// for the next engine run (every five minutes) and checks every 15 seconds meanwhile.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { reasonText } from '@/lib/marketing/ui-logic'
import { htmlToText } from '@/lib/marketing/render'

interface Activity { decisions: any[]; sends: any[]; test_enrollments: any[] }

export function TestDriveResult({ campaignId, startedAt, enrollResult }: { campaignId: string; startedAt: number | null; enrollResult: any | null }) {
  const [a, setA] = useState<Activity | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(async () => {
    try { setA(await api(`/api/marketing/campaigns/${campaignId}/activity`)); setErr(null) }
    catch (e: any) { setErr(`${e.message} The result will show here once the page can reach the Hub again.`) }
  }, [campaignId])
  useEffect(() => { load() }, [load, startedAt])

  const decision = (a?.decisions ?? []).find((d) => d.is_test && (!startedAt || new Date(d.created_at).getTime() >= startedAt - 5000))
  const waiting = !!startedAt && enrollResult?.enrolled && !decision && now - startedAt < 7 * 60_000
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => { setNow(Date.now()); load() }, 15_000)
    return () => clearInterval(t)
  }, [waiting, load])

  if (enrollResult && !enrollResult.enrolled) return (
    <div className="mt-3 rounded-lg border border-gold/30 bg-gold-light p-3 text-xs text-np-dark" role="status">
      <p className="font-semibold">The test drive did not start.</p><p className="mt-0.5">{reasonText(enrollResult.reason)}</p>
    </div>)
  if (err) return <p className="mt-3 text-xs text-fire" role="alert">{err}</p>
  if (waiting) {
    const left = Math.max(0, Math.ceil((5 * 60_000 - (now - (startedAt ?? now))) / 60_000))
    return <p className="mt-3 flex items-center gap-2 rounded-lg bg-np-light p-3 text-xs text-gray-600" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Your test contact is in. The engine runs every five minutes{left ? `, so expect the first step within about ${left} ${left === 1 ? 'minute' : 'minutes'}` : ' and should pick it up any moment now'}. This updates on its own.</p>
  }
  if (!decision) return startedAt && enrollResult?.enrolled
    ? <p className="mt-3 text-xs text-gray-500" role="status">No decision has been recorded yet. If the campaign engine is switched on, check again in a few minutes; the result also appears in the test contact's Campaigns tab.</p>
    : <p className="mt-3 text-[11px] text-gray-400">No test drive has run for this campaign yet.</p>

  const send = (a?.sends ?? []).find((s) => s.is_test && new Date(s.claimed_at).getTime() >= new Date(decision.created_at).getTime() - 5000)
  const ok = decision.decision === 'allow'
  const Icon = ok ? CheckCircle2 : decision.decision === 'defer' ? Clock : XCircle
  const verdict = ok ? (decision.mode === 'dry_run' ? 'Allowed, as a dry run. Nothing was sent.' : 'Allowed and sent for real.')
    : decision.decision === 'defer' ? 'Waiting. It will try again when it may send.' : 'Refused. Nothing was sent.'
  return (
    <div className={`mt-3 rounded-lg border p-3 text-xs ${ok ? 'border-teal/30 bg-teal-light' : 'border-gold/30 bg-gold-light'}`} role="status">
      <p className="flex items-center gap-1.5 font-semibold text-np-dark"><Icon className={`h-4 w-4 ${ok ? 'text-teal' : 'text-gold'}`} aria-hidden />
        Last test drive, {decision.channel === 'sms' ? 'text message' : 'email'}, {decision.kind}: {verdict}</p>
      <p className="mt-1 text-gray-700">Why: {reasonText(decision.reason)}</p>
      {send?.rendered_body && <div className="mt-2 rounded border border-white/70 bg-white/70 p-2 text-gray-700">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{send.status === 'dry_run' ? 'What it would have sent' : 'What was sent'}</p>
        {send.subject && <p className="font-semibold">{send.subject}</p>}
        <p className="whitespace-pre-wrap">{send.channel === 'email' ? htmlToText(send.rendered_body) : send.rendered_body}</p></div>}
      {send?.skip_reason && <p className="mt-1 text-gray-700">Not sent: {reasonText(send.skip_reason)}</p>}
      <p className="mt-1 text-[10px] text-gray-400">{new Date(decision.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
    </div>
  )
}
