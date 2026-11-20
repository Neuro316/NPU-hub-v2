'use client'
// The latest test drive, shown on the campaign page even after it has ended: when it started, each step's send
// decision and its plain-language reason, the subject and first lines of what would have been sent (so the merged
// name shows, not {{first_name}}), or why it ended early. A test drive skips exit rules and step delays, so each step
// runs on the next engine pass (every five minutes); while it runs this checks every 15 seconds.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, Flag } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { reasonText, testDriveView, type TestDrive } from '@/lib/marketing/ui-logic'

interface Activity { latest_test_drive: TestDrive | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const POLL_FOR_MS = 20 * 60_000

export function TestDriveResult({ campaignId, startedAt, enrollResult, onActive }: { campaignId: string; startedAt: number | null; enrollResult: any | null; onActive?: (active: boolean) => void }) {
  const [a, setA] = useState<Activity | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setA(await api(`/api/marketing/campaigns/${campaignId}/activity`)); setErr(null) }
    catch (e: any) { setErr(`${e.message} The result will show here once the page can reach the Hub again.`) }
  }, [campaignId])
  useEffect(() => { load() }, [load, startedAt])

  const view = testDriveView(a?.latest_test_drive)
  const live = view.state === 'waiting' || view.state === 'running'
  // the campaign page shows Stop test drive while the latest test drive is still active
  useEffect(() => { onActive?.(a?.latest_test_drive?.status === 'active') }, [a, onActive])
  const recent = view.state !== 'none' && Date.now() - new Date(view.startedAt).getTime() < POLL_FOR_MS
  useEffect(() => {
    if (!live || !recent) return
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [live, recent, load])

  if (enrollResult && !enrollResult.enrolled) return (
    <div className="mt-3 rounded-lg border border-gold/30 bg-gold-light p-3 text-xs text-np-dark" role="status">
      <p className="font-semibold">The test drive did not start.</p><p className="mt-0.5">{reasonText(enrollResult.reason)}</p>
    </div>)
  if (err) return <p className="mt-3 text-xs text-fire" role="alert">{err}</p>
  if (view.state === 'none') return <p className="mt-3 text-[11px] text-gray-400">No test drive has run for this campaign yet.</p>
  if (view.state === 'waiting') return (
    <p className="mt-3 flex items-center gap-2 rounded-lg bg-np-light p-3 text-xs text-gray-600" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Test drive started {when(view.startedAt)}. Your test contact is in, and the first step runs on the next engine pass (every five minutes). This updates on its own.</p>)

  const headline = view.state === 'running' ? 'Test drive in progress' : view.state === 'finished' ? 'Test drive finished' : `Test drive ended early (${view.endLabel ?? 'no reason recorded'})`
  return (
    <div className={`mt-3 rounded-lg border p-3 text-xs ${view.state === 'ended_early' ? 'border-gold/30 bg-gold-light' : 'border-teal/30 bg-teal-light'}`} role="status">
      <p className="flex items-center gap-1.5 font-semibold text-np-dark">
        {view.state === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-teal" aria-hidden /> : <Flag className={`h-4 w-4 ${view.state === 'ended_early' ? 'text-gold' : 'text-teal'}`} aria-hidden />}
        {headline}, started {when(view.startedAt)}{view.endedAt ? `, ended ${when(view.endedAt)}` : ''}</p>
      {view.ending && <p className="mt-1 text-gray-700">{view.ending}</p>}
      {view.steps.length === 0 && view.state !== 'running' && (
        <p className="mt-1 text-gray-500">No step ran before it ended. (Test drives started before this change recorded no step details.)</p>)}
      <ol className="mt-2 space-y-2">
        {view.steps.map((s) => {
          const Icon = s.verdict.startsWith('Allowed') ? CheckCircle2 : s.verdict.startsWith('Waiting') ? Clock : XCircle
          return (
            <li key={s.key} className="rounded border border-white/70 bg-white/70 p-2 text-gray-700">
              <p className="flex items-center gap-1.5 font-medium text-np-dark"><Icon className="h-3.5 w-3.5" aria-hidden />{s.label}: {s.verdict}</p>
              <p className="mt-0.5">Why: {s.why}</p>
              {s.notSent && <p className="mt-0.5">Not sent: {s.notSent}</p>}
              {(s.subject || s.preview) && <div className="mt-1 border-t border-gray-100 pt-1">
                {s.subject && <p className="font-semibold">{s.subject}</p>}
                {s.preview && <p className="whitespace-pre-wrap">{s.preview}</p>}
              </div>}
            </li>)
        })}
      </ol>
    </div>
  )
}
