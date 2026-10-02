'use client'
// The Hub Guide (rulings 15 to 19, and 26): ask, read the answer and the articles it used, then
// follow the steps. The answer and the step reached live in the app shell, so they survive moving
// between pages; the question as typed stays in this box only. "Take me there" opens the page and
// keeps the panel open; "Show me" outlines the control. It never clicks, types or submits.
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, Send, MapPin, Eye, BookOpen, Hammer, Check } from 'lucide-react'
import { api } from '@/lib/marketing/client'
import { useToast } from '@/components/ui/toast'
import { showMe } from '@/lib/agent/help/show-me'
import { answeredAction, type GuideView, type ShellAction } from '@/lib/agent/shell-state'
import registry from '@/lib/agent/help-registry.json'

const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30'

/** The screen id of the page in view: a fixed marker in the page, never its contents. */
export function currentScreen(): string | null {
  return typeof document === 'undefined' ? null : document.querySelector('[data-help-screen]')?.getAttribute('data-help-screen') ?? null
}

export function GuideFlow({ orgId, view, dispatch, onHandoff }: {
  orgId: string; view: GuideView | null; dispatch: (a: ShellAction) => void; onHandoff?: () => void
}) {
  const toast = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    try {
      const res = await api('/api/marketing/agent', { action: 'ask', org_id: orgId, question: q, route: pathname, help_id: currentScreen(), session_id: view?.sessionId ?? undefined })
      dispatch(answeredAction(res))
      setQ('')
    } catch (e: any) { toast.show(e.message, 'error') } finally { setBusy(false) }
  }
  function show(target: string) {
    const out = showMe(document, target, (registry as any).help_ids)
    if (!out.ok) toast.show(out.reason === 'not_on_this_page' ? 'That control is on another page. Press Take me there first.' : 'That control could not be found.', 'info')
  }
  const steps = view?.answer?.steps ?? []
  const at = view?.step ?? 0

  return (
    <div className="space-y-3">
      <div className="space-y-2" data-help-id="guide.ask">
        <label className="block text-xs font-medium text-np-dark" htmlFor="gd-q">What do you want to do?</label>
        <textarea id="gd-q" className={`${input} min-h-[60px]`} value={q} maxLength={4000} onChange={(e) => setQ(e.target.value)} placeholder="For example: how do I test a campaign before it goes live?" />
        <div className="flex items-center gap-2"><p className="flex-1 text-[11px] text-gray-400">The Guide sees which page you are on, never what is on it.</p>
          <button type="button" disabled={busy || !q.trim()} onClick={ask} className="inline-flex items-center gap-1 rounded-lg bg-np-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}Ask</button></div>
      </div>
      {view && <div className="space-y-2 rounded-lg border border-gray-100 p-3" data-help-id="guide.answer">
        {view.question && <p className="text-[11px] text-gray-400">You asked: {view.question}</p>}
        <p className="whitespace-pre-wrap text-sm text-np-dark">{view.message}</p>
        {view.answer?.cited?.length ? <p className="flex items-center gap-1 text-[11px] text-gray-500"><BookOpen className="h-3 w-3" aria-hidden />From the help articles: {view.answer.cited.join(', ')}</p> : null}
        {steps.length > 0 && <div data-help-id="guide.stepper">
          <p className="mb-1 text-[11px] font-medium text-gray-500">Step {at + 1} of {steps.length}</p>
          <ol className="space-y-1.5">{steps.map((s, i) => (
            <li key={i} className={`rounded-lg p-2 text-xs ${i === at ? 'bg-np-light ring-1 ring-np-blue/30' : i < at ? 'text-gray-400' : ''}`}>
              <p className={i < at ? 'line-through' : 'text-np-dark'}><b>{i + 1}.</b> {s.text}</p>
              {i === at && <div className="mt-1 flex flex-wrap gap-2">
                {s.route && s.route !== pathname && <button type="button" onClick={() => router.push(s.route!)} className="inline-flex items-center gap-1 text-np-blue underline"><MapPin className="h-3 w-3" aria-hidden />Take me there</button>}
                {s.target && <button type="button" onClick={() => show(s.target!)} className="inline-flex items-center gap-1 text-np-blue underline"><Eye className="h-3 w-3" aria-hidden />Show me</button>}
                {at < steps.length - 1 && <button type="button" data-help-id="guide.step-done" onClick={() => dispatch({ type: 'step', to: at + 1 })} className="inline-flex items-center gap-1 text-np-blue underline"><Check className="h-3 w-3" aria-hidden />Done, next step</button>}
              </div>}
            </li>))}</ol>
        </div>}
        {view.handoffAllowed && onHandoff && <button type="button" onClick={onHandoff} className="inline-flex items-center gap-1 rounded-lg border border-np-blue px-3 py-1.5 text-xs text-np-blue hover:bg-np-blue-light"><Hammer className="h-3.5 w-3.5" aria-hidden />Build this with the Campaign Builder</button>}
      </div>}
    </div>)
}
